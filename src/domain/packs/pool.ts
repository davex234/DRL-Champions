/**
 * DROP POOL (Collection Fase 2/7) — parte interna del decisor `openPack`.
 *
 * Construye el conjunto de cartas ELEGIBLES de un sobre, agrupado por bucket de rareza, aplicando
 * TODAS las restricciones de datos del `PackDef` (pool explícito / grupos / región / variantes /
 * series / serializadas). REUTILIZA el `CardRegistry` del Collection Engine (solo el tipo; sin
 * acoplarse en runtime): NO re-escanea catálogos ni duplica índices. O(n) al construir; cacheado por
 * (pack.id, registro) ⇒ coste O(1) por apertura, preparado para millones de aperturas.
 */
import type { CardRegistry } from "@/collection";
import { bucketForRank, type RarityBucket, type PackDef } from "./types";
import { poolAllows, type PackDistribution } from "./distribution";
import { withinPackPower } from "./power";
import type { CardDef } from "../cards/types";

export const BUCKETS: RarityBucket[] = ["common", "uncommon", "rare", "epic", "legendary"];
export const BUCKET_INDEX: Record<RarityBucket, number> = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4 };

export type Pool = Record<RarityBucket, CardDef[]>;
const emptyPool = (): Pool => ({ common: [], uncommon: [], rare: [], epic: [], legendary: [] });

export interface BuiltPool { pool: Pool; size: number; flat: CardDef[] }

/** Prefijo de serie de una variante (para `pack.series`). */
const SERIES_MATCH = (variantId: string, series: string[]): boolean =>
  series.some((s) => variantId.startsWith(s) || (s === "icon" && (variantId === "icon-series" || variantId === "hall-of-fame")));

/** ¿Es la carta elegible para el sobre (según todas las restricciones de datos)? */
export function isEligible(registry: CardRegistry, pack: PackDef, card: CardDef): boolean {
  /*
   * Hotfix 57.2 · TECHO DE PODER de la gama base (Bronce/Plata/Oro/Icon, `PACK_POWER_RULES`). Va PRIMERO y aquí, en el
   * único filtro del pool: todo lo que elige una carta —peso, garantía, pity, fallback, anti-duplicado, odds— elige
   * dentro de este pool, así que una carta por encima del techo no tiene NINGÚN camino para salir. Sin regla, no filtra.
   * Fase 57.3: hoy ningún sobre tiene regla (la línea principal decide por clase, `./packClass`); no filtra nada.
   */
  if (!withinPackPower(pack.id, card)) return false;
  const v = registry.variant(card.variantId);
  if (pack.pool && !pack.pool.includes(card.id)) return false;
  if (pack.allowedVariants && !pack.allowedVariants.includes(card.variantId)) return false;
  if (pack.excludeVariants && pack.excludeVariants.includes(card.variantId)) return false;
  if (pack.restrictGroups && !pack.restrictGroups.includes(v.group)) return false;
  if (pack.serializedOnly && !v.serialized) return false;
  if (pack.series && !SERIES_MATCH(card.variantId, pack.series)) return false;
  const region = pack.restrictRegion ?? pack.region;
  if (region) {
    const p = registry.player(card.playerId);
    if (!p || p.region !== region) return false;
  }
  return true;
}

/**
 * Pool bucketeado + tamaño + flat. Cacheado (WeakMap por registro → Map por clave) ⇒
 * O(1)/apertura.
 *
 * BLOQUE 8.3 — la clave de caché lleva ahora la CONFIGURACIÓN, no solo el `pack.id`. Sin
 * eso, publicar un pool nuevo dejaría al proceso sirviendo el pool anterior mientras el
 * registro no cambiara: exactamente el escenario que la Fase 12 del encargo prohíbe
 * («admin publica → BD tiene la carta → Node sigue usando el pool viejo indefinidamente»).
 * La invalidación deja de depender de que alguien se acuerde de vaciar nada.
 */
const CACHE = new WeakMap<CardRegistry, Map<string, BuiltPool>>();

const cacheKey = (pack: PackDef, dist: PackDistribution | null): string =>
  dist ? `${pack.id}@${dist.key}` : pack.id;

export function buildPool(
  registry: CardRegistry, pack: PackDef, dist: PackDistribution | null = null,
): BuiltPool {
  let perReg = CACHE.get(registry);
  if (!perReg) { perReg = new Map(); CACHE.set(registry, perReg); }
  const key = cacheKey(pack, dist);
  const hit = perReg.get(key);
  if (hit) return hit;

  const pool = emptyPool();
  const flat: CardDef[] = [];
  for (const card of registry.cards) {
    /*
     * El ORDEN de este recorrido es el del catálogo (`content_cards.ordinal`) y sigue
     * siendo la única autoridad de orden: el pool aporta pertenencia y peso, nunca orden.
     * Dos autoridades de orden es como se rompe un sorteo determinista — lo aprendió 8.1.
     */
    if (!isEligible(registry, pack, card)) continue;
    if (!poolAllows(dist, card)) continue;
    pool[bucketForRank(registry.variant(card.variantId).rank)].push(card);
    flat.push(card);
  }
  const built: BuiltPool = { pool, size: flat.length, flat };
  perReg.set(key, built);
  return built;
}
