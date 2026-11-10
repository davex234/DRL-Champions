-- ============================================================================
-- 0031 — MODELO DE PARTIDA PvP (Bloque 7.2)
--
-- QUÉ RESUELVE
--   `duel_matches` nació para UNA persona contra un bot: un `user_id`, un `deck_id` y una
--   `difficulty` obligatoria. No puede representar A contra B. Esta migración lo EXTIENDE
--   —no lo sustituye— para que la misma tabla pueda sostener los dos modos.
--
-- POR QUÉ AQUÍ Y NO EN UNA TABLA NUEVA
--   Una segunda tabla de partidas duplicaría el concepto y, sobre todo, rompería la clave de
--   idempotencia de recompensa `duel:<matchId>`, que ya garantiza «una partida, un pago»
--   mediante el índice único del libro mayor. Un solo espacio de ids de partida mantiene esa
--   garantía intacta para los dos modos.
--
-- COMPATIBILIDAD CON LOS DATOS EXISTENTES (requisito duro)
--   TODAS las columnas nuevas son opcionales o traen valor por defecto, así que ninguna fila
--   PvE existente se toca ni se reinterpreta:
--     · `mode` entra con default 'PVE'  → lo que hay hoy ya ES PvE, y se etiqueta como tal.
--     · `player_b_id`/`deck_b_id` quedan NULL en PvE → el rival bot NO es un usuario y no se
--       le inventa uno.
--     · `state_version` arranca en 0 para todos.
--   Ninguna partida PvE se convierte en PvP. La restricción `duel_matches_mode_shape` lo
--   IMPIDE activamente: en modo PVE, `player_b_id` tiene que ser NULL.
--
-- IDENTIDAD DE BANDO — SIN AMBIGÜEDAD
--   `user_id` ES el jugador A, y lo dice la restricción, no un comentario: en PvP,
--   `player_b_id` ha de existir y ser DISTINTO de `user_id`. No se añade un `player_a_id`
--   redundante porque dos columnas para el mismo hecho es exactamente cómo se desincronizan
--   las cosas. El bando de cada usuario lo traduce `sideForPlayer()`, que es el único sitio
--   del código que compara ids con bandos.
--
-- LO QUE ESTA MIGRACIÓN NO TOCA
--   Economía, telemetría, analítica, mercado, Pick'ems, `profiles`, `credit_transactions`,
--   `economy_ops` ni ninguna función de recompensa. Tampoco las migraciones 0026–0028, que
--   siguen pendientes por decisión ajena a este bloque.
--
-- REVERSIÓN (conceptual, no ejecutar sin decisión de producto)
--   alter table public.duel_matches
--     drop constraint if exists duel_matches_mode_shape,
--     drop constraint if exists duel_matches_closed_shape,
--     drop column if exists mode, drop column if exists player_b_id,
--     drop column if exists deck_b_id, drop column if exists state_version,
--     drop column if exists closed_reason, drop column if exists closed_by,
--     drop column if exists closed_at, drop column if exists turn_started_at,
--     drop column if exists turn_deadline_at;
--   drop table if exists public.duel_match_actions;
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Extensión de `duel_matches`
-- ----------------------------------------------------------------------------
alter table public.duel_matches
  -- Frontera entre los dos ciclos de vida. PvE conserva su comportamiento histórico.
  add column if not exists mode             text not null default 'PVE',
  -- Jugador B. Solo en PvP; en PvE el rival es un bot y NO es un usuario.
  add column if not exists player_b_id      uuid references auth.users(id) on delete cascade,
  -- Mazo de B. Misma política de borrado que `deck_id` (se conserva la partida, se pierde la
  -- referencia): una partida jugada no puede desaparecer porque alguien borre su mazo.
  add column if not exists deck_b_id        uuid references public.duel_decks(id) on delete set null,
  -- Concurrencia optimista. Monotónico; lo escribe el servidor en cada transición.
  add column if not exists state_version    integer not null default 0,
  -- Cierre de SESIÓN (no de reglas). El motor no define abandono y sigue sin definirlo.
  add column if not exists closed_reason    text,
  add column if not exists closed_by        uuid references auth.users(id) on delete set null,
  add column if not exists closed_at        timestamptz,
  -- Reloj de turno. Autoridad del servidor; el cliente ni lo escribe ni lo negocia.
  add column if not exists turn_started_at  timestamptz,
  add column if not exists turn_deadline_at timestamptz;

-- ----------------------------------------------------------------------------
-- 2. Restricciones — el modelo se defiende en la base de datos, no solo en TypeScript
-- ----------------------------------------------------------------------------
do $mig$
begin
  if not exists (select 1 from pg_constraint where conname = 'duel_matches_mode_check') then
    alter table public.duel_matches
      add constraint duel_matches_mode_check check (mode in ('PVE','PVP'));
  end if;

  -- LA restricción de este bloque. Cubre de una vez los tres invariantes de identidad:
  --   · PvE  ⇒ no hay jugador B ni mazo B (el rival es un bot).
  --   · PvP  ⇒ hay jugador B Y mazo B, y B NO ES A.
  -- `player_b_id <> user_id` es lo que hace imposible una partida contra uno mismo, aunque
  -- un fallo de servidor lo intentara.
  if not exists (select 1 from pg_constraint where conname = 'duel_matches_mode_shape') then
    alter table public.duel_matches
      add constraint duel_matches_mode_shape check (
        (mode = 'PVE' and player_b_id is null and deck_b_id is null)
        or
        (mode = 'PVP' and player_b_id is not null and deck_b_id is not null
                      and player_b_id <> user_id)
      );
  end if;

  -- El cierre es todo-o-nada: o hay motivo y momento, o no hay cierre.
  if not exists (select 1 from pg_constraint where conname = 'duel_matches_closed_shape') then
    alter table public.duel_matches
      add constraint duel_matches_closed_shape check (
        (closed_reason is null and closed_at is null and closed_by is null)
        or
        (closed_reason in ('ABANDONED','EXPIRED') and closed_at is not null)
      );
  end if;

  -- Una versión no puede nacer negativa ni retroceder por debajo de cero.
  if not exists (select 1 from pg_constraint where conname = 'duel_matches_state_version_check') then
    alter table public.duel_matches
      add constraint duel_matches_state_version_check check (state_version >= 0);
  end if;
end
$mig$;

-- Buscar «mis partidas PvP» por el lado B sin abrir un jsonb. Parcial: no indexa el PvE histórico.
create index if not exists duel_matches_pvp_b_idx
  on public.duel_matches (player_b_id, status) where mode = 'PVP';

-- Barrido de partidas cuyo turno ha vencido (lo consumirá el bloque del reloj, que aún no existe).
create index if not exists duel_matches_pvp_deadline_idx
  on public.duel_matches (turn_deadline_at) where mode = 'PVP' and closed_reason is null;

-- ----------------------------------------------------------------------------
-- 3. IDEMPOTENCIA DE ACCIÓN — `action_id`
-- ----------------------------------------------------------------------------
--
-- Por qué una tabla y no una columna `last_action_id`:
--
--   Una columna solo recuerda la ÚLTIMA acción, así que solo protege del reintento inmediato.
--   Esta tabla es un libro de acciones con `primary key (match_id, action_id)`: el segundo
--   envío de la misma acción CHOCA contra la clave y no llega a aplicarse. Es exactamente el
--   mecanismo con el que el libro mayor de economía garantiza «una partida, un pago», y
--   reutilizar el patrón es preferible a inventar otro.
--
--   Además deja rastro auditable —qué versión había antes y cuál después de cada acción—,
--   que es lo que hará falta para resolver una disputa sin reconstruir la partida entera.
--
-- IMPORTANTE: esta tabla NO es un registro de recompensas. La recompensa sigue siendo del
-- RESULTADO de la partida, con clave `duel:<matchId>`, porque una partida contiene muchas
-- acciones y pagar por acción sería pagar diez veces.
create table if not exists public.duel_match_actions (
  match_id             uuid not null references public.duel_matches(id) on delete cascade,
  -- Clave de idempotencia que elige el cliente, pero que NO le da ninguna autoridad: solo
  -- sirve para que reconozcamos su propio reintento.
  action_id            uuid not null,
  -- Quién la envió, ya autenticado. Nunca sale del cuerpo de la petición.
  player_id            uuid not null references auth.users(id) on delete cascade,
  state_version_before integer not null,
  state_version_after  integer not null,
  created_at           timestamptz not null default now(),
  primary key (match_id, action_id),
  constraint duel_match_actions_version_advances check (state_version_after > state_version_before)
);

-- Releer la última acción aplicada de una partida (reintento tras un corte de red).
create index if not exists duel_match_actions_match_ver_idx
  on public.duel_match_actions (match_id, state_version_after desc);

-- ----------------------------------------------------------------------------
-- 4. SEGURIDAD — misma política que `duel_matches`: el cliente no ve nada
-- ----------------------------------------------------------------------------
--
-- `duel_matches` DENIEGA todo a `anon` y `authenticated` (0014) y no tiene ni una política.
-- El libro de acciones hereda esa decisión: contiene versiones de estado y trazas de juego,
-- y toda lectura debe pasar por el servidor, que proyecta lo que cada jugador puede ver.
alter table public.duel_match_actions enable row level security;
revoke all on public.duel_match_actions from anon, authenticated;

comment on table public.duel_match_actions is
  'Libro de acciones PvP (Bloque 7.2). Idempotencia por (match_id, action_id) y rastro de versiones. NO es un registro de recompensas: la recompensa es del resultado, con clave duel:<matchId>.';

comment on column public.duel_matches.mode is
  'PVE (rival bot, comportamiento historico) | PVP (dos usuarios). Default PVE: los datos existentes ya son PvE.';
comment on column public.duel_matches.state_version is
  'Concurrencia optimista. Toda escritura PvP condiciona por este valor; dos acciones sobre la misma version no pueden triunfar las dos.';
comment on column public.duel_matches.closed_reason is
  'Cierre de SESION, no de reglas: ABANDONED | EXPIRED. El motor de duelo sigue sin definir abandono. Una partida PvP abandonada NO se borra.';
