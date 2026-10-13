/**
 * F79 · SELECTOR INTELIGENTE DE MATERIALES + AUTO-SELECCIÓN CONSERVADORA + VALIDACIÓN DEL SERVIDOR. PURO.
 *
 * Qué copia se puede ENTREGAR — la regla canónica de `domain/cards/protection` (F79.1), la misma del desguace y del
 * intercambio F73:
 *   · tuya y NO bloqueada por el mercado (`locked`) → si no, ni aparece;
 *   · fuera de TODOS tus equipos → si no, ni aparece;
 *   · ÚLTIMA COPIA: de cada carta te queda al menos UNA copia no bloqueada (cuántas puedes dar = desbloqueadas − 1);
 *   · PROTEGIDA (favorita o en tu vitrina) → aparece, pero la auto-selección NUNCA la coge y el servidor exige que la
 *     confirmes copia a copia. No es lo mismo que «última copia»: una favorita repetida se puede entregar si lo confirmas;
 *     tu última copia no se puede entregar nunca.
 *
 * Auto-selección (conservadora): por hueco, primero las cartas con MÁS copias repetidas, luego menor OVR (menor valor),
 * sin protegidas y sin pasar del tope de cada carta. Nunca consume nada: solo propone; consumir exige confirmar.
 *
 * Validación (el servidor la repite SIEMPRE, ignorando lo que diga el navegador): número exacto, sin repetidos, cada uid
 * entregable, tope por carta, protegidas confirmadas y un REPARTO válido de copias a huecos (emparejamiento bipartito:
 * una copia no puede contar para dos huecos).
 */
import type { CardDef } from "@/domain/cards/types";
import type { ConsumeSlot } from "./types";
import { copyProtection, type Protection } from "@/domain/cards/protection";
import { slotMatches } from "./requirements";

export type { Protection };
export interface OwnedCopy { uid: string; cardId: string; locked: boolean }

export interface CandidateCopy { uid: string; protectedBy: Protection[] }
export interface MaterialCandidate {
  cardId: string;
  ovr: number;
  playerId: string;
  variantId: string;
  /** Copias totales que tienes de esta carta. */
  copies: number;
  /** Cuántas se pueden entregar como máximo (desbloqueadas − 1, y solo de las libres). */
  usable: number;
  /** Copias libres (no bloqueadas, fuera de equipos), en orden estable; cada una con su protección. */
  free: CandidateCopy[];
}
export interface SlotMaterials {
  index: number;
  slot: ConsumeSlot;
  need: number;
  candidates: MaterialCandidate[];
  /** Copias entregables SIN tocar protegidas (lo que la auto-selección puede usar). */
  availableUnprotected: number;
  /** Copias entregables contando protegidas. */
  availableTotal: number;
}

export interface MaterialInput {
  owned: readonly OwnedCopy[];
  inDeck: ReadonlySet<string>;
  favoriteCardIds: ReadonlySet<string>;
  showcaseUids: ReadonlySet<string>;
  slots: readonly ConsumeSlot[];
  cardOf: (id: string) => CardDef | undefined;
  teamOf: (def: Pick<CardDef, "playerId"> & { team?: string }) => string;
}

function candidatesByCard(inp: Omit<MaterialInput, "slots">): Map<string, MaterialCandidate> {
  const byCard = new Map<string, OwnedCopy[]>();
  for (const o of inp.owned) { const l = byCard.get(o.cardId); if (l) l.push(o); else byCard.set(o.cardId, [o]); }
  const out = new Map<string, MaterialCandidate>();
  for (const [cardId, copies] of byCard) {
    const def = inp.cardOf(cardId);
    if (!def) continue;
    const unlocked = copies.filter((c) => !c.locked).length;
    const free = copies.filter((c) => !c.locked && !inp.inDeck.has(c.uid)).map((c) => c.uid).sort()
      .map((uid) => ({ uid, protectedBy: copyProtection(uid, cardId, { favoriteCardIds: inp.favoriteCardIds, showcaseUids: inp.showcaseUids, inDeck: inp.inDeck }) }));
    const usable = Math.min(free.length, Math.max(0, unlocked - 1));
    if (usable > 0) out.set(cardId, { cardId, ovr: def.ovr, playerId: def.playerId, variantId: def.variantId, copies: copies.length, usable, free });
  }
  return out;
}

const unprotectedUsable = (c: MaterialCandidate) => Math.min(c.usable, c.free.filter((f) => f.protectedBy.length === 0).length);

export function buildMaterials(inp: MaterialInput): SlotMaterials[] {
  const all = candidatesByCard(inp);
  return inp.slots.map((slot, index) => {
    const candidates = [...all.values()].filter((c) => {
      const def = inp.cardOf(c.cardId);
      return !!def && slotMatches(def, slot, inp.teamOf);
    }).sort((a, b) => b.copies - a.copies || a.ovr - b.ovr || a.cardId.localeCompare(b.cardId));
    return {
      index, slot, need: slot.qty, candidates,
      availableUnprotected: candidates.reduce((s, c) => s + unprotectedUsable(c), 0),
      availableTotal: candidates.reduce((s, c) => s + c.usable, 0),
    };
  });
}

export interface AutoFill { uids: string[]; bySlot: string[][]; missing: number }

/**
 * Propuesta conservadora: nunca protegidas, nunca la última copia, duplicados primero y menor OVR primero. El tope por
 * carta se COMPARTE entre huecos (una carta que encaja en dos huecos no puede dar más de lo que permite su última copia).
 */
export function autoFill(materials: readonly SlotMaterials[]): AutoFill {
  const usedPerCard = new Map<string, number>();
  const usedUids = new Set<string>();
  const bySlot: string[][] = [];
  let missing = 0;
  for (const m of materials) {
    const picks: string[] = [];
    for (const c of m.candidates) {
      if (picks.length >= m.need) break;
      for (const f of c.free) {
        if (picks.length >= m.need) break;
        if (f.protectedBy.length > 0 || usedUids.has(f.uid)) continue;
        if ((usedPerCard.get(c.cardId) ?? 0) >= c.usable) break;
        picks.push(f.uid); usedUids.add(f.uid); usedPerCard.set(c.cardId, (usedPerCard.get(c.cardId) ?? 0) + 1);
      }
    }
    missing += m.need - picks.length;
    bySlot.push(picks);
  }
  return { uids: bySlot.flat(), bySlot, missing };
}

export type SelectionError = "WRONG_COUNT" | "DUPLICATE_INPUT" | "NOT_ELIGIBLE" | "LAST_COPY" | "PROTECTED" | "SLOT_MISMATCH";

/** Revalidación del SERVIDOR. `confirmProtected` = las copias protegidas que el jugador confirmó entregar. */
export function validateSelection(
  selected: readonly string[], materials: readonly SlotMaterials[], confirmProtected: readonly string[] = [],
): { ok: true; cardIdByUid: Record<string, string>; protectedUsed: string[] } | { ok: false; error: SelectionError } {
  const total = materials.reduce((s, m) => s + m.need, 0);
  if (selected.length !== total) return { ok: false, error: "WRONG_COUNT" };
  if (new Set(selected).size !== selected.length) return { ok: false, error: "DUPLICATE_INPUT" };
  const info = new Map<string, { cand: MaterialCandidate; copy: CandidateCopy }>();
  for (const m of materials) for (const c of m.candidates) for (const f of c.free) info.set(f.uid, { cand: c, copy: f });
  const perCard = new Map<string, number>();
  const confirmed = new Set(confirmProtected);
  const protectedUsed: string[] = [];
  const cardIdByUid: Record<string, string> = {};
  for (const u of selected) {
    const i = info.get(u);
    if (!i) return { ok: false, error: "NOT_ELIGIBLE" };
    perCard.set(i.cand.cardId, (perCard.get(i.cand.cardId) ?? 0) + 1);
    if ((perCard.get(i.cand.cardId) ?? 0) > i.cand.usable) return { ok: false, error: "LAST_COPY" };
    if (i.copy.protectedBy.length > 0) { if (!confirmed.has(u)) return { ok: false, error: "PROTECTED" }; protectedUsed.push(u); }
    cardIdByUid[u] = i.cand.cardId;
  }
  // Reparto copias → huecos (Kuhn): cada hueco recibe exactamente su `need`, y cada copia va a un hueco que acepte su carta.
  const positions: number[] = materials.flatMap((m) => Array.from({ length: m.need }, () => m.index));
  const fits = (uid: string, slotIdx: number) => materials[slotIdx].candidates.some((c) => c.cardId === cardIdByUid[uid]);
  const owner: (string | null)[] = positions.map(() => null);
  const tryAssign = (uid: string, seen: boolean[]): boolean => {
    for (let p = 0; p < positions.length; p++) {
      if (seen[p] || !fits(uid, positions[p])) continue;
      seen[p] = true;
      if (owner[p] === null || tryAssign(owner[p]!, seen)) { owner[p] = uid; return true; }
    }
    return false;
  };
  for (const u of selected) if (!tryAssign(u, positions.map(() => false))) return { ok: false, error: "SLOT_MISMATCH" };
  return { ok: true, cardIdByUid, protectedUsed };
}
