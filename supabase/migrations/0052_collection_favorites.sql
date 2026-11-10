-- ============================================================================
-- 0052 · FAVORITOS DE COLECCIÓN (Fase 37) — APLICADA (VPS 2026-09-15 19:32Z, Fase 37.1).
-- Backup previo: /opt/nexus/backups/supabase-drlcards/pre-0052/supabase-drlcards-pre0052-20260915T193049Z.dump.
-- No tocar `schema_migrations`. Cerrojo del tope añadido ANTES de aplicar (ensayo + apply con este mismo SQL).
-- ============================================================================
--
-- QUÉ ES. «Me gusta esta carta»: un favorito pertenece a una DEFINICIÓN de carta (`card_id`, p. ej.
-- `benjy__emea`), no a una copia. Es distinto de la vitrina del perfil (`player_profile_customization`,
-- hasta 3 INSTANCIAS reales), que no se toca. No concede nada, no cambia stats ni economía.
--
-- POR QUÉ UNA TABLA. Hasta hoy los favoritos solo existían en la meta local del motor de colección
-- (`CollectionMeta.favorites`), sin persistencia de servidor. Guardarlos en el navegador no es una
-- autoridad (otro dispositivo, otra pestaña limpia = perdidos). Una relación (usuario, carta) con clave
-- primaria es la forma correcta y barata: sin JSON genérico, sin duplicados, borrado en cascada.
--
-- SEGURIDAD.
--   · RLS activa. El cliente solo puede LEER sus propias filas (`auth.uid() = user_id`).
--   · Insertar/borrar lo hace el SERVIDOR (service_role) tras validar que la carta existe en el catálogo.
--   · Tope defensivo por usuario (200) también en la base de datos, además del de la API.
--   · `card_id` con el formato canónico del catálogo: sin rutas, espacios ni comodines.
--
-- ADITIVA E IDEMPOTENTE. No modifica tablas existentes ni datos. Rollback:
--   drop trigger if exists user_card_favorites_cap on public.user_card_favorites;
--   drop function if exists public._user_card_favorites_cap();
--   drop table if exists public.user_card_favorites;
-- ============================================================================

create table if not exists public.user_card_favorites (
  user_id    uuid        not null references auth.users(id) on delete cascade,
  card_id    text        not null,
  created_at timestamptz not null default now(),
  primary key (user_id, card_id),
  constraint user_card_favorites_card_id_format check (card_id ~ '^[a-z0-9-]{1,64}__[a-z0-9-]{1,32}$')
);

create index if not exists user_card_favorites_user_created_idx
  on public.user_card_favorites (user_id, created_at desc);

alter table public.user_card_favorites enable row level security;

revoke all on public.user_card_favorites from anon, authenticated;
grant select on public.user_card_favorites to authenticated;

drop policy if exists "tus favoritos (lectura)" on public.user_card_favorites;
create policy "tus favoritos (lectura)" on public.user_card_favorites
  for select to authenticated using (auth.uid() = user_id);

-- Tope por usuario: 200 favoritos. La API ya lo aplica; esto es la segunda puerta.
-- Fase 37.1 (antes de aplicar): el cerrojo consultivo por usuario serializa inserciones concurrentes del MISMO usuario,
-- así dos altas simultáneas no pueden ver ambas 199 y dejar 201. Se libera al terminar la transacción.
create or replace function public._user_card_favorites_cap()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('user_card_favorites:' || new.user_id::text, 0));
  if (select count(*) from public.user_card_favorites where user_id = new.user_id) >= 200 then
    raise exception 'FAVORITES_LIMIT' using errcode = 'P0001';
  end if;
  return new;
end; $$;

revoke all on function public._user_card_favorites_cap() from public, anon, authenticated;

drop trigger if exists user_card_favorites_cap on public.user_card_favorites;
create trigger user_card_favorites_cap
  before insert on public.user_card_favorites
  for each row execute function public._user_card_favorites_cap();
