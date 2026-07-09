/**
 * COLLECTION BUILDER (Fase 4) — construye el `CollectionDef` del torneo (forma EXACTA de
 * domain/collections, source "tournament"): items = cartas generadas, awards = los 7 premios
 * estadísticos en forma `AwardWinner`. Solo DEFINICIÓN — no escribe en ningún store.
 */
import { getVariant } from "@/domain/cards/variants";
import type { CollectionDef, CollectionItem } from "@/domain/collections/types";
import type { AwardWinner, AwardKind } from "@/domain/collections/awards";
import type { AccoladeId } from "@/domain/cards/types";
import type { CardSpec } from "./types";

const slugify = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** Familias que son premios estadísticos del Collection Engine (AwardKind). */
const AWARD_FAMILY: Record<string, AwardKind> = {
  "tournament-rookie": "rookie",
  "tournament-clutch": "clutch",
  "tournament-top-acs": "top-acs",
  "tournament-top-rating": "top-rating",
  "tournament-top-hs": "top-hs",
  "tournament-top-kills": "top-kills",
  "tournament-top-assists": "top-assist",
};

export function buildCollection(opts: {
  tournamentId: string;
  tournamentName: string;
  specs: CardSpec[];
  nickOf: (playerId: string) => string | undefined;
}): CollectionDef {
  const { tournamentId, tournamentName, specs, nickOf } = opts;
  const items: CollectionItem[] = specs.map((s) => ({
    cardId: s.cardId,
    category: s.kind === "award" ? AWARD_FAMILY[s.family] ?? s.kind : s.kind,
    label: getVariant(s.variantId).label,
    playerId: s.playerId,
  }));
  const awards: AwardWinner[] = specs
    .filter((s) => AWARD_FAMILY[s.family])
    .map((s) => ({
      kind: AWARD_FAMILY[s.family],
      label: getVariant(s.variantId).label,
      accolade: s.family as AccoladeId,
      variantId: s.variantId,
      playerId: s.playerId,
      nick: nickOf(s.playerId),
      cardId: s.cardId,
      value: s.ovr,
    }));
  return {
    id: `col-${tournamentId}`,
    slug: slugify(tournamentName),
    name: tournamentName,
    source: "tournament",
    tournamentId,
    items,
    awards,
    reward: { credits: 500 },
  };
}
