-- ============================================================================================================
-- 0069 · F86 TORNEOS DE JUGADORES («copas») — eliminación directa de 4 a 64, inscripción, cuadro, avance y campeón.
--
-- NOMBRE. `tournaments` / `/torneos` son desde 0006 y la Fase 30 la capa ESPORTS (VLR, Pick'ems). Los torneos de
-- jugadores son `cups`, `cup_registrations` y `cup_matches`; en la interfaz se llaman «Torneos» y viven en /copas.
--
-- LO QUE SE REUTILIZA (nada de esto se duplica):
--   · Partida = `duel_matches` con mode = 'PVP_PRIVATE' (motor, reglas, mazos validados, reloj F72.8, abandono). Por
--     eso un cruce de torneo NO liquida rating (`duel_pvp_settle_match` exige 'PVP'), no da misiones F73 ni XP F83
--     (sus ganchos exigen ranked) y no consume el tope de parejas de F84 (vive en la liquidación ranked).
--     Enlace: `cup_matches.game_match_id` ÚNICO → exactamente una partida por cruce.
--   · Rating de las cabezas de serie = `duel_pvp_ratings` (F84), FOTOGRAFIADO al generar el cuadro.
--   · Trofeo = insignia `insignia:torneo:<slug>` en `user_cosmetics` (F82/F89): Sala de Trofeos y vitrina del perfil.
--   · Admin = `profiles.is_admin` releído en la BD + `content_audit_log` (append-only, 0055) en la MISMA transacción.
--   · Ocupado / en cola = `_duel_pvp_has_active_match`, `_social_reserved`, `_social_in_queue` (0048 / 0066).
--
-- AUTORIDAD. Todo lo que cambia la competición ocurre en RPC SECURITY DEFINER (EXECUTE solo service_role) que toman
-- el CERROJO DE LA COPA (`select … for update` sobre `cups`) antes de leer nada: inscripciones a la vez, 20 «generar»,
-- 20 liquidaciones del mismo resultado, «estoy listo» de los dos lados… se serializan por copa. Las filas de
-- `cup_registrations` / `cup_matches` y las columnas de sistema de `cups` SOLO cambian con `drl.cup_writer = on`, que
-- ponen esas RPC: ni service_role ni una consola pueden escribir un ganador, un seed o un avance «a mano» sin choque.
--
-- RESULTADO. Lo decide el MOTOR (`duel_matches.status/winner`, o `closed_by` en un abandono). Empate, «sin resolver» o
-- cierre por tiempo → ACTION_REQUIRED (retenido): no avanza nadie hasta que un admin resuelve con motivo, auditado.
-- Plazo vencido sin partida → lo resuelve un admin (A avanza, B avanza o los dos fuera). Jamás un sorteo.
--
-- Sin cron: las fases de inscripción se derivan de las fechas con `now()` de la BD; el cuadro (irreversible) se genera
-- UNA vez, perezosamente, la primera vez que alguien lo necesita tras el cierre (o el admin). Sin economía: 0 créditos,
-- 0 sobres, 0 cartas, 0 dinero — inscripción gratuita, el premio es el trofeo.
-- Rollback: docs/operations/rollback/0069_player_cups.ROLLBACK.sql
-- ============================================================================================================

-- ── 1. tablas ─────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.cups (
  id                    uuid primary key default gen_random_uuid(),
  slug                  text not null unique check (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$'),
  name                  text not null check (char_length(name) between 3 and 60),
  description           text not null default '' check (char_length(description) <= 1000),
  rules                 text not null default '' check (char_length(rules) <= 2000),
  format                text not null default 'SINGLE_ELIMINATION' check (format = 'SINGLE_ELIMINATION'),
  seeding_policy        text not null default 'RATING_SNAPSHOT' check (seeding_policy = 'RATING_SNAPSHOT'),
  visibility            text not null default 'PUBLIC' check (visibility in ('PUBLIC', 'UNLISTED')),
  status                text not null default 'DRAFT' check (status in ('DRAFT', 'PUBLISHED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
  registration_open_at  timestamptz not null,
  registration_close_at timestamptz not null,
  starts_at             timestamptz not null,
  round_window_minutes  int not null check (round_window_minutes between 10 and 10080),
  min_participants      int not null default 4 check (min_participants between 4 and 64),
  max_participants      int not null check (max_participants between 4 and 64),
  participant_count     int not null default 0 check (participant_count >= 0),
  bracket_size          int check (bracket_size in (4, 8, 16, 32, 64)),
  rounds                int check (rounds between 2 and 6),
  rules_version         int not null default 1 check (rules_version >= 1),
  created_by            uuid,
  published_at          timestamptz,
  started_at            timestamptz,
  completed_at          timestamptz,
  cancelled_at          timestamptz,
  cancel_reason         text check (cancel_reason is null or char_length(cancel_reason) <= 300),
  champion_id           uuid,
  version               int not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint cups_dates check (registration_open_at < registration_close_at and registration_close_at <= starts_at),
  constraint cups_limits check (min_participants <= max_participants),
  -- La red de la carrera por la última plaza: aunque algo saltase el cerrojo, 65 de 64 choca aquí.
  constraint cups_capacity check (participant_count <= max_participants),
  constraint cups_lifecycle check (
       (status = 'DRAFT'       and published_at is null     and started_at is null     and completed_at is null     and cancelled_at is null)
    or (status = 'PUBLISHED'   and published_at is not null and started_at is null     and completed_at is null     and cancelled_at is null)
    or (status = 'IN_PROGRESS' and published_at is not null and started_at is not null and completed_at is null     and cancelled_at is null)
    or (status = 'COMPLETED'   and started_at is not null   and completed_at is not null and cancelled_at is null)
    or (status = 'CANCELLED'   and cancelled_at is not null and completed_at is null)),
  constraint cups_champion check (champion_id is null or status = 'COMPLETED'),
  constraint cups_bracket check ((started_at is null) = (bracket_size is null) and (bracket_size is null) = (rounds is null))
);
create index if not exists cups_status_idx on public.cups (status, registration_open_at);
create index if not exists cups_archive_idx on public.cups (completed_at desc) where status = 'COMPLETED';

create table if not exists public.cup_registrations (
  cup_id            uuid not null references public.cups(id) on delete restrict,
  -- Sin FK a auth.users a propósito: el cuadro y el historial no deben desaparecer en cascada (se guarda la foto pública).
  user_id           uuid not null,
  status            text not null default 'REGISTERED' check (status in ('REGISTERED', 'WITHDRAWN')),
  registered_at     timestamptz not null default now(),
  withdrawn_at      timestamptz,
  seed              int check (seed between 1 and 64),
  seed_rating       int,
  seed_rated        boolean,
  username_snapshot text,
  tag_snapshot      text,
  eliminated_round  int check (eliminated_round between 1 and 6),
  placement         text check (placement in ('CHAMPION', 'RUNNER_UP', 'SEMIFINAL', 'QUARTERFINAL', 'ROUND_OF_16', 'ROUND_OF_32', 'ROUND_OF_64')),
  updated_at        timestamptz not null default now(),
  primary key (cup_id, user_id),
  constraint cup_reg_withdrawn check ((status = 'WITHDRAWN') = (withdrawn_at is not null)),
  constraint cup_reg_seeded check (seed is null or status = 'REGISTERED')
);
create unique index if not exists cup_registrations_seed_key on public.cup_registrations (cup_id, seed) where seed is not null;
create index if not exists cup_registrations_user_idx on public.cup_registrations (user_id, cup_id);

create table if not exists public.cup_matches (
  id                uuid primary key default gen_random_uuid(),
  cup_id            uuid not null references public.cups(id) on delete restrict,
  round             int not null check (round between 1 and 6),
  slot              int not null check (slot between 0 and 31),
  player_a          uuid,
  player_b          uuid,
  seed_a            int,
  seed_b            int,
  -- «Vacío» = ese lado ya está resuelto y no vendrá nadie (BYE de ronda 1 o doble no presentado aguas arriba).
  a_empty           boolean not null default false,
  b_empty           boolean not null default false,
  next_match_id     uuid references public.cup_matches(id),
  next_side         text check (next_side in ('A', 'B')),
  status            text not null default 'PENDING'
                    check (status in ('PENDING', 'READY', 'ACTIVE', 'COMPLETED', 'BYE', 'VOID', 'ACTION_REQUIRED', 'CANCELLED')),
  winner_id         uuid,
  resolution        text check (resolution in ('PLAYED', 'ABANDON', 'BYE', 'ADMIN_NO_SHOW', 'ADMIN_DOUBLE_NO_SHOW', 'ADMIN_DECISION')),
  -- EXACTAMENTE una partida por cruce, y una partida no sirve a dos cruces. Sin FK a propósito: el id se RESERVA aquí
  -- (cup_ready) antes de que la partida exista y el servidor la crea después en otra transacción con ese mismo id
  -- (patrón de `duel_challenges.match_id`, 0048). La liquidación comprueba que la partida existe y es de esos dos.
  game_match_id     uuid unique,
  ready_a_until     timestamptz,
  ready_b_until     timestamptz,
  deck_a            uuid,
  deck_b            uuid,
  available_at      timestamptz not null,
  deadline_at       timestamptz not null,
  score_a           int,
  score_b           int,
  resolved_at       timestamptz,
  resolved_by       uuid,
  resolution_reason text check (resolution_reason is null or char_length(resolution_reason) <= 300),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (cup_id, round, slot),
  constraint cup_matches_distinct check (player_a is null or player_b is null or player_a <> player_b),
  constraint cup_matches_side_a check (not (a_empty and player_a is not null)),
  constraint cup_matches_side_b check (not (b_empty and player_b is not null)),
  constraint cup_matches_winner check (winner_id is null or winner_id = player_a or winner_id = player_b),
  constraint cup_matches_decided check ((status in ('COMPLETED', 'BYE')) = (winner_id is not null)),
  constraint cup_matches_two check (status not in ('READY', 'ACTIVE', 'COMPLETED', 'ACTION_REQUIRED') or (player_a is not null and player_b is not null)),
  constraint cup_matches_active check (status <> 'ACTIVE' or game_match_id is not null),
  constraint cup_matches_window check (available_at < deadline_at),
  constraint cup_matches_next check ((next_match_id is null) = (next_side is null))
);
create index if not exists cup_matches_a_live_idx on public.cup_matches (player_a) where status in ('READY', 'ACTIVE', 'ACTION_REQUIRED');
create index if not exists cup_matches_b_live_idx on public.cup_matches (player_b) where status in ('READY', 'ACTIVE', 'ACTION_REQUIRED');
create index if not exists cup_matches_active_idx on public.cup_matches (cup_id) where status = 'ACTIVE';

-- Un trofeo de torneo tiene UN dueño: aunque algo intentase concederlo dos veces, la segunda choca.
create unique index if not exists user_cosmetics_cup_trophy_once on public.user_cosmetics (cosmetic_id) where cosmetic_id like 'insignia:torneo:%';

alter table public.cups enable row level security;
alter table public.cup_registrations enable row level security;
alter table public.cup_matches enable row level security;
-- Sin políticas: el navegador no lee ni escribe estas tablas. Todo pasa por /api/game/cups y /api/admin/cups.
revoke all on public.cups, public.cup_registrations, public.cup_matches from anon, authenticated;

-- ── 2. guardias de escritura ────────────────────────────────────────────────────────────────────────────────
create or replace function public._cups_guard()
returns trigger language plpgsql set search_path = public as $$
declare w boolean := coalesce(current_setting('drl.cup_writer', true), '') = 'on';
begin
  if tg_op = 'DELETE' then
    -- Un torneo publicado (o terminado, o cancelado) es historia: no se borra nunca. Un borrador sí.
    if old.status <> 'DRAFT' then raise exception 'CUP_IMMUTABLE: solo se puede borrar un borrador' using errcode = '42501'; end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if not w and (new.status <> 'DRAFT' or new.published_at is not null or new.started_at is not null or new.completed_at is not null
                  or new.cancelled_at is not null or new.champion_id is not null or new.participant_count <> 0 or new.bracket_size is not null) then
      raise exception 'CUP_WRITE_FORBIDDEN: un torneo nace como borrador' using errcode = '42501';
    end if;
    return new;
  end if;
  if old.status in ('COMPLETED', 'CANCELLED') then
    raise exception 'CUP_FINAL: un torneo terminado o cancelado no cambia' using errcode = '42501';
  end if;
  if new.id is distinct from old.id or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception 'CUP_WRITE_FORBIDDEN: identidad del torneo' using errcode = '42501';
  end if;
  if not w then
    if new.status is distinct from old.status or new.published_at is distinct from old.published_at
       or new.started_at is distinct from old.started_at or new.completed_at is distinct from old.completed_at
       or new.cancelled_at is distinct from old.cancelled_at or new.cancel_reason is distinct from old.cancel_reason
       or new.champion_id is distinct from old.champion_id or new.participant_count is distinct from old.participant_count
       or new.bracket_size is distinct from old.bracket_size or new.rounds is distinct from old.rounds then
      raise exception 'CUP_WRITE_FORBIDDEN: el estado del torneo solo cambia por sus RPC' using errcode = '42501';
    end if;
    -- Publicado: lo que decide la competición queda congelado. Solo texto (nombre, descripción, reglas) se corrige.
    if old.status <> 'DRAFT' and (
         new.slug is distinct from old.slug or new.format is distinct from old.format or new.seeding_policy is distinct from old.seeding_policy
      or new.visibility is distinct from old.visibility or new.registration_open_at is distinct from old.registration_open_at
      or new.registration_close_at is distinct from old.registration_close_at or new.starts_at is distinct from old.starts_at
      or new.round_window_minutes is distinct from old.round_window_minutes or new.min_participants is distinct from old.min_participants
      or new.max_participants is distinct from old.max_participants or new.rules_version is distinct from old.rules_version) then
      raise exception 'CUP_LOCKED: un torneo publicado solo admite cambios de texto' using errcode = '42501';
    end if;
  end if;
  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists cups_guard on public.cups;
create trigger cups_guard before insert or update or delete on public.cups for each row execute function public._cups_guard();

create or replace function public._cup_rows_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if coalesce(current_setting('drl.cup_writer', true), '') <> 'on' then
    raise exception 'CUP_WRITE_FORBIDDEN: % solo cambia por las RPC de torneo', tg_table_name using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then new.updated_at := now(); end if;
  return coalesce(new, old);
end $$;
drop trigger if exists cup_registrations_guard on public.cup_registrations;
create trigger cup_registrations_guard before insert or update or delete on public.cup_registrations for each row execute function public._cup_rows_guard();
drop trigger if exists cup_matches_guard on public.cup_matches;
create trigger cup_matches_guard before insert or update or delete on public.cup_matches for each row execute function public._cup_rows_guard();

-- ── 3. piezas del cuadro (especificación: src/domain/cups/bracket.ts) ───────────────────────────────────────
-- Seed de cada posición de la ronda 1: [1,2] → [1,4,2,3] → [1,8,4,5,2,7,3,6] …
create or replace function public._cup_seed_positions(p_size int)
returns int[] language plpgsql immutable set search_path = public as $$
declare o int[] := array[1, 2]; n int[]; s int; len int;
begin
  while coalesce(array_length(o, 1), 0) < p_size loop
    len := array_length(o, 1) * 2;
    n := '{}';
    foreach s in array o loop n := n || s || (len + 1 - s); end loop;
    o := n;
  end loop;
  return o;
end $$;

create or replace function public._cup_placement(p_round int, p_rounds int)
returns text language sql immutable set search_path = public as $$
  select case (2 ^ (p_rounds - p_round + 1))::int
    when 2 then 'RUNNER_UP' when 4 then 'SEMIFINAL' when 8 then 'QUARTERFINAL'
    when 16 then 'ROUND_OF_16' when 32 then 'ROUND_OF_32' else 'ROUND_OF_64' end;
$$;

create or replace function public._cup_audit(p_actor uuid, p_action text, p_cup uuid, p_detail jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.content_audit_log (actor, action, entity_type, entity_id, detail)
  values (p_actor, p_action, 'cup', p_cup::text, coalesce(p_detail, '{}'::jsonb));
$$;

-- Tag público (sin «#») o null.
create or replace function public._cup_tag(p_user uuid)
returns text language sql stable security definer set search_path = public as $$
  select public_tag from public.profiles where id = p_user;
$$;

create or replace function public._cup_complete(p_cup uuid, p_champion uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_slug text;
begin
  update public.cups set status = 'COMPLETED', completed_at = now(), champion_id = p_champion
   where id = p_cup and status = 'IN_PROGRESS' returning slug into v_slug;
  if not found then raise exception 'CUP_INTEGRITY: completar un torneo que no está en curso' using errcode = 'P0001'; end if;
  if p_champion is not null then
    update public.cup_registrations set placement = 'CHAMPION', eliminated_round = null where cup_id = p_cup and user_id = p_champion;
    -- El trofeo: insignia canónica F82 con referencia real al torneo. Una vez (PK + índice parcial de dueño único).
    insert into public.user_cosmetics (user_id, cosmetic_id, source)
    values (p_champion, 'insignia:torneo:' || v_slug, 'cup:' || p_cup::text)
    on conflict (user_id, cosmetic_id) do nothing;
  end if;
  perform public._cup_audit(null, 'cup_completed', p_cup, jsonb_build_object(
    'slug', v_slug, 'champion_tag', public._cup_tag(p_champion),
    'champion_username', (select username from public.profiles where id = p_champion), 'no_champion', p_champion is null));
end $$;

-- Cierra un cruce con su resultado FINAL y lo propaga (el lado siguiente se escribe UNA vez; si ya estaba, se aborta).
create or replace function public._cup_finish(p_match uuid, p_winner uuid, p_status text, p_resolution text, p_actor uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare m public.cup_matches%rowtype; v_rounds int; v_loser uuid; v_seed int;
begin
  select * into m from public.cup_matches where id = p_match;
  select rounds into v_rounds from public.cups where id = m.cup_id;
  update public.cup_matches set status = p_status, winner_id = p_winner, resolution = p_resolution, resolved_at = now(),
         resolved_by = p_actor, resolution_reason = p_reason, ready_a_until = null, ready_b_until = null
   where id = p_match;
  foreach v_loser in array array[m.player_a, m.player_b] loop
    if v_loser is not null and v_loser is distinct from p_winner then
      update public.cup_registrations set eliminated_round = m.round, placement = public._cup_placement(m.round, v_rounds)
       where cup_id = m.cup_id and user_id = v_loser;
    end if;
  end loop;
  if m.next_match_id is null then
    perform public._cup_complete(m.cup_id, p_winner);
    return;
  end if;
  v_seed := case when p_winner = m.player_a then m.seed_a when p_winner = m.player_b then m.seed_b end;
  if m.next_side = 'A' then
    update public.cup_matches set player_a = p_winner, seed_a = v_seed, a_empty = (p_winner is null)
     where id = m.next_match_id and player_a is null and not a_empty;
  else
    update public.cup_matches set player_b = p_winner, seed_b = v_seed, b_empty = (p_winner is null)
     where id = m.next_match_id and player_b is null and not b_empty;
  end if;
  if not found then raise exception 'CUP_INTEGRITY: el lado % del cruce siguiente ya estaba resuelto', m.next_side using errcode = 'P0001'; end if;
  perform public._cup_auto(m.next_match_id);
end $$;

-- Con los dos lados definidos: dos jugadores → READY; uno → BYE (pasa sin partida); ninguno → VOID (sube el vacío).
create or replace function public._cup_auto(p_match uuid)
returns void language plpgsql security definer set search_path = public as $$
declare m public.cup_matches%rowtype;
begin
  select * into m from public.cup_matches where id = p_match;
  if (m.player_a is null and not m.a_empty) or (m.player_b is null and not m.b_empty) then return; end if;
  if m.player_a is not null and m.player_b is not null then
    update public.cup_matches set status = 'READY' where id = p_match;
  elsif m.player_a is not null or m.player_b is not null then
    perform public._cup_finish(p_match, coalesce(m.player_a, m.player_b), 'BYE', 'BYE', null, null);
  else
    perform public._cup_finish(p_match, null, 'VOID', null, null, null);
  end if;
end $$;

-- ── 4. inscripción ──────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.cup_register(p_user uuid, p_cup uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.cups%rowtype; v_status text;
begin
  select * into c from public.cups where id = p_cup for update;
  if not found or c.status = 'DRAFT' then return jsonb_build_object('code', 'NOT_FOUND'); end if;
  if c.status = 'CANCELLED' then return jsonb_build_object('code', 'CANCELLED'); end if;
  if c.status <> 'PUBLISHED' or c.started_at is not null then return jsonb_build_object('code', 'CLOSED'); end if;
  if now() < c.registration_open_at then return jsonb_build_object('code', 'NOT_OPEN'); end if;
  if now() >= c.registration_close_at then return jsonb_build_object('code', 'CLOSED'); end if;
  if not exists (select 1 from public.profiles where id = p_user) then return jsonb_build_object('code', 'NO_PROFILE'); end if;
  if exists (select 1 from public.user_sanctions s where s.user_id = p_user and s.revoked_at is null and (s.expires_at is null or s.expires_at > now())) then
    return jsonb_build_object('code', 'SANCTIONED');
  end if;
  select status into v_status from public.cup_registrations where cup_id = p_cup and user_id = p_user;
  if v_status = 'REGISTERED' then return jsonb_build_object('code', 'ALREADY_REGISTERED', 'count', c.participant_count); end if;
  if c.participant_count >= c.max_participants then return jsonb_build_object('code', 'FULL', 'count', c.participant_count); end if;
  perform set_config('drl.cup_writer', 'on', true);
  if v_status is null then
    insert into public.cup_registrations (cup_id, user_id) values (p_cup, p_user);
  else
    update public.cup_registrations set status = 'REGISTERED', withdrawn_at = null, registered_at = now() where cup_id = p_cup and user_id = p_user;
  end if;
  update public.cups set participant_count = participant_count + 1 where id = p_cup;
  perform set_config('drl.cup_writer', '', true);
  return jsonb_build_object('code', 'REGISTERED', 'count', c.participant_count + 1);
end $$;

create or replace function public.cup_withdraw(p_user uuid, p_cup uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.cups%rowtype; v_status text;
begin
  select * into c from public.cups where id = p_cup for update;
  if not found or c.status = 'DRAFT' then return jsonb_build_object('code', 'NOT_FOUND'); end if;
  select status into v_status from public.cup_registrations where cup_id = p_cup and user_id = p_user;
  if v_status is distinct from 'REGISTERED' then return jsonb_build_object('code', 'NOT_REGISTERED', 'count', c.participant_count); end if;
  -- Retirarse solo mientras la inscripción está abierta: después el cuadro cuenta contigo.
  if c.status <> 'PUBLISHED' or c.started_at is not null or now() >= c.registration_close_at then return jsonb_build_object('code', 'CLOSED'); end if;
  perform set_config('drl.cup_writer', 'on', true);
  update public.cup_registrations set status = 'WITHDRAWN', withdrawn_at = now() where cup_id = p_cup and user_id = p_user;
  update public.cups set participant_count = participant_count - 1 where id = p_cup;
  perform set_config('drl.cup_writer', '', true);
  return jsonb_build_object('code', 'WITHDRAWN', 'count', c.participant_count - 1);
end $$;

-- ── 5. generación del cuadro (UNA vez) ─────────────────────────────────────────────────────────────────────
-- p_actor = admin que la pide, o NULL = el sistema (perezosa, la primera lectura tras el cierre).
create or replace function public.cup_generate(p_cup uuid, p_actor uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.cups%rowtype; n int; v_size int := 4; v_rounds int := 2; pos int[]; r int; s int; v_next uuid;
        v_win interval; sa int; sb int; pa uuid; pb uuid; mid uuid; v_seeds jsonb;
begin
  if p_actor is not null and not exists (select 1 from public.profiles where id = p_actor and is_admin) then
    raise exception 'NOT_ADMIN' using errcode = '42501';
  end if;
  select * into c from public.cups where id = p_cup for update;
  if not found then return jsonb_build_object('code', 'NOT_FOUND'); end if;
  if c.started_at is not null then return jsonb_build_object('code', 'ALREADY', 'size', c.bracket_size, 'rounds', c.rounds); end if;
  if c.status = 'CANCELLED' then return jsonb_build_object('code', 'CANCELLED'); end if;
  if c.status <> 'PUBLISHED' then return jsonb_build_object('code', 'NOT_PUBLISHED'); end if;
  if now() < c.registration_close_at then return jsonb_build_object('code', 'REGISTRATION_OPEN'); end if;

  select count(*) into n from public.cup_registrations where cup_id = p_cup and status = 'REGISTERED';
  perform set_config('drl.cup_writer', 'on', true);
  if n < c.min_participants then
    update public.cups set status = 'CANCELLED', cancelled_at = now(), cancel_reason = 'NOT_ENOUGH_PARTICIPANTS' where id = p_cup;
    perform public._cup_audit(p_actor, 'cup_cancelled', p_cup, jsonb_build_object('slug', c.slug, 'reason', 'NOT_ENOUGH_PARTICIPANTS', 'registered', n, 'min', c.min_participants));
    perform set_config('drl.cup_writer', '', true);
    return jsonb_build_object('code', 'UNDERFILLED', 'registered', n, 'min', c.min_participants);
  end if;
  while v_size < n loop v_size := v_size * 2; v_rounds := v_rounds + 1; end loop;

  -- FOTO de rating (F84) + seeds: rating desc (sin ranked = 1000), desempate md5(copa:usuario), último el id.
  with ranked as (
    select g.user_id, coalesce(pr.rating, 1000) as rating, pr.rating is not null as rated,
           row_number() over (order by coalesce(pr.rating, 1000) desc,
                                       md5(p_cup::text || ':' || g.user_id::text) collate "C" asc,
                                       g.user_id::text collate "C" asc)::int as seed
      from public.cup_registrations g left join public.duel_pvp_ratings pr on pr.user_id = g.user_id
     where g.cup_id = p_cup and g.status = 'REGISTERED')
  update public.cup_registrations g
     set seed = k.seed, seed_rating = k.rating, seed_rated = k.rated, username_snapshot = p.username, tag_snapshot = p.public_tag
    from ranked k left join public.profiles p on p.id = k.user_id
   where g.cup_id = p_cup and g.user_id = k.user_id;

  -- Todos los cruces de todas las rondas, de la final hacia atrás (cada uno conoce a su siguiente).
  v_win := make_interval(mins => c.round_window_minutes);
  for r in reverse v_rounds .. 1 loop
    for s in 0 .. (v_size / (2 ^ r)::int) - 1 loop
      v_next := null;
      if r < v_rounds then
        select id into v_next from public.cup_matches where cup_id = p_cup and round = r + 1 and slot = s / 2;
      end if;
      insert into public.cup_matches (cup_id, round, slot, next_match_id, next_side, available_at, deadline_at)
      values (p_cup, r, s, v_next, case when v_next is null then null when s % 2 = 0 then 'A' else 'B' end,
              c.starts_at + (r - 1) * v_win, c.starts_at + r * v_win);
    end loop;
  end loop;

  -- Ronda 1 por la colocación estándar; los seeds > N son huecos (BYE), siempre frente a los mejores.
  pos := public._cup_seed_positions(v_size);
  for s in 0 .. (v_size / 2) - 1 loop
    sa := pos[2 * s + 1]; sb := pos[2 * s + 2];
    select user_id into pa from public.cup_registrations where cup_id = p_cup and seed = sa;
    select user_id into pb from public.cup_registrations where cup_id = p_cup and seed = sb;
    if sa > n then pa := null; end if;
    if sb > n then pb := null; end if;
    update public.cup_matches
       set player_a = pa, seed_a = case when pa is null then null else sa end, a_empty = pa is null,
           player_b = pb, seed_b = case when pb is null then null else sb end, b_empty = pb is null
     where cup_id = p_cup and round = 1 and slot = s
     returning id into mid;
    perform public._cup_auto(mid);
  end loop;

  update public.cups set status = 'IN_PROGRESS', started_at = now(), bracket_size = v_size, rounds = v_rounds where id = p_cup;
  select coalesce(jsonb_agg(jsonb_build_object('seed', seed, 'tag', tag_snapshot, 'rating', seed_rating, 'rated', seed_rated) order by seed), '[]'::jsonb)
    into v_seeds from public.cup_registrations where cup_id = p_cup and seed is not null;
  perform public._cup_audit(p_actor, 'cup_bracket_generated', p_cup, jsonb_build_object(
    'slug', c.slug, 'participants', n, 'size', v_size, 'rounds', v_rounds, 'byes', v_size - n, 'seeds', v_seeds, 'system', p_actor is null));
  perform set_config('drl.cup_writer', '', true);
  return jsonb_build_object('code', 'GENERATED', 'participants', n, 'size', v_size, 'rounds', v_rounds);
end $$;

-- ── 6. jugar un cruce: «estoy listo» de los dos → UNA partida PVP_PRIVATE ──────────────────────────────────
-- El primero que llega espera (su «listo» caduca en p_ttl segundos si no lo renueva). Cuando llega el segundo con el
-- primero aún listo, se RESERVA el id de la partida (una vez) y el servidor la crea con `createPvpMatch(…, matchId)`.
-- Así el reloj F72.8 nunca juega por alguien que no está: la partida solo nace con los dos presentes.
create or replace function public.cup_ready(p_user uuid, p_match uuid, p_deck uuid, p_ttl_seconds int default 30)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.cups%rowtype; m public.cup_matches%rowtype; v_cup uuid; v_side text; v_other uuid; v_other_until timestamptz; v_game uuid;
        v_ttl int := least(greatest(coalesce(p_ttl_seconds, 30), 10), 120);
begin
  select cup_id into v_cup from public.cup_matches where id = p_match;
  if not found then return jsonb_build_object('code', 'NOT_FOUND'); end if;
  select * into c from public.cups where id = v_cup for update;
  select * into m from public.cup_matches where id = p_match;
  if p_user is null or (p_user is distinct from m.player_a and p_user is distinct from m.player_b) then return jsonb_build_object('code', 'NOT_FOUND'); end if;
  if c.status = 'CANCELLED' then return jsonb_build_object('code', 'CANCELLED'); end if;
  if c.status <> 'IN_PROGRESS' then return jsonb_build_object('code', 'CLOSED'); end if;
  if m.game_match_id is not null and m.status in ('READY', 'ACTIVE') then
    return jsonb_build_object('code', 'ALREADY', 'gameMatchId', m.game_match_id, 'status', m.status,
      'playerA', m.player_a, 'deckA', m.deck_a, 'playerB', m.player_b, 'deckB', m.deck_b);
  end if;
  if m.status <> 'READY' then return jsonb_build_object('code', 'NOT_READY', 'status', m.status); end if;
  if now() < m.available_at then return jsonb_build_object('code', 'NOT_YET', 'availableAt', m.available_at); end if;
  if now() >= m.deadline_at then return jsonb_build_object('code', 'DEADLINE_PASSED'); end if;
  if p_deck is null then return jsonb_build_object('code', 'DECK_REQUIRED'); end if;
  if public._duel_pvp_has_active_match(p_user) or public._social_reserved(p_user) then return jsonb_build_object('code', 'BUSY'); end if;
  if public._social_in_queue(p_user) then return jsonb_build_object('code', 'IN_QUEUE'); end if;

  v_side := case when p_user = m.player_a then 'A' else 'B' end;
  v_other := case when v_side = 'A' then m.player_b else m.player_a end;
  v_other_until := case when v_side = 'A' then m.ready_b_until else m.ready_a_until end;
  perform set_config('drl.cup_writer', 'on', true);
  if v_side = 'A' then
    update public.cup_matches set ready_a_until = now() + make_interval(secs => v_ttl), deck_a = p_deck where id = p_match;
  else
    update public.cup_matches set ready_b_until = now() + make_interval(secs => v_ttl), deck_b = p_deck where id = p_match;
  end if;
  if v_other_until is not null and v_other_until > now() then
    if public._duel_pvp_has_active_match(v_other) or public._social_reserved(v_other) or public._social_in_queue(v_other) then
      -- El rival se fue a otra partida o a la cola: su «listo» deja de valer; esperamos a que vuelva.
      if v_side = 'A' then update public.cup_matches set ready_b_until = null where id = p_match;
      else update public.cup_matches set ready_a_until = null where id = p_match; end if;
    else
      v_game := gen_random_uuid();
      update public.cup_matches set game_match_id = v_game where id = p_match;
      select * into m from public.cup_matches where id = p_match;
      perform set_config('drl.cup_writer', '', true);
      return jsonb_build_object('code', 'START', 'gameMatchId', v_game,
        'playerA', m.player_a, 'deckA', m.deck_a, 'playerB', m.player_b, 'deckB', m.deck_b);
    end if;
  end if;
  perform set_config('drl.cup_writer', '', true);
  return jsonb_build_object('code', 'WAITING', 'readyUntil', now() + make_interval(secs => v_ttl));
end $$;

-- La partida reservada YA existe en duel_matches → el cruce pasa a ACTIVE. Idempotente.
create or replace function public.cup_mark_active(p_match uuid, p_game uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cup uuid; m public.cup_matches%rowtype;
begin
  select cup_id into v_cup from public.cup_matches where id = p_match;
  if not found then return jsonb_build_object('code', 'NOT_FOUND'); end if;
  perform 1 from public.cups where id = v_cup for update;
  select * into m from public.cup_matches where id = p_match;
  if m.game_match_id is distinct from p_game then return jsonb_build_object('code', 'MISMATCH'); end if;
  if m.status = 'ACTIVE' then return jsonb_build_object('code', 'ALREADY_ACTIVE'); end if;
  if m.status <> 'READY' then return jsonb_build_object('code', 'NOT_READY', 'status', m.status); end if;
  if not exists (select 1 from public.duel_matches where id = p_game and mode = 'PVP_PRIVATE') then return jsonb_build_object('code', 'NO_GAME'); end if;
  perform set_config('drl.cup_writer', 'on', true);
  update public.cup_matches set status = 'ACTIVE' where id = p_match;
  perform set_config('drl.cup_writer', '', true);
  return jsonb_build_object('code', 'ACTIVE');
end $$;

-- La partida reservada NO se pudo crear (mazo ya ilegal…): se libera la reserva y el «listo» de quien falló.
create or replace function public.cup_start_failed(p_match uuid, p_game uuid, p_offender uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cup uuid; m public.cup_matches%rowtype;
begin
  select cup_id into v_cup from public.cup_matches where id = p_match;
  if not found then return jsonb_build_object('code', 'NOT_FOUND'); end if;
  perform 1 from public.cups where id = v_cup for update;
  select * into m from public.cup_matches where id = p_match;
  if m.status <> 'READY' or m.game_match_id is distinct from p_game or exists (select 1 from public.duel_matches where id = p_game) then
    return jsonb_build_object('code', 'NOOP');
  end if;
  perform set_config('drl.cup_writer', 'on', true);
  update public.cup_matches set game_match_id = null,
         ready_a_until = case when p_offender is null or p_offender = m.player_a then null else ready_a_until end,
         deck_a        = case when p_offender is null or p_offender = m.player_a then null else deck_a end,
         ready_b_until = case when p_offender is null or p_offender = m.player_b then null else ready_b_until end,
         deck_b        = case when p_offender is null or p_offender = m.player_b then null else deck_b end
   where id = p_match;
  perform set_config('drl.cup_writer', '', true);
  return jsonb_build_object('code', 'RELEASED');
end $$;

-- ── 7. resultado: del motor al cuadro, UNA vez ─────────────────────────────────────────────────────────────
-- Lo llama el servicio PvP al cerrar una partida PVP_PRIVATE y, como red, cualquier lectura del torneo.
create or replace function public.cup_settle_game(p_game uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_cup uuid; c public.cups%rowtype; m public.cup_matches%rowtype; d record; v_winner uuid; v_res text; v_sa int; v_sb int;
begin
  select id, cup_id into v_id, v_cup from public.cup_matches where game_match_id = p_game;
  if not found then return jsonb_build_object('code', 'NOT_CUP'); end if;
  select * into c from public.cups where id = v_cup for update;
  select * into m from public.cup_matches where id = v_id;
  if m.status <> 'ACTIVE' then return jsonb_build_object('code', 'ALREADY', 'status', m.status); end if;
  select id, user_id, player_b_id, status, winner, closed_reason, closed_by,
         (state -> 'result' ->> 'scoreA')::int as score_a, (state -> 'result' ->> 'scoreB')::int as score_b
    into d from public.duel_matches where id = p_game;
  if not found then return jsonb_build_object('code', 'NO_GAME'); end if;
  -- La partida tiene que ser EXACTAMENTE la de este cruce (los mismos dos jugadores).
  if not ((d.user_id = m.player_a and d.player_b_id = m.player_b) or (d.user_id = m.player_b and d.player_b_id = m.player_a)) then
    raise exception 'CUP_INTEGRITY: la partida % no es la del cruce', p_game using errcode = 'P0001';
  end if;

  if d.closed_reason = 'ABANDONED' and d.closed_by is not null then
    v_winner := case when d.closed_by = d.user_id then d.player_b_id else d.user_id end; v_res := 'ABANDON';
  elsif d.closed_reason is not null then
    v_res := 'HOLD';
  elsif d.status = 'COMPLETED' and d.winner in ('A', 'B') then
    v_winner := case when d.winner = 'A' then d.user_id else d.player_b_id end; v_res := 'PLAYED';
  elsif d.status in ('COMPLETED', 'DRAW', 'UNRESOLVED') then
    v_res := 'HOLD';
  else
    return jsonb_build_object('code', 'NOT_FINISHED');
  end if;

  v_sa := case when d.user_id = m.player_a then d.score_a else d.score_b end;
  v_sb := case when d.user_id = m.player_a then d.score_b else d.score_a end;
  perform set_config('drl.cup_writer', 'on', true);
  update public.cup_matches set score_a = v_sa, score_b = v_sb where id = v_id;
  if c.status = 'CANCELLED' then
    -- Torneo cancelado mientras se jugaba: el resultado se GUARDA (no se borra historia) pero no avanza a nadie.
    if v_winner is not null then
      update public.cup_matches set status = 'COMPLETED', winner_id = v_winner, resolution = v_res, resolved_at = now() where id = v_id;
    else
      update public.cup_matches set status = 'CANCELLED', resolved_at = now() where id = v_id;
    end if;
    perform set_config('drl.cup_writer', '', true);
    return jsonb_build_object('code', 'RECORDED_CANCELLED');
  end if;
  if v_res = 'HOLD' then
    update public.cup_matches set status = 'ACTION_REQUIRED' where id = v_id;
    perform public._cup_audit(null, 'cup_match_held', v_cup, jsonb_build_object(
      'slug', c.slug, 'round', m.round, 'slot', m.slot, 'game', p_game, 'game_status', d.status, 'closed_reason', d.closed_reason));
    perform set_config('drl.cup_writer', '', true);
    return jsonb_build_object('code', 'HELD');
  end if;
  perform public._cup_finish(v_id, v_winner, 'COMPLETED', v_res, null, null);
  perform set_config('drl.cup_writer', '', true);
  return jsonb_build_object('code', 'SETTLED', 'resolution', v_res, 'champion', (select champion_id is not null from public.cups where id = v_cup));
end $$;

-- ── 8. administración (actor releído en la BD, motivo obligatorio, auditoría en la misma transacción) ─────────
create or replace function public._cup_assert_admin(p_actor uuid)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if p_actor is null or not exists (select 1 from public.profiles where id = p_actor and is_admin) then
    raise exception 'NOT_ADMIN' using errcode = '42501';
  end if;
end $$;

create or replace function public.cup_admin_publish(p_actor uuid, p_cup uuid, p_version int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.cups%rowtype;
begin
  perform public._cup_assert_admin(p_actor);
  select * into c from public.cups where id = p_cup for update;
  if not found then raise exception 'CUP_NOT_FOUND' using errcode = 'P0001'; end if;
  if c.status <> 'DRAFT' then raise exception 'NOT_A_DRAFT' using errcode = 'P0001'; end if;
  if p_version is distinct from c.version then raise exception 'STALE_CUP' using errcode = 'P0001'; end if;
  if c.registration_close_at <= now() then raise exception 'CUP_DATES_PAST' using errcode = 'P0001'; end if;
  if char_length(trim(c.rules)) < 10 then raise exception 'CUP_RULES_REQUIRED' using errcode = 'P0001'; end if;
  perform set_config('drl.cup_writer', 'on', true);
  update public.cups set status = 'PUBLISHED', published_at = now() where id = p_cup;
  perform public._cup_audit(p_actor, 'cup_published', p_cup, jsonb_build_object(
    'slug', c.slug, 'name', c.name, 'visibility', c.visibility, 'max', c.max_participants, 'min', c.min_participants,
    'registration_open_at', c.registration_open_at, 'registration_close_at', c.registration_close_at, 'starts_at', c.starts_at,
    'round_window_minutes', c.round_window_minutes));
  perform set_config('drl.cup_writer', '', true);
  return jsonb_build_object('code', 'PUBLISHED');
end $$;

create or replace function public.cup_admin_cancel(p_actor uuid, p_cup uuid, p_reason text, p_confirm text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.cups%rowtype; v_reason text := nullif(trim(coalesce(p_reason, '')), ''); v_pending int;
begin
  perform public._cup_assert_admin(p_actor);
  if v_reason is null or char_length(v_reason) < 8 then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;
  if char_length(v_reason) > 300 then raise exception 'BAD_REASON' using errcode = 'P0001'; end if;
  select * into c from public.cups where id = p_cup for update;
  if not found then raise exception 'CUP_NOT_FOUND' using errcode = 'P0001'; end if;
  if c.status in ('COMPLETED', 'CANCELLED') then raise exception 'CUP_FINAL' using errcode = 'P0001'; end if;
  -- En curso: confirmación fuerte = escribir el identificador exacto del torneo.
  if c.status = 'IN_PROGRESS' and lower(trim(coalesce(p_confirm, ''))) is distinct from c.slug then
    raise exception 'CONFIRM_MISMATCH' using errcode = 'P0001';
  end if;
  perform set_config('drl.cup_writer', 'on', true);
  update public.cups set status = 'CANCELLED', cancelled_at = now(), cancel_reason = v_reason where id = p_cup;
  -- Lo jugado se queda; lo pendiente se cancela; una partida EN JUEGO termina y se guarda (sin avanzar a nadie).
  update public.cup_matches set status = 'CANCELLED', ready_a_until = null, ready_b_until = null
   where cup_id = p_cup and status in ('PENDING', 'READY', 'ACTION_REQUIRED');
  get diagnostics v_pending = row_count;
  perform public._cup_audit(p_actor, 'cup_cancelled', p_cup, jsonb_build_object(
    'slug', c.slug, 'reason', v_reason, 'status_before', c.status, 'participants', c.participant_count, 'matches_cancelled', v_pending));
  perform set_config('drl.cup_writer', '', true);
  return jsonb_build_object('code', 'CANCELLED', 'matchesCancelled', v_pending);
end $$;

-- Resolver un cruce retenido (ACTION_REQUIRED) o con el plazo vencido sin partida: 'A' / 'B' avanza, 'NONE' = los dos
-- fuera. Confirmar = escribir el #TAG EXACTO de quien avanza (o «ELIMINAR A LOS DOS»). Nunca un sorteo.
create or replace function public.cup_admin_resolve(p_actor uuid, p_match uuid, p_decision text, p_reason text, p_confirm text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cup uuid; c public.cups%rowtype; m public.cup_matches%rowtype; v_reason text := nullif(trim(coalesce(p_reason, '')), '');
        v_winner uuid; v_tag text; v_res text; v_confirm text := upper(trim(coalesce(p_confirm, '')));
begin
  perform public._cup_assert_admin(p_actor);
  if v_reason is null or char_length(v_reason) < 8 then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;
  if char_length(v_reason) > 300 then raise exception 'BAD_REASON' using errcode = 'P0001'; end if;
  if p_decision is null or p_decision not in ('A', 'B', 'NONE') then raise exception 'BAD_DECISION' using errcode = 'P0001'; end if;
  select cup_id into v_cup from public.cup_matches where id = p_match;
  if not found then raise exception 'CUP_MATCH_NOT_FOUND' using errcode = 'P0001'; end if;
  select * into c from public.cups where id = v_cup for update;
  select * into m from public.cup_matches where id = p_match;
  if c.status <> 'IN_PROGRESS' then raise exception 'CUP_NOT_IN_PROGRESS' using errcode = 'P0001'; end if;
  if not (m.status = 'ACTION_REQUIRED' or (m.status = 'READY' and m.game_match_id is null and now() >= m.deadline_at)) then
    raise exception 'CUP_NOT_RESOLVABLE' using errcode = 'P0001';
  end if;
  if p_decision = 'NONE' then
    if v_confirm <> 'ELIMINAR A LOS DOS' then raise exception 'CONFIRM_MISMATCH' using errcode = 'P0001'; end if;
  else
    v_winner := case when p_decision = 'A' then m.player_a else m.player_b end;
    v_tag := public._cup_tag(v_winner);
    if v_tag is null or ltrim(v_confirm, '#') <> v_tag then raise exception 'CONFIRM_MISMATCH' using errcode = 'P0001'; end if;
  end if;
  v_res := case when p_decision = 'NONE' then 'ADMIN_DOUBLE_NO_SHOW' when m.status = 'ACTION_REQUIRED' then 'ADMIN_DECISION' else 'ADMIN_NO_SHOW' end;
  perform set_config('drl.cup_writer', 'on', true);
  perform public._cup_audit(p_actor, 'cup_match_resolved', v_cup, jsonb_build_object(
    'slug', c.slug, 'match', p_match, 'round', m.round, 'slot', m.slot, 'decision', p_decision, 'resolution', v_res,
    'status_before', m.status, 'reason', v_reason, 'game', m.game_match_id,
    'winner_tag', v_tag, 'winner_username', (select username from public.profiles where id = v_winner),
    'a_tag', public._cup_tag(m.player_a), 'b_tag', public._cup_tag(m.player_b)));
  if p_decision = 'NONE' then
    perform public._cup_finish(p_match, null, 'VOID', v_res, p_actor, v_reason);
  else
    perform public._cup_finish(p_match, v_winner, 'COMPLETED', v_res, p_actor, v_reason);
  end if;
  perform set_config('drl.cup_writer', '', true);
  return jsonb_build_object('code', 'RESOLVED', 'resolution', v_res, 'completed', (select status = 'COMPLETED' from public.cups where id = v_cup));
end $$;

-- ── 9. permisos ────────────────────────────────────────────────────────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'public._cups_guard()', 'public._cup_rows_guard()', 'public._cup_seed_positions(int)', 'public._cup_placement(int,int)',
    'public._cup_audit(uuid,text,uuid,jsonb)', 'public._cup_tag(uuid)', 'public._cup_complete(uuid,uuid)',
    'public._cup_finish(uuid,uuid,text,text,uuid,text)', 'public._cup_auto(uuid)', 'public._cup_assert_admin(uuid)',
    'public.cup_register(uuid,uuid)', 'public.cup_withdraw(uuid,uuid)', 'public.cup_generate(uuid,uuid)',
    'public.cup_ready(uuid,uuid,uuid,int)', 'public.cup_mark_active(uuid,uuid)', 'public.cup_start_failed(uuid,uuid,uuid)',
    'public.cup_settle_game(uuid)', 'public.cup_admin_publish(uuid,uuid,int)', 'public.cup_admin_cancel(uuid,uuid,text,text)',
    'public.cup_admin_resolve(uuid,uuid,text,text,text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'public.cup_register(uuid,uuid)', 'public.cup_withdraw(uuid,uuid)', 'public.cup_generate(uuid,uuid)',
    'public.cup_ready(uuid,uuid,uuid,int)', 'public.cup_mark_active(uuid,uuid)', 'public.cup_start_failed(uuid,uuid,uuid)',
    'public.cup_settle_game(uuid)', 'public.cup_admin_publish(uuid,uuid,int)', 'public.cup_admin_cancel(uuid,uuid,text,text)',
    'public.cup_admin_resolve(uuid,uuid,text,text,text)'] loop
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
grant select, insert, update, delete on public.cups to service_role;
grant select on public.cup_registrations, public.cup_matches to service_role;

-- ── 10. guardia final ─────────────────────────────────────────────────────────────────────────────────────
do $$
begin
  if has_table_privilege('authenticated', 'public.cups', 'SELECT') or has_table_privilege('anon', 'public.cup_matches', 'SELECT')
     or has_table_privilege('authenticated', 'public.cup_registrations', 'INSERT') then
    raise exception '0069: los clientes no pueden tocar las tablas de torneo';
  end if;
  if has_function_privilege('authenticated', 'public.cup_settle_game(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.cup_register(uuid,uuid)', 'EXECUTE') then
    raise exception '0069: los clientes no pueden ejecutar las RPC de torneo';
  end if;
  if public._cup_seed_positions(8) <> array[1, 8, 4, 5, 2, 7, 3, 6] then raise exception '0069: colocación estándar incorrecta'; end if;
end $$;
