/**
 * CARD VIEW — modelo de presentación de una carta poseída para la UI del
 * Roster Builder y la pantalla del entrenador. Resuelve uid → datos legibles
 * (nick, rol, OVR, rareza, foto) en un único sitio.
 */
import type { OwnedCard, RoleId } from "@/domain/cards/types";
import type { RarityPalette } from "@/domain/cards/types";
import { getCard, getPlayer } from "@/data/catalog";
import { getVariant } from "@/domain/cards/variants";

export interface CardView {
  uid: string;
  cardId: string;
  playerId: string;
  nick: string;
  role: RoleId;
  team: string;
  teamTag: string;
  region: string;
  ovr: number;
  variantId: string;
  variantLabel: string;
  rank: number;
  serial?: number;
  /** Retrato del JUGADOR (no la carta). */
  image: string;
  /** FASE 51.1 · la CARTA: el WebP del catálogo de ESTE `cardId` (jugador + edición exactos). */
  art: string;
  palette: RarityPalette;
}

/** Enriquece una carta poseída para mostrarla; null si ya no existe en catálogo. */
export function cardView(owned: OwnedCard): CardView | null {
  const card = getCard(owned.cardId);
  if (!card) return null;
  const player = getPlayer(card.playerId);
  if (!player) return null;
  const variant = getVariant(card.variantId);
  return {
    uid: owned.uid,
    cardId: card.id,
    playerId: player.id,
    nick: player.nick,
    role: card.role ?? player.role,
    team: player.team,
    teamTag: player.teamTag,
    region: player.region,
    ovr: card.ovr,
    variantId: card.variantId,
    variantLabel: variant.label,
    rank: variant.rank,
    serial: owned.serial,
    image: player.image ?? `/players/${player.id}.png`,
    art: card.image ?? `/cards/${card.id}.webp`,
    palette: variant.palette,
  };
}

/** Enriquece y ordena por OVR desc; descarta cartas inexistentes. */
export function cardViews(owned: OwnedCard[]): CardView[] {
  return owned
    .map(cardView)
    .filter((v): v is CardView => v !== null)
    .sort((a, b) => b.ovr - a.ovr);
}
