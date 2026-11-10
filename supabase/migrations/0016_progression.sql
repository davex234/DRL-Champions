-- ============================================================================
-- FASE 9E · PROGRESIÓN DE TEMPORADA EN EL SERVIDOR
--
-- PROBLEMA
--   El motor del pase (`src/battlepass/`) estaba completo desde la Fase 6 de
--   Colección pero no tenía dónde guardar nada, y los logros vivían en el store
--   local: `claimAchievement` sumaba créditos en `localStorage`. Con sesión
--   iniciada eso es exactamente lo que prohíbe §25 de la Fase 9 —la economía no
--   puede depender del navegador— y además se revertía en la siguiente
--   sincronización, así que ni siquiera funcionaba.
--
-- SOLUCIÓN
--   Dos tablas de PROGRESO, escritas SOLO por el servidor:
--     · `user_pass`         — el `PassState` serializado, una fila por jugador.
--     · `user_achievements` — qué logro se reclamó y cuándo.
--   Las recompensas NO se conceden aquí: siguen pasando por `app_grant_reward`,
--   que ya existe y ya deja su asiento en `credit_transactions` con clave de
--   idempotencia. No se crea una segunda ruta para dar créditos.
--
-- SEGURIDAD
--   · RLS activada en ambas. El dueño puede LEER lo suyo (no hay información
--     oculta en su propio progreso) y no puede ESCRIBIR nada: sin políticas de
--     escritura y con los privilegios revocados. Todo lo escribe `service_role`.
--   · A diferencia de `duel_matches` —que deniega hasta la lectura porque su
--     estado contiene las cartas no jugadas del rival— aquí la lectura propia es
--     inofensiva y ahorra un viaje de ida y vuelta.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Pase de temporada
-- ----------------------------------------------------------------------------
create table if not exists public.user_pass (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  season_id   text        not null,
  -- `PassState` tal cual lo serializa `@/battlepass`. El esquema lo valida el
  -- dominio (`migratePassState`), no la base de datos: si la forma cambia, se
  -- migra en TypeScript, que es donde vive la definición.
  state       jsonb       not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.user_pass enable row level security;

drop policy if exists user_pass_select_own on public.user_pass;
create policy user_pass_select_own on public.user_pass
  for select to authenticated
  using (user_id = auth.uid());

revoke insert, update, delete on public.user_pass from anon, authenticated;
grant select on public.user_pass to authenticated;
grant all    on public.user_pass to service_role;

drop trigger if exists user_pass_touch on public.user_pass;
create trigger user_pass_touch
  before update on public.user_pass
  for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- Logros
-- ----------------------------------------------------------------------------
-- Solo se guarda lo RECLAMADO. El progreso NO se almacena: se calcula a partir de
-- los datos reales del jugador en cada consulta. Guardarlo sería duplicar cifras
-- que ya existen en `profiles`, `user_cards` y `duel_matches`, y duplicarlas es
-- la forma más fiable de que dejen de coincidir.
create table if not exists public.user_achievements (
  user_id        uuid        not null references auth.users(id) on delete cascade,
  achievement_id text        not null,
  claimed_at     timestamptz not null default now(),
  primary key (user_id, achievement_id)
);

alter table public.user_achievements enable row level security;

drop policy if exists user_achievements_select_own on public.user_achievements;
create policy user_achievements_select_own on public.user_achievements
  for select to authenticated
  using (user_id = auth.uid());

revoke insert, update, delete on public.user_achievements from anon, authenticated;
grant select on public.user_achievements to authenticated;
grant all    on public.user_achievements to service_role;

create index if not exists user_achievements_user_idx
  on public.user_achievements (user_id, claimed_at desc);

-- ----------------------------------------------------------------------------
-- Cosméticos
-- ----------------------------------------------------------------------------
-- El carril de pago del pase reparte SOLO cosmética (§29), así que sin un sitio
-- donde guardarla el carril no se podría entregar. Es propiedad, igual que una
-- carta: la escribe el servidor y el jugador solo la lee.
create table if not exists public.user_cosmetics (
  user_id     uuid        not null references auth.users(id) on delete cascade,
  cosmetic_id text        not null,
  /* De dónde salió: 'pass:nexus-s1:20', 'achievement:coleccionista'… Sirve de
     rastro y de clave de idempotencia natural. */
  source      text,
  granted_at  timestamptz not null default now(),
  primary key (user_id, cosmetic_id)
);

alter table public.user_cosmetics enable row level security;

drop policy if exists user_cosmetics_select_own on public.user_cosmetics;
create policy user_cosmetics_select_own on public.user_cosmetics
  for select to authenticated
  using (user_id = auth.uid());

revoke insert, update, delete on public.user_cosmetics from anon, authenticated;
grant select on public.user_cosmetics to authenticated;
grant all    on public.user_cosmetics to service_role;

-- ----------------------------------------------------------------------------
-- Resultado del duelo, desnormalizado
-- ----------------------------------------------------------------------------
-- Las misiones de temporada preguntan «cuántos duelos has jugado y ganado». El
-- ganador vive dentro de `duel_matches.state`, un jsonb que hay que traer entero
-- para leer un carácter. Con una columna, la cuenta es un índice.
--
-- Es una columna DERIVADA: la escribe el mismo servicio que ya escribía `status`,
-- a partir del resultado que da el Combat Resolver. No cambia ninguna regla ni se
-- convierte en una segunda fuente de verdad: la fuente sigue siendo `state`.
alter table public.duel_matches
  add column if not exists winner text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'duel_matches_winner_check') then
    alter table public.duel_matches
      add constraint duel_matches_winner_check
      check (winner is null or winner in ('A', 'B'));
  end if;
end $$;

create index if not exists duel_matches_user_result_idx
  on public.duel_matches (user_id, status, winner);
