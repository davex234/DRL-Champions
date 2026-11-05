-- ============================================================================
-- 0036 — LÍMITE DE FRECUENCIA DEL PvP (Bloque 7.6)
--
-- QUÉ RESUELVE
--   D-PVP-9, abierta desde el bloque 7.3: «sin límite de peticiones en el endpoint. Un cliente
--   puede sondear tan rápido como quiera; el ritmo lo pone el cliente por buena fe». Con la arena
--   del 7.5 esa deuda dejó de ser teórica: ahora hay dos superficies que se sondean de verdad.
--
-- ─────────────── POR QUÉ NO SE REUTILIZA NINGUNO DE LOS DOS QUE YA HAY ───────────────
--
--   `/api/telemetry` → `new Map()` EN PROCESO. Su propia cabecera lo admite: «es por proceso y se
--       reinicia con el servidor. Con varias instancias, el límite efectivo se multiplica por el
--       número de instancias». Y se justifica porque «el peor caso de saltárselo son filas de más
--       en una tabla con retención de 90 días — no un crédito, ni un punto, ni una carta».
--       **Ese argumento no vale aquí.** Detrás del PvP hay partidas, cola y rating.
--
--   `_check_rate` (0004, mercado) → SQL, así que sí sobrevive a varios procesos, pero cuenta
--       filas de `market_audit` de la última hora en CADA llamada. Para unos pocos anuncios por
--       hora es correcto; para un sondeo cada 1,2 s sería un recuento por petición.
--
--   Hacía falta uno nuevo: compartido entre procesos (Postgres) y de coste CONSTANTE (una fila
--   por sujeto y cubeta, un solo UPSERT por petición). No hay Redis en este proyecto.
--
-- ─────────────── LOS NÚMEROS SALEN DE MEDIR, NO DE ELEGIR ───────────────
--
--   Ritmo REAL del cliente, leído de `POLL_MS` y de `usePvpQueue`:
--
--     sondeo de partida   1.200 ms en turno del rival → 50 pet/min  (2.500 ms en el tuyo → 24)
--     sondeo de cola      2.000 ms                    → 30 pet/min
--     acciones            20 por partida, repartidas en minutos; el motor ya impide dos por turno
--     pestaña oculta      15.000 / 6.000 ms           → 4 y 10 pet/min
--
--   Los límites de abajo dejan entre 2× y 3× de margen sobre el peor caso legítimo. Ese margen
--   no es generosidad: es lo que hace falta para que NO moleste al jugador real —dos pestañas
--   abiertas en la misma cuenta, un refresco, la transición de cola a partida, un `syncNow`— y
--   sigue estando dos órdenes de magnitud por debajo de «mil peticiones en un segundo».
--
-- ─────────────── LO QUE ESTE LÍMITE NO ES ───────────────
--
--   No sustituye a NADA de lo que ya protege el juego. El índice único parcial de la cola, la
--   guarda de partida activa, `state_version`, `action_id` y las restricciones de rating siguen
--   siendo la defensa real contra «crear dos partidas» o «jugar dos veces». Esto es una capa de
--   encima que evita que alguien queme recursos intentándolo.
--
-- REVERSIÓN (conceptual)
--   drop function if exists public.app_rate_take(text,text,int,int);
--   drop table if exists public.api_rate_limits;
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. LA TABLA — una fila por sujeto y cubeta, no una fila por petición
-- ----------------------------------------------------------------------------
--
-- Es la diferencia con `_check_rate`: aquí no se cuentan filas, se incrementa un contador. La
-- tabla no crece con el tráfico; crece con el número de usuarios activos, y se recicla sola
-- porque cada fila se reutiliza en cada ventana.
create table if not exists public.api_rate_limits (
  /*
   * Quién. Para el PvP es SIEMPRE el `user_id` del Bearer, en texto.
   *
   * Es texto y no `uuid` a propósito: la misma tabla tiene que poder sostener mañana otros
   * sujetos —una clave de servicio, un identificador de instalación— sin migrar la columna. Lo
   * que NUNCA será es algo que elija el cliente: quien escribe aquí es el servidor con el id que
   * sacó del token.
   */
  subject      text        not null,
  /** Qué superficie. `pvp_sync`, `pvp_action`, `mm_status`, `mm_write`. */
  bucket       text        not null,
  /** Comienzo de la ventana vigente. */
  window_start timestamptz not null default now(),
  /** Peticiones contadas en esa ventana. */
  count        integer     not null default 0,
  primary key (subject, bucket),
  constraint api_rate_limits_count_check check (count >= 0)
);

-- ----------------------------------------------------------------------------
-- 2. SEGURIDAD — el cliente no ve ni toca su propio contador
-- ----------------------------------------------------------------------------
--
-- Misma política que todo el PvP: RLS activo, cero políticas, `revoke all`. Si un usuario pudiera
-- escribir aquí, podría ponerse el contador a cero — que es exactamente saltarse el límite.
alter table public.api_rate_limits enable row level security;
revoke all on public.api_rate_limits from anon, authenticated;

comment on table public.api_rate_limits is
  'Contadores de frecuencia por sujeto y superficie (Bloque 7.6). Coste constante: un UPSERT por peticion, no un recuento. Compartida entre procesos, que es lo que el limitador en memoria de /api/telemetry no puede dar.';

-- ----------------------------------------------------------------------------
-- 3. TOMAR UN TURNO — una sola sentencia, atómica
-- ----------------------------------------------------------------------------
--
-- Todo ocurre en el `INSERT ... ON CONFLICT DO UPDATE`: crear la fila si no existe, reiniciar la
-- ventana si ya venció, o incrementar. No hay `SELECT` previo del que fiarse — leer y decidir en
-- dos pasos permitiría a dos peticiones simultáneas leer el mismo contador y pasar las dos.
--
-- VENTANA FIJA, y conviene decir qué implica: en el salto entre dos ventanas se pueden colar
-- hasta 2× el límite en un instante. Con una ventana deslizante no pasaría, pero costaría dos
-- contadores por sujeto y más lógica. Se acepta a propósito porque los límites ya llevan de 2× a
-- 3× de margen sobre el tráfico legítimo: el pico del borde sigue estando lejísimos de un abuso.
--
-- Devuelve SIEMPRE lo mismo, se permita o no, para que quien llama no tenga que adivinar:
--   allowed     — si esta petición entra
--   retryAfter  — segundos hasta que se abra la ventana siguiente (para la cabecera `Retry-After`)
create or replace function public.app_rate_take(
  p_subject text, p_bucket text, p_limit int, p_window_seconds int
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_count int;
  v_start timestamptz;
  v_win   interval := make_interval(secs => greatest(p_window_seconds, 1));
begin
  insert into public.api_rate_limits (subject, bucket, window_start, count)
  values (p_subject, p_bucket, now(), 1)
  on conflict (subject, bucket) do update
    set count = case
          when public.api_rate_limits.window_start <= now() - v_win then 1
          else public.api_rate_limits.count + 1
        end,
        window_start = case
          when public.api_rate_limits.window_start <= now() - v_win then now()
          else public.api_rate_limits.window_start
        end
  returning count, window_start into v_count, v_start;

  return jsonb_build_object(
    'allowed', v_count <= greatest(p_limit, 1),
    'count', v_count,
    'limit', p_limit,
    -- Cuánto falta para que la ventana se reinicie. Nunca menos de 1: un `Retry-After: 0`
    -- invitaría a reintentar inmediatamente, que es justo lo contrario de lo que se pide.
    'retryAfter', greatest(1, ceil(extract(epoch from (v_start + v_win - now()))))::int
  );
end $$;

-- ----------------------------------------------------------------------------
-- 4. LIMPIEZA — la tabla no debe crecer para siempre
-- ----------------------------------------------------------------------------
--
-- Una fila queda muerta cuando su ventana venció hace mucho y nadie ha vuelto a pedir. Se barren
-- de forma OPORTUNISTA, igual que la caducidad de la cola (7.4): sin `cron`, y sin que ninguna
-- petición pague el barrido entero.
create or replace function public.app_rate_sweep(p_older_than_seconds int default 3600)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from public.api_rate_limits
   where window_start < now() - make_interval(secs => greatest(p_older_than_seconds, 60));
  get diagnostics n = row_count;
  return n;
end $$;

create index if not exists api_rate_limits_stale_idx on public.api_rate_limits (window_start);

-- ----------------------------------------------------------------------------
-- 5. CONCESIONES — solo el servidor
-- ----------------------------------------------------------------------------
do $mig$
declare f text;
begin
  foreach f in array array['app_rate_take(text,text,int,int)', 'app_rate_sweep(int)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end
$mig$;
