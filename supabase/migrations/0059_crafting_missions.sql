-- =============================================================================
-- 0059_crafting_missions — F73 · CRAFTING & MISSIONS 1.0  ·  NO APLICADA (requiere autorización explícita)
-- =============================================================================
-- Aplicar DENTRO de una transacción (BEGIN … COMMIT), como 0045–0058: este fichero no abre ni cierra ninguna, para que
-- el dry-run pueda terminar en ROLLBACK. Aditiva e idempotente (`if not exists`, `create or replace`, `on conflict`).
--
-- Qué añade (y nada más):
--   1. `craft_recipes`          recetas de crafteo (sobres y cartas), estado ACTIVE/DISABLED/RETIRED, con semillas
--                               derivadas de `docs/product/qa/fase73/economy-analysis.json` (suelos seguros).
--   2. `content_card_projects`  proyectos de carta (carta objetivo REAL del catálogo).
--   3. `content_missions`       misiones configurables (condición jsonb, objetivo, dependencias, recompensa).
--   4. `user_mission_progress`  progreso por usuario y misión.
--   5. `mission_events`         eventos ya procesados (clave única por usuario): idempotencia del progreso.
--   6. `user_project_claims`    proyectos reclamados (una vez por usuario).
--   7. RPC `app_craft_pack`, `app_craft_card`, `app_mission_apply` (service_role; nada invocable desde el navegador).
--
-- El LEDGER del crafteo es `economy_ops` (0019), sin cambios: kind `craft_pack` / `craft_card`, ref = clave de
-- idempotencia, `result` = entradas, salidas y receta. Las recompensas usan `app_grant_reward` (0026), sin cambios.
-- NO cambia precios, probabilidades, desguace, valores, cartas, sobres existentes, ni ninguna tabla anterior.
--
-- ROLLBACK (si hiciera falta deshacerla después de aplicada, en una transacción):
--   drop function if exists public.app_mission_apply(uuid, text, text, jsonb, jsonb);
--   drop function if exists public.app_craft_card(uuid, text, uuid[], jsonb, text, text);
--   drop function if exists public.app_craft_pack(uuid, text, text);
--   drop table if exists public.user_project_claims, public.mission_events, public.user_mission_progress,
--                        public.content_missions, public.content_card_projects, public.craft_recipes;
--   (Las filas de `economy_ops` kind craft_* y las cartas/sobres ya entregados se conservan: son historia del jugador.)
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. RECETAS
-- ----------------------------------------------------------------------------
create table if not exists public.craft_recipes (
  id              text primary key check (id ~ '^[a-z0-9][a-z0-9-]{1,63}$'),
  kind            text not null check (kind in ('PACK', 'CARD')),
  name            text not null check (length(name) between 3 and 60),
  input_pack_id   text,
  output_pack_id  text,
  input_class     text check (input_class  in ('base','plata','oro','masters','champions','prime','icon')),
  output_class    text check (output_class in ('base','plata','oro','masters','champions','prime','icon')),
  input_qty       int  not null check (input_qty between 2 and 100),
  status          text not null default 'DISABLED' check (status in ('ACTIVE', 'DISABLED', 'RETIRED')),
  sort_order      int  not null default 0,
  available_from  timestamptz,
  available_to    timestamptz,
  version         int  not null default 1,
  created_by      uuid,
  updated_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- Cada tipo lleva SOLO sus campos, y nunca se convierte algo en sí mismo.
  constraint craft_recipes_shape check (
    (kind = 'PACK' and input_pack_id is not null and output_pack_id is not null and input_pack_id <> output_pack_id
                   and input_class is null and output_class is null)
    or
    (kind = 'CARD' and input_class is not null and output_class is not null and input_class <> output_class
                   and input_pack_id is null and output_pack_id is null)
  ),
  constraint craft_recipes_window check (available_to is null or available_from is null or available_to > available_from)
);

-- Semillas: los suelos seguros medidos (X = max(2, ⌈1,25·salida/entrada⌉) en precio, valor y desguace).
-- Prime → Icon se siembra DESACTIVADA: solo hay 3 cartas Icon (el intercambio sería una garantía).
insert into public.craft_recipes (id, kind, name, input_pack_id, output_pack_id, input_class, output_class, input_qty, status, sort_order) values
  ('pack-estandar-premium',  'PACK', 'Bronce → Plata',       'estandar',  'premium',   null, null, 4, 'ACTIVE', 10),
  ('pack-premium-oro',       'PACK', 'Plata → Oro',          'premium',   'oro',       null, null, 2, 'ACTIVE', 20),
  ('pack-oro-masters',       'PACK', 'Oro → Masters',        'oro',       'masters',   null, null, 2, 'ACTIVE', 30),
  ('pack-masters-champions', 'PACK', 'Masters → Champions',  'masters',   'champions', null, null, 3, 'ACTIVE', 40),
  ('pack-champions-icon',    'PACK', 'Champions → Icon',     'champions', 'icon',      null, null, 2, 'ACTIVE', 50),
  ('card-base-plata',        'CARD', 'Base → Plata',         null, null, 'base',      'plata',     7,  'ACTIVE',   110),
  ('card-plata-oro',         'CARD', 'Plata → Oro',          null, null, 'plata',     'oro',       3,  'ACTIVE',   120),
  ('card-oro-masters',       'CARD', 'Oro → Masters',        null, null, 'oro',       'masters',   8,  'ACTIVE',   130),
  ('card-masters-champions', 'CARD', 'Masters → Champions',  null, null, 'masters',   'champions', 14, 'ACTIVE',   140),
  ('card-champions-prime',   'CARD', 'Champions → Prime',    null, null, 'champions', 'prime',     10, 'ACTIVE',   150),
  ('card-prime-icon',        'CARD', 'Prime → Icon',         null, null, 'prime',     'icon',      5,  'DISABLED', 160)
on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- 2 y 3. PROYECTOS Y MISIONES (configuración del admin)
-- ----------------------------------------------------------------------------
create table if not exists public.content_card_projects (
  id              text primary key check (id ~ '^[a-z0-9][a-z0-9-]{1,63}$'),
  name            text not null check (length(name) between 3 and 80),
  description     text not null default '' check (length(description) <= 240),
  target_card_id  text not null,
  status          text not null default 'DRAFT' check (status in ('DRAFT', 'ACTIVE', 'RETIRED')),
  sort_order      int  not null default 0,
  available_from  timestamptz,
  available_to    timestamptz,
  version         int  not null default 1,
  created_by      uuid, updated_by uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint content_card_projects_window check (available_to is null or available_from is null or available_to > available_from)
);

create table if not exists public.content_missions (
  id              text primary key check (id ~ '^[a-z0-9][a-z0-9-]{1,63}$'),
  project_id      text references public.content_card_projects(id) on delete restrict,
  name            text not null check (length(name) between 3 and 80),
  description     text not null default '' check (length(description) <= 240),
  condition       jsonb not null check (jsonb_typeof(condition) = 'object' and condition ? 'type'),
  target          int  not null check (target between 1 and 500),
  depends_on      text[] not null default '{}',
  reward          jsonb not null default '{}'::jsonb check (jsonb_typeof(reward) = 'object'),
  status          text not null default 'DRAFT' check (status in ('DRAFT', 'ACTIVE', 'RETIRED')),
  sort_order      int  not null default 0,
  available_from  timestamptz,
  available_to    timestamptz,
  version         int  not null default 1,
  created_by      uuid, updated_by uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint content_missions_self_dep check (not (id = any(depends_on))),
  constraint content_missions_window check (available_to is null or available_from is null or available_to > available_from)
);
create index if not exists content_missions_project_idx on public.content_missions(project_id);
create index if not exists content_missions_status_idx on public.content_missions(status);

-- ----------------------------------------------------------------------------
-- 4, 5 y 6. ESTADO DE CADA JUGADOR
-- ----------------------------------------------------------------------------
create table if not exists public.user_mission_progress (
  user_id       uuid not null references auth.users(id) on delete cascade,
  mission_id    text not null references public.content_missions(id) on delete cascade,
  progress      int  not null default 0 check (progress >= 0),
  completed_at  timestamptz,
  claimed_at    timestamptz,
  updated_at    timestamptz not null default now(),
  primary key (user_id, mission_id),
  constraint user_mission_progress_claim check (claimed_at is null or completed_at is not null)
);

-- Un evento (fin de partida, apertura, crafteo) se procesa UNA vez por usuario: la clave primaria lo impone.
create table if not exists public.mission_events (
  user_id     uuid not null references auth.users(id) on delete cascade,
  event_key   text not null check (length(event_key) between 3 and 200),
  kind        text not null check (kind in ('MATCH', 'OPEN_PACK', 'CRAFT_PACK', 'CRAFT_CARD')),
  -- Evidencia mínima para auditar (modo, resultado, decisiones humanas, misiones afectadas). Sin datos privados.
  evidence    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  primary key (user_id, event_key)
);
create index if not exists mission_events_user_idx on public.mission_events(user_id, created_at desc);

create table if not exists public.user_project_claims (
  user_id     uuid not null references auth.users(id) on delete cascade,
  project_id  text not null references public.content_card_projects(id) on delete restrict,
  card_uid    uuid,
  claimed_at  timestamptz not null default now(),
  primary key (user_id, project_id)
);

-- ----------------------------------------------------------------------------
-- RLS y privilegios: la configuración solo la toca service_role (admin por API); cada jugador LEE solo lo suyo.
-- ----------------------------------------------------------------------------
alter table public.craft_recipes         enable row level security;
alter table public.content_card_projects enable row level security;
alter table public.content_missions      enable row level security;
alter table public.user_mission_progress enable row level security;
alter table public.mission_events        enable row level security;
alter table public.user_project_claims   enable row level security;

-- Supabase concede por defecto TODO a anon/authenticated en tablas nuevas: se revoca todo y se devuelve solo lo justo.
revoke all on public.craft_recipes, public.content_card_projects, public.content_missions from anon, authenticated;
revoke all on public.user_mission_progress, public.mission_events, public.user_project_claims from anon, authenticated;
grant select on public.user_mission_progress, public.user_project_claims to authenticated;

drop policy if exists "tu progreso de misiones" on public.user_mission_progress;
create policy "tu progreso de misiones" on public.user_mission_progress for select using (auth.uid() = user_id);
drop policy if exists "tus proyectos reclamados" on public.user_project_claims;
create policy "tus proyectos reclamados" on public.user_project_claims for select using (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- 7a. CRAFTEO DE SOBRES — atómico e idempotente.
-- ----------------------------------------------------------------------------
drop function if exists public.app_craft_pack(uuid, text, text);
create or replace function public.app_craft_pack(p_user uuid, p_recipe text, p_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.craft_recipes%rowtype; v_prev jsonb; v_have int; v_in int; v_out int;
begin
  if p_ref is null or length(p_ref) = 0 then raise exception 'Un crafteo necesita clave de idempotencia'; end if;
  -- Misma clave → misma respuesta (doble clic, F5, reintento, dos pestañas): no se vuelve a ejecutar.
  select result into v_prev from public.economy_ops where ref = p_ref;
  if v_prev is not null then return v_prev || jsonb_build_object('repeated', true); end if;

  select * into r from public.craft_recipes where id = p_recipe;
  if not found then raise exception 'RECIPE_NOT_FOUND' using errcode = 'P0001'; end if;
  if r.kind <> 'PACK' then raise exception 'RECIPE_KIND' using errcode = 'P0001'; end if;
  if r.status <> 'ACTIVE' or (r.available_from is not null and now() < r.available_from)
     or (r.available_to is not null and now() >= r.available_to) then
    raise exception 'RECIPE_DISABLED' using errcode = 'P0001';
  end if;

  -- La fila del sobre de entrada se BLOQUEA antes de contar: dos crafteos (o un crafteo y una apertura, que bloquea la
  -- misma fila en `app_apply_pack_open`) no pueden gastar los mismos sobres. Nunca queda negativo (check qty ≥ 0).
  select qty into v_have from public.user_packs where user_id = p_user and pack_id = r.input_pack_id for update;
  if coalesce(v_have, 0) < r.input_qty then raise exception 'INSUFFICIENT_PACKS' using errcode = 'P0001'; end if;

  update public.user_packs set qty = qty - r.input_qty where user_id = p_user and pack_id = r.input_pack_id returning qty into v_in;
  insert into public.user_packs (user_id, pack_id, qty) values (p_user, r.output_pack_id, 1)
    on conflict (user_id, pack_id) do update set qty = public.user_packs.qty + 1
    returning qty into v_out;

  v_prev := jsonb_build_object(
    'recipeId', r.id, 'kind', 'PACK',
    'inputs',  jsonb_build_array(jsonb_build_object('packId', r.input_pack_id, 'qty', r.input_qty)),
    'outputs', jsonb_build_array(jsonb_build_object('packId', r.output_pack_id, 'qty', 1)),
    'inventory', jsonb_build_object(r.input_pack_id, v_in, r.output_pack_id, v_out));
  insert into public.economy_ops (ref, user_id, kind, result) values (p_ref, p_user, 'craft_pack', v_prev);
  return v_prev;
end; $$;

-- ----------------------------------------------------------------------------
-- 7b. INTERCAMBIO DE CARTAS — atómico e idempotente. La carta de salida la sorteó Node (servidor) del pool de la clase.
-- ----------------------------------------------------------------------------
-- Node valida clase, pool y elegibilidad con el catálogo; aquí se garantiza lo que solo la base de datos puede: que las
-- copias sean tuyas, no bloqueadas, no estén en ningún equipo, sean EXACTAMENTE las que Node vio (card_id por uid), que
-- te quede al menos una copia de cada carta, que desaparezcan y que la nueva aparezca, todo en una transacción.
drop function if exists public.app_craft_card(uuid, text, uuid[], jsonb, text, text);
create or replace function public.app_craft_card(
  p_user uuid, p_recipe text, p_uids uuid[], p_expected jsonb, p_output_card_id text, p_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.craft_recipes%rowtype; v_prev jsonb; v_n int; v_bad int; v_uid uuid; v_cards text[];
begin
  if p_ref is null or length(p_ref) = 0 then raise exception 'Un crafteo necesita clave de idempotencia'; end if;
  select result into v_prev from public.economy_ops where ref = p_ref;
  if v_prev is not null then return v_prev || jsonb_build_object('repeated', true); end if;

  select * into r from public.craft_recipes where id = p_recipe;
  if not found then raise exception 'RECIPE_NOT_FOUND' using errcode = 'P0001'; end if;
  if r.kind <> 'CARD' then raise exception 'RECIPE_KIND' using errcode = 'P0001'; end if;
  if r.status <> 'ACTIVE' or (r.available_from is not null and now() < r.available_from)
     or (r.available_to is not null and now() >= r.available_to) then
    raise exception 'RECIPE_DISABLED' using errcode = 'P0001';
  end if;
  if p_uids is null or array_length(p_uids, 1) is distinct from r.input_qty then raise exception 'WRONG_COUNT' using errcode = 'P0001'; end if;
  if (select count(distinct u) from unnest(p_uids) u) <> r.input_qty then raise exception 'DUPLICATE_INPUT' using errcode = 'P0001'; end if;
  if p_output_card_id is null or length(p_output_card_id) = 0 then raise exception 'NO_OUTPUT' using errcode = 'P0001'; end if;

  -- Cartas implicadas según Node; se bloquean TODAS las copias del usuario de esas cartas (no solo las entregadas):
  -- así otro crafteo o un desguace simultáneo de otra copia de la misma carta espera, y el recuento de «te queda al
  -- menos una» se hace sobre el estado ya confirmado.
  select array_agg(distinct value) into v_cards from jsonb_each_text(p_expected);
  perform 1 from public.user_cards where user_id = p_user and card_id = any(v_cards) for update;

  select count(*) into v_n from public.user_cards
   where uid = any(p_uids) and user_id = p_user and locked = false
     and card_id = (p_expected ->> uid::text);
  if v_n <> r.input_qty then raise exception 'NOT_ELIGIBLE' using errcode = 'P0001'; end if;

  if exists (select 1 from public.duel_decks d where d.user_id = p_user and d.card_uids && p_uids) then
    raise exception 'IN_DECK' using errcode = 'P0001';
  end if;

  select count(*) into v_bad from (
    select c.card_id,
           count(*) filter (where not (c.uid = any(p_uids))) as kept
      from public.user_cards c where c.user_id = p_user and c.card_id = any(v_cards)
     group by c.card_id) t where t.kept < 1;
  if v_bad > 0 then raise exception 'LAST_COPY' using errcode = 'P0001'; end if;

  delete from public.user_cards where uid = any(p_uids) and user_id = p_user;
  insert into public.user_cards (user_id, card_id, serial, origin) values (p_user, p_output_card_id, null, 'craft')
    returning uid into v_uid;

  v_prev := jsonb_build_object(
    'recipeId', r.id, 'kind', 'CARD',
    'inputs', (select jsonb_agg(jsonb_build_object('uid', u, 'cardId', p_expected ->> u::text)) from unnest(p_uids) u),
    'outputs', jsonb_build_array(jsonb_build_object('uid', v_uid, 'cardId', p_output_card_id)));
  insert into public.economy_ops (ref, user_id, kind, result) values (p_ref, p_user, 'craft_card', v_prev);
  return v_prev;
end; $$;

-- ----------------------------------------------------------------------------
-- 7c. PROGRESO DE MISIONES — un evento, una vez, atómico.
-- ----------------------------------------------------------------------------
-- `p_ops` = [{mission, op: INC|STREAK_WIN|STREAK_RESET, value, target}] calculadas por Node con el motor puro.
-- Si el evento ya estaba registrado para el usuario, no se aplica nada (repetido). Una misión completada no cambia.
drop function if exists public.app_mission_apply(uuid, text, text, jsonb, jsonb);
create or replace function public.app_mission_apply(
  p_user uuid, p_event_key text, p_kind text, p_ops jsonb, p_evidence jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o jsonb; v_rows int; v_done text[] := '{}'; v_m text; v_target int; v_op text; v_val int; v_new int;
begin
  insert into public.mission_events (user_id, event_key, kind, evidence)
  values (p_user, p_event_key, p_kind, coalesce(p_evidence, '{}'::jsonb))
  on conflict (user_id, event_key) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return jsonb_build_object('repeated', true, 'completed', '[]'::jsonb); end if;

  for o in select * from jsonb_array_elements(coalesce(p_ops, '[]'::jsonb)) loop
    v_m := o ->> 'mission'; v_op := o ->> 'op'; v_target := (o ->> 'target')::int; v_val := coalesce((o ->> 'value')::int, 0);
    if v_target is null or v_target < 1 then continue; end if;
    insert into public.user_mission_progress (user_id, mission_id, progress) values (p_user, v_m, 0)
      on conflict (user_id, mission_id) do nothing;
    update public.user_mission_progress set
        progress = case v_op
          when 'INC'          then least(progress + greatest(v_val, 0), v_target)
          when 'STREAK_WIN'   then least(progress + 1, v_target)
          when 'STREAK_RESET' then 0
          else progress end,
        updated_at = now()
      where user_id = p_user and mission_id = v_m and completed_at is null
      returning progress into v_new;
    if v_new is not null and v_new >= v_target then
      update public.user_mission_progress set completed_at = now()
       where user_id = p_user and mission_id = v_m and completed_at is null;
      v_done := v_done || v_m;
    end if;
    v_new := null;
  end loop;
  return jsonb_build_object('repeated', false, 'completed', to_jsonb(v_done));
end; $$;

revoke all on function public.app_craft_pack(uuid, text, text) from public, anon, authenticated;
revoke all on function public.app_craft_card(uuid, text, uuid[], jsonb, text, text) from public, anon, authenticated;
revoke all on function public.app_mission_apply(uuid, text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.app_craft_pack(uuid, text, text) to service_role;
grant execute on function public.app_craft_card(uuid, text, uuid[], jsonb, text, text) to service_role;
grant execute on function public.app_mission_apply(uuid, text, text, jsonb, jsonb) to service_role;

-- ----------------------------------------------------------------------------
-- GUARDIA FINAL: si algo no quedó como debe, la transacción que envuelve este fichero se aborta.
-- ----------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.craft_recipes') is null or to_regclass('public.content_missions') is null
     or to_regclass('public.user_mission_progress') is null or to_regclass('public.mission_events') is null
     or to_regclass('public.user_project_claims') is null or to_regclass('public.content_card_projects') is null then
    raise exception '0059: faltan tablas';
  end if;
  if has_function_privilege('anon', 'public.app_craft_pack(uuid, text, text)', 'execute')
     or has_function_privilege('authenticated', 'public.app_craft_card(uuid, text, uuid[], jsonb, text, text)', 'execute')
     or has_function_privilege('authenticated', 'public.app_mission_apply(uuid, text, text, jsonb, jsonb)', 'execute') then
    raise exception '0059: una RPC de crafteo/misiones es invocable desde el navegador';
  end if;
  if has_table_privilege('authenticated', 'public.craft_recipes', 'select')
     or has_table_privilege('anon', 'public.user_mission_progress', 'select')
     or has_table_privilege('authenticated', 'public.user_mission_progress', 'insert') then
    raise exception '0059: privilegios de tabla demasiado amplios';
  end if;
  if (select count(*) from public.craft_recipes where status = 'ACTIVE') < 1 then raise exception '0059: sin recetas sembradas'; end if;
end $$;
