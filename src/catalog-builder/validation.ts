/**
 * VALIDATION ENGINE (Fase 6) — cero estados imposibles: integridad referencial de TODOS los
 * artefactos (catálogo/colecciones/pools/craft/mercado/búsqueda/manifiesto/generación).
 * Errores = build inválida; warnings = degradaciones. Puro y determinista.
 */
import { getVariant } from "@/domain/cards/variants";
import { RECIPE_BY_ID } from "@/data/recipes";
import { getPack } from "@/data/packs";
import type { CatalogBuildResult, ValidationIssue, CatalogValidation } from "./types";
import { ns, td } from "@/i18n/runtime";

const t = ns("catalogbuilder");

export function validateBuild(res: Omit<CatalogBuildResult, "validation">): CatalogValidation {
  const issues: ValidationIssue[] = [];
  const err = (section: string, message: string): void => { issues.push({ severity: "error", section, message }); };
  const warn = (section: string, message: string): void => { issues.push({ severity: "warning", section, message }); };

  const cardIds = new Set(res.catalog.cards.map((c) => c.id));
  const playerIds = new Set(res.catalog.players.map((p) => p.id));

  // Catálogo: ids únicos, variantes conocidas, jugador existente, OVR en rango.
  if (cardIds.size !== res.catalog.cards.length) err("catalog", "cardIds duplicados");
  for (const c of res.catalog.cards) {
    if (!getVariant(c.variantId)) err("catalog", `variante desconocida: ${c.variantId}`);
    if (!playerIds.has(c.playerId)) err("catalog", t("carta sin jugador: {id}", { id: c.id }));
    if (!Number.isFinite(c.ovr) || c.ovr < 1 || c.ovr > 99) err("catalog", `OVR imposible: ${c.id}`);
  }

  // Colecciones: items apuntan a cartas del catálogo.
  for (const col of res.collections.collections) {
    for (const i of col.items) if (!cardIds.has(i.cardId)) err("collections", t("item inexistente {cardId} en {id}", { cardId: i.cardId, id: col.id }));
  }

  // Packs: pack conocido, altas dentro del catálogo, odds normalizadas.
  for (const p of res.packs.pools) {
    if (!getPack(p.packId)) err("packs", `pack desconocido: ${p.packId}`);
    for (const id of p.added) if (!cardIds.has(id)) err("packs", t("alta inexistente {id} en {packId}", { id, packId: p.packId }));
    const oddsSum = Object.values(p.odds).reduce((a, b) => a + b, 0);
    if (p.size > 0 && Math.abs(oddsSum - 1) > 0.001) err("packs", t("odds no normalizadas en {packId} ({oddsSum})", { packId: p.packId, oddsSum }));
    if (p.size === 0) warn("packs", `pool vacío: ${p.packId}`);
  }

  // Craft: recetas existentes, enlaces/grafos dentro del catálogo.
  for (const l of res.craft.links) {
    if (!cardIds.has(l.cardId)) err("craft", t("enlace de carta inexistente: {cardId}", { cardId: l.cardId }));
    for (const r of l.recipes) if (!RECIPE_BY_ID.has(r)) err("craft", `receta inexistente: ${r}`);
  }
  for (const p of [...res.craft.upgradeGraph, ...res.craft.evolutionGraph]) {
    if (!cardIds.has(p.from) || !cardIds.has(p.to)) err("craft", t("ruta con carta inexistente: {from}→{to}", { from: td(p.from), to: td(p.to) }));
    if (!RECIPE_BY_ID.has(p.via)) err("craft", t("ruta vía receta inexistente: {via}", { via: td(p.via) }));
  }

  // Mercado: valores finitos y positivos, refs válidas.
  for (const e of res.marketplace.entries) {
    if (!cardIds.has(e.cardId)) err("marketplace", t("entrada de carta inexistente: {cardId}", { cardId: e.cardId }));
    if (!Number.isFinite(e.initialValue) || e.initialValue < 25) err("marketplace", `valor imposible: ${e.cardId}`);
  }

  // Búsqueda: refs de carta válidas.
  for (const r of res.search.rows) {
    if (r.kind === "card" && !cardIds.has(r.ref)) err("search", t("fila de carta inexistente: {ref}", { ref: td(r.ref) }));
  }

  // Manifiesto/generación: versión semántica, fingerprint, GenerationId y dependencias.
  if (!/^\d+\.\d+\.\d+$/.test(res.catalogVersion)) err("manifest", t("versión no semántica: {catalogVersion}", { catalogVersion: res.catalogVersion }));
  if (!/^[0-9a-f]{64}$/.test(res.catalogFingerprint)) err("manifest", t("catalogFingerprint inválido"));
  if (res.manifest.generationId !== res.generationId) err("manifest", "GenerationId inconsistente");
  if (res.manifest.counts.cards !== res.catalog.cards.length) err("manifest", "counts.cards inconsistente");

  return { ok: !issues.some((i) => i.severity === "error"), issues };
}
