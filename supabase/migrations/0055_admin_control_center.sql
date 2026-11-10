-- ============================================================================
-- 0055 · ADMIN CONTROL CENTER (F58) — moderación persistida, auditoría general y ajustes de saldo
-- ============================================================================
--
-- ADITIVA y retrocompatible. No borra, no renombra y no cambia ningún tipo existente.
--
-- Por qué hace falta (y qué se reutiliza en vez de duplicar):
--
--   §1  user_sanctions            NO existía persistencia de sanciones. `platform/cloud/moderation.ts` es un motor en
--                                 memoria del modo online que nunca se guardó. Sin tabla no hay enforcement server-side.
--   §2  content_audit_log         SE REUTILIZA (0040) como EL registro de auditoría del panel. Solo gana dos columnas
--                                 nullable (`entity_type`, `entity_id`) para auditar usuarios, sanciones, créditos y
--                                 eventos igual que cartas y pools; las filas existentes no cambian. Y pasa a ser
--                                 APPEND-ONLY: un trigger rechaza UPDATE y DELETE (nadie los usaba: comprobado).
--   §3  app_admin_sanction / app_admin_revoke_sanction
--                                 sanción + auditoría en UNA transacción; reglas de seguridad en SQL (no auto-sanción,
--                                 no sancionar a otro admin, una sola sanción activa por usuario).
--   §4  app_admin_adjust_credits  REUTILIZA `_ledger_apply` (0019), la única puerta que mueve saldo: asiento en
--                                 `credit_transactions` + auditoría en la misma transacción, idempotente por `ref`, y
--                                 con SALDO ESPERADO para no aplicar sobre un saldo que el admin no vio.
--   §5  app_admin_audit           auditoría de acciones que no son transaccionales en SQL (lecturas sensibles, eventos).
--   §6  admin_event_drafts        antesala de eventos: `public.events` se lee sin filtrar estado, así que un borrador no
--                                 puede vivir allí. Publicar inserta la fila canónica (source='admin') + auditoría.
--   §7  lecturas agregadas        búsqueda de usuarios con email (auth.users), KPIs, libro mayor y sonda de esquema.
--
-- Todo es `security definer` y solo lo ejecuta `service_role` (las rutas /api/admin/* tras `verifyAdmin`).
--
-- ROLLBACK (manual, solo si hiciera falta; no destruye datos del juego):
--   drop function if exists public.app_admin_schema_probe(); drop function if exists public.app_admin_ledger_summary(int);
--   drop function if exists public.app_admin_dashboard_stats(); drop function if exists public.app_admin_user_identity(uuid);
--   drop function if exists public.app_admin_search_users(text, int, int); drop function if exists public.app_admin_publish_event(uuid, uuid, timestamptz);
--   drop table if exists public.admin_event_drafts;   -- (las filas publicadas en public.events con source='admin' se conservan)
--   drop function if exists public.app_admin_audit(uuid, text, text, text, jsonb);
--   drop function if exists public.app_admin_adjust_credits(uuid, bigint, text, uuid, text, bigint);
--   drop function if exists public.app_admin_revoke_sanction(uuid, text, uuid);
--   drop function if exists public.app_admin_sanction(uuid, text, text, timestamptz, uuid);
--   drop trigger if exists content_audit_append_only on public.content_audit_log;
--   drop function if exists public._content_audit_append_only();
--   drop table if exists public.user_sanctions;
--   alter table public.content_audit_log drop column if exists entity_type, drop column if exists entity_id;

-- ----------------------------------------------------------------------------
-- §1 · SANCIONES
-- ----------------------------------------------------------------------------
create table if not exists public.user_sanctions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  type          text not null check (type in ('ban', 'suspension')),
  reason        text not null check (char_length(reason) between 8 and 500),
  created_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id) on delete set null,
  expires_at    timestamptz,
  revoked_at    timestamptz,
  revoked_by    uuid references auth.users(id) on delete set null,
  revoke_reason text,
  constraint user_sanctions_expiry_check check (expires_at is null or expires_at > created_at),
  constraint user_sanctions_suspension_expires check (type <> 'suspension' or expires_at is not null),
  constraint user_sanctions_revoke_check check ((revoked_at is null) = (revoked_by is null))
);
create index if not exists user_sanctions_user_idx   on public.user_sanctions (user_id, created_at desc);
create index if not exists user_sanctions_active_idx on public.user_sanctions (user_id) where revoked_at is null;

alter table public.user_sanctions enable row level security;
revoke all on public.user_sanctions from public, anon, authenticated;
grant select, insert, update on public.user_sanctions to service_role;

-- ----------------------------------------------------------------------------
-- §2 · AUDITORÍA GENERAL (reutiliza content_audit_log)
-- ----------------------------------------------------------------------------
alter table public.content_audit_log add column if not exists entity_type text;
alter table public.content_audit_log add column if not exists entity_id   text;
create index if not exists content_audit_entity_idx on public.content_audit_log (entity_type, entity_id, at desc);
create index if not exists content_audit_actor_idx  on public.content_audit_log (actor, at desc);

create or replace function public._content_audit_append_only()
returns trigger language plpgsql as $fn$
begin
  raise exception 'content_audit_log es de solo inserción' using errcode = '42501';
end; $fn$;

drop trigger if exists content_audit_append_only on public.content_audit_log;
create trigger content_audit_append_only
  before update or delete on public.content_audit_log
  for each row execute function public._content_audit_append_only();

-- ----------------------------------------------------------------------------
-- §3 · SANCIONAR / REVOCAR
-- ----------------------------------------------------------------------------
create or replace function public.app_admin_sanction(
  p_user uuid, p_type text, p_reason text, p_expires_at timestamptz, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_row public.user_sanctions;
begin
  if p_actor is null or not exists (select 1 from public.profiles where id = p_actor and is_admin) then
    raise exception 'NOT_ADMIN' using errcode = '42501';
  end if;
  if p_user = p_actor then raise exception 'SELF_SANCTION' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then raise exception 'USER_NOT_FOUND' using errcode = 'P0001'; end if;
  if exists (select 1 from public.profiles where id = p_user and is_admin) then raise exception 'TARGET_IS_ADMIN' using errcode = 'P0001'; end if;
  if p_type not in ('ban', 'suspension') then raise exception 'BAD_TYPE' using errcode = 'P0001'; end if;
  if p_type = 'suspension' and p_expires_at is null then raise exception 'SUSPENSION_NEEDS_EXPIRY' using errcode = 'P0001'; end if;
  if p_expires_at is not null and p_expires_at <= now() then raise exception 'BAD_EXPIRY' using errcode = 'P0001'; end if;

  -- Una sola sanción activa por usuario: se serializa sobre el perfil para que dos admins no sancionen a la vez.
  perform 1 from public.profiles where id = p_user for update;
  if exists (select 1 from public.user_sanctions
              where user_id = p_user and revoked_at is null and (expires_at is null or expires_at > now())) then
    raise exception 'ALREADY_SANCTIONED' using errcode = 'P0001';
  end if;

  insert into public.user_sanctions (user_id, type, reason, created_by, expires_at)
  values (p_user, p_type, p_reason, p_actor, p_expires_at)
  returning * into v_row;

  insert into public.content_audit_log (actor, action, entity_type, entity_id, detail)
  values (p_actor, 'user_sanction', 'user', p_user::text,
          jsonb_build_object('sanctionId', v_row.id, 'type', p_type, 'expiresAt', p_expires_at, 'reason', p_reason,
                             'before', null, 'after', jsonb_build_object('type', p_type, 'expiresAt', p_expires_at)));

  return to_jsonb(v_row);
end; $fn$;

create or replace function public.app_admin_revoke_sanction(p_id uuid, p_reason text, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_row public.user_sanctions;
begin
  if p_actor is null or not exists (select 1 from public.profiles where id = p_actor and is_admin) then
    raise exception 'NOT_ADMIN' using errcode = '42501';
  end if;
  if p_reason is null or char_length(p_reason) < 8 then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;

  select * into v_row from public.user_sanctions where id = p_id for update;
  if v_row.id is null then raise exception 'SANCTION_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_row.revoked_at is not null then raise exception 'ALREADY_REVOKED' using errcode = 'P0001'; end if;

  update public.user_sanctions
     set revoked_at = now(), revoked_by = p_actor, revoke_reason = p_reason
   where id = p_id
  returning * into v_row;

  insert into public.content_audit_log (actor, action, entity_type, entity_id, detail)
  values (p_actor, 'user_sanction_revoke', 'user', v_row.user_id::text,
          jsonb_build_object('sanctionId', p_id, 'reason', p_reason,
                             'before', jsonb_build_object('type', v_row.type, 'expiresAt', v_row.expires_at, 'revoked', false),
                             'after', jsonb_build_object('revoked', true)));

  return to_jsonb(v_row);
end; $fn$;

-- ----------------------------------------------------------------------------
-- §4 · AJUSTE DE CRÉDITOS (sobre la puerta única del libro mayor)
-- ----------------------------------------------------------------------------
create or replace function public.app_admin_adjust_credits(
  p_user uuid, p_delta bigint, p_reason text, p_actor uuid, p_ref text, p_expected_balance bigint)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_before bigint; v_after bigint; v_prev public.credit_transactions;
begin
  if p_actor is null or not exists (select 1 from public.profiles where id = p_actor and is_admin) then
    raise exception 'NOT_ADMIN' using errcode = '42501';
  end if;
  if p_ref is null or p_ref not like 'admin:credits:%' then raise exception 'REF_REQUIRED' using errcode = 'P0001'; end if;
  if p_delta = 0 or abs(p_delta) > 100000 then raise exception 'BAD_AMOUNT' using errcode = 'P0001'; end if;
  if p_reason is null or char_length(p_reason) < 8 then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;

  -- Idempotencia: la misma clave devuelve la operación ya hecha, sin tocar el saldo otra vez.
  select * into v_prev from public.credit_transactions where user_id = p_user and ref = p_ref limit 1;
  if v_prev.id is not null then
    return jsonb_build_object('repeated', true, 'balanceAfter', v_prev.balance_after, 'delta', v_prev.delta);
  end if;

  select credits into v_before from public.profiles where id = p_user for update;
  if v_before is null then raise exception 'USER_NOT_FOUND' using errcode = 'P0001'; end if;
  -- Concurrencia: si el saldo cambió desde que el admin lo revisó, no se aplica a ciegas.
  if p_expected_balance is not null and v_before <> p_expected_balance then
    raise exception 'STALE_BALANCE' using errcode = 'P0001';
  end if;

  v_after := public._ledger_apply(p_user, p_delta, 'admin_adjust: ' || p_reason, p_ref);

  insert into public.content_audit_log (actor, action, entity_type, entity_id, detail)
  values (p_actor, 'user_credits_adjust', 'user', p_user::text,
          jsonb_build_object('ref', p_ref, 'delta', p_delta, 'reason', p_reason,
                             'before', jsonb_build_object('credits', v_before), 'after', jsonb_build_object('credits', v_after)));

  return jsonb_build_object('repeated', false, 'balanceBefore', v_before, 'balanceAfter', v_after, 'delta', p_delta);
end; $fn$;

-- ----------------------------------------------------------------------------
-- §5 · AUDITORÍA DE ACCIONES NO TRANSACCIONALES
-- ----------------------------------------------------------------------------
create or replace function public.app_admin_audit(
  p_actor uuid, p_action text, p_entity_type text, p_entity_id text, p_detail jsonb)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  if p_actor is null or not exists (select 1 from public.profiles where id = p_actor and is_admin) then
    raise exception 'NOT_ADMIN' using errcode = '42501';
  end if;
  if p_action is null or p_action !~ '^[a-z][a-z0-9_]{2,63}$' then raise exception 'BAD_ACTION' using errcode = 'P0001'; end if;
  insert into public.content_audit_log (actor, action, entity_type, entity_id, detail)
  values (p_actor, p_action, p_entity_type, p_entity_id, coalesce(p_detail, '{}'::jsonb));
end; $fn$;

-- ----------------------------------------------------------------------------
-- §6 · BORRADORES DE EVENTO (staging; lo canónico sigue siendo public.events)
-- ----------------------------------------------------------------------------
--
-- `public.events` es EL evento que consume el juego (live events, desafíos por tipo/región pagados con `award()`), pero
-- el juego lo lee SIN filtrar por estado: un borrador escrito ahí aparecería a los jugadores. Por eso el borrador vive
-- aquí y solo al PUBLICAR se inserta la fila canónica en `events` (source = 'admin'), en la misma transacción que la
-- auditoría. No es un segundo sistema de eventos: es la antesala del único que hay.
create table if not exists public.admin_event_drafts (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (char_length(name) between 3 and 80),
  description  text check (description is null or char_length(description) <= 600),
  image_url    text check (image_url is null or image_url ~ '^/[A-Za-z0-9/_.-]+$' or image_url ~ '^https://'),
  type         text not null check (type in ('masters', 'champions', 'ewc', 'international', 'regional')),
  region       text check (region is null or region in ('EMEA', 'Americas', 'Pacific', 'China')),
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  status       text not null default 'draft' check (status in ('draft', 'published', 'cancelled')),
  event_id     text unique,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  published_at timestamptz,
  published_by uuid references auth.users(id) on delete set null,
  constraint admin_event_dates_check check (ends_at > starts_at),
  constraint admin_event_published_check check ((status = 'published') = (event_id is not null and published_at is not null))
);
create index if not exists admin_event_drafts_status_idx on public.admin_event_drafts (status, starts_at desc);
alter table public.admin_event_drafts enable row level security;
revoke all on public.admin_event_drafts from public, anon, authenticated;
grant select, insert, update on public.admin_event_drafts to service_role;

create or replace function public.app_admin_publish_event(p_id uuid, p_actor uuid, p_expected_updated_at timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_row public.admin_event_drafts; v_event_id text;
begin
  if p_actor is null or not exists (select 1 from public.profiles where id = p_actor and is_admin) then
    raise exception 'NOT_ADMIN' using errcode = '42501';
  end if;
  select * into v_row from public.admin_event_drafts where id = p_id for update;
  if v_row.id is null then raise exception 'EVENT_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_row.status <> 'draft' then raise exception 'NOT_A_DRAFT' using errcode = 'P0001'; end if;
  if p_expected_updated_at is not null and v_row.updated_at <> p_expected_updated_at then raise exception 'STALE_EVENT' using errcode = 'P0001'; end if;
  if v_row.ends_at <= now() then raise exception 'EVENT_ALREADY_ENDED' using errcode = 'P0001'; end if;

  v_event_id := 'adm-' || replace(v_row.id::text, '-', '');
  insert into public.events (id, name, type, region, status, start_date, end_date, source)
  values (v_event_id, v_row.name, v_row.type, v_row.region,
          case when v_row.starts_at > now() then 'upcoming' else 'ongoing' end,
          v_row.starts_at, v_row.ends_at, 'admin');

  update public.admin_event_drafts
     set status = 'published', event_id = v_event_id, published_at = now(), published_by = p_actor, updated_at = now()
   where id = p_id returning * into v_row;

  insert into public.content_audit_log (actor, action, entity_type, entity_id, detail)
  values (p_actor, 'event_publish', 'event', p_id::text,
          jsonb_build_object('eventId', v_event_id, 'before', jsonb_build_object('status', 'draft'),
                             'after', jsonb_build_object('status', 'published', 'eventId', v_event_id)));
  return to_jsonb(v_row);
end; $fn$;

-- ----------------------------------------------------------------------------
-- §7 · LECTURAS AGREGADAS DEL PANEL (sin volcar tablas enteras al servidor Node)
-- ----------------------------------------------------------------------------

-- Búsqueda de usuarios por nombre, id o email. El email vive en auth.users y solo sale por aquí (service_role).
create or replace function public.app_admin_search_users(p_q text, p_limit int default 25, p_offset int default 0)
returns table (id uuid, username text, email text, created_at timestamptz, last_sign_in_at timestamptz,
               last_seen_at timestamptz, is_admin boolean, credits bigint, level int, total bigint)
language sql stable security definer set search_path = public as $fn$
  with q as (select nullif(btrim(coalesce(p_q, '')), '') as t),
  base as (
    select p.id, p.username, u.email::text as email, u.created_at, u.last_sign_in_at, p.last_seen_at, p.is_admin, p.credits, p.level
      from public.profiles p join auth.users u on u.id = p.id, q
     where q.t is null
        or p.username ilike '%' || q.t || '%'
        or u.email ilike '%' || q.t || '%'
        or p.id::text = lower(q.t)
  )
  select b.*, count(*) over () as total from base b
   order by b.created_at desc
   limit greatest(1, least(coalesce(p_limit, 25), 100)) offset greatest(0, coalesce(p_offset, 0));
$fn$;

create or replace function public.app_admin_user_identity(p_user uuid)
returns jsonb language sql stable security definer set search_path = public as $fn$
  select jsonb_build_object('email', u.email, 'createdAt', u.created_at, 'lastSignInAt', u.last_sign_in_at,
                            'confirmedAt', u.email_confirmed_at, 'provider', u.raw_app_meta_data->>'provider')
    from auth.users u where u.id = p_user;
$fn$;

create or replace function public.app_admin_dashboard_stats()
returns jsonb language sql stable security definer set search_path = public as $fn$
  select jsonb_build_object(
    'users',             (select count(*) from public.profiles),
    'admins',            (select count(*) from public.profiles where is_admin),
    'newUsers7d',        (select count(*) from auth.users where created_at > now() - interval '7 days'),
    'seen24h',           (select count(*) from public.profiles where last_seen_at > now() - interval '24 hours'),
    'seen7d',            (select count(*) from public.profiles where last_seen_at > now() - interval '7 days'),
    'creditsInCirculation', (select coalesce(sum(credits), 0) from public.profiles),
    'cardsOwned',        (select count(*) from public.user_cards),
    'packsOpened',       (select coalesce(sum(packs_opened), 0) from public.user_game),
    'unopenedPacks',     (select coalesce(sum(qty), 0) from public.user_packs),
    'activeSanctions',   (select count(*) from public.user_sanctions where revoked_at is null and (expires_at is null or expires_at > now())),
    'ratedPlayers',      (select count(*) from public.duel_pvp_ratings where games_played > 0),
    'rankedResults',     (select count(*) from public.duel_pvp_rating_events),
    'catalogCards',      (select count(*) from public.content_cards),
    'catalogPublished',  (select count(*) from public.content_cards where lifecycle = 'PUBLISHED'),
    'eventDrafts',       (select count(*) from public.admin_event_drafts where status = 'draft')
  );
$fn$;

-- Fuentes y sumideros del libro mayor en una ventana: agrupados por el prefijo del motivo.
create or replace function public.app_admin_ledger_summary(p_days int default 7)
returns table (bucket text, entries bigint, credits_in bigint, credits_out bigint)
language sql stable security definer set search_path = public as $fn$
  select split_part(split_part(reason, ':', 1), ' ', 1) as bucket, count(*) as entries,
         coalesce(sum(delta) filter (where delta > 0), 0) as credits_in,
         coalesce(-sum(delta) filter (where delta < 0), 0) as credits_out
    from public.credit_transactions
   where created_at > now() - make_interval(days => greatest(1, least(coalesce(p_days, 7), 90)))
   group by 1 order by 3 + 4 desc limit 40;
$fn$;

-- ¿Qué migraciones están aplicadas? (0026+ se aplican a mano y no constan en schema_migrations: se mira el esquema.)
create or replace function public.app_admin_schema_probe()
returns jsonb language sql stable security definer set search_path = public as $fn$
  select jsonb_build_object(
    '0040_content_audit_log',   to_regclass('public.content_audit_log') is not null,
    '0050_duel_active_deck',    to_regclass('public.duel_active_deck') is not null,
    '0051_campaign_progress',   to_regclass('public.campaign_progress') is not null,
    '0052_user_card_favorites', to_regclass('public.user_card_favorites') is not null,
    '0053_draft_runs',          to_regclass('public.draft_runs') is not null,
    '0054_user_compositions',   to_regclass('public.user_compositions') is not null,
    '0055_user_sanctions',      to_regclass('public.user_sanctions') is not null,
    '0055_admin_event_drafts',  to_regclass('public.admin_event_drafts') is not null
  );
$fn$;

revoke all on function public.app_admin_sanction(uuid, text, text, timestamptz, uuid)            from public, anon, authenticated;
revoke all on function public.app_admin_revoke_sanction(uuid, text, uuid)                        from public, anon, authenticated;
revoke all on function public.app_admin_adjust_credits(uuid, bigint, text, uuid, text, bigint)    from public, anon, authenticated;
revoke all on function public.app_admin_audit(uuid, text, text, text, jsonb)                      from public, anon, authenticated;
grant execute on function public.app_admin_sanction(uuid, text, text, timestamptz, uuid)          to service_role;
grant execute on function public.app_admin_revoke_sanction(uuid, text, uuid)                      to service_role;
grant execute on function public.app_admin_adjust_credits(uuid, bigint, text, uuid, text, bigint)  to service_role;
grant execute on function public.app_admin_audit(uuid, text, text, text, jsonb)                    to service_role;


revoke all on function public.app_admin_publish_event(uuid, uuid, timestamptz)  from public, anon, authenticated;
revoke all on function public.app_admin_search_users(text, int, int)           from public, anon, authenticated;
revoke all on function public.app_admin_user_identity(uuid)                    from public, anon, authenticated;
revoke all on function public.app_admin_dashboard_stats()                      from public, anon, authenticated;
revoke all on function public.app_admin_ledger_summary(int)                    from public, anon, authenticated;
revoke all on function public.app_admin_schema_probe()                         from public, anon, authenticated;
grant execute on function public.app_admin_publish_event(uuid, uuid, timestamptz) to service_role;
grant execute on function public.app_admin_search_users(text, int, int)          to service_role;
grant execute on function public.app_admin_user_identity(uuid)                   to service_role;
grant execute on function public.app_admin_dashboard_stats()                     to service_role;
grant execute on function public.app_admin_ledger_summary(int)                   to service_role;
grant execute on function public.app_admin_schema_probe()                        to service_role;

comment on table public.user_sanctions is 'F58 · sanciones (ban/suspension) emitidas desde el panel. Enforcement server-side en getSession/middleware.';
comment on table public.admin_event_drafts is 'F58 · borradores de evento del panel; publicar inserta la fila canónica en public.events (source=admin).';
