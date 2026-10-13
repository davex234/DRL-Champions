/**
 * HISTORY — historial editorial completo e inmutable: quién, cuándo, estado anterior, estado
 * nuevo, comentario, motivo y GenerationId. Secuencia monótona (orden total determinista con
 * reloj lógico). Solo constructores y consultas puras; nunca muta un caso.
 */
import type { DecisionMeta, EditorialAction, EditorialCase, EditorialEvent, EditorialState } from "./types";
import { ns, td } from "@/i18n/runtime";

const t = ns("editorial");

/** Siguiente número de secuencia del caso. */
export const nextSeq = (c: Pick<EditorialCase, "history">): number =>
  c.history.length ? c.history[c.history.length - 1].seq + 1 : 1;

export function makeEvent(
  c: Pick<EditorialCase, "history" | "generationId">,
  action: EditorialAction | "submit",
  meta: DecisionMeta,
  card?: { cardId: string; from: EditorialState; to: EditorialState },
): EditorialEvent {
  return {
    seq: nextSeq(c),
    at: meta.at,
    actor: meta.actor,
    action,
    cardId: card?.cardId,
    from: card?.from,
    to: card?.to,
    comment: meta.comment,
    reason: meta.reason,
    generationId: c.generationId,
  };
}

/* ── Consultas ────────────────────────────────────────────────────────────── */

export const historyForCard = (c: EditorialCase, cardId: string): EditorialEvent[] =>
  c.history.filter((e) => e.cardId === cardId);

export const historyByActor = (c: EditorialCase, actor: string): EditorialEvent[] =>
  c.history.filter((e) => e.actor === actor);

export const lastEventForCard = (c: EditorialCase, cardId: string): EditorialEvent | undefined => {
  for (let i = c.history.length - 1; i >= 0; i--) if (c.history[i].cardId === cardId) return c.history[i];
  return undefined;
};

/**
 * Auditoría de integridad: cada evento con carta debe encadenar con el anterior de esa carta
 * y toda la secuencia debe ser estrictamente creciente. Devuelve los problemas encontrados
 * (vacío = historial íntegro; lo usa el verify para "cero estados imposibles").
 */
export function auditHistory(c: EditorialCase): string[] {
  const issues: string[] = [];
  const lastState = new Map<string, EditorialState>();
  let prevSeq = 0;
  for (const e of c.history) {
    if (e.seq <= prevSeq) issues.push(t("seq no monótona: {seq} tras {prevSeq}", { seq: e.seq, prevSeq }));
    prevSeq = e.seq;
    if (e.generationId !== c.generationId) issues.push(t("evento {seq}: generationId ajeno", { seq: e.seq }));
    if (!e.cardId) continue;
    const prev = lastState.get(e.cardId);
    if (prev !== undefined && e.from !== prev) issues.push(t("carta {cardId}: evento {seq} parte de \"{from}\" pero estaba en \"{prev}\"", { cardId: e.cardId, seq: e.seq, from: e.from, prev }));
    if (e.to) lastState.set(e.cardId, e.to);
  }
  // El estado final del historial debe coincidir con el estado vigente del caso.
  for (const [cardId, st] of lastState) {
    if (c.states[cardId] !== st) issues.push(t("carta {cardId}: historial termina en \"{st}\" pero el estado vigente es \"{v}\"", { cardId: td(cardId), st, v: c.states[cardId] }));
  }
  return issues;
}
