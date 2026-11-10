/**
 * REVIEW — entrada de una generación al circuito editorial y consultas de revisión.
 * `submitGeneration` NO publica nada: registra el caso (cartas en `draft`, opcionalmente
 * enviadas a `review`) con la generación ÍNTEGRA dentro. Búsqueda y agrupaciones puras.
 */
import type { CardGenerationResult } from "@/card-generator";
import { EDITORIAL_SCHEMA_VERSION } from "./engine";
import { makeEvent } from "./history";
import type { DecisionMeta, EditorialCase, EditorialState } from "./types";

export interface SubmitOptions extends DecisionMeta {
  tournamentName?: string;
  /** true (por defecto): las cartas entran directamente en `review` (draft → review trazado). */
  autoReview?: boolean;
}

/** Registra una generación YA producida por el pipeline como caso editorial. No regenera nada. */
export function submitGeneration(gen: CardGenerationResult, opts: SubmitOptions): EditorialCase {
  const c: EditorialCase = {
    schemaVersion: EDITORIAL_SCHEMA_VERSION,
    generationId: gen.generationId,
    tournamentId: gen.tournamentId,
    tournamentName: opts.tournamentName ?? gen.tournamentName,
    season: gen.season,
    submittedAt: opts.at,
    submittedBy: opts.actor,
    generation: gen,
    states: {},
    history: [],
  };
  c.history.push(makeEvent(c, "submit", opts));
  for (const spec of gen.cards) c.states[spec.cardId] = "draft";
  if (opts.autoReview !== false) {
    for (const spec of gen.cards) {
      c.history.push(makeEvent(c, "to_review", opts, { cardId: spec.cardId, from: "draft", to: "review" }));
      c.states[spec.cardId] = "review";
    }
  }
  return c;
}

/* ── Consultas ────────────────────────────────────────────────────────────── */

export const cardsInState = (c: EditorialCase, state: EditorialState): string[] =>
  Object.keys(c.states).filter((id) => c.states[id] === state).sort();

export const stateCounts = (c: EditorialCase): Record<EditorialState, number> => {
  const out = { draft: 0, review: 0, approved: 0, published: 0, archived: 0, rejected: 0, hidden: 0, blocked: 0 };
  for (const id of Object.keys(c.states)) out[c.states[id]]++;
  return out;
};

/**
 * Búsqueda editorial: por cardId, jugador (id o nick de la resolución F4) o variante.
 * Texto libre, case-insensitive. Devuelve cardIds en orden estable.
 */
export function searchCards(c: EditorialCase, text: string): string[] {
  const q = text.trim().toLowerCase();
  if (!q) return Object.keys(c.states).sort();
  const nickById = new Map(c.generation.players.filter((p) => p.playerId).map((p) => [p.playerId!, p.nick.toLowerCase()]));
  return c.generation.cards
    .filter((s) =>
      s.cardId.toLowerCase().includes(q) ||
      s.playerId.toLowerCase().includes(q) ||
      s.variantId.toLowerCase().includes(q) ||
      (nickById.get(s.playerId) ?? "").includes(q))
    .map((s) => s.cardId)
    .sort();
}
