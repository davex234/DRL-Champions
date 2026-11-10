-- 0053 · DRAFT GAUNTLET (Fase 39 · «CONSTRUYE. ADÁPTATE. SOBREVIVE.») — APLICADA (VPS 2026-09-15 22:26Z, Fase 39).
--
-- Estado: aplicada en la BD del VPS el 2026-09-15 22:26Z (una transacción, ON_ERROR_STOP) tras backup, ensayo con
-- BEGIN/ROLLBACK y probes. Sin registrar en `schema_migrations` (no se toca).
--
-- POR QUÉ HACE FALTA.
--   1. Una RUN de draft tiene que sobrevivir a recargas, pestañas y reinicios con sus ofertas EXACTAS: semilla,
--      orden de roles, ofertas mostradas, elecciones, rivales fijados y versión de reglas. Nada de lo existente
--      guarda eso (ni `duel_decks`, que exige propiedad, ni `campaign_attempts`, que es de otro modo).
--   2. El combate del draft ES el combate canónico (`duel_matches`, duel-turns-2 / duel-combat-2), pero NO puede
--      contar como PvE normal: `mode = 'PVE'` lo leen el pago por partida, la campaña, el vestíbulo y las guardas
--      de «partida en curso». Por eso un modo propio `DRAFT_GAUNTLET`, con la misma forma que PvE (sin jugador B
--      ni mazo B). Quien filtra `mode = 'PVE'` / `mode = 'PVP'` / `mode in ('PVP','PVP_PRIVATE')` ya lo ignora;
--      los contadores sin filtro de modo (misiones, eventos, vestíbulo) se corrigen en el servidor.
--
-- TABLAS NUEVAS, SOLO SERVIDOR.
--   draft_runs         → una fila por run: estado, combate actual, versión optimista, semilla, reglas, jsonb acotado.
--   draft_run_matches  → una fila por (run, combate): el enlace con `duel_matches` y la liquidación.
--
-- GARANTÍAS EN LA BASE DE DATOS (no solo en TypeScript):
--   · Una sola run activa por usuario (índice único parcial sobre DRAFTING/READY/IN_MATCH).
--   · Un combate por (run, etapa) (clave primaria) y una partida liquida UN combate (`match_id` único).
--   · Estados, etapas y resultados cerrados por CHECK; una run terminada tiene `completed_at` y viceversa.
--   · `state` es un objeto jsonb de ≤ 32 KB: no se puede usar como almacén arbitrario.
--
-- QUÉ NO HACE. No toca `user_cards` (las cartas del draft no son propiedad y no tienen serial), ni la economía
-- (sin moneda, sin entrada, sin tickets, sin recompensas), ni el rating, ni la campaña, ni los sobres, ni el motor.
-- Sin funciones SECURITY DEFINER: todas las escrituras las hace el servidor con `service_role`.
--
-- RLS. Activada en las dos tablas, SIN políticas: ni el propio usuario las lee o escribe con su token. Se revoca
-- todo a `anon` y `authenticated`.
--
-- DEGRADACIÓN SIN APLICAR. El servicio detecta la tabla ausente (42P01 / PGRST205) y responde
-- «DRAFT GAUNTLET TODAVÍA NO DISPONIBLE» (lectura 200 con `available: false`; acciones 503 MIGRATION_PENDING).
--
-- REVERSIÓN (documentada, no automática; solo si no hay partidas DRAFT_GAUNTLET que conservar):
--   begin;
--   delete from public.duel_matches where mode = 'DRAFT_GAUNTLET';
--   drop table if exists public.draft_run_matches;
--   drop table if exists public.draft_runs;
--   alter table public.duel_matches drop constraint if exists duel_matches_mode_check;
--   alter table public.duel_matches add constraint duel_matches_mode_check check (mode in ('PVE','PVP','PVP_PRIVATE'));
--   alter table public.duel_matches drop constraint if exists duel_matches_mode_shape;
--   alter table public.duel_matches add constraint duel_matches_mode_shape check (
--     (mode = 'PVE' and player_b_id is null and deck_b_id is null)
--     or (mode in ('PVP','PVP_PRIVATE') and player_b_id is not null and deck_b_id is not null and player_b_id <> user_id));
--   commit;
--
-- Aditiva e idempotente.

-- ─────────────────────────────── 1. modo DRAFT_GAUNTLET en duel_matches ───────────────────────────────
alter table public.duel_matches drop constraint if exists duel_matches_mode_check;
alter table public.duel_matches
  add constraint duel_matches_mode_check check (mode in ('PVE','PVP','PVP_PRIVATE','DRAFT_GAUNTLET'));

alter table public.duel_matches drop constraint if exists duel_matches_mode_shape;
alter table public.duel_matches
  add constraint duel_matches_mode_shape check (
    (mode in ('PVE','DRAFT_GAUNTLET') and player_b_id is null and deck_b_id is null)
    or
    (mode in ('PVP','PVP_PRIVATE') and player_b_id is not null and deck_b_id is not null
                                   and player_b_id <> user_id)
  );

-- ─────────────────────────────── 2. runs ───────────────────────────────
create table if not exists public.draft_runs (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  status           text not null default 'DRAFTING'
                   check (status in ('DRAFTING','READY','IN_MATCH','COMPLETED','FAILED','ABANDONED')),
  stage            smallint not null default 1 check (stage between 1 and 5),
  version          integer not null default 1 check (version >= 1),
  seed             bigint not null check (seed >= 0 and seed < 4294967296),
  rules_version    text not null check (char_length(rules_version) between 1 and 32),
  data_version     text not null check (char_length(data_version) between 1 and 32),
  state            jsonb not null check (jsonb_typeof(state) = 'object' and pg_column_size(state) <= 32768),
  -- Sin FK a propósito: se fija ANTES de crear la partida (reclamo optimista) y la reconciliación lo resuelve.
  current_match_id uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  completed_at     timestamptz,
  constraint draft_runs_final_has_completed
    check ((status in ('COMPLETED','FAILED','ABANDONED')) = (completed_at is not null)),
  constraint draft_runs_match_only_in_match
    check (current_match_id is null or status = 'IN_MATCH')
);

create unique index if not exists draft_runs_one_active
  on public.draft_runs(user_id) where status in ('DRAFTING','READY','IN_MATCH');
create index if not exists draft_runs_user_idx
  on public.draft_runs(user_id, created_at desc);

-- ─────────────────────────────── 3. combates de la run ───────────────────────────────
create table if not exists public.draft_run_matches (
  run_id      uuid not null references public.draft_runs(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  stage       smallint not null check (stage between 1 and 5),
  -- `set null`: abandonar la run borra la partida en curso; el combate queda como ABANDONED.
  match_id    uuid unique references public.duel_matches(id) on delete set null,
  difficulty  text not null check (difficulty in ('EASY','NORMAL','HARD')),
  status      text not null default 'STARTED' check (status in ('STARTED','SETTLED','ABANDONED')),
  result      text check (result in ('WIN','LOSS','DRAW')),
  score_you   smallint check (score_you between 0 and 10),
  score_rival smallint check (score_rival between 0 and 10),
  created_at  timestamptz not null default now(),
  settled_at  timestamptz,
  primary key (run_id, stage),
  constraint draft_run_matches_settled_has_result check ((status = 'SETTLED') = (result is not null))
);

create index if not exists draft_run_matches_user_idx
  on public.draft_run_matches(user_id, created_at desc);

-- ─────────────────────────────── 4. RLS y permisos ───────────────────────────────
alter table public.draft_runs enable row level security;
alter table public.draft_run_matches enable row level security;
-- Sin políticas a propósito: todo pasa por el servidor.
revoke all on public.draft_runs from anon, authenticated;
revoke all on public.draft_run_matches from anon, authenticated;
grant all on public.draft_runs to service_role;
grant all on public.draft_run_matches to service_role;

comment on table public.draft_runs is
  'Fase 39: run de DRAFT GAUNTLET (draft de 10 + 5 combates PvE canónicos). Sin recompensas, sin propiedad de cartas. Solo servidor.';
comment on table public.draft_run_matches is
  'Fase 39: combate de una run de DRAFT GAUNTLET. match_id único = liquidación idempotente. Solo servidor.';
