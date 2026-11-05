-- ============================================================================
-- FASE 9D · ÁMBITO REGIONAL DE LA CLASIFICACIÓN
--
-- PROBLEMA
--   La Fase 9 pide que la posición GLOBAL y la EUROPEA sean siempre computables.
--   La global ya lo era (`profiles.points`), pero `profiles` no guardaba ninguna
--   región: la europea era literalmente imposible de calcular, no difícil.
--
-- SOLUCIÓN
--   Una columna `region` con las cuatro regiones del circuito de VALORANT, las
--   mismas que ya usa el catálogo de cartas. No se inventa una taxonomía nueva.
--   «Europa» en la clasificación es EMEA, y la interfaz lo escribe así.
--
-- SEGURIDAD (se respeta el modelo de 0009_profiles_hardening)
--   · `region` NO es una columna protegida: es una preferencia del usuario, no una
--     cifra competitiva. Se concede `update (region)` a `authenticated`, igual que
--     `username` y `avatar`, y el CHECK impide meter cualquier otra cosa.
--   · La lectura de `profiles` ya era pública por diseño (los rankings dependen de
--     ella): no se relaja nada.
--   · No se toca ninguna columna que escriba el servidor.
--
-- NULL es un valor válido y significa «sin región declarada»: ese jugador aparece
-- en la clasificación global y no en la regional. No se le asigna una por defecto,
-- porque inventar de dónde es alguien es peor que no saberlo.
-- ============================================================================

alter table public.profiles
  add column if not exists region text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_region_check'
  ) then
    alter table public.profiles
      add constraint profiles_region_check
      check (region is null or region in ('EMEA', 'Americas', 'Pacific', 'China'));
  end if;
end $$;

-- El usuario elige su región; el resto de su fila sigue blindado por 0009.
grant update (region) on public.profiles to authenticated;

-- ----------------------------------------------------------------------------
-- Índices de clasificación
-- ----------------------------------------------------------------------------
-- La posición se calcula contando cuántos perfiles tienen MÁS puntos. Sin índice,
-- eso es un recuento secuencial en cada carga de /ranking, /cuenta y la portada.
create index if not exists profiles_points_idx
  on public.profiles (points desc);

create index if not exists profiles_region_points_idx
  on public.profiles (region, points desc)
  where region is not null;

-- ----------------------------------------------------------------------------
-- Vistas de clasificación
-- ----------------------------------------------------------------------------
-- `region` se AÑADE AL FINAL de `ranking_points`: `create or replace view` solo
-- admite ampliar la lista de columnas por el final, nunca reordenarla.
create or replace view public.ranking_points as
  select p.id, p.username, p.avatar, p.points, p.xp, p.level, p.region
    from public.profiles p
   where p.points > 0
   order by p.points desc, p.xp desc
   limit 100;

-- Clasificación regional. Es la misma consulta acotada a una región; el cliente
-- filtra por `region` y recibe el top de esa región, no el global recortado.
create or replace view public.ranking_points_region as
  select p.id, p.username, p.avatar, p.points, p.xp, p.level, p.region,
         rank() over (partition by p.region order by p.points desc, p.xp desc) as position
    from public.profiles p
   where p.points > 0 and p.region is not null;

grant select on public.ranking_points        to anon, authenticated;
grant select on public.ranking_points_region to anon, authenticated;
