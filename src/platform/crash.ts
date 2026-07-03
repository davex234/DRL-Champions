/**
 * PLATFORM — crash reporter (preparado para enviar al servidor en el futuro).
 *
 * Captura errores no controlados, guarda {versión, plataforma, SO, stack, hora} en logs
 * y en el adaptador KV. Hoy solo local; el envío remoto se activará luego sin reescribir.
 */
import { buildInfo } from "./version";
import { getAdapter } from "./store";
import { error, getLogs } from "./log";

export interface CrashReport {
  at: number;
  version: string;
  platform: string;
  os: string;
  message: string;
  stack?: string;
  recentLogs: { at: number; level: string; scope: string; msg: string }[];
}

export async function reportCrash(err: unknown): Promise<CrashReport> {
  const b = buildInfo();
  const e = err instanceof Error ? err : new Error(String(err));
  const report: CrashReport = {
    at: Date.now(), version: b.version, platform: b.platform, os: b.os,
    message: e.message, stack: e.stack,
    recentLogs: getLogs().slice(-25).map((l) => ({ at: l.at, level: l.level, scope: l.scope, msg: l.msg })),
  };
  error("crash", e.message, { stack: e.stack });
  try { await getAdapter().set(`crash-${report.at}`, JSON.stringify(report)); } catch { /* noop */ }
  // TODO(server): POST report al endpoint de crashes cuando exista.
  return report;
}

/** Instala manejadores globales (navegador/Tauri WebView). Idempotente. */
let installed = false;
export function installCrashHandler(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (ev) => { void reportCrash(ev.error ?? ev.message); });
  window.addEventListener("unhandledrejection", (ev) => { void reportCrash((ev as PromiseRejectionEvent).reason); });
}
