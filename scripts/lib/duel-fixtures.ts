/**
 * FIXTURES DE MAZOS DE DUELOS para los runners de análisis (Fase 7).
 *
 * Construye mazos REALES a partir del catálogo publicado: mismo procedimiento que usan los tests
 * de la Fase 6, de modo que las cifras del informe y las de la suite hablan de los mismos mazos.
 *
 * Vive en `scripts/` a propósito: el dominio NO puede importar el catálogo ni la propiedad.
 */
import { CARDS } from "@/data/catalog";
import { CardRegistry } from "@/collection/registry";
import type { OwnedCard, RoleId } from "@/domain/cards/types";
import {
  createDuelDeck, validateDuelDeck, takeDeckSnapshot, makeDeckResolver, ownershipFromList,
  deckChecksum, DUEL_ROLES, type DuelDeckSnapshot,
} from "@/domain/cardgame";

const registry = new CardRegistry();

/** Instante fijo: los fixtures no leen el reloj. */
export const FIXTURE_NOW = 1_700_000_000_000;

/**
 * Mazo válido nº `block` (0, 1, 2…): las cartas de mayor OVR de cada rol, por bloques de dos.
 * `block` 0 da el mazo más fuerte, 1 el siguiente, etc.
 */
export function buildDeckSnapshot(block: number, id: string): DuelDeckSnapshot {
  const best = new Map<string, (typeof CARDS)[number]>();
  for (const c of CARDS) {
    const b = best.get(c.playerId);
    if (!b || c.ovr > b.ovr) best.set(c.playerId, c);
  }
  const byRole = new Map<RoleId, (typeof CARDS)[number][]>();
  for (const c of best.values()) {
    const p = registry.player(c.playerId);
    if (p) byRole.set(p.role, [...(byRole.get(p.role) ?? []), c]);
  }
  for (const [, arr] of byRole) arr.sort((x, y) => y.ovr - x.ovr || x.id.localeCompare(y.id));

  const picks = DUEL_ROLES.flatMap((r) => (byRole.get(r) ?? []).slice(block * 2, block * 2 + 2));
  const owned: OwnedCard[] = picks.map((c, i) => ({ uid: `${id}-u${i}`, cardId: c.id, obtainedAt: FIXTURE_NOW }));
  const deck = createDuelDeck({ id, name: `Mazo ${block + 1}`, cards: owned.map((o) => o.uid), now: FIXTURE_NOW });
  const v = validateDuelDeck(deck, makeDeckResolver(registry, ownershipFromList(owned)));
  if (!v.valid) throw new Error(`fixture ${id}: mazo inválido (${v.errors.map((e) => e.code).join(", ")})`);
  return takeDeckSnapshot(deck, v, FIXTURE_NOW)!;
}

/**
 * Copia de un snapshot con otra identidad de mazo pero EXACTAMENTE las mismas cartas.
 *
 * Es lo que permite el caso espejo real: dos jugadores distintos con el mismo mazo. Los `uid` se
 * reetiquetan porque son identidades de instancia poseída y no pueden coincidir entre dos dueños;
 * las estadísticas, el OVR y la composición son idénticos.
 */
export function mirrorSnapshot(snap: DuelDeckSnapshot, id: string): DuelDeckSnapshot {
  const cards = snap.cards.map((c) => ({ ...c, uid: `${id}::${c.uid}` }));
  // El checksum se recalcula con la MISMA función del dominio: nunca se copia el algoritmo.
  return { ...snap, deckId: id, cards, checksum: deckChecksum(cards) };
}

/** Los tres mazos del informe: M1 (más fuerte), M2, M3. */
export function buildDecks(): { M1: DuelDeckSnapshot; M2: DuelDeckSnapshot; M3: DuelDeckSnapshot } {
  return {
    M1: buildDeckSnapshot(0, "deck-m1"),
    M2: buildDeckSnapshot(1, "deck-m2"),
    M3: buildDeckSnapshot(2, "deck-m3"),
  };
}
