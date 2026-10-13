-- FASE 69 · réplica SINTÉTICA de los objetos que toca 0058, con los privilegios MEDIDOS en la BD viva
-- (solo lectura, 2026-09-27). Para el dry-run aislado en PGlite (scripts/_fase69-0058-dryrun.mjs). Fuera de CI.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

create table public.profiles (
  id uuid primary key references auth.users(id), username text not null, avatar text default '🙂', level int default 1,
  xp int default 0, credits bigint default 6000, tokens bigint default 0, collection_value bigint default 0,
  distinct_cards int default 0, rarest_rank int default 0, market_volume bigint default 0, packs_opened int default 0,
  created_at timestamptz default now(), updated_at timestamptz default now(), taxes_paid bigint default 0,
  is_admin boolean default false, points int default 0, region text, equipped jsonb default '{}', last_seen_at timestamptz);
alter table public.profiles enable row level security;
create policy "crea tu perfil" on public.profiles for insert with check (auth.uid() = id);
create policy "edita tu perfil" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);
create policy "perfiles visibles para todos" on public.profiles for select using (true);
-- Privilegios medidos: SELECT/INSERT/DELETE/TRUNCATE/REFERENCES/TRIGGER de tabla + UPDATE de 3 columnas.
grant select, insert, delete, truncate, references, trigger on public.profiles to anon, authenticated;
grant update (username, region, avatar) on public.profiles to authenticated;
grant all on public.profiles to service_role;

create function public.profiles_guard_protected_columns() returns trigger language plpgsql as $$ begin
  if current_user in ('anon', 'authenticated') and (new.credits is distinct from old.credits or new.xp is distinct from old.xp or new.is_admin is distinct from old.is_admin or new.points is distinct from old.points) then
    raise exception 'columna protegida';
  end if; return new; end $$;
create trigger profiles_guard before update on public.profiles for each row execute function public.profiles_guard_protected_columns();
create function public.handle_new_user() returns trigger language plpgsql security definer as $$ begin
  insert into public.profiles (id, username) values (new.id, coalesce(new.email, 'u')); return new; end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- Vistas públicas (dueño = superusuario, sin security_invoker) con ALL para los clientes, como en la BD viva.
create view public.ranking_points as select id, username, avatar, points, xp, level, region from public.profiles p where points > 0 order by points desc, xp desc limit 100;
create table public.pickem_questions (id uuid primary key default gen_random_uuid(), pickem_event_id text, kind text, match_id text, prompt text, options jsonb, points int, locks_at timestamptz, order_idx int, correct_option text);
alter table public.pickem_questions enable row level security;
grant all on public.pickem_questions to service_role;
create view public.pickem_questions_public as select id, pickem_event_id, kind, match_id, prompt, options, points, locks_at, order_idx, now() >= locks_at as locked, case when now() >= locks_at then correct_option else null end as correct_option from public.pickem_questions q;
create table public.assets (id uuid primary key default gen_random_uuid(), kind text, subject_id text, url text, meta jsonb default '{}', source text, captured_at timestamptz, quality int, status text, priority int, created_at timestamptz default now(), updated_at timestamptz default now());
alter table public.assets enable row level security;
create policy "assets legibles" on public.assets for select using (true);
grant select, update, delete on public.assets to anon, authenticated;
create view public.card_photos as select id, subject_id as player_id, coalesce(url, meta->>'url') as url, source, captured_at, quality, status as approval_status, priority, meta->>'notes' as notes, created_at, updated_at from public.assets where kind = 'player_photo';
create table public.content_cards (card_id text primary key, definition_version int default 1);
alter table public.content_cards enable row level security;
create view public.v_content_cards_editadas with (security_invoker = true) as select card_id, definition_version from public.content_cards cc where definition_version > 1;
-- v3 · vistas heredadas de 0001 (sin uso en el producto), mismas columnas y ALL para clientes, como en la BD viva.
create view public.ranking_level as select id, username, avatar, level, xp from public.profiles order by xp desc limit 100;
create view public.ranking_collection as select id, username, avatar, collection_value, distinct_cards from public.profiles order by collection_value desc limit 100;
create view public.ranking_market as select id, username, avatar, market_volume from public.profiles order by market_volume desc limit 100;
create view public.ranking_rarities as select id, username, avatar, rarest_rank, distinct_cards from public.profiles order by rarest_rank desc, distinct_cards desc limit 100;
grant all on public.ranking_points, public.pickem_questions_public, public.card_photos, public.ranking_level, public.ranking_collection, public.ranking_market, public.ranking_rarities to anon, authenticated;

-- Funciones SECURITY DEFINER con las firmas reales (cuerpos mínimos) + una con auth.uid() que debe seguir abierta.
create table public.market_offers (id uuid primary key default gen_random_uuid(), listing_id uuid, buyer_id uuid, price bigint, status text default 'active', expires_at timestamptz, resolved_at timestamptz);
create function public.recompute_standings(p_event_id text) returns void language plpgsql security definer as $$ begin perform 1; end $$;
create function public.recompute_team_stats(p_team_id text, p_event_id text) returns void language plpgsql security definer as $$ begin perform 1; end $$;
create function public.recompute_player_event_stats(p_event_id text) returns void language plpgsql security definer as $$ begin perform 1; end $$;
create function public.expire_offers() returns int language plpgsql security definer as $$ declare o record; n int := 0; begin
  for o in select * from public.market_offers where status = 'active' and expires_at < now() loop
    update public.market_offers set status = 'expired', resolved_at = now() where id = o.id;
    update public.profiles set credits = credits + o.price where id = o.buyer_id; n := n + 1; end loop; return n; end $$;
create function public._release_listing_offers(p_listing_id uuid, p_except uuid) returns void language plpgsql security definer as $$ declare o record; begin
  for o in select * from public.market_offers where listing_id = p_listing_id and status = 'active' and (p_except is null or id <> p_except) loop
    update public.market_offers set status = 'rejected', resolved_at = now() where id = o.id;
    update public.profiles set credits = credits + o.price where id = o.buyer_id; end loop; end $$;
create function public._check_wash(p_buyer uuid, p_seller uuid) returns void language plpgsql security definer as $$ begin perform 1; end $$;
create function public._check_rate(p_action text, p_max integer) returns void language plpgsql security definer as $$ begin perform 1; end $$;
create function public._check_price_band(p_card_id text, p_price bigint) returns void language plpgsql security definer as $$ begin perform 1; end $$;
create function public._price_anchor(p_card_id text) returns bigint language sql security definer as $$ select 0::bigint $$;
create function public._asset_refresh_best(p_kind text, p_subject_type text, p_subject_id text) returns void language plpgsql security definer as $$ begin perform 1; end $$;
create function public.cancel_offer(p_offer_id uuid) returns void language plpgsql security definer as $$ begin
  if auth.uid() is null then raise exception 'sin sesión'; end if; end $$;
-- Llamador SECURITY DEFINER real de un helper (buy_listing → _release_listing_offers): debe seguir funcionando.
create function public.buy_listing_stub(p_listing uuid) returns void language plpgsql security definer as $$ begin
  if auth.uid() is null then raise exception 'sin sesión'; end if; perform public._release_listing_offers(p_listing, null); end $$;
grant execute on all functions in schema public to anon, authenticated, service_role;

-- Datos sintéticos.
insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111', 'qa-a@example.invalid'), ('22222222-2222-2222-2222-222222222222', 'qa-b@example.invalid');
update public.profiles set points = 40, region = 'EMEA' where id = '11111111-1111-1111-1111-111111111111';
update public.profiles set is_admin = true where id = '22222222-2222-2222-2222-222222222222';
insert into public.pickem_questions (id, pickem_event_id, kind, prompt, options, points, locks_at, order_idx) values ('33333333-3333-3333-3333-333333333333', 'vlr-2766', 'winner', '¿Quién gana?', '[]', 10, now() + interval '1 day', 1);
insert into public.assets (id, kind, subject_id, url, status, priority) values ('44444444-4444-4444-4444-444444444444', 'player_photo', 'derke', '/players/derke.png', 'approved', 1);
insert into public.market_offers (listing_id, buyer_id, price) values ('55555555-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111', 500);
