/**
 * F86 · CICLO DE VIDA (puro). Lo persistido son los hitos irreversibles (publicar, generar el cuadro, campeón,
 * cancelar); las fases de inscripción se DERIVAN de las fechas con la hora del SERVIDOR — sin cron para «abrir» o
 * «cerrar». El reloj del navegador solo pinta la cuenta atrás.
 *
 *   DRAFT ──publicar──▶ PUBLISHED ──(cierre + cuadro)──▶ IN_PROGRESS ──final──▶ COMPLETED
 *     │                    │  ├ ahora < apertura   → SCHEDULED
 *     │                    │  ├ apertura ≤ ahora < cierre → REGISTRATION_OPEN
 *     │                    │  └ cierre ≤ ahora (sin cuadro aún) → REGISTRATION_CLOSED
 *     └──────────── cualquiera no final ──cancelar──▶ CANCELLED
 */
import type { CupMatchStatus, CupPhase, CupStatus } from "./types";

export interface CupTiming {
  status: CupStatus;
  registrationOpenAt: number;
  registrationCloseAt: number;
  startsAt: number;
  startedAt: number | null;
}

export function cupPhase(c: CupTiming, now: number): CupPhase {
  switch (c.status) {
    case "DRAFT": return "DRAFT";
    case "CANCELLED": return "CANCELLED";
    case "COMPLETED": return "COMPLETED";
    case "IN_PROGRESS": return "IN_PROGRESS";
    case "PUBLISHED":
      if (c.startedAt !== null) return "IN_PROGRESS";
      if (now < c.registrationOpenAt) return "SCHEDULED";
      if (now < c.registrationCloseAt) return "REGISTRATION_OPEN";
      return "REGISTRATION_CLOSED";
  }
}

export const PHASE_LABEL: Record<CupPhase, string> = {
  DRAFT: "Borrador", SCHEDULED: "Próximamente", REGISTRATION_OPEN: "Inscripción abierta", REGISTRATION_CLOSED: "Inscripción cerrada",
  IN_PROGRESS: "En curso", COMPLETED: "Finalizado", CANCELLED: "Cancelado",
};

/** Ventana de una ronda: abre en `startsAt + (r−1)·ventana` y vence una ventana después. */
export function roundWindow(startsAt: number, windowMinutes: number, round: number): { availableAt: number; deadlineAt: number } {
  const w = windowMinutes * 60_000;
  return { availableAt: startsAt + (round - 1) * w, deadlineAt: startsAt + round * w };
}

export type MatchWindowState = "NOT_YET" | "OPEN" | "DEADLINE_PASSED";
export function windowState(availableAt: number, deadlineAt: number, now: number): MatchWindowState {
  if (now < availableAt) return "NOT_YET";
  if (now < deadlineAt) return "OPEN";
  return "DEADLINE_PASSED";
}

/**
 * Estado que se ENSEÑA de un cruce: el persistido, salvo un cruce listo cuyo plazo venció sin partida — eso es
 * «pendiente de resolución» (nadie gana por sorteo ni por pulsar «mi rival no vino»: lo resuelve un admin).
 */
export type MatchDisplayState = CupMatchStatus | "NO_SHOW_PENDING" | "WAITING_WINDOW";
export function displayState(status: CupMatchStatus, availableAt: number, deadlineAt: number, now: number): MatchDisplayState {
  if (status !== "READY") return status;
  const w = windowState(availableAt, deadlineAt, now);
  return w === "DEADLINE_PASSED" ? "NO_SHOW_PENDING" : w === "NOT_YET" ? "WAITING_WINDOW" : "READY";
}

export const MATCH_LABEL: Record<MatchDisplayState, string> = {
  PENDING: "Esperando rivales", READY: "Lista para jugar", ACTIVE: "En juego", COMPLETED: "Terminada", BYE: "Pase directo",
  VOID: "Sin ganador", ACTION_REQUIRED: "En revisión", CANCELLED: "Cancelada", NO_SHOW_PENDING: "Plazo vencido · en revisión",
  WAITING_WINDOW: "Aún no se puede jugar",
};
