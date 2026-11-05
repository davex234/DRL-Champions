/**
 * REVIEW — proyección del estado editorial de un registro para el panel: fila por carta con
 * su estado vigente y las acciones legales (availableActions del workflow F4). Solo lectura;
 * las decisiones pasan por engine.decideRecordCards (única puerta).
 */
import { availableActions, stateCounts, type EditorialAction, type EditorialState } from "@/editorial";
import type { GenerationRecord } from "./types";

export interface ControlReviewRow {
  cardId: string;
  playerId: string;
  nick: string;
  variantId: string;
  ovr: number;
  rarity: string;
  /** null si la revisión aún no se ha abierto. */
  state: EditorialState | null;
  /** Acciones legales desde el estado vigente (vacío sin caso). */
  actions: EditorialAction[];
}

/** Una fila por carta de la generación, con estado editorial y acciones disponibles. */
export function reviewRows(rec: GenerationRecord): ControlReviewRow[] {
  const nickById = new Map(
    rec.generation.players.filter((p) => p.playerId).map((p) => [p.playerId!, p.nick]),
  );
  return rec.generation.cards.map((c) => {
    const state = rec.editorial?.states[c.cardId] ?? null;
    return {
      cardId: c.cardId,
      playerId: c.playerId,
      nick: nickById.get(c.playerId) ?? c.playerId,
      variantId: c.variantId,
      ovr: c.ovr,
      rarity: c.rarityBucket,
      state,
      actions: state ? availableActions(state) : [],
    };
  });
}

/** Contadores editoriales del registro (null si la revisión no está abierta). */
export const reviewCounts = (rec: GenerationRecord): Record<EditorialState, number> | null =>
  rec.editorial ? stateCounts(rec.editorial) : null;
