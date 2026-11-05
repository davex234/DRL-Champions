-- 0048 · SOCIAL 1.0 — amistades, bloqueos, retos, presencia y duelos PRIVADOS (Fase 29) — APLICADA (VPS 2026-09-15, Fase 35.1).
--
-- Estado: fichero LOCAL, aditivo e idempotente. Aplicada en la BD del VPS el 2026-09-15 11:58Z (Fase 35.1), con `duel_pvp_expire_turn` corregido para conservar la semántica viva de 0035. No toca
-- `schema_migrations`. Es la ÚNICA migración que la fase necesita; sin ella `/api/game/social` y los
-- duelos privados responden error de dependencia (tablas ausentes) y el resto del producto no cambia.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 1. PRESENCIA: `profiles.last_seen_at`. La escribe SOLO el servidor con el usuario del token
--    (heartbeat). De aquí se derivan «En línea» (< 2 min), «Activo recientemente» (< 30 min) y
--    «Desconectado». Nunca se enseña el instante exacto a otros.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
alter table public.profiles add column if not exists last_seen_at timestamptz;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 2. AMISTADES. UNA fila por par de jugadores, ordenado (`user_lo < user_hi`): es imposible tener
--    A→B y B→A como dos amistades, y es imposible ser amigo de uno mismo (el CHECK lo prohíbe).
--    `requester_id` dice quién pidió; `status`: PENDING · ACCEPTED · DECLINED · BLOCKED;
--    `blocked_by` dice quién bloqueó (solo con BLOCKED). Tabla SOLO servidor (RLS sin políticas).
-- ─────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.duel_friendships (
  user_lo       uuid not null references auth.users(id) on delete cascade,
  user_hi       uuid not null references auth.users(id) on delete cascade,
  requester_id  uuid not null references auth.users(id) on delete cascade,
  status        text not null check (status in ('PENDING','ACCEPTED','DECLINED','BLOCKED')),
  blocked_by    uuid references auth.users(id) on delete cascade,
  created_at    timestamptz not null default now(),
  responded_at  timestamptz,
  updated_at    timestamptz not null default now(),
  primary key (user_lo, user_hi),
  constraint duel_friendships_ordered   check (user_lo < user_hi),
  constraint duel_friendships_requester check (requester_id in (user_lo, user_hi)),
  constraint duel_friendships_block     check ((status = 'BLOCKED') = (blocked_by is not null)),
  constraint duel_friendships_blocker   check (blocked_by is null or blocked_by in (user_lo, user_hi))
);
create index if not exists duel_friendships_hi_idx on public.duel_friendships (user_hi, status);
create index if not exists duel_friendships_lo_idx on public.duel_friendships (user_lo, status);

alter table public.duel_friendships enable row level security;
revoke all on public.duel_friendships from anon, authenticated;
grant all on public.duel_friendships to service_role;

drop trigger if exists duel_friendships_touch on public.duel_friendships;
create trigger duel_friendships_touch before update on public.duel_friendships
  for each row execute function public.touch_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 3. RETOS. Un reto de A a B con el mazo de A ya elegido; B elige el suyo al aceptar. Caduca por
--    `expires_at` (reloj del servidor, evaluado al leer/escribir: sin cron). Solo UN reto PENDIENTE
--    por par y sentido. `match_id` se reserva al aceptar (una sola vez) y la partida se crea con él.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.duel_challenges (
  id                 uuid primary key default gen_random_uuid(),
  challenger_id      uuid not null references auth.users(id) on delete cascade,
  challenged_id      uuid not null references auth.users(id) on delete cascade,
  status             text not null default 'PENDING'
                     check (status in ('PENDING','ACCEPTED','DECLINED','EXPIRED','CANCELLED','MATCHED')),
  challenger_deck_id uuid references public.duel_decks(id) on delete set null,
  challenged_deck_id uuid references public.duel_decks(id) on delete set null,
  match_id           uuid,
  previous_match_id  uuid,
  created_at         timestamptz not null default now(),
  expires_at         timestamptz not null,
  responded_at       timestamptz,
  constraint duel_challenges_not_self check (challenger_id <> challenged_id),
  constraint duel_challenges_match    check (status not in ('ACCEPTED','MATCHED') or match_id is not null)
);
create unique index if not exists duel_challenges_pending_uniq
  on public.duel_challenges (challenger_id, challenged_id) where status = 'PENDING';
create index if not exists duel_challenges_challenged_idx on public.duel_challenges (challenged_id, status, created_at desc);
create index if not exists duel_challenges_challenger_idx on public.duel_challenges (challenger_id, status, created_at desc);
create index if not exists duel_challenges_match_idx on public.duel_challenges (match_id) where match_id is not null;

alter table public.duel_challenges enable row level security;
revoke all on public.duel_challenges from anon, authenticated;
grant all on public.duel_challenges to service_role;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 4. MODO PRIVADO EN `duel_matches`: `PVP_PRIVATE`. Misma forma que PvP (dos jugadores, dos mazos,
--    A ≠ B), mismo motor, mismo reloj de turno, mismo cierre por abandono/tiempo. Lo que NO tiene es
--    liquidación: `duel_pvp_settle_match` sigue exigiendo `mode = 'PVP'` y responde NOT_PVP a una
--    partida privada. Los ratings, `games_played` y la escalera no se enteran de que existió.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
alter table public.duel_matches drop constraint if exists duel_matches_mode_check;
alter table public.duel_matches
  add constraint duel_matches_mode_check check (mode in ('PVE','PVP','PVP_PRIVATE'));

alter table public.duel_matches drop constraint if exists duel_matches_mode_shape;
alter table public.duel_matches
  add constraint duel_matches_mode_shape check (
    (mode = 'PVE' and player_b_id is null and deck_b_id is null)
    or
    (mode in ('PVP','PVP_PRIVATE') and player_b_id is not null and deck_b_id is not null
                                   and player_b_id <> user_id)
  );

-- Partida activa (matchmaking y guardas): una privada en curso también cuenta como «ocupado».
create or replace function public._duel_pvp_has_active_match(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.duel_matches m
     where m.mode in ('PVP','PVP_PRIVATE')
       and m.closed_reason is null
       and m.status in ('WAITING','IN_PROGRESS')
       and (m.user_id = p_user or m.player_b_id = p_user)
  );
$$;

-- El reloj de turno vence igual en una privada.
create or replace function public.duel_pvp_expired_candidates(p_limit int default 20)
returns setof public.duel_matches
language sql stable security definer set search_path = public as $$
  select *
    from public.duel_matches m
   where m.mode in ('PVP','PVP_PRIVATE')
     and m.closed_reason is null
     and m.status = 'IN_PROGRESS'
     and m.turn_deadline_at is not null
     and m.turn_deadline_at <= now()
   order by m.turn_deadline_at
   limit greatest(p_limit, 1);
$$;

-- FASE 35.1 · Cuerpo IDÉNTICO al vigente de 0035 (medido en la BD real) salvo el filtro de modo. La
-- versión anterior de este fichero cambiaba además la distinción NOT_DUE / LOST_RACE (la decidía por
-- `state_version`); aplicarla habría alterado en silencio el cierre por tiempo del PvP ranked.
create or replace function public.duel_pvp_expire_turn(
  p_match uuid, p_version int, p_loser uuid
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not exists (
    select 1 from public.duel_matches m
     where m.id = p_match and m.mode in ('PVP','PVP_PRIVATE')
       and p_loser is not null and p_loser in (m.user_id, m.player_b_id)
  ) then
    return jsonb_build_object('code', 'NOT_A_PLAYER');
  end if;

  update public.duel_matches
     set closed_reason = 'EXPIRED',
         closed_by     = p_loser,
         closed_at     = now(),
         state_version = state_version + 1
   where id = p_match
     and state_version = p_version
     and closed_reason is null
     and mode in ('PVP','PVP_PRIVATE')
     and status = 'IN_PROGRESS'
     and turn_deadline_at is not null
     and turn_deadline_at <= now()
   returning id into v_id;

  if v_id is not null then
    return jsonb_build_object('code', 'EXPIRED', 'matchId', v_id, 'loser', p_loser);
  end if;

  -- Igual que 0035: «todavía no tocaba» (NOT_DUE) frente a «alguien llegó antes» (LOST_RACE).
  if exists (
    select 1 from public.duel_matches m
     where m.id = p_match and m.closed_reason is null and m.status = 'IN_PROGRESS'
       and (m.turn_deadline_at is null or m.turn_deadline_at > now())
  ) then
    return jsonb_build_object('code', 'NOT_DUE');
  end if;

  return jsonb_build_object('code', 'LOST_RACE');
end $$;

create index if not exists duel_matches_private_a_idx on public.duel_matches (user_id, updated_at desc) where mode = 'PVP_PRIVATE';
create index if not exists duel_matches_private_b_idx on public.duel_matches (player_b_id, updated_at desc) where mode = 'PVP_PRIVATE';

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 5. RPCs SOCIALES (transiciones atómicas; el cliente solo envía ids). Todas `security definer`,
--    solo `service_role`. El servidor pasa `p_user` desde el token.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

-- Pedir amistad. Idempotente: repetir devuelve el estado. Cruzadas: si B ya me había pedido, ACEPTA.
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

-- Responder. Solo el DESTINATARIO de una solicitud pendiente.
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

-- Eliminar amigo (o retirar mi solicitud pendiente). Las partidas jugadas no se tocan.
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

-- Bloquear: sustituye cualquier relación por BLOCKED (bloqueador = p_user) y cancela los retos
-- pendientes en los dos sentidos. No borra partidas ni asientos de rating.
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

-- Desbloquear: solo quien bloqueó. La relación desaparece (no vuelve a ser amistad sola).
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

-- Caduca perezosamente los retos pendientes vencidos que tocan a p_user (sin cron).
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

-- Crear reto. Exige amistad ACEPTADA (sin bloqueo). El mazo del retador ya viene validado por el
-- servidor (`resolveDeckSnapshot`). Si ya hay uno pendiente en este sentido, lo devuelve (idempotente).
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

-- Responder a un reto. Solo el RETADO. Aceptar reserva `match_id` UNA sola vez: un segundo aceptar
-- (doble clic, dos pestañas) recibe ALREADY_ACCEPTED con el MISMO match_id.
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

-- La partida ya existe: el reto pasa a MATCHED (idempotente).
create or replace function public.social_challenge_mark_matched(p_challenge uuid, p_match uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  update public.duel_challenges set status = 'MATCHED'
   where id = p_challenge and match_id = p_match and status in ('ACCEPTED','MATCHED');
  return jsonb_build_object('code','MATCHED');
end $$;

-- La partida no pudo crearse (p. ej. el mazo del retador dejó de ser legal): el reto se cancela.
create or replace function public.social_challenge_fail(p_challenge uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  update public.duel_challenges set status = 'CANCELLED', responded_at = now()
   where id = p_challenge and status = 'ACCEPTED';
  return jsonb_build_object('code','CANCELLED');
end $$;

-- Cancelar: solo el retador, solo mientras está pendiente.
create or replace function public.social_challenge_cancel(p_user uuid, p_challenge uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.duel_challenges set status = 'CANCELLED', responded_at = now()
   where id = p_challenge and challenger_id = p_user and status = 'PENDING';
  get diagnostics n = row_count;
  return jsonb_build_object('code', case when n > 0 then 'CANCELLED' else 'NOT_PENDING' end);
end $$;

do $mig$
declare f text;
begin
  foreach f in array array[
    'social_friend_request(uuid,uuid)', 'social_friend_respond(uuid,uuid,boolean)', 'social_unfriend(uuid,uuid)',
    'social_block(uuid,uuid)', 'social_unblock(uuid,uuid)', 'social_challenge_expire_due(uuid)',
    'social_challenge_create(uuid,uuid,uuid,uuid,int)', 'social_challenge_respond(uuid,uuid,boolean,uuid)',
    'social_challenge_mark_matched(uuid,uuid)', 'social_challenge_fail(uuid)', 'social_challenge_cancel(uuid,uuid)',
    '_duel_pvp_has_active_match(uuid)', 'duel_pvp_expired_candidates(int)', 'duel_pvp_expire_turn(uuid,int,uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $mig$;

-- Búsqueda de jugadores por nombre (prefijo, sin distinguir mayúsculas), acotada: índice de patrón.
create index if not exists profiles_username_lower_idx on public.profiles (lower(username) text_pattern_ops);

comment on table public.duel_friendships is 'Social 1.0 (Fase 29). Una fila por par ordenado; PENDING/ACCEPTED/DECLINED/BLOCKED. Solo servidor.';
comment on table public.duel_challenges is 'Retos a duelo privado (Fase 29). Caducan por expires_at (reloj del servidor, evaluado al leer/escribir). Solo servidor.';
