/**
 * EFFECTS — efectos visuales DERIVADOS declarativamente de campos ya decididos del spec
 * (rareza/kind/serie/badges): glow · foil · holographic · shadow · fire · smoke ·
 * lightning · particles · aura. Solo referencias (el Renderer futuro los materializará);
 * jamás un efecto gráfico aquí.
 */
import type { ArtworkEngine } from "@/artwork";
import type { CardSpec } from "@/card-generator";
import { assetElement } from "./composition";
import { slotLayout, SLOTS } from "./layout";
import { resolveSubjectRef } from "./resolver";
import type { ComposedElement, EffectKind } from "./types";

/** Regla visual de efecto: campos del spec → efecto + capa (bg/player/fg) + slot. */
interface EffectRule {
  effect: EffectKind;
  slot: keyof typeof SLOTS;
  layer: "background-effects" | "player" | "foreground-effects";
  buckets?: string[];
  kinds?: CardSpec["kind"][];
  specBadges?: string[];
  requiresSerialized?: boolean;
}

export const EFFECT_RULES: readonly EffectRule[] = [
  { effect: "shadow", slot: "shadow", layer: "player", buckets: ["common", "uncommon", "rare", "epic", "legendary"] },
  { effect: "glow", slot: "bg-glow", layer: "background-effects", buckets: ["rare", "epic", "legendary"] },
  { effect: "aura", slot: "bg-aura", layer: "background-effects", buckets: ["legendary"] },
  { effect: "smoke", slot: "bg-smoke", layer: "background-effects", specBadges: ["dark-horse"] },
  { effect: "particles", slot: "fg-particles", layer: "foreground-effects", buckets: ["epic", "legendary"] },
  { effect: "foil", slot: "fg-foil", layer: "foreground-effects", buckets: ["legendary"] },
  { effect: "holographic", slot: "fg-holo", layer: "foreground-effects", requiresSerialized: true },
  { effect: "holographic", slot: "fg-holo", layer: "foreground-effects", kinds: ["mvp"] },
  { effect: "fire", slot: "fg-fire", layer: "foreground-effects", kinds: ["champion"] },
  { effect: "lightning", slot: "fg-lightning", layer: "foreground-effects", specBadges: ["perfect-run", "undefeated"] },
] as const;

const matches = (r: EffectRule, spec: CardSpec): boolean => {
  if (r.requiresSerialized) return spec.serialized;
  const criteria: boolean[] = [];
  if (r.buckets) criteria.push(r.buckets.includes(spec.rarityBucket));
  if (r.kinds) criteria.push(r.kinds.includes(spec.kind));
  if (r.specBadges) criteria.push(r.specBadges.some((b) => spec.badges.includes(b)));
  return criteria.some(Boolean);
};

/** Efectos activos del spec (únicos, en orden de reglas). */
export function deriveEffects(spec: CardSpec): EffectKind[] {
  const out: EffectKind[] = [];
  for (const r of EFFECT_RULES) if (matches(r, spec) && !out.includes(r.effect)) out.push(r.effect);
  return out;
}

/** Elementos de efecto repartidos por capa (bg / sombra del player / fg). */
export function composeEffects(spec: CardSpec, artwork: ArtworkEngine): Record<"background-effects" | "player" | "foreground-effects", ComposedElement[]> {
  const out: Record<"background-effects" | "player" | "foreground-effects", ComposedElement[]> = {
    "background-effects": [], player: [], "foreground-effects": [],
  };
  const seen = new Set<EffectKind>();
  for (const r of EFFECT_RULES) {
    if (seen.has(r.effect) || !matches(r, spec)) continue;
    seen.add(r.effect);
    out[r.layer].push({
      ...assetElement(r.layer, `fx-${r.effect}`, resolveSubjectRef(artwork, "effect", r.effect), slotLayout(r.slot)),
      type: "effect",
      effect: r.effect,
    });
  }
  return out;
}
