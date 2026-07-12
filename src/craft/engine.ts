/**
 * CRAFT ENGINE — orquestador (Collection Fase 4/7).
 *
 * UN SOLO camino (`craft`) para todas las operaciones (craft/upgrade/evolution/fusion/salvage/reforge/
 * promotion), parametrizado por la RECETA (datos, sin ifs por rareza). Resuelve entradas → valida
 * materiales/moneda/bloqueos/receta → resuelve salida (identidad preservada, cardId existente) → ACUÑA
 * las salidas con el ÚNICO Minter (`PackEngine.grant`) → mueve materiales/moneda → emite eventos.
 * Devuelve un PLAN puro; el store lo aplica (quita entradas, ingresa salidas, actualiza recursos).
 * Determinista (RNG del proyecto). No posee cartas/catálogo/inventario/economía: los reutiliza.
 */
import { CardRegistry, OwnershipIndex } from "@/collection";
import { PackEngine, freshPity } from "@/pack";
import { BUCKETS, hasMaterials, freshMaterials, salvageYield } from "./materials";
import { validateRecipe } from "./recipes";
import { resolveInputs, resolveOutput } from "./resolve";
import { craftEvents } from "./events";
import type { CraftContext, CraftIssue, CraftResult, Materials, OwnedCard, Recipe, RecipeValidation } from "./types";

export class CraftEngine {
  readonly registry: CardRegistry;
  private packs: PackEngine;
  /**
   * Cache de validación por IDENTIDAD de receta: las recetas son datos inmutables y el
   * registry es fijo por engine, así que validar la misma receta en cada `craft` era trabajo
   * redundante (dominaba el coste por operación en cargas masivas). WeakMap ⇒ sin retención.
   */
  private validations = new WeakMap<Recipe, RecipeValidation>();
  /**
   * Cache del índice de propiedad por IDENTIDAD del array `owned`: el estado del juego es
   * inmutable (los stores sustituyen el array al cambiar), así que el mismo array ⇒ el mismo
   * índice. Evita reconstruir groupCollection en cargas masivas sobre el mismo inventario.
   */
  private ownIndexes = new WeakMap<OwnedCard[], OwnershipIndex>();
  constructor(registry: CardRegistry = new CardRegistry()) {
    this.registry = registry;
    this.packs = new PackEngine(registry);
  }

  /** Valida una receta contra el catálogo (SEGURIDAD, sin ejecutar). Cacheada por identidad. */
  validateRecipe(recipe: Recipe): RecipeValidation {
    const hit = this.validations.get(recipe);
    if (hit) return hit;
    const rv = validateRecipe(this.registry, recipe);
    this.validations.set(recipe, rv);
    return rv;
  }

  /** Índice de propiedad del inventario (cacheado por identidad del array, ver arriba). */
  private ownershipOf(owned: OwnedCard[]): OwnershipIndex {
    const hit = this.ownIndexes.get(owned);
    if (hit) return hit;
    const own = new OwnershipIndex(owned);
    this.ownIndexes.set(owned, own);
    return own;
  }

  /** Resultado de fallo (sin closure por llamada: `craft` corre millones de veces). */
  private static failResult(recipe: Recipe, ctx: CraftContext, issues: CraftIssue[]): CraftResult {
    return {
      ok: false, recipeId: recipe.id, kind: recipe.kind, issues, removedUids: [], instances: [],
      mintDelta: {}, materialsAfter: ctx.materials, creditsAfter: ctx.credits, tokensAfter: ctx.tokens, events: [],
    };
  }

  /** Ejecuta una receta sobre el contexto y devuelve el PLAN (no muta nada). Determinista. */
  craft(recipe: Recipe, ctx: CraftContext): CraftResult {
    const rv = this.validateRecipe(recipe);
    if (!rv.ok) return CraftEngine.failResult(recipe, ctx, rv.issues);

    const own = this.ownershipOf(ctx.owned);

    // 1) Entradas.
    const { picked, issues: inIssues } = resolveInputs(this.registry, own, ctx.owned, recipe.input, ctx.locks, ctx.selection);
    if (inIssues.length) return CraftEngine.failResult(recipe, ctx, inIssues);

    // 2) Coste (materiales/créditos/tokens).
    const cost = recipe.cost ?? {};
    const costIssues: CraftIssue[] = [];
    if (cost.materials && !hasMaterials(ctx.materials, cost.materials)) costIssues.push({ code: "INSUFFICIENT_MATERIALS", message: "Materiales insuficientes." });
    if ((cost.credits ?? 0) > ctx.credits) costIssues.push({ code: "INSUFFICIENT_CREDITS", message: "Créditos insuficientes." });
    if ((cost.tokens ?? 0) > ctx.tokens) costIssues.push({ code: "INSUFFICIENT_TOKENS", message: "Tokens insuficientes." });
    if (costIssues.length) return CraftEngine.failResult(recipe, ctx, costIssues);

    // 3) Salida (identidad preservada; debe existir en el catálogo).
    const { cardIds, issues: outIssues } = resolveOutput(this.registry, recipe.output, picked);
    if (outIssues.length) return CraftEngine.failResult(recipe, ctx, outIssues);

    const removedUids = picked.map((o) => o.uid);

    // 4) Salvage → materiales/créditos. Otras → acuñar salidas por el ÚNICO Minter.
    const gained: Materials = freshMaterials();
    let creditsGain = 0;
    let instances: CraftResult["instances"] = [];
    let mintDelta: Record<string, number> = {};

    if (recipe.output.mode === "materials") {
      for (const o of picked) {
        const def = this.registry.card(o.cardId)!;
        const v = this.registry.variant(def.variantId);
        const y = salvageYield(def, v, o.serial, recipe.output);
        for (const k of BUCKETS) gained[k] += y.materials[k] ?? 0;
        creditsGain += y.credits;
      }
    } else {
      const remainingOwned = ctx.owned.filter((o) => !removedUids.includes(o.uid));
      const grant = this.packs.grant(cardIds, "craft", { seed: ctx.seed, owned: remainingOwned, mintCounts: ctx.mintCounts, pity: freshPity(), now: ctx.now });
      instances = grant.instances;
      mintDelta = grant.mintDelta;
    }

    // 5) Recursos finales (una sola pasada: idéntico a add(sub(base, coste), ganado)).
    const costM = cost.materials ?? {};
    const materialsAfter: Materials = { ...ctx.materials };
    for (const k of BUCKETS) materialsAfter[k] = (materialsAfter[k] ?? 0) - (costM[k] ?? 0) + gained[k];
    const creditsAfter = ctx.credits - (cost.credits ?? 0) + creditsGain;
    const tokensAfter = ctx.tokens - (cost.tokens ?? 0);

    const events = craftEvents(this.registry, own, recipe.kind, picked, instances, gained, cost.materials ?? {}, ctx.now);

    return { ok: true, recipeId: recipe.id, kind: recipe.kind, issues: [], removedUids, instances, mintDelta, materialsAfter, creditsAfter, tokensAfter, events };
  }
}
