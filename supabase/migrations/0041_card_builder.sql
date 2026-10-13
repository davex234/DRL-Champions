-- ============================================================================
-- 0041 — CARD BUILDER: LA FILA QUE SE GUARDA ES LA QUE EL SERVIDOR DERIVÓ
-- ============================================================================
--
-- Bloque 8.4.2.
--
-- ────────────────────────── QUÉ SE ARREGLA, Y CÓMO SE ENCONTRÓ ──────────────────────────
--
-- La auditoría de este bloque llamó a la API real contra el servidor en marcha y midió tres
-- cosas que no deberían haber sido posibles:
--
--   1. `publish` con `{ "ovr": 99 }` y sin tocar el trío guardó 99 sobre un trío de 84/80/65.
--      Ninguna función del dominio produce ese 99. Y de ahí pasó al ancla del mercado:
--      `fair_value` 127.775 calculado sobre una cifra inventada.
--   2. `publish` con `{ "combat": { "stronghold": 500, "gamesense": -20 } }` guardó 500 y -20.
--      La escala del dominio es 0-99 y `combat` es `jsonb` sin ninguna restricción.
--   3. Al publicar, `checksum` quedaba en CADENA VACÍA, porque esta función hacía
--      `coalesce(p_patch->>'checksum', '')` y la ruta nunca lo enviaba. La versión 1 de una
--      carta llevaba su huella; la 2 y siguientes, nada.
--
-- El (3) es el más silencioso de los tres y el que más lejos llega: `content-catalog:verify`
-- afirma «checksum de cada fila = huella de la carta generada», así que la primera
-- publicación de una versión sobre una carta del generador habría roto esa verificación sin
-- que nada lo avisara antes.
--
-- ────────────────────────── LA REGLA NUEVA ──────────────────────────
--
-- La capa TypeScript deriva la fila entera con `deriveDefinition()` —las mismas funciones que
-- construyen el catálogo desde el bloque 1— y la envía completa. Estas dos funciones dejan de
-- rellenar huecos:
--
--   · `checksum` es OBLIGATORIO y no puede venir vacío. Sin él, la fila no describe nada
--     comprobable, así que se rechaza en vez de guardarse a medias.
--   · `data_version` y `generated_at` se escriben también. Entran en la huella: si la fila los
--     conservara viejos mientras la huella se calculó con otros, el checksum sería mentira.
--   · `combat` pasa a tener una restricción de forma y de rango EN LA BASE. La validación de
--     la ruta es la primera puerta; esta es la que no se puede rodear llamando a la RPC.
--
-- Nada de esto es una comprobación duplicada por desconfianza: la ruta valida para poder dar
-- un mensaje útil, y la base valida porque es el último sitio donde el dato todavía se puede
-- rechazar.

-- ----------------------------------------------------------------------------
-- 1. EL TRÍO, CON FORMA Y RANGO
-- ----------------------------------------------------------------------------
--
-- `content_cards.combat` y `content_card_versions.combat` son `jsonb` desde 0037 y aceptaban
-- literalmente cualquier cosa. Se declara aquí lo que el dominio ya decía en TypeScript.
create or replace function public._combat_valido(c jsonb)
returns boolean language sql immutable as $fn$
  select c is not null
     and jsonb_typeof(c) = 'object'
     and (select bool_and(
            c ? k
            and jsonb_typeof(c->k) = 'number'
            and (c->>k)::numeric = floor((c->>k)::numeric)
            and (c->>k)::numeric between 0 and 99)
          from unnest(array['stronghold','gamesense','entryfrag']) k);
$fn$;

comment on function public._combat_valido(jsonb) is
  'Bloque 8.4.2 - un trio de combate valido: tres enteros de 0 a 99. La escala la fija '
  'domain/cards/combat.ts; esto es la misma regla donde ya no se puede esquivar.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'content_cards_combat_valido') then
    alter table public.content_cards
      add constraint content_cards_combat_valido check (public._combat_valido(combat));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'content_card_versions_combat_valido') then
    alter table public.content_card_versions
      add constraint content_card_versions_combat_valido check (public._combat_valido(combat));
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 2. PUBLICAR UNA VERSIÓN — la fila completa, con su huella
-- ----------------------------------------------------------------------------
create or replace function public.app_content_publish_version(
  p_card_id text, p_patch jsonb, p_reason text, p_actor uuid, p_expected_version int default null)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  v_cur public.content_card_versions;
  v_card public.content_cards;
  v_next int;
  v_now timestamptz := now();
  v_ovr int; v_combat jsonb; v_stats jsonb; v_boost int;
  v_rank int; v_bucket text; v_checksum text; v_source text;
  v_dataver text; v_genat text;
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

  -- Bajo el cerrojo: aqui ya no hay ventana entre leer y decidir (8.4.1 §7).
  if p_expected_version is not null and p_expected_version <> v_card.definition_version then
    raise exception 'La carta ha cambiado mientras la editabas (esperabas v%, hay v%)',
      p_expected_version, v_card.definition_version using errcode = 'P0001';
  end if;

  select * into v_cur from public.content_card_versions
   where card_id = p_card_id and effective_to is null;
  if v_cur.card_id is null then
    raise exception 'La carta % no tiene version vigente', p_card_id using errcode = 'P0001';
  end if;

  /*
   * LA HUELLA ES OBLIGATORIA.
   *
   * Antes esto era `coalesce(p_patch->>'checksum', '')`, y como la ruta no la enviaba, toda
   * version publicada nacia sin huella. Una fila sin checksum no se puede comprobar contra
   * nada: no es un campo cosmetico, es lo que permite afirmar que el catalogo persistido es
   * el que dice ser. Si no llega, esto se para.
   */
  v_checksum := p_patch->>'checksum';
  if v_checksum is null or length(btrim(v_checksum)) = 0 then
    raise exception 'Falta el checksum: la fila la deriva y la firma el servidor'
      using errcode = 'P0001';
  end if;

  v_ovr    := coalesce((p_patch->>'ovr')::int, v_cur.ovr);
  v_combat := coalesce(p_patch->'combat', v_cur.combat);
  v_stats  := coalesce(p_patch->'stats',  v_cur.stats);
  v_boost  := coalesce((p_patch->>'stat_boost')::int, v_cur.stat_boost);
  v_rank   := coalesce((p_patch->>'rarity_rank')::int, v_cur.rarity_rank);
  v_bucket := coalesce(p_patch->>'rarity_bucket', v_cur.rarity_bucket);
  v_source := coalesce(p_patch->>'source', v_cur.source);
  -- Entran en la huella: si la fila los conservara viejos, el checksum seria mentira.
  v_dataver := coalesce(p_patch->>'data_version', v_cur.data_version);
  v_genat   := coalesce(p_patch->>'generated_at', v_cur.generated_at::text);

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
    v_rank, v_bucket, v_dataver, v_source, v_genat::timestamptz, v_checksum,
    v_now, null, p_actor, p_reason);

  update public.content_cards
     set ovr = v_ovr, combat = v_combat, stats = v_stats, stat_boost = v_boost,
         rarity_rank = v_rank, rarity_bucket = v_bucket, source = v_source,
         data_version = v_dataver, generated_at = v_genat::timestamptz,
         definition_version = v_next, checksum = v_checksum, updated_at = v_now
   where card_id = p_card_id;

  perform public._audit('publish_version', p_card_id, null, p_actor,
    jsonb_build_object('from', v_cur.version, 'to', v_next, 'reason', p_reason,
                       'ovr', jsonb_build_array(v_cur.ovr, v_ovr),
                       'source', jsonb_build_array(v_cur.source, v_source)));

  return jsonb_build_object('cardId', p_card_id, 'version', v_next, 'previous', v_cur.version,
                            'catalogVersion', public._bump_catalog());
end; $fn$;

revoke all on function public.app_content_publish_version(text, jsonb, text, uuid, int) from public, anon, authenticated;
grant execute on function public.app_content_publish_version(text, jsonb, text, uuid, int) to service_role;

-- ----------------------------------------------------------------------------
-- 3. EDITAR UN BORRADOR — mismo trato
-- ----------------------------------------------------------------------------
create or replace function public.app_content_update_draft(
  p_card_id text, p_patch jsonb, p_reason text, p_actor uuid, p_expected_version int default null)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_card public.content_cards; v_now timestamptz := now(); v_checksum text;
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

  -- Misma exigencia que al publicar, y por el mismo motivo: antes esto hacia
  -- `coalesce(p_patch->>'checksum', checksum)`, asi que editar un borrador dejaba la huella
  -- ANTERIOR sobre un contenido nuevo. Es peor que no tener huella: es tener una que miente.
  v_checksum := p_patch->>'checksum';
  if v_checksum is null or length(btrim(v_checksum)) = 0 then
    raise exception 'Falta el checksum: la fila la deriva y la firma el servidor'
      using errcode = 'P0001';
  end if;

  update public.content_cards
     set ovr           = coalesce((p_patch->>'ovr')::int, ovr),
         combat        = coalesce(p_patch->'combat', combat),
         stats         = coalesce(p_patch->'stats', stats),
         stat_boost    = coalesce((p_patch->>'stat_boost')::int, stat_boost),
         rarity_rank   = coalesce((p_patch->>'rarity_rank')::int, rarity_rank),
         rarity_bucket = coalesce(p_patch->>'rarity_bucket', rarity_bucket),
         source        = coalesce(p_patch->>'source', source),
         data_version  = coalesce(p_patch->>'data_version', data_version),
         generated_at  = coalesce((p_patch->>'generated_at')::timestamptz, generated_at),
         checksum      = v_checksum,
         updated_at    = v_now
   where card_id = p_card_id;

  /*
   * La version 1 de un borrador se reescribe con el, y es la UNICA excepcion legitima a la
   * inmutabilidad del historico: mientras la carta es borrador, esa version no describe nada
   * que nadie tenga. El trigger de 0038 la protegeria, asi que se desactiva para esta
   * sentencia y solo para ella -- `session_replication_role` afecta a esta transaccion.
   *
   * La comprobacion de que esto NO puede tocar una version con ejemplares acunados la hace la
   * guarda de arriba: si la carta no esta en DRAFT, no se llega hasta aqui.
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
         data_version  = cc.data_version,
         generated_at  = cc.generated_at,
         checksum      = cc.checksum
    from public.content_cards cc
   where ccv.card_id = p_card_id and ccv.version = 1 and cc.card_id = p_card_id;
  set local session_replication_role = origin;

  perform public._audit('update_draft', p_card_id, null, p_actor,
    jsonb_build_object('reason', p_reason,
                       'ovr', jsonb_build_array(v_card.ovr, (p_patch->>'ovr')::int),
                       'combat', p_patch->'combat'));

  return jsonb_build_object('cardId', p_card_id, 'lifecycle', 'DRAFT',
                            'catalogVersion', public._bump_catalog());
end; $fn$;

revoke all on function public.app_content_update_draft(text, jsonb, text, uuid, int) from public, anon, authenticated;
grant execute on function public.app_content_update_draft(text, jsonb, text, uuid, int) to service_role;

-- ----------------------------------------------------------------------------
-- 4. QUÉ CARTAS SIGUEN SIENDO EXACTAMENTE LAS QUE GENERA EL CÓDIGO
-- ----------------------------------------------------------------------------
--
-- 8.1 podía afirmar «lo persistido es exactamente lo que produce el generador» porque nada
-- podía editarlo. Desde que existe un panel que edita, esa frase hay que enunciarla sobre el
-- conjunto correcto, y la frontera no es una opinión: es `definition_version`.
--
--   · v1  → nadie ha versionado esta carta. Sigue siendo, byte a byte, la generada.
--   · v>1 → alguien la editó a propósito, con motivo y con actor en el diario. Su versión 1
--           SIGUE siendo la generada, porque el histórico es inmutable.
--
-- Es decir: la garantía no se debilita, se enuncia mejor. Y de paso queda comprobable de un
-- vistazo cuántas cartas del generador ha tocado una persona.
create or replace view public.v_content_cards_editadas as
  select cc.card_id, cc.player_id, cc.variant_id, cc.origin, cc.lifecycle,
         cc.definition_version, cc.updated_at,
         (select count(*) from public.user_cards uc where uc.card_id = cc.card_id) as ejemplares
    from public.content_cards cc
   where cc.definition_version > 1;

alter view public.v_content_cards_editadas set (security_invoker = true);
revoke all on public.v_content_cards_editadas from anon, authenticated;
grant select on public.v_content_cards_editadas to service_role;

comment on view public.v_content_cards_editadas is
  'Bloque 8.4.2 - cartas versionadas al menos una vez desde el panel. Cero filas significa '
  'que el catalogo persistido es todavia identico al que produce el generador.';
