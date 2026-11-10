/**
 * ESPORTS AUTO-SYNC · LOG ESTRUCTURADO (Fase 24.6).
 *
 *   [esports-sync] event=vlr-2766 class=live matches_changed=2 duration_ms=1432 status=success
 *
 * Una línea por hecho, `clave=valor`, sin secretos: cualquier campo cuyo nombre huela a
 * secreto/token/clave se redacta antes de imprimirse, pase lo que pase aguas arriba.
 */

export type LogFields = Record<string, string | number | boolean | null | undefined>;

export interface SyncLogger {
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

const SENSITIVE = /secret|token|password|passwd|api[_-]?key|service[_-]?role|authorization|bearer/i;

export function formatLogLine(prefix: string, event: string, fields: LogFields = {}): string {
  const parts = [`${prefix} event=${event}`];
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    const val = SENSITIVE.test(k) ? "[redacted]" : String(v).replace(/\s+/g, " ");
    parts.push(`${k}=${/[\s=]/.test(val) ? JSON.stringify(val) : val}`);
  }
  return parts.join(" ");
}

export function createConsoleLogger(prefix = "[esports-sync]", sink: Pick<Console, "log" | "warn" | "error"> = console): SyncLogger {
  return {
    info: (e, f) => sink.log(formatLogLine(prefix, e, f)),
    warn: (e, f) => sink.warn(formatLogLine(prefix, e, f)),
    error: (e, f) => sink.error(formatLogLine(prefix, e, f)),
  };
}

/** Logger que acumula (tests, dry run que quiere enseñar sus líneas). */
export function createMemoryLogger(prefix = "[esports-sync]"): SyncLogger & { lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    info: (e, f) => { lines.push(formatLogLine(prefix, e, f)); },
    warn: (e, f) => { lines.push(formatLogLine(prefix, e, f)); },
    error: (e, f) => { lines.push(formatLogLine(prefix, e, f)); },
  };
}

export const nullLogger: SyncLogger = { info: () => {}, warn: () => {}, error: () => {} };
