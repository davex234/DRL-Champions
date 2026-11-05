-- ============================================================================
-- 0029 — TELEMETRY EVENTS (NEXUS Fase 14, bloque 3)
--
-- ─────────────────────────── QUÉ ES Y QUÉ NO ES ───────────────────────────
--
-- Esta tabla guarda EXCLUSIVAMENTE comportamiento: sesiones, zonas visitadas,
-- flujos abiertos y errores. Cuatro nombres de evento y ni uno más.
--
-- Lo que NO guarda, y no guardará nunca:
--
--   · Economía. Cada crédito ya está en `credit_transactions`, con `ref` único
--     e idempotente, y cada operación en `economy_ops` con su `kind`. Escribir
--     aquí un `credits_spent` crearía una segunda verdad para el dinero, que es
--     exactamente lo que la auditoría de esta fase prohíbe.
--   · Resultados de juego. `duel_matches` ya tiene `status`, `winner`,
--     `difficulty` y `state->>'turn'`, con sus índices. Un evento
--     `duel_completed` sería una copia peor y que además no funcionaría para
--     las partidas que YA existen.
--   · Abandonos. El abandono no es un hecho que ocurra: es la AUSENCIA de un
--     hecho posterior. Se calcula cruzando esta tabla con las autoritativas.
--
-- La justificación completa, evento a evento, está en
-- `docs/telemetry/EVENT-TAXONOMY.md` (4 almacenados, 30 derivados, 21
-- rechazados) y el diseño en `docs/telemetry/DATA-MODEL.md`.
--
-- ─────────────────────────── TELEMETRÍA NO ES AUTORIDAD ───────────────────────────
--
-- Nada de lo que hay aquí decide nada. Si esta tabla se vaciara entera, el
-- producto seguiría siendo correcto: los saldos, los rangos, las recompensas y
-- las reglas viven en otro sitio y no la consultan.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. LA TABLA
-- ----------------------------------------------------------------------------
--
-- CLAVE PRIMARIA: `bigint generated always as identity`, no uuid.
-- El precedente de la casa para un registro de solo-anexado es `market_audit`
-- (0004), que usa identity por lo mismo: es la mitad de tamaño que un uuid,
-- crece de forma secuencial —lo que mantiene el índice compacto en una tabla
-- que solo recibe inserciones— y nadie necesita generar el id en el cliente.
-- Las tablas de DOMINIO sí usan `gen_random_uuid()` porque sus filas se
-- referencian desde fuera; una fila de telemetría no se referencia jamás.
create table if not exists public.telemetry_events (
  id           bigint generated always as identity primary key,

  -- Qué pasó. Cerrado en la base de datos, no solo en TypeScript (§2).
  event_name   text        not null,

  -- QUIÉN, cuando se sabe.
  --
  -- Nullable a propósito: NEXUS funciona sin cuenta en `/inventario` y
  -- `/coleccion` (modo local de un jugador), así que un visitante anónimo
  -- genera eventos legítimos. Referencia `auth.users` porque es lo que hace
  -- TODA tabla de usuario del proyecto — `profiles` es un perfil derivado, no
  -- la identidad.
  --
  -- `on delete cascade`: si alguien borra su cuenta, su rastro conductual se va
  -- con ella. Es la misma decisión que ya toman `user_cards` y
  -- `credit_transactions`.
  user_id      uuid            references auth.users(id) on delete cascade,

  -- La sesión. Un UUID que genera el cliente y guarda en `sessionStorage`.
  --
  -- No lleva clave foránea porque NO EXISTE una tabla de sesiones y no se va a
  -- crear: una sesión es una ventana de 30 minutos de inactividad, no una
  -- entidad. Su utilidad es agrupar: reconstruir el recorrido y estimar la
  -- duración como `max(occurred_at) - min(occurred_at)`.
  --
  -- Puede existir con `user_id` y sin él, y CONSERVARSE al autenticarse: por eso
  -- la sesión completa de alguien que entra anónimo y luego inicia sesión se
  -- puede atribuir entera sin reescribir ninguna fila.
  session_id   uuid,

  -- DÓNDE, en vocabulario de producto.
  --
  -- Es una zona, NO una ruta. La diferencia no es estética: una ruta puede
  -- llevar identificadores en el camino o en la consulta, y un enum cerrado no
  -- puede filtrar nada por construcción. Además `/colecciones/champions-paris`
  -- y `/colecciones/ewc-2026` son la misma respuesta a «¿qué zonas usa?».
  zone         text,

  -- QUÉ INTENTABA HACER, solo para los flujos cuyo inicio no cambia de ruta.
  flow         text,

  -- Solo para `error_captured` (§4).
  source       text,
  severity     text,

  -- De qué entorno viene. Sin esto, las pruebas locales contaminan las métricas
  -- de producción. Los valores son los de `NODE_ENV`, que es la convención que
  -- el proyecto ya usa (`src/config/admin.ts`, `RegisterSW.tsx`).
  environment  text        not null,

  -- Versión de la aplicación, de `src/platform/version.ts` (`APP_VERSION`), que
  -- es la fuente única que el pipeline de release ya sincroniza. Nullable porque
  -- un evento sigue siendo útil aunque no se pueda resolver la versión, y
  -- perderlo entero por eso sería peor.
  app_version  text,

  -- Lo específico de cada evento.
  --
  -- ESTO NO ES «JSON LIBRE». La lista blanca de claves por evento la impone el
  -- endpoint del bloque siguiente, que descarta cualquier clave no prevista
  -- ANTES de escribir. Aquí abajo la base de datos impone lo que puede imponer
  -- sin duplicar esa lógica: que sea un objeto y que no sea grande (§5).
  metadata     jsonb       not null default '{}'::jsonb,

  -- CUÁNDO. Lo sella el servidor.
  --
  -- `now()` y no un valor del cliente: el reloj de un navegador puede estar mal
  -- puesto, en otra zona horaria, o mentir a propósito. `timestamptz` guarda UTC
  -- con precisión de microsegundo, igual que el resto del esquema.
  occurred_at  timestamptz not null default now()
);

comment on table public.telemetry_events is
  'Telemetría CONDUCTUAL de NEXUS (Fase 14). Solo-anexado. Cuatro eventos: session_started, zone_entered, flow_started, error_captured. Nunca economía ni resultados de juego: esos ya son autoritativos en credit_transactions, economy_ops, market_audit y duel_matches. No es autoridad para nada.';

-- ----------------------------------------------------------------------------
-- 2. EVENT_NAME CERRADO
-- ----------------------------------------------------------------------------
-- La restricción vive en la BASE DE DATOS y no solo en TypeScript, por el mismo
-- motivo que el resto del proyecto lo hace así: una defensa que solo vive en
-- Node se salta con otro cliente. Añadir un evento nuevo debe costar una
-- migración — ese roce es deliberado y es lo que impide que la taxonomía se
-- desborde a los seis meses.
--
-- Se usa CHECK y no `create type ... as enum` porque el proyecto no tiene ni un
-- solo tipo enum de Postgres: usa CHECK en todas sus tablas
-- (`duel_matches.difficulty`, `market_audit.action`, `user_strats.side`…).
-- Y además un CHECK se amplía con un ALTER trivial; un enum, no.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'telemetry_events_name_check') then
    alter table public.telemetry_events
      add constraint telemetry_events_name_check
      check (event_name in ('session_started', 'zone_entered', 'flow_started', 'error_captured'));
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 3. ZONE CERRADO
-- ----------------------------------------------------------------------------
-- Las 30 zonas cubren las 33 rutas de jugador (varias comparten zona: las dos
-- de `/colecciones`, las dos de `/tienda`, las dos de `/entrenador/strats`).
-- `other` es la válvula: una ruta nueva sin zona asignada entra ahí en vez de
-- perder el evento.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'telemetry_events_zone_check') then
    alter table public.telemetry_events
      add constraint telemetry_events_zone_check
      check (zone is null or zone in (
        'home', 'inventory', 'store', 'pack_ceremony',
        'collection', 'collections',
        'market',
        'duel_hub', 'deck_list', 'duel_play', 'duel_replay',
        'tournaments', 'tournament_detail', 'pickems',
        'pass', 'rewards', 'ranking', 'account', 'events',
        'trainer', 'trainer_maps', 'trainer_strats', 'trainer_match', 'trainer_teams',
        'career', 'news', 'world', 'manager', 'launcher',
        'other'
      ));
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 4. FLOW, SOURCE Y SEVERITY
-- ----------------------------------------------------------------------------
-- Los cuatro flujos son exactamente aquellos cuyo INICIO no cambia la ruta y por
-- tanto no deja rastro en ninguna tabla autoritativa. El caso comprobado en la
-- Fase 13: pulsar «Crear mi primer mazo» abre el constructor sin cambiar de URL,
-- así que quien lo abre y se rinde es hoy invisible.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'telemetry_events_flow_check') then
    alter table public.telemetry_events
      add constraint telemetry_events_flow_check
      check (flow is null or flow in (
        'deck_builder', 'pack_ceremony', 'pickem_form', 'market_listing_form'
      ));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'telemetry_events_source_check') then
    alter table public.telemetry_events
      add constraint telemetry_events_source_check
      check (source is null or source in ('client', 'server'));
  end if;

  -- `critical` NO es «un error grave». Es «un error que impide completar uno de
  -- los nueve flujos críticos» (login, ftue, pack_ceremony, inventory,
  -- deck_builder, duel_play, pickem_form, market_listing_form, reward_claim).
  -- Esa disciplina la impone el emisor; la base de datos solo cierra el conjunto
  -- para que nadie invente un nivel nuevo.
  if not exists (select 1 from pg_constraint where conname = 'telemetry_events_severity_check') then
    alter table public.telemetry_events
      add constraint telemetry_events_severity_check
      check (severity is null or severity in ('warn', 'error', 'critical'));
  end if;

  -- Los valores de `NODE_ENV`, que es la convención del proyecto.
  if not exists (select 1 from pg_constraint where conname = 'telemetry_events_env_check') then
    alter table public.telemetry_events
      add constraint telemetry_events_env_check
      check (environment in ('development', 'test', 'production'));
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 5. COHERENCIA ENTRE CAMPOS
-- ----------------------------------------------------------------------------
-- Aquí es donde la base de datos aporta algo que TypeScript no puede: garantizar
-- que una fila TIENE SENTIDO, no solo que sus campos son de tipos válidos.
--
-- Sin esto se podría insertar un `zone_entered` con `severity='critical'`, o un
-- `error_captured` sin saber si vino del cliente o del servidor. Filas así no
-- rompen nada al escribirse: rompen las consultas seis meses después, cuando ya
-- hay medio millón y nadie recuerda por qué los números no cuadran.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'telemetry_events_shape_check') then
    alter table public.telemetry_events
      add constraint telemetry_events_shape_check
      check (
        case event_name
          -- Un error SIEMPRE dice de dónde viene y cuánto importa.
          when 'error_captured' then source is not null and severity is not null
          -- Un cambio de zona SIEMPRE dice a qué zona. Y no tiene severidad.
          when 'zone_entered'   then zone is not null and severity is null and source is null
          -- Un flujo SIEMPRE dice cuál.
          when 'flow_started'   then flow is not null and severity is null and source is null
          -- El arranque de sesión no lleva ni flujo, ni severidad, ni origen.
          when 'session_started' then flow is null and severity is null and source is null
          else false
        end
      );
  end if;

  -- `metadata` es un OBJETO, no un array ni un escalar: `{"zone":"home"}`, no
  -- `[1,2,3]` ni `"hola"`. Sin esto, `metadata->>'clave'` devolvería null en
  -- silencio para las filas mal formadas.
  if not exists (select 1 from pg_constraint where conname = 'telemetry_events_metadata_object_check') then
    alter table public.telemetry_events
      add constraint telemetry_events_metadata_object_check
      check (jsonb_typeof(metadata) = 'object');
  end if;

  -- TECHO DE TAMAÑO: 2 KB.
  --
  -- La lista blanca de claves la aplica el endpoint (bloque 4). Este techo es la
  -- red debajo: aunque un día alguien se equivoque y pase un objeto entero, esta
  -- tabla no se convierte en un vertedero ni en un canal para exfiltrar datos.
  -- 2 KB es diez veces lo que ocupa el metadata más grande de la taxonomía.
  if not exists (select 1 from pg_constraint where conname = 'telemetry_events_metadata_size_check') then
    alter table public.telemetry_events
      add constraint telemetry_events_metadata_size_check
      check (pg_column_size(metadata) <= 2048);
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 6. ÍNDICES
-- ----------------------------------------------------------------------------
-- Cuatro. Cada uno responde a una consulta concreta y ninguno está «por si
-- acaso»: en una tabla que solo recibe inserciones, cada índice es un coste fijo
-- en cada escritura.

-- (1) El embudo por usuario y `last_seen`.
--     «¿qué hizo este jugador y en qué orden?» · `max(occurred_at)` por usuario.
--     PARCIAL: las filas anónimas no entran. En este índice no sirven de nada y
--     serían una fracción importante del volumen.
create index if not exists telemetry_user_time_idx
  on public.telemetry_events (user_id, occurred_at desc)
  where user_id is not null;

-- (2) Reconstruir una sesión y estimar su duración.
--     `min`/`max(occurred_at)` agrupado por sesión, y el recorrido de zonas.
create index if not exists telemetry_session_time_idx
  on public.telemetry_events (session_id, occurred_at)
  where session_id is not null;

-- (3) Las métricas agregadas, que son casi todas las de la consola.
--     DAU/WAU (`event_name='session_started'` en una ventana), uso por zona
--     (`event_name='zone_entered'` agrupado por `zone`), aperturas de flujo.
--     `event_name` va primero porque TODA consulta agregada lo fija.
create index if not exists telemetry_name_time_idx
  on public.telemetry_events (event_name, occurred_at desc);

-- (4) «¿Está roto algo ahora mismo?».
--     PARCIAL sobre las filas con severidad: los errores son —con suerte— una
--     minoría diminuta, y un índice parcial sobre ellos es diminuto también.
create index if not exists telemetry_severity_time_idx
  on public.telemetry_events (severity, occurred_at desc)
  where severity is not null;

-- NO se crea un índice suelto por `occurred_at` para el borrado de retención:
-- es un barrido diario, no una consulta interactiva, y el índice se pagaría en
-- cada una de las inserciones del día. Se mide antes de optimizar.

-- ----------------------------------------------------------------------------
-- 7. SOLO-ANEXADO: NADIE MODIFICA UN EVENTO
-- ----------------------------------------------------------------------------
-- Un hecho registrado no se corrige: si estaba mal, se registra otro. Permitir
-- UPDATE abriría la puerta a reescribir la historia, y una telemetría que se
-- puede editar no sirve para auditar nada.
--
-- El disparador es incondicional a propósito: bloquea también a `service_role`,
-- que se salta RLS. La defensa de RLS protege del cliente; esta protege de un
-- error en nuestro propio código de servidor.
--
-- DELETE sí se permite —y solo `service_role` puede llegar a él— porque la
-- política de retención de 90 días necesita borrar. Ese mecanismo NO se crea en
-- este bloque (§13 de DATA-MODEL.md).
create or replace function public.telemetry_events_no_update()
returns trigger language plpgsql as $$
begin
  raise exception 'TEL-01: telemetry_events es de solo anexado; un evento no se modifica';
end; $$;

drop trigger if exists telemetry_events_no_update_trg on public.telemetry_events;
create trigger telemetry_events_no_update_trg
  before update on public.telemetry_events
  for each row execute function public.telemetry_events_no_update();

-- ----------------------------------------------------------------------------
-- 8. RLS — NI LECTURA, NI ESCRITURA, NI PARA SÍ MISMO
-- ----------------------------------------------------------------------------
-- Mismo modelo que `market_audit` (0004), que es la otra tabla de registro del
-- proyecto: RLS activo y CERO políticas de cliente. Solo `service_role`.
--
-- ¿Por qué no dejar que cada uno lea lo suyo, como en `credit_transactions`?
-- Porque el libro mayor es información que al jugador le PERTENECE y le sirve
-- —es su recibo—, mientras que aquí no hay nada que le sirva: son zonas y
-- errores. Abrir la lectura solo añadiría superficie de ataque a cambio de nada.
-- Si algún día hace falta una exportación de datos personales, se hace por una
-- ruta de servidor que decida qué se entrega, no abriendo la tabla.
--
-- Con RLS activo y sin políticas, `anon` y `authenticated` no ven ni una fila y
-- no pueden escribir. El `revoke` de abajo es el segundo cerrojo, por si algún
-- día alguien añadiera una política por error.
alter table public.telemetry_events enable row level security;

-- Sin políticas. Intencionadamente. Cualquier `create policy` sobre esta tabla
-- debe justificarse en `docs/telemetry/SECURITY.md` antes de escribirse.

revoke select, insert, update, delete on public.telemetry_events from anon, authenticated;

-- Y TRUNCATE, que NO es un detalle.
--
-- Supabase concede por defecto el juego completo de privilegios a `anon` y
-- `authenticated` sobre el esquema `public`, TRUNCATE incluido. Y TRUNCATE **se
-- salta RLS**: una tabla con RLS impecable y sin una sola política se puede
-- vaciar entera si el privilegio sigue concedido. Las políticas de fila no
-- protegen de una operación que opera sobre la tabla, no sobre las filas.
--
-- Hoy no es explotable por la vía normal —PostgREST no expone ningún verbo que
-- ejecute TRUNCATE, y al Postgres local no se llega desde fuera—, así que esto
-- es defensa en profundidad, no el cierre de un agujero abierto. Pero el coste
-- de quitarlo es una línea.
--
-- OBSERVACIÓN QUE EXCEDE ESTA TABLA (documentada, NO corregida aquí): el mismo
-- privilegio sigue concedido sobre `credit_transactions` y `market_audit`, y
-- sobre esta última además INSERT, UPDATE, DELETE y SELECT, que 0004 nunca
-- revocó porque confió solo en RLS. Tocar el libro mayor está fuera del encargo
-- de esta fase. Queda anotado en `docs/telemetry/DATA-MODEL.md` §14.
revoke truncate, references, trigger on public.telemetry_events from anon, authenticated;

-- ----------------------------------------------------------------------------
-- 9. QUIÉN ESCRIBE
-- ----------------------------------------------------------------------------
-- Nadie todavía. El escritor autorizado será una ruta de servidor (bloque 4) que
-- resolverá el usuario con `getSession(req)` —del Bearer, NUNCA del cuerpo—,
-- aplicará la lista blanca de `metadata` y usará el cliente `service_role`.
--
-- Que el cliente pudiera insertar aquí directamente sería un problema aunque la
-- tabla no decida nada: cualquiera podría inflar las métricas, o probar a meter
-- texto en `metadata` para que lo lea después un panel de administración.
-- ============================================================================
