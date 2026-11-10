/**
 * ESPORTS AUTO-SYNC · CONFIGURACIÓN (Fase 24.6) — el ÚNICO sitio con números.
 *
 * ────────────────────────── DOS CAPAS, DOS RITMOS ──────────────────────────
 *
 *   vlr.gg  ──(este ritmo)──►  NEXUS DB  ──(sondeo 24.5, hasta cada 20 s)──►  navegador
 *
 * El frontend puede refrescar NEXUS cada 20 segundos cuando hay directo. Eso NO significa
 * pedir a VLR cada 20 segundos: aquí se define un ritmo responsable con la fuente, y la base
 * de datos absorbe la diferencia. Nada de esto se lee desde `NEXT_PUBLIC_*`: es servidor.
 *
 * ────────────────────────── APAGADO POR DEFECTO ──────────────────────────
 *
 * Sin `ESPORTS_AUTO_SYNC_ENABLED=true` explícito, el scheduler NO ejecuta nada. Desplegar este
 * código no empieza a descargar nada solo: la activación es una decisión aparte y controlada.
 */

export type EnvLike = Record<string, string | undefined>;

export interface EsportsAutoSyncConfig {
  /** Kill switch. `false` salvo `ESPORTS_AUTO_SYNC_ENABLED=true`. */
  enabled: boolean;
  /** Intervalo entre syncs de un evento según su clase (ms). `archived` no se sondea. */
  intervals: {
    live: number;
    active: number;
    upcomingSoon: number;
    future: number;
    recentlyFinished: number;
  };
  /** Ventanas que definen las clases (ms). */
  windows: {
    /** «Próximo cercano»: empieza dentro de este plazo. */
    upcomingSoon: number;
    /** «Terminado reciente»: acabó hace menos de esto; después, archivado. */
    recentlyFinished: number;
  };
  /** Timeout por petición HTTP a la fuente (ms). */
  timeoutMs: number;
  /** Eventos sincronizados a la vez. 1 = secuencial (lo respetuoso con la fuente). */
  maxConcurrency: number;
  /** Reintentos ante errores TRANSITORIOS (timeout, red, 5xx, 429). Nunca ante parse/validación. */
  retry: { maxAttempts: number; baseDelayMs: number };
  /** Backoff entre syncs de un evento que viene fallando: intervalo × factor^fallos, con tope. */
  backoff: { factor: number; maxMs: number };
  /** Jitter máximo (fracción del intervalo, 0–1) para no alinear ejecuciones exactas. */
  jitterRatio: number;
  /** Lease del lock de single-flight (ms). Si el proceso muere, otro puede entrar pasado esto. */
  lockTtlMs: number;
  /** Una lista de partidos que encoge por debajo de esta fracción de lo conocido es sospechosa. */
  suspiciousShrinkRatio: number;
  /** Pausa entre páginas de partido dentro de un evento (ms): respeto a la fuente. */
  politeDelayMs: number;
  /** Máximo de páginas de detalle de partido por evento y pasada. */
  maxMatchPages: number;
}

const MIN = 60_000;
const HOUR = 60 * MIN;

/** Valores por defecto. Se documentan aquí y en el informe; no se repiten en ningún otro sitio. */
export const DEFAULT_AUTO_SYNC_CONFIG: EsportsAutoSyncConfig = {
  enabled: false,
  intervals: {
    live: 2 * MIN,
    active: 10 * MIN,
    upcomingSoon: 30 * MIN,
    future: 6 * HOUR,
    recentlyFinished: 60 * MIN,
  },
  windows: {
    upcomingSoon: 48 * HOUR,
    recentlyFinished: 72 * HOUR,
  },
  timeoutMs: 15_000,
  maxConcurrency: 1,
  retry: { maxAttempts: 3, baseDelayMs: 1_000 },
  backoff: { factor: 2, maxMs: 6 * HOUR },
  jitterRatio: 0.1,
  lockTtlMs: 10 * MIN,
  suspiciousShrinkRatio: 0.5,
  politeDelayMs: 300,
  maxMatchPages: 64,
};

const bool = (v: string | undefined, dflt: boolean): boolean => {
  if (v == null || v.trim() === "") return dflt;
  return ["1", "true", "yes", "on"].includes(v.trim().toLowerCase());
};
const int = (v: string | undefined, dflt: number, min = 0): number => {
  if (v == null || v.trim() === "") return dflt;
  const n = Number(v);
  return Number.isFinite(n) && n >= min ? Math.floor(n) : dflt;
};
const ratio = (v: string | undefined, dflt: number): number => {
  if (v == null || v.trim() === "") return dflt;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : dflt;
};

/**
 * Configuración efectiva a partir del entorno. Puro: se le pasa el entorno (en tests, uno de
 * mentira). Los valores en segundos en el entorno; en ms en la config.
 *
 *   ESPORTS_AUTO_SYNC_ENABLED                 true|false (default false)
 *   ESPORTS_AUTO_SYNC_INTERVAL_LIVE_S         default 120
 *   ESPORTS_AUTO_SYNC_INTERVAL_ACTIVE_S       default 600
 *   ESPORTS_AUTO_SYNC_INTERVAL_UPCOMING_S     default 1800
 *   ESPORTS_AUTO_SYNC_INTERVAL_FUTURE_S       default 21600
 *   ESPORTS_AUTO_SYNC_INTERVAL_RECENT_S       default 3600
 *   ESPORTS_AUTO_SYNC_TIMEOUT_S               default 15
 *   ESPORTS_AUTO_SYNC_MAX_CONCURRENCY         default 1
 *   ESPORTS_AUTO_SYNC_LOCK_TTL_S              default 600
 */
export function getEsportsAutoSyncConfig(env: EnvLike = process.env): EsportsAutoSyncConfig {
  const d = DEFAULT_AUTO_SYNC_CONFIG;
  const sec = (key: string, dflt: number, min = 1) => int(env[key], dflt / 1000, min) * 1000;
  return {
    enabled: bool(env.ESPORTS_AUTO_SYNC_ENABLED, false),
    intervals: {
      // Nunca por debajo de 30 s a la fuente, digan lo que digan las variables.
      live: Math.max(30_000, sec("ESPORTS_AUTO_SYNC_INTERVAL_LIVE_S", d.intervals.live)),
      active: Math.max(60_000, sec("ESPORTS_AUTO_SYNC_INTERVAL_ACTIVE_S", d.intervals.active)),
      upcomingSoon: Math.max(60_000, sec("ESPORTS_AUTO_SYNC_INTERVAL_UPCOMING_S", d.intervals.upcomingSoon)),
      future: Math.max(5 * MIN, sec("ESPORTS_AUTO_SYNC_INTERVAL_FUTURE_S", d.intervals.future)),
      recentlyFinished: Math.max(5 * MIN, sec("ESPORTS_AUTO_SYNC_INTERVAL_RECENT_S", d.intervals.recentlyFinished)),
    },
    windows: { ...d.windows },
    timeoutMs: sec("ESPORTS_AUTO_SYNC_TIMEOUT_S", d.timeoutMs),
    maxConcurrency: Math.min(4, int(env.ESPORTS_AUTO_SYNC_MAX_CONCURRENCY, d.maxConcurrency, 1)),
    retry: { ...d.retry },
    backoff: { ...d.backoff },
    jitterRatio: ratio(env.ESPORTS_AUTO_SYNC_JITTER_RATIO, d.jitterRatio),
    lockTtlMs: sec("ESPORTS_AUTO_SYNC_LOCK_TTL_S", d.lockTtlMs, 30),
    suspiciousShrinkRatio: d.suspiciousShrinkRatio,
    politeDelayMs: d.politeDelayMs,
    maxMatchPages: d.maxMatchPages,
  };
}

/**
 * Secreto del trigger interno. Reutiliza `SYNC_SECRET` (server-only, ya usado por
 * `/api/esports/sync` y `/api/market/sync-reference`). Sin secreto → el trigger falla cerrado.
 */
export function getSyncTriggerSecret(env: EnvLike = process.env): string | null {
  const s = env.ESPORTS_SYNC_SECRET?.trim() || env.SYNC_SECRET?.trim();
  return s && s.length >= 16 ? s : null;
}
