-- ============================================================================
-- FASE B · PICK'EMS, PUNTOS, RANGO Y RANKING  (bloques F, G, H, I, J)
--
-- SE CUELGA DEL ESQUEMA COMPETITIVO EXISTENTE (0002/0003): `events`, `stages`,
-- `matches`, `teams`. No se crea otro sistema de torneos.
--
-- LA TABLA `public.pickems` DE 0002 QUEDA OBSOLETA
--   Era `(user_id, match_id, pick, ...)`: plana, sin torneo, sin tipos de
--   pregunta, sin ventana de apertura/cierre y sin puntuación. Nunca tuvo una
--   sola referencia en el código. Se marca como deprecada (no se borra, para no
--   destruir datos si alguien la hubiera usado) y se sustituye por este modelo.
--
-- INVARIANTE CENTRAL — EL CIERRE ES DEL SERVIDOR
--   `locks_at` se comprueba dentro de la RPC, con el reloj de la base de datos.
--   Ni el botón deshabilitado, ni el reloj del navegador, ni el frontend
--   participan en la decisión.
-- ============================================================================

comment on table public.pickems is
  'DEPRECADA (0012): sustituida por pickem_events/questions/submissions/answers/scores. No usar.';

-- ----------------------------------------------------------------------------
-- 1. PUNTOS COMPETITIVOS Y TEMPORADA
-- ----------------------------------------------------------------------------
alter table public.profiles add column if not exists points int not null default 0;

create table if not exists public.seasons (
  id        text primary key,
  name      text not null,
  starts_at timestamptz not null,
  ends_at   timestamptz not null,
  active    boolean not null default false
);

-- `points` es una columna protegida más: el blindaje de 0009 revocó el UPDATE de
-- tabla completa y solo concedió (username, avatar), así que `points` ya nace
-- cerrado al cliente. Se añade al trigger guardián para que quede explícito.
create or replace function public.profiles_guard_protected_columns()
returns trigger language plpgsql as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if new.id               is distinct from old.id               then raise exception 'SEC-02: id no es editable'; end if;
  if new.credits          is distinct from old.credits          then raise exception 'SEC-02: credits solo lo modifica el servidor'; end if;
  if new.tokens           is distinct from old.tokens           then raise exception 'SEC-02: tokens solo lo modifica el servidor'; end if;
  if new.xp               is distinct from old.xp               then raise exception 'SEC-02: xp solo lo modifica el servidor'; end if;
  if new.level            is distinct from old.level            then raise exception 'SEC-02: level solo lo modifica el servidor'; end if;
  if new.points           is distinct from old.points           then raise exception 'SEC-02: points solo lo modifica el servidor'; end if;
  if new.collection_value is distinct from old.collection_value then raise exception 'SEC-02: collection_value solo lo modifica el servidor'; end if;
  if new.distinct_cards   is distinct from old.distinct_cards   then raise exception 'SEC-02: distinct_cards solo lo modifica el servidor'; end if;
  if new.rarest_rank      is distinct from old.rarest_rank      then raise exception 'SEC-02: rarest_rank solo lo modifica el servidor'; end if;
  if new.market_volume    is distinct from old.market_volume    then raise exception 'SEC-02: market_volume solo lo modifica el servidor'; end if;
  if new.packs_opened     is distinct from old.packs_opened     then raise exception 'SEC-02: packs_opened solo lo modifica el servidor'; end if;
  if new.taxes_paid       is distinct from old.taxes_paid       then raise exception 'SEC-02: taxes_paid solo lo modifica el servidor'; end if;
  if new.is_admin         is distinct from old.is_admin         then raise exception 'SEC-02: is_admin solo lo modifica el servidor'; end if;
  if new.created_at       is distinct from old.created_at       then raise exception 'SEC-02: created_at no es editable'; end if;

  return new;
end; $$;

-- ----------------------------------------------------------------------------
-- 2. PICK'EMS
-- ----------------------------------------------------------------------------
create table if not exists public.pickem_events (
  id          uuid primary key default gen_random_uuid(),
  event_id    text not null references public.events(id) on delete cascade,
  season_id   text references public.seasons(id),
  title       text not null,
  description text,
  opens_at    timestamptz not null default now(),
  locks_at    timestamptz not null,
  status      text not null default 'open' check (status in ('draft','open','locked','scored')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists pickem_events_event_idx on public.pickem_events(event_id);

create table if not exists public.pickem_questions (
  id               uuid primary key default gen_random_uuid(),
  pickem_event_id  uuid not null references public.pickem_events(id) on delete cascade,
  kind             text not null check (kind in ('match_winner','champion','advance')),
  match_id         text references public.matches(id) on delete set null,
  prompt           text not null,
  -- [{"key":"th","label":"Team Heretics"}, ...]
  options          jsonb not null default '[]'::jsonb,
  points           int  not null default 10 check (points >= 0),
  -- Cierre POR PREGUNTA: una pregunta de partido cierra cuando empieza ese
  -- partido, no cuando cierra el torneo entero.
  locks_at         timestamptz not null,
  correct_option   text,
  order_idx        int not null default 0,
  created_at       timestamptz not null default now()
);
create index if not exists pickem_questions_ev_idx    on public.pickem_questions(pickem_event_id, order_idx);
create index if not exists pickem_questions_match_idx on public.pickem_questions(match_id);

create table if not exists public.pickem_submissions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  pickem_event_id uuid not null references public.pickem_events(id) on delete cascade,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (user_id, pickem_event_id)
);

create table if not exists public.pickem_answers (
  id            uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.pickem_submissions(id) on delete cascade,
  question_id   uuid not null references public.pickem_questions(id) on delete cascade,
  option_key    text not null,
  is_correct    boolean,
  points_award  int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (submission_id, question_id)
);
create index if not exists pickem_answers_q_idx on public.pickem_answers(question_id);

create table if not exists public.pickem_scores (
  user_id         uuid not null references auth.users(id) on delete cascade,
  pickem_event_id uuid not null references public.pickem_events(id) on delete cascade,
  points          int not null default 0,
  correct         int not null default 0,
  total           int not null default 0,
  scored_at       timestamptz not null default now(),
  primary key (user_id, pickem_event_id)
);
create index if not exists pickem_scores_points_idx on public.pickem_scores(points desc);

-- ----------------------------------------------------------------------------
-- 3. RLS — el catálogo de Pick'ems es público; las respuestas son privadas
-- ----------------------------------------------------------------------------
alter table public.seasons            enable row level security;
alter table public.pickem_events      enable row level security;
alter table public.pickem_questions   enable row level security;
alter table public.pickem_submissions enable row level security;
alter table public.pickem_answers     enable row level security;
alter table public.pickem_scores      enable row level security;

drop policy if exists "lectura publica seasons"  on public.seasons;
create policy "lectura publica seasons"  on public.seasons for select using (true);
drop policy if exists "lectura publica pickems"  on public.pickem_events;
create policy "lectura publica pickems"  on public.pickem_events for select using (true);

-- Las preguntas son públicas, PERO `correct_option` no debe verse antes de tiempo.
-- Se resuelve con la vista de abajo; la tabla base no se expone al cliente.
revoke select on public.pickem_questions from anon, authenticated;

drop policy if exists "tus envios" on public.pickem_submissions;
create policy "tus envios" on public.pickem_submissions for select using (auth.uid() = user_id);

drop policy if exists "tus respuestas" on public.pickem_answers;
create policy "tus respuestas" on public.pickem_answers for select using (
  exists (select 1 from public.pickem_submissions s
           where s.id = pickem_answers.submission_id and s.user_id = auth.uid())
);

-- Las puntuaciones son públicas: son el ranking.
drop policy if exists "lectura publica scores" on public.pickem_scores;
create policy "lectura publica scores" on public.pickem_scores for select using (true);

revoke insert, update, delete on public.pickem_events      from anon, authenticated;
revoke insert, update, delete on public.pickem_questions    from anon, authenticated;
revoke insert, update, delete on public.pickem_submissions  from anon, authenticated;
revoke insert, update, delete on public.pickem_answers      from anon, authenticated;
revoke insert, update, delete on public.pickem_scores       from anon, authenticated;
revoke insert, update, delete on public.seasons             from anon, authenticated;

-- Vista pública de preguntas: oculta `correct_option` mientras la pregunta no
-- esté cerrada. Evita que el cliente lea la respuesta antes del lock.
create or replace view public.pickem_questions_public as
  select q.id, q.pickem_event_id, q.kind, q.match_id, q.prompt, q.options,
         q.points, q.locks_at, q.order_idx,
         (now() >= q.locks_at) as locked,
         case when now() >= q.locks_at then q.correct_option else null end as correct_option
    from public.pickem_questions q;
grant select on public.pickem_questions_public to anon, authenticated;

-- ============================================================================
-- 4. OPERACIONES (service_role)
-- ============================================================================

-- ── Guardar/actualizar una predicción ───────────────────────────────────────
-- ESTE ES EL INVARIANTE DEL BLOQUE: si `now() >= locks_at`, se rechaza. El reloj
-- es el de la base de datos, no el del navegador ni el del proceso de Node.
create or replace function public.app_submit_pick(
  p_user uuid, p_question_id uuid, p_option text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_q public.pickem_questions;
  v_sub uuid;
  v_valid boolean;
begin
  select * into v_q from public.pickem_questions where id = p_question_id;
  if v_q.id is null then raise exception 'Pregunta inexistente' using errcode = 'P0002'; end if;

  -- CIERRE SERVER-SIDE.
  if now() >= v_q.locks_at then
    raise exception 'Predicción cerrada' using errcode = 'P0001';
  end if;

  -- La opción debe ser una de las declaradas: nada de texto libre del cliente.
  select exists (
    select 1 from jsonb_array_elements(v_q.options) o where o->>'key' = p_option
  ) into v_valid;
  if not v_valid then raise exception 'Opción inválida' using errcode = 'P0001'; end if;

  insert into public.pickem_submissions (user_id, pickem_event_id)
  values (p_user, v_q.pickem_event_id)
  on conflict (user_id, pickem_event_id) do update set updated_at = now()
  returning id into v_sub;

  insert into public.pickem_answers (submission_id, question_id, option_key)
  values (v_sub, p_question_id, p_option)
  on conflict (submission_id, question_id)
    do update set option_key = excluded.option_key, updated_at = now();

  return jsonb_build_object('questionId', p_question_id, 'option', p_option, 'submissionId', v_sub);
end; $$;

-- ── Fijar el resultado correcto de una pregunta ─────────────────────────────
create or replace function public.app_set_correct_option(
  p_question_id uuid, p_correct text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.pickem_questions set correct_option = p_correct where id = p_question_id;
end; $$;

-- ── Corregir un Pick'em y repartir puntos ───────────────────────────────────
-- Idempotente: recalcula desde cero y ajusta `profiles.points` por DIFERENCIA,
-- así que ejecutarlo dos veces no duplica puntos.
create or replace function public.app_score_pickem_event(p_pickem_event_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_row record; v_prev int; v_users int := 0; v_total_points int := 0;
begin
  -- Marca cada respuesta como correcta/incorrecta según el resultado ya fijado.
  update public.pickem_answers a
     set is_correct = (q.correct_option is not null and a.option_key = q.correct_option),
         points_award = case when q.correct_option is not null and a.option_key = q.correct_option
                             then q.points else 0 end,
         updated_at = now()
    from public.pickem_questions q, public.pickem_submissions s
   where a.question_id = q.id
     and a.submission_id = s.id
     and s.pickem_event_id = p_pickem_event_id
     and q.pickem_event_id = p_pickem_event_id;

  -- Agrega por usuario y ajusta los puntos globales por diferencia.
  for v_row in
    select s.user_id,
           coalesce(sum(a.points_award), 0)::int as points,
           coalesce(sum(case when a.is_correct then 1 else 0 end), 0)::int as correct,
           count(a.id)::int as total
      from public.pickem_submissions s
      left join public.pickem_answers a on a.submission_id = s.id
     where s.pickem_event_id = p_pickem_event_id
     group by s.user_id
  loop
    select points into v_prev from public.pickem_scores
     where user_id = v_row.user_id and pickem_event_id = p_pickem_event_id;
    v_prev := coalesce(v_prev, 0);

    insert into public.pickem_scores (user_id, pickem_event_id, points, correct, total, scored_at)
    values (v_row.user_id, p_pickem_event_id, v_row.points, v_row.correct, v_row.total, now())
    on conflict (user_id, pickem_event_id) do update
      set points = excluded.points, correct = excluded.correct,
          total = excluded.total, scored_at = now();

    update public.profiles set points = greatest(0, points + (v_row.points - v_prev))
     where id = v_row.user_id;

    v_users := v_users + 1;
    v_total_points := v_total_points + v_row.points;
  end loop;

  update public.pickem_events set status = 'scored', updated_at = now() where id = p_pickem_event_id;
  return jsonb_build_object('users', v_users, 'pointsAwarded', v_total_points);
end; $$;

-- ----------------------------------------------------------------------------
-- 5. RANKING derivado de datos server-authoritative
-- ----------------------------------------------------------------------------
-- Ordena por `points`, que SOLO escribe `app_score_pickem_event`. Ya no hay
-- columnas autodeclaradas por el cliente (SEC-05).
create or replace view public.ranking_points as
  select p.id, p.username, p.avatar, p.points, p.xp, p.level
    from public.profiles p
   where p.points > 0
   order by p.points desc, p.xp desc
   limit 100;

-- Ranking POR TORNEO.
create or replace view public.ranking_pickem_event as
  select sc.pickem_event_id, sc.user_id, pr.username, pr.avatar,
         sc.points, sc.correct, sc.total
    from public.pickem_scores sc
    join public.profiles pr on pr.id = sc.user_id
   order by sc.points desc;

grant select on public.ranking_points       to anon, authenticated;
grant select on public.ranking_pickem_event to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 6. Nada de esto es invocable por el cliente
-- ----------------------------------------------------------------------------
revoke all on function public.app_submit_pick(uuid, uuid, text)        from public, anon, authenticated;
revoke all on function public.app_set_correct_option(uuid, text)       from public, anon, authenticated;
revoke all on function public.app_score_pickem_event(uuid)             from public, anon, authenticated;

grant execute on function public.app_submit_pick(uuid, uuid, text)     to service_role;
grant execute on function public.app_set_correct_option(uuid, text)    to service_role;
grant execute on function public.app_score_pickem_event(uuid)          to service_role;
