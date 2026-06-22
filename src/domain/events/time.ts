import type { EventDef } from "./types";

export const DAY_MS = 86_400_000;

export type EventStatus = "upcoming" | "active" | "ended";

export interface EventWindow {
  start: number;
  end: number;
  status: EventStatus;
  /** ms restantes (hasta el fin si activo; hasta el inicio si próximo). */
  msLeft: number;
}

/** Calcula la ventana temporal de un evento respecto al inicio de temporada. */
export function eventWindow(ev: EventDef, seasonStart: number, now: number): EventWindow {
  const start = seasonStart + ev.startOffsetDays * DAY_MS;
  const end = start + ev.durationDays * DAY_MS;
  const status: EventStatus = now < start ? "upcoming" : now >= end ? "ended" : "active";
  const msLeft = status === "active" ? end - now : status === "upcoming" ? start - now : 0;
  return { start, end, status, msLeft };
}

export interface Countdown {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

export function countdown(ms: number): Countdown {
  const s = Math.max(0, Math.floor(ms / 1000));
  return {
    days: Math.floor(s / 86400),
    hours: Math.floor((s % 86400) / 3600),
    minutes: Math.floor((s % 3600) / 60),
    seconds: s % 60,
  };
}

/** Identificador de la semana actual (para tareas semanales). */
export function weekId(now: number, seasonStart: number): string {
  return `w${Math.floor((now - seasonStart) / (7 * DAY_MS))}`;
}

/** Clave de día local (para recompensas diarias). */
export function dayKey(now: number): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** Días de diferencia (en días de calendario) entre dos timestamps. */
export function dayDiff(a: number, b: number): number {
  const da = new Date(a);
  const db = new Date(b);
  const ua = Date.UTC(da.getFullYear(), da.getMonth(), da.getDate());
  const ub = Date.UTC(db.getFullYear(), db.getMonth(), db.getDate());
  return Math.round((ua - ub) / DAY_MS);
}
