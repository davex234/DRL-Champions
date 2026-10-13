/**
 * ESPORTS AUTO-SYNC · POLÍTICA (Fase 24.6) — funciones PURAS: qué eventos merecen sync y cuándo.
 *
 * ────────────────────────── CLASES DE EVENTO ──────────────────────────
 *
 *   live               hay un partido EN DIRECTO según la base de datos     → alta frecuencia
 *   active             torneo en marcha sin directo ahora mismo             → media
 *   upcoming_soon      empieza dentro de la ventana `upcomingSoon`          → moderada
 *   future             empieza más tarde                                    → baja
 *   recently_finished  terminó hace menos de `recentlyFinished`             → algunos rechecks
 *   archived           terminó hace más                                     → NO se sondea
 *
 * No mira nada del frontend (visibilidad, pestañas, quién tiene abierto /pickems): el backend
 * es autónomo. No inventa «en directo»: solo lo dice `matches.status` de la base de datos, que
 * es lo que el sync anterior escribió desde la fuente.
 */
import type { EsportsAutoSyncConfig } from "./config";

export type EventClass = "live" | "active" | "upcoming_soon" | "future" | "recently_finished" | "archived";

export interface EventSnapshotForPolicy {
  id: string;
  /** `events.status` tal cual (upcoming|live|finished u otros heredados). */
  status?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  matches: { status: string; startTime?: string | null }[];
}

/** Estado de salud POR EVENTO que el scheduler recuerda entre ejecuciones. */
export interface EventSyncMemory {
  lastAttemptAt?: number | null;
  lastSuccessAt?: number | null;
  consecutiveFailures?: number;
}

export interface EventSyncDecision {
  eventId: string;
  class: EventClass;
  eligible: boolean;
  /** Intervalo base de la clase (ms), sin backoff ni jitter. */
  baseIntervalMs: number;
  /** Intervalo efectivo tras el backoff por fallos consecutivos (ms). */
  intervalMs: number;
  /** Cuándo toca (ms epoch). `null` si no se sondea. */
  nextDueAt: number | null;
  due: boolean;
  /** Mayor = antes. */
  priority: number;
  reason: string;
}

const FINISHED = new Set(["finished", "completed", "final"]);
const LIVE = new Set(["live", "ongoing"]);

const ts = (s: string | null | undefined): number | null => {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
};

/** Clase del evento a partir de sus partidos (mandan) y, sin partidos, de sus fechas/estado. */
export function classifyEvent(ev: EventSnapshotForPolicy, now: number, cfg: EsportsAutoSyncConfig): EventClass {
  const ms = ev.matches;
  const starts = ms.map((m) => ts(m.startTime)).filter((t): t is number => t !== null);
  const anyLive = ms.some((m) => LIVE.has(m.status));
  const anyFinished = ms.some((m) => FINISHED.has(m.status));
  const allFinished = ms.length > 0 && ms.every((m) => FINISHED.has(m.status));
  const firstStart = starts.length ? Math.min(...starts) : ts(ev.startDate);
  const lastStart = starts.length ? Math.max(...starts) : null;
  const endAt = ts(ev.endDate) ?? lastStart;
  const srcStatus = (ev.status ?? "").toLowerCase();

  if (anyLive) return "live";

  if (allFinished || (ms.length === 0 && FINISHED.has(srcStatus))) {
    // Terminado. Reciente si acabó hace poco (fin del evento, último partido o, sin nada, ahora).
    const finishedAt = endAt ?? now;
    return now - finishedAt <= cfg.windows.recentlyFinished ? "recently_finished" : "archived";
  }

  if (anyFinished) return "active";
  if (firstStart !== null && firstStart <= now) return "active";
  if (ms.length === 0 && LIVE.has(srcStatus)) return "active";

  if (firstStart !== null) {
    return firstStart - now <= cfg.windows.upcomingSoon ? "upcoming_soon" : "future";
  }
  // Sin partidos ni fechas: no se puede saber. Frecuencia baja hasta que la fuente diga algo.
  return "future";
}

export function baseIntervalFor(cls: EventClass, cfg: EsportsAutoSyncConfig): number | null {
  switch (cls) {
    case "live": return cfg.intervals.live;
    case "active": return cfg.intervals.active;
    case "upcoming_soon": return cfg.intervals.upcomingSoon;
    case "future": return cfg.intervals.future;
    case "recently_finished": return cfg.intervals.recentlyFinished;
    case "archived": return null;
  }
}

export const PRIORITY: Record<EventClass, number> = {
  live: 100, active: 80, upcoming_soon: 60, recently_finished: 40, future: 20, archived: 0,
};

/** Intervalo con backoff exponencial por fallos consecutivos, con tope. Éxito = 0 fallos = base. */
export function applyBackoff(baseMs: number, consecutiveFailures: number, cfg: EsportsAutoSyncConfig): number {
  const n = Math.max(0, Math.floor(consecutiveFailures));
  if (n === 0) return baseMs;
  return Math.min(cfg.backoff.maxMs, Math.round(baseMs * Math.pow(cfg.backoff.factor, n)));
}

/** Jitter determinista si se inyecta `rng` (0..1). ±jitterRatio del intervalo. */
export function withJitter(ms: number, cfg: EsportsAutoSyncConfig, rng: () => number = Math.random): number {
  if (cfg.jitterRatio <= 0) return ms;
  const spread = ms * cfg.jitterRatio;
  return Math.round(ms + (rng() * 2 - 1) * spread);
}

/**
 * LA POLÍTICA. Dado el evento, lo que el scheduler recuerda de él y el reloj, decide si toca.
 * Sin efectos: se puede llamar mil veces con lo mismo y dice lo mismo.
 */
export function getEsportsSyncPolicy(
  ev: EventSnapshotForPolicy, memory: EventSyncMemory, now: number, cfg: EsportsAutoSyncConfig,
  rng: () => number = () => 0.5,
): EventSyncDecision {
  const cls = classifyEvent(ev, now, cfg);
  const base = baseIntervalFor(cls, cfg);
  if (base === null) {
    return {
      eventId: ev.id, class: cls, eligible: false, baseIntervalMs: 0, intervalMs: 0,
      nextDueAt: null, due: false, priority: PRIORITY[cls], reason: "archivado: sin sondeo periódico",
    };
  }
  const failures = memory.consecutiveFailures ?? 0;
  const interval = withJitter(applyBackoff(base, failures, cfg), cfg, rng);
  const last = memory.lastAttemptAt ?? null;
  const nextDueAt = last === null ? now : last + interval;
  const due = nextDueAt <= now;
  const reason = last === null
    ? "nunca sincronizado"
    : failures > 0 ? `backoff tras ${failures} fallo(s)` : `clase ${cls}`;
  return {
    eventId: ev.id, class: cls, eligible: true, baseIntervalMs: base, intervalMs: interval,
    nextDueAt, due, priority: PRIORITY[cls], reason,
  };
}

/**
 * Plan de una pasada: los eventos que TOCAN, ordenados por prioridad (los directos primero) y,
 * a igual prioridad, por lo que más tiempo llevan esperando.
 */
export function planSyncRun(
  events: EventSnapshotForPolicy[], memory: Record<string, EventSyncMemory>, now: number,
  cfg: EsportsAutoSyncConfig, rng: () => number = () => 0.5,
): { due: EventSyncDecision[]; all: EventSyncDecision[]; nextDueAt: number | null } {
  const all = events.map((ev) => getEsportsSyncPolicy(ev, memory[ev.id] ?? {}, now, cfg, rng));
  const due = all.filter((d) => d.eligible && d.due)
    .sort((a, b) => b.priority - a.priority || (a.nextDueAt ?? 0) - (b.nextDueAt ?? 0) || a.eventId.localeCompare(b.eventId));
  const pending = all.filter((d) => d.eligible && !d.due).map((d) => d.nextDueAt as number);
  const nextDueAt = due.length ? now : pending.length ? Math.min(...pending) : null;
  return { due, all, nextDueAt };
}
