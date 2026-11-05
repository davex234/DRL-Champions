-- ============================================================================
-- DRL CHAMPIONS — Asset Manager profesional (gestión de imágenes/medios)
-- ----------------------------------------------------------------------------
-- Sistema UNIFICADO y escalable (cientos de miles de medios) para los 10 tipos
-- de assets del juego: fotos de jugadores, logos de equipos/ligas/torneos,
-- banderas, roles, plantillas de cartas, fondos, animaciones y efectos.
--
-- Cada asset guarda lo pedido: id, nombre, tipo (kind), fuente (source),
-- calidad (quality), resolución (width/height), fecha (created_at/captured_at),
-- prioridad (priority), estado (status), versión (version + group_id),
-- licencia (license) y checksum (sha-256, para deduplicado).
--
-- Binarios en SUPABASE STORAGE (bucket público 'assets', particionado por
-- kind/subject). La tabla guarda `storage_path` + `url` (URL pública/externa).
--
-- RESOLVER "dame la mejor imagen para X": `asset_best` es una tabla precomputada
-- (kind, subject_type, subject_id) → mejor asset aprobado, mantenida por TRIGGER
-- (mismo patrón que card_price_stats de 0004) para lectura O(1). RPC `best_asset`.
--
-- RECONCILIA `card_photos` (0006): backfill a `assets` + `card_photos` pasa a ser
-- VISTA de compatibilidad sobre assets (el motor de torneos sigue funcionando).
--
-- Escritura: SOLO vía ruta admin con service_role (verifica profiles.is_admin).
-- Lectura: RLS pública de lo aprobado. Idempotente y re-ejecutable.
-- ============================================================================

create extension if not exists pgcrypto;

-- ============================================================================
-- 1. BUCKET DE STORAGE (solo si las tablas de Storage existen; en un Postgres
--    pelado para tests sin Storage, este bloque se omite sin fallar)
-- ============================================================================
do $$
begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public)
      values ('assets', 'assets', true)
      on conflict (id) do nothing;
  end if;
end $$;
-- El bucket es PÚBLICO (lectura directa por URL/CDN). La subida/borrado va por la
-- ruta admin con service_role (que ignora RLS), así que no hacen falta políticas
-- en storage.objects.

-- ============================================================================
-- 2. TABLA CANÓNICA `assets`
-- ============================================================================
create table if not exists public.assets (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid not null default gen_random_uuid(),   -- grupo de versiones
  version      int  not null default 1,
  is_current   boolean not null default true,             -- versión vigente del grupo

  name         text not null,
  kind         text not null check (kind in (
                 'player_photo','team_logo','league_logo','tournament_logo','flag',
                 'role','card_template','background','animation','effect')),
  -- Sujeto al que pertenece el asset (id del CATÁLOGO DEL JUEGO, text sin FK,
  -- coherente con 0006). Permite buscar por jugador/equipo/torneo, etc.
  subject_type text not null default 'none' check (subject_type in (
                 'player','team','league','tournament','country','role','variant','none')),
  subject_id   text,

  source       text not null default 'manual' check (source in (
                 'riot_media','event_official','social','broadcast_frame','manual','upload','generated')),
  quality      int  not null default 0 check (quality between 0 and 100),
  width        int,
  height       int,
  format       text,                                       -- png|webp|jpg|webm|mp4|json…
  bytes        bigint,
  checksum     text,                                       -- sha-256 hex (deduplicado)
  priority     int  not null default 0,                    -- mayor = preferido
  status       text not null default 'pending'
                 check (status in ('pending','approved','rejected','archived')),
  license      text,

  bucket       text not null default 'assets',
  storage_path text,                                       -- ruta dentro del bucket
  url          text,                                       -- URL pública/externa resuelta

  captured_at  timestamptz,                                -- fecha de captura del medio
  tags         text[] not null default '{}',
  meta         jsonb  not null default '{}'::jsonb,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Índices para escala + búsqueda + resolución.
create index if not exists assets_subject_idx
  on public.assets(kind, subject_type, subject_id, status, priority desc);
create index if not exists assets_group_idx    on public.assets(group_id, version desc);
create index if not exists assets_checksum_idx  on public.assets(checksum) where checksum is not null;
create index if not exists assets_status_idx    on public.assets(status, kind);
create index if not exists assets_name_idx      on public.assets(name);
-- Una sola versión vigente por grupo.
create unique index if not exists assets_current_per_group
  on public.assets(group_id) where is_current;

-- ============================================================================
-- 3. RESOLUCIÓN PRECOMPUTADA `asset_best` (lectura O(1) para el motor)
-- ============================================================================
create table if not exists public.asset_best (
  kind         text not null,
  subject_type text not null,
  subject_id   text not null,
  asset_id     uuid not null,
  bucket       text,
  storage_path text,
  url          text,
  width        int,
  height       int,
  quality      int,
  priority     int,
  updated_at   timestamptz not null default now(),
  primary key (kind, subject_type, subject_id)
);

-- Recalcula el mejor asset (aprobado + vigente) de un sujeto concreto.
-- Orden: prioridad → calidad → resolución → versión → recencia.
create or replace function public._asset_refresh_best(
  p_kind text, p_subject_type text, p_subject_id text)
returns void language plpgsql security definer set search_path = public as $$
declare v public.assets;
begin
  if p_subject_id is null then return; end if;
  select * into v from public.assets
   where kind = p_kind and subject_type = p_subject_type and subject_id = p_subject_id
     and status = 'approved' and is_current
   order by priority desc, quality desc, width desc nulls last, version desc, created_at desc
   limit 1;

  if v.id is null then
    delete from public.asset_best
     where kind = p_kind and subject_type = p_subject_type and subject_id = p_subject_id;
  else
    insert into public.asset_best (kind, subject_type, subject_id, asset_id, bucket,
                                   storage_path, url, width, height, quality, priority, updated_at)
    values (p_kind, p_subject_type, p_subject_id, v.id, v.bucket, v.storage_path, v.url,
            v.width, v.height, v.quality, v.priority, now())
    on conflict (kind, subject_type, subject_id) do update set
      asset_id = excluded.asset_id, bucket = excluded.bucket, storage_path = excluded.storage_path,
      url = excluded.url, width = excluded.width, height = excluded.height,
      quality = excluded.quality, priority = excluded.priority, updated_at = now();
  end if;
end; $$;

-- Trigger: refresca el "mejor" del sujeto afectado en cada cambio (y del sujeto
-- anterior si el asset cambió de kind/subject en un UPDATE).
create or replace function public.assets_touch_best()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    perform public._asset_refresh_best(old.kind, old.subject_type, old.subject_id);
    return old;
  end if;
  perform public._asset_refresh_best(new.kind, new.subject_type, new.subject_id);
  if tg_op = 'UPDATE'
     and (old.kind         is distinct from new.kind
       or old.subject_type is distinct from new.subject_type
       or old.subject_id   is distinct from new.subject_id) then
    perform public._asset_refresh_best(old.kind, old.subject_type, old.subject_id);
  end if;
  return new;
end; $$;

drop trigger if exists assets_best_sync on public.assets;
create trigger assets_best_sync
  after insert or update or delete on public.assets
  for each row execute function public.assets_touch_best();

-- updated_at (reutiliza public.touch_updated_at de 0001).
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists assets_touch on public.assets;
create trigger assets_touch before update on public.assets
  for each row execute function public.touch_updated_at();

-- ============================================================================
-- 4. RPCs / VISTAS
-- ============================================================================
-- Azúcar para el motor: "dame el mejor asset disponible para este sujeto".
create or replace function public.best_asset(
  p_kind text, p_subject_type text, p_subject_id text)
returns public.asset_best language sql stable as $$
  select * from public.asset_best
   where kind = p_kind and subject_type = p_subject_type and subject_id = p_subject_id;
$$;

-- Búsqueda paginada (respeta RLS: anon ve solo aprobados; admin/service_role ve todo).
-- Devuelve solo versiones vigentes; las versiones históricas se ven aparte.
create or replace function public.search_assets(
  p_kind text default null, p_subject_type text default null, p_subject_id text default null,
  p_query text default null, p_status text default null,
  p_limit int default 40, p_offset int default 0)
returns setof public.assets language sql stable as $$
  select * from public.assets a
   where a.is_current
     and (p_kind         is null or a.kind = p_kind)
     and (p_subject_type is null or a.subject_type = p_subject_type)
     and (p_subject_id   is null or a.subject_id = p_subject_id)
     and (p_status       is null or a.status = p_status)
     and (p_query is null
          or a.name ilike '%' || p_query || '%'
          or a.subject_id ilike '%' || p_query || '%'
          or exists (select 1 from unnest(a.tags) t where t ilike '%' || p_query || '%'))
   order by a.priority desc, a.updated_at desc
   limit greatest(1, least(p_limit, 200)) offset greatest(0, p_offset);
$$;

-- Duplicados por checksum (alimenta "eliminar duplicados").
create or replace view public.v_asset_duplicates as
  select checksum,
         count(*)                       as copies,
         array_agg(id order by created_at) as asset_ids,
         min(kind)                      as kind
    from public.assets
   where checksum is not null
   group by checksum
  having count(*) > 1;

-- ============================================================================
-- 5. BACKFILL + COMPATIBILIDAD con card_photos (0006)
-- ----------------------------------------------------------------------------
-- Si card_photos existe como TABLA: vuelca sus filas a `assets` (player_photo),
-- suelta las FK de photo_id (para que apunten a assets en el futuro), renombra
-- la tabla a card_photos_legacy y crea una VISTA card_photos sobre assets con
-- las columnas que el motor de torneos de 0006 espera. Re-ejecutable.
-- ============================================================================
do $$
begin
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'public' and c.relname = 'card_photos' and c.relkind = 'r') then

    insert into public.assets (id, group_id, version, is_current, name, kind, subject_type,
                               subject_id, source, quality, priority, status, url, captured_at, meta,
                               created_at, updated_at)
    select cp.id, cp.id, 1, true,
           'Foto ' || cp.player_id, 'player_photo', 'player', cp.player_id,
           case when cp.source in ('riot_media','event_official','social','broadcast_frame','manual')
                then cp.source else 'manual' end,
           coalesce(cp.quality, 0), cp.priority,
           case cp.approval_status when 'approved' then 'approved'
                                   when 'rejected' then 'rejected' else 'pending' end,
           cp.url, cp.captured_at,
           jsonb_build_object('migrated_from', 'card_photos', 'notes', cp.notes),
           cp.created_at, cp.updated_at
      from public.card_photos cp
     where not exists (select 1 from public.assets a where a.id = cp.id);

    alter table public.player_cards  drop constraint if exists player_cards_photo_id_fkey;
    alter table public.special_cards drop constraint if exists special_cards_photo_id_fkey;

    alter table public.card_photos rename to card_photos_legacy;
  end if;
end $$;

-- Vista de compatibilidad: el motor de torneos lee de aquí sin cambios.
create or replace view public.card_photos as
  select id,
         subject_id as player_id,
         coalesce(url, meta->>'url') as url,
         case when source in ('riot_media','event_official','social','broadcast_frame','manual')
              then source else 'manual' end as source,
         captured_at,
         quality,
         case status when 'approved' then 'approved'
                     when 'rejected' then 'rejected' else 'pending' end as approval_status,
         priority,
         meta->>'notes' as notes,
         created_at,
         updated_at
    from public.assets
   where kind = 'player_photo';

-- ============================================================================
-- 6. RLS: lectura pública de lo aprobado; escritura solo service_role
-- ============================================================================
alter table public.assets     enable row level security;
alter table public.asset_best enable row level security;

drop policy if exists "lectura assets aprobados" on public.assets;
create policy "lectura assets aprobados" on public.assets
  for select using (status = 'approved');

drop policy if exists "lectura asset_best" on public.asset_best;
create policy "lectura asset_best" on public.asset_best
  for select using (true);
-- Sin políticas de escritura: solo service_role (ruta admin) escribe.
