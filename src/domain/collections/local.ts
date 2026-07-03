/**
 * DRL COLLECTION ENGINE — proveedor LOCAL (offline).
 *
 * Genera una colección por evento (`src/data/events.ts`) a partir del catálogo:
 * los `items` son las cartas existentes de la familia del evento (masters /
 * champions / ewc) y los `awards` se calculan desde `player.metrics`. Funciona
 * 100% sin Supabase. Las cartas-variante premio dedicadas (top-acs, etc.) las
 * acuña solo el motor de torneos real; en local los premios son destacados.
 */
import type { VariantId } from "@/domain/cards/types";
import { CARDS, getPlayer } from "@/data/catalog";
import { getVariant } from "@/domain/cards/variants";
import { computeOvr } from "@/domain/cards/ovr";
import { EVENTS } from "@/data/events";
import type { CollectionDef, CollectionItem } from "./types";
import { computeAwards, type AwardPlayer } from "./awards";

/** Variantes que componen la familia de cada tipo de evento. */
const FAMILY: Record<string, VariantId[]> = {
  masters: ["masters", "masters-winner", "masters-mvp"],
  champions: ["champions", "champions-winner", "champions-mvp"],
  ewc: ["ewc", "ewc-winner", "ewc-mvp"],
};

function categoryFor(variantId: VariantId): string {
  if (variantId.endsWith("-mvp")) return "mvp";
  if (variantId.endsWith("-winner")) return "champion";
  return "player";
}

export function localCollections(): CollectionDef[] {
  return EVENTS.map((ev): CollectionDef => {
    const family = FAMILY[ev.type] ?? [];
    const cards = CARDS.filter((c) => family.includes(c.variantId));

    const items: CollectionItem[] = cards.map((c) => {
      const p = getPlayer(c.playerId);
      return {
        cardId: c.id,
        category: categoryFor(c.variantId),
        playerId: c.playerId,
        label: `${p?.nick ?? c.playerId} · ${getVariant(c.variantId).label}`,
      };
    });

    const playerIds = [...new Set(cards.map((c) => c.playerId))];
    const awardPlayers: AwardPlayer[] = playerIds.map((id) => {
      const p = getPlayer(id);
      const m = p?.metrics;
      return {
        playerId: id, nick: p?.nick, teamId: p?.team,
        rating: p ? computeOvr(p.stats) / 100 : undefined,
        acs: m?.acs, kills: m?.kills, assists: m?.assists, hsPct: m?.hsPct, clutch: m?.clutches,
      };
    });

    return {
      id: `local-${ev.id}`,
      slug: ev.id,
      name: ev.name,
      source: "local",
      tier: ev.type,
      items,
      awards: computeAwards(awardPlayers),
      reward: { credits: 8000, tokens: 150, packId: ev.packIds[0], packCount: 2 },
    };
  }).filter((c) => c.items.length > 0);
}
