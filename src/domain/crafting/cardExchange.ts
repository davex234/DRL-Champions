/**
 * F73 · INTERCAMBIO DE CARTAS — qué copias se pueden entregar y qué carta sale. PURO.
 *
 * Una copia se puede entregar si (las MISMAS reglas que el desguace, más la de los equipos):
 *   (F79 · «te queda al menos una» = una copia NO bloqueada, igual que el desguace de 0060: una copia en venta en el
 *    mercado no cuenta como la que conservas, porque puede venderse.)
 *   · es tuya y no está bloqueada (`locked`: una publicación del mercado la reserva);
 *   · no está en NINGUNO de tus equipos (el desguace hoy no lo mira; el crafteo sí, para no romper un equipo guardado);
 *   · es de la clase de entrada de la receta (`packCardClass`, canónica);
 *   · te queda al menos UNA copia de esa carta después (se intercambian DUPLICADOS, como en el desguace: copias − 1).
 *
 * La salida la decide SOLO el servidor: carta uniforme de la clase de salida, con un entero aleatorio criptográfico
 * que pasa el servidor. El cliente no manda carta, jugador, OVR ni semilla.
 */
import { packCardClass, type PackCardClass } from "@/domain/packs/packClass";
import type { CardDef } from "@/domain/cards/types";

export interface OwnedCopy { uid: string; cardId: string; locked: boolean }

export interface ExchangeCandidate {
  cardId: string;
  /** Copias de esa carta que tienes en total. */
  copies: number;
  /** De ellas, cuántas se pueden entregar (≤ copias − 1, sin bloqueadas ni en equipos). */
  available: number;
  /**
   * uids que se pueden entregar (libres: ni bloqueados ni en equipos), en orden estable. Puede haber MÁS que
   * `available`: cualquiera de ellos vale, siempre que de esa carta no se entreguen más de `available` (queda una).
   */
  uids: string[];
}

export function exchangeCandidates(
  owned: readonly OwnedCopy[], inDeck: ReadonlySet<string>, inputClass: PackCardClass, cardOf: (id: string) => CardDef | undefined,
): ExchangeCandidate[] {
  const byCard = new Map<string, OwnedCopy[]>();
  for (const o of owned) {
    const list = byCard.get(o.cardId);
    if (list) list.push(o); else byCard.set(o.cardId, [o]);
  }
  const out: ExchangeCandidate[] = [];
  for (const [cardId, copies] of byCard) {
    const def = cardOf(cardId);
    if (!def || packCardClass(def) !== inputClass) continue;
    const free = copies.filter((c) => !c.locked && !inDeck.has(c.uid)).map((c) => c.uid).sort();
    const unlocked = copies.filter((c) => !c.locked).length;
    const available = Math.min(free.length, unlocked - 1);
    if (available > 0) out.push({ cardId, copies: copies.length, available, uids: free });
  }
  return out.sort((a, b) => a.cardId.localeCompare(b.cardId));
}

export type SelectionError = "WRONG_COUNT" | "DUPLICATE_INPUT" | "NOT_ELIGIBLE" | "LAST_COPY";

/** Revalida la selección del cliente contra lo que el servidor sabe que se puede entregar. */
export function checkSelection(selected: readonly string[], qty: number, candidates: readonly ExchangeCandidate[]): { ok: true; cardIdByUid: Record<string, string> } | { ok: false; error: SelectionError } {
  if (selected.length !== qty) return { ok: false, error: "WRONG_COUNT" };
  if (new Set(selected).size !== selected.length) return { ok: false, error: "DUPLICATE_INPUT" };
  const ownerOf = new Map<string, ExchangeCandidate>();
  for (const c of candidates) for (const u of c.uids) ownerOf.set(u, c);
  const perCard = new Map<string, number>();
  const cardIdByUid: Record<string, string> = {};
  for (const u of selected) {
    const c = ownerOf.get(u);
    if (!c) return { ok: false, error: "NOT_ELIGIBLE" };
    perCard.set(c.cardId, (perCard.get(c.cardId) ?? 0) + 1);
    if ((perCard.get(c.cardId) ?? 0) > c.available) return { ok: false, error: "LAST_COPY" };
    cardIdByUid[u] = c.cardId;
  }
  return { ok: true, cardIdByUid };
}

/** Pool de salida: todas las cartas del catálogo de esa clase, en orden estable. */
export const outputPool = (cards: readonly CardDef[], outputClass: PackCardClass): CardDef[] =>
  cards.filter((c) => packCardClass(c) === outputClass).sort((a, b) => a.id.localeCompare(b.id));

/** La carta que sale, dado un entero aleatorio del SERVIDOR en [0, pool.length). */
export function pickOutput(pool: readonly CardDef[], roll: number): CardDef | null {
  if (pool.length === 0 || !Number.isInteger(roll) || roll < 0 || roll >= pool.length) return null;
  return pool[roll];
}
