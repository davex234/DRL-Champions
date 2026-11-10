-- ============================================================================================================
-- 0066 · F85 SOCIAL 2.0 — amigos, bloqueo, presencia y retos SOBRE el social de F29 (0048). Aditiva.
--
-- F85 NO crea un segundo sistema social: reutiliza `duel_friendships` (par canónico `user_lo < user_hi`, una fila por
-- pareja), `duel_challenges` (reto con `match_id` reservado una vez), `profiles.last_seen_at` (latido) y el modo
-- `PVP_PRIVATE` (sin liquidación). Lo que cambia:
--
--   1. social_blocks      BLOQUEO por dirección (bloqueador → bloqueado). En 0048 el bloqueo era un estado de la fila de
--                         amistad: si los DOS se bloqueaban, el segundo pisaba al primero y un desbloqueo borraba el
--                         bloqueo ajeno. Ahora cada bloqueo es suyo; bloquear borra la amistad/solicitud y cancela los
--                         retos pendientes; desbloquear NO restaura nada. Las filas BLOCKED existentes se migran.
--   2. Límites en BD      300 amigos por jugador, 50 solicitudes salientes pendientes, 10 retos por pareja y hora.
--                         Comprobados bajo cerrojo consultivo de los dos usuarios (orden fijo): sin carreras.
--   3. Retos              UN reto pendiente por PAREJA (en cualquier sentido; índice único). Crear exige amistad, ni
--                         bloqueo, ni partida activa, ni cola ranked viva. ACEPTAR vuelve a comprobarlo TODO bajo el
--                         bloqueo de la fila del reto (amistad, bloqueo, partida activa, cola, caducidad por hora de BD):
--                         dejar de ser amigos o bloquear deja el reto inservible; nunca «cancelado + partida».
--   4. Dejar de ser amigos cancela los retos pendientes de la pareja.
--   5. Reserva: un reto ACEPTADO cuya partida está naciendo cuenta como «ocupado» (2 min) para crear/aceptar otro reto;
--      la caducidad perezosa cancela las reservas huérfanas. Nunca dos partidas amistosas para el mismo jugador.
--
-- Nada toca ratings, asientos, temporadas, misiones, economía ni partidas existentes. Un duelo amistoso sigue siendo
-- `PVP_PRIVATE`: `duel_pvp_settle_match` lo rechaza (NOT_PVP), y las misiones/XP de temporada lo excluyen en el servidor.
-- Seguridad: RPC SECURITY DEFINER con EXECUTE solo service_role; el jugador solo LEE sus propios bloqueos.
-- Rollback: docs/operations/rollback/0066_social_2.ROLLBACK.sql
-- ============================================================================================================

-- ── 1. bloqueos ───────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.social_blocks (
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint social_blocks_not_self check (blocker_id <> blocked_id)
);
create index if not exists social_blocks_blocked_idx on public.social_blocks (blocked_id);
alter table public.social_blocks enable row level security;
revoke all on public.social_blocks from public, anon, authenticated;
grant select on public.social_blocks to authenticated;
grant select, insert, update, delete on public.social_blocks to service_role;
drop policy if exists "tus bloqueos" on public.social_blocks;
create policy "tus bloqueos" on public.social_blocks for select to authenticated using (auth.uid() = blocker_id);
comment on table public.social_blocks is 'F85 · bloqueos por dirección. Solo el bloqueador ve su fila; el bloqueado nunca sabe quién le bloqueó.';

-- Las filas BLOCKED de 0048 pasan a ser bloqueos del bloqueador; la fila de amistad desaparece.
insert into public.social_blocks (blocker_id, blocked_id, created_at)
select f.blocked_by, case when f.blocked_by = f.user_lo then f.user_hi else f.user_lo end, coalesce(f.responded_at, f.updated_at, now())
  from public.duel_friendships f
 where f.status = 'BLOCKED' and f.blocked_by is not null
on conflict do nothing;
delete from public.duel_friendships where status = 'BLOCKED';

-- ── 2. un reto pendiente por pareja (en cualquier sentido) ───────────────────────────────────────────────
create unique index if not exists duel_challenges_pending_pair_uniq
  on public.duel_challenges (least(challenger_id, challenged_id), greatest(challenger_id, challenged_id)) where status = 'PENDING';
-- Recientes por pareja (tope de 10/h) y por retado.
create index if not exists duel_challenges_pair_recent_idx on public.duel_challenges (challenger_id, challenged_id, created_at desc);

-- ── 3. utilidades internas ────────────────────────────────────────────────────────────────────────────────
create or replace function public._social_blocked(p_a uuid, p_b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.social_blocks b
                  where (b.blocker_id = p_a and b.blocked_id = p_b) or (b.blocker_id = p_b and b.blocked_id = p_a));
$$;

-- Cerrojo consultivo de los dos usuarios en orden fijo: cuenta de amigos/solicitudes y transiciones se serializan.
create or replace function public._social_lock_pair(p_a uuid, p_b uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtext('social:' || least(p_a, p_b)::text));
  perform pg_advisory_xact_lock(hashtext('social:' || greatest(p_a, p_b)::text));
end $$;

create or replace function public._social_friend_count(p_user uuid)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from public.duel_friendships f where f.status = 'ACCEPTED' and (f.user_lo = p_user or f.user_hi = p_user);
$$;

-- Búsqueda ranked VIVA (F76: QUEUED/PAIRING sin caducar). Un reto amistoso no se acepta ni se crea con la cola abierta.
create or replace function public._social_in_queue(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.duel_pvp_queue q where q.user_id = p_user and q.state in ('QUEUED','PAIRING') and q.expires_at > now());
$$;

-- Reto ACEPTADO cuya partida aún no ha nacido (la RPC reserva `match_id` y el servidor crea la partida justo después, en
-- otra transacción). Durante esa ventana `_duel_pvp_has_active_match` todavía no ve la partida: sin esta reserva, aceptar
-- a la vez los retos de DOS amigos crearía dos partidas para el mismo jugador. Se acota a 2 min: una reserva huérfana (el
-- servidor cayó entre pasos) no bloquea para siempre y `social_challenge_expire_due` la cancela.
create or replace function public._social_reserved(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.duel_challenges c
                  where c.status = 'ACCEPTED' and (c.challenger_id = p_user or c.challenged_id = p_user)
                    and c.responded_at > now() - interval '2 minutes');
$$;

-- Caducidad perezosa (sin cron), por reloj de la BD: PENDING vencidos → EXPIRED (como 0048) y, F85, reservas ACCEPTED de
-- más de 2 min cuya partida no existe → CANCELLED (nunca quedan «aceptado» sin partida).
create or replace function public.social_challenge_expire_due(p_user uuid)
returns int language plpgsql security definer set search_path = public as $$
declare n int; m int;
begin
  update public.duel_challenges set status = 'EXPIRED', responded_at = now()
   where status = 'PENDING' and expires_at <= now()
     and (challenger_id = p_user or challenged_id = p_user);
  get diagnostics n = row_count;
  update public.duel_challenges c set status = 'CANCELLED'
   where c.status = 'ACCEPTED' and c.responded_at <= now() - interval '2 minutes'
     and (c.challenger_id = p_user or c.challenged_id = p_user)
     and not exists (select 1 from public.duel_matches m where m.id = c.match_id);
  get diagnostics m = row_count;
  return n + m;
end $$;

-- ── 4. RPC de amistad ─────────────────────────────────────────────────────────────────────────────────────
-- Constantes de política (también en `src/domain/social/social.ts`, con test de espejo).
--   FRIENDS_LIMIT 300 · OUTGOING_PENDING_LIMIT 50
create or replace function public.social_friend_request(p_user uuid, p_target uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  lo uuid; hi uuid; f public.duel_friendships%rowtype; v_exists boolean;
begin
  if p_user is null or p_target is null or p_user = p_target then return jsonb_build_object('code','SELF'); end if;
  if not exists (select 1 from public.profiles where id = p_target) then return jsonb_build_object('code','NOT_FOUND'); end if;
  perform public._social_lock_pair(p_user, p_target);
  -- Bloqueo en cualquier sentido: misma respuesta neutra (no se revela quién bloqueó).
  if public._social_blocked(p_user, p_target) then return jsonb_build_object('code','UNAVAILABLE'); end if;
  lo := least(p_user, p_target); hi := greatest(p_user, p_target);

  select * into f from public.duel_friendships where user_lo = lo and user_hi = hi for update;
  v_exists := found;
  if v_exists and f.status = 'ACCEPTED' then return jsonb_build_object('code','ALREADY_FRIENDS'); end if;
  if v_exists and f.status = 'PENDING' and f.requester_id = p_user then return jsonb_build_object('code','ALREADY_PENDING'); end if;

  if v_exists and f.status = 'PENDING' then
    -- Solicitud CRUZADA: el otro ya me había pedido → converge en UNA amistad aceptada (si caben los dos).
    if public._social_friend_count(p_user) >= 300 or public._social_friend_count(p_target) >= 300 then
      return jsonb_build_object('code','FRIEND_LIMIT');
    end if;
    update public.duel_friendships set status = 'ACCEPTED', responded_at = now() where user_lo = lo and user_hi = hi;
    return jsonb_build_object('code','ACCEPTED');
  end if;

  if public._social_friend_count(p_user) >= 300 then return jsonb_build_object('code','FRIEND_LIMIT'); end if;
  if (select count(*) from public.duel_friendships x
       where x.status = 'PENDING' and x.requester_id = p_user and (x.user_lo = p_user or x.user_hi = p_user)) >= 50 then
    return jsonb_build_object('code','PENDING_LIMIT');
  end if;

  if not v_exists then
    insert into public.duel_friendships (user_lo, user_hi, requester_id, status) values (lo, hi, p_user, 'PENDING');
  else
    -- DECLINED (o restos): se puede volver a pedir; quien pide ahora es el solicitante.
    update public.duel_friendships set status = 'PENDING', requester_id = p_user, blocked_by = null, responded_at = null, created_at = now()
     where user_lo = lo and user_hi = hi;
  end if;
  return jsonb_build_object('code','REQUESTED');
end $$;

create or replace function public.social_friend_respond(p_user uuid, p_target uuid, p_accept boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  lo uuid; hi uuid; f public.duel_friendships%rowtype;
begin
  if p_user is null or p_target is null or p_user = p_target then return jsonb_build_object('code','SELF'); end if;
  perform public._social_lock_pair(p_user, p_target);
  lo := least(p_user, p_target); hi := greatest(p_user, p_target);
  select * into f from public.duel_friendships where user_lo = lo and user_hi = hi for update;
  if not found or f.status <> 'PENDING' then return jsonb_build_object('code','NO_REQUEST', 'status', coalesce(f.status,'NONE')); end if;
  if f.requester_id = p_user then return jsonb_build_object('code','NOT_TARGET'); end if;
  if p_accept and (public._social_friend_count(p_user) >= 300 or public._social_friend_count(p_target) >= 300) then
    return jsonb_build_object('code','FRIEND_LIMIT');
  end if;
  update public.duel_friendships
     set status = case when p_accept then 'ACCEPTED' else 'DECLINED' end, responded_at = now()
   where user_lo = lo and user_hi = hi;
  return jsonb_build_object('code', case when p_accept then 'ACCEPTED' else 'DECLINED' end);
end $$;

-- Eliminar amigo (o retirar mi solicitud). Cancela los retos pendientes de la pareja. Partidas e historial intactos.
create or replace function public.social_unfriend(p_user uuid, p_target uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  lo uuid; hi uuid; n int;
begin
  if p_user is null or p_target is null or p_user = p_target then return jsonb_build_object('code','SELF'); end if;
  perform public._social_lock_pair(p_user, p_target);
  lo := least(p_user, p_target); hi := greatest(p_user, p_target);
  delete from public.duel_friendships
   where user_lo = lo and user_hi = hi
     and (status = 'ACCEPTED' or status = 'DECLINED' or (status = 'PENDING' and requester_id = p_user));
  get diagnostics n = row_count;
  if n > 0 then
    update public.duel_challenges set status = 'CANCELLED', responded_at = now()
     where status = 'PENDING'
       and ((challenger_id = p_user and challenged_id = p_target) or (challenger_id = p_target and challenged_id = p_user));
  end if;
  return jsonb_build_object('code', case when n > 0 then 'REMOVED' else 'NOT_FRIENDS' end);
end $$;

-- Bloquear: el bloqueo es MÍO (no pisa el del otro). Borra amistad/solicitud y cancela retos pendientes de la pareja.
-- Una partida ya empezada no se toca: termina por su ciclo normal.
create or replace function public.social_block(p_user uuid, p_target uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  lo uuid; hi uuid;
begin
  if p_user is null or p_target is null or p_user = p_target then return jsonb_build_object('code','SELF'); end if;
  if not exists (select 1 from public.profiles where id = p_target) then return jsonb_build_object('code','NOT_FOUND'); end if;
  perform public._social_lock_pair(p_user, p_target);
  lo := least(p_user, p_target); hi := greatest(p_user, p_target);
  insert into public.social_blocks (blocker_id, blocked_id) values (p_user, p_target) on conflict do nothing;
  delete from public.duel_friendships where user_lo = lo and user_hi = hi;
  update public.duel_challenges set status = 'CANCELLED', responded_at = now()
   where status = 'PENDING'
     and ((challenger_id = p_user and challenged_id = p_target) or (challenger_id = p_target and challenged_id = p_user));
  return jsonb_build_object('code','BLOCKED');
end $$;

-- Desbloquear: solo MI bloqueo. No restaura amistad: la relación queda en NINGUNA (salvo que el otro me bloquee).
create or replace function public.social_unblock(p_user uuid, p_target uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if p_user is null or p_target is null or p_user = p_target then return jsonb_build_object('code','SELF'); end if;
  delete from public.social_blocks where blocker_id = p_user and blocked_id = p_target;
  get diagnostics n = row_count;
  return jsonb_build_object('code', case when n > 0 then 'UNBLOCKED' else 'NOT_BLOCKED' end);
end $$;

-- ── 5. RPC de retos ───────────────────────────────────────────────────────────────────────────────────────
-- Crear: amistad aceptada, sin bloqueo, sin partida activa, sin cola ranked viva, UN pendiente por pareja, ≤ 10/h.
create or replace function public.social_challenge_create(
  p_user uuid, p_target uuid, p_deck uuid, p_previous_match uuid, p_ttl_seconds int
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  lo uuid; hi uuid; f public.duel_friendships%rowtype; c public.duel_challenges%rowtype;
begin
  if p_user is null or p_target is null or p_user = p_target then return jsonb_build_object('code','SELF'); end if;
  perform public._social_lock_pair(p_user, p_target);
  if public._social_blocked(p_user, p_target) then return jsonb_build_object('code','UNAVAILABLE'); end if;
  lo := least(p_user, p_target); hi := greatest(p_user, p_target);
  select * into f from public.duel_friendships where user_lo = lo and user_hi = hi;
  if not found or f.status <> 'ACCEPTED' then return jsonb_build_object('code','NOT_FRIENDS'); end if;
  perform public.social_challenge_expire_due(p_user);
  perform public.social_challenge_expire_due(p_target);
  -- Ya hay uno pendiente en la pareja: el mío (idempotente) o el SUYO (que lo acepte en vez de cruzarse).
  select * into c from public.duel_challenges
   where status = 'PENDING' and ((challenger_id = p_user and challenged_id = p_target) or (challenger_id = p_target and challenged_id = p_user))
   for update;
  if found then
    return jsonb_build_object('code', case when c.challenger_id = p_user then 'ALREADY_PENDING' else 'INCOMING_PENDING' end,
                              'challengeId', c.id, 'expiresAt', c.expires_at);
  end if;
  if public._duel_pvp_has_active_match(p_user) or public._duel_pvp_has_active_match(p_target)
     or public._social_reserved(p_user) or public._social_reserved(p_target) then return jsonb_build_object('code','BUSY'); end if;
  if public._social_in_queue(p_user) or public._social_in_queue(p_target) then return jsonb_build_object('code','IN_QUEUE'); end if;
  if (select count(*) from public.duel_challenges x where x.challenger_id = p_user and x.challenged_id = p_target and x.created_at > now() - interval '1 hour') >= 10 then
    return jsonb_build_object('code','CHALLENGE_LIMIT');
  end if;
  insert into public.duel_challenges (challenger_id, challenged_id, challenger_deck_id, previous_match_id, expires_at)
  values (p_user, p_target, p_deck, p_previous_match, now() + make_interval(secs => least(3600, greatest(60, p_ttl_seconds))))
  returning * into c;
  return jsonb_build_object('code','CREATED','challengeId', c.id, 'expiresAt', c.expires_at);
end $$;

-- Responder. Solo el RETADO. Aceptar reserva `match_id` UNA vez (doble aceptación → mismo id) y, bajo el bloqueo de la
-- fila del reto, comprueba TODO otra vez con la hora de la BD: caducidad, amistad, bloqueo, partida activa y cola.
create or replace function public.social_challenge_respond(p_user uuid, p_challenge uuid, p_accept boolean, p_deck uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c public.duel_challenges%rowtype; v_match uuid; lo uuid; hi uuid;
begin
  -- Orden de cerrojos FIJO (pareja → fila del reto), el mismo que dejar de ser amigos/bloquear: aceptar y esas acciones
  -- se serializan y la segunda ve lo que hizo la primera.
  select * into c from public.duel_challenges where id = p_challenge;
  if not found then return jsonb_build_object('code','NOT_FOUND'); end if;
  if c.challenged_id <> p_user then return jsonb_build_object('code','NOT_TARGET'); end if;
  perform public._social_lock_pair(c.challenger_id, c.challenged_id);
  select * into c from public.duel_challenges where id = p_challenge for update;
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
  lo := least(c.challenger_id, c.challenged_id); hi := greatest(c.challenger_id, c.challenged_id);
  -- Dejaron de ser amigos o hay bloqueo (en cualquier sentido): el reto queda cancelado, nunca se juega.
  if public._social_blocked(c.challenger_id, c.challenged_id)
     or not exists (select 1 from public.duel_friendships x where x.user_lo = lo and x.user_hi = hi and x.status = 'ACCEPTED') then
    update public.duel_challenges set status = 'CANCELLED', responded_at = now() where id = c.id;
    return jsonb_build_object('code','UNAVAILABLE');
  end if;
  -- Partida viva O reto ya aceptado cuya partida está naciendo (cerrojo por usuario de `_social_lock_pair`: dos
  -- aceptaciones que comparten jugador se serializan y la segunda ve la reserva de la primera).
  if public._duel_pvp_has_active_match(p_user) or public._duel_pvp_has_active_match(c.challenger_id)
     or public._social_reserved(p_user) or public._social_reserved(c.challenger_id) then
    return jsonb_build_object('code','BUSY');
  end if;
  -- En cola ranked: NO se cancela la búsqueda en silencio; el jugador debe salir de la cola (o esperar al rival).
  if public._social_in_queue(p_user) or public._social_in_queue(c.challenger_id) then
    return jsonb_build_object('code','IN_QUEUE');
  end if;
  v_match := gen_random_uuid();
  update public.duel_challenges
     set status = 'ACCEPTED', challenged_deck_id = p_deck, match_id = v_match, responded_at = now()
   where id = c.id and status = 'PENDING';
  return jsonb_build_object('code','ACCEPTED','matchId', v_match, 'challengerId', c.challenger_id,
    'challengerDeckId', c.challenger_deck_id, 'challengedDeckId', p_deck);
end $$;

-- ── 6. concesiones ────────────────────────────────────────────────────────────────────────────────────────
do $mig$
declare f text;
begin
  foreach f in array array[
    '_social_blocked(uuid,uuid)', '_social_lock_pair(uuid,uuid)', '_social_friend_count(uuid)', '_social_in_queue(uuid)',
    '_social_reserved(uuid)', 'social_challenge_expire_due(uuid)',
    'social_friend_request(uuid,uuid)', 'social_friend_respond(uuid,uuid,boolean)', 'social_unfriend(uuid,uuid)',
    'social_block(uuid,uuid)', 'social_unblock(uuid,uuid)',
    'social_challenge_create(uuid,uuid,uuid,uuid,int)', 'social_challenge_respond(uuid,uuid,boolean,uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $mig$;
