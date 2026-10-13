-- 0051 · ROAD TO CHAMPIONS (Fase 35 · Card Game Modes 2.0) — APLICADA (VPS 2026-09-15, Fase 35.1).
--
-- Estado: fichero LOCAL. Aplicada en la BD del VPS el 2026-09-15 12:02Z (Fase 35.1). No tocar `schema_migrations`.
--
-- POR QUÉ HACE FALTA. La campaña necesita recordar, por usuario, qué nodos ha completado y enlazar cada
-- partida con el nodo que la lanzó. Nada de lo existente sirve sin romper contratos:
--   · `duel_matches` no tiene columna de contexto y su `mode` (PVE/PVP/PVP_PRIVATE) lo leen la cola, el
--     rating, las repeticiones y el perfil: añadir un modo `CAMPAIGN` cambiaría todos esos filtros. La
--     partida de campaña ES una partida PVE normal; el enlace vive aparte.
--   · `profiles`/`player_progression` son de otras autoridades (cuenta, pase) y parte es legible por todos.
-- Por eso: dos tablas nuevas, SOLO servidor.
--
--   campaign_progress  → una fila por (usuario, campaña, nodo): estado, mejor resultado, intentos, primera victoria.
--   campaign_attempts  → una fila por partida lanzada desde un nodo. `match_id` único = idempotencia de la liquidación.
--
-- GARANTÍAS EN LA BASE DE DATOS (no solo en TypeScript):
--   · Un solo intento abierto por usuario (índice único parcial `status = 'STARTED'`): dos pestañas no lanzan
--     dos nodos a la vez.
--   · Una partida liquida UN intento (`match_id` único) y la transición STARTED → SETTLED es condicional.
--   · Una sola primera victoria por (usuario, campaña, nodo) (índice único parcial `first_clear`).
--   · El pago de la primera victoria va además por `app_grant_reward` con clave `campaign:<campaña>:<nodo>`,
--     cuyo índice único del libro mayor impide pagar dos veces (ni con otra versión de la definición).
--
-- QUÉ NO HACE. No toca `duel_matches`, ni el combate, ni el rating, ni la cola, ni el liquidador ranked, ni la
-- economía (sin moneda nueva, sin stamina, sin tickets). No borra progreso al publicar una versión nueva.
--
-- DEGRADACIÓN SIN APLICAR. El servicio detecta la tabla ausente (42P01 / PGRST205) y responde
-- «ROAD TO CHAMPIONS TODAVÍA NO DISPONIBLE» (lectura 200 con `available: false`; lanzar un nodo 503
-- MIGRATION_PENDING). No hay sustituto en localStorage.
--
-- REVERSIÓN (conceptual): drop table public.campaign_attempts; drop table public.campaign_progress;
--
-- Aditiva e idempotente.

create table if not exists public.campaign_progress (
  user_id              uuid not null references auth.users(id) on delete cascade,
  campaign_id          text not null check (campaign_id ~ '^[a-z0-9-]{1,40}$'),
  node_id              text not null check (node_id ~ '^c[0-9]{1,2}-n[0-9]{1,2}$'),
  campaign_version     text not null check (char_length(campaign_version) between 1 and 16),
  status               text not null check (status in ('ATTEMPTED', 'COMPLETED')),
  best_result          text check (best_result in ('WIN', 'LOSS', 'DRAW')),
  attempts             integer not null default 0 check (attempts >= 0),
  wins                 integer not null default 0 check (wins >= 0 and wins <= attempts),
  first_cleared_at     timestamptz,
  first_clear_match_id uuid,
  updated_at           timestamptz not null default now(),
  primary key (user_id, campaign_id, node_id),
  constraint campaign_progress_completed_has_clear check ((status = 'COMPLETED') = (first_cleared_at is not null))
);

create table if not exists public.campaign_attempts (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  campaign_id      text not null check (campaign_id ~ '^[a-z0-9-]{1,40}$'),
  campaign_version text not null check (char_length(campaign_version) between 1 and 16),
  node_id          text not null check (node_id ~ '^c[0-9]{1,2}-n[0-9]{1,2}$'),
  -- `set null`: abandonar borra la partida (`abandonMatch`); el intento queda para cerrarse como ABANDONED.
  match_id         uuid unique references public.duel_matches(id) on delete set null,
  status           text not null default 'STARTED' check (status in ('STARTED', 'SETTLED', 'ABANDONED')),
  result           text check (result in ('WIN', 'LOSS', 'DRAW')),
  first_clear      boolean not null default false,
  reward_granted   boolean not null default false,
  created_at       timestamptz not null default now(),
  settled_at       timestamptz,
  constraint campaign_attempts_settled_has_result check ((status = 'SETTLED') = (result is not null)),
  constraint campaign_attempts_clear_is_settled check (not first_clear or status = 'SETTLED'),
  constraint campaign_attempts_reward_needs_clear check (not reward_granted or first_clear)
);

create unique index if not exists campaign_attempts_one_open
  on public.campaign_attempts(user_id) where status = 'STARTED';
create unique index if not exists campaign_attempts_first_clear_once
  on public.campaign_attempts(user_id, campaign_id, node_id) where first_clear;
create index if not exists campaign_attempts_user_idx
  on public.campaign_attempts(user_id, created_at desc);

alter table public.campaign_progress enable row level security;
alter table public.campaign_attempts enable row level security;
-- Sin políticas a propósito: ni el propio usuario las lee con su token. Todo pasa por el servidor.
revoke all on public.campaign_progress from anon, authenticated;
revoke all on public.campaign_attempts from anon, authenticated;
grant all on public.campaign_progress to service_role;
grant all on public.campaign_attempts to service_role;

comment on table public.campaign_progress is
  'Fase 35: progreso de Road to Champions por usuario y nodo. Solo servidor. Estados LOCKED/AVAILABLE se derivan de la definición versionada en código.';
comment on table public.campaign_attempts is
  'Fase 35: partida PVE lanzada desde un nodo. match_id único = liquidación idempotente. Solo servidor.';
