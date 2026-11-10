-- ============================================================================
-- FASE 9I · ESTRATEGIAS DEL ENTRENADOR
--
-- QUÉ GUARDA
--   Una «strat» es un plan dibujado sobre uno de los mapas propios de NEXUS: mapa,
--   bando, cinco jugadores colocados, flechas de movimiento y una secuencia de
--   pasos. El modelo y su validación viven en `src/domain/tactics`.
--
-- POR QUÉ EL PLAN VA EN UN JSONB
--   Porque no se consulta por dentro: se lee entero para pintarlo y se escribe
--   entero al guardar. Normalizar marcadores y pasos en dos tablas más solo
--   añadiría tres uniones a cada carga, y ninguna consulta pregunta nunca «dame
--   todos los marcadores que están en el sitio A».
--   Lo que SÍ sale a columnas es aquello por lo que se filtra y se ordena: dueño,
--   nombre, mapa y bando.
--
-- SEGURIDAD — ESTA TABLA ES DISTINTA A LAS DEMÁS DE LA FASE 9
--   Una estrategia es contenido del USUARIO, no una cifra del juego: no concede
--   nada, no puntúa y no afecta a ningún duelo. Por eso aquí el dueño SÍ escribe
--   sus propias filas, a diferencia de `user_pass` o `duel_matches`.
--   Lo que se blinda es el resto:
--     · `user_id` se comprueba en `using` Y en `with check`, así que nadie puede
--       crear ni mover una estrategia a nombre de otro.
--     · El contenido del `plan` no se valida en SQL: lo SANEA el servidor con
--       `sanitizeStrat` antes de escribir. La base de datos guarda lo que el
--       servidor aprueba, no lo que manda el navegador.
--     · Un tope de filas por usuario evita que la tabla crezca sin control.
-- ============================================================================

create table if not exists public.user_strats (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null check (length(name) between 1 and 60),
  map_id     text not null check (length(map_id) between 1 and 40),
  side       text not null check (side in ('attack', 'defense')),
  /* `Strat` completo, ya saneado por el dominio. */
  plan       jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_strats_user_idx
  on public.user_strats (user_id, updated_at desc);
create index if not exists user_strats_map_idx
  on public.user_strats (user_id, map_id);

alter table public.user_strats enable row level security;

drop policy if exists user_strats_select_own on public.user_strats;
create policy user_strats_select_own on public.user_strats
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists user_strats_insert_own on public.user_strats;
create policy user_strats_insert_own on public.user_strats
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists user_strats_update_own on public.user_strats;
create policy user_strats_update_own on public.user_strats
  for update to authenticated
  using      (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists user_strats_delete_own on public.user_strats;
create policy user_strats_delete_own on public.user_strats
  for delete to authenticated
  using (user_id = auth.uid());

grant select, insert, update, delete on public.user_strats to authenticated;
grant all on public.user_strats to service_role;

drop trigger if exists user_strats_touch on public.user_strats;
create trigger user_strats_touch
  before update on public.user_strats
  for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- Tope de estrategias por usuario
-- ----------------------------------------------------------------------------
-- El servidor ya lo comprueba antes de insertar, pero una comprobación en la
-- aplicación no sirve de nada si alguien llega por PostgREST con su propio token:
-- las políticas de arriba le dejan insertar. Este trigger es el límite real.
create or replace function public.user_strats_limit()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  select count(*) into v_count from public.user_strats where user_id = new.user_id;
  if v_count >= 40 then
    raise exception 'Has alcanzado el máximo de 40 estrategias guardadas';
  end if;
  return new;
end; $$;

drop trigger if exists user_strats_cap on public.user_strats;
create trigger user_strats_cap
  before insert on public.user_strats
  for each row execute function public.user_strats_limit();
