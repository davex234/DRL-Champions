/**
 * WORKFLOW — la máquina de estados editorial. ÚNICA fuente de transiciones legales:
 *
 *   draft → review → approved → published → archived
 *              ├→ rejected ─┐
 *              ├→ hidden  ──┤→ (volver a) review
 *              └→ blocked ──┘
 *
 * Pura y total: cualquier (estado, acción) fuera del mapa es ilegal y se rechaza sin mutar.
 */
import type { EditorialAction, EditorialState } from "./types";

/** Mapa completo de transiciones legales. Lo que no está aquí, NO existe. */
export const TRANSITIONS: Readonly<Record<EditorialState, Partial<Record<EditorialAction, EditorialState>>>> = {
  draft: { to_review: "review" },
  review: { approve: "approved", reject: "rejected", hide: "hidden", block: "blocked" },
  approved: { publish: "published", to_review: "review", reject: "rejected", hide: "hidden", block: "blocked" },
  rejected: { to_review: "review", block: "blocked" },
  hidden: { to_review: "review", block: "blocked" },
  blocked: { to_review: "review" },
  published: { archive: "archived" },
  archived: {},
};

export function canApply(state: EditorialState, action: EditorialAction): boolean {
  return TRANSITIONS[state]?.[action] !== undefined;
}

/** Estado destino de una transición legal, o `undefined` si es ilegal. */
export function nextState(state: EditorialState, action: EditorialAction): EditorialState | undefined {
  return TRANSITIONS[state]?.[action];
}

/** Acciones disponibles desde un estado (para la UI del dashboard). */
export function availableActions(state: EditorialState): EditorialAction[] {
  return Object.keys(TRANSITIONS[state] ?? {}) as EditorialAction[];
}
