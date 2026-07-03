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

/** Pool bucketeado + tamaño + flat. Cacheado (WeakMap por registro → Map por pack.id) ⇒ O(1)/apertura. */
const CACHE = new WeakMap<CardRegistry, Map<string, BuiltPool>>();

export function buildPool(registry: CardRegistry, pack: PackDef): BuiltPool {
  let perReg = CACHE.get(registry);
  if (!perReg) { perReg = new Map(); CACHE.set(registry, perReg); }
  const hit = perReg.get(pack.id);
  if (hit) return hit;

  const pool = emptyPool();
  const flat: CardDef[] = [];
  for (const card of registry.cards) {
    if (!isEligible(registry, pack, card)) continue;
    pool[bucketForRank(registry.variant(card.variantId).rank)].push(card);
    flat.push(card);
  }
  const built: BuiltPool = { pool, size: flat.length, flat };
  perReg.set(pack.id, built);
  return built;
}
