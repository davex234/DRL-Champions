/**
 * De una carta OBTENIDA (resultado de sobre) o de una definición poseída a lo que necesita el
 * planificador de mazo (Fase 25). Puro. Vive fuera de la ceremonia a propósito: la pantalla de
 * apertura no compone ni un serial ni un dato de carta (contrato de la Fase 21.2); aquí solo se
 * LEEN los del ejemplar acuñado por el servidor.
 */
import type { CardDef } from "@/domain/cards/types";
import { getPlayer } from "@/data/catalog";
import type { DeckCardLike } from "@/domain/cardgame/deckInsert";

export function toDeckCard(input: { uid: string; card: CardDef; serial?: number | null }): DeckCardLike | null {
  const p = getPlayer(input.card.playerId);
  if (!p || !input.card.combat) return null;
  return {
    uid: input.uid,
    cardId: input.card.id,
    playerId: input.card.playerId,
    nick: p.nick,
    role: input.card.role ?? p.role, // rol de la CARTA si lo imprime (catálogo diseñado); si no, el del jugador
    variantId: input.card.variantId,
    ovr: input.card.ovr,
    combat: input.card.combat,
    serial: input.serial ?? null,
  };
}
