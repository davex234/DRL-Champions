-- ============================================================================
-- 0040 — GESTIÓN ADMINISTRATIVA DE CARTAS (Bloque 8.4.1)
--
-- QUÉ AÑADE
--   Lo mínimo que le falta al plano de contenido para que un panel pueda operarlo de
--   verdad: dar de alta una carta, editarla mientras es borrador, saber quién hizo qué, y
--   que dos administradores no se pisen. Más el blindaje de D-1b.
--
--   NO se rehace nada de 8.1-8.3. `app_content_publish_version`, `app_content_set_lifecycle`
--   y todo el modelo de pools se reutilizan tal cual.
--
-- ─────────────── LAS CUATRO PIEZAS ───────────────
--
--   §1  content_audit_log            quién creó, editó, publicó o retiró — y cuándo
--   §2  app_content_create_card      alta transaccional: definición + versión 1, en DRAFT
--   §3  app_content_update_draft     edición EN SITIO, y solo mientras es borrador
--   §4  content_card_market_anchor   el ancla del mercado, por VERSIÓN (D-1b)
--
-- ─────────────── D-1b, ENUNCIADA CON PRECISIÓN ANTES DE TOCARLA ───────────────
--
--   Auditado en 0020: `app_market_list` recibe el `card_uid` —el EJEMPLAR— y luego llama a
--   `_market_check_band(user, v_card.card_id, price)`, **tirando la versión que ya tenía en
--   la mano**. La banda se ancla entonces con `_price_anchor(card_id)`:
--
--       1º  card_price_stats.avg_price   ← lo que la carta ha trado de verdad
--       2º  card_reference.fair_value    ← el valor de catálogo, si nunca se ha vendido
--
--   Las dos claves son `card_id`. Así que, con edición en producción, alguien con un
--   ejemplar de la v1 podría publicar dentro de una banda calculada sobre la v2.
--
--   TRES HECHOS MEDIDOS QUE ACOTAN EL RIESGO, y conviene tenerlos delante:
--
--     · `app_market_list` y `app_market_buy` tienen `execute` **solo para `service_role`**.
--       Un usuario no puede invocarlas por PostgREST.
--     · `GLOBAL_MARKET_ENABLED = false` en `config/features.ts`: la ruta rechaza toda
--       escritura del mercado con 503. La puerta está cerrada dos veces.
--     · La banda vigente es 0,2× a 10× — una ventana de 50×. Un ancla equivocada por menos
--       de 5× no cambia ninguna decisión.
--
--   O sea: **no es explotable hoy**. Pero el encargo pide resolverlo o blindarlo ANTES de
--   abrir la edición desde una interfaz, y tiene razón: lo que hoy es inerte deja de serlo
--   el día que el mercado se abra.
--
--   LO QUE SE HACE (§4): el ancla de catálogo pasa a resolverse POR VERSIÓN. No cambia
--   ninguna regla económica —misma fórmula, mismos multiplicadores, mismo error, mismas
--   marcas en `market_flags`—; lo único que cambia es que el número que la banda lee
--   describe el ejemplar que se está vendiendo y no otro.
--
--   LO QUE NO SE HACE, y por qué: `card_price_stats.avg_price` sigue siendo por `card_id`.
--   Es el precio al que la carta ha trado DE VERDAD, y que agregue versiones es una
--   propiedad del mercado —los listados se indexan por `card_id`—, no un fallo del plano de
--   contenido. Separarlo exige historial de precios versionado, que es rediseñar el mercado.
--   Queda como D-1c, declarada, no escondida.
--
--   Y NO se toca `card_reference`: tres vistas de analítica (0004 §489, §514, §527) hacen
--   `join` por `card_id` contra ella. Cambiar su clave primaria las rompería. El ancla
--   versionada vive en una tabla propia del plano de contenido.
--
-- REVERSIÓN (conceptual)
--   drop function if exists public.app_content_create_card(jsonb,text,uuid);
--   drop function if exists public.app_content_update_draft(text,jsonb,text,uuid);
--   drop function if exists public._price_anchor_versioned(text,int);
--   -- y restaurar `_market_check_band`/`app_market_list` a su forma de 0020
--   drop table if exists public.content_card_market_anchor;
--   drop table if exists public.content_audit_log;
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. EL DIARIO DE A BORDO
-- ----------------------------------------------------------------------------
--
-- No existía. `content_card_versions.created_by`/`reason` registra quién PUBLICÓ una
-- versión, pero no quién retiró una carta, quién la creó ni quién movió un pool — y esas
-- son exactamente las preguntas que hay que poder responder cuando algo sale mal.
--
-- Es deliberadamente pequeño. No guarda el estado anterior completo (para eso están las
-- versiones, que ya son inmutables) ni datos personales: solo el id del actor, que es lo
-- que hace falta para saber a quién preguntar.
create table if not exists public.content_audit_log (
  id        bigserial primary key,
  at        timestamptz not null default now(),
  /** Quién. Sale del token en la ruta, nunca del cuerpo. NULL = migración o script. */
  actor     uuid,
  /** Qué: create_card, update_draft, publish_version, set_lifecycle, pool_* … */
  action    text not null,
  card_id   text,
  pool_id   text,
  /** El porqué que exigen las RPC, más lo mínimo para reconstruir la operación. */
  detail    jsonb not null default '{}'::jsonb
);
create index if not exists content_audit_card_idx on public.content_audit_log(card_id, at desc);
create index if not exists content_audit_at_idx   on public.content_audit_log(at desc);

create or replace function public._audit(
  p_action text, p_card_id text, p_pool_id text, p_actor uuid, p_detail jsonb)
returns void language sql security definer set search_path = public as $fn$
  insert into public.content_audit_log (actor, action, card_id, pool_id, detail)
  values (p_actor, p_action, p_card_id, p_pool_id, coalesce(p_detail, '{}'::jsonb));
$fn$;

-- ----------------------------------------------------------------------------
-- 2. ALTA DE UNA CARTA
-- ----------------------------------------------------------------------------
--
-- Transaccional porque son dos escrituras que se necesitan mutuamente: la definición
-- referencia su versión vigente y la versión referencia la definición (0038 §2). Por
-- PostgREST serían dos peticiones y la clave ajena rechazaría la primera.
--
-- **Nace siempre en DRAFT**, y eso no es configurable. Una carta que apareciera publicada
-- en el mismo gesto en que se crea saltaría la validación de §FASE 6 del encargo: existe en
-- la base de datos, no está en el catálogo jugable, no está en pools activos y no puede
-- salir en sobres. Publicar es una segunda decisión, con su propio botón y su propio
-- registro.
--
-- Los VALORES los deriva el dominio en TypeScript (`playerCombatBase` + `deriveCard`, las
-- mismas funciones del generador) y llegan como parámetro. Aquí no se calcula ni una
-- estadística: si esta función pudiera inventar un OVR, habría dos matemáticas del juego.
create or replace function public.app_content_create_card(
  p_def jsonb, p_reason text, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_id text; v_player text; v_variant text; v_now timestamptz := now(); v_ord int;
begin
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'Un alta necesita motivo' using errcode = 'P0001';
  end if;

  v_player  := p_def->>'player_id';
  v_variant := p_def->>'variant_id';
  if v_player is null or v_variant is null then
    raise exception 'Faltan player_id o variant_id' using errcode = 'P0001';
  end if;
  -- La identidad se COMPONE aquí; no se acepta del cliente. Así no hay forma de crear una
  -- carta cuyo id no describa lo que es.
  v_id := v_player || '__' || v_variant;

  if not exists (select 1 from public.content_players where id = v_player) then
    raise exception 'Jugador inexistente: %', v_player using errcode = 'P0001';
  end if;
  if exists (select 1 from public.content_cards where card_id = v_id) then
    raise exception 'Esa carta ya existe: %', v_id using errcode = 'P0001';
  end if;

  -- Al final del orden: una carta nueva no puede desplazar ni una posición del catálogo
  -- vigente, y por tanto no puede alterar el sorteo de un sobre. Ver 8.1 §ordinal.
  select coalesce(max(ordinal), -1) + 1 into v_ord from public.content_cards;

  insert into public.content_cards (
    card_id, player_id, variant_id, ordinal, ovr, stats, combat, stat_boost,
    rarity_rank, rarity_bucket, data_version, source, generated_at,
    origin, lifecycle, definition_version, checksum)
  values (
    v_id, v_player, v_variant, v_ord,
    (p_def->>'ovr')::int, p_def->'stats', p_def->'combat', (p_def->>'stat_boost')::int,
    (p_def->>'rarity_rank')::int, p_def->>'rarity_bucket',
    p_def->>'data_version', p_def->>'source', (p_def->>'generated_at')::timestamptz,
    'admin', 'DRAFT', 1, p_def->>'checksum');

  insert into public.content_card_versions (
    card_id, version, player_id, variant_id, ovr, combat, stats, stat_boost,
    rarity_rank, rarity_bucket, data_version, source, generated_at, checksum,
    effective_from, effective_to, created_by, reason)
  values (
    v_id, 1, v_player, v_variant,
    (p_def->>'ovr')::int, p_def->'combat', p_def->'stats', (p_def->>'stat_boost')::int,
    (p_def->>'rarity_rank')::int, p_def->>'rarity_bucket',
    p_def->>'data_version', p_def->>'source', (p_def->>'generated_at')::timestamptz,
    p_def->>'checksum', v_now, null, p_actor, null);

  perform public._audit('create_card', v_id, null, p_actor,
    jsonb_build_object('reason', p_reason, 'source', p_def->>'source', 'ovr', p_def->>'ovr'));

  -- Una carta en DRAFT no entra en el catálogo servido, pero SÍ cambia el conjunto de
  -- filas: el latido mantiene coherente la huella y evita que un proceso crea que su copia
  -- sigue describiendo la base.
  return jsonb_build_object('cardId', v_id, 'lifecycle', 'DRAFT', 'version', 1,
                            'catalogVersion', public._bump_catalog());
end; $fn$;

-- ----------------------------------------------------------------------------
-- 3. EDICIÓN EN SITIO — Y SOLO MIENTRAS ES BORRADOR
-- ----------------------------------------------------------------------------
--
-- Esta es la frontera que 8.2 definió y que este bloque tiene que respetar sin excepciones:
--
--   DRAFT      se edita EN SITIO. No hay nadie a quien proteger: la carta no está en el
--              juego, nadie la posee y su versión 1 todavía no describe nada repartido.
--   PUBLISHED  NO se edita en sitio. Cambiar lo que afecta al juego exige
--              `app_content_publish_version`, que crea una versión nueva y deja intacta la
--              anterior — que es la que tienen los ejemplares ya acuñados.
--   RETIRED    igual que PUBLISHED. Retirada no es borrable ni editable: sus ejemplares
--              siguen en manos de gente.
--
-- La función se NIEGA en cualquier estado que no sea DRAFT en vez de "hacer lo correcto
-- según el estado": una única puerta por regla es lo que hace imposible el `UPDATE`
-- destructivo silencioso.
--
-- CONCURRENCIA: `p_expected_version` es el `definition_version` que el administrador tenía
-- en pantalla. Si otro lo ha tocado entretanto, esto falla en vez de sobrescribirlo.
create or replace function public.app_content_update_draft(
  p_card_id text, p_patch jsonb, p_reason text, p_actor uuid, p_expected_version int default null)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_card public.content_cards; v_now timestamptz := now();
begin
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'Una edicion necesita motivo' using errcode = 'P0001';
  end if;

  select * into v_card from public.content_cards where card_id = p_card_id for update;
  if v_card.card_id is null then
    raise exception 'Carta no encontrada: %', p_card_id using errcode = 'P0001';
  end if;
  if v_card.lifecycle <> 'DRAFT' then
    raise exception 'Solo se edita en sitio un borrador. % esta en %: publica una version nueva',
      p_card_id, v_card.lifecycle using errcode = 'P0001';
  end if;
  if p_expected_version is not null and p_expected_version <> v_card.definition_version then
    raise exception 'La carta ha cambiado mientras la editabas (esperabas v%, hay v%)',
      p_expected_version, v_card.definition_version using errcode = 'P0001';
  end if;

  update public.content_cards
     set ovr           = coalesce((p_patch->>'ovr')::int, ovr),
         combat        = coalesce(p_patch->'combat', combat),
         stats         = coalesce(p_patch->'stats', stats),
         stat_boost    = coalesce((p_patch->>'stat_boost')::int, stat_boost),
         rarity_rank   = coalesce((p_patch->>'rarity_rank')::int, rarity_rank),
         rarity_bucket = coalesce(p_patch->>'rarity_bucket', rarity_bucket),
         source        = coalesce(p_patch->>'source', source),
         checksum      = coalesce(p_patch->>'checksum', checksum),
         updated_at    = v_now
   where card_id = p_card_id;

  /*
   * La versión 1 de un borrador se reescribe con él, y es la ÚNICA excepción legítima a la
   * inmutabilidad del histórico: mientras la carta es borrador, esa versión no describe
   * nada que nadie tenga. El trigger de 0038 la protegería, así que se desactiva para esta
   * sentencia y solo para ella — `session_replication_role` afecta a esta transacción.
   *
   * La comprobación de que esto NO puede tocar una versión con ejemplares acuñados la hace
   * la guarda de arriba: si la carta no está en DRAFT, no se llega hasta aquí.
   */
  set local session_replication_role = replica;
  update public.content_card_versions ccv
     set ovr           = cc.ovr,
         combat        = cc.combat,
         stats         = cc.stats,
         stat_boost    = cc.stat_boost,
         rarity_rank   = cc.rarity_rank,
         rarity_bucket = cc.rarity_bucket,
         source        = cc.source,
         checksum      = cc.checksum
    from public.content_cards cc
   where ccv.card_id = p_card_id and ccv.version = 1 and cc.card_id = p_card_id;
  set local session_replication_role = origin;

  perform public._audit('update_draft', p_card_id, null, p_actor,
    jsonb_build_object('reason', p_reason, 'patch', p_patch));

  return jsonb_build_object('cardId', p_card_id, 'lifecycle', 'DRAFT',
                            'catalogVersion', public._bump_catalog());
end; $fn$;

-- ----------------------------------------------------------------------------
-- 4. D-1b — EL ANCLA DEL MERCADO, POR VERSIÓN
-- ----------------------------------------------------------------------------
--
-- Tabla propia del plano de contenido. No toca `card_reference` (§0) ni sus vistas.
--
-- La escribe el servidor con `marketValue()` —la MISMA función de `domain/economy/pricing`
-- que usa el mercado—, nunca una fórmula reimplementada en SQL. Este proyecto ya tropezó
-- dos veces con tener la misma cuenta escrita en dos sitios; no habrá una tercera.
create table if not exists public.content_card_market_anchor (
  card_id     text not null references public.content_cards(card_id) on delete cascade,
  version     int  not null check (version >= 1),
  fair_value  bigint not null check (fair_value > 0),
  ovr         int  not null,
  rarity_rank int  not null,
  updated_at  timestamptz not null default now(),
  primary key (card_id, version)
);

/**
 * Ancla de precio de un EJEMPLAR concreto.
 *
 * El orden de preferencia es el mismo de `_price_anchor` y por los mismos motivos; lo único
 * que cambia es que el segundo escalón sabe de qué versión se está hablando:
 *
 *   1º  card_price_stats.avg_price                  lo que la carta ha trado (ver D-1c)
 *   2º  content_card_market_anchor (card, VERSIÓN)  el valor de ESA versión
 *   3º  card_reference.fair_value                   el ancla heredada, por si no hay (2)
 */
create or replace function public._price_anchor_versioned(p_card_id text, p_version int)
returns bigint language sql stable security definer set search_path = public as $fn$
  select coalesce(
    (select avg_price  from public.card_price_stats where card_id = p_card_id),
    (select fair_value from public.content_card_market_anchor
      where card_id = p_card_id and version = p_version),
    (select fair_value from public.card_reference   where card_id = p_card_id)
  );
$fn$;

-- La banda: MISMA fórmula, MISMOS multiplicadores, MISMA marca en `market_flags`, MISMO
-- mensaje de error. Lo único distinto es de dónde sale el ancla.
create or replace function public._market_check_band(
  p_user uuid, p_card_id text, p_price bigint, p_version int default null)
returns void language plpgsql security definer set search_path = public as $fn$
declare v_anchor bigint; v_cfg public.market_config; v_lo bigint; v_hi bigint;
begin
  select * into v_cfg from public.market_config where id = 'default';
  v_anchor := public._price_anchor_versioned(p_card_id, p_version);
  if v_anchor is not null and v_anchor > 0 then
    v_lo := floor(v_anchor * v_cfg.min_price_mult);
    v_hi := ceil (v_anchor * v_cfg.max_price_mult);
    if p_price < v_lo or p_price > v_hi then
      insert into public.market_flags (user_id, kind, severity, card_id, detail)
        values (p_user, 'price_out_of_band', 'block', p_card_id,
                jsonb_build_object('price', p_price, 'anchor', v_anchor, 'lo', v_lo, 'hi', v_hi,
                                   'version', p_version));
      raise exception 'Precio fuera de banda (ancla ~%). Permitido entre % y %', v_anchor, v_lo, v_hi
        using errcode = 'P0001';
    end if;
  end if;
end; $fn$;

/*
 * `app_market_list` YA tenía el ejemplar en la mano (`v_card`) y tiraba su versión al
 * llamar a la banda. Se redefine ENTERA —`create or replace` no admite parches— cambiando
 * exactamente una línea: la llamada ahora lleva `v_card.minted_version`. Todo lo demás
 * (idempotencia, precio mínimo, techo, límite de frecuencia, bloqueo del ejemplar, depósito
 * en garantía, auditoría) es literalmente el cuerpo de 0020 §3.
 */
create or replace function public.app_market_list(
  p_user uuid, p_card_uid uuid, p_price bigint, p_ref text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_card public.user_cards; v_cfg public.market_config; v_listing uuid; v_prev jsonb;
begin
  if p_ref is null or length(p_ref) = 0 then
    raise exception 'Publicar necesita clave de idempotencia';
  end if;
  select result into v_prev from public.economy_ops where ref = p_ref;
  if v_prev is not null then return v_prev || jsonb_build_object('repeated', true); end if;

  select * into v_cfg from public.market_config where id = 'default';
  if p_price is null or p_price < v_cfg.min_price then
    raise exception 'El precio minimo es %', v_cfg.min_price using errcode = 'P0001';
  end if;
  if p_price > 100000000 then
    raise exception 'Precio no admitido' using errcode = 'P0001';
  end if;

  perform public._market_check_rate(p_user, 'list', v_cfg.max_listings_per_hour);

  select * into v_card from public.user_cards where uid = p_card_uid for update;
  if v_card.uid is null or v_card.user_id <> p_user then
    raise exception 'No posees esa carta' using errcode = 'P0001';
  end if;
  if v_card.locked then
    raise exception 'Esa carta ya esta en venta' using errcode = 'P0001';
  end if;

  -- D-1b: la banda se ancla en la versión bajo la que se acuñó ESTE ejemplar.
  perform public._market_check_band(p_user, v_card.card_id, p_price, v_card.minted_version);

  update public.user_cards set locked = true where uid = p_card_uid;

  insert into public.market_listings (seller_id, card_id, serial, card_uid, price, status, updated_at)
  values (p_user, v_card.card_id, v_card.serial, p_card_uid, p_price, 'active', now())
  returning id into v_listing;

  insert into public.market_audit (user_id, action, card_id, listing_id, price)
  values (p_user, 'list', v_card.card_id, v_listing, p_price);

  v_prev := jsonb_build_object('listingId', v_listing, 'cardId', v_card.card_id, 'price', p_price);
  insert into public.economy_ops (ref, user_id, kind, result) values (p_ref, p_user, 'market_list', v_prev);
  return v_prev;
end; $fn$;

-- ----------------------------------------------------------------------------
-- 5. SEGURIDAD
-- ----------------------------------------------------------------------------
alter table public.content_audit_log           enable row level security;
alter table public.content_card_market_anchor  enable row level security;
revoke all on public.content_audit_log          from anon, authenticated;
revoke all on public.content_card_market_anchor from anon, authenticated;

revoke all on function public.app_content_create_card(jsonb, text, uuid)                    from public, anon, authenticated;
revoke all on function public.app_content_update_draft(text, jsonb, text, uuid, int)        from public, anon, authenticated;
revoke all on function public._audit(text, text, text, uuid, jsonb)                         from public, anon, authenticated;
revoke all on function public._price_anchor_versioned(text, int)                            from public, anon, authenticated;
revoke all on function public._market_check_band(uuid, text, bigint, int)                   from public, anon, authenticated;

grant execute on function public.app_content_create_card(jsonb, text, uuid)             to service_role;
grant execute on function public.app_content_update_draft(text, jsonb, text, uuid, int) to service_role;

comment on table public.content_audit_log is
  'Bloque 8.4.1 — quien creo, edito, publico o retiro contenido, y cuando. Solo el id del '
  'actor; ningun dato personal.';
comment on table public.content_card_market_anchor is
  'Bloque 8.4.1 (D-1b) — valor de catalogo POR VERSION. Lo escribe el servidor con '
  'marketValue(); la banda antifraude lo usa para anclar el ejemplar que se vende.';

-- ----------------------------------------------------------------------------
-- 6. LAS DOS RPC DE 8.2, CON AUDITORÍA DENTRO
-- ----------------------------------------------------------------------------
--
-- Tercera y última definición de estas dos funciones: 0038 §6 las creó, 0039 §9 les añadió
-- el latido del catálogo, y aquí entra el registro de auditoría. Se deja constancia porque
-- tres `create or replace` de la misma función repartidos por tres migraciones son
-- exactamente el tipo de cosa que hay que poder rastrear.
--
-- **La auditoría va DENTRO y no en la ruta**, y el motivo importa: desde la ruta sería una
-- segunda petición, fuera de la transacción, que podría fallar y dejar el cambio hecho sin
-- rastro. Aquí o se escriben las dos cosas o no se escribe ninguna. Y `_audit` no necesita
-- estar concedida a `service_role`: la llama una función `security definer` cuyo propietario
-- sí puede.
create or replace function public.app_content_publish_version(
  p_card_id text, p_patch jsonb, p_reason text, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  v_cur public.content_card_versions;
  v_card public.content_cards;
  v_next int;
  v_now timestamptz := now();
  v_ovr int; v_combat jsonb; v_stats jsonb; v_boost int;
  v_rank int; v_bucket text; v_checksum text;
begin
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'Una version nueva necesita motivo' using errcode = 'P0001';
  end if;

  select * into v_card from public.content_cards where card_id = p_card_id for update;
  if v_card.card_id is null then
    raise exception 'Carta no encontrada: %', p_card_id using errcode = 'P0001';
  end if;
  if v_card.lifecycle in ('ARCHIVED','REJECTED') then
    raise exception 'No se puede versionar una carta en estado %', v_card.lifecycle using errcode = 'P0001';
  end if;

  select * into v_cur from public.content_card_versions
   where card_id = p_card_id and effective_to is null;
  if v_cur.card_id is null then
    raise exception 'La carta % no tiene version vigente', p_card_id using errcode = 'P0001';
  end if;

  v_ovr    := coalesce((p_patch->>'ovr')::int, v_cur.ovr);
  v_combat := coalesce(p_patch->'combat', v_cur.combat);
  v_stats  := coalesce(p_patch->'stats',  v_cur.stats);
  v_boost  := coalesce((p_patch->>'stat_boost')::int, v_cur.stat_boost);
  v_rank   := coalesce((p_patch->>'rarity_rank')::int, v_cur.rarity_rank);
  v_bucket := coalesce(p_patch->>'rarity_bucket', v_cur.rarity_bucket);
  v_checksum := coalesce(p_patch->>'checksum', '');

  v_next := v_cur.version + 1;

  update public.content_card_versions
     set effective_to = v_now
   where card_id = p_card_id and version = v_cur.version;

  insert into public.content_card_versions (
    card_id, version, player_id, variant_id, ovr, combat, stats, stat_boost,
    rarity_rank, rarity_bucket, data_version, source, generated_at, checksum,
    effective_from, effective_to, created_by, reason)
  values (
    p_card_id, v_next, v_cur.player_id, v_cur.variant_id, v_ovr, v_combat, v_stats, v_boost,
    v_rank, v_bucket, v_cur.data_version, v_cur.source, v_cur.generated_at, v_checksum,
    v_now, null, p_actor, p_reason);

  update public.content_cards
     set ovr = v_ovr, combat = v_combat, stats = v_stats, stat_boost = v_boost,
         rarity_rank = v_rank, rarity_bucket = v_bucket,
         definition_version = v_next, checksum = v_checksum, updated_at = v_now
   where card_id = p_card_id;

  perform public._audit('publish_version', p_card_id, null, p_actor,
    jsonb_build_object('from', v_cur.version, 'to', v_next, 'reason', p_reason,
                       'ovr', jsonb_build_array(v_cur.ovr, v_ovr)));

  return jsonb_build_object('cardId', p_card_id, 'version', v_next, 'previous', v_cur.version,
                            'catalogVersion', public._bump_catalog());
end; $fn$;

create or replace function public.app_content_set_lifecycle(
  p_card_id text, p_state text, p_reason text, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_card public.content_cards; v_ok boolean; v_now timestamptz := now();
begin
  select * into v_card from public.content_cards where card_id = p_card_id for update;
  if v_card.card_id is null then
    raise exception 'Carta no encontrada: %', p_card_id using errcode = 'P0001';
  end if;

  v_ok := case v_card.lifecycle
    when 'DRAFT'     then p_state in ('REVIEW','APPROVED','PUBLISHED','ARCHIVED')
    when 'REVIEW'    then p_state in ('APPROVED','REJECTED','DRAFT')
    when 'APPROVED'  then p_state in ('PUBLISHED','DRAFT')
    when 'PUBLISHED' then p_state in ('RETIRED')
    when 'RETIRED'   then p_state in ('PUBLISHED','ARCHIVED')
    when 'ARCHIVED'  then p_state in ('DRAFT')
    when 'REJECTED'  then p_state in ('DRAFT')
    else false end;

  if not v_ok then
    raise exception 'Transicion ilegal: % -> %', v_card.lifecycle, p_state using errcode = 'P0001';
  end if;

  if p_state = 'ARCHIVED'
     and exists (select 1 from public.user_cards where card_id = p_card_id) then
    raise exception 'No se puede archivar una carta con ejemplares en manos de jugadores; usa RETIRED'
      using errcode = 'P0001';
  end if;

  update public.content_cards
     set lifecycle = p_state,
         published_at = case when p_state = 'PUBLISHED' then coalesce(published_at, v_now) else published_at end,
         retired_at   = case when p_state = 'RETIRED'   then v_now
                             when p_state = 'PUBLISHED' then null
                             else retired_at end,
         updated_at = v_now
   where card_id = p_card_id;

  perform public._audit('set_lifecycle', p_card_id, null, p_actor,
    jsonb_build_object('from', v_card.lifecycle, 'to', p_state, 'reason', p_reason));

  return jsonb_build_object('cardId', p_card_id, 'from', v_card.lifecycle, 'to', p_state,
                            'reason', p_reason, 'actor', p_actor,
                            'catalogVersion', public._bump_catalog());
end; $fn$;

-- ----------------------------------------------------------------------------
-- 7. CONCURRENCIA REAL: LA COMPROBACIÓN VA DENTRO DE LA TRANSACCIÓN
-- ----------------------------------------------------------------------------
--
-- ENCONTRADO POR LA VERIFICACIÓN DE ESTE BLOQUE.
--
-- La ruta comprobaba `expectedVersion` leyendo la fila ANTES de llamar a la RPC. Eso
-- protege del caso lento —A publica, B lo intenta un minuto después— pero no del
-- simultáneo: si A y B leen la versión a la vez, los dos pasan la comprobación, y como la
-- RPC toma `for update` se serializan y **las dos publicaciones salen adelante**. No hay
-- corrupción —el índice único parcial garantiza una sola versión vigente— pero B ha
-- encadenado su edición sobre una base que nunca vio, que es exactamente lo que el encargo
-- pide evitar.
--
-- La comprobación se mueve DENTRO, después del `for update`. A partir de ahí, leer y decidir
-- ocurren bajo el mismo cerrojo: cuando B entra, ya ve la versión de A y se niega.
--
-- `p_expected_version` es opcional para no romper a ningún llamante existente; la ruta lo
-- envía siempre.
-- Y la version de 0038 y del §6 SE RETIRA. Anadir un parametro con valor por defecto no
-- sustituye a la funcion anterior: crea una SEGUNDA con otra firma. A partir de ahi PostgREST
-- recibe cuatro argumentos con nombre y no sabe a cual de las dos se refiere: 'could not
-- choose the best candidate function'. Lo destapo `content-version:verify`, que llama con los
-- cuatro de siempre y dejo de funcionar de golpe. Con una sola funcion no hay ambiguedad, y
-- quien llame con cuatro argumentos recibe el `null` por defecto: el comportamiento de antes.
drop function if exists public.app_content_publish_version(text, jsonb, text, uuid);

create or replace function public.app_content_publish_version(
  p_card_id text, p_patch jsonb, p_reason text, p_actor uuid, p_expected_version int default null)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  v_cur public.content_card_versions;
  v_card public.content_cards;
  v_next int;
  v_now timestamptz := now();
  v_ovr int; v_combat jsonb; v_stats jsonb; v_boost int;
  v_rank int; v_bucket text; v_checksum text;
begin
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'Una version nueva necesita motivo' using errcode = 'P0001';
  end if;

  select * into v_card from public.content_cards where card_id = p_card_id for update;
  if v_card.card_id is null then
    raise exception 'Carta no encontrada: %', p_card_id using errcode = 'P0001';
  end if;
  if v_card.lifecycle in ('ARCHIVED','REJECTED') then
    raise exception 'No se puede versionar una carta en estado %', v_card.lifecycle using errcode = 'P0001';
  end if;

  -- Bajo el cerrojo: aqui ya no hay ventana entre leer y decidir.
  if p_expected_version is not null and p_expected_version <> v_card.definition_version then
    raise exception 'La carta ha cambiado mientras la editabas (esperabas v%, hay v%)',
      p_expected_version, v_card.definition_version using errcode = 'P0001';
  end if;

  select * into v_cur from public.content_card_versions
   where card_id = p_card_id and effective_to is null;
  if v_cur.card_id is null then
    raise exception 'La carta % no tiene version vigente', p_card_id using errcode = 'P0001';
  end if;

  v_ovr    := coalesce((p_patch->>'ovr')::int, v_cur.ovr);
  v_combat := coalesce(p_patch->'combat', v_cur.combat);
  v_stats  := coalesce(p_patch->'stats',  v_cur.stats);
  v_boost  := coalesce((p_patch->>'stat_boost')::int, v_cur.stat_boost);
  v_rank   := coalesce((p_patch->>'rarity_rank')::int, v_cur.rarity_rank);
  v_bucket := coalesce(p_patch->>'rarity_bucket', v_cur.rarity_bucket);
  v_checksum := coalesce(p_patch->>'checksum', '');

  v_next := v_cur.version + 1;

  update public.content_card_versions
     set effective_to = v_now
   where card_id = p_card_id and version = v_cur.version;

  insert into public.content_card_versions (
    card_id, version, player_id, variant_id, ovr, combat, stats, stat_boost,
    rarity_rank, rarity_bucket, data_version, source, generated_at, checksum,
    effective_from, effective_to, created_by, reason)
  values (
    p_card_id, v_next, v_cur.player_id, v_cur.variant_id, v_ovr, v_combat, v_stats, v_boost,
    v_rank, v_bucket, v_cur.data_version, v_cur.source, v_cur.generated_at, v_checksum,
    v_now, null, p_actor, p_reason);

  update public.content_cards
     set ovr = v_ovr, combat = v_combat, stats = v_stats, stat_boost = v_boost,
         rarity_rank = v_rank, rarity_bucket = v_bucket,
         definition_version = v_next, checksum = v_checksum, updated_at = v_now
   where card_id = p_card_id;

  perform public._audit('publish_version', p_card_id, null, p_actor,
    jsonb_build_object('from', v_cur.version, 'to', v_next, 'reason', p_reason,
                       'ovr', jsonb_build_array(v_cur.ovr, v_ovr)));

  return jsonb_build_object('cardId', p_card_id, 'version', v_next, 'previous', v_cur.version,
                            'catalogVersion', public._bump_catalog());
end; $fn$;

revoke all on function public.app_content_publish_version(text, jsonb, text, uuid, int) from public, anon, authenticated;
grant execute on function public.app_content_publish_version(text, jsonb, text, uuid, int) to service_role;

-- ----------------------------------------------------------------------------
-- 8. EL BORRADO DEFINITIVO TAMBIÉN TIENE QUE AVISAR A LA CACHÉ
-- ----------------------------------------------------------------------------
--
-- ENCONTRADO POR LA QA DE ESTE BLOQUE.
--
-- 0039 §9 arregló el agujero de 8.2 —publicar y cambiar de estado no subían
-- `content_catalog_version`, así que el servidor seguía sirviendo la definición vieja— pero
-- lo arregló sólo en esas dos RPC. `app_content_purge_card` se quedó fuera, y tiene el mismo
-- problema al revés: la carta desaparece de la base y el servidor la sigue teniendo en
-- memoria, porque su caché sólo se recarga cuando la versión sube.
--
-- No es alcanzable desde el panel —purgar es una herramienta del migrador y de las
-- verificaciones, y sólo funciona sobre cartas SIN historia— pero el fallo es del mismo tipo
-- que el ya corregido, y dejarlo a medias sería dejar la trampa puesta para el siguiente.
--
-- SEGUNDO FALLO, en la misma llamada: purgar borraba las dos tablas de contenido y se dejaba
-- `card_reference`. Esa fila la escribe el panel al crear la carta (§D-1: el mercado necesita
-- un valor de referencia), asi que al purgar quedaba apuntando a una carta inexistente. Lo
-- delato `v_content_card_orphans`, la vista que 8.1 creo justo para esto, con una fila que no
-- deberia haber estado ahi. Se limpia tambien.
create or replace function public.app_content_purge_card(p_card_id text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_inst int; v_mint int; v_list int;
begin
  select count(*) into v_inst from public.user_cards      where card_id = p_card_id;
  select count(*) into v_mint from public.card_mints      where card_id = p_card_id;
  select count(*) into v_list from public.market_listings where card_id = p_card_id;
  if v_inst > 0 or v_mint > 0 or v_list > 0 then
    raise exception 'La carta % tiene historia (% ejemplares, % acuñaciones, % listados): se retira, no se borra',
      p_card_id, v_inst, v_mint, v_list using errcode = 'P0001';
  end if;

  -- El puntero se suelta primero; si no, la clave ajena impide borrar la versión vigente.
  update public.content_cards set definition_version = 1 where card_id = p_card_id;
  delete from public.content_card_versions where card_id = p_card_id;
  delete from public.content_cards where card_id = p_card_id;
  delete from public.card_reference where card_id = p_card_id;

  return jsonb_build_object('cardId', p_card_id, 'purged', true,
                            'catalogVersion', public._bump_catalog());
end; $fn$;

revoke all on function public.app_content_purge_card(text) from public, anon, authenticated;
grant execute on function public.app_content_purge_card(text) to service_role;

-- ----------------------------------------------------------------------------
-- 9. UN CENTINELA CONTRA LAS FIRMAS DUPLICADAS
-- ----------------------------------------------------------------------------
--
-- El §7 de esta misma migracion cayo en la trampa: `create or replace function` con un
-- parametro de mas no reemplaza nada, crea una funcion nueva y deja la vieja viva. Con las
-- dos presentes PostgREST recibe una llamada con argumentos con nombre y contesta «could not
-- choose the best candidate function» — es decir, la RPC deja de funcionar entera, y solo
-- para los llamantes que usan la firma antigua.
--
-- Esta vista no arregla nada: hace que se vea. `admin-cards:verify` la consulta y falla si
-- alguna vez vuelve a haber dos.
create or replace view public.v_content_rpc_overloads as
  select p.proname,
         count(*) as n,
         string_agg(pg_get_function_identity_arguments(p.oid), ' ; ' order by p.oid) as firmas
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname like 'app_content\_%'
   group by p.proname
  having count(*) > 1;

alter view public.v_content_rpc_overloads set (security_invoker = true);
revoke all on public.v_content_rpc_overloads from anon, authenticated;
grant select on public.v_content_rpc_overloads to service_role;

comment on view public.v_content_rpc_overloads is
  'Bloque 8.4.1 - RPC de contenido con mas de una firma. Cero filas es lo correcto: dos '
  'firmas rompen la resolucion de PostgREST por argumentos con nombre.';
