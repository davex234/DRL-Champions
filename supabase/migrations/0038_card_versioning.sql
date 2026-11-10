-- ============================================================================
-- 0038 — VERSIONADO DE DEFINICIONES E INTEGRIDAD DE INSTANCIAS (Bloque 8.2)
--
-- QUÉ RESUELVE
--   H-2 de `docs/cards/CARD-CONTENT-PLANE-AUDIT.md`, el mayor riesgo de integridad del
--   sistema: *«editar una definición muta retroactivamente stats, OVR, valor y desguace de
--   todas las instancias ya poseídas. Sin versión, sin registro, sin aviso.»*
--
--   El bloque 8.1 dio a las cartas existencia persistida. Este da a esa existencia
--   **historia**: una instancia deja de apuntar a «la carta» y pasa a apuntar a **la carta
--   tal y como era cuando se acuñó**.
--
-- ─────────────── LA FORMA MÍNIMA QUE RESUELVE EL PROBLEMA ───────────────
--
--   El encargo pide no forzar tres tablas si el código admite algo mejor. No hacen falta:
--
--     DEFINITION  →  `content_cards`         (ya existe: identidad + ciclo de vida)
--     VERSION     →  `content_card_versions` (NUEVA: el registro inmutable)
--     INSTANCE    →  `user_cards`            (ya existe: + UNA columna, `minted_version`)
--
--   Una tabla nueva y una columna. Las razones de descartar lo demás están medidas:
--
--   · **Copiar el snapshot dentro de `user_cards`** duplicaría 15 campos por ejemplar —hoy
--     53, mañana millones— y crearía la segunda fuente de verdad que el propio 8.1 rechazó
--     (§Pregunta 9). Con versiones, N ejemplares de la misma carta y versión comparten UNA
--     fila.
--
--   · **Inferir la versión por `obtained_at`** contra rangos de vigencia parece elegante y
--     es INCORRECTO aquí: `app_buy_listing` (0020, línea 273) reescribe `obtained_at` al
--     cambiar de dueño. De las 53 instancias actuales, 3 tienen `origin='market'`, así que
--     la inferencia daría la versión equivocada en 3 casos hoy mismo. Los rangos se guardan
--     igualmente —sirven para responder «qué había vigente en el instante T»— pero la
--     autoridad es el puntero, que registra un HECHO en vez de deducirlo.
--
--   · **Una tabla `card_instances` nueva** obligaría a migrar la tabla con RLS, índice
--     único de serial y cinco rutas de escritura. Sería la operación más peligrosa del
--     bloque a cambio de nada: `user_cards` ya ES la tabla de instancias.
--
-- ─────────────── POR QUÉ UN TRIGGER Y NO TOCAR LAS RPC ───────────────
--
--   Hay CINCO rutas que insertan en `user_cards` (0011 ×2, 0018, 0019, 0026) y una que
--   transfiere la propiedad (0020). Modificar cinco RPC críticas —sobres, recompensas,
--   ciclo de juego, libro mayor, eventos— para que cada una recuerde estampar la versión
--   es cinco oportunidades de olvidarlo, hoy y en cada ruta futura.
--
--   Un `BEFORE INSERT` lo estampa en un solo sitio, no se puede saltar y no toca ni una
--   línea de las RPC existentes. Y la transferencia del mercado es un `UPDATE` sobre el
--   mismo `uid`: el ejemplar no se recrea, cambia de dueño — así que su versión viaja con
--   él, que es exactamente lo que debe pasar. El comprador recibe ESE ejemplar, con su
--   historia, no uno nuevo.
--
-- ─────────────── LO QUE NO SE TOCA ───────────────
--
--   Ni el motor de combate, ni `takeDeckSnapshot`, ni las reglas de PvP, matchmaking,
--   rating, timeout, límite de frecuencia, telemetría o analítica. Ni las fórmulas de
--   economía (`marketValue`, `instanceValue`, `salvageValue`): siguen siendo las mismas
--   funciones con la misma matemática; lo único que cambia es **qué carta se les pasa**.
--   Ni el motor de sobres.
--
-- REVERSIÓN (conceptual)
--   drop trigger if exists trg_user_cards_stamp_version on public.user_cards;
--   drop function if exists public._stamp_minted_version();
--   drop function if exists public.app_content_publish_version(text,jsonb,text,uuid);
--   drop function if exists public.app_content_set_lifecycle(text,text,text,uuid);
--   alter table public.content_cards drop constraint if exists content_cards_current_version_fk;
--   alter table public.user_cards drop column if exists minted_version;
--   drop table if exists public.content_card_versions;
--   Ni una fila de `user_cards` se pierde: solo se le quita una columna añadida.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. EL REGISTRO INMUTABLE — qué era una carta en cada momento
-- ----------------------------------------------------------------------------
--
-- Una fila por (carta, versión). Contiene TODO lo que hace falta para reconstruir el
-- `CardDef` que recibió el usuario, sin volver a ejecutar el generador y sin mirar la
-- definición actual.
--
-- Incluye `player_id` y `variant_id` aunque sean inmutables por identidad (§3): si algún
-- día una migración equivocada intentara moverlos, la versión seguiría diciendo qué era la
-- carta. Un registro histórico que dependiera de la fila viva para saber de quién es la
-- carta no sería un registro histórico.
--
-- Incluye `rarity_rank` por un motivo que no es obvio: la rareza NO está en `content_cards`
-- por casualidad —se deriva de `variants.ts`, que es CÓDIGO—. Sin congelarla aquí, cambiar
-- el `rank` de una variante en un despliegue movería la rareza, el valor de mercado y el
-- desguace de todas las instancias ya poseídas. Es el mismo agujero de H-2 por otra puerta.
create table if not exists public.content_card_versions (
  card_id        text not null references public.content_cards(card_id) on delete restrict,
  version        int  not null check (version >= 1),

  -- ── Identidad congelada ──
  player_id      text not null,
  variant_id     text not null,

  -- ── Lo que afecta al juego, congelado ──
  ovr            int    not null check (ovr between 1 and 99),
  combat         jsonb  not null,
  stats          jsonb  not null,
  stat_boost     int    not null check (stat_boost in (0,2,4,6,9,12)),
  rarity_rank    int    not null check (rarity_rank >= 1),
  rarity_bucket  text   not null check (rarity_bucket in ('common','uncommon','rare','epic','legendary')),

  -- ── Procedencia ──
  data_version   text not null,
  source         text not null check (source in ('vlr','editorial')),
  generated_at   timestamptz not null,
  checksum       text not null,

  -- ── Vigencia ──
  /**
   * Desde cuándo esta versión describe la carta. Para la versión 1 de las 772 migradas es
   * `CATALOG_GENERATED_AT` (2026-08-31), la marca determinista del catálogo — y no una
   * fecha inventada: el bloque 8.1 demostró que lo persistido es exactamente lo que genera
   * el código con esa marca. Medido: las 53 instancias existentes se obtuvieron entre el
   * 2026-09-02 y el 2026-09-08, TODAS posteriores, así que la versión 1 las cubre de verdad
   * y la reconstrucción histórica es exacta, no aproximada.
   */
  effective_from timestamptz not null,
  /** NULL = vigente. La cierra la publicación de la siguiente. */
  effective_to   timestamptz,

  -- ── Auditoría ──
  created_at     timestamptz not null default now(),
  /** Quién la publicó. NULL = materialización del catálogo semilla (no hay persona). */
  created_by     uuid,
  /** Por qué. Obligatorio a partir de la versión 2: una edición sin motivo no es auditable. */
  reason         text,

  primary key (card_id, version),

  constraint content_card_versions_identity
    check (card_id = player_id || '__' || variant_id),
  constraint content_card_versions_window
    check (effective_to is null or effective_to > effective_from),
  /*
   * Una versión distinta de la primera SIEMPRE lleva motivo. La versión 1 no lo necesita:
   * su motivo es «así nació el catálogo», y está en el propio `origin` de la definición.
   */
  constraint content_card_versions_reason
    check (version = 1 or (reason is not null and length(btrim(reason)) > 0))
);

-- EXACTAMENTE UNA versión vigente por carta. Sin esto, «la versión actual» sería una
-- pregunta con dos respuestas posibles, que es como se corrompe un histórico.
create unique index if not exists content_card_versions_current_uniq
  on public.content_card_versions(card_id) where effective_to is null;

create index if not exists content_card_versions_card_idx    on public.content_card_versions(card_id);
create index if not exists content_card_versions_window_idx  on public.content_card_versions(card_id, effective_from);

-- ----------------------------------------------------------------------------
-- 2. LA DEFINICIÓN APUNTA A SU VERSIÓN VIGENTE
-- ----------------------------------------------------------------------------
--
-- `content_cards.definition_version` existe desde 0037 y hasta ahora era un entero suelto.
-- Con esta clave ajena pasa a ser un puntero de verdad: la versión vigente de una carta
-- tiene que EXISTIR.
--
-- Es DEFERRABLE porque la relación es circular —las versiones referencian la carta y la
-- carta referencia su versión—: al publicar hay que poder escribir las dos dentro de la
-- misma transacción sin un orden imposible.
--
-- Y nace NOT VALID por una razón de secuencia, no de laxitud: cuando se aplica este
-- esquema, `content_cards` ya tiene sus 772 filas (del 0037) y las versiones génesis
-- todavía no existen — las materializa `content-version:migrate` ejecutando el generador,
-- que vive en TypeScript. `NOT VALID` **sí valida toda escritura nueva** desde este mismo
-- instante; lo único que no hace es recorrer las filas preexistentes. El migrador termina
-- con `validate constraint`, y `content-version:verify` comprueba que quedó validada. Si
-- alguien se saltara ese paso, la comprobación falla y se ve.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'content_cards_current_version_fk'
  ) then
    alter table public.content_cards
      add constraint content_cards_current_version_fk
      foreign key (card_id, definition_version)
      references public.content_card_versions(card_id, version)
      deferrable initially deferred
      not valid;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 2.bis. UNA PROCEDENCIA MÁS: `legacy`
-- ----------------------------------------------------------------------------
--
-- El 0037 admitía tres orígenes para una definición: `seed-generator`, `admin` y
-- `tournament`. Falta el cuarto, y lo pide un dato real.
--
-- `card_mints` guarda un serial acuñado de `derke__champions-mvp`, una carta que el
-- generador actual NO produce porque el palmarés de Derke ya no incluye ese galardón. Ese
-- serial es historia: existió, se acuñó, y borrarlo o fingir que la carta nunca existió
-- sería falsificar el registro.
--
-- `legacy` nombra exactamente eso: una definición cuya existencia la justifica el
-- histórico, no el generador vigente. Sus datos NO se inventan —se derivan con la misma
-- matemática del dominio— y nace `RETIRED`, así que existe, se resuelve y se tasa, pero no
-- vuelve a la circulación. Ver §FASE 8 del informe del bloque.
do $$
begin
  alter table public.content_cards drop constraint if exists content_cards_origin_check;
  alter table public.content_cards add constraint content_cards_origin_check
    check (origin in ('seed-generator','admin','tournament','legacy'));
end $$;

-- ----------------------------------------------------------------------------
-- 3. LA INSTANCIA RECUERDA BAJO QUÉ VERSIÓN NACIÓ
-- ----------------------------------------------------------------------------
--
-- **Nullable a propósito.** `NOT NULL` obligaría a inventar una versión para cualquier
-- `card_id` que no esté en el catálogo, y el bloque 8.1 midió que ese caso es real
-- (`derke__champions-mvp`). NULL aquí significa «no consta», que es la verdad, y el
-- resolutor sabe tratarlo (cae a la versión 1, y si no la hay, a la definición viva).
--
-- Sin FK contra `content_card_versions`, y por la misma razón que 8.1 no puso la FK de
-- `card_id`: el pipeline de torneos puede acuñar cartas fuera del catálogo base. La
-- vigilancia se hace con la vista de §7 y con `content-version:verify`.
alter table public.user_cards
  add column if not exists minted_version int;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'user_cards_minted_version_chk') then
    alter table public.user_cards
      add constraint user_cards_minted_version_chk check (minted_version is null or minted_version >= 1);
  end if;
end $$;

create index if not exists user_cards_card_version_idx
  on public.user_cards(card_id, minted_version);

-- ----------------------------------------------------------------------------
-- 4. EL SELLO — una sola puerta, imposible de olvidar
-- ----------------------------------------------------------------------------
--
-- Estampa la versión vigente de la carta en el momento del alta. No pisa un valor ya
-- puesto (`is null`): si una ruta futura quisiera acuñar explícitamente bajo una versión
-- concreta —una compensación, una restauración— puede hacerlo y el trigger se aparta.
--
-- Si la carta no está en el catálogo, deja NULL. No falla: bloquear el alta convertiría un
-- hueco de catálogo en una pérdida de carta para el jugador, que es peor que no saber la
-- versión.
create or replace function public._stamp_minted_version()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.minted_version is null then
    select definition_version into new.minted_version
      from public.content_cards where card_id = new.card_id;
  end if;
  return new;
end; $$;

drop trigger if exists trg_user_cards_stamp_version on public.user_cards;
create trigger trg_user_cards_stamp_version
  before insert on public.user_cards
  for each row execute function public._stamp_minted_version();

-- ----------------------------------------------------------------------------
-- 5. INMUTABILIDAD — el histórico no se edita, ni por error ni con service_role
-- ----------------------------------------------------------------------------
--
-- Esta es la pieza que convierte la promesa en garantía. Una versión publicada es
-- inmutable en todo lo que afecta al juego. Lo único que puede cambiar es `effective_to`
-- (cerrarla al publicar la siguiente) y `reason` (corregir el texto de la auditoría).
--
-- Y no se puede borrar una versión mientras haya un ejemplar acuñado bajo ella: borrarla
-- sería destruir la única prueba de qué recibió esa persona.
create or replace function public._content_versions_immutable()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_refs int;
begin
  if tg_op = 'DELETE' then
    select count(*) into v_refs from public.user_cards
     where card_id = old.card_id and minted_version = old.version;
    if v_refs > 0 then
      raise exception 'La versión %/% tiene % ejemplar(es) acuñados: borrarla destruiría su historia',
        old.card_id, old.version, v_refs using errcode = 'P0001';
    end if;
    return old;
  end if;

  if new.card_id is distinct from old.card_id
     or new.version is distinct from old.version
     or new.player_id is distinct from old.player_id
     or new.variant_id is distinct from old.variant_id
     or new.ovr is distinct from old.ovr
     or new.combat is distinct from old.combat
     or new.stats is distinct from old.stats
     or new.stat_boost is distinct from old.stat_boost
     or new.rarity_rank is distinct from old.rarity_rank
     or new.rarity_bucket is distinct from old.rarity_bucket
     or new.data_version is distinct from old.data_version
     or new.source is distinct from old.source
     or new.generated_at is distinct from old.generated_at
     or new.checksum is distinct from old.checksum
     or new.effective_from is distinct from old.effective_from
     or new.created_at is distinct from old.created_at
  then
    raise exception 'Una versión publicada es INMUTABLE (%/%). Publica una versión nueva.',
      old.card_id, old.version using errcode = 'P0001';
  end if;
  return new;
end; $$;

drop trigger if exists trg_content_versions_immutable on public.content_card_versions;
create trigger trg_content_versions_immutable
  before update or delete on public.content_card_versions
  for each row execute function public._content_versions_immutable();

-- ----------------------------------------------------------------------------
-- 6. LAS DOS OPERACIONES ADMINISTRATIVAS
-- ----------------------------------------------------------------------------
--
-- Son transacciones porque tienen que serlo: publicar una versión son tres escrituras que
-- deben cuadrar (cerrar la vigente, insertar la nueva, mover el puntero de la definición).
-- Node no puede abrir una transacción con supabase-js — el mismo razonamiento de 0011.
--
-- `security definer` + `revoke` a `anon`/`authenticated` + `grant` solo a `service_role`:
-- conocer el nombre de la función no sirve de nada. Quien las invoca es una ruta de
-- servidor después de `verifyAdmin(req)`, y el actor viaja como parámetro porque lo pone
-- el servidor a partir del token, nunca el cliente.

-- ── 6.1 Publicar una versión nueva ──
--
-- `p_patch` solo admite los campos que el modelo declara editables (§FASE 6 del informe).
-- Cambiar `player_id` o `variant_id` sería cambiar la identidad —sería OTRA carta— y aquí
-- ni siquiera se puede intentar: no se leen del patch.
create or replace function public.app_content_publish_version(
  p_card_id text, p_patch jsonb, p_reason text, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cur public.content_card_versions;
  v_card public.content_cards;
  v_next int;
  v_now timestamptz := now();
  v_ovr int; v_combat jsonb; v_stats jsonb; v_boost int;
  v_rank int; v_bucket text; v_checksum text;
begin
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'Una versión nueva necesita motivo' using errcode = 'P0001';
  end if;

  select * into v_card from public.content_cards where card_id = p_card_id for update;
  if v_card.card_id is null then
    raise exception 'Carta no encontrada: %', p_card_id using errcode = 'P0001';
  end if;

  -- Una carta archivada o rechazada no se versiona: no está en juego.
  if v_card.lifecycle in ('ARCHIVED','REJECTED') then
    raise exception 'No se puede versionar una carta en estado %', v_card.lifecycle using errcode = 'P0001';
  end if;

  select * into v_cur from public.content_card_versions
   where card_id = p_card_id and effective_to is null;
  if v_cur.card_id is null then
    raise exception 'La carta % no tiene versión vigente', p_card_id using errcode = 'P0001';
  end if;

  -- Lo que el patch no trae, se hereda. Editar el OVR no debe reescribir el combate.
  v_ovr    := coalesce((p_patch->>'ovr')::int, v_cur.ovr);
  v_combat := coalesce(p_patch->'combat', v_cur.combat);
  v_stats  := coalesce(p_patch->'stats',  v_cur.stats);
  v_boost  := coalesce((p_patch->>'stat_boost')::int, v_cur.stat_boost);
  v_rank   := coalesce((p_patch->>'rarity_rank')::int, v_cur.rarity_rank);
  v_bucket := coalesce(p_patch->>'rarity_bucket', v_cur.rarity_bucket);
  v_checksum := coalesce(p_patch->>'checksum', '');

  v_next := v_cur.version + 1;

  -- Cerrar la vigente y abrir la nueva. El índice único parcial garantiza que no puede
  -- haber dos vigentes ni un instante.
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

  -- La definición pasa a describir la versión nueva. Los ejemplares ya acuñados NO se
  -- tocan: siguen apuntando a la suya. Eso es todo el bloque, en una frase.
  update public.content_cards
     set ovr = v_ovr, combat = v_combat, stats = v_stats, stat_boost = v_boost,
         rarity_rank = v_rank, rarity_bucket = v_bucket,
         definition_version = v_next, checksum = v_checksum, updated_at = v_now
   where card_id = p_card_id;

  return jsonb_build_object('cardId', p_card_id, 'version', v_next, 'previous', v_cur.version);
end; $$;

-- ── 6.2 Mover el ciclo de vida ──
--
-- Las transiciones legales están en la tabla de abajo y en el informe. `RETIRED` NO es
-- borrar: la carta sigue existiendo, sigue resolviéndose, se sigue tasando y sigue en las
-- colecciones y los mazos. Lo único que pierde es la posibilidad de salir en sobres
-- nuevos.
create or replace function public.app_content_set_lifecycle(
  p_card_id text, p_state text, p_reason text, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_card public.content_cards; v_ok boolean; v_now timestamptz := now();
begin
  select * into v_card from public.content_cards where card_id = p_card_id for update;
  if v_card.card_id is null then
    raise exception 'Carta no encontrada: %', p_card_id using errcode = 'P0001';
  end if;

  v_ok := case v_card.lifecycle
    when 'DRAFT'     then p_state in ('REVIEW','ARCHIVED')
    when 'REVIEW'    then p_state in ('APPROVED','REJECTED','DRAFT')
    when 'APPROVED'  then p_state in ('PUBLISHED','DRAFT')
    when 'PUBLISHED' then p_state in ('RETIRED')
    when 'RETIRED'   then p_state in ('PUBLISHED','ARCHIVED')
    when 'ARCHIVED'  then p_state in ('DRAFT')
    when 'REJECTED'  then p_state in ('DRAFT')
    else false end;

  if not v_ok then
    raise exception 'Transición ilegal: % → %', v_card.lifecycle, p_state using errcode = 'P0001';
  end if;

  /*
   * ARCHIVED saca la carta del juego por completo. Con ejemplares acuñados eso dejaría
   * colecciones y mazos apuntando a una carta que el servidor ya no resuelve. Se prohíbe.
   * Para sacar de circulación una carta que la gente tiene, el estado es RETIRED.
   */
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

  return jsonb_build_object('cardId', p_card_id, 'from', v_card.lifecycle, 'to', p_state,
                            'reason', p_reason, 'actor', p_actor);
end; $$;

-- ── 6.3 Materializar la definición LEGACY ──
--
-- Tiene que ser una transacción porque son dos escrituras que se necesitan la una a la
-- otra: la definición referencia su versión vigente y la versión referencia la definición.
-- Por PostgREST serían dos peticiones, dos transacciones, y la clave ajena rechazaría la
-- primera — con razón.
--
-- Deliberadamente ESTRECHA. No es «crear una carta»: solo admite `origin='legacy'` y nace
-- siempre `RETIRED`. Una RPC genérica de alta de cartas es superficie administrativa, y eso
-- lo diseña 8.3; abrirla aquí de rebote sería colar medio bloque por la puerta de atrás.
--
-- Los VALORES los calcula el dominio en TypeScript (`deriveCard` sobre las métricas reales)
-- y llegan como parámetro. Aquí no se deriva ninguna estadística.
create or replace function public.app_content_materialize_legacy(
  p_def jsonb, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id text; v_now timestamptz := now();
begin
  v_id := p_def->>'card_id';
  if v_id is null then
    raise exception 'Falta card_id' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.content_cards where card_id = v_id) then
    return jsonb_build_object('cardId', v_id, 'created', false, 'reason', 'ya existía');
  end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'Una carta legacy necesita justificación' using errcode = 'P0001';
  end if;

  insert into public.content_cards (
    card_id, player_id, variant_id, ordinal, ovr, stats, combat, stat_boost,
    rarity_rank, rarity_bucket, data_version, source, generated_at,
    origin, lifecycle, definition_version, retired_at, checksum)
  values (
    v_id, p_def->>'player_id', p_def->>'variant_id', (p_def->>'ordinal')::int,
    (p_def->>'ovr')::int, p_def->'stats', p_def->'combat', (p_def->>'stat_boost')::int,
    (p_def->>'rarity_rank')::int, p_def->>'rarity_bucket',
    p_def->>'data_version', p_def->>'source', (p_def->>'generated_at')::timestamptz,
    'legacy', 'RETIRED', 1, v_now, p_def->>'checksum');

  insert into public.content_card_versions (
    card_id, version, player_id, variant_id, ovr, combat, stats, stat_boost,
    rarity_rank, rarity_bucket, data_version, source, generated_at, checksum,
    effective_from, effective_to, created_by, reason)
  values (
    v_id, 1, p_def->>'player_id', p_def->>'variant_id',
    (p_def->>'ovr')::int, p_def->'combat', p_def->'stats', (p_def->>'stat_boost')::int,
    (p_def->>'rarity_rank')::int, p_def->>'rarity_bucket',
    p_def->>'data_version', p_def->>'source', (p_def->>'generated_at')::timestamptz,
    p_def->>'checksum', (p_def->>'effective_from')::timestamptz, null, null, null);

  return jsonb_build_object('cardId', v_id, 'created', true, 'justification', p_reason);
end; $$;

-- ── 6.4 Purgar una definición que nunca tuvo historia ──
--
-- «RETIRED no es DELETE» y «nunca borrar una carta con histórico» son reglas de este
-- bloque. Esta función NO las contradice: existe justamente para poder aplicarlas, porque
-- las claves ajenas hacen el borrado circular (la definición apunta a su versión vigente y
-- las versiones apuntan a la definición) y sin una transacción no se puede deshacer un alta
-- ni siquiera cuando es legítimo — una carta de prueba, un alta equivocada de hace un
-- minuto.
--
-- Las tres guardas son la protección explícita que el bloque exige. Si la carta ha estado
-- en manos de alguien, se ha acuñado alguna vez o se ha anunciado, esto se niega. Para todo
-- lo demás el camino es RETIRED, que no borra nada.
create or replace function public.app_content_purge_card(p_card_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
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
  return jsonb_build_object('cardId', p_card_id, 'purged', true);
end; $$;

-- ── 6.5 Validar la clave ajena que §2 dejó NOT VALID ──
--
-- Existe porque el migrador habla con la base por PostgREST y no puede ejecutar un
-- `alter table ... validate constraint` suelto — ni debe poder: una RPC que ejecutara SQL
-- arbitrario sería un agujero mucho peor que el problema que resuelve. Esta hace UNA cosa,
-- es idempotente y no acepta parámetros.
create or replace function public.app_content_validate_version_fk()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_valid boolean;
begin
  select convalidated into v_valid from pg_constraint
   where conname = 'content_cards_current_version_fk';
  if v_valid is null then
    return jsonb_build_object('ok', false, 'error', 'la restricción no existe');
  end if;
  if not v_valid then
    alter table public.content_cards validate constraint content_cards_current_version_fk;
  end if;
  select convalidated into v_valid from pg_constraint
   where conname = 'content_cards_current_version_fk';
  return jsonb_build_object('ok', v_valid, 'validated', v_valid);
end; $$;

-- ----------------------------------------------------------------------------
-- 7. DIAGNÓSTICO — ejemplares cuya historia no se puede reconstruir
-- ----------------------------------------------------------------------------
--
-- Cero filas significa que TODO ejemplar poseído se puede reconstruir exactamente. Es la
-- consulta que responde al criterio 4 del bloque sin ejecutar nada.
create or replace view public.v_instance_version_gaps as
  select uc.uid, uc.user_id, uc.card_id, uc.serial, uc.minted_version,
         case
           when cc.card_id is null then 'CARD_NOT_IN_CATALOG'
           when uc.minted_version is null then 'NO_VERSION_STAMPED'
           when ccv.card_id is null then 'VERSION_MISSING'
         end as gap
    from public.user_cards uc
    left join public.content_cards cc on cc.card_id = uc.card_id
    left join public.content_card_versions ccv
           on ccv.card_id = uc.card_id and ccv.version = uc.minted_version
   where cc.card_id is null or uc.minted_version is null or ccv.card_id is null;

-- ----------------------------------------------------------------------------
-- 8. SEGURIDAD
-- ----------------------------------------------------------------------------
--
-- Mismo patrón que 0037 y que las tablas PvP: RLS activo, cero políticas, `revoke all`. El
-- cliente no puede ni leer el histórico de versiones, y mucho menos publicarlas.
alter table public.content_card_versions enable row level security;
revoke all on public.content_card_versions from anon, authenticated;
revoke all on public.v_instance_version_gaps from anon, authenticated;
alter view public.v_instance_version_gaps set (security_invoker = true);

revoke all on function public.app_content_publish_version(text, jsonb, text, uuid) from public, anon, authenticated;
revoke all on function public.app_content_set_lifecycle(text, text, text, uuid)     from public, anon, authenticated;
revoke all on function public.app_content_materialize_legacy(jsonb, text)           from public, anon, authenticated;
revoke all on function public.app_content_purge_card(text)                          from public, anon, authenticated;
revoke all on function public.app_content_validate_version_fk()                     from public, anon, authenticated;
grant execute on function public.app_content_publish_version(text, jsonb, text, uuid) to service_role;
grant execute on function public.app_content_set_lifecycle(text, text, text, uuid)     to service_role;
grant execute on function public.app_content_materialize_legacy(jsonb, text)           to service_role;
grant execute on function public.app_content_purge_card(text)                          to service_role;
grant execute on function public.app_content_validate_version_fk()                     to service_role;

comment on table public.content_card_versions is
  'Bloque 8.2 — registro INMUTABLE de qué era una carta en cada momento. Una instancia '
  'apunta aquí por (card_id, minted_version); editar la definición NO la toca.';
comment on column public.user_cards.minted_version is
  'Bloque 8.2 — versión de la definición bajo la que se acuñó este ejemplar. La estampa el '
  'trigger trg_user_cards_stamp_version. NULL = carta fuera del catálogo (caso legacy).';
