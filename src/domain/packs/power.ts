/**
 * PACK POWER RULES — el techo de PODER de la gama base (Hotfix 57.2). FUENTE ÚNICA.
 *
 * FASE 57.3 · HISTÓRICO: Bronce, Plata, Oro e Icon ya NO usan techo de OVR; usan PACK CLASS DISTRIBUTION
 * (`./packClass`). `PACK_POWER_RULES` queda vacío y el mecanismo sigue disponible. Lo de abajo documenta el Hotfix 57.2.
 *
 * ─────────────────────────── EL BUG ───────────────────────────
 *
 * El sorteo agrupa las cartas por RAREZA DE SU VARIANTE (`bucketForRank(variant.rank)`), y en el catálogo diseñado la
 * rareza NO está correlacionada con el OVR: la edición base («común») llega a 92 y Masters L / SDC («poco común») a 95.
 * El Sobre Bronce (55 % común, 35 % poco común) no filtraba nada más, así que podía entregar, por ejemplo,
 * `brawk__masters-l` (poco común, OVR 93): 79 de las 288 comunes y poco comunes tienen OVR ≥ 88.
 *
 * ─────────────────────────── LA REGLA ───────────────────────────
 *
 * Cada sobre de la gama base tiene un TECHO de OVR. Una carta por encima NO ES ELEGIBLE: no entra en su pool, así que no
 * puede salir ni por peso, ni por garantía, ni por pity, ni por el fallback de un hueco imposible, ni por la
 * compensación anti-duplicado (todos eligen DENTRO del pool del sobre). Las probabilidades de la tienda (`engine.odds`)
 * se calculan sobre ese mismo pool: un bucket vacío se renormaliza, no se promete.
 *
 * Cortes elegidos sobre la distribución REAL de las 331 cartas (p25 81 · mediana 85 · p75 89 · p90 92 · p95 93 · máx 95):
 *
 *   Bronce ≤ 85 — hasta la mediana: cartas bajas y medias (181 elegibles).
 *   Plata  ≤ 89 — hasta el p75: algunas buenas (86–89), sin el tramo alto ≥ 90; conserva raras y épicas para su garantía (261).
 *   Oro    ≤ 93 — hasta el p95: acceso real a cartas muy buenas (90–93); el extremo 94–95 queda para Icon (315).
 *   Icon   sin techo — el techo del catálogo que permita su pool (legendaria garantizada).
 *
 * SOLO la gama base. Regionales, equipos, eventos (Masters/Champions/EWC), Inicial y demás productos NO tienen regla y
 * siguen con sus pools, pesos y sesgos de siempre. Precios, pesos, cartas por sobre y garantías no cambian.
 */
import type { CardDef } from "../cards/types";

export type PackPowerTier = "bronze" | "silver" | "gold" | "icon";

export interface PackPowerRule {
  tier: PackPowerTier;
  /** OVR máximo que puede salir. `null` = sin techo (el pool del producto manda). */
  maxOvr: number | null;
  /** Frase para la ficha/odds: qué clase de cartas contiene. Sin porcentajes ni números (el número sale de `maxOvr`). */
  blurb: string;
}

/**
 * Clave = `PackDef.id` persistido.
 *
 * FASE 57.3 · VACÍO A PROPÓSITO. Bronce (`estandar`), Plata (`premium`), Oro e Icon —los cuatro que tenían techo— pasan a
 * la PACK CLASS DISTRIBUTION (`./packClass`, junto a Masters y Champions), que decide por clase de sobre y no por OVR.
 * Mantener aquí su techo sería un segundo filtro contradictorio con la tabla (p. ej. Bronce da Icon al 1 % y su techo
 * de 85 lo impediría). Ningún otro sobre tenía regla, así que ninguno cambia. El mecanismo se conserva: un producto
 * futuro que necesite techo de OVR se declara aquí, y `packClass.test.ts` impide declararlo en un sobre de la línea.
 */
export const PACK_POWER_RULES: Readonly<Record<string, PackPowerRule>> = {};

/** Escalera de la gama base, de menor a mayor. */
export const BASE_LINE: readonly string[] = ["estandar", "premium", "oro", "icon"];

export function powerRuleFor(packId: string): PackPowerRule | null {
  return Object.prototype.hasOwnProperty.call(PACK_POWER_RULES, packId) ? PACK_POWER_RULES[packId] : null;
}

/** ¿La carta respeta el techo de poder del sobre? Sin regla (sobres especiales), siempre sí. */
export function withinPackPower(packId: string, card: Pick<CardDef, "ovr">): boolean {
  const rule = powerRuleFor(packId);
  if (!rule || rule.maxOvr === null) return true;
  return Number.isFinite(card.ovr) && card.ovr <= rule.maxOvr;
}

/** Lo que la ficha del sobre enseña del techo, derivado de la regla (nunca un número escrito a mano en la UI). */
export interface PackPowerCap { maxOvr: number | null; headline: string; blurb: string }

export function packPowerCap(packId: string): PackPowerCap | null {
  const rule = powerRuleFor(packId);
  if (!rule) return null;
  return {
    maxOvr: rule.maxOvr,
    headline: rule.maxOvr === null ? "Sin límite de OVR" : `OVR ${rule.maxOvr} como máximo`,
    blurb: rule.blurb,
  };
}
