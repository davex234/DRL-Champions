-- ============================================================================
-- DRL CHAMPIONS — IA de análisis competitivo (predicciones)
-- ----------------------------------------------------------------------------
-- Almacena las salidas del motor de predicción sobre el módulo competitivo
-- (0003): ratings Elo por equipo, predicciones por partido (prob. victoria,
-- marcador, MVP, jugador revelación, narrativa de IA) y proyecciones por
-- jugador. Incluye vistas de PRECISIÓN (Brier score, acierto de ganador y
-- marcador) para medir y calibrar el modelo.
--
-- El cálculo lo hace el backend (Elo recomputado + modelo estadístico + capa de
-- IA) con service_role; el cliente solo LEE (RLS de lectura pública).
-- Idempotente y re-ejecutable.
-- ============================================================================

create extension if not exists pgcrypto;

-- ============================================================================
-- 1. RATINGS ELO POR EQUIPO (recomputados desde los partidos finalizados)
-- ============================================================================
create table if not exists public.team_ratings (
  team_id       text primary key references public.teams(id) on delete cascade,
  rating        numeric not null default 1500,
  peak_rating   numeric not null default 1500,
  games         int not null default 0,
  wins          int not null default 0,
  losses        int not null default 0,
  region        text,
  last_match_at timestamptz,
  updated_at    timestamptz not null default now()
);
create index if not exists team_ratings_rating_idx on public.team_ratings(rating desc);

-- ============================================================================
-- 2. PREDICCIONES POR PARTIDO (una por versión de modelo)
-- ============================================================================
create table if not exists public.predictions (
  id                 uuid primary key default gen_random_uuid(),
  match_id           text not null references public.matches(id) on delete cascade,
  model_version      text not null default 'drl-stat-v1',
  provider           text not null default 'heuristic',
  win_prob_a         numeric,        -- prob. de victoria del equipo A (0-1)
  win_prob_b         numeric,
  predicted_winner_id text references public.teams(id),
  predicted_score_a  int,
  predicted_score_b  int,
  confidence         numeric,        -- 0-1
  upset_risk         numeric,        -- 0-1 (riesgo de sorpresa)
  mvp_player_id      text references public.players(id),
  breakout_player_id text references public.players(id),
  narrative          text,
  key_factors        jsonb not null default '[]'::jsonb,
  features           jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (match_id, model_version)
);
create index if not exists predictions_match_idx on public.predictions(match_id);
create index if not exists predictions_model_idx on public.predictions(model_version, created_at desc);

-- ============================================================================
-- 3. PROYECCIÓN POR JUGADOR (razonamiento de MVP / revelación, leaderboards)
-- ============================================================================
create table if not exists public.prediction_players (
  id               uuid primary key default gen_random_uuid(),
  match_id         text not null references public.matches(id) on delete cascade,
  player_id        text references public.players(id),
  team_id          text references public.teams(id),
  kind             text not null default 'projection'
                     check (kind in ('mvp','breakout','projection')),
  projected_rating numeric,
  mvp_prob         numeric,
  breakout_score   numeric,
  created_at       timestamptz not null default now(),
  unique (match_id, player_id, kind)
);
create index if not exists prediction_players_match_idx on public.prediction_players(match_id);

-- ============================================================================
-- 4. TRIGGERS updated_at (reutiliza public.touch_updated_at de 0001)
-- ============================================================================
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

do $$
declare t text;
begin
  foreach t in array array['team_ratings','predictions'] loop
    execute format('drop trigger if exists %s_touch on public.%I;', t, t);
    execute format(
      'create trigger %s_touch before update on public.%I
         for each row execute function public.touch_updated_at();', t, t);
  end loop;
end $$;

-- ============================================================================
-- 5. RLS: lectura pública; escritura solo service_role
-- ============================================================================
alter table public.team_ratings       enable row level security;
alter table public.predictions         enable row level security;
alter table public.prediction_players  enable row level security;

do $$
declare t text;
begin
  foreach t in array array['team_ratings','predictions','prediction_players'] loop
    execute format('drop policy if exists "lectura publica %s" on public.%I;', t, t);
    execute format('create policy "lectura publica %s" on public.%I for select using (true);', t, t);
  end loop;
end $$;

-- ============================================================================
-- 6. VISTAS DE PRECISIÓN (comparan predicciones con resultados reales)
-- ============================================================================
-- Una fila por predicción de un partido ya finalizado.
create or replace view public.v_prediction_accuracy as
  select p.id, p.match_id, p.model_version, p.provider,
         m.team_a_id, m.team_b_id, m.winner_team_id,
         p.predicted_winner_id, p.win_prob_a,
         (m.winner_team_id = m.team_a_id) as a_won,
         (p.predicted_winner_id = m.winner_team_id) as winner_correct,
         -- Brier score: (prob asignada al equipo A − resultado real de A)^2
         power(coalesce(p.win_prob_a, 0.5) - (case when m.winner_team_id = m.team_a_id then 1 else 0 end), 2) as brier,
         (p.predicted_score_a = m.score_a and p.predicted_score_b = m.score_b) as score_exact
    from public.predictions p
    join public.matches m on m.id = p.match_id
   where m.status = 'finished' and m.winner_team_id is not null;

-- Agregado por versión de modelo (la "nota" del modelo).
create or replace view public.v_model_accuracy as
  select model_version,
         count(*)                                            as predictions,
         round(avg(case when winner_correct then 1 else 0 end)::numeric, 4) as winner_hit_rate,
         round(avg(brier)::numeric, 4)                       as brier_mean,
         round(avg(case when score_exact then 1 else 0 end)::numeric, 4)    as score_exact_rate
    from public.v_prediction_accuracy
   group by model_version;
