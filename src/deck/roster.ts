/**
 * ROSTER HANDOFF (Collection Fase 3/7) — el ÚNICO puente Deck → Gameplay.
 *
 * NO construye rosters a mano: delega en el Player Mapper existente (`@/lib/match`) que ya produce los
 * `MatchRosters` que consume el Match Engine. Aquí solo se traduce la SELECCIÓN del deck (titulares +
 * IGL designado) a los parámetros del mapper. El Deck Builder no juega; el Gameplay sigue jugando.
 *
 *   Collection → Deck → deckToRosters() → Player Mapper → MatchRosters → Match Engine
 */
import type { OwnedCard } from "@/domain/cards/types";
import type { MatchRosters } from "@/sim";
import { buildHomeRoster, buildMatchRosters, type HomeRosterResult, type RivalDifficulty } from "@/lib/match/roster";
import type { Deck } from "./types";

/** Roster del equipo (5 titulares) del deck, honrando el IGL designado. */
export function deckToHomeRoster(deck: Deck, ownedCards: OwnedCard[]): HomeRosterResult {
  return buildHomeRoster(deck.starters, ownedCards, { iglUid: deck.iglUid });
}

/** Los dos rosters de una partida (equipo del deck + rival real), listos para `makeMatchConfig`. */
export function deckToRosters(
  deck: Deck,
  ownedCards: OwnedCard[],
  seed: number,
  difficulty: RivalDifficulty = "normal",
): { rosters: MatchRosters; missing: string[] } {
  return buildMatchRosters(deck.starters, ownedCards, seed, { iglUid: deck.iglUid, difficulty });
}
