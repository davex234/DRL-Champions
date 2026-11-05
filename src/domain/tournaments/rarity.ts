/**
 * DRL TORNEOS — motor de rareza (PURO).
 *
 * Las reglas viven en BD (`card_generation_rules`) y son editables. Aquí solo la
 * lógica de resolución: dado un rating, qué tier le corresponde; qué regla aplica
 * para MVP/Champion; y qué foto elegir por prioridad de fuente.
 */
import type { RarityRule, CardPhoto, RuleKind } from "./types";

/** Reglas de rating activas, ordenadas de mayor a menor umbral. */
function ratingRules(rules: RarityRule[]): RarityRule[] {
  return rules
    .filter((r) => r.active && r.kind === "rating")
    .sort((a, b) => (b.minRating ?? 0) - (a.minRating ?? 0) || b.priority - a.priority);
}

/**
 * Tier por rating: la primera regla de rating cuyo umbral cumple `rating`.
 * Devuelve la regla más baja activa si ninguna supera el umbral.
 */
export function resolveTier(rating: number | undefined | null, rules: RarityRule[]): RarityRule | null {
  const ordered = ratingRules(rules);
  if (!ordered.length) return null;
  const r = rating ?? 0;
  for (const rule of ordered) {
    if (r >= (rule.minRating ?? 0)) return rule;
  }
  return ordered[ordered.length - 1];
}

/** Regla activa de un tipo especial (mvp | champion). */
export function ruleForKind(rules: RarityRule[], kind: RuleKind): RarityRule | null {
  return rules.find((r) => r.active && r.kind === kind) ?? null;
}

/** Prioridad por defecto de cada fuente de foto (mayor = mejor). */
export const SOURCE_PRIORITY: Record<CardPhoto["source"], number> = {
  riot_media: 100,
  event_official: 80,
  social: 50,
  broadcast_frame: 30,
  manual: 60,
};

/**
 * Elige la mejor foto aprobada de un jugador: por `priority`, y a igualdad por
 * la prioridad de la fuente. Devuelve null si no hay ninguna aprobada.
 */
export function pickPhoto(photos: CardPhoto[]): CardPhoto | null {
  const approved = photos.filter((p) => p.approvalStatus === "approved");
  if (!approved.length) return null;
  return [...approved].sort(
    (a, b) => b.priority - a.priority || SOURCE_PRIORITY[b.source] - SOURCE_PRIORITY[a.source],
  )[0];
}
