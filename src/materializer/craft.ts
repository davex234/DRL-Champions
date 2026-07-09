/**
 * CRAFT PATCH (Fase 5) — SOLO ENLACES a las recetas EXISTENTES (`RECIPES` de datos): jamás
 * crea recetas. Por carta: recetas cuyo filtro estático de entrada satisface su variante
 * (bucket/grupo/variantes/serializada; las condiciones de propiedad como duplicatesOnly se
 * resuelven en runtime por el Craft Engine, no aquí). Rutas de upgrade/evolución dentro del
 * catálogo PREDICHO del jugador, con la receta que realiza cada salto. Determinista.
 */
import { RECIPES } from "@/data/recipes";
import { getVariant } from "@/domain/cards/variants";
import { bucketForRank } from "@/domain/packs/types";
import { BUCKET_INDEX } from "@/domain/packs/pool";
import type { CardDef, Player } from "@/domain/cards/types";
import type { InputMatch, Recipe } from "@/craft/types";
import { cardsForPlayer } from "@/data/catalog";
import type { MaterializedCard, CraftPatch, CraftUpgradePath } from "./types";

/** Criterios ESTÁTICOS del InputMatch (los dependientes de propiedad se ignoran aquí). */
function staticMatch(input: InputMatch, card: CardDef): boolean {
  const v = getVariant(card.variantId);
  const bucket = bucketForRank(v.rank);
  if (input.minBucket && BUCKET_INDEX[bucket] < BUCKET_INDEX[input.minBucket]) return false;
  if (input.maxBucket && BUCKET_INDEX[bucket] > BUCKET_INDEX[input.maxBucket]) return false;
  if (input.groups && !input.groups.includes(v.group)) return false;
  if (input.variants && !input.variants.includes(card.variantId)) return false;
  if (input.serialized !== undefined && v.serialized !== input.serialized) return false;
  return true;
}

/** Receta que realiza el salto hacia una variante destino (nextRank/group), si existe. */
function viaFor(recipe: Recipe, from: CardDef, to: CardDef): boolean {
  const fromRank = getVariant(from.variantId).rank;
  const toVariant = getVariant(to.variantId);
  if (toVariant.rank <= fromRank) return false;
  if (recipe.output.mode === "nextRank") return true;
  if (recipe.output.mode === "group") return toVariant.group === recipe.output.group;
  return false;
}

export function buildCraftPatch(cards: MaterializedCard[], playerAfter: Map<string, Player>): CraftPatch {
  const links = cards.map((c) => ({
    cardId: c.card.id,
    recipes: RECIPES.filter((r) => staticMatch(r.input, c.card)).map((r) => r.id).sort(),
  }));

  const upgradePaths: CraftUpgradePath[] = [];
  const upgradeRecipes = RECIPES.filter((r) => r.output.mode === "nextRank" || r.output.mode === "group");
  for (const c of cards) {
    const player = playerAfter.get(c.card.playerId);
    if (!player) continue;
    const chain = cardsForPlayer(player);
    for (const target of chain) {
      if (target.id === c.card.id) continue;
      for (const r of upgradeRecipes) {
        if (!staticMatch(r.input, c.card) || !viaFor(r, c.card, target)) continue;
        // nextRank apunta SOLO a la variante inmediatamente superior del jugador.
        if (r.output.mode === "nextRank") {
          const fromRank = getVariant(c.card.variantId).rank;
          const higher = chain
            .filter((x) => getVariant(x.variantId).rank > fromRank)
            .sort((a, b) => getVariant(a.variantId).rank - getVariant(b.variantId).rank || a.id.localeCompare(b.id));
          if (higher[0]?.id !== target.id) continue;
        }
        upgradePaths.push({ from: c.card.id, to: target.id, via: r.id });
      }
    }
  }
  upgradePaths.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.via.localeCompare(b.via));
  return { links, upgradePaths };
}
