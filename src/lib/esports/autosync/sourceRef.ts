/**
 * ESPORTS AUTO-SYNC · LA FUENTE (Fase 24.6): referencias permitidas, timeout, reintentos y
 * clasificación de errores.
 *
 * ────────────────────────── NADA DE URLs ARBITRARIAS ──────────────────────────
 *
 * El scheduler NO acepta una URL de nadie. Un evento de la base de datos se resuelve a su id de
 * vlr.gg (por `events.vlr_url` o por su propio id) y la URL se CONSTRUYE aquí, siempre contra
 * `https://www.vlr.gg`. El fetcher rechaza cualquier host que no sea ese: sin SSRF por diseño.
 *
 * ────────────────────────── ERRORES CON CLASE ──────────────────────────
 *
 *   transient   timeout, red, 5xx, 429      → se reintenta (pocas veces, con espera creciente)
 *   permanent   4xx, host no permitido      → NO se reintenta
 *   parse       HTML que no es un torneo    → NO se reintenta (lo decide el importador)
 */
import { parseVlrUrl, VLR_BASE, type VlrFetcher } from "@/importer-vlr";
import type { EsportsAutoSyncConfig } from "./config";

export const VLR_HOST = new URL(VLR_BASE).host;

export interface SourceRef {
  /** Id del evento en NEXUS (`events.id`). */
  eventId: string;
  /** Id numérico del torneo en vlr.gg. */
  vlrEventId: string;
  /** URL canónica construida aquí. Nunca viene del exterior. */
  url: string;
}

export interface EventRowForRef { id: string; source?: string | null; vlr_url?: string | null }

/** Referencia a la fuente para un evento de la base de datos, o `null` si no se puede saber. */
export function resolveSourceRef(ev: EventRowForRef): SourceRef | null {
  if (ev.source && ev.source !== "vlr") return null;
  let vlrEventId: string | undefined;
  if (ev.vlr_url) vlrEventId = parseVlrUrl(ev.vlr_url)?.eventId;
  if (!vlrEventId && /^\d{1,8}$/.test(ev.id)) vlrEventId = ev.id;
  if (!vlrEventId) {
    const m = /^vlr-(\d{1,8})$/i.exec(ev.id);
    if (m) vlrEventId = m[1];
  }
  if (!vlrEventId) return null;
  return { eventId: ev.id, vlrEventId, url: `${VLR_BASE}/event/${vlrEventId}` };
}

/** Referencia explícita (trigger manual / CLI) a partir de un id numérico o una URL de vlr.gg. */
export function sourceRefFromInput(eventId: string, input: string): SourceRef | null {
  const trimmed = input.trim();
  const vlrEventId = /^\d{1,8}$/.test(trimmed) ? trimmed : parseVlrUrl(trimmed)?.eventId;
  if (!vlrEventId) return null;
  return { eventId, vlrEventId, url: `${VLR_BASE}/event/${vlrEventId}` };
}

export type SourceErrorKind = "transient" | "permanent" | "parse";

export class SourceError extends Error {
  constructor(public kind: SourceErrorKind, message: string, public status?: number) {
    super(message);
    this.name = "SourceError";
  }
}

export function isTransient(e: unknown): boolean {
  return e instanceof SourceError ? e.kind === "transient" : false;
}

/** Clasifica un error cualquiera ocurrido al leer la fuente. */
export function classifySourceError(e: unknown): SourceError {
  if (e instanceof SourceError) return e;
  const msg = e instanceof Error ? e.message : String(e);
  const name = e instanceof Error ? e.name : "";
  if (name === "AbortError" || /timeout|timed out|abort/i.test(msg)) return new SourceError("transient", `timeout: ${msg}`);
  if (/ECONN|ENOTFOUND|EAI_AGAIN|fetch failed|network|socket/i.test(msg)) return new SourceError("transient", `red: ${msg}`);
  const http = /HTTP (\d{3})/.exec(msg);
  if (http) {
    const status = Number(http[1]);
    if (status >= 500 || status === 429) return new SourceError("transient", msg, status);
    return new SourceError("permanent", msg, status);
  }
  if (/no parece un torneo|no válida|parse/i.test(msg)) return new SourceError("parse", msg);
  return new SourceError("permanent", msg);
}

export interface TimedFetcherOptions {
  timeoutMs: number;
  retry: EsportsAutoSyncConfig["retry"];
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Hosts permitidos. Por defecto, solo vlr.gg. */
  allowedHosts?: string[];
  onAttempt?: (info: { url: string; attempt: number; error?: string }) => void;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Fetcher de HTML con timeout por petición, allowlist de host y reintentos SOLO ante errores
 * transitorios. Devuelve el mismo contrato que espera el conector (`VlrFetcher`).
 */
export function createTimedFetcher(opts: TimedFetcherOptions): VlrFetcher {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? defaultSleep;
  const allowed = new Set((opts.allowedHosts ?? [VLR_HOST]).map((h) => h.toLowerCase()));
  const attempts = Math.max(1, opts.retry.maxAttempts);

  const once = async (url: string): Promise<string> => {
    let host: string;
    try { host = new URL(url).host.toLowerCase(); } catch { throw new SourceError("permanent", `URL ilegible: ${url}`); }
    if (!allowed.has(host)) throw new SourceError("permanent", `host no permitido: ${host}`);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);
    try {
      const res = await fetchImpl(url, {
        signal: ctrl.signal,
        headers: { "user-agent": "DRLChampions-Importer/1.0 (+tournament data import)", accept: "text/html" },
      });
      if (!res.ok) throw new Error(`VLR HTTP ${res.status} — ${url}`);
      return await res.text();
    } finally {
      clearTimeout(timer);
    }
  };

  return async (url: string): Promise<string> => {
    let last: SourceError | null = null;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        opts.onAttempt?.({ url, attempt });
        return await once(url);
      } catch (e) {
        last = classifySourceError(e);
        opts.onAttempt?.({ url, attempt, error: `${last.kind}: ${last.message}` });
        if (last.kind !== "transient" || attempt === attempts) throw last;
        await sleep(opts.retry.baseDelayMs * Math.pow(2, attempt - 1));
      }
    }
    throw last ?? new SourceError("permanent", "sin intentos");
  };
}
