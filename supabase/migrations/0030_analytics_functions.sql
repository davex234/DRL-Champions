-- ============================================================================
-- 0030 — FUNCIONES ANALÍTICAS (NEXUS Fase 14, bloque 5)
--
-- ─────────────────────────── POR QUÉ EN SQL Y NO EN TYPESCRIPT ───────────────────────────
--
-- Un embudo es una intersección entre tablas: «de los usuarios creados en esta
-- ventana, cuántos tienen además una fila en `duel_matches` con estado
-- COMPLETED». PostgREST —el query builder de Supabase, que es como el proyecto
-- hace TODAS sus lecturas— no puede expresar eso: sabe incrustar recursos
-- relacionados, no cruzar seis tablas y agregar.
--
-- La alternativa habría sido traerse las filas a Node y cruzarlas allí. Para
-- calcular usuarios activos diarios eso significa descargar todos los eventos
-- del día. No escala y no hace falta: PostgreSQL está para esto.
--
-- Y no es una arquitectura nueva. El proyecto ya usa vistas para leer agregados
-- (`ranking_level`, `ranking_collection`, `v_upcoming_matches`, 0001 y 0003) y
-- funciones para recomponer estadísticas (`recompute_standings`,
-- `recompute_team_stats`, 0003). Esto es lo mismo, para otra pregunta.
--
-- ─────────────────────────── LO QUE ESTAS FUNCIONES NO SON ───────────────────────────
--
-- No son una fuente de verdad. **Solo LEEN.** Ninguna escribe una fila, ninguna
-- crea una tabla de agregados y ninguna es una vista materializada: cada llamada
-- recalcula desde las tablas autoritativas, así que no pueden quedarse desfasadas
-- ni discrepar del dato real. Si todas desaparecieran, no se perdería ni un dato.
--
-- ─────────────────────────── RETROACTIVIDAD ───────────────────────────
--
-- Casi todo se deriva de tablas que existen desde mucho antes de la telemetría:
-- `profiles.created_at`, `user_cards.obtained_at`, `duel_decks.created_at`,
-- `duel_matches`, `pickem_answers`, `market_audit`, `economy_ops`. Por eso los
-- embudos funcionan **para los jugadores que ya existían**, algo que una solución
-- de solo-eventos no podría hacer nunca.
--
-- Los pasos que SÍ dependen de `telemetry_events` (ver una pantalla, abrir un
-- flujo, empezar sesión) solo existen desde la Fase 14. Está documentado en
-- `docs/telemetry/FUNNELS.md` y cada función lo deja ver devolviendo cero, no
-- inventando.
--
-- ─────────────────────────── ACCESO ───────────────────────────
--
-- Se revoca la ejecución a PUBLIC (§12). Solo `service_role` —es
-- decir, código de servidor— puede llamarlas. Un jugador no puede pedir el
-- recorrido de otro.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. EMBUDO DE PRIMERA EXPERIENCIA (FTUE)
-- ----------------------------------------------------------------------------
--
-- LA COHORTE SE DEFINE POR IDENTIDAD, NO POR TELEMETRÍA.
--
-- `profiles.created_at` es el momento del alta: lo escribe el disparador
-- `handle_new_user` en el mismo instante que `auth.users`, y se ha comprobado
-- contra los datos reales que las dos fechas coinciden en las 58 cuentas
-- existentes. Se usa `profiles` y no `auth.users` porque vive en el esquema
-- `public` y se puede cruzar; es un espejo fiel, no una segunda verdad.
--
-- LOS SIETE PASOS Y DE DÓNDE SALE CADA UNO:
--
--   user_created         profiles.created_at            ← identidad
--   ftue_started         telemetry_events               ← SOLO desde la Fase 14
--   welcome_pack_opened  economy_ops.kind='open_pack'   ← ver nota abajo
--   first_card           user_cards, origin='pack'
--   deck_created         duel_decks
--   duel_started         duel_matches
--   duel_completed       duel_matches.status='COMPLETED'
--
-- NOTA SOBRE «SOBRE ABIERTO». La taxonomía del bloque 2 decía que se derivaba de
-- `credit_transactions.ref like 'pack:open:%'`. **Es incorrecto y se corrige
-- aquí:** abrir un sobre no cuesta créditos, así que `app_apply_pack_open` NO
-- escribe en el libro mayor —escribe `user_cards`, `card_mints` y
-- `user_game.packs_opened`—. La operación sí queda en `economy_ops` con
-- `kind='open_pack'`, que es la fuente correcta. Comprobado contra los datos: 11
-- filas de `open_pack` en `economy_ops`, ninguna `pack:open:` en el libro mayor.
--
-- `first_card` filtra por `origin='pack'` a propósito: una carta concedida por un
-- administrador (`origin='admin'`) o comprada en el mercado no es el momento de
-- «mi primera carta» de la primera experiencia.
--
-- CÓMO SE CUENTA. Cada paso cuenta usuarios que **alguna vez** hicieron eso, no
-- que lo hicieran en orden. Es la interpretación estándar de un embudo y la
-- única honesta aquí: nadie garantiza que un jugador construya el mazo antes de
-- abrir el segundo sobre. Por eso una etapa puede, en teoría, superar a la
-- anterior; si eso pasa, es información, no un error.
create or replace function public.analytics_ftue_funnel(
  p_from timestamptz default now() - interval '30 days',
  p_to   timestamptz default now()
)
returns table (
  step_order   int,
  step         text,
  users        bigint,
  conv_prev    numeric,
  conv_start   numeric,
  source       text
)
language sql stable as $$
  with cohorte as (
    select id as user_id from public.profiles
     where created_at >= p_from and created_at < p_to
  ),
  base as (select count(*)::bigint as n from cohorte),
  pasos as (
    select 1 as step_order, 'user_created' as step, (select n from base) as users,
           'profiles.created_at' as source
    union all
    select 2, 'ftue_started', count(distinct c.user_id)::bigint, 'telemetry_events'
      from cohorte c
     where exists (select 1 from public.telemetry_events t where t.user_id = c.user_id)
    union all
    select 3, 'welcome_pack_opened', count(distinct c.user_id)::bigint, 'economy_ops.kind=open_pack'
      from cohorte c
     where exists (select 1 from public.economy_ops o
                    where o.user_id = c.user_id and o.kind = 'open_pack')
    union all
    select 4, 'first_card', count(distinct c.user_id)::bigint, 'user_cards.origin=pack'
      from cohorte c
     where exists (select 1 from public.user_cards u
                    where u.user_id = c.user_id and u.origin = 'pack')
    union all
    select 5, 'deck_created', count(distinct c.user_id)::bigint, 'duel_decks'
      from cohorte c
     where exists (select 1 from public.duel_decks d where d.user_id = c.user_id)
    union all
    select 6, 'duel_started', count(distinct c.user_id)::bigint, 'duel_matches'
      from cohorte c
     where exists (select 1 from public.duel_matches m where m.user_id = c.user_id)
    union all
    select 7, 'duel_completed', count(distinct c.user_id)::bigint, 'duel_matches.status=COMPLETED'
      from cohorte c
     where exists (select 1 from public.duel_matches m
                    where m.user_id = c.user_id and m.status = 'COMPLETED')
  )
  select p.step_order, p.step, p.users,
         -- Conversión respecto al paso anterior. `null` en el primero: no hay anterior.
         round(100.0 * p.users / nullif(lag(p.users) over (order by p.step_order), 0), 1),
         -- Conversión respecto al inicio de la cohorte.
         round(100.0 * p.users / nullif((select n from base), 0), 1),
         p.source
    from pasos p
   order by p.step_order;
$$;

-- ----------------------------------------------------------------------------
-- 2. EMBUDO DE DUELO
-- ----------------------------------------------------------------------------
--
-- Todo sale de `duel_matches`, que ya tiene los índices `(user_id, status)`,
-- `(user_id, status, winner)` y `(user_id, updated_at desc)`.
--
-- EL ABANDONO ES UNA INFERENCIA, NO UN HECHO. No existe —ni existirá— un evento
-- `duel_abandoned`. Se infiere: una partida `IN_PROGRESS` cuya `updated_at` lleva
-- más de `p_stale_hours` sin moverse. Funciona porque el disparador
-- `touch_updated_at` sella la fila **en cada turno**, así que la fecha es la del
-- último turno jugado y no la del comienzo.
--
-- La ventana es un PARÁMETRO, no una regla del producto: cambiar cuánto tiempo
-- hace falta para llamarlo abandono no requiere tocar nada.
--
-- DURACIÓN: `updated_at - created_at` de las partidas terminadas. Es exacta para
-- el duelo —empieza y acaba con escrituras— a diferencia de la duración de
-- sesión, que sí es una cota inferior.
create or replace function public.analytics_duel_funnel(
  p_from        timestamptz default now() - interval '30 days',
  p_to          timestamptz default now(),
  p_stale_hours int         default 24
)
returns table (
  started              bigint,
  completed            bigint,
  drawn                bigint,
  unresolved           bigint,
  in_progress          bigint,
  abandoned_estimate   bigint,
  completion_rate      numeric,
  players              bigint,
  matches_per_player   numeric,
  median_seconds       numeric,
  avg_seconds          numeric
)
language sql stable as $$
  with m as (
    select * from public.duel_matches
     where created_at >= p_from and created_at < p_to
  )
  select
    count(*)::bigint,
    count(*) filter (where status = 'COMPLETED')::bigint,
    count(*) filter (where status = 'DRAW')::bigint,
    count(*) filter (where status = 'UNRESOLVED')::bigint,
    count(*) filter (where status = 'IN_PROGRESS')::bigint,
    -- INFERENCIA, no dato: en curso y sin tocar desde hace horas.
    count(*) filter (
      where status = 'IN_PROGRESS'
        and updated_at < now() - make_interval(hours => p_stale_hours)
    )::bigint,
    round(100.0 * count(*) filter (where status in ('COMPLETED','DRAW','UNRESOLVED'))
          / nullif(count(*), 0), 1),
    count(distinct user_id)::bigint,
    round(count(*)::numeric / nullif(count(distinct user_id), 0), 2),
    round(percentile_cont(0.5) within group (
      order by extract(epoch from (updated_at - created_at))
    ) filter (where status in ('COMPLETED','DRAW','UNRESOLVED'))::numeric, 1),
    round(avg(extract(epoch from (updated_at - created_at)))
      filter (where status in ('COMPLETED','DRAW','UNRESOLVED'))::numeric, 1)
  from m;
$$;

-- ----------------------------------------------------------------------------
-- 3. EMBUDO DE PICK'EMS
-- ----------------------------------------------------------------------------
--
-- Mezcla los dos orígenes, y es el mejor ejemplo de por qué hacía falta la
-- telemetría: el primer paso —«miré la pantalla»— no existe en ninguna tabla
-- autoritativa, y sin él no hay denominador. Los tres siguientes sí existen desde
-- siempre.
--
-- LÍMITE REAL, dicho aquí: `pickem_viewed` solo existe desde la Fase 14. Para
-- ventanas anteriores devuelve 0, y entonces las conversiones que dependen de él
-- no significan nada. Se devuelve el dato en crudo para que quien lo lea lo vea.
create or replace function public.analytics_pickem_funnel(
  p_from timestamptz default now() - interval '30 days',
  p_to   timestamptz default now()
)
returns table (
  viewers_telemetry   bigint,
  predictors          bigint,
  predictions         bigint,
  scored              bigint,
  correct             bigint,
  rewarded            bigint,
  accuracy_pct        numeric,
  view_to_predict_pct numeric,
  source_note         text
)
language sql stable as $$
  with vistas as (
    select count(distinct user_id)::bigint as n
      from public.telemetry_events
     where event_name = 'zone_entered' and zone = 'pickems'
       and user_id is not null
       and occurred_at >= p_from and occurred_at < p_to
  ),
  resp as (
    select a.*, s.user_id
      from public.pickem_answers a
      join public.pickem_submissions s on s.id = a.submission_id
     where a.created_at >= p_from and a.created_at < p_to
  ),
  premios as (
    select count(distinct user_id)::bigint as n
      from public.credit_transactions
     where ref like 'pickem:%' and created_at >= p_from and created_at < p_to
  )
  select
    (select n from vistas),
    (select count(distinct user_id)::bigint from resp),
    (select count(*)::bigint from resp),
    (select count(*) filter (where is_correct is not null)::bigint from resp),
    (select count(*) filter (where is_correct)::bigint from resp),
    (select n from premios),
    (select round(100.0 * count(*) filter (where is_correct)
                  / nullif(count(*) filter (where is_correct is not null), 0), 1) from resp),
    round(100.0 * (select count(distinct user_id) from resp)
          / nullif((select n from vistas), 0), 1),
    'viewers_telemetry solo existe desde la Fase 14; el resto es retroactivo';
$$;

-- ----------------------------------------------------------------------------
-- 4. EMBUDO DE MERCADO
-- ----------------------------------------------------------------------------
--
-- `market_audit` ya registra las seis acciones del mercado con su fecha y su
-- usuario, y tiene índice `(user_id, action, created_at desc)`. Lo único que
-- faltaba era la vista, que ahora aporta la telemetría.
create or replace function public.analytics_market_funnel(
  p_from timestamptz default now() - interval '30 days',
  p_to   timestamptz default now()
)
returns table (
  viewers_telemetry  bigint,
  sellers            bigint,
  listings           bigint,
  buyers             bigint,
  purchases          bigint,
  cancellations      bigint,
  view_to_list_pct   numeric,
  view_to_buy_pct    numeric,
  list_to_sale_pct   numeric
)
language sql stable as $$
  with vistas as (
    select count(distinct user_id)::bigint as n
      from public.telemetry_events
     where event_name = 'zone_entered' and zone = 'market'
       and user_id is not null
       and occurred_at >= p_from and occurred_at < p_to
  ),
  acciones as (
    select * from public.market_audit
     where created_at >= p_from and created_at < p_to
  )
  select
    (select n from vistas),
    (select count(distinct user_id) filter (where action = 'list')::bigint from acciones),
    (select count(*) filter (where action = 'list')::bigint from acciones),
    (select count(distinct user_id) filter (where action = 'buy')::bigint from acciones),
    (select count(*) filter (where action = 'buy')::bigint from acciones),
    (select count(*) filter (where action = 'cancel')::bigint from acciones),
    round(100.0 * (select count(distinct user_id) filter (where action='list') from acciones)
          / nullif((select n from vistas), 0), 1),
    round(100.0 * (select count(distinct user_id) filter (where action='buy') from acciones)
          / nullif((select n from vistas), 0), 1),
    round(100.0 * (select count(*) filter (where action='buy') from acciones)
          / nullif((select count(*) filter (where action='list') from acciones), 0), 1);
$$;

-- ----------------------------------------------------------------------------
-- 5. ZONAS
-- ----------------------------------------------------------------------------
--
-- ENTRADAS NO ES USUARIOS. Un jugador entra en el mercado once veces en una
-- sesión: eso es **una** persona y **once** entradas. Confundirlos es la forma
-- más fácil de creer que una zona se usa más de lo que se usa, así que se
-- devuelven las tres cifras por separado y no se ofrece ningún total que las
-- mezcle.
--
-- `first_of_session` cuenta cuántas veces esa zona fue la puerta de entrada, que
-- responde una pregunta distinta: por dónde llega la gente.
create or replace function public.analytics_zones(
  p_from timestamptz default now() - interval '7 days',
  p_to   timestamptz default now()
)
returns table (
  zone             text,
  entries          bigint,
  users            bigint,
  anon_sessions    bigint,
  sessions         bigint,
  first_of_session bigint,
  entries_per_session numeric
)
language sql stable as $$
  select
    t.zone,
    count(*)::bigint,
    count(distinct t.user_id)::bigint,
    count(distinct t.session_id) filter (where t.user_id is null)::bigint,
    count(distinct t.session_id)::bigint,
    count(*) filter (where (t.metadata->>'is_first_of_session')::boolean)::bigint,
    round(count(*)::numeric / nullif(count(distinct t.session_id), 0), 2)
  from public.telemetry_events t
  where t.event_name = 'zone_entered'
    and t.zone is not null
    and t.occurred_at >= p_from and t.occurred_at < p_to
  group by t.zone
  order by 2 desc;
$$;

-- ----------------------------------------------------------------------------
-- 6. SESIONES
-- ----------------------------------------------------------------------------
--
-- LA DURACIÓN ES UNA COTA INFERIOR, SIEMPRE. Se rechazó `session_ended` en el
-- bloque 2 porque cerrar el navegador, perder la red o que el móvil mate la
-- pestaña no avisan, y emitirlo solo en los cierres limpios daría un dato
-- sesgado. Así que aquí la duración es `max(occurred_at) - min(occurred_at)`: no
-- se sabe cuánto estuvo mirando la última pantalla.
--
-- Por eso las columnas se llaman `*_seconds_lower_bound`. El nombre es la
-- advertencia: quien lea esto no puede confundirse.
--
-- Una sesión de un solo evento tiene duración 0. Es correcto —no hay evidencia
-- de más— y por eso se cuentan aparte (`single_event_sessions`): si son la
-- mayoría, la mediana no significa nada.
create or replace function public.analytics_sessions(
  p_from timestamptz default now() - interval '7 days',
  p_to   timestamptz default now()
)
returns table (
  sessions                       bigint,
  authenticated_sessions         bigint,
  anonymous_sessions             bigint,
  mixed_sessions                 bigint,
  known_users                    bigint,
  sessions_per_known_user        numeric,
  events_per_session             numeric,
  single_event_sessions          bigint,
  median_seconds_lower_bound     numeric,
  avg_seconds_lower_bound        numeric
)
language sql stable as $$
  with s as (
    select session_id,
           count(*) as eventos,
           count(distinct user_id) as usuarios,
           count(*) filter (where user_id is null) as anonimos,
           extract(epoch from (max(occurred_at) - min(occurred_at))) as segundos
      from public.telemetry_events
     where session_id is not null
       and occurred_at >= p_from and occurred_at < p_to
     group by session_id
  ),
  u as (
    select count(distinct user_id)::bigint as n
      from public.telemetry_events
     where user_id is not null and occurred_at >= p_from and occurred_at < p_to
  )
  select
    count(*)::bigint,
    -- Sesión autenticada: al menos un evento con usuario y ninguno sin él.
    count(*) filter (where usuarios > 0 and anonimos = 0)::bigint,
    count(*) filter (where usuarios = 0)::bigint,
    -- MIXTA: empezó anónima y siguió autenticada. Es el caso que el modelo de
    -- sesión existe para poder ver.
    count(*) filter (where usuarios > 0 and anonimos > 0)::bigint,
    (select n from u),
    round(count(*) filter (where usuarios > 0)::numeric / nullif((select n from u), 0), 2),
    round(avg(eventos)::numeric, 2),
    count(*) filter (where eventos = 1)::bigint,
    round(percentile_cont(0.5) within group (order by segundos)::numeric, 1),
    round(avg(segundos)::numeric, 1)
  from s;
$$;

-- ----------------------------------------------------------------------------
-- 7. USUARIOS ACTIVOS
-- ----------------------------------------------------------------------------
--
-- «Activo» = generó actividad REGISTRADA con identidad conocida. Las sesiones
-- anónimas se devuelven aparte y NO se suman: un visitante anónimo no es un
-- usuario único —puede ser el mismo de ayer con el almacenamiento limpio, o tres
-- pestañas de la misma persona—. Sumarlos daría una cifra más bonita y más falsa.
create or replace function public.analytics_active_users(
  p_from timestamptz default now() - interval '30 days',
  p_to   timestamptz default now()
)
returns table (
  day                 date,
  dau                 bigint,
  wau_trailing_7d     bigint,
  anon_sessions       bigint,
  sessions            bigint
)
language sql stable as $$
  with dias as (
    select generate_series(date_trunc('day', p_from), date_trunc('day', p_to), interval '1 day')::date as d
  )
  select
    dias.d,
    (select count(distinct t.user_id) from public.telemetry_events t
      where t.user_id is not null
        and t.occurred_at >= dias.d and t.occurred_at < dias.d + 1)::bigint,
    (select count(distinct t.user_id) from public.telemetry_events t
      where t.user_id is not null
        and t.occurred_at >= dias.d - 6 and t.occurred_at < dias.d + 1)::bigint,
    (select count(distinct t.session_id) from public.telemetry_events t
      where t.user_id is null and t.session_id is not null
        and t.occurred_at >= dias.d and t.occurred_at < dias.d + 1)::bigint,
    (select count(distinct t.session_id) from public.telemetry_events t
      where t.session_id is not null
        and t.occurred_at >= dias.d and t.occurred_at < dias.d + 1)::bigint
  from dias
  order by dias.d;
$$;

-- ----------------------------------------------------------------------------
-- 8. RETENCIÓN
-- ----------------------------------------------------------------------------
--
-- DEFINICIÓN EXACTA, porque «retención D1» significa cosas distintas según quién
-- lo diga:
--
--   D1  = de los usuarios dados de alta el día X, cuántos generaron actividad
--         registrada en la VENTANA [X+1 día, X+2 días).
--   D7  = ídem en [X+7, X+8).
--   D30 = ídem en [X+30, X+31).
--
-- Es retención de DÍA CONCRETO, no acumulada: D7 no incluye a quien volvió el día
-- 3 y no el 7. Se elige así porque es la definición más común y la más difícil de
-- inflar sin querer.
--
-- LÍMITE INSALVABLE: la actividad sale de `telemetry_events`, que existe desde la
-- Fase 14. Para cohortes anteriores devuelve 0, y eso NO significa que nadie
-- volviera: significa que no se estaba midiendo. Por eso se devuelve
-- `measurable`, que dice si la ventana de observación de esa cohorte cae dentro
-- del periodo con datos. Sin esa columna, un cero se leería como una catástrofe
-- de retención en vez de como una ausencia de instrumentación.
create or replace function public.analytics_retention(
  p_cohort_from timestamptz default now() - interval '60 days',
  p_cohort_to   timestamptz default now()
)
returns table (
  cohort_day    date,
  cohort_size   bigint,
  d1            bigint,
  d7            bigint,
  d30           bigint,
  d1_pct        numeric,
  d7_pct        numeric,
  d30_pct       numeric,
  d1_measurable boolean,
  d7_measurable boolean,
  d30_measurable boolean
)
language sql stable as $$
  with primera_telemetria as (
    select coalesce(min(occurred_at), now()) as t0 from public.telemetry_events
  ),
  cohortes as (
    select date_trunc('day', created_at)::date as dia, id as user_id
      from public.profiles
     where created_at >= p_cohort_from and created_at < p_cohort_to
  ),
  agrupado as (
    select dia, count(*)::bigint as tam, array_agg(user_id) as ids
      from cohortes group by dia
  )
  select
    a.dia,
    a.tam,
    (select count(distinct t.user_id) from public.telemetry_events t
      where t.user_id = any(a.ids)
        and t.occurred_at >= a.dia + 1 and t.occurred_at < a.dia + 2)::bigint,
    (select count(distinct t.user_id) from public.telemetry_events t
      where t.user_id = any(a.ids)
        and t.occurred_at >= a.dia + 7 and t.occurred_at < a.dia + 8)::bigint,
    (select count(distinct t.user_id) from public.telemetry_events t
      where t.user_id = any(a.ids)
        and t.occurred_at >= a.dia + 30 and t.occurred_at < a.dia + 31)::bigint,
    round(100.0 * (select count(distinct t.user_id) from public.telemetry_events t
      where t.user_id = any(a.ids)
        and t.occurred_at >= a.dia + 1 and t.occurred_at < a.dia + 2) / nullif(a.tam, 0), 1),
    round(100.0 * (select count(distinct t.user_id) from public.telemetry_events t
      where t.user_id = any(a.ids)
        and t.occurred_at >= a.dia + 7 and t.occurred_at < a.dia + 8) / nullif(a.tam, 0), 1),
    round(100.0 * (select count(distinct t.user_id) from public.telemetry_events t
      where t.user_id = any(a.ids)
        and t.occurred_at >= a.dia + 30 and t.occurred_at < a.dia + 31) / nullif(a.tam, 0), 1),
    -- ¿La ventana de observación cae dentro del periodo con instrumentación?
    (a.dia + 1  >= (select t0 from primera_telemetria)::date and a.dia + 2  <= now()::date),
    (a.dia + 7  >= (select t0 from primera_telemetria)::date and a.dia + 8  <= now()::date),
    (a.dia + 30 >= (select t0 from primera_telemetria)::date and a.dia + 31 <= now()::date)
  from agrupado a
  order by a.dia;
$$;

-- ----------------------------------------------------------------------------
-- 9. ERRORES
-- ----------------------------------------------------------------------------
--
-- Agrupado por huella para que veinte apariciones del mismo fallo sean una fila
-- con `occurrences = 20`, no veinte filas que hay que leer una a una.
create or replace function public.analytics_errors(
  p_from timestamptz default now() - interval '7 days',
  p_to   timestamptz default now()
)
returns table (
  day           date,
  severity      text,
  source        text,
  zone          text,
  flow          text,
  app_version   text,
  code          text,
  fingerprint   text,
  occurrences   bigint,
  users         bigint,
  sessions      bigint,
  sample        text
)
language sql stable as $$
  select
    date_trunc('day', t.occurred_at)::date,
    t.severity, t.source, t.zone, t.flow, t.app_version,
    t.metadata->>'code',
    t.metadata->>'fingerprint',
    count(*)::bigint,
    count(distinct t.user_id)::bigint,
    count(distinct t.session_id)::bigint,
    -- Un ejemplo del mensaje, ya saneado por el endpoint antes de escribirse.
    (array_agg(t.metadata->>'message' order by t.occurred_at desc))[1]
  from public.telemetry_events t
  where t.event_name = 'error_captured'
    and t.occurred_at >= p_from and t.occurred_at < p_to
  group by 1,2,3,4,5,6,7,8
  order by 9 desc;
$$;

-- ----------------------------------------------------------------------------
-- 10. FLUJOS
-- ----------------------------------------------------------------------------
--
-- El abandono se sigue calculando, no registrando: para `deck_builder` es «abrió
-- el constructor y NO guardó un mazo después». La huella autoritativa es
-- `duel_decks`, que existe desde mucho antes que la telemetría.
--
-- Los otros tres flujos del contrato no están instrumentados todavía (sus inicios
-- sí cambian de ruta, así que `zone_entered` ya los cubre), y por eso aparecen
-- con cero. Es una ausencia conocida, no un dato.
create or replace function public.analytics_flows(
  p_from timestamptz default now() - interval '30 days',
  p_to   timestamptz default now()
)
returns table (
  flow                text,
  starts              bigint,
  users               bigint,
  sessions            bigint,
  users_completed     bigint,
  completion_pct      numeric,
  completion_source   text
)
language sql stable as $$
  with f as (
    select flow, user_id, session_id, occurred_at
      from public.telemetry_events
     where event_name = 'flow_started' and flow is not null
       and occurred_at >= p_from and occurred_at < p_to
  )
  select
    f.flow,
    count(*)::bigint,
    count(distinct f.user_id)::bigint,
    count(distinct f.session_id)::bigint,
    count(distinct f.user_id) filter (
      where f.flow = 'deck_builder'
        and exists (select 1 from public.duel_decks d
                     where d.user_id = f.user_id and d.created_at >= f.occurred_at)
    )::bigint,
    round(100.0 * count(distinct f.user_id) filter (
      where f.flow = 'deck_builder'
        and exists (select 1 from public.duel_decks d
                     where d.user_id = f.user_id and d.created_at >= f.occurred_at)
    ) / nullif(count(distinct f.user_id), 0), 1),
    case f.flow
      when 'deck_builder' then 'duel_decks.created_at posterior'
      else 'sin huella de finalización definida todavía'
    end
  from f
  group by f.flow
  order by 2 desc;
$$;

-- ----------------------------------------------------------------------------
-- 11. RECORRIDO DE UNA SESIÓN
-- ----------------------------------------------------------------------------
--
-- Para operaciones: reconstruir qué hizo una sesión concreta. Mezcla los eventos
-- conductuales con las acciones autoritativas que ocurrieron en la misma ventana,
-- que es la única forma de ver «entró en el inventario → abrió un sobre → miró la
-- colección».
--
-- SOLO PARA ADMINISTRACIÓN. Ni un jugador ni el cliente pueden llamarla: la
-- ejecución está revocada a `anon` y `authenticated` (§12).
create or replace function public.analytics_session_journey(p_session uuid)
returns table (
  at        timestamptz,
  kind      text,
  detail    text,
  source    text
)
language sql stable as $$
  with s as (
    select min(occurred_at) as t0, max(occurred_at) as t1,
           (array_agg(user_id) filter (where user_id is not null))[1] as uid
      from public.telemetry_events where session_id = p_session
  )
  select occurred_at, event_name,
         coalesce(zone, flow, severity, ''), 'telemetry_events'
    from public.telemetry_events where session_id = p_session
  union all
  -- Lo autoritativo que ocurrió mientras esa sesión estaba viva.
  select o.created_at, 'economy_op', o.kind, 'economy_ops'
    from public.economy_ops o, s
   where o.user_id = s.uid and o.created_at between s.t0 and s.t1
  union all
  select c.created_at, 'ledger', c.reason || ' ' || c.delta::text, 'credit_transactions'
    from public.credit_transactions c, s
   where c.user_id = s.uid and c.created_at between s.t0 and s.t1
  union all
  select m.created_at, 'duel_' || lower(m.status), coalesce(m.winner, ''), 'duel_matches'
    from public.duel_matches m, s
   where m.user_id = s.uid and m.created_at between s.t0 and s.t1
  order by 1;
$$;

-- ----------------------------------------------------------------------------
-- 12. ACCESO
-- ----------------------------------------------------------------------------
--
-- Ninguna de estas funciones es para un jugador. Devuelven agregados del producto
-- entero y, en el caso del recorrido, la actividad de una persona concreta.
--
-- SE REVOCA A `public`, NO SOLO A `anon` Y `authenticated`.
--
-- Detectado al verificar este bloque, y merece quedar escrito porque es una
-- trampa fácil: PostgreSQL concede `EXECUTE` a **PUBLIC** por defecto en cada
-- función que se crea. Revocárselo a `anon` y `authenticated` no quita nada —no
-- tenían una concesión propia— y esos roles siguen heredando la de PUBLIC.
--
-- La primera versión de esta migración hacía justo eso, y las funciones seguían
-- siendo invocables desde PostgREST. Lo que las bloqueaba de verdad era el
-- permiso de TABLA de la migración 0029 («permission denied for table
-- telemetry_events»), que es una buena segunda barrera pero no la que aquí se
-- pretendía. Con la ejecución revocada a PUBLIC, ahora fallan antes: no llegan
-- ni a mirar una tabla.
--
-- `postgres` y `service_role` conservan concesiones EXPLÍCITAS, así que no les
-- afecta.
do $$
declare f text;
begin
  foreach f in array array[
    'analytics_ftue_funnel(timestamptz,timestamptz)',
    'analytics_duel_funnel(timestamptz,timestamptz,int)',
    'analytics_pickem_funnel(timestamptz,timestamptz)',
    'analytics_market_funnel(timestamptz,timestamptz)',
    'analytics_zones(timestamptz,timestamptz)',
    'analytics_sessions(timestamptz,timestamptz)',
    'analytics_active_users(timestamptz,timestamptz)',
    'analytics_retention(timestamptz,timestamptz)',
    'analytics_errors(timestamptz,timestamptz)',
    'analytics_flows(timestamptz,timestamptz)',
    'analytics_session_journey(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
-- ============================================================================
