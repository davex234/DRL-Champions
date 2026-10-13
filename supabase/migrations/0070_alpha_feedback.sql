-- ============================================================================================================
-- 0070 · CLOSED ALPHA — feedback humano privado y embudo DERIVADO (F86.2).
--
-- Por qué hace falta: no existía ninguna tabla, API ni página de feedback (comprobado en la auditoría de F86.2). El
-- embudo, en cambio, NO necesita eventos nuevos: se deriva de datos que ya existen (alta, libro de créditos,
-- operaciones de sobres, equipos, partidas, cola ranked, amistades, retos, torneos).
--
--   1. alpha_feedback — una fila por envío. id = la CLAVE de envío que genera el cliente (doble clic, dos pestañas o
--      un reintento tras perder la respuesta → la MISMA fila, nunca dos). user_id lo pone el servidor desde la sesión
--      (nunca el cliente). Sin correo, sin IP, sin agente de usuario, sin adjuntos: solo texto acotado.
--      · RLS sin políticas y sin privilegios para anon/authenticated: ni un jugador ni otro leen nada por REST.
--      · INSERT solo service_role (la API), UPDATE prohibido para cualquier rol (append-only), DELETE solo por el
--        borrado de la cuenta (cascada) o un operador.
--      · Tope por cuenta (30 envíos) en la BD: un bucle no llena la tabla.
--   2. app_alpha_funnel(p_since, p_include_test) — SECURITY DEFINER, EXECUTE solo service_role. LECTURA PURA de la
--      cohorte de cuentas creadas desde p_since: por cuenta, qué pasos del recorrido de la alpha hay en los DATOS. Por
--      defecto excluye administradores y cuentas de prueba (correo @example.invalid o nombre «qa…»). Nunca devuelve
--      el correo: solo nombre, #TAG, alta y pasos.
--
-- Nada toca economía, ranked, temporadas, misiones, torneos ni perfiles. No cambia ninguna tabla existente.
-- Rollback: docs/operations/rollback/0070_alpha_feedback.ROLLBACK.sql (quita la tabla —y con ella el feedback— y la RPC).
-- ============================================================================================================

-- ── 1. feedback ────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.alpha_feedback (
  id                uuid primary key,
  user_id           uuid not null references auth.users(id) on delete cascade,
  created_at        timestamptz not null default now(),
  source            text not null default 'menu' check (source in ('menu', 'cup', 'home', 'profile', 'result')),
  hard_to_understand text check (hard_to_understand is null or char_length(hard_to_understand) <= 2000),
  lost_moment       text check (lost_moment is null or char_length(lost_moment) <= 2000),
  liked_most        text check (liked_most is null or char_length(liked_most) <= 2000),
  liked_least       text check (liked_least is null or char_length(liked_least) <= 2000),
  had_error         boolean,
  error_detail      text check (error_detail is null or char_length(error_detail) <= 2000),
  would_return      smallint check (would_return is null or would_return between 1 and 10),
  comment           text check (comment is null or char_length(comment) <= 2000),
  app_version       text check (app_version is null or char_length(app_version) <= 64),
  constraint alpha_feedback_not_empty check (
    coalesce(hard_to_understand, lost_moment, liked_most, liked_least, error_detail, comment) is not null
    or had_error is not null or would_return is not null)
);
create index if not exists alpha_feedback_created_idx on public.alpha_feedback (created_at desc);
create index if not exists alpha_feedback_user_idx on public.alpha_feedback (user_id);

alter table public.alpha_feedback enable row level security;
revoke all on table public.alpha_feedback from public, anon, authenticated;
grant select, insert on table public.alpha_feedback to service_role;

-- Append-only + tope por cuenta.
create or replace function public._alpha_feedback_guard()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'FEEDBACK_IMMUTABLE: el feedback no se edita' using errcode = '42501';
  end if;
  if (select count(*) from public.alpha_feedback where user_id = new.user_id) >= 30 then
    raise exception 'FEEDBACK_LIMIT' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function public._alpha_feedback_guard() from public, anon, authenticated;
drop trigger if exists alpha_feedback_guard on public.alpha_feedback;
create trigger alpha_feedback_guard before insert or update on public.alpha_feedback
  for each row execute function public._alpha_feedback_guard();

-- ── 2. embudo derivado (solo lectura) ──────────────────────────────────────────────────────────────────────
create or replace function public.app_alpha_funnel(p_since timestamptz, p_include_test boolean default false)
returns jsonb language sql stable security definer set search_path = public, auth as $$
  with cohort as (
    select u.id, u.created_at, u.last_sign_in_at, p.username, p.public_tag
    from auth.users u join public.profiles p on p.id = u.id
    where u.created_at >= p_since
      and not coalesce(p.is_admin, false)
      and (p_include_test or not (u.email ilike '%@example.invalid' or p.username ilike 'qa%'))
  ),
  quick as (
    select m.user_id, bool_or(m.status in ('COMPLETED', 'DRAW')) as done
    from public.duel_matches m
    where m.user_id in (select id from cohort) and m.mode = 'PVE'
      and not exists (select 1 from public.campaign_attempts a where a.match_id = m.id)
    group by m.user_id
  ),
  cupm as (
    select x.uid, bool_or(x.played) as played, bool_or(x.final) as final
    from (
      select unnest(array[cm.player_a, cm.player_b]) as uid, cm.game_match_id is not null as played,
             cm.round = (select max(r.round) from public.cup_matches r where r.cup_id = cm.cup_id) as final
      from public.cup_matches cm
    ) x
    where x.uid in (select id from cohort)
    group by x.uid
  ),
  per as (
    select c.id, c.created_at, c.last_sign_in_at, c.username, c.public_tag,
      exists (select 1 from public.credit_transactions t where t.user_id = c.id and t.reason = 'starter_grant') as starter_granted,
      exists (select 1 from public.credit_transactions t where t.user_id = c.id and t.reason = 'buy_pack:inicial') as starter_claimed,
      exists (select 1 from public.economy_ops o where o.user_id = c.id and o.kind = 'open_pack') as pack_opened,
      exists (select 1 from public.duel_decks d where d.user_id = c.id) as deck_saved,
      coalesce(q.done is not null, false) as quick_started,
      coalesce(q.done, false) as quick_completed,
      (exists (select 1 from public.duel_pvp_queue pq where pq.user_id = c.id)
        or exists (select 1 from public.duel_matches pm where pm.mode = 'PVP' and (pm.user_id = c.id or pm.player_b_id = c.id))) as ranked_touched,
      (exists (select 1 from public.duel_friendships f where f.user_lo = c.id or f.user_hi = c.id)
        or exists (select 1 from public.duel_challenges ch where ch.challenger_id = c.id or ch.challenged_id = c.id)) as social_used,
      exists (select 1 from public.duel_friendships f where (f.user_lo = c.id or f.user_hi = c.id) and f.status = 'ACCEPTED') as friend_added,
      exists (select 1 from public.cup_registrations r where r.user_id = c.id) as cup_registered,
      coalesce(cm.played, false) as cup_played,
      coalesce(cm.final, false) as cup_final,
      exists (select 1 from public.alpha_feedback fb where fb.user_id = c.id) as feedback_sent
    from cohort c
    left join quick q on q.user_id = c.id
    left join cupm cm on cm.uid = c.id
  )
  select jsonb_build_object(
    'since', p_since,
    'includeTest', p_include_test,
    'accounts', (select count(*) from per),
    'steps', jsonb_build_object(
      'starter_granted', (select count(*) from per where starter_granted),
      'pack_opened', (select count(*) from per where pack_opened),
      'starter_claimed', (select count(*) from per where starter_claimed),
      'deck_saved', (select count(*) from per where deck_saved),
      'quick_started', (select count(*) from per where quick_started),
      'quick_completed', (select count(*) from per where quick_completed),
      'ranked_touched', (select count(*) from per where ranked_touched),
      'social_used', (select count(*) from per where social_used),
      'friend_added', (select count(*) from per where friend_added),
      'cup_registered', (select count(*) from per where cup_registered),
      'cup_played', (select count(*) from per where cup_played),
      'cup_final', (select count(*) from per where cup_final),
      'feedback_sent', (select count(*) from per where feedback_sent)),
    'players', coalesce((select jsonb_agg(jsonb_build_object(
        'username', username, 'tag', public_tag, 'createdAt', created_at, 'lastSignInAt', last_sign_in_at,
        'starterGranted', starter_granted, 'packOpened', pack_opened, 'starterClaimed', starter_claimed,
        'deckSaved', deck_saved, 'quickStarted', quick_started, 'quickCompleted', quick_completed,
        'rankedTouched', ranked_touched, 'socialUsed', social_used, 'friendAdded', friend_added,
        'cupRegistered', cup_registered, 'cupPlayed', cup_played, 'cupFinal', cup_final, 'feedbackSent', feedback_sent)
        order by created_at) from per), '[]'::jsonb)
  );
$$;
revoke all on function public.app_alpha_funnel(timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.app_alpha_funnel(timestamptz, boolean) to service_role;

-- ── 3. guardia final ───────────────────────────────────────────────────────────────────────────────────────
do $$
begin
  if has_table_privilege('authenticated', 'public.alpha_feedback', 'SELECT') or has_table_privilege('anon', 'public.alpha_feedback', 'SELECT')
     or has_table_privilege('authenticated', 'public.alpha_feedback', 'INSERT') then
    raise exception '0070: un rol de cliente puede leer o escribir alpha_feedback';
  end if;
  if has_function_privilege('authenticated', 'public.app_alpha_funnel(timestamptz, boolean)', 'EXECUTE')
     or has_function_privilege('anon', 'public.app_alpha_funnel(timestamptz, boolean)', 'EXECUTE') then
    raise exception '0070: un rol de cliente puede ejecutar app_alpha_funnel';
  end if;
end $$;
