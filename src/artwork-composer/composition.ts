/**
 * COMPOSITION — ensamblado y SEGURIDAD de la ArtworkComposition: las 12 capas oficiales en
 * orden, cero capas duplicadas, ids de elemento únicos, referencias no vacías y contenido
 * prohibido (HTML/Canvas/imágenes embebidas como ref) rechazado. Huella determinista.
 */
import { artworkHash } from "@/artwork";
import type { ResolvedArtwork } from "@/artwork";
import { buildLayers, type LayerElements } from "./layers";
import { CANVAS } from "./layout";
import { LAYER_ORDER, COMPOSER_SCHEMA_VERSION } from "./types";
import type {
  ArtworkComposition, ComposedElement, CompositionIssue, CompositionValidation,
  ElementLayout, LayerKind,
} from "./types";
import type { CardSpec } from "@/card-generator";
import type { BadgeKind, EffectKind } from "./types";

/** Fabrica un elemento de asset resuelto (real o placeholder) para una capa. */
export function assetElement(
  layer: LayerKind, role: string, r: ResolvedArtwork, layout: ElementLayout,
): ComposedElement {
  return {
    id: `${layer}:${role}`, type: "asset", ref: r.asset.id, category: r.category,
    isPlaceholder: r.isPlaceholder, layout,
  };
}

export interface AssembleMeta {
  spec: CardSpec;
  generationId?: string;
  badges: BadgeKind[];
  effects: EffectKind[];
}

/** Ensambla la composición final (capas ordenadas + inventario de refs + huella). */
export function assemble(elements: LayerElements, meta: AssembleMeta): ArtworkComposition {
  const layers = buildLayers(elements);
  const all = layers.flatMap((l) => l.elements);
  const assetsUsed = [...new Set(all.filter((e) => !e.isPlaceholder).map((e) => e.ref))].sort();
  const placeholdersUsed = [...new Set(all.filter((e) => e.isPlaceholder).map((e) => e.ref))].sort();
  const missingCategories = [...new Set(all.filter((e) => e.isPlaceholder).map((e) => e.category))].sort();

  const core = {
    cardId: meta.spec.cardId,
    playerId: meta.spec.playerId,
    variantId: meta.spec.variantId,
    generationId: meta.generationId,
    canvas: CANVAS,
    palette: meta.spec.artwork.palette,
    layers,
    assetsUsed,
    placeholdersUsed,
    missingCategories,
    metadata: {
      rarity: meta.spec.rarityBucket,
      tier: meta.spec.tier,
      kind: meta.spec.kind,
      season: meta.spec.season,
      series: meta.spec.series,
      family: meta.spec.family,
      ovr: meta.spec.ovr,
      serialized: meta.spec.serialized,
      serialLimit: meta.spec.serialLimit,
      badges: meta.badges,
      effects: meta.effects,
    },
  };
  return { schemaVersion: COMPOSER_SCHEMA_VERSION, ...core, fingerprint: artworkHash(JSON.stringify(core)) };
}

/* ── Validación (cero estados imposibles) ─────────────────────────────────── */

const FORBIDDEN_REF = /^data:|^<|canvas|<\/|<img|<svg/i;

export function validateComposition(c: ArtworkComposition): CompositionValidation {
  const issues: CompositionIssue[] = [];
  const err = (code: CompositionIssue["code"], message: string): void => { issues.push({ code, message }); };

  // Capas: exactamente las 12 oficiales, en orden, sin duplicados.
  if (c.layers.length !== LAYER_ORDER.length) err("MISSING_LAYER", `capas ${c.layers.length} ≠ ${LAYER_ORDER.length}`);
  c.layers.forEach((l, i) => { if (l.kind !== LAYER_ORDER[i]) err("BAD_LAYER_ORDER", `capa ${i} es ${l.kind}, esperada ${LAYER_ORDER[i]}`); });
  const kinds = new Set(c.layers.map((l) => l.kind));
  if (kinds.size !== c.layers.length) err("DUPLICATE_LAYER", "capas duplicadas");

  // Elementos: id único global, ref presente y jamás contenido gráfico embebido.
  const ids = new Set<string>();
  for (const l of c.layers) {
    for (const e of l.elements) {
      if (ids.has(e.id)) err("DUPLICATE_ELEMENT_ID", `elemento duplicado: ${e.id}`);
      ids.add(e.id);
      if (!e.ref) err("EMPTY_REF", `elemento sin referencia: ${e.id}`);
      if (FORBIDDEN_REF.test(e.ref)) err("FORBIDDEN_CONTENT", `la ref de ${e.id} no es una referencia de asset`);
      const { x, y, opacity, scale } = e.layout;
      if (x < 0 || x > 1 || y < 0 || y > 1 || opacity < 0 || opacity > 1 || scale <= 0) {
        err("BAD_LAYOUT", `layout fuera de rango en ${e.id}`);
      }
    }
  }
  return { ok: issues.length === 0, issues };
}
