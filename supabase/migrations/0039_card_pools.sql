-- ============================================================================
-- 0039 — POOLS DE CARTAS, PESOS Y DISTRIBUCIÓN (Bloque 8.3)
--
-- QUÉ RESUELVE
--   H-3 y H-4 de `docs/cards/CARD-CONTENT-PLANE-AUDIT.md`:
--     H-3  «No existe peso por carta: dentro de un bucket el sorteo es UNIFORME.
--           Imposible destacar o rebajar una carta.»
--     H-4  «La pertenencia carta↔sobre es DEDUCIDA, no declarada. "¿En qué sobres sale
--           esta carta?" no se puede consultar.»
--
-- ─────────────── LO QUE ESTA MIGRACIÓN NO HACE, Y ES LO MÁS IMPORTANTE ───────────────
--
--   **No mueve `PackDef` a la base de datos.** Precio, `cardCount`, pesos por bucket,
--   garantías, pity y política anti-duplicados siguen en `src/data/packs.ts`, y el motor
--   los sigue leyendo de ahí sin enterarse de nada.
--
--   El encargo lo dice con precisión: *«la nueva infraestructura debe sustituir únicamente
--   la FUENTE DE CONFIGURACIÓN DEL POOL»*. El pool es dos cosas —qué cartas son elegibles y
--   cuánto pesa cada una—, y solo eso es lo que se persiste aquí. Migrar además las reglas
--   del sobre sería cambiar las reglas del juego, no quién controla el contenido.
--
-- ─────────────── LAS DOS CAPAS, QUE YA EXISTEN Y SE CONSERVAN ───────────────
--
--   Auditado en `openPack.ts`. El sorteo de una carta es, HOY:
--
--     P(carta) = P(bucket)                    ← pack.weights, renormalizado sobre los
--                                               buckets CON STOCK e índice >= minIdx
--              × 1 / |candidatos del bucket|  ← `rng.pick`, UNIFORME
--
--   Es decir: ya existe `P(rareza) × P(carta | rareza)`. No hay que inventar la estructura,
--   hay que completarla. A partir de 8.3:
--
--     P(carta) = P(bucket) × peso(carta) / Σ pesos del bucket
--
--   Y la propiedad que hace segura toda la migración: **con todos los pesos iguales, la
--   segunda fórmula ES la primera**, no una aproximación. La demostración está en
--   `src/domain/packs/weighted.ts` y la comprueba `content-pools:verify` bit a bit.
--
-- ─────────────── QUIÉN MANDA EN EL ORDEN ───────────────
--
--   El bloque 8.1 descubrió por las malas que el motor **elige por índice**
--   (`rng.pick(arr) = arr[floor(next()*arr.length)]`), así que el ORDEN del pool forma
--   parte del resultado. Por eso aquí **las entradas de pool NO llevan orden**: la lista de
--   candidatos la sigue construyendo `buildPool` recorriendo el catálogo por
--   `content_cards.ordinal`, que es la única autoridad de orden que hay y que ya está
--   demostrada. Un `ordinal` en las entradas sería una SEGUNDA autoridad de orden, y dos
--   autoridades de orden es exactamente cómo se rompe un sorteo determinista.
--
--   Las entradas aportan PERTENENCIA y PESO. Nada más.
--
-- REVERSIÓN (conceptual)
--   drop function if exists public.app_content_distribution_snapshot();
--   drop function if exists public.app_content_pool_publish(text,text,uuid);
--   drop function if exists public.app_content_pool_set_entries(text,jsonb,text,uuid);
--   drop function if exists public.app_content_pool_upsert(jsonb,text,uuid);
--   drop function if exists public.app_content_pack_bind(text,text,int,text,uuid);
--   drop table if exists public.content_pack_pools;
--   drop table if exists public.content_pool_entries;
--   drop table if exists public.content_pools;
--   drop table if exists public.content_distribution_version;
--   Sin pools activos, el motor vuelve solo a la elegibilidad de `PackDef` y al sorteo
--   uniforme: exactamente el comportamiento anterior a este bloque. Ni una fila de
--   `user_cards`, `card_mints`, `content_cards` o `content_card_versions` se toca aquí.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. EL POOL — un conjunto elegible con nombre
-- ----------------------------------------------------------------------------
--
-- `mode` describe de dónde sale la pertenencia:
--
--   RULE      la definen las `rules` (grupos, región, variantes, series, serializadas) —
--             el MISMO vocabulario que ya entiende `isEligible`, para no inventar un
--             segundo lenguaje de elegibilidad que habría que mantener sincronizado.
--   EXPLICIT  la definen las entradas INCLUDE, una por carta.
--   MIXED     las reglas fijan el conjunto y las entradas lo corrigen (INCLUDE añade,
--             EXCLUDE quita) y le ponen peso.
create table if not exists public.content_pools (
  id            text primary key,
  name          text not null,
  description   text,
  mode          text not null default 'RULE' check (mode in ('RULE','EXPLICIT','MIXED')),

  /**
   * Restricciones de elegibilidad, con el vocabulario de `PackDef`:
   *   { groups[], region, variants[], excludeVariants[], series[], serializedOnly }
   * Se valida en el servidor contra el dominio, no aquí: el esquema no debe conocer la
   * lista de variantes del juego.
   */
  rules         jsonb not null default '{}'::jsonb,

  /**
   * DRAFT no lo ve el sorteo. ACTIVE sí. RETIRED lo saca sin borrar su configuración —
   * misma filosofía que el ciclo de vida de las cartas en 8.2: retirar no es borrar.
   */
  lifecycle     text not null default 'DRAFT' check (lifecycle in ('DRAFT','ACTIVE','RETIRED')),

  -- Disponibilidad temporal: pools de evento y de temporada.
  available_from timestamptz,
  available_to   timestamptz,
  season_id     text,
  event_id      text,

  /**
   * Sube en CADA cambio de la configuración del pool (reglas o entradas). Es lo que hace
   * observable que un pool cambió sin comparar sus entradas una a una.
   */
  revision      int not null default 1 check (revision >= 1),
  checksum      text not null default '',

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid,
  published_at  timestamptz,
  retired_at    timestamptz,

  constraint content_pools_window check (available_to is null or available_from is null or available_to > available_from)
);
create index if not exists content_pools_lifecycle_idx on public.content_pools(lifecycle);
create index if not exists content_pools_event_idx     on public.content_pools(event_id);

-- ----------------------------------------------------------------------------
-- 2. LA ENTRADA — pertenencia y PESO, y ninguna otra cosa
-- ----------------------------------------------------------------------------
--
-- La clave primaria `(pool_id, card_id)` hace los duplicados imposibles por esquema: no
-- hace falta comprobarlos en ningún sitio porque no pueden existir.
--
-- `weight` es RELATIVO. No son porcentajes y no tienen que sumar nada: 10/20/5 significa
-- 10/35, 20/35 y 5/35. Que el administrador no tenga que cuadrar una suma a 100 es
-- justamente lo que impide el error clásico de este tipo de sistemas —publicar una tabla
-- que suma 97 y no darse cuenta.
create table if not exists public.content_pool_entries (
  pool_id  text not null references public.content_pools(id) on delete cascade,
  /**
   * FK REAL contra el catálogo. Aquí sí se puede, y es la primera vez en todo el plano de
   * contenido: un pool es configuración nueva, no historia heredada, así que no arrastra el
   * caso `derke__champions-mvp` que impidió la FK en `user_cards` (ver 8.1 §D-1). Una
   * entrada que apunte a una carta inexistente no puede llegar a escribirse.
   */
  card_id  text not null references public.content_cards(card_id) on delete restrict,

  /**
   * Peso relativo. `numeric(12,4)` y no `float`: el peso es configuración administrativa y
   * tiene que sumar igual en la base y en Node. El tope de 1.000.000 no es decorativo —
   * evita que alguien escriba 1e30 y convierta la suma del bucket en `Infinity`, que haría
   * que TODAS las demás cartas tuvieran probabilidad cero sin ningún aviso.
   */
  weight   numeric(12,4) not null default 1
           check (weight > 0 and weight <= 1000000),

  /**
   * INCLUDE  añade la carta al pool (o le fija el peso si ya estaba por reglas).
   * EXCLUDE  la saca, aunque las reglas la incluyeran. Es lo que permite decir «todo EMEA
   *          menos esta» sin escribir 203 entradas.
   */
  mode     text not null default 'INCLUDE' check (mode in ('INCLUDE','EXCLUDE')),

  note     text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  primary key (pool_id, card_id)
);
create index if not exists content_pool_entries_card_idx on public.content_pool_entries(card_id);
-- «¿En qué pools sale esta carta?» — la pregunta que H-4 decía que no se podía responder.
create index if not exists content_pool_entries_pool_mode_idx on public.content_pool_entries(pool_id, mode);

-- ----------------------------------------------------------------------------
-- 3. SOBRE ↔ POOL
-- ----------------------------------------------------------------------------
--
-- `pack_id` es texto SIN clave ajena, y a propósito: los sobres siguen viviendo en
-- `src/data/packs.ts` (§0). Poner una FK exigiría materializarlos aquí, que es justo lo que
-- este bloque no debe hacer. La existencia del sobre la valida el servidor contra `PACKS`
-- antes de escribir, y `content-pools:verify` comprueba que no hay vínculos huérfanos.
--
-- Muchos-a-muchos porque el encargo pide las dos direcciones: un sobre con varios pools, y
-- una carta —vía su pool— en varios sobres con pesos distintos.
create table if not exists public.content_pack_pools (
  pack_id  text not null,
  pool_id  text not null references public.content_pools(id) on delete cascade,
  /**
   * Orden de aplicación cuando un sobre tiene varios pools. El de MENOR prioridad manda
   * sobre el peso de una carta que esté en dos: sin una regla de desempate declarada, «¿qué
   * pesa esta carta en este sobre?» tendría dos respuestas.
   */
  priority int not null default 100 check (priority >= 0),
  enabled  boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (pack_id, pool_id)
);
create index if not exists content_pack_pools_pack_idx on public.content_pack_pools(pack_id, priority);

-- ----------------------------------------------------------------------------
-- 4. LA VERSIÓN DE LA DISTRIBUCIÓN — una fila, y sirve para invalidar la caché
-- ----------------------------------------------------------------------------
--
-- Mismo patrón que `content_catalog_version` (0037). Es la señal barata que impide el
-- escenario que el encargo prohíbe en la Fase 12: «admin publica → BD tiene la carta → Node
-- sigue usando el pool viejo indefinidamente».
create table if not exists public.content_distribution_version (
  id            boolean primary key default true check (id),
  version       bigint not null default 1 check (version >= 1),
  pools_count   int not null default 0 check (pools_count >= 0),
  entries_count int not null default 0 check (entries_count >= 0),
  checksum      text not null default '',
  updated_at    timestamptz not null default now()
);
insert into public.content_distribution_version (id) values (true) on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- 5. LA HUELLA Y EL LATIDO — internos, los usan las RPC de §6
-- ----------------------------------------------------------------------------
--
-- La huella de un pool cubre lo que decide el sorteo: sus reglas y sus entradas con peso.
-- NO cubre el nombre, la descripción ni las marcas de tiempo — renombrar un pool no cambia
-- lo que sale de un sobre, y si entrara en la huella toda edición cosmética parecería un
-- cambio de distribución.
create or replace function public._pool_checksum(p_pool_id text)
returns text language sql stable security definer set search_path = public as $$
  select encode(sha256(convert_to(
    coalesce((select rules::text from public.content_pools where id = p_pool_id), '{}')
    || '|' ||
    coalesce((select string_agg(card_id || ':' || mode || ':' || weight::text, ',' order by card_id)
                from public.content_pool_entries where pool_id = p_pool_id), ''),
    'UTF8')), 'hex');
$$;

/**
 * Recalcula la huella del pool, le sube la revisión y publica una versión nueva de la
 * distribución. Se llama DENTRO de cada RPC que cambia algo, en la misma transacción: por
 * eso no puede existir un estado en el que las entradas hayan cambiado y la versión no.
 */
create or replace function public._bump_distribution(p_pool_id text)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_new bigint; v_chk text;
begin
  if p_pool_id is not null then
    v_chk := public._pool_checksum(p_pool_id);
    update public.content_pools
       set revision = revision + 1, checksum = v_chk, updated_at = now()
     where id = p_pool_id;
  end if;

  update public.content_distribution_version
     set version = version + 1,
         pools_count   = (select count(*) from public.content_pools where lifecycle = 'ACTIVE'),
         entries_count = (select count(*) from public.content_pool_entries),
         checksum = encode(sha256(convert_to(
           coalesce((select string_agg(id || ':' || lifecycle || ':' || checksum, ',' order by id)
                       from public.content_pools), ''), 'UTF8')), 'hex'),
         updated_at = now()
   where id = true
  returning version into v_new;
  return v_new;
end; $$;

-- ----------------------------------------------------------------------------
-- 6. LAS OPERACIONES ADMINISTRATIVAS — todas transaccionales
-- ----------------------------------------------------------------------------
--
-- Son RPC y no `insert`/`update` sueltos por la razón de la Fase 11: **una apertura de
-- sobre no puede observar una configuración a medias**. Cambiar un pool son varias
-- escrituras (entradas + huella + revisión + versión global) que tienen que cuadrar. Node
-- no puede abrir una transacción con supabase-js — el mismo razonamiento de 0011 y 0038.
--
-- Todas `security definer`, con `execute` revocado a `anon`/`authenticated` y concedido
-- solo a `service_role`. Quien las invoca es una ruta de servidor tras `verifyAdmin(req)`,
-- y el actor viaja como parámetro porque lo pone el servidor desde el token.

-- ── 6.1 Alta/edición de un pool (reglas y metadatos) ──
create or replace function public.app_content_pool_upsert(
  p_pool jsonb, p_reason text, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id text; v_existe boolean; v_lifecycle text;
begin
  v_id := p_pool->>'id';
  if v_id is null or length(btrim(v_id)) = 0 then
    raise exception 'Falta el id del pool' using errcode = 'P0001';
  end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'Todo cambio de distribución necesita motivo' using errcode = 'P0001';
  end if;

  select true, lifecycle into v_existe, v_lifecycle from public.content_pools where id = v_id;

  if v_existe is null then
    insert into public.content_pools (id, name, description, mode, rules,
                                      available_from, available_to, season_id, event_id, created_by)
    values (v_id, coalesce(p_pool->>'name', v_id), p_pool->>'description',
            coalesce(p_pool->>'mode', 'RULE'), coalesce(p_pool->'rules', '{}'::jsonb),
            (p_pool->>'available_from')::timestamptz, (p_pool->>'available_to')::timestamptz,
            p_pool->>'season_id', p_pool->>'event_id', p_actor);
  else
    /*
     * Un pool RETIRADO no se edita. Volver a tocar la configuración de algo que ya está
     * fuera de circulación solo puede confundir a quien lea el histórico después; para
     * cambiarlo hay que reactivarlo primero, y eso deja rastro.
     */
    if v_lifecycle = 'RETIRED' then
      raise exception 'Un pool RETIRADO no se edita: reactívalo primero' using errcode = 'P0001';
    end if;
    update public.content_pools
       set name = coalesce(p_pool->>'name', name),
           description = coalesce(p_pool->>'description', description),
           mode = coalesce(p_pool->>'mode', mode),
           rules = coalesce(p_pool->'rules', rules),
           available_from = coalesce((p_pool->>'available_from')::timestamptz, available_from),
           available_to = coalesce((p_pool->>'available_to')::timestamptz, available_to),
           season_id = coalesce(p_pool->>'season_id', season_id),
           event_id = coalesce(p_pool->>'event_id', event_id)
     where id = v_id;
  end if;

  return jsonb_build_object('poolId', v_id, 'version', public._bump_distribution(v_id),
                            'reason', p_reason, 'actor', p_actor);
end; $$;

-- ── 6.2 Fijar las entradas de un pool, TODAS DE GOLPE ──
--
-- Reemplaza el conjunto entero en vez de aceptar altas y bajas sueltas. Es deliberado: una
-- secuencia de operaciones parciales tiene estados intermedios observables, y el estado
-- intermedio de un pool es una distribución de probabilidad que nadie quiso publicar.
create or replace function public.app_content_pool_set_entries(
  p_pool_id text, p_entries jsonb, p_reason text, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_lifecycle text; v_e jsonb; v_card text; v_w numeric; v_mode text;
  v_n int := 0; v_lifecycle_card text;
begin
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'Todo cambio de distribución necesita motivo' using errcode = 'P0001';
  end if;
  select lifecycle into v_lifecycle from public.content_pools where id = p_pool_id for update;
  if v_lifecycle is null then
    raise exception 'Pool no encontrado: %', p_pool_id using errcode = 'P0001';
  end if;
  if v_lifecycle = 'RETIRED' then
    raise exception 'Un pool RETIRADO no se edita' using errcode = 'P0001';
  end if;

  delete from public.content_pool_entries where pool_id = p_pool_id;

  for v_e in select * from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb)) loop
    v_card := v_e->>'card_id';
    v_w    := coalesce((v_e->>'weight')::numeric, 1);
    v_mode := coalesce(v_e->>'mode', 'INCLUDE');

    if v_w <= 0 then
      raise exception 'Peso no válido para %: % (debe ser > 0)', v_card, v_w using errcode = 'P0001';
    end if;

    /*
     * Una carta en DRAFT no puede entrar en un pool ACTIVO: sería repartir contenido que
     * nadie ha aprobado. Se comprueba aquí y NO como restricción de tabla, porque una carta
     * puede retirarse DESPUÉS de estar en un pool y bloquear eso impediría retirar cartas.
     * El sorteo, además, filtra por ciclo de vida en tiempo de ejecución (cinturón y
     * tirantes): ver `DROPPABLE_LIFECYCLES` en `server/catalog/rows.ts`.
     */
    select lifecycle into v_lifecycle_card from public.content_cards where card_id = v_card;
    if v_lifecycle_card is null then
      raise exception 'Carta inexistente: %', v_card using errcode = 'P0001';
    end if;
    if v_lifecycle = 'ACTIVE' and v_mode = 'INCLUDE' and v_lifecycle_card <> 'PUBLISHED' then
      raise exception 'La carta % está en % y el pool está ACTIVO: solo entran cartas PUBLISHED',
        v_card, v_lifecycle_card using errcode = 'P0001';
    end if;

    -- La PK hace imposible el duplicado; si llega dos veces, esto lo dice en vez de
    -- quedarse con la última en silencio.
    begin
      insert into public.content_pool_entries (pool_id, card_id, weight, mode, note)
      values (p_pool_id, v_card, v_w, v_mode, v_e->>'note');
    exception when unique_violation then
      raise exception 'Entrada duplicada para % en %', v_card, p_pool_id using errcode = 'P0001';
    end;
    v_n := v_n + 1;
  end loop;

  return jsonb_build_object('poolId', p_pool_id, 'entries', v_n,
                            'version', public._bump_distribution(p_pool_id), 'reason', p_reason);
end; $$;

-- ── 6.3 Publicar / retirar un pool ──
--
-- La transición es la publicación: no hay un paso intermedio en el que el pool esté «medio
-- activo». Al pasar a ACTIVE se valida que la configuración es publicable; si no lo es, no
-- se publica nada.
create or replace function public.app_content_pool_publish(
  p_pool_id text, p_state text, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cur text; v_ok boolean; v_bad int; v_now timestamptz := now();
begin
  select lifecycle into v_cur from public.content_pools where id = p_pool_id for update;
  if v_cur is null then
    raise exception 'Pool no encontrado: %', p_pool_id using errcode = 'P0001';
  end if;

  v_ok := case v_cur
    when 'DRAFT'   then p_state in ('ACTIVE')
    when 'ACTIVE'  then p_state in ('RETIRED','DRAFT')
    when 'RETIRED' then p_state in ('ACTIVE')
    else false end;
  if not v_ok then
    raise exception 'Transición ilegal de pool: % → %', v_cur, p_state using errcode = 'P0001';
  end if;

  if p_state = 'ACTIVE' then
    -- Cartas no publicadas dentro de un pool que va a activarse.
    select count(*) into v_bad
      from public.content_pool_entries e
      join public.content_cards c on c.card_id = e.card_id
     where e.pool_id = p_pool_id and e.mode = 'INCLUDE' and c.lifecycle <> 'PUBLISHED';
    if v_bad > 0 then
      raise exception 'No se puede activar %: % entrada(s) apuntan a cartas no publicadas',
        p_pool_id, v_bad using errcode = 'P0001';
    end if;
    -- Un pool EXPLICIT sin entradas no es un pool vacío: es una configuración que dejaría
    -- un sobre sin nada que entregar. Se rechaza antes de que llegue a un jugador.
    if exists (select 1 from public.content_pools where id = p_pool_id and mode = 'EXPLICIT')
       and not exists (select 1 from public.content_pool_entries
                        where pool_id = p_pool_id and mode = 'INCLUDE') then
      raise exception 'Un pool EXPLICIT sin entradas INCLUDE no se puede activar' using errcode = 'P0001';
    end if;
  end if;

  update public.content_pools
     set lifecycle = p_state,
         published_at = case when p_state = 'ACTIVE'  then coalesce(published_at, v_now) else published_at end,
         retired_at   = case when p_state = 'RETIRED' then v_now
                             when p_state = 'ACTIVE'  then null else retired_at end
   where id = p_pool_id;

  return jsonb_build_object('poolId', p_pool_id, 'from', v_cur, 'to', p_state,
                            'version', public._bump_distribution(p_pool_id));
end; $$;

-- ── 6.4 Vincular un sobre a un pool ──
create or replace function public.app_content_pack_bind(
  p_pack_id text, p_pool_id text, p_priority int, p_action text, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.content_pools where id = p_pool_id) then
    raise exception 'Pool no encontrado: %', p_pool_id using errcode = 'P0001';
  end if;
  if p_action = 'unbind' then
    delete from public.content_pack_pools where pack_id = p_pack_id and pool_id = p_pool_id;
  else
    insert into public.content_pack_pools (pack_id, pool_id, priority)
    values (p_pack_id, p_pool_id, coalesce(p_priority, 100))
    on conflict (pack_id, pool_id) do update set priority = excluded.priority, enabled = true;
  end if;
  return jsonb_build_object('packId', p_pack_id, 'poolId', p_pool_id, 'action', coalesce(p_action, 'bind'),
                            'version', public._bump_distribution(null));
end; $$;

-- ── 6.5 LA LECTURA CONSISTENTE ──
--
-- Devuelve pools, entradas, vínculos y versión **en UNA transacción**. Es la respuesta a la
-- Fase 11: leerlo con tres consultas separadas por PostgREST podría atravesar una
-- publicación y componer una configuración que nunca existió. Con una sola función, el
-- servidor ve una foto coherente por construcción, no por suerte de temporización.
create or replace function public.app_content_distribution_snapshot()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'version', (select version from public.content_distribution_version where id = true),
    'checksum', (select checksum from public.content_distribution_version where id = true),
    'pools', coalesce((select jsonb_agg(to_jsonb(p) order by p.id)
                         from public.content_pools p where p.lifecycle = 'ACTIVE'), '[]'::jsonb),
    'entries', coalesce((select jsonb_agg(jsonb_build_object(
                            'pool_id', e.pool_id, 'card_id', e.card_id,
                            'weight', e.weight, 'mode', e.mode) order by e.pool_id, e.card_id)
                         from public.content_pool_entries e
                         join public.content_pools p on p.id = e.pool_id
                        where p.lifecycle = 'ACTIVE'), '[]'::jsonb),
    'packPools', coalesce((select jsonb_agg(jsonb_build_object(
                            'pack_id', pp.pack_id, 'pool_id', pp.pool_id, 'priority', pp.priority)
                            order by pp.pack_id, pp.priority, pp.pool_id)
                           from public.content_pack_pools pp
                           join public.content_pools p on p.id = pp.pool_id
                          where pp.enabled and p.lifecycle = 'ACTIVE'), '[]'::jsonb)
  );
$$;

-- ----------------------------------------------------------------------------
-- 7. DIAGNÓSTICO
-- ----------------------------------------------------------------------------
create or replace view public.v_pool_health as
  select p.id as pool_id, p.lifecycle, p.mode, p.revision,
         count(e.card_id) filter (where e.mode = 'INCLUDE') as includes,
         count(e.card_id) filter (where e.mode = 'EXCLUDE') as excludes,
         count(e.card_id) filter (where e.mode = 'INCLUDE' and c.lifecycle <> 'PUBLISHED')
           as includes_no_publicadas,
         coalesce(sum(e.weight) filter (where e.mode = 'INCLUDE'), 0) as peso_total,
         (select count(*) from public.content_pack_pools pp where pp.pool_id = p.id) as sobres
    from public.content_pools p
    left join public.content_pool_entries e on e.pool_id = p.id
    left join public.content_cards c on c.card_id = e.card_id
   group by p.id, p.lifecycle, p.mode, p.revision;

-- ----------------------------------------------------------------------------
-- 8. SEGURIDAD
-- ----------------------------------------------------------------------------
alter table public.content_pools                enable row level security;
alter table public.content_pool_entries         enable row level security;
alter table public.content_pack_pools           enable row level security;
alter table public.content_distribution_version enable row level security;

revoke all on public.content_pools                from anon, authenticated;
revoke all on public.content_pool_entries         from anon, authenticated;
revoke all on public.content_pack_pools           from anon, authenticated;
revoke all on public.content_distribution_version from anon, authenticated;
revoke all on public.v_pool_health                from anon, authenticated;
alter view public.v_pool_health set (security_invoker = true);

revoke all on function public.app_content_pool_upsert(jsonb, text, uuid)              from public, anon, authenticated;
revoke all on function public.app_content_pool_set_entries(text, jsonb, text, uuid)   from public, anon, authenticated;
revoke all on function public.app_content_pool_publish(text, text, uuid)              from public, anon, authenticated;
revoke all on function public.app_content_pack_bind(text, text, int, text, uuid)      from public, anon, authenticated;
revoke all on function public.app_content_distribution_snapshot()                     from public, anon, authenticated;
revoke all on function public._pool_checksum(text)                                    from public, anon, authenticated;
revoke all on function public._bump_distribution(text)                                from public, anon, authenticated;

grant execute on function public.app_content_pool_upsert(jsonb, text, uuid)            to service_role;
grant execute on function public.app_content_pool_set_entries(text, jsonb, text, uuid) to service_role;
grant execute on function public.app_content_pool_publish(text, text, uuid)            to service_role;
grant execute on function public.app_content_pack_bind(text, text, int, text, uuid)    to service_role;
grant execute on function public.app_content_distribution_snapshot()                   to service_role;

comment on table public.content_pools is
  'Bloque 8.3 — conjunto elegible con nombre. Sustituye la FUENTE del pool, no las reglas '
  'del sobre: precio, cardCount, pesos por bucket, garantías y pity siguen en data/packs.ts.';
comment on column public.content_pool_entries.weight is
  'Peso RELATIVO (no porcentaje). P(carta|bucket) = weight / suma de pesos del bucket. '
  'Con todos los pesos iguales la fórmula se reduce a la uniforme actual, bit a bit.';

-- ----------------------------------------------------------------------------
-- 9. CORRECCIÓN DE 8.2 — UNA EDICIÓN DE CARTA TAMBIÉN TIENE QUE INVALIDAR LA CACHÉ
-- ----------------------------------------------------------------------------
--
-- FALLO ENCONTRADO POR LA QA DE ESTE BLOQUE, y es del bloque anterior.
--
-- El servidor cachea el catálogo y decide si recargarlo comparando su versión con
-- `content_catalog_version` (0037). Pero las dos RPC que EDITAN una carta —
-- `app_content_publish_version` y `app_content_set_lifecycle`, ambas de 0038— **no tocaban
-- esa tabla**. Consecuencia medida:
--
--   un administrador retira una carta  →  la base de datos dice RETIRED
--                                      →  el proceso que sirve el juego sigue creyendo que
--                                         está publicada, indefinidamente
--
-- Es exactamente el escenario que la Fase 12 del encargo prohíbe, aplicado al catálogo en
-- vez de a los pools. No se vio en 8.2 porque sus comprobaciones llamaban a
-- `resetServerCatalog()` antes de mirar: la verificación se saltaba justo la parte que
-- fallaba. La QA de 8.3, que abre sobres contra un servidor real, lo destapó a la primera —
-- una carta restaurada a PUBLISHED seguía sin aparecer en el pool que el proceso tenía en
-- memoria.
--
-- La corrección es la misma pieza que usa la distribución: subir la versión EN LA MISMA
-- TRANSACCIÓN que el cambio, para que no pueda existir un estado donde la carta cambió y la
-- versión no.
create or replace function public._bump_catalog()
returns bigint language plpgsql security definer set search_path = public as $fn$
declare v_new bigint;
begin
  update public.content_catalog_version
     set version = version + 1,
         cards_count   = (select count(*) from public.content_cards),
         players_count = (select count(*) from public.content_players),
         /*
          * La huella tiene que salir EXACTAMENTE igual que la de `catalogChecksum()` en
          * `src/server/catalog/rows.ts`, porque `content-catalog:verify` compara las dos.
          * Dos detalles que no son casuales y que ya fallaron una vez:
          *
          *   · el separador va DETRÁS de cada entrada, no entre entradas — la versión de
          *     TypeScript escribe `id chk ` por carta, con espacio final;
          *   · el orden es `COLLATE "C"` (orden de bytes), que es el que usa la comparación
          *     de cadenas de JavaScript. Con la colación por defecto, `_` y `-` no ordenan
          *     igual, y los `card_id` llevan los dos.
          */
         catalog_checksum = encode(sha256(convert_to(
           coalesce((select string_agg(card_id || ' ' || checksum || ' ', ''
                                       order by card_id collate "C")
                       from public.content_cards), ''), 'UTF8')), 'hex'),
         updated_at = now()
   where id = true
  returning version into v_new;
  return v_new;
end; $fn$;

-- Se redefinen las DOS funciones de 0038 añadiendo el latido al final. El cuerpo es el
-- mismo salvo esa línea; se reescriben enteras porque `create or replace` no admite parches
-- parciales, y queda constancia aquí de que la fuente original es 0038 §6.
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
    when 'DRAFT'     then p_state in ('REVIEW','ARCHIVED')
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

  return jsonb_build_object('cardId', p_card_id, 'from', v_card.lifecycle, 'to', p_state,
                            'reason', p_reason, 'actor', p_actor,
                            'catalogVersion', public._bump_catalog());
end; $fn$;

revoke all on function public._bump_catalog() from public, anon, authenticated;
