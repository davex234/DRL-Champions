/**
 * MATCH ROSTER RESOLUTION — conecta la COLECCIÓN con el simulador.
 *
 * Resuelve uids de cartas poseídas a sus piezas de dominio (catálogo) y delega la
 * conversión en el Player Mapper. También genera el rival a partir de jugadores
 * REALES del catálogo (nunca jugadores ficticios). Es la capa que toca el store y
 * el catálogo; el mapper se mantiene puro.
 */
import type { OwnedCard } from "@/domain/cards/types";
import { getCard, getPlayer, allPlayers } from "@/data/catalog";
import { cardsForPlayer } from "@/data/catalog";
import { getVariant } from "@/domain/cards/variants";
import type { MatchRosters, RosterEntry } from "@/sim";
import { buildRoster, type CardMappingInput } from "./playerMapper";

/** Resuelve una carta poseída a su insumo de mapeo, o null si ya no existe. */
export function resolveCardInput(owned: OwnedCard): CardMappingInput | null {
  const card = getCard(owned.cardId);
  if (!card) return null;
  const player = getPlayer(card.playerId);
  if (!player) return null;
  return { owned, card, player, variantLabel: getVariant(card.variantId).label };
}

export interface HomeRosterResult {
  roster: RosterEntry[];
  /** Ids de jugador presentes (para excluirlos del rival). */
  playerIds: Set<string>;
  /** uids que no se pudieron resolver (cartas inexistentes). */
  missing: string[];
}

/**
 * Construye el roster del entrenador a partir de los uids titulares de un equipo y
 * la colección actual. Mantiene el ORDEN de los titulares elegidos.
 */
export function buildHomeRoster(
  starterUids: string[],
  ownedCards: OwnedCard[],
  opts: { iglUid?: string } = {},
): HomeRosterResult {
  const byUid = new Map(ownedCards.map((o) => [o.uid, o]));
  const inputs: CardMappingInput[] = [];
  const missing: string[] = [];
  const playerIds = new Set<string>();

  for (const uid of starterUids) {
    const owned = byUid.get(uid);
    const input = owned ? resolveCardInput(owned) : null;
    if (!input) { missing.push(uid); continue; }
    inputs.push(input);
    playerIds.add(input.player.id);
  }

  return { roster: buildRoster(inputs, opts), playerIds, missing };
}

const RIVAL_PREFIX = "rival";

function hashSeed(seed: number, id: string): number {
  let h = (2166136261 ^ (seed >>> 0)) >>> 0;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Dificultad del rival: ajusta de qué banda de OVR se eligen sus jugadores. */
export type RivalDifficulty = "easy" | "normal" | "hard";

const bestOvr = (player: import("@/domain/cards/types").Player): number =>
  cardsForPlayer(player).reduce((m, c) => Math.max(m, c.ovr), 0);

/**
 * Genera un rival de CINCO jugadores REALES del catálogo, determinista por `seed` y
 * excluyendo a los jugadores del equipo del usuario. La `difficulty` elige la banda de
 * OVR: `easy` jugadores flojos, `hard` los mejores, `normal` cualquiera.
 */
export function buildRivalRoster(
  seed: number,
  exclude: Set<string> = new Set(),
  difficulty: RivalDifficulty = "normal",
): RosterEntry[] {
  const eligible = allPlayers().filter((p) => !exclude.has(p.id));
  const pool = eligible.length >= 5 ? eligible : allPlayers();

  // Banda de OVR según dificultad.
  const byOvr = [...pool].sort((a, b) => bestOvr(a) - bestOvr(b));
  const half = Math.ceil(byOvr.length / 2);
  const band =
    difficulty === "easy" ? byOvr.slice(0, Math.max(5, half)) :
    difficulty === "hard" ? byOvr.slice(Math.min(byOvr.length - 5, byOvr.length - half)) :
    byOvr;

  const chosen = [...band].sort((a, b) => hashSeed(seed, a.id) - hashSeed(seed, b.id)).slice(0, 5);

  const inputs: CardMappingInput[] = chosen.map((player) => {
    const cards = cardsForPlayer(player);
    const card = cards.reduce((best, c) => (c.ovr > best.ovr ? c : best), cards[0]);
    const owned: OwnedCard = { uid: `${RIVAL_PREFIX}-${player.id}`, cardId: card.id, obtainedAt: 0 };
    return { owned, card, player, variantLabel: getVariant(card.variantId).label };
  });

  return buildRoster(inputs);
}

/**
 * Atajo de un solo paso: equipo del usuario (titulares) + colección + semilla →
 * los dos rosters de la ronda (entrenado + rival real, sin solaparse).
 */
export function buildMatchRosters(
  starterUids: string[],
  ownedCards: OwnedCard[],
  seed: number,
  opts: { iglUid?: string; difficulty?: RivalDifficulty } = {},
): { rosters: MatchRosters; missing: string[] } {
  const home = buildHomeRoster(starterUids, ownedCards, { iglUid: opts.iglUid });
  const away = buildRivalRoster(seed, home.playerIds, opts.difficulty ?? "normal");
  return { rosters: { home: home.roster, away }, missing: home.missing };
}
