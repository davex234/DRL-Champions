/**
 * PERIODICIDAD DE MISIONES (Fase 27) — ventanas temporales PURAS.
 *
 * Las misiones `daily` y `weekly` del pase ya existían (`@/battlepass`, `data/season`) y se
 * sorteaban UNA vez: sin ventana, no caducaban ni se renovaban solas. Aquí se define la ventana
 * de cada tipo a partir de UN reloj que pasa quien llama —el servidor, con `Date.now()`— y se
 * decide si una tanda asignada en `assignedAt` ya pertenece a una ventana anterior.
 *
 * Sin `new Date()` sin argumento: el reloj es siempre un parámetro. El cliente solo formatea la
 * cuenta atrás; nunca decide una rotación.
 *
 *   · diaria  → día UTC (00:00Z → 24:00Z)
 *   · semanal → semana ISO (lunes 00:00Z → lunes siguiente)
 */
import type { MissionKind } from "@/battlepass/types";

export interface PeriodWindow {
  /** Inicio de la ventana en la que cae `now`, en ms UTC. */
  startsAt: number;
  /** Fin exclusivo de la ventana, en ms UTC. */
  endsAt: number;
}

const DAY_MS = 24 * 3600_000;

/** Solo estos tipos rotan por tiempo. El resto dura la temporada o es permanente. */
export const PERIODIC_KINDS: readonly MissionKind[] = ["daily", "weekly"];

export const isPeriodic = (kind: MissionKind): boolean => PERIODIC_KINDS.includes(kind);

/** La ventana del tipo en la que cae `now`; `null` si el tipo no rota. */
export function periodWindow(kind: MissionKind, now: number): PeriodWindow | null {
  if (kind === "daily") {
    const startsAt = Math.floor(now / DAY_MS) * DAY_MS;
    return { startsAt, endsAt: startsAt + DAY_MS };
  }
  if (kind === "weekly") {
    // Lunes 00:00Z. El día 0 de la época (1970-01-01) fue jueves: se desplaza 3 días.
    const days = Math.floor(now / DAY_MS);
    const monday = days - ((days + 3) % 7);
    const startsAt = monday * DAY_MS;
    return { startsAt, endsAt: startsAt + 7 * DAY_MS };
  }
  return null;
}

/**
 * ¿La tanda asignada en `assignedAt` es de una ventana ANTERIOR a la de `now`? Entonces toca
 * sortear otra. Una tanda de la ventana actual (o del futuro, por un reloj adelantado) no rota.
 */
export function rotationDue(kind: MissionKind, assignedAt: number, now: number): boolean {
  const w = periodWindow(kind, now);
  if (!w) return false;
  return assignedAt < w.startsAt;
}

/** Cuándo caduca la tanda asignada en `assignedAt` (fin de SU ventana), o `null` si no caduca. */
export function expiresAt(kind: MissionKind, assignedAt: number): number | null {
  const w = periodWindow(kind, assignedAt);
  return w ? w.endsAt : null;
}

/** Texto corto de cuenta atrás (solo formato; no decide nada). */
export function remainingLabel(endsAt: number, now: number): string {
  const ms = Math.max(0, endsAt - now);
  const h = Math.floor(ms / 3600_000);
  const m = Math.floor((ms % 3600_000) / 60_000);
  if (h >= 48) return `${Math.floor(h / 24)} d`;
  if (h >= 1) return `${h} h ${String(m).padStart(2, "0")} min`;
  return `${m} min`;
}
