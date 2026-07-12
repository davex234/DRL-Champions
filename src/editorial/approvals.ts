/**
 * APPROVALS — decisiones editoriales sobre cartas: aprobar, rechazar, ocultar, bloquear,
 * volver a review, archivar; individuales, por lote y por torneo completo. Inmutable: cada
 * decisión devuelve un caso NUEVO; las transiciones ilegales se reportan sin tocar nada.
 */
import { makeEvent } from "./history";
import { canApply, nextState } from "./workflow";
import { cardsInState } from "./review";
import type { DecisionMeta, DecisionResult, EditorialAction, EditorialCase } from "./types";

/** Aplica UNA acción a un conjunto de cartas. La única puerta de cambio de estado. */
export function decide(c: EditorialCase, cardIds: string[], action: EditorialAction, meta: DecisionMeta): DecisionResult {
  const states = { ...c.states };
  const history = [...c.history];
  const next: EditorialCase = { ...c, states, history };
  const applied: string[] = [];
  const skipped: DecisionResult["skipped"] = [];

  for (const cardId of cardIds) {
    const from = states[cardId];
    if (from === undefined) {
      skipped.push({ cardId, error: "la carta no pertenece a esta generación" });
      continue;
    }
    if (!canApply(from, action)) {
      skipped.push({ cardId, error: `transición ilegal: ${from} × ${action}` });
      continue;
    }
    const to = nextState(from, action)!;
    history.push(makeEvent({ history, generationId: c.generationId }, action, meta, { cardId, from, to }));
    states[cardId] = to;
    applied.push(cardId);
  }
  return { case: next, applied, skipped };
}

/* ── Conveniencias (todas pasan por `decide`) ─────────────────────────────── */

export const approve = (c: EditorialCase, cardIds: string[], meta: DecisionMeta): DecisionResult => decide(c, cardIds, "approve", meta);
export const reject = (c: EditorialCase, cardIds: string[], meta: DecisionMeta): DecisionResult => decide(c, cardIds, "reject", meta);
export const hide = (c: EditorialCase, cardIds: string[], meta: DecisionMeta): DecisionResult => decide(c, cardIds, "hide", meta);
export const block = (c: EditorialCase, cardIds: string[], meta: DecisionMeta): DecisionResult => decide(c, cardIds, "block", meta);
export const backToReview = (c: EditorialCase, cardIds: string[], meta: DecisionMeta): DecisionResult => decide(c, cardIds, "to_review", meta);
export const archive = (c: EditorialCase, cardIds: string[], meta: DecisionMeta): DecisionResult => decide(c, cardIds, "archive", meta);

/** Aprueba en lote (alias explícito del dashboard). */
export const approveBatch = approve;

/** Aprueba el torneo COMPLETO: todas las cartas actualmente en review. */
export function approveTournament(c: EditorialCase, meta: DecisionMeta): DecisionResult {
  return approve(c, cardsInState(c, "review"), meta);
}

/* ── Operaciones singulares (contrato Fase 4: una carta, misma puerta `decide`) ── */

export const approveCard = (c: EditorialCase, cardId: string, meta: DecisionMeta): DecisionResult => approve(c, [cardId], meta);
export const rejectCard = (c: EditorialCase, cardId: string, meta: DecisionMeta): DecisionResult => reject(c, [cardId], meta);
export const hideCard = (c: EditorialCase, cardId: string, meta: DecisionMeta): DecisionResult => hide(c, [cardId], meta);
export const blockCard = (c: EditorialCase, cardId: string, meta: DecisionMeta): DecisionResult => block(c, [cardId], meta);
export const returnToReview = (c: EditorialCase, cardIds: string[], meta: DecisionMeta): DecisionResult => backToReview(c, cardIds, meta);
export const archiveCard = (c: EditorialCase, cardId: string, meta: DecisionMeta): DecisionResult => archive(c, [cardId], meta);

/** Aprueba la generación COMPLETA (alias del contrato: todas las cartas en review). */
export const approveGeneration = approveTournament;
