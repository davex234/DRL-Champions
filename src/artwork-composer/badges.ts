/**
 * BADGES — derivación DECLARATIVA de los badges visuales oficiales a partir de campos YA
 * decididos del CardSpec (kind/badges/serialized/rareza): aquí no se recalcula ninguna
 * lógica de cartas, solo se mapea a su representación visual. Reglas = datos.
 */
import type { ArtworkEngine } from "@/artwork";
import type { CardSpec } from "@/card-generator";
import { assetElement } from "./composition";
import { slotLayout } from "./layout";
import { resolveSubjectRef } from "./resolver";
import { BADGE_KINDS, type BadgeKind, type ComposedElement } from "./types";

/** Regla visual: qué badge oficial aparece según los campos del spec (nunca stats). */
interface BadgeRule {
  badge: BadgeKind;
  kinds?: CardSpec["kind"][];
  specBadges?: string[];
  requiresSerialized?: boolean;
  buckets?: string[];
}

export const BADGE_RULES: readonly BadgeRule[] = [
  { badge: "mvp", kinds: ["mvp"] },
  { badge: "champion", kinds: ["champion"] },
  { badge: "champion-edition", kinds: ["champion"], requiresSerialized: true },
  { badge: "elite", buckets: ["legendary"] },
  { badge: "legend", specBadges: ["legend", "three-titles"] },
  { badge: "regional", kinds: ["participation"] },
  { badge: "rookie", specBadges: ["debut", "debut-lan"] },
  { badge: "collector", requiresSerialized: true },
  { badge: "special-event", kinds: ["award"], specBadges: ["reverse-sweep", "dark-horse"] },
  { badge: "perfect-tournament", specBadges: ["perfect-run", "undefeated"] },
  { badge: "record-holder", specBadges: ["career-high", "back-to-back-champion", "first-title"] },
] as const;

const matches = (r: BadgeRule, spec: CardSpec): boolean => {
  if (r.requiresSerialized && !spec.serialized) return false;
  const criteria: boolean[] = [];
  if (r.kinds) criteria.push(r.kinds.includes(spec.kind));
  if (r.specBadges) criteria.push(r.specBadges.some((b) => spec.badges.includes(b)));
  if (r.buckets) criteria.push(r.buckets.includes(spec.rarityBucket));
  // Sin criterio positivo (collector), la propia serie ES el criterio.
  if (!criteria.length) return !!r.requiresSerialized;
  return criteria.some(Boolean);
};

/** Badges visuales del spec, en el orden oficial (deduplicados, deterministas). */
export function deriveBadges(spec: CardSpec): BadgeKind[] {
  const out: BadgeKind[] = [];
  for (const kind of BADGE_KINDS) {
    const rule = BADGE_RULES.find((r) => r.badge === kind)!;
    if (matches(rule, spec) && !out.includes(kind)) out.push(kind);
  }
  return out;
}

/** Elementos de la capa de badges (apilados en el raíl izquierdo, máx. 5 visibles). */
export function composeBadges(spec: CardSpec, artwork: ArtworkEngine): ComposedElement[] {
  return deriveBadges(spec).slice(0, 5).map((badge, i) => ({
    ...assetElement("badges", badge, resolveSubjectRef(artwork, "badge", badge),
      slotLayout("badge-slot", { y: 0.5 + i * 0.085, priority: i })),
    type: "badge" as const,
    badge,
  }));
}
