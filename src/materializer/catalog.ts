/**
 * CATALOG PATCH BUILDER (Fase 5) — SOLO diferencias, jamás rebuild completo: para cada
 * jugador AFECTADO predice su catálogo (cardsForPlayer, el generador oficial reutilizado) y
 * lo compara con el catálogo actual inyectado. add/update/remove incrementales. Determinista.
 */
import { cardsForPlayer } from "@/data/catalog";
import type { CardDef } from "@/domain/cards/types";
import type { CardGenerationResult } from "@/card-generator";
import type { PlayerUpserts } from "./identity";
import type { CatalogPatch } from "./types";

const sameCard = (a: CardDef, b: CardDef): boolean =>
  a.ovr === b.ovr && JSON.stringify(a.stats) === JSON.stringify(b.stats);

export function buildCatalogPatch(
  gen: CardGenerationResult,
  upserts: PlayerUpserts,
  existingCards: CardDef[],
  changedPlayerIds: Set<string>,
): CatalogPatch {
  const existingById = new Map(existingCards.map((c) => [c.id, c]));
  const affected = [...changedPlayerIds].sort();

  const cardsAdd: CardDef[] = [];
  const cardsUpdate: CardDef[] = [];
  for (const playerId of affected) {
    const after = upserts.playerAfter.get(playerId);
    if (!after) continue;
    for (const card of cardsForPlayer(after)) {
      const existing = existingById.get(card.id);
      if (!existing) cardsAdd.push(card);
      else if (!sameCard(existing, card)) cardsUpdate.push(card);
    }
  }
  cardsAdd.sort((a, b) => a.id.localeCompare(b.id));
  cardsUpdate.sort((a, b) => a.id.localeCompare(b.id));

  // Retiradas: solo si existen en el catálogo actual (nunca se inventa un remove).
  const cardsRemove = gen.retired
    .map((r) => r.cardId)
    .filter((id): id is string => !!id && existingById.has(id))
    .sort();

  return {
    playersAdd: upserts.playersAdd,
    playersUpdate: upserts.playersUpdate,
    cardsAdd,
    cardsUpdate,
    cardsRemove,
    affectedPlayers: affected,
    fullRebuild: false,
  };
}
