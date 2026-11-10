/**
 * PACK VALIDATION (Collection Fase 2/7 · SEGURIDAD).
 *
 * Detecta sobres CORRUPTOS antes de que rompan una apertura: pool vacío, cardCount inválido,
 * probabilidades inválidas (negativas/NaN/todas cero), garantías imposibles, pity mal configurado,
 * cardIds inexistentes. Puro y determinista. Reutiliza `buildPool` + `CardRegistry`.
 */
import type { CardRegistry } from "@/collection";
import { BUCKETS, BUCKET_INDEX, buildPool } from "@/domain/packs/pool";
import type { PackDef, PackValidation, PackIssue, RarityBucket } from "./types";
import { classPool } from "@/domain/packs/openPack";
import { effectiveFeatured, packPlan, planTableIssues, PACK_CLASS_ORDER } from "@/domain/packs/packClass";
import { ns } from "@/i18n/runtime";

const t = ns("pack");

export function validatePack(registry: CardRegistry, pack: PackDef): PackIssue[] {
  const issues: PackIssue[] = [];
  const bad = (reason: string) => issues.push({ packId: pack.id, reason });

  if (!Number.isInteger(pack.cardCount) || pack.cardCount < 1) bad(t("cardCount inválido"));

  const weightVals = BUCKETS.map((b) => pack.weights[b] ?? 0);
  if (weightVals.some((w) => !Number.isFinite(w) || w < 0)) bad(t("probabilidades inválidas (negativas/NaN)"));
  const hasGuaranteed = !!pack.guaranteedMin || (pack.guarantees?.length ?? 0) > 0;
  if (weightVals.every((w) => w === 0) && !hasGuaranteed) bad(t("todas las probabilidades a cero sin garantías"));

  const { pool, size } = buildPool(registry, pack);
  if (size === 0) bad(t("pool vacío (ninguna carta elegible)"));

  if (pack.pool) for (const id of pack.pool) if (!registry.has(id)) bad(`pool referencia cardId inexistente: ${id}`);

  const stockAtOrAbove = (b: RarityBucket): boolean => BUCKETS.some((x) => BUCKET_INDEX[x] >= BUCKET_INDEX[b] && pool[x].length > 0);
  if (pack.guaranteedMin && !stockAtOrAbove(pack.guaranteedMin)) bad(t("guaranteedMin '{guaranteedMin}' sin stock en el pool", { guaranteedMin: pack.guaranteedMin }));

  for (const g of pack.guarantees ?? []) {
    if (!Number.isInteger(g.count) || g.count < 1) bad(t("garantía con count inválido"));
    if (g.minBucket && !stockAtOrAbove(g.minBucket)) bad(t("garantía '{minBucket}' sin stock en el pool", { minBucket: g.minBucket }));
  }
  if ((pack.guarantees?.reduce((s, g) => s + g.count, 0) ?? 0) > pack.cardCount) bad(t("garantías exceden cardCount"));

  if (pack.pity) {
    if (!Number.isInteger(pack.pity.threshold) || pack.pity.threshold < 1) bad(t("pity.threshold inválido"));
    if (!stockAtOrAbove(pack.pity.minBucket)) bad(t("pity '{minBucket}' sin stock en el pool", { minBucket: pack.pity.minBucket }));
  }

  // Fase 57.3 / Pack Opening 3.0 · línea principal: cada tabla del plan (normal y destacada) suma 1000 (por mil), λ es
  // finita y ≥ 0, el plan tiene las cartas del sobre y ninguna clase con probabilidad > 0 está vacía (fallo cerrado).
  const plan = packPlan(pack.id);
  if (plan) {
    if (plan.cards !== pack.cardCount) bad(t("plan por ranuras con {cards} cartas y el sobre tiene {cardCount}", { cards: plan.cards, cardCount: pack.cardCount }));
    if (!Number.isFinite(plan.ovrTilt) || plan.ovrTilt < 0) bad(t("inclinación por OVR inválida ({ovrTilt})", { ovrTilt: plan.ovrTilt }));
    const byClass = classPool(registry, pack, null);
    // Icon por sobre (2026-10-09): la destacada efectiva incluye la Icon sorteada una vez por sobre.
    for (const issue of planTableIssues(plan)) bad(issue);
    for (const [name, table] of [["normal", plan.regular], ["destacada", effectiveFeatured(plan)]] as const) {
      for (const c of PACK_CLASS_ORDER) if (table[c] > 0 && byClass[c].length === 0) bad(t("clase '{c}' con probabilidad ({name}) y sin cartas", { c, name }));
    }
  }
  return issues;
}

/** Valida un conjunto de sobres. */
export function validatePacks(registry: CardRegistry, packs: PackDef[]): PackValidation {
  const issues = packs.flatMap((p) => validatePack(registry, p));
  return { ok: issues.length === 0, issues };
}
