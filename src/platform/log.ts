/**
 * PLATFORM — sistema de LOGS centralizado.
 *
 * Registra inicio, errores, crashes, tiempos de carga, memoria, updates, estado Live y
 * sincronizaciones. Buffer en memoria + persistencia (adaptador KV). Consola en debug.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { getAdapter } from "./store";
import { platformName } from "./env";
import { ns } from "@/i18n/runtime";

const t = ns("platform");

export type LogLevel = "info" | "warn" | "error" | "debug";
export interface LogEntry { at: number; level: LogLevel; scope: string; msg: string; data?: unknown }

const CAP = 500;
const PERSIST = 200;
const buffer: LogEntry[] = [];
let toConsole = false;
const now = (): number => (typeof performance !== "undefined" ? Math.round(performance.now()) : Date.now());

export const setLogConsole = (on: boolean): void => { toConsole = on; };

export function log(level: LogLevel, scope: string, msg: string, data?: unknown): void {
  const e: LogEntry = { at: Date.now(), level, scope, msg, data };
  buffer.push(e);
  if (buffer.length > CAP) buffer.splice(0, buffer.length - CAP);
  if (toConsole && typeof console !== "undefined") (console[level === "debug" ? "log" : level] ?? console.log)(`[${scope}] ${msg}`, data ?? "");
}
export const info = (s: string, m: string, d?: unknown) => log("info", s, m, d);
export const warn = (s: string, m: string, d?: unknown) => log("warn", s, m, d);
export const error = (s: string, m: string, d?: unknown) => log("error", s, m, d);

export const getLogs = (): LogEntry[] => [...buffer];

/** Persiste los últimos N (best-effort). */
export async function flushLogs(): Promise<void> {
  try { await getAdapter().set("logs", JSON.stringify(buffer.slice(-PERSIST))); } catch { /* noop */ }
}

// --- Eventos típicos del cliente ---
export const recordStart = (): void => info("boot", `DRL Champions arrancando (${platformName()})`);
export const recordLoadTime = (ms: number): void => info("boot", t("Carga completada en {ms} ms", { ms }), { ms });
export const recordUpdate = (m: string, d?: unknown): void => info("update", m, d);
export const recordLive = (m: string, d?: unknown): void => info("live", m, d);
export const recordSync = (m: string, d?: unknown): void => info("sync", m, d);

/** Memoria actual (web: performance.memory; node: process.memoryUsage; else null). */
export function memoryUsageMB(): number | null {
  try {
    const pm = (typeof performance !== "undefined" && (performance as any).memory) || null;
    if (pm?.usedJSHeapSize) return Math.round(pm.usedJSHeapSize / 1048576);
    if (typeof process !== "undefined" && (process as any).memoryUsage) return Math.round((process as any).memoryUsage().heapUsed / 1048576);
  } catch { /* noop */ }
  return null;
}
export const recordMemory = (): void => { const mb = memoryUsageMB(); if (mb != null) info("perf", `Memoria: ${mb} MB`, { mb }); };
export { now as monotonicNow };
