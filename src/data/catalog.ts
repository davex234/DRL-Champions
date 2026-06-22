import type { CardDef, Player, VariantId, AccoladeId } from "@/domain/cards/types";
import { applyStatBoost, computeOvr } from "@/domain/cards/ovr";
import { getVariant, baseMetalForOvr } from "@/domain/cards/variants";
import { PLAYERS } from "./players";

/** Mapea cada accolade a la(s) variante(s) que desbloquea. */
function variantsForAccolade(acc: AccoladeId, player: Player): VariantId[] {
  const regionKey = player.region.toLowerCase() as "emea" | "americas" | "pacific" | "china";
  switch (acc) {
    case "masters":
      return ["masters"];
    case "champions":
      return ["champions"];
    case "ewc":
      return ["ewc"];
    case "regional-winner":
      return [`${regionKey}-winner` as VariantId];
    case "regional-mvp":
      return [`${regionKey}-mvp` as VariantId];
    case "masters-winner":
      return ["masters", "masters-winner"];
    case "masters-mvp":
      return ["masters", "masters-mvp"];
    case "champions-winner":
      return ["champions", "champions-winner"];
    case "champions-mvp":
      return ["champions", "champions-mvp"];
    case "ewc-winner":
      return ["ewc", "ewc-winner"];
    case "ewc-mvp":
      return ["ewc", "ewc-mvp"];
    case "prime":
      return ["prime"];
    case "game-changers":
      return ["game-changers"];
    case "icon":
      return ["icon-series"];
    case "hall-of-fame":
      return ["hall-of-fame"];
    default:
      return [];
  }
}

function buildCard(player: Player, variantId: VariantId): CardDef {
  const variant = getVariant(variantId);
  const stats = applyStatBoost(player.stats, variant.statBoost);
  return {
    id: `${player.id}__${variantId}`,
    playerId: player.id,
    variantId,
    stats,
    ovr: computeOvr(stats),
  };
}

/**
 * Genera TODAS las cartas de un jugador (base por metal + regional + variantes
 * de palmarés). Este es el "generador automático": añadir un jugador y obtener
 * todas sus cartas se reduce a llamar a esta función.
 */
export function cardsForPlayer(player: Player): CardDef[] {
  const baseOvr = computeOvr(player.stats);
  const variantIds = new Set<VariantId>();
  variantIds.add(baseMetalForOvr(baseOvr));
  variantIds.add(player.region.toLowerCase() as VariantId);
  for (const acc of player.accolades) {
    for (const v of variantsForAccolade(acc, player)) variantIds.add(v);
  }
  return [...variantIds].map((variantId) => buildCard(player, variantId));
}

function buildCatalog(players: Player[]): CardDef[] {
  const cards: CardDef[] = [];
  const seen = new Set<string>();
  for (const player of players) {
    for (const card of cardsForPlayer(player)) {
      if (!seen.has(card.id)) {
        seen.add(card.id);
        cards.push(card);
      }
    }
  }
  return cards;
}

/**
 * Catálogo del juego. Es DINÁMICO: arranca con los datos semilla y se
 * reconstruye cuando el panel de administración importa/edita jugadores
 * (vía `rebuildCatalog`). Se exportan como `let` para que los `import`
 * (bindings vivos) reflejen siempre el catálogo actual.
 */
export let CARDS: CardDef[] = buildCatalog(PLAYERS);
export let TOTAL_CARDS: number = CARDS.length;

let CARD_BY_ID = new Map(CARDS.map((c) => [c.id, c]));
let PLAYER_BY_ID = new Map(PLAYERS.map((p) => [p.id, p]));

/** Reconstruye el catálogo a partir de un roster efectivo (semilla + importados). */
export function rebuildCatalog(players: Player[]): void {
  CARDS = buildCatalog(players);
  TOTAL_CARDS = CARDS.length;
  CARD_BY_ID = new Map(CARDS.map((c) => [c.id, c]));
  PLAYER_BY_ID = new Map(players.map((p) => [p.id, p]));
}

export function getCard(id: string): CardDef | undefined {
  return CARD_BY_ID.get(id);
}

export function getPlayer(id: string): Player | undefined {
  return PLAYER_BY_ID.get(id);
}

export function allPlayers(): Player[] {
  return [...PLAYER_BY_ID.values()];
}

export function cardsByVariant(variantId: VariantId): CardDef[] {
  return CARDS.filter((c) => c.variantId === variantId);
}

export function totalCards(): number {
  return CARDS.length;
}
