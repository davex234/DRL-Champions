-- ═══════════════════════════════════════════════════════════════════════════════════════
-- 0044 · PARTIDOS DIRIGIDOS — el historial del Entrenador
--
-- ────────────────────────── POR QUÉ NO EXISTÍA ──────────────────────────
--
-- El bloque anterior lo dejó por escrito: `MatchState` vive en memoria del navegador y muere
-- al recargar. `useCareerStore.processMatch` lo consumía al terminar para evolucionar a los
-- jugadores, pero del partido en sí no quedaba nada — ni quién era el rival, ni cómo acabó.
-- La pantalla «Partidos jugados» estaba declarada como pendiente porque no había NADA que
-- enseñar, y rellenarla con filas inventadas habría sido peor que el hueco.
--
-- ────────────────────────── QUÉ SE GUARDA, Y QUÉ NO ──────────────────────────
--
-- El RESUMEN, no el partido. `MatchState` lleva dentro las rondas completas, los eventos, la
-- narrativa, la economía y la memoria táctica: decenas de miles de objetos por partido. Nada
-- de eso se consulta para pintar un historial —que responde a «contra quién, en qué mapa, cómo
-- quedó y cuándo»— así que aquí solo van esas columnas y ninguna más.
--
-- No se guarda el roster del rival, ni sus decisiones, ni su economía: no hacen falta para el
-- historial y guardar el estado de otro jugador es guardarse un problema.
--
-- ────────────────────────── LA IDEMPOTENCIA: `seed` ──────────────────────────
--
-- `seed` es la semilla maestra del partido —la que hace la simulación reproducible— y se
-- genera una vez, al empezar. Es por tanto un identificador natural de ESE partido y de ningún
-- otro, así que `(user_id, seed)` es único.
--
-- Eso es lo que hace que recargar la pantalla final no cree un segundo partido: el segundo
-- intento choca contra la clave y no escribe. No hace falta un token de idempotencia aparte
-- porque el dato que lo identifica ya existía.
--
-- ────────────────────────── HASTA DÓNDE LLEGA LA AUTORIDAD DEL SERVIDOR ──────────────────────────
--
-- Conviene decirlo claro, porque es fácil leer de más en «server-authoritative».
--
--   SÍ manda el servidor:
--     · QUIÉN es el dueño. Sale del token, nunca del cuerpo de la petición.
--     · QUE la fila se pueda escribir. El cliente NO tiene `insert`: escribe el servidor con
--       `service_role`, igual que en `duel_matches`.
--     · QUÉ valores son admisibles. Rangos, enumerados y longitudes se comprueban aquí y en
--       la ruta, así que ningún cuerpo raro deja una fila absurda.
--     · QUIÉN puede leerla. Solo su dueño, por RLS.
--
--   NO manda el servidor:
--     · El RESULTADO. El simulador del Entrenador corre en el navegador —es su diseño desde
--       el principio— así que el marcador que se guarda es el que informa el cliente.
--
-- Por eso esta tabla es un HISTORIAL PERSONAL y no un registro competitivo: no puntúa, no
-- concede nada y no alimenta ningún ranking. Las recompensas del partido siguen aplicándose
-- por su camino de siempre (`grantMatchOutcomeReward`), que no toca esta tabla. Convertir esto
-- en algo con premio exigiría mover el simulador al servidor, que es otro proyecto.
-- ═══════════════════════════════════════════════════════════════════════════════════════

begin;

create table if not exists public.coach_matches (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,

  /* Semilla maestra del partido. Identifica ESE partido: es la clave de idempotencia. */
  seed          bigint not null check (seed >= 0 and seed <= 4294967295),

  /* Contra quién y con qué equipo. Nombres visibles, no identificadores de nadie. */
  team_name     text not null check (length(team_name) between 1 and 60),
  rival_name    text not null check (length(rival_name) between 1 and 60),
  difficulty    text not null check (difficulty in ('easy', 'normal', 'hard')),

  /*
   * DÓNDE. Hoy siempre Ascent · sitio A, porque es el único mapa que el simulador tiene
   * (`src/sim/map/ascentA.ts`). Se guardan como columnas y no como constante para que el día
   * que el motor soporte más mapas el historial antiguo siga diciendo la verdad sobre dónde
   * se jugó, en vez de heredar el mapa nuevo.
   */
  map_id        text not null check (length(map_id) between 1 and 40),
  map_site      text check (length(map_site) between 1 and 8),

  /* Lado inicial SORTEADO (nunca elegido). Se guarda porque explica el partido. */
  start_side    text not null check (start_side in ('ATK', 'DEF')),

  /* Cómo quedó. `won` es derivable del marcador, pero se guarda para poder filtrar sin OR. */
  score_home    integer not null check (score_home between 0 and 99),
  score_away    integer not null check (score_away between 0 and 99),
  won           boolean not null,
  rounds        integer not null check (rounds between 0 and 99),

  /* Duración simulada del partido, en segundos. `null` si el motor no la reporta. */
  duration_s    integer check (duration_s between 0 and 86400),
  /* Jugador destacado, si el partido nombró uno. */
  mvp           text check (length(mvp) between 1 and 60),

  finished_at   timestamptz not null default now(),
  created_at    timestamptz not null default now(),

  /* LA IDEMPOTENCIA. Recargar la pantalla final no puede crear un segundo partido. */
  constraint coach_matches_user_seed_key unique (user_id, seed)
);

/* La consulta del historial: los míos, los más recientes primero. */
create index if not exists coach_matches_user_idx
  on public.coach_matches (user_id, finished_at desc);

alter table public.coach_matches enable row level security;

/*
 * LEER: solo lo tuyo. Es la única política que existe, y es deliberado.
 *
 * El cliente puede consultar su historial directamente, porque leerlo no cambia nada. Lo que
 * no puede es escribirlo: sin política de `insert` y sin permiso, la escritura solo llega por
 * el servidor con `service_role`, que es quien decide el `user_id` a partir del token.
 */
drop policy if exists coach_matches_select_own on public.coach_matches;
create policy coach_matches_select_own on public.coach_matches
  for select to authenticated
  using (user_id = auth.uid());

/*
 * PERMISOS, al mínimo y explícitos.
 *
 * Supabase concede por defecto a `anon` y `authenticated` SELECT, TRUNCATE, REFERENCES y
 * TRIGGER sobre cada tabla nueva de `public`. RLS filtra las filas del SELECT, pero TRUNCATE no
 * pasa por RLS. Revocar solo insert/update/delete —como se hacía— dejaba esos cuatro puestos.
 * Se revoca todo y se devuelve únicamente lo que hace falta: leer lo propio con sesión.
 * `anon` no tiene nada que leer aquí.
 */
revoke all on public.coach_matches from anon, authenticated;
grant select on public.coach_matches to authenticated;
grant all on public.coach_matches to service_role;

commit;
