-- ============================================================================
-- 0033 — RATING PvP PERSISTENTE (Bloque 7.4.1)
--
-- QUÉ RESUELVE
--   El BLOQUEO D-MM-1 del bloque 7.4: «no existe rating PvP persistente». El emparejamiento
--   quedó siendo FIFO puro y `duel_pvp_queue.rating_snapshot` nació y se quedó en NULL, con un
--   comentario en el esquema diciendo que no se rellenara con un número inventado. Esta
--   migración crea el número de verdad.
--
-- ─────────────────────── POR QUÉ UNA TABLA NUEVA Y NO ALGO EXISTENTE ───────────────────────
--
--   `profiles.points`        — es Pick'ems. La 0015 construye sobre esa columna los índices y
--                              las vistas `ranking_points` / `ranking_points_region`. Sumar ahí
--                              el rendimiento en duelos mezclaría dos escalas que no significan
--                              lo mismo y contaminaría una clasificación ya publicada.
--   `src/competitive/`       — es el sistema competitivo del juego TÁCTICO 5v5, está CONGELADO
--                              (docs/FROZEN.md) y es un motor EN MEMORIA: `newProfile()` y
--                              `recordMatch()` devuelven objetos, no escriben una fila. Su
--                              vocabulario es de otro juego: `coachRating`, `roster`, `mvp`,
--                              `scoreFor/scoreAgainst` en rondas. No hay nada que persistir ahí.
--   `public.team_ratings`    — (0005) es el Elo de EQUIPOS de esports reales para las
--                              predicciones. Ni siquiera habla de usuarios.
--   `duel_matches`           — es una partida, no un jugador. El rating es del jugador y tiene
--                              que sobrevivir a todas sus partidas.
--
--   Conclusión: no había dónde vivir. Vive aquí, y aquí SOLO vive esto.
--
-- ─────────────────────── LA SEPARACIÓN, DICHA UNA VEZ ───────────────────────
--
--   RATING DE DUELOS PvP  ≠  puntos de Pick'ems  ≠  XP  ≠  créditos  ≠  Elo competitivo 5v5.
--
--   No hay alias, ni vista, ni wrapper que junte dos de esas cosas. Si algún día alguien quiere
--   una pantalla que las muestre juntas, que las lea por separado y las junte en la pantalla.
--
-- ─────────────────────── LO QUE ESTA MIGRACIÓN NO HACE ───────────────────────
--
--   No reparte recompensas, no toca la economía, no crea temporadas, no crea ligas ni divisiones,
--   no crea leaderboard, no toca el motor de combate ni las reglas, no toca Pick'ems y no toca
--   las migraciones 0026–0028, que siguen pendientes por decisión ajena.
--
--   Y, sobre todo: **NO LIQUIDA NADA POR SU CUENTA**. `duel_pvp_settle_match` existe, es atómica
--   y es idempotente, pero NADIE la llama todavía. Crear una partida no mueve el rating; entrar
--   en cola no lo mueve; cancelar no lo mueve. El rating solo se mueve cuando alguien invoca
--   explícitamente la liquidación de una partida YA TERMINADA. Enganchar esa llamada al final
--   del duelo es del bloque de resolución competitiva. Ver docs/pvp/PVP-RATING.md §11.
--
-- REVERSIÓN (conceptual, no ejecutar sin decisión de producto)
--   drop function if exists public.duel_pvp_settle_match, public.duel_pvp_ensure_rating,
--     public.duel_pvp_rating_window, public.duel_pvp_expected_score;
--   drop table if exists public.duel_pvp_rating_events, public.duel_pvp_ratings;
--   alter table public.duel_pvp_queue alter column rating_snapshot drop not null;
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. EL RATING
-- ----------------------------------------------------------------------------
create table if not exists public.duel_pvp_ratings (
  /*
   * `user_id` ES la clave primaria. No hay una columna `id` aparte porque no aportaría nada:
   * un jugador tiene UN rating, y esa unicidad es justo lo que la clave primaria ya impone.
   * Añadir un `id` sintético obligaría además a un índice único adicional sobre `user_id` para
   * decir lo mismo dos veces, que es exactamente cómo aparecen los segundos ratings.
   */
  user_id      uuid primary key references auth.users(id) on delete cascade,

  /*
   * RATING INICIAL 1000, y no 1500, por dos razones — ninguna es «es lo habitual»:
   *
   *   1. Hace la separación VISIBLE EN LOS DATOS. `src/competitive/` y `team_ratings` arrancan
   *      en 1500. Si este sistema también arrancara en 1500, un 1500 suelto en un log o en una
   *      consulta no diría de qué sistema es. Un 1000 sí.
   *   2. Deja recorrido real por debajo antes del suelo. Con K=24 y suelo en 0, hacen falta
   *      decenas de derrotas consecutivas para acercarse; el suelo no es un techo disfrazado.
   *
   * El valor absoluto de un Elo es arbitrario: lo que significa algo son las DIFERENCIAS. Por eso
   * la elección se justifica por legibilidad y por separación, no por «calidad» del número.
   */
  rating       integer not null default 1000,

  /*
   * Contadores. `games_played` NO es `wins + losses + draws` por definición: se declara aparte
   * a propósito para que quepan resultados que hoy no se liquidan —el ABANDONO (D-PVP-7)— sin
   * tener que reinterpretar las tres columnas existentes. De ahí que la restricción sea `<=`
   * y no `=`. Ver §2.
   */
  games_played integer not null default 0,
  wins         integer not null default 0,
  losses       integer not null default 0,
  draws        integer not null default 0,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

/*
 * NO hay columna `provisional`. Se DERIVA de `games_played < 10`, que es el único dato del que
 * depende. Guardarla sería un segundo sitio donde el mismo hecho puede desincronizarse — la
 * misma razón por la que `PvpLifecycle` (7.2) se deriva y no se guarda.
 */

-- Ordenar por rating (emparejamiento y, el día que exista, clasificación).
create index if not exists duel_pvp_ratings_rating_idx on public.duel_pvp_ratings (rating desc);

-- ----------------------------------------------------------------------------
-- 2. INVARIANTES — la aritmética se defiende en la base de datos
-- ----------------------------------------------------------------------------
do $mig$
begin
  -- Un rating fuera de [0, 5000] es un error de cálculo, no un jugador excepcional. El techo
  -- existe para que un fallo de signo o un K disparatado se vea al escribir, no tres meses
  -- después en una clasificación.
  if not exists (select 1 from pg_constraint where conname = 'duel_pvp_ratings_range') then
    alter table public.duel_pvp_ratings
      add constraint duel_pvp_ratings_range check (rating >= 0 and rating <= 5000);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'duel_pvp_ratings_counters') then
    alter table public.duel_pvp_ratings
      add constraint duel_pvp_ratings_counters check (
        games_played >= 0 and wins >= 0 and losses >= 0 and draws >= 0
      );
  end if;

  /*
   * `<=` y no `=`: toda partida liquidada suma a `games_played`, pero no toda partida tiene que
   * caer en una de las tres categorías de hoy. Cuando el abandono se acredite (D-PVP-7), sumará
   * a `games_played` y a la categoría que se decida entonces, SIN romper esta restricción ni
   * obligar a recalcular las filas existentes.
   */
  if not exists (select 1 from pg_constraint where conname = 'duel_pvp_ratings_sum') then
    alter table public.duel_pvp_ratings
      add constraint duel_pvp_ratings_sum check (wins + losses + draws <= games_played);
  end if;
end
$mig$;

drop trigger if exists duel_pvp_ratings_touch on public.duel_pvp_ratings;
create trigger duel_pvp_ratings_touch before update on public.duel_pvp_ratings
  for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- 3. EL LIBRO — por qué existe
-- ----------------------------------------------------------------------------
--
-- Sin esta tabla, la única evidencia de un rating sería el propio número: «1137». Eso no se
-- puede auditar, no se puede disputar y no se puede recalcular si un día se descubre un error
-- en la fórmula. Con ella, cada movimiento dice de dónde salió y se puede REPRODUCIR: con
-- `old_rating`, `opponent_rating`, `k_factor` y `result` se recalcula el `delta` exacto.
--
-- Esos tres campos de contexto están precisamente por eso, no por completismo: sin el rating del
-- rival y sin la K, un `delta` es un número que hay que creerse.
create table if not exists public.duel_pvp_rating_events (
  id              bigserial primary key,

  /*
   * SIN clave foránea a `duel_matches`, y es una decisión:
   *
   *   Un libro de auditoría tiene que sobrevivir a lo que audita. `duel_matches` se borra en
   *   cascada cuando se borra un usuario, así que una FK con `cascade` se llevaría por delante
   *   la explicación del rating del RIVAL —que sigue vivo y sigue teniendo ese rating—, y una
   *   con `set null` rompería la clave de idempotencia `(match_id, user_id)`, que es justo lo
   *   que impide liquidar dos veces.
   *
   *   La integridad se garantiza en el sentido que importa: `duel_pvp_settle_match` EXIGE que la
   *   partida exista, sea PvP y esté terminada antes de escribir aquí. No se puede inventar un
   *   `match_id`.
   */
  match_id        uuid not null,
  user_id         uuid not null references auth.users(id) on delete cascade,

  old_rating      integer not null,
  delta           integer not null,
  new_rating      integer not null,
  /* Contexto que hace el delta REPRODUCIBLE. */
  opponent_rating integer not null,
  k_factor        integer not null,
  result          text    not null check (result in ('WIN','LOSS','DRAW')),

  created_at      timestamptz not null default now(),

  -- El delta registrado es SIEMPRE el efectivo (después de recortar contra los límites), así que
  -- esta igualdad tiene que cumplirse fila a fila.
  constraint duel_pvp_rating_events_math check (new_rating = old_rating + delta)
);

/*
 * LA CLAVE DE IDEMPOTENCIA. Un usuario cobra UNA vez por partida. Es el mismo mecanismo con el
 * que el libro mayor de economía garantiza «una partida, un pago» (0019) y con el que
 * `duel_match_actions` garantiza «una acción, una transición» (0031): no se comprueba antes de
 * escribir —eso tiene carrera— sino que la segunda escritura CHOCA.
 */
create unique index if not exists duel_pvp_rating_events_once
  on public.duel_pvp_rating_events (match_id, user_id);

-- «Explícame mi rating»: el historial de un jugador, del más reciente al más antiguo.
create index if not exists duel_pvp_rating_events_user_idx
  on public.duel_pvp_rating_events (user_id, created_at desc);

-- ----------------------------------------------------------------------------
-- 4. SEGURIDAD — el cliente no es autoridad de su propio rating
-- ----------------------------------------------------------------------------
--
-- Misma política, sin excepciones, que `duel_matches` (0014), `duel_match_actions` (0031) y
-- `duel_pvp_queue` (0032): RLS activo, CERO políticas y `revoke all`. Ni `anon`, ni
-- `authenticated`, ni el propio dueño de la fila pueden leerla o escribirla directamente.
--
-- Aquí la escritura es lo evidente —un jugador que puede hacer `update` sobre su rating no tiene
-- rating— pero la LECTURA directa también se cierra, y por dos motivos: para que el rating de
-- los demás no sea enumerable, y para que exista UN solo camino de lectura (el servidor) que
-- pueda decidir qué se proyecta. Un usuario ve SU rating porque el servidor se lo cuenta.
alter table public.duel_pvp_ratings       enable row level security;
alter table public.duel_pvp_rating_events enable row level security;
revoke all on public.duel_pvp_ratings       from anon, authenticated;
revoke all on public.duel_pvp_rating_events from anon, authenticated;
revoke all on sequence public.duel_pvp_rating_events_id_seq from anon, authenticated;

comment on table public.duel_pvp_ratings is
  'Rating PvP de DUELOS DE CARTAS (Bloque 7.4.1). NO es profiles.points (Pick''ems), NO es el Elo 5v5 de src/competitive/ y NO es team_ratings. RLS sin politicas: solo el servidor.';
comment on table public.duel_pvp_rating_events is
  'Libro de movimientos de rating PvP. Idempotencia por (match_id, user_id): un usuario cobra UNA vez por partida. Reproducible: old_rating + opponent_rating + k_factor + result determinan el delta.';
comment on column public.duel_pvp_ratings.rating is
  'Elo de duelos. Inicial 1000 (deliberadamente distinto del 1500 de src/competitive y team_ratings, para que la separacion se vea en los datos).';

-- ----------------------------------------------------------------------------
-- 5. LA MATEMÁTICA — Elo logístico estándar, y por qué vive en SQL
-- ----------------------------------------------------------------------------
--
-- El proyecto YA tiene esta fórmula en TypeScript: `src/domain/esports/predict/elo.ts`
-- (`expectedScore` / `updateElo`), que NO es del sistema 5v5 —es del dominio de predicciones— y
-- que `src/competitive/` simplemente reutiliza. Se auditó y es correcta.
--
-- Aun así la liquidación se escribe AQUÍ, y no allí, por la misma razón que el emparejamiento
-- del 7.4 vive en plpgsql: liquidar es «leer dos ratings + escribir dos filas de libro +
-- actualizar dos ratings» de forma INDIVISIBLE, y el cliente de Supabase no sabe abrir
-- transacciones de varias sentencias. Calcular en TypeScript obligaría a un ciclo
-- leer-calcular-escribir con reintentos por concurrencia optimista: más piezas para el mismo
-- resultado. La fórmula vive donde vive la transacción.
--
-- El riesgo de tener la fórmula en dos idiomas se cierra en el verificador, no con un comentario:
-- `pvp-rating-verify` usa `expectedScore`/`updateElo` de `elo.ts` como ORÁCULO y comprueba que
-- esta función SQL devuelve exactamente lo mismo. Si alguna de las dos deriva, el verify rompe.
--
-- NO se reutiliza `marginMultiplier`, y es deliberado: está calibrado para margen de MAPAS de una
-- serie (su propio comentario documenta 1-0→1.0, 3-0→~1.8). El marcador de un duelo llega a 10-0,
-- que en esa función amplifica ×2,5 — muy fuera del rango para el que se diseñó. Un duelo es UNA
-- partida, no una serie. El marcador se guarda igualmente en el libro, así que el día que se
-- quiera un término de margen se podrá calibrar con datos reales en vez de a ojo.
create or replace function public.duel_pvp_expected_score(p_own int, p_opponent int)
returns double precision language sql immutable set search_path = public as $$
  select 1.0 / (1.0 + power(10.0, (p_opponent - p_own) / 400.0));
$$;

/**
 * K-FACTOR. Dos escalones, y la frontera son 10 partidas.
 *
 *   provisional (< 10 partidas) → 40   El sistema no sabe nada del jugador: conviene que se
 *                                      mueva rápido hacia donde de verdad está.
 *   asentado    (>= 10)         → 24   Ya hay señal: se estabiliza para que una mala tarde no
 *                                      borre veinte partidas.
 *
 * No hay un tercer escalón por rating alto (como hace `src/competitive/`) porque eso solo tiene
 * sentido cuando existe una población grande y una cima que proteger. Hoy no la hay, y añadirlo
 * sería copiar una forma sin su motivo.
 */
create or replace function public.duel_pvp_k_factor(p_games_played int)
returns int language sql immutable set search_path = public as $$
  select case when p_games_played < 10 then 40 else 24 end;
$$;

-- ----------------------------------------------------------------------------
-- 6. ASEGURAR EL RATING — la única forma de que nazca una fila
-- ----------------------------------------------------------------------------
--
-- Idempotente por construcción: `on conflict do nothing` contra la clave primaria. Dos altas
-- simultáneas del mismo usuario no pueden crear dos ratings — lo impide la clave, no una
-- comprobación previa. El rating NUNCA se crea con un valor recibido de fuera: la columna tiene
-- DEFAULT y esta función no acepta ningún parámetro de rating.
create or replace function public.duel_pvp_ensure_rating(p_user uuid)
returns public.duel_pvp_ratings language plpgsql security definer set search_path = public as $$
declare
  v public.duel_pvp_ratings%rowtype;
begin
  insert into public.duel_pvp_ratings (user_id) values (p_user) on conflict (user_id) do nothing;
  select * into v from public.duel_pvp_ratings where user_id = p_user;
  return v;
end $$;

-- ----------------------------------------------------------------------------
-- 7. VENTANA DE EMPAREJAMIENTO
-- ----------------------------------------------------------------------------
--
-- CALIBRADA PARA LA POBLACIÓN QUE HAY, QUE ES CASI NINGUNA. Esto no es una disculpa, es el
-- criterio de diseño: una ventana estrecha y perpetua, con dos jugadores conectados, no produce
-- partidas justas — produce cero partidas.
--
--   0–15 s   ±150   El favorito gana ~70%. Un duelo desigual pero jugable.
--   15–45 s  ±300   ~85%. Ya es un estirón; solo tras esperar de verdad.
--   45–90 s  ±600   ~97%. Casi decidido, pero mejor que no jugar.
--   90 s+    libre  Pasado minuto y medio, cualquier rival es mejor que ninguno.
--
-- Los porcentajes salen de `duel_pvp_expected_score`, no de la intuición.
--
-- Y esto es solo la mitad de la política: la ventana dice qué es ACEPTABLE, pero
-- `duel_pvp_claim_pair` elige siempre al candidato con la MENOR diferencia de rating dentro de
-- ella. Que la ventana se abra hasta ±600 no significa que se empareje a ±600 si hay alguien a
-- ±20. Por eso «1000 contra 3000 habiendo alternativa» no puede ocurrir.
--
-- Las cuatro constantes están AQUÍ y solo aquí: retocarlas cuando haya jugadores reales es
-- cambiar cuatro números en una función, no rediseñar nada.
create or replace function public.duel_pvp_rating_window(p_wait_seconds double precision)
returns int language sql immutable set search_path = public as $$
  select case
    when p_wait_seconds < 15 then 150
    when p_wait_seconds < 45 then 300
    when p_wait_seconds < 90 then 600
    else 100000                      -- sin límite efectivo: el rango cabe en [0, 5000]
  end;
$$;

-- ----------------------------------------------------------------------------
-- 8. `rating_snapshot` DEJA DE SER NULL
-- ----------------------------------------------------------------------------
--
-- El 7.4 dejó la columna declarada y vacía. Ahora toda entrada de cola nace con el rating con el
-- que su dueño entró, y eso se convierte en INVARIANTE (`not null`), no en costumbre.
--
-- SEMÁNTICA — «rating actual» y «rating con el que entré» son cosas distintas:
--   El snapshot se fija AL ENTRAR y NO se recalcula. Si mientras espera termina otra partida suya
--   y su rating cambia, su entrada NO se toca. Emparejar contra un valor que se mueve bajo los
--   pies convertiría la elegibilidad en algo no reproducible: dos emparejadores mirando a la vez
--   podrían ver poblaciones distintas. El snapshot solo cambia saliendo de la cola y volviendo a
--   entrar, que es una acción explícita del jugador.
do $mig$
begin
  -- Relleno para cualquier entrada que ya estuviera en cola (en local no hay ninguna, pero la
  -- migración tiene que ser correcta también donde sí las haya).
  perform public.duel_pvp_ensure_rating(q.user_id)
     from (select distinct user_id from public.duel_pvp_queue where rating_snapshot is null) q;

  update public.duel_pvp_queue q
     set rating_snapshot = r.rating
    from public.duel_pvp_ratings r
   where r.user_id = q.user_id and q.rating_snapshot is null;

  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'duel_pvp_queue'
                and column_name = 'rating_snapshot' and is_nullable = 'YES') then
    alter table public.duel_pvp_queue alter column rating_snapshot set not null;
  end if;
end
$mig$;

comment on column public.duel_pvp_queue.rating_snapshot is
  'Rating con el que el jugador ENTRO en cola. Lo escribe duel_pvp_enqueue desde la autoridad del servidor; no existe ningun parametro por el que pueda llegar de fuera. No se recalcula mientras espera.';

-- Prefiltro indexable del emparejamiento: el rango de rating dentro de la cola viva.
create index if not exists duel_pvp_queue_rating_idx
  on public.duel_pvp_queue (rating_snapshot) where state = 'QUEUED';

-- ----------------------------------------------------------------------------
-- 8b. LA PROYECCION DE LA ENTRADA GANA EL SNAPSHOT
-- ----------------------------------------------------------------------------
--
-- Se reemplaza la proyeccion de la 0032 para que el jugador pueda ver CON QUE RATING entro. Es
-- dato suyo y solo suyo: esta funcion proyecta UNA fila, y la fila que se proyecta es siempre la
-- del usuario que pregunta (lo garantizan `duel_pvp_status` y `duel_pvp_cancel`, que filtran por
-- `user_id`). Sigue sin salir el `user_id`, ni el rating de nadie mas.
create or replace function public._duel_pvp_entry(q public.duel_pvp_queue)
returns jsonb language sql immutable set search_path = public as $$
  select jsonb_build_object(
    'entryId',        q.id,
    'userId',         q.user_id,
    'deckId',         q.deck_id,
    'state',          q.state,
    'ratingSnapshot', q.rating_snapshot,
    'matchId',   case when q.state = 'MATCHED' then q.match_id else null end,
    'reason',    q.closed_reason,
    'createdAt', (extract(epoch from q.created_at) * 1000)::bigint,
    'updatedAt', (extract(epoch from q.updated_at) * 1000)::bigint,
    'expiresAt', (extract(epoch from q.expires_at) * 1000)::bigint,
    'matchedAt', case when q.matched_at is null then null
                      else (extract(epoch from q.matched_at) * 1000)::bigint end
  );
$$;

-- ----------------------------------------------------------------------------
-- 9. ALTA EN COLA — ahora sella el rating
-- ----------------------------------------------------------------------------
--
-- Se REEMPLAZA la función de la 0032 para añadir UNA cosa: el sellado del rating. Todo lo demás
-- —propiedad del mazo, guarda de partida activa, idempotencia por índice único parcial— queda
-- exactamente igual.
--
-- Nótese que la firma NO gana ningún parámetro de rating. Es la diferencia entre «el servidor
-- ignora el rating que mande el cliente» y «no existe ningún camino por el que un rating pueda
-- entrar»: esto segundo no hay que recordar comprobarlo.
create or replace function public.duel_pvp_enqueue(
  p_user uuid, p_deck uuid, p_ttl_seconds int default 600
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v public.duel_pvp_queue%rowtype;
  v_rating int;
begin
  perform public._duel_pvp_sweep();

  if not exists (select 1 from public.duel_decks d where d.id = p_deck and d.user_id = p_user) then
    return jsonb_build_object('code', 'DECK_NOT_OWNED');
  end if;

  if public._duel_pvp_has_active_match(p_user) then
    return jsonb_build_object('code', 'ACTIVE_MATCH');
  end if;

  -- LA AUTORIDAD. El rating sale de la tabla de rating, y de ningún otro sitio.
  v_rating := (public.duel_pvp_ensure_rating(p_user)).rating;

  begin
    insert into public.duel_pvp_queue (user_id, deck_id, rating_snapshot, expires_at)
    values (p_user, p_deck, v_rating, now() + make_interval(secs => greatest(p_ttl_seconds, 10)))
    returning * into v;
    return jsonb_build_object('code', 'OK', 'entry', public._duel_pvp_entry(v));
  exception when unique_violation then
    select * into v from public.duel_pvp_queue
     where user_id = p_user and state in ('QUEUED','PAIRING');
    if not found then
      return jsonb_build_object('code', 'RETRY');
    end if;
    return jsonb_build_object('code', 'ALREADY_QUEUED', 'entry', public._duel_pvp_entry(v));
  end;
end $$;

-- ----------------------------------------------------------------------------
-- 9b. ESTADO DE LA BUSQUEDA — se corrige lo que `position` SIGNIFICA
-- ----------------------------------------------------------------------------
--
-- La funcion no cambia de comportamiento: sigue devolviendo la entrada viva o la ultima conocida,
-- y sigue contando cuantos llevan mas tiempo esperando. Lo que cambia es que su comentario decia
-- que `position` era «exactamente el significado del emparejamiento (FIFO)», y desde este bloque
-- ESO YA NO ES CIERTO: el emparejador elige al buscador por antiguedad pero a su rival por
-- cercania de rating, asi que alguien con posicion 3 puede emparejar antes que alguien con
-- posicion 1 si aparece su rival compatible.
--
-- Se reemplaza para que el comentario no mienta. `position` es una medida de ESPERA, no un turno
-- garantizado, y quien lea esta funcion tiene que enterarse aqui y no por sorpresa.
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

  -- Sigue siendo un agregado que no nombra a nadie: ni quien esta en cola, ni su mazo, ni su
  -- rating. La composicion de la cola no sale de aqui.
  if v.state = 'QUEUED' then
    select count(*) into v_pos from public.duel_pvp_queue q
     where q.state = 'QUEUED' and q.expires_at > now()
       and (q.created_at, q.id) < (v.created_at, v.id);
  end if;

  return jsonb_build_object('code', 'OK', 'entry', public._duel_pvp_entry(v), 'position', v_pos);
end $$;

-- ----------------------------------------------------------------------------
-- 10. RESERVAR PAREJA — ahora con criterio de rating
-- ----------------------------------------------------------------------------
--
-- Se REEMPLAZA la función de la 0032. **Las garantías de concurrencia del 7.4 no cambian**:
-- sigue siendo `for update skip locked`, sigue reservando el id de la partida por adelantado,
-- sigue siendo «las dos entradas o ninguna» y sigue verificando la guarda de partida activa
-- dentro de la misma transacción.
--
-- Lo que cambia es CÓMO se elige la pareja. Antes: los dos más antiguos. Ahora, dos pasos:
--
--   1. EL BUSCADOR es el que más ha esperado. Esto es lo que conserva la prioridad FIFO: nadie
--      adelanta a quien lleva más tiempo por tener mejor rating.
--   2. SU RIVAL es, de entre los compatibles, el de MENOR diferencia de rating; a igualdad de
--      diferencia, el que más ha esperado. Determinista y sin azar.
--
-- Compatible = la diferencia cabe en la ventana que ha abierto el que MÁS ha esperado de los dos.
-- Se usa el mayor de los dos tiempos a propósito: exigir que ambos hayan esperado obligaría al
-- recién llegado a cumplir una espera que no le aporta nada — el rival ya la ha hecho por los dos.
--
-- Con todos los ratings iguales (población nueva, todos a 1000) la diferencia es 0 para todos y
-- el desempate por antigüedad reproduce EXACTAMENTE el comportamiento FIFO del 7.4.
create or replace function public.duel_pvp_claim_pair(p_lease_seconds int default 20)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  a public.duel_pvp_queue%rowtype;
  b public.duel_pvp_queue%rowtype;
  n int;
  v_token uuid := gen_random_uuid();
  v_match uuid := gen_random_uuid();
begin
  /*
   * ─────────────── POR QUÉ ESTA FUNCIÓN SE SERIALIZA CONSIGO MISMA ───────────────
   *
   * En el bloque 7.4 la selección era UNA consulta (`limit 2 ... for update skip locked`), así
   * que `skip locked` bastaba: el emparejador que llegaba segundo saltaba las dos filas y se iba.
   *
   * El criterio de rating obliga a DOS consultas —primero el buscador, después su mejor rival—, y
   * eso abre un fallo que el verificador de este bloque encontró a la primera: con dos
   * emparejadores y dos candidatos, cada uno bloquea a uno como SU buscador y luego se encuentra
   * al otro bloqueado por el rival. Los dos saltan, los dos se van con las manos vacías y NADIE
   * empareja. No es un interbloqueo —nadie espera— pero el resultado es peor: nadie avanza.
   *
   * Se cierra con un cerrojo consultivo de transacción tomado ANTES que cualquier fila, así que
   * el orden de bloqueo es siempre el mismo (cerrojo → filas) y no hay interbloqueo posible. Se
   * usa la variante que ESPERA, no la que se rinde: el que llega segundo se queda unos
   * milisegundos, y cuando entra encuentra la cola ya sin los dos que acaban de emparejarse y
   * empareja a los SIGUIENTES. Rendirse habría convertido «4 candidatos y 2 emparejadores» en una
   * sola pareja en vez de dos.
   *
   * El coste es que el emparejamiento es globalmente secuencial. Medido, la función entera son
   * unos milisegundos, así que el techo está en el orden de cientos de emparejamientos por
   * segundo — muy por encima de cualquier población previsible. Queda anotado como deuda
   * (D-MM-4) para el día que deje de serlo.
   */
  perform pg_advisory_xact_lock(hashtext('duel_pvp_matchmaker')::bigint);

  perform public._duel_pvp_sweep();

  -- ── 1. El buscador: el que más lleva esperando ──
  select * into a
    from public.duel_pvp_queue q
   where q.state = 'QUEUED'
     and q.expires_at > now()
     and not public._duel_pvp_has_active_match(q.user_id)
   order by q.created_at, q.id
   limit 1
   for update skip locked;

  if not found then
    return jsonb_build_object('code', 'NO_CANDIDATES');
  end if;

  -- ── 2. Su mejor rival compatible ──
  select * into b
    from public.duel_pvp_queue q
   where q.state = 'QUEUED'
     and q.expires_at > now()
     and q.id <> a.id
     -- Cinturón además del índice único parcial: jamás contra uno mismo.
     and q.user_id <> a.user_id
     -- Prefiltro INDEXABLE (duel_pvp_queue_rating_idx) con la ventana máxima posible; el filtro
     -- exacto, que depende del tiempo de espera de cada fila, va justo debajo.
     and q.rating_snapshot between a.rating_snapshot - 100000 and a.rating_snapshot + 100000
     and abs(q.rating_snapshot - a.rating_snapshot) <= public.duel_pvp_rating_window(
           greatest(extract(epoch from (now() - a.created_at)),
                    extract(epoch from (now() - q.created_at))))
     and not public._duel_pvp_has_active_match(q.user_id)
   order by abs(q.rating_snapshot - a.rating_snapshot), q.created_at, q.id
   limit 1
   for update skip locked;

  if not found then
    -- Hay gente esperando pero nadie compatible TODAVÍA. No es un error: es la ventana haciendo
    -- su trabajo. En cuanto pase el tiempo suficiente, el siguiente intento los emparejará.
    return jsonb_build_object('code', 'NO_CANDIDATES');
  end if;

  if a.user_id = b.user_id then
    return jsonb_build_object('code', 'NO_CANDIDATES');
  end if;

  update public.duel_pvp_queue
     set state = 'PAIRING', pair_token = v_token, match_id = v_match,
         pairing_expires_at = now() + make_interval(secs => greatest(p_lease_seconds, 5))
   where id in (a.id, b.id) and state = 'QUEUED';
  get diagnostics n = row_count;

  if n <> 2 then
    raise exception 'duel_pvp_claim_pair: reserva parcial (% de 2)', n;
  end if;

  return jsonb_build_object(
    'code', 'PAIRED',
    'pairToken', v_token,
    'matchId', v_match,
    'ratingGap', abs(a.rating_snapshot - b.rating_snapshot),
    'a', jsonb_build_object('entryId', a.id, 'userId', a.user_id, 'deckId', a.deck_id),
    'b', jsonb_build_object('entryId', b.id, 'userId', b.user_id, 'deckId', b.deck_id)
  );
end $$;

-- ----------------------------------------------------------------------------
-- 11. LIQUIDACIÓN — atómica, idempotente, y NADIE la llama todavía
-- ----------------------------------------------------------------------------
--
-- Lee el resultado AUTORITATIVO que ya existe en `duel_matches` (`status` + `winner`, escritos
-- por el orquestador en `applyPvpAction`) y mueve los dos ratings. El cliente no interviene: no
-- hay parámetro de ganador, ni de delta, ni de rating. Solo un `match_id`.
--
-- QUÉ SE LIQUIDA Y QUÉ NO:
--   COMPLETED con winner A|B  → WIN / LOSS
--   DRAW                      → DRAW para los dos
--   WAITING / IN_PROGRESS     → NOT_FINISHED. Una partida a medias no vale nada.
--   UNRESOLVED                → NOT_FINISHED. Inalcanzable con las reglas vigentes; si apareciera
--                               sería un fallo interno, y un fallo interno no reparte rating.
--   closed_reason IS NOT NULL → ABANDONED_NOT_SETTLED. El abandono NO se acredita aquí: eso es
--                               D-PVP-7 y necesita una decisión de producto (¿derrota completa?,
--                               ¿penalización?). El modelo lo soporta —`closed_by` dice quién se
--                               fue— pero inventar la política sería inventar el juego.
--
-- IDEMPOTENCIA: la impone el índice único `(match_id, user_id)`. La segunda llamada no vuelve a
-- calcular ni «detecta» nada por su cuenta: choca contra la clave. `settle(m); settle(m)` deja
-- exactamente un movimiento por jugador.
--
-- ORDEN DE BLOQUEO: las dos filas de rating se bloquean ORDENADAS POR `user_id`. Sin ese orden,
-- dos liquidaciones simultáneas de dos partidas que comparten jugadores podrían bloquearse
-- mutuamente en orden inverso — un interbloqueo de manual.
create or replace function public.duel_pvp_settle_match(p_match uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  m         record;
  ra        public.duel_pvp_ratings%rowtype;
  rb        public.duel_pvp_ratings%rowtype;
  score_a   double precision;
  k_a       int;
  k_b       int;
  delta_a   int;
  delta_b   int;
  new_a     int;
  new_b     int;
  res_a     text;
  res_b     text;
  inserted  int;
begin
  select id, mode, status, winner, user_id, player_b_id, closed_reason
    into m
    from public.duel_matches
   where id = p_match;

  if not found then                       return jsonb_build_object('code', 'NO_MATCH');       end if;
  if m.mode <> 'PVP' then                 return jsonb_build_object('code', 'NOT_PVP');        end if;
  if m.player_b_id is null then           return jsonb_build_object('code', 'NOT_PVP');        end if;
  if m.closed_reason is not null then     return jsonb_build_object('code', 'ABANDONED_NOT_SETTLED'); end if;
  if m.status not in ('COMPLETED','DRAW') then
    return jsonb_build_object('code', 'NOT_FINISHED', 'status', m.status);
  end if;
  if m.status = 'COMPLETED' and (m.winner is null or m.winner not in ('A','B')) then
    return jsonb_build_object('code', 'NOT_FINISHED', 'status', m.status);
  end if;

  perform public.duel_pvp_ensure_rating(m.user_id);
  perform public.duel_pvp_ensure_rating(m.player_b_id);

  -- Salida rápida y barata: ya estaba liquidada. La garantía real la da el índice único de más
  -- abajo; esto solo evita hacer el trabajo dos veces.
  if exists (select 1 from public.duel_pvp_rating_events e where e.match_id = p_match) then
    return jsonb_build_object('code', 'ALREADY_SETTLED');
  end if;

  -- Bloqueo ORDENADO: ver la cabecera.
  perform 1 from public.duel_pvp_ratings
   where user_id in (m.user_id, m.player_b_id) order by user_id for update;

  select * into ra from public.duel_pvp_ratings where user_id = m.user_id;
  select * into rb from public.duel_pvp_ratings where user_id = m.player_b_id;

  if m.status = 'DRAW' then
    score_a := 0.5; res_a := 'DRAW'; res_b := 'DRAW';
  elsif m.winner = 'A' then
    score_a := 1.0; res_a := 'WIN';  res_b := 'LOSS';
  else
    score_a := 0.0; res_a := 'LOSS'; res_b := 'WIN';
  end if;

  /*
   * K por jugador, NO compartida: si uno es provisional y el otro no, se mueven distinto. Eso
   * hace que el intercambio NO sea de suma cero, y es intencionado — un novato debe converger
   * rápido sin arrastrar consigo el rating de un veterano. Ese es el precio de tener
   * provisionalidad, y es el precio correcto.
   */
  k_a := public.duel_pvp_k_factor(ra.games_played);
  k_b := public.duel_pvp_k_factor(rb.games_played);

  delta_a := round(k_a * (score_a       - public.duel_pvp_expected_score(ra.rating, rb.rating)));
  delta_b := round(k_b * ((1 - score_a) - public.duel_pvp_expected_score(rb.rating, ra.rating)));

  -- Recorte contra los límites de la columna. El delta que se ESCRIBE en el libro es el efectivo,
  -- para que `new_rating = old_rating + delta` se cumpla siempre (lo exige una restricción).
  new_a := least(5000, greatest(0, ra.rating + delta_a));
  new_b := least(5000, greatest(0, rb.rating + delta_b));
  delta_a := new_a - ra.rating;
  delta_b := new_b - rb.rating;

  insert into public.duel_pvp_rating_events
    (match_id, user_id, old_rating, delta, new_rating, opponent_rating, k_factor, result)
  values
    (p_match, ra.user_id, ra.rating, delta_a, new_a, rb.rating, k_a, res_a),
    (p_match, rb.user_id, rb.rating, delta_b, new_b, ra.rating, k_b, res_b)
  on conflict (match_id, user_id) do nothing;
  get diagnostics inserted = row_count;

  -- LA PUERTA. Si otra transacción liquidó esta partida mientras tanto, aquí se insertaron 0
  -- filas y NO se toca ni un rating.
  if inserted <> 2 then
    return jsonb_build_object('code', 'ALREADY_SETTLED');
  end if;

  update public.duel_pvp_ratings
     set rating = new_a, games_played = games_played + 1,
         wins   = wins   + (case when res_a = 'WIN'  then 1 else 0 end),
         losses = losses + (case when res_a = 'LOSS' then 1 else 0 end),
         draws  = draws  + (case when res_a = 'DRAW' then 1 else 0 end)
   where user_id = ra.user_id;

  update public.duel_pvp_ratings
     set rating = new_b, games_played = games_played + 1,
         wins   = wins   + (case when res_b = 'WIN'  then 1 else 0 end),
         losses = losses + (case when res_b = 'LOSS' then 1 else 0 end),
         draws  = draws  + (case when res_b = 'DRAW' then 1 else 0 end)
   where user_id = rb.user_id;

  return jsonb_build_object(
    'code', 'SETTLED',
    'matchId', p_match,
    'a', jsonb_build_object('userId', ra.user_id, 'oldRating', ra.rating, 'delta', delta_a,
                            'newRating', new_a, 'kFactor', k_a, 'result', res_a),
    'b', jsonb_build_object('userId', rb.user_id, 'oldRating', rb.rating, 'delta', delta_b,
                            'newRating', new_b, 'kFactor', k_b, 'result', res_b)
  );
end $$;

-- ----------------------------------------------------------------------------
-- 12. CONCESIONES — solo el servidor
-- ----------------------------------------------------------------------------
do $mig$
declare f text;
begin
  foreach f in array array[
    'duel_pvp_expected_score(int,int)', 'duel_pvp_k_factor(int)',
    'duel_pvp_rating_window(double precision)', 'duel_pvp_ensure_rating(uuid)',
    'duel_pvp_settle_match(uuid)',
    -- Reemplazadas en esta migración: hay que reponerles las concesiones.
    'duel_pvp_enqueue(uuid,uuid,int)', 'duel_pvp_claim_pair(int)',
    '_duel_pvp_entry(public.duel_pvp_queue)', 'duel_pvp_status(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end
$mig$;
