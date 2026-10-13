-- ============================================================================================================
-- ROLLBACK OPERATIVO de 0066 (F85 · Social 2.0). Ejecutar SOLO tras desplegar antes el código anterior a F85
-- (drl-0.1.1-1-50b3eb69). Restaura las RPC sociales EXACTAS de 0048 (copiadas de esa migración) y devuelve los bloqueos
-- al modelo antiguo (fila BLOCKED en duel_friendships; si dos jugadores se bloqueaban mutuamente, sobrevive uno: limitación
-- conocida de 0048). Amistades, retos, partidas y presencia se conservan.
-- ============================================================================================================
begin;
-- Bloqueos → filas BLOCKED (una por pareja: el más antiguo).
insert into public.duel_friendships (user_lo, user_hi, requester_id, status, blocked_by, responded_at)
select distinct on (least(b.blocker_id, b.blocked_id), greatest(b.blocker_id, b.blocked_id))
       least(b.blocker_id, b.blocked_id), greatest(b.blocker_id, b.blocked_id), b.blocker_id, 'BLOCKED', b.blocker_id, b.created_at
  from public.social_blocks b
 order by least(b.blocker_id, b.blocked_id), greatest(b.blocker_id, b.blocked_id), b.created_at
on conflict (user_lo, user_hi) do update set status = 'BLOCKED', blocked_by = excluded.blocked_by, requester_id = excluded.requester_id, responded_at = excluded.responded_at;

create or replace function public.social_friend_request(p_user uuid, p_target uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  lo uuid; hi uuid; f public.duel_friendships%rowtype;
begin
  if p_user is null or p_target is null or p_user = p_target then return jsonb_build_object('code','SELF'); end if;
  if not exists (select 1 from public.profiles where id = p_target) then return jsonb_build_object('code','NOT_FOUND'); end if;
  lo := least(p_user, p_target); hi := greatest(p_user, p_target);

  select * into f from public.duel_friendships where user_lo = lo and user_hi = hi for update;
  if not found then
    insert into public.duel_friendships (user_lo, user_hi, requester_id, status)
    values (lo, hi, p_user, 'PENDING')
    on conflict (user_lo, user_hi) do nothing;
    -- Carrera con una solicitud cruzada: si el insert no entró, se reevalúa con bloqueo.
    select * into f from public.duel_friendships where user_lo = lo and user_hi = hi for update;
    if f.requester_id = p_user and f.status = 'PENDING' then return jsonb_build_object('code','REQUESTED'); end if;
  end if;

  if f.status = 'BLOCKED'  then return jsonb_build_object('code','BLOCKED'); end if;
  if f.status = 'ACCEPTED' then return jsonb_build_object('code','ALREADY_FRIENDS'); end if;
  if f.status = 'PENDING' then
    if f.requester_id = p_user then return jsonb_build_object('code','ALREADY_PENDING'); end if;
    -- Solicitud CRUZADA: el otro ya me había pedido → converge en UNA amistad aceptada.
    update public.duel_friendships set status = 'ACCEPTED', responded_at = now()
     where user_lo = lo and user_hi = hi;
    return jsonb_build_object('code','ACCEPTED');
  end if;
  -- DECLINED: se puede volver a pedir; el que pide ahora pasa a ser el solicitante.
  update public.duel_friendships set status = 'PENDING', requester_id = p_user, responded_at = null, created_at = now()
   where user_lo = lo and user_hi = hi;
  return jsonb_build_object('code','REQUESTED');
end $$;

create or replace function public.social_friend_respond(p_user uuid, p_target uuid, p_accept boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  lo uuid; hi uuid; f public.duel_friendships%rowtype;
begin
  if p_user is null or p_target is null or p_user = p_target then return jsonb_build_object('code','SELF'); end if;
  lo := least(p_user, p_target); hi := greatest(p_user, p_target);
  select * into f from public.duel_friendships where user_lo = lo and user_hi = hi for update;
  if not found or f.status <> 'PENDING' then return jsonb_build_object('code','NO_REQUEST', 'status', coalesce(f.status,'NONE')); end if;
  if f.requester_id = p_user then return jsonb_build_object('code','NOT_TARGET'); end if;
  update public.duel_friendships
     set status = case when p_accept then 'ACCEPTED' else 'DECLINED' end, responded_at = now()
   where user_lo = lo and user_hi = hi;
  return jsonb_build_object('code', case when p_accept then 'ACCEPTED' else 'DECLINED' end);
end $$;

create or replace function public.social_unfriend(p_user uuid, p_target uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  lo uuid; hi uuid; n int;
begin
  if p_user is null or p_target is null or p_user = p_target then return jsonb_build_object('code','SELF'); end if;
  lo := least(p_user, p_target); hi := greatest(p_user, p_target);
  delete from public.duel_friendships
   where user_lo = lo and user_hi = hi
     and (status = 'ACCEPTED' or status = 'DECLINED' or (status = 'PENDING' and requester_id = p_user));
  get diagnostics n = row_count;
  return jsonb_build_object('code', case when n > 0 then 'REMOVED' else 'NOT_FRIENDS' end);
end $$;

create or replace function public.social_block(p_user uuid, p_target uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  lo uuid; hi uuid;
begin
  if p_user is null or p_target is null or p_user = p_target then return jsonb_build_object('code','SELF'); end if;
  if not exists (select 1 from public.profiles where id = p_target) then return jsonb_build_object('code','NOT_FOUND'); end if;
  lo := least(p_user, p_target); hi := greatest(p_user, p_target);
  insert into public.duel_friendships (user_lo, user_hi, requester_id, status, blocked_by, responded_at)
  values (lo, hi, p_user, 'BLOCKED', p_user, now())
  on conflict (user_lo, user_hi) do update
    set status = 'BLOCKED', blocked_by = excluded.blocked_by, requester_id = excluded.requester_id, responded_at = now();
  update public.duel_challenges
     set status = 'CANCELLED', responded_at = now()
   where status = 'PENDING'
     and ((challenger_id = p_user and challenged_id = p_target) or (challenger_id = p_target and challenged_id = p_user));
  return jsonb_build_object('code','BLOCKED');
end $$;

create or replace function public.social_unblock(p_user uuid, p_target uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  lo uuid; hi uuid; n int;
begin
  if p_user is null or p_target is null or p_user = p_target then return jsonb_build_object('code','SELF'); end if;
  lo := least(p_user, p_target); hi := greatest(p_user, p_target);
  delete from public.duel_friendships where user_lo = lo and user_hi = hi and status = 'BLOCKED' and blocked_by = p_user;
  get diagnostics n = row_count;
  return jsonb_build_object('code', case when n > 0 then 'UNBLOCKED' else 'NOT_BLOCKED' end);
end $$;

create or replace function public.social_challenge_create(
  p_user uuid, p_target uuid, p_deck uuid, p_previous_match uuid, p_ttl_seconds int
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  lo uuid; hi uuid; f public.duel_friendships%rowtype; c public.duel_challenges%rowtype;
begin
  if p_user is null or p_target is null or p_user = p_target then return jsonb_build_object('code','SELF'); end if;
  lo := least(p_user, p_target); hi := greatest(p_user, p_target);
  select * into f from public.duel_friendships where user_lo = lo and user_hi = hi;
  if not found or f.status <> 'ACCEPTED' then
    return jsonb_build_object('code', case when found and f.status = 'BLOCKED' then 'BLOCKED' else 'NOT_FRIENDS' end);
  end if;
  perform public.social_challenge_expire_due(p_user);
  select * into c from public.duel_challenges
   where challenger_id = p_user and challenged_id = p_target and status = 'PENDING' for update;
  if found then return jsonb_build_object('code','ALREADY_PENDING','challengeId', c.id, 'expiresAt', c.expires_at); end if;
  insert into public.duel_challenges (challenger_id, challenged_id, challenger_deck_id, previous_match_id, expires_at)
  values (p_user, p_target, p_deck, p_previous_match, now() + make_interval(secs => greatest(60, p_ttl_seconds)))
  on conflict (challenger_id, challenged_id) where status = 'PENDING' do nothing
  returning * into c;
  if c.id is null then
    select * into c from public.duel_challenges where challenger_id = p_user and challenged_id = p_target and status = 'PENDING';
    return jsonb_build_object('code','ALREADY_PENDING','challengeId', c.id, 'expiresAt', c.expires_at);
  end if;
  return jsonb_build_object('code','CREATED','challengeId', c.id, 'expiresAt', c.expires_at);
end $$;

create or replace function public.social_challenge_respond(p_user uuid, p_challenge uuid, p_accept boolean, p_deck uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c public.duel_challenges%rowtype; v_match uuid;
begin
  select * into c from public.duel_challenges where id = p_challenge for update;
  if not found then return jsonb_build_object('code','NOT_FOUND'); end if;
  if c.challenged_id <> p_user then return jsonb_build_object('code','NOT_TARGET'); end if;
  if c.status in ('ACCEPTED','MATCHED') then
    return jsonb_build_object('code','ALREADY_ACCEPTED','matchId', c.match_id, 'challengerId', c.challenger_id,
      'challengerDeckId', c.challenger_deck_id, 'challengedDeckId', c.challenged_deck_id, 'status', c.status);
  end if;
  if c.status <> 'PENDING' then return jsonb_build_object('code','NOT_PENDING','status', c.status); end if;
  if c.expires_at <= now() then
    update public.duel_challenges set status = 'EXPIRED', responded_at = now() where id = c.id;
    return jsonb_build_object('code','EXPIRED');
  end if;
  if not p_accept then
    update public.duel_challenges set status = 'DECLINED', responded_at = now() where id = c.id;
    return jsonb_build_object('code','DECLINED');
  end if;
  if p_deck is null then return jsonb_build_object('code','DECK_REQUIRED'); end if;
  if public._duel_pvp_has_active_match(p_user) or public._duel_pvp_has_active_match(c.challenger_id) then
    return jsonb_build_object('code','BUSY');
  end if;
  v_match := gen_random_uuid();
  update public.duel_challenges
     set status = 'ACCEPTED', challenged_deck_id = p_deck, match_id = v_match, responded_at = now()
   where id = c.id and status = 'PENDING';
  return jsonb_build_object('code','ACCEPTED','matchId', v_match, 'challengerId', c.challenger_id,
    'challengerDeckId', c.challenger_deck_id, 'challengedDeckId', p_deck);
end $$;

do $mig$
declare f text;
begin
  foreach f in array array['social_friend_request(uuid,uuid)', 'social_friend_respond(uuid,uuid,boolean)', 'social_unfriend(uuid,uuid)',
    'social_block(uuid,uuid)', 'social_unblock(uuid,uuid)', 'social_challenge_create(uuid,uuid,uuid,uuid,int)', 'social_challenge_respond(uuid,uuid,boolean,uuid)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $mig$;

-- 0048 · caducidad perezosa (sin la cancelación de reservas huérfanas de F85).
create or replace function public.social_challenge_expire_due(p_user uuid)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.duel_challenges set status = 'EXPIRED', responded_at = now()
   where status = 'PENDING' and expires_at <= now()
     and (challenger_id = p_user or challenged_id = p_user);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.social_challenge_expire_due(uuid) from public, anon, authenticated;
grant execute on function public.social_challenge_expire_due(uuid) to service_role;

drop function if exists public._social_reserved(uuid);
drop function if exists public._social_in_queue(uuid);
drop function if exists public._social_friend_count(uuid);
drop function if exists public._social_lock_pair(uuid, uuid);
drop function if exists public._social_blocked(uuid, uuid);
drop index if exists public.duel_challenges_pending_pair_uniq;
drop index if exists public.duel_challenges_pair_recent_idx;
drop table if exists public.social_blocks;
commit;
