/**
 * DEL SOBRE AL MAZO (Fase 25) — planificar la entrada de UNA carta en un mazo de duelo. PURO.
 *
 * No cambia ni una regla: reutiliza la composición canónica (`DUEL_COMPOSITION`, 2 por rol,
 * `DUEL_DECK_SIZE` 10, `ALLOW_SAME_PLAYER_TWICE`) y deja la validación final a
 * `validateDuelDeck` / al servidor (`saveDeck` comprueba propiedad y composición). Lo que hace
 * es responder a la pregunta del jugador que acaba de abrir un sobre: «¿puedo meter esta
 * carta, y a cambio de qué?».
 *
 *   free      → hay hueco de su rol: se añade sin quitar nada.
 *   replace   → su rol está lleno (o el mazo): se ofrece a quién sustituir, con comparación.
 *   upgrade   → el mismo JUGADOR ya está en el mazo con otra variante: solo puede sustituirla
 *               (la regla de jugador único no se toca).
 *   blocked   → ya está esa instancia, o no hay nada que hacer.
 *
 * Ninguna decisión se toma sola: sustituir exige confirmación en la interfaz.
 */
import type { CombatStats, RoleId, VariantId } from "./types";
import { ALLOW_SAME_PLAYER_TWICE } from "./deck";
import { DUEL_COMPOSITION, DUEL_DECK_SIZE } from "./types";
import { getVariant } from "@/domain/cards/variants";
import { ns, td } from "@/i18n/runtime";

const t = ns("cardgame");

/** Lo mínimo que hace falta saber de una carta para planificar (DTO del mazo o carta abierta). */
export interface DeckCardLike {
  uid: string;
  cardId: string;
  playerId: string;
  nick: string;
  role: RoleId;
  variantId: VariantId;
  ovr: number;
  combat: CombatStats;
  serial?: number | null;
}

export type InsertKind = "free" | "replace" | "upgrade" | "blocked";

export interface StatDelta { key: keyof CombatStats | "ovr" | "rank"; label: string; next: number; current: number; delta: number }

export interface ReplaceOption {
  current: DeckCardLike;
  /** Comparación NUEVA vs ACTUAL, solo con cifras que existen: OVR, trío de combate, rareza. */
  compare: StatDelta[];
  /** Resumen honesto: cuántas cifras suben y cuántas bajan (sin porcentajes inventados). */
  up: number;
  down: number;
}

export interface InsertPlan {
  kind: InsertKind;
  role: RoleId;
  reason: string;
  /** Cartas del mazo a las que podría sustituir (vacío si `free`/`blocked`). */
  options: ReplaceOption[];
  /** uids resultantes si se aplica con `replaceUid` (o sin él, si es `free`). */
  apply: (replaceUid?: string) => string[] | null;
}

const COMBAT_LABEL: Record<keyof CombatStats, string> = { stronghold: "SH", gamesense: "GS", entryfrag: "EF" };

export function compareCards(next: DeckCardLike, current: DeckCardLike): StatDelta[] {
  const rows: StatDelta[] = [
    { key: "ovr", label: "OVR", next: next.ovr, current: current.ovr, delta: next.ovr - current.ovr },
  ];
  for (const k of Object.keys(COMBAT_LABEL) as (keyof CombatStats)[]) {
    const n = next.combat?.[k] ?? 0; const c = current.combat?.[k] ?? 0;
    rows.push({ key: k, label: COMBAT_LABEL[k], next: n, current: c, delta: n - c });
  }
  const rn = getVariant(next.variantId).rank; const rc = getVariant(current.variantId).rank;
  rows.push({ key: "rank", label: t("Rareza"), next: rn, current: rc, delta: rn - rc });
  return rows;
}

function option(next: DeckCardLike, current: DeckCardLike): ReplaceOption {
  const compare = compareCards(next, current);
  return { current, compare, up: compare.filter((r) => r.delta > 0).length, down: compare.filter((r) => r.delta < 0).length };
}

export function planDeckInsert(deck: { cards: DeckCardLike[] }, candidate: DeckCardLike): InsertPlan {
  const role = candidate.role;
  const cards = deck.cards;
  const uids = cards.map((c) => c.uid);
  const withReplacement = (replaceUid?: string): string[] | null => {
    if (!replaceUid) return uids.includes(candidate.uid) ? null : [...uids, candidate.uid];
    if (!uids.includes(replaceUid)) return null;
    return uids.map((u) => (u === replaceUid ? candidate.uid : u));
  };

  if (uids.includes(candidate.uid)) {
    return { kind: "blocked", role, reason: t("Esta carta ya está en el mazo."), options: [], apply: () => null };
  }
  const sameCard = cards.find((c) => c.cardId === candidate.cardId);
  const samePlayer = cards.find((c) => c.playerId === candidate.playerId);
  if (sameCard || (!ALLOW_SAME_PLAYER_TWICE && samePlayer)) {
    const cur = (sameCard ?? samePlayer)!;
    return {
      kind: "upgrade", role,
      reason: t("{nick} ya está en el mazo con otra versión. Solo puedes sustituirla.", { nick: candidate.nick }),
      options: [option(candidate, cur)],
      apply: (replaceUid) => (replaceUid === cur.uid ? withReplacement(cur.uid) : null),
    };
  }
  const inRole = cards.filter((c) => c.role === role);
  const roleFull = inRole.length >= (DUEL_COMPOSITION[role] ?? 0);
  const deckFull = cards.length >= DUEL_DECK_SIZE;
  if (!roleFull && !deckFull) {
    return { kind: "free", role, reason: t("Hay hueco de {role}.", { role: td(role) }), options: [], apply: () => withReplacement() };
  }
  const pool = roleFull ? inRole : cards;
  return {
    kind: "replace", role,
    reason: roleFull ? t("Los {v} huecos de {role} están ocupados.", { v: DUEL_COMPOSITION[role], role: td(role) }) : t("El mazo está completo."),
    options: pool.map((c) => option(candidate, c)).sort((a, b) => b.up - b.down - (a.up - a.down)),
    apply: (replaceUid) => (replaceUid && pool.some((c) => c.uid === replaceUid) ? withReplacement(replaceUid) : null),
  };
}
