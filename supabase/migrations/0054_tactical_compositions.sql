-- ══════════════════════════════════════════════════════════════════════════════
-- FASE 47 · COMPOSICIONES TÁCTICAS POR MAPA
--
-- Qué añade
-- ---------
--   · `user_compositions`  — los cinco agentes con los que un entrenador juega un mapa.
--   · `user_strats.composition_id` — qué composición usa una jugada (opcional).
--   · `coach_match_strats` — qué jugadas se llevan a una partida concreta.
--
-- Qué NO toca
-- -----------
-- Ni una fila existente. `user_strats` conserva su `plan` jsonb intacto: la columna nueva es
-- NULL para todas las jugadas ya guardadas, y una jugada sin composición sigue siendo válida
-- (así funcionaba la pizarra entera hasta hoy). No se borra nada y no se resetea el entrenador.
--
-- Por qué una tabla y no más jsonb
-- --------------------------------
-- Una composición se CONSULTA de forma cruzada —«qué comps tengo en Ascent», «qué jugadas usan
-- esta comp»— y se valida contra el catálogo de agentes. Eso dentro de un jsonb obliga a leerlo
-- todo y filtrar en memoria. Los agentes sí van en un `text[]`: son cinco identificadores de un
-- catálogo cerrado, y el orden importa (es el orden en el que el entrenador los piensa).
-- ══════════════════════════════════════════════════════════════════════════════

create table if not exists public.user_compositions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  map_id     text not null check (length(map_id) between 1 and 40),
  name       text not null check (length(name) between 1 and 60),
  -- Cinco como mucho. La unicidad de agente la impone el dominio antes de escribir.
  agent_ids  text[] not null default '{}' check (array_length(agent_ids, 1) is null or array_length(agent_ids, 1) <= 5),
  notes      text not null default '' check (length(notes) <= 400),
  -- La composición que se propone por defecto en este mapa.
  primary_comp boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_compositions_user_idx on public.user_compositions (user_id, updated_at desc);
create index if not exists user_compositions_map_idx  on public.user_compositions (user_id, map_id);

-- Como mucho UNA composición principal por mapa y usuario. Un índice parcial lo garantiza en la
-- base, no en el cliente: dos pestañas marcando «principal» a la vez no pueden dejar dos.
create unique index if not exists user_compositions_primary_idx
  on public.user_compositions (user_id, map_id) where primary_comp;

alter table public.user_compositions enable row level security;

drop policy if exists user_compositions_select_own on public.user_compositions;
create policy user_compositions_select_own on public.user_compositions
  for select using (auth.uid() = user_id);

drop policy if exists user_compositions_insert_own on public.user_compositions;
create policy user_compositions_insert_own on public.user_compositions
  for insert with check (auth.uid() = user_id);

drop policy if exists user_compositions_update_own on public.user_compositions;
create policy user_compositions_update_own on public.user_compositions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists user_compositions_delete_own on public.user_compositions;
create policy user_compositions_delete_own on public.user_compositions
  for delete using (auth.uid() = user_id);


-- ── La jugada puede apuntar a una composición ────────────────────────────────
-- `on delete set null`: borrar una composición NO puede llevarse por delante las jugadas que la
-- usaban. Se quedan sin composición, que es un estado que el editor ya sabe enseñar.
alter table public.user_strats
  add column if not exists composition_id uuid references public.user_compositions(id) on delete set null;

create index if not exists user_strats_composition_idx on public.user_strats (composition_id);


-- ── Qué jugadas se llevan a una partida ──────────────────────────────────────
-- El mapa NO se guarda aquí: se deduce de la jugada y se valida contra el de la partida en el
-- servidor. Guardarlo dos veces es invitar a que un día no coincidan.
create table if not exists public.coach_match_strats (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  match_id   uuid not null references public.coach_matches(id) on delete cascade,
  strat_id   uuid not null references public.user_strats(id) on delete cascade,
  -- Orden en el que el entrenador las quiere presentar.
  sort_order int  not null default 0,
  created_at timestamptz not null default now(),
  -- La misma jugada no se asigna dos veces a la misma partida.
  unique (match_id, strat_id)
);

create index if not exists coach_match_strats_match_idx on public.coach_match_strats (user_id, match_id, sort_order);

alter table public.coach_match_strats enable row level security;

drop policy if exists coach_match_strats_select_own on public.coach_match_strats;
create policy coach_match_strats_select_own on public.coach_match_strats
  for select using (auth.uid() = user_id);

drop policy if exists coach_match_strats_insert_own on public.coach_match_strats;
create policy coach_match_strats_insert_own on public.coach_match_strats
  for insert with check (auth.uid() = user_id);

drop policy if exists coach_match_strats_delete_own on public.coach_match_strats;
create policy coach_match_strats_delete_own on public.coach_match_strats
  for delete using (auth.uid() = user_id);

drop policy if exists coach_match_strats_update_own on public.coach_match_strats;
create policy coach_match_strats_update_own on public.coach_match_strats
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
