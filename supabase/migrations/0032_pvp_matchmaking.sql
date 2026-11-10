-- ============================================================================
-- 0032 — COLA DE EMPAREJAMIENTO PvP (Bloque 7.4)
--
-- QUÉ RESUELVE
--   El Bloque 7.2 dejó `duel_matches` capaz de representar A contra B, y el 7.3 dejó a los dos
--   jugadores sincronizados. Falta lo de en medio: CÓMO se decide quién es B. Hoy una partida
--   PvP solo puede nacer si alguien llama a `createPvpMatch()` con los dos ids ya escritos a
--   mano — es decir, no puede nacer.
--
-- POR QUÉ UNA TABLA Y NO UNA COLA EN MEMORIA
--   Una cola en un `Map` de Node no sobrevive a un refresco, ni a un reinicio, ni a un segundo
--   proceso. Y sobre todo: dos procesos con dos Maps emparejarían al mismo jugador dos veces
--   sin enterarse. La exclusión mutua tiene que vivir donde vive el dato, y aquí eso es
--   PostgreSQL: índice único parcial, `for update skip locked` y transiciones condicionadas.
--
-- POR QUÉ `duel_pvp_queue` Y NO UN ESTADO MÁS EN `duel_matches`
--   Una entrada de cola NO es una partida: existe antes de que haya rival, puede caducar sin
--   que nada se juegue y puede cancelarse. Meter «BUSCANDO» en `duel_matches.status` obligaría
--   a crear filas de partida sin jugador B, que es exactamente lo que la restricción
--   `duel_matches_mode_shape` (0031) prohíbe a propósito. Son dos ciclos de vida distintos y
--   se quedan en dos tablas distintas.
--
-- LO QUE ESTA MIGRACIÓN NO TOCA
--   El motor de duelo, las reglas, `duel_match_actions`, la economía, `profiles` (ni
--   `profiles.points`, que sigue siendo exclusivamente Pick'ems), la telemetría, el mercado y
--   las migraciones 0026–0028, que siguen pendientes por decisión ajena a este bloque.
--
-- BLOQUEO CONOCIDO — RATING
--   `rating_snapshot` nace y se queda en NULL. En el repositorio NO existe hoy ninguna fuente
--   de rating PvP persistente y autoritativa: `src/competitive/` es un motor en memoria,
--   CONGELADO (docs/FROZEN.md) y del juego táctico 5v5, y `profiles.points` es Pick'ems.
--   Rellenar esa columna exigiría escribir MMR al terminar cada partida, que es el bloque de
--   resolución competitiva y está explícitamente fuera de este. Se deja la columna como
--   costura declarada —no como número inventado— y el emparejamiento NO la lee: hoy es FIFO
--   puro. Ver docs/pvp/PVP-MATCHMAKING.md §5.
--
-- REVERSIÓN (conceptual, no ejecutar sin decisión de producto)
--   drop function if exists public.duel_pvp_enqueue, public.duel_pvp_cancel,
--     public.duel_pvp_status, public.duel_pvp_claim_pair, public.duel_pvp_commit_pair,
--     public.duel_pvp_release_pair, public._duel_pvp_sweep, public._duel_pvp_entry;
--   drop table if exists public.duel_pvp_queue;
--   drop index if exists public.duel_matches_pvp_active_a_idx;
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. LA COLA
-- ----------------------------------------------------------------------------
create table if not exists public.duel_pvp_queue (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  /*
   * El mazo con el que se busca partida. `cascade`: una entrada de cola cuyo mazo ya no existe
   * no tiene ningún significado, y la cola NO es un archivo histórico —la partida sí lo es, y
   * esa vive en `duel_matches`, que conserva la fila aunque el mazo desaparezca (0014).
   */
  deck_id    uuid not null references public.duel_decks(id) on delete cascade,

  /*
   * ESTADO DE LA COLA. Deliberadamente separado de `duel_matches.status`: aquel describe una
   * PARTIDA y este describe una BÚSQUEDA.
   *
   *   QUEUED    buscando rival. Es el único estado elegible para emparejar.
   *   PAIRING   reservado por un emparejador que está creando la partida. Estado EFÍMERO con
   *             arrendamiento (`pairing_expires_at`): existe porque construir el estado inicial
   *             de la partida requiere el motor de TypeScript y no puede ocurrir dentro de esta
   *             transacción. Ver §4.
   *   MATCHED   hay partida. `match_id` la nombra.
   *   CANCELLED el jugador se salió, o su mazo dejó de ser legal al emparejar.
   *   EXPIRED   se agotó el TTL sin rival.
   *
   * MATCHED, CANCELLED y EXPIRED son TERMINALES: de ellos no se sale. Una entrada no se
   * reutiliza; volver a buscar crea una entrada nueva.
   */
  state      text not null default 'QUEUED'
             check (state in ('QUEUED','PAIRING','MATCHED','CANCELLED','EXPIRED')),

  /*
   * RATING CONGELADO al entrar en cola. Hoy SIEMPRE NULL — ver la cabecera. Se declara para que
   * el día que exista rating persistente la migración sea aditiva y para que quede escrito en el
   * esquema que el emparejamiento de hoy NO es competitivo. Ninguna función de este fichero lo
   * lee ni lo escribe.
   */
  rating_snapshot integer,

  /*
   * Testigo compartido por las DOS entradas que un emparejador ha reservado. Es lo que permite
   * confirmarlas o liberarlas a la vez, sin volver a decidir quién iba con quién.
   */
  pair_token uuid,
  /* Fin del arrendamiento de la reserva. Pasado ese instante la reserva se recupera (§4). */
  pairing_expires_at timestamptz,

  /*
   * Id de la partida. SIN clave foránea, y es una decisión, no un olvido:
   *
   *   El id se RESERVA en la transacción que empareja (estado PAIRING) y la fila de
   *   `duel_matches` se inserta en una transacción POSTERIOR, porque el estado inicial lo tiene
   *   que construir el motor de TypeScript (`startDuelMatch`), que no vive en la base de datos.
   *   Una clave foránea rechazaría la reserva por apuntar a una fila que todavía no existe, y
   *   `deferrable` no ayuda: no son la misma transacción.
   *
   *   A cambio de esa reserva se obtiene algo que una clave foránea no daba: si el proceso
   *   muere entre reservar y crear, la recuperación puede PREGUNTAR por ese id exacto y saber
   *   con certeza si la partida llegó a existir. Sin id reservado, esa pregunta solo se podría
   *   responder por heurística de tiempo. Ver `_duel_pvp_sweep`.
   */
  match_id   uuid,
  matched_at timestamptz,

  /* Por qué se cerró la búsqueda. Solo en estados terminales que no son MATCHED. */
  closed_reason text check (closed_reason in ('USER','EXPIRED','DECK_INVALID','MATCH_FAILED')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  /* TTL. Una entrada vencida NO puede emparejar: lo filtra la consulta, no solo el barrido. */
  expires_at timestamptz not null
);

-- ----------------------------------------------------------------------------
-- 2. INVARIANTES — la cola se defiende en la base de datos
-- ----------------------------------------------------------------------------
do $mig$
begin
  -- La forma de cada estado. Impide los tres estados inconsistentes que el encargo enumera:
  -- MATCHED sin `match_id`, PAIRING sin testigo, y terminal-no-MATCHED con partida.
  if not exists (select 1 from pg_constraint where conname = 'duel_pvp_queue_state_shape') then
    alter table public.duel_pvp_queue
      add constraint duel_pvp_queue_state_shape check (
        (state = 'QUEUED'
           and pair_token is null and pairing_expires_at is null
           and match_id is null and matched_at is null and closed_reason is null)
        or
        (state = 'PAIRING'
           and pair_token is not null and pairing_expires_at is not null
           and match_id is not null and matched_at is null and closed_reason is null)
        or
        (state = 'MATCHED'
           and match_id is not null and matched_at is not null and closed_reason is null)
        or
        (state in ('CANCELLED','EXPIRED')
           and match_id is null and matched_at is null and closed_reason is not null)
      );
  end if;

  -- Una búsqueda no puede caducar antes de empezar.
  if not exists (select 1 from pg_constraint where conname = 'duel_pvp_queue_ttl_check') then
    alter table public.duel_pvp_queue
      add constraint duel_pvp_queue_ttl_check check (expires_at > created_at);
  end if;
end
$mig$;

/*
 * LA restricción del bloque: UN USUARIO = COMO MUCHO UNA BÚSQUEDA VIVA.
 *
 * Índice único PARCIAL sobre los dos estados no terminales. No es una comprobación previa al
 * INSERT —que tendría carrera— sino una imposibilidad: dos peticiones simultáneas del mismo
 * usuario chocan y solo una fila existe. La segunda lee la que ganó, que es justo la semántica
 * idempotente que se quiere para un doble clic.
 */
create unique index if not exists duel_pvp_queue_active_uniq
  on public.duel_pvp_queue (user_id) where state in ('QUEUED','PAIRING');

/*
 * Índice de SELECCIÓN. El emparejador pide «los dos que llevan más esperando», así que el
 * índice es exactamente ese orden y solo sobre las filas elegibles: no recorre ni las
 * emparejadas ni las canceladas ni las caducadas históricas.
 */
create index if not exists duel_pvp_queue_ready_idx
  on public.duel_pvp_queue (created_at, id) where state = 'QUEUED';

/* Recuperación de reservas huérfanas. Parcial: normalmente está vacío. */
create index if not exists duel_pvp_queue_lease_idx
  on public.duel_pvp_queue (pairing_expires_at) where state = 'PAIRING';

/* Confirmar/liberar una pareja por su testigo. */
create index if not exists duel_pvp_queue_token_idx
  on public.duel_pvp_queue (pair_token) where pair_token is not null;

/* Estado de MI búsqueda: la consulta que hace cada sondeo del cliente. */
create index if not exists duel_pvp_queue_user_recent_idx
  on public.duel_pvp_queue (user_id, updated_at desc);

/*
 * GUARDA DE PARTIDA ACTIVA, lado A. 0031 ya dejó el lado B
 * (`duel_matches_pvp_b_idx`). Sin este, comprobar «¿tiene ya una PvP viva?» sería un recorrido
 * secuencial de `duel_matches` en CADA intento de emparejamiento.
 */
create index if not exists duel_matches_pvp_active_a_idx
  on public.duel_matches (user_id) where mode = 'PVP' and closed_reason is null;

-- `updated_at` automático, con el mismo disparador que el resto del esquema (0014).
drop trigger if exists duel_pvp_queue_touch on public.duel_pvp_queue;
create trigger duel_pvp_queue_touch before update on public.duel_pvp_queue
  for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- 3. SEGURIDAD — el cliente no toca esta tabla, ni para leer
-- ----------------------------------------------------------------------------
--
-- Misma política que `duel_matches` (0014) y `duel_match_actions` (0031): RLS activo y CERO
-- políticas, más `revoke all`. Aquí importa especialmente la LECTURA: la cola dice quién está
-- jugando ahora mismo y con qué mazo. Un tercero no puede enumerarla, y el propio usuario
-- tampoco la lee directamente — recibe una proyección del servidor con sus propios datos.
alter table public.duel_pvp_queue enable row level security;
revoke all on public.duel_pvp_queue from anon, authenticated;

comment on table public.duel_pvp_queue is
  'Cola de emparejamiento PvP (Bloque 7.4). Una entrada viva por usuario (indice unico parcial). RLS sin politicas: solo el servidor.';
comment on column public.duel_pvp_queue.rating_snapshot is
  'RESERVADO. Siempre NULL hoy: no existe rating PvP persistente y autoritativo en el proyecto. El emparejamiento NO lo lee (FIFO). No rellenar con un valor inventado.';
comment on column public.duel_pvp_queue.match_id is
  'Id RESERVADO en la transaccion que empareja y creado despues por el servidor. Sin FK a proposito: la fila de duel_matches nace una transaccion mas tarde.';

-- ----------------------------------------------------------------------------
-- 4. FUNCIONES — cada llamada es UNA transacción, y ahí está la atomicidad
-- ----------------------------------------------------------------------------
--
-- El cliente de Supabase no sabe abrir transacciones de varias sentencias. Fingir una en
-- TypeScript (leer, decidir, escribir) es exactamente la carrera que este bloque tiene que
-- eliminar, así que la lógica que debe ser indivisible vive aquí, en plpgsql, donde una
-- llamada es una transacción de verdad.
--
-- Todas son `security definer`: la tabla deniega todo a los roles del cliente y estas
-- funciones son la única puerta. `p_user` lo pasa SIEMPRE el servidor desde el Bearer; ninguna
-- de estas funciones se concede a `authenticated`, así que no hay forma de invocarlas con el
-- id de otro.

/** Proyección de una fila a jsonb. Único sitio que conoce los nombres de columna en SQL. */
create or replace function public._duel_pvp_entry(q public.duel_pvp_queue)
returns jsonb language sql immutable set search_path = public as $$
  select jsonb_build_object(
    'entryId',   q.id,
    'userId',    q.user_id,
    'deckId',    q.deck_id,
    'state',     q.state,
    'matchId',   case when q.state = 'MATCHED' then q.match_id else null end,
    'reason',    q.closed_reason,
    'createdAt', (extract(epoch from q.created_at) * 1000)::bigint,
    'updatedAt', (extract(epoch from q.updated_at) * 1000)::bigint,
    'expiresAt', (extract(epoch from q.expires_at) * 1000)::bigint,
    'matchedAt', case when q.matched_at is null then null
                      else (extract(epoch from q.matched_at) * 1000)::bigint end
  );
$$;

/**
 * BARRIDO OPORTUNISTA. Se ejecuta al principio de cada operación de cola, así que la caducidad
 * no necesita un `cron` propio: la mueve el mismo tráfico que crea el problema. Si nadie usa el
 * matchmaking, no hay nada que caducar.
 *
 * Dos trabajos distintos:
 *
 *   1. TTL — `QUEUED` vencida → `EXPIRED`. Es comodidad: la elegibilidad NO depende de este
 *      barrido, porque `duel_pvp_claim_pair` filtra además por `expires_at > now()`. Aunque el
 *      barrido no llegara a correr nunca, una entrada caducada seguiría sin poder emparejar.
 *
 *   2. RESERVAS HUÉRFANAS — `PAIRING` cuyo arrendamiento venció. Ocurre si el proceso muere
 *      entre reservar la pareja y crear la partida. Aquí es donde se cobra la reserva del id:
 *      se PREGUNTA si esa partida existe.
 *        · existe   → la partida se creó y el confirmar se perdió: la entrada pasa a MATCHED.
 *                     Devolverla a la cola crearía una SEGUNDA partida para alguien que ya está
 *                     jugando, que es justo el doble emparejamiento que este bloque prohíbe.
 *        · no existe→ nada se llegó a crear: vuelve a QUEUED (o a EXPIRED si ya venció su TTL).
 */
create or replace function public._duel_pvp_sweep()
returns void language plpgsql security definer set search_path = public as $$
declare
  r public.duel_pvp_queue%rowtype;
  v_exists boolean;
begin
  update public.duel_pvp_queue
     set state = 'EXPIRED', closed_reason = 'EXPIRED'
   where state = 'QUEUED' and expires_at <= now();

  for r in
    select * from public.duel_pvp_queue
     where state = 'PAIRING' and pairing_expires_at <= now()
     for update skip locked
  loop
    select exists (select 1 from public.duel_matches m where m.id = r.match_id) into v_exists;
    if v_exists then
      update public.duel_pvp_queue
         set state = 'MATCHED', matched_at = coalesce(matched_at, now()),
             pair_token = null, pairing_expires_at = null
       where id = r.id;
    else
      update public.duel_pvp_queue
         set state = case when r.expires_at <= now() then 'EXPIRED' else 'QUEUED' end,
             closed_reason = case when r.expires_at <= now() then 'EXPIRED' else null end,
             pair_token = null, pairing_expires_at = null, match_id = null
       where id = r.id;
    end if;
  end loop;
end $$;

/** ¿Tiene este usuario una partida PvP viva? La guarda de partida activa, en un solo sitio. */
create or replace function public._duel_pvp_has_active_match(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.duel_matches m
     where m.mode = 'PVP'
       and m.closed_reason is null
       and m.status in ('WAITING','IN_PROGRESS')
       and (m.user_id = p_user or m.player_b_id = p_user)
  );
$$;

/**
 * ENTRAR EN COLA. Idempotente por construcción.
 *
 * No hay `operation_id` y no hace falta: la clave de idempotencia natural es «este usuario ya
 * está buscando», y esa la impone el índice único parcial. Tres POST seguidos producen UNA
 * entrada y las tres respuestas describen la misma. Se prefiere eso a un testigo que el cliente
 * tendría que recordar entre recargas.
 *
 * Códigos: OK · ALREADY_QUEUED · DECK_NOT_OWNED · ACTIVE_MATCH
 */
create or replace function public.duel_pvp_enqueue(
  p_user uuid, p_deck uuid, p_ttl_seconds int default 600
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v public.duel_pvp_queue%rowtype;
begin
  perform public._duel_pvp_sweep();

  -- Propiedad del mazo EN LA BASE DE DATOS, además de la validación completa del servidor.
  -- Un mazo ajeno sencillamente no aparece filtrando por `user_id`.
  if not exists (select 1 from public.duel_decks d where d.id = p_deck and d.user_id = p_user) then
    return jsonb_build_object('code', 'DECK_NOT_OWNED');
  end if;

  if public._duel_pvp_has_active_match(p_user) then
    return jsonb_build_object('code', 'ACTIVE_MATCH');
  end if;

  begin
    insert into public.duel_pvp_queue (user_id, deck_id, expires_at)
    values (p_user, p_deck, now() + make_interval(secs => greatest(p_ttl_seconds, 10)))
    returning * into v;
    return jsonb_build_object('code', 'OK', 'entry', public._duel_pvp_entry(v));
  exception when unique_violation then
    -- Otra petición del MISMO usuario ganó la carrera. No es un error: es el mismo deseo.
    select * into v from public.duel_pvp_queue
     where user_id = p_user and state in ('QUEUED','PAIRING');
    if not found then
      -- Carrera con una cancelación simultánea: la entrada ya no está viva. Que reintente.
      return jsonb_build_object('code', 'RETRY');
    end if;
    return jsonb_build_object('code', 'ALREADY_QUEUED', 'entry', public._duel_pvp_entry(v));
  end;
end $$;

/**
 * SALIR DE LA COLA. Transición atómica y condicionada: `state = 'QUEUED'` va en el WHERE, así
 * que si un emparejador ya reservó la entrada, este UPDATE afecta a CERO filas y la cancelación
 * PIERDE. Nunca puede coexistir CANCELLED con MATCHED.
 *
 * Cancelar dos veces no rompe nada: la segunda no encuentra entrada viva y devuelve la última
 * conocida con su estado real. No hay error destructivo, y tampoco se miente diciendo que se
 * canceló algo que en realidad se emparejó.
 *
 * Códigos: OK · NOT_QUEUED (nada vivo; se adjunta la última entrada si la hay) · PAIRING
 */
create or replace function public.duel_pvp_cancel(p_user uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v public.duel_pvp_queue%rowtype;
begin
  perform public._duel_pvp_sweep();

  update public.duel_pvp_queue
     set state = 'CANCELLED', closed_reason = 'USER'
   where user_id = p_user and state = 'QUEUED'
   returning * into v;
  if found then
    return jsonb_build_object('code', 'OK', 'entry', public._duel_pvp_entry(v));
  end if;

  -- ¿Estaba reservada por un emparejador? Entonces la cancelación llega tarde por diseño: el
  -- desenlace lo decide el emparejador y el cliente lo verá en su siguiente sondeo.
  select * into v from public.duel_pvp_queue where user_id = p_user and state = 'PAIRING';
  if found then
    return jsonb_build_object('code', 'PAIRING', 'entry', public._duel_pvp_entry(v));
  end if;

  select * into v from public.duel_pvp_queue
   where user_id = p_user order by updated_at desc limit 1;
  if not found then
    return jsonb_build_object('code', 'NOT_QUEUED');
  end if;
  return jsonb_build_object('code', 'NOT_QUEUED', 'entry', public._duel_pvp_entry(v));
end $$;

/**
 * ESTADO DE MI BÚSQUEDA. Devuelve la entrada viva; si no la hay, la última conocida —así el
 * cliente que vuelve tras un refresco descubre que le emparejaron mientras no miraba.
 *
 * `position` es el número de jugadores que llevan MÁS tiempo esperando. Es exactamente el
 * significado del emparejamiento de hoy (FIFO), es un entero agregado y no nombra a nadie: no
 * revela quién está en cola, ni su mazo, ni su rating. La composición de la cola no sale de aquí.
 */
create or replace function public.duel_pvp_status(p_user uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v public.duel_pvp_queue%rowtype;
  v_pos int;
begin
  perform public._duel_pvp_sweep();

  select * into v from public.duel_pvp_queue
   where user_id = p_user and state in ('QUEUED','PAIRING');
  if not found then
    select * into v from public.duel_pvp_queue
     where user_id = p_user order by updated_at desc limit 1;
  end if;
  if not found then
    return jsonb_build_object('code', 'IDLE');
  end if;

  if v.state = 'QUEUED' then
    select count(*) into v_pos from public.duel_pvp_queue q
     where q.state = 'QUEUED' and q.expires_at > now()
       and (q.created_at, q.id) < (v.created_at, v.id);
  end if;

  return jsonb_build_object('code', 'OK', 'entry', public._duel_pvp_entry(v), 'position', v_pos);
end $$;

/**
 * RESERVAR UNA PAREJA. El corazón del bloque.
 *
 * `for update skip locked` es lo que hace imposible el doble emparejamiento con varios
 * procesos: el emparejador que llega segundo NO espera a que el primero suelte las filas —las
 * SALTA— y por tanto no puede reservar a los mismos dos jugadores. No hay «leer, comprobar,
 * escribir»; hay bloqueo de fila.
 *
 * Un jugador consigo mismo es imposible por tres redes independientes: el índice único parcial
 * garantiza que dos filas vivas son dos usuarios distintos; `a <> b` se comprueba aquí; y la
 * restricción `duel_matches_mode_shape` (0031) lo rechazaría en el INSERT de la partida.
 *
 * CRITERIO DE EMPAREJAMIENTO: FIFO estricto — los dos que llevan más tiempo esperando. Es una
 * política, no una ausencia de política: sin rating persistente y autoritativo (ver la cabecera),
 * la única variable honesta que hay sobre la mesa es el tiempo de espera. `rating_snapshot` NO
 * se lee. El día que exista rating, esta consulta gana un filtro de ventana; nada más.
 *
 * Códigos: PAIRED · NO_CANDIDATES
 */
create or replace function public.duel_pvp_claim_pair(p_lease_seconds int default 20)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  a public.duel_pvp_queue%rowtype;
  b public.duel_pvp_queue%rowtype;
  ids uuid[];
  n int;
  v_token uuid := gen_random_uuid();
  v_match uuid := gen_random_uuid();
begin
  perform public._duel_pvp_sweep();

  select array_agg(cand.id order by cand.created_at, cand.id) into ids
    from (
      select q.id, q.created_at
        from public.duel_pvp_queue q
       where q.state = 'QUEUED'
         and q.expires_at > now()                              -- una entrada vencida NO empareja
         and not public._duel_pvp_has_active_match(q.user_id)  -- guarda de partida activa
       order by q.created_at, q.id
       limit 2
       for update skip locked
    ) cand;

  if ids is null or array_length(ids, 1) < 2 then
    return jsonb_build_object('code', 'NO_CANDIDATES');
  end if;

  select * into a from public.duel_pvp_queue where id = ids[1];
  select * into b from public.duel_pvp_queue where id = ids[2];

  -- Red de seguridad: el índice único parcial ya lo garantiza, pero una partida contra uno
  -- mismo es lo bastante grave como para comprobarlo dos veces.
  if a.user_id = b.user_id then
    return jsonb_build_object('code', 'NO_CANDIDATES');
  end if;

  update public.duel_pvp_queue
     set state = 'PAIRING', pair_token = v_token, match_id = v_match,
         pairing_expires_at = now() + make_interval(secs => greatest(p_lease_seconds, 5))
   where id in (a.id, b.id) and state = 'QUEUED';
  get diagnostics n = row_count;

  -- LAS DOS o NINGUNA. Reservar solo una dejaría a un jugador bloqueado en PAIRING con un
  -- testigo que nadie va a confirmar. Las dos filas están bloqueadas por esta transacción y
  -- estaban en QUEUED, así que `n = 2` siempre; comprobarlo cuesta nada y esta es LA función
  -- donde un supuesto silencioso se paga caro.
  if n <> 2 then
    raise exception 'duel_pvp_claim_pair: reserva parcial (% de 2)', n;
  end if;

  return jsonb_build_object(
    'code', 'PAIRED',
    'pairToken', v_token,
    'matchId', v_match,
    'a', jsonb_build_object('entryId', a.id, 'userId', a.user_id, 'deckId', a.deck_id),
    'b', jsonb_build_object('entryId', b.id, 'userId', b.user_id, 'deckId', b.deck_id)
  );
end $$;

/**
 * CONFIRMAR LA PAREJA, una vez que la partida EXISTE de verdad.
 *
 * Exige que la fila de `duel_matches` esté ya escrita: confirmar contra una partida inexistente
 * dejaría dos entradas MATCHED apuntando a nada, que es uno de los estados prohibidos. Y exige
 * que las DOS entradas sigan reservadas con ese testigo: o se confirman las dos o no se confirma
 * ninguna, dentro de la misma transacción.
 *
 * Códigos: OK · NO_MATCH_ROW · STALE_TOKEN
 */
create or replace function public.duel_pvp_commit_pair(p_token uuid, p_match uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  n int;
begin
  if not exists (select 1 from public.duel_matches m where m.id = p_match and m.mode = 'PVP') then
    return jsonb_build_object('code', 'NO_MATCH_ROW');
  end if;

  update public.duel_pvp_queue
     set state = 'MATCHED', matched_at = now(), pair_token = null, pairing_expires_at = null
   where pair_token = p_token and state = 'PAIRING' and match_id = p_match;
  get diagnostics n = row_count;

  if n <> 2 then
    -- Ni una ni tres: o el arrendamiento venció y el barrido ya las movió, o el testigo no es
    -- de esta pareja. En cualquier caso NO se confirma a medias.
    return jsonb_build_object('code', 'STALE_TOKEN', 'updated', n);
  end if;
  return jsonb_build_object('code', 'OK');
end $$;

/**
 * LIBERAR LA PAREJA cuando la partida NO se pudo crear.
 *
 * El caso real: entre entrar en cola y emparejar, alguien vendió una carta y su mazo dejó de ser
 * legal. Esa entrada se cierra (`DECK_INVALID`) y la del rival, que no ha hecho nada malo,
 * VUELVE A LA COLA conservando su `created_at` — es decir, sin perder su antigüedad ni su turno.
 *
 * Códigos: OK
 */
create or replace function public.duel_pvp_release_pair(
  p_token uuid, p_offender uuid default null, p_reason text default 'MATCH_FAILED'
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  n int;
begin
  update public.duel_pvp_queue
     set state = 'CANCELLED',
         closed_reason = case when p_reason = 'DECK_INVALID' then 'DECK_INVALID' else 'MATCH_FAILED' end,
         pair_token = null, pairing_expires_at = null, match_id = null
   where pair_token = p_token and state = 'PAIRING'
     and p_offender is not null and user_id = p_offender;

  update public.duel_pvp_queue
     set state = case when expires_at <= now() then 'EXPIRED' else 'QUEUED' end,
         closed_reason = case when expires_at <= now() then 'EXPIRED' else null end,
         pair_token = null, pairing_expires_at = null, match_id = null
   where pair_token = p_token and state = 'PAIRING';
  get diagnostics n = row_count;

  return jsonb_build_object('code', 'OK', 'released', n);
end $$;

-- ----------------------------------------------------------------------------
-- 5. CONCESIONES — solo el servidor
-- ----------------------------------------------------------------------------
--
-- Ninguna de estas funciones se concede a `anon` ni a `authenticated`. Se invocan con la clave
-- de servicio desde las rutas de Next, que son las únicas que saben quién es el usuario (Bearer)
-- y las únicas que pueden validar el mazo contra el inventario real.
do $mig$
declare f text;
begin
  foreach f in array array[
    '_duel_pvp_sweep()', '_duel_pvp_has_active_match(uuid)',
    'duel_pvp_enqueue(uuid,uuid,int)', 'duel_pvp_cancel(uuid)', 'duel_pvp_status(uuid)',
    'duel_pvp_claim_pair(int)', 'duel_pvp_commit_pair(uuid,uuid)',
    'duel_pvp_release_pair(uuid,uuid,text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  execute 'revoke all on function public._duel_pvp_entry(public.duel_pvp_queue) from public, anon, authenticated';
  execute 'grant execute on function public._duel_pvp_entry(public.duel_pvp_queue) to service_role';
end
$mig$;
