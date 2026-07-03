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
import { addMaterials, subMaterials, hasMaterials, freshMaterials, salvageYield } from "./materials";
import { validateRecipe } from "./recipes";
import { resolveInputs, resolveOutput } from "./resolve";
import { craftEvents } from "./events";
import type { CraftContext, CraftIssue, CraftResult, Materials, Recipe } from "./types";

export class CraftEngine {
  readonly registry: CardRegistry;
  private packs: PackEngine;
  constructor(registry: CardRegistry = new CardRegistry()) {
    this.registry = registry;
    this.packs = new PackEngine(registry);
  }

  /** Valida una receta contra el catálogo (SEGURIDAD, sin ejecutar). */
  validateRecipe(recipe: Recipe) { return validateRecipe(this.registry, recipe); }

  /** Ejecuta una receta sobre el contexto y devuelve el PLAN (no muta nada). Determinista. */
  craft(recipe: Recipe, ctx: CraftContext): CraftResult {
    const fail = (issues: CraftIssue[]): CraftResult => ({
      ok: false, recipeId: recipe.id, kind: recipe.kind, issues, removedUids: [], instances: [],
      mintDelta: {}, materialsAfter: ctx.materials, creditsAfter: ctx.credits, tokensAfter: ctx.tokens, events: [],
    });

    const rv = validateRecipe(this.registry, recipe);
    if (!rv.ok) return fail(rv.issues);

    const own = new OwnershipIndex(ctx.owned);

    // 1) Entradas.
    const { picked, issues: inIssues } = resolveInputs(this.registry, own, ctx.owned, recipe.input, ctx.locks, ctx.selection);
    if (inIssues.length) return fail(inIssues);

    // 2) Coste (materiales/créditos/tokens).
    const cost = recipe.cost ?? {};
    const costIssues: CraftIssue[] = [];
    if (cost.materials && !hasMaterials(ctx.materials, cost.materials)) costIssues.push({ code: "INSUFFICIENT_MATERIALS", message: "Materiales insuficientes." });
    if ((cost.credits ?? 0) > ctx.credits) costIssues.push({ code: "INSUFFICIENT_CREDITS", message: "Créditos insuficientes." });
    if ((cost.tokens ?? 0) > ctx.tokens) costIssues.push({ code: "INSUFFICIENT_TOKENS", message: "Tokens insuficientes." });
    if (costIssues.length) return fail(costIssues);

    // 3) Salida (identidad preservada; debe existir en el catálogo).
    const { cardIds, issues: outIssues } = resolveOutput(this.registry, recipe.output, picked);
    if (outIssues.length) return fail(outIssues);

    const removedUids = picked.map((o) => o.uid);

    // 4) Salvage → materiales/créditos. Otras → acuñar salidas por el ÚNICO Minter.
    let gained: Materials = freshMaterials();
    let creditsGain = 0;
    let instances: CraftResult["instances"] = [];
    let mintDelta: Record<string, number> = {};

    if (recipe.output.mode === "materials") {
      for (const o of picked) {
        const def = this.registry.card(o.cardId)!;
        const v = this.registry.variant(def.variantId);
        const y = salvageYield(def, v, o.serial, recipe.output);
        gained = addMaterials(gained, y.materials);
        creditsGain += y.credits;
      }
    } else {
      const remainingOwned = ctx.owned.filter((o) => !removedUids.includes(o.uid));
      const grant = this.packs.grant(cardIds, "craft", { seed: ctx.seed, owned: remainingOwned, mintCounts: ctx.mintCounts, pity: freshPity(), now: ctx.now });
      instances = grant.instances;
      mintDelta = grant.mintDelta;
    }

    // 5) Recursos finales.
    const materialsAfter = addMaterials(subMaterials(ctx.materials, cost.materials ?? {}), gained);
    const creditsAfter = ctx.credits - (cost.credits ?? 0) + creditsGain;
    const tokensAfter = ctx.tokens - (cost.tokens ?? 0);

    const events = craftEvents(this.registry, own, recipe.kind, picked, instances, gained, cost.materials ?? {}, ctx.now);

    return { ok: true, recipeId: recipe.id, kind: recipe.kind, issues: [], removedUids, instances, mintDelta, materialsAfter, creditsAfter, tokensAfter, events };
  }
}
