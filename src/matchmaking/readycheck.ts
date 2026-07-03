/**
 * READY CHECK — aceptar / rechazar / timeout (Online Fase 2/7).
 *
 * Solo los HUMANOS deben aceptar (los bots aceptan implícitamente). Timeout ⇒ falla. Seguridad:
 * no cuenta aceptaciones dobles ni de quien rechazó. PURO.
 */
import type { ReadyCheck } from "./types";

export function newReadyCheck(proposalId: string, needed: string[], deadlineAt: number): ReadyCheck {
  const status = needed.length === 0 ? "ready" : "pending";
  return { proposalId, needed, accepted: [], declined: [], deadlineAt, status };
}

export function accept(rc: ReadyCheck, id: string): ReadyCheck {
  if (rc.status !== "pending") return rc;
  if (!rc.needed.includes(id) || rc.declined.includes(id) || rc.accepted.includes(id)) return rc; // anti doble/ inválido
  const accepted = [...rc.accepted, id];
  const status = accepted.length >= rc.needed.length ? "ready" : "pending";
  return { ...rc, accepted, status };
}

export function decline(rc: ReadyCheck, id: string): ReadyCheck {
  if (rc.status !== "pending") return rc;
  if (!rc.needed.includes(id)) return rc;
  return { ...rc, declined: [...new Set([...rc.declined, id])], status: "failed" };
}

/** Avanza el reloj: expira si no todos aceptaron a tiempo. */
export function tickReady(rc: ReadyCheck, now: number): ReadyCheck {
  if (rc.status !== "pending") return rc;
  if (rc.accepted.length >= rc.needed.length) return { ...rc, status: "ready" };
  if (now >= rc.deadlineAt) return { ...rc, status: "failed" };
  return rc;
}

export const isReady = (rc: ReadyCheck): boolean => rc.status === "ready";
export const isFailed = (rc: ReadyCheck): boolean => rc.status === "failed";
