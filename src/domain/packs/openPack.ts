/**
 * openPack — EL ÚNICO DECISOR DE DROPS (Collection Fase 2/7).
 *
 * Esta función es la única fuente de verdad que decide QUÉ carta cae de un sobre. Compone, en una sola
 * ruta: pool elegible + pesos por rareza + garantías (`guaranteedMin`/`guarantees`) + pity + anti-
 * duplicados. Está dividida INTERNAMENTE en `pool`/`pity`/`antidup` (mismo dominio), pero es UN SOLO
 * camino de decisión. 100% determinista (RNG oficial del proyecto `@/sim/rng`).
 *
 * NO acuña (no asigna nº de serie, calidad, origen ni marca de posesión): eso es responsabilidad del
 * Minter en la capa de orquestación. Aquí solo se DECIDE la carta y sus banderas (pity/compensada).
 *
 *   Pack UI → Pack Engine (orquestación) → openPack() [decisión] → Minter → Collection → Ownership
 */
import type { CardRegistry } from "@/collection";
import { makeRng, type Rng } from "@/sim/rng";
import { bucketForRank, type RarityBucket, type PackDef } from "./types";
import type { CardDef, VariantGroup } from "../cards/types";
import { buildPool, BUCKETS, BUCKET_INDEX, type Pool } from "./pool";
import { pityDue, updatePity, type PityState } from "./pity";
import { resolveAntiDup } from "./antidup";

/** Una carta DECIDIDA por el drop (aún sin acuñar). */
export interface DropDecision {
  card: CardDef;
  bucket: RarityBucket;
  byPity: boolean;
  compensated: boolean;
}

/** Contexto de decisión (solo lo que el DECISOR necesita: azar + propiedad + pity). */
export interface DecideContext {
  seed: number;
  /** cardIds ya poseídos (para anti-duplicados). SOLO LECTURA. */
  owned: Set<string>;
  pity: PityState;
}

export interface OpenPackResult {
  decisions: DropDecision[];
  pityAfter: PityState;
}

interface SlotReq { minIdx: number; groups?: VariantGroup[]; serialized?: boolean }

/** Requisitos por hueco: garantías asignadas a los últimos huecos + `guaranteedMin` en el último. */
function slotRequirements(pack: PackDef): SlotReq[] {
  const reqs: SlotReq[] = Array.from({ length: pack.cardCount }, () => ({ minIdx: 0 }));
  let ptr = pack.cardCount - 1;
  for (const g of pack.guarantees ?? []) {
    for (let n = 0; n < g.count && ptr >= 0; n++, ptr--) {
      const r = reqs[ptr];
      if (g.minBucket) r.minIdx = Math.max(r.minIdx, BUCKET_INDEX[g.minBucket]);
      if (g.groups) r.groups = g.groups;
      if (g.serialized != null) r.serialized = g.serialized;
    }
  }
  if (pack.guaranteedMin) {
    const last = reqs[pack.cardCount - 1];
    last.minIdx = Math.max(last.minIdx, BUCKET_INDEX[pack.guaranteedMin]);
  }
  return reqs;
}

const matchesReq = (registry: CardRegistry, c: CardDef, req: SlotReq): boolean => {
  const v = registry.variant(c.variantId);
  if (req.serialized != null && v.serialized !== req.serialized) return false;
  if (req.groups && !req.groups.includes(v.group)) return false;
  return true;
};

/** ¿El requisito exige filtrar el pool (grupo/serie/no-repetible)? Si no, se usa el pool base (rápido). */
const needsFilter = (req: SlotReq, repeatable: boolean): boolean =>
  req.groups != null || req.serialized != null || !repeatable;

/** Pool filtrado por requisito + repetibilidad (solo ruta lenta: garantías por grupo/serie). */
function filtered(registry: CardRegistry, pool: Pool, req: SlotReq, drawn: Set<string>, repeatable: boolean): Pool {
  const out: Pool = { common: [], uncommon: [], rare: [], epic: [], legendary: [] };
  for (const b of BUCKETS) {
    if (BUCKET_INDEX[b] < req.minIdx) continue;
    out[b] = pool[b].filter((c) => matchesReq(registry, c, req) && (repeatable || !drawn.has(c.id)));
  }
  return out;
}

/** Bucket con probabilidad ponderada entre buckets con stock e índice >= minIdx (fallback: más alto). */
function rollBucket(weights: Record<RarityBucket, number>, pool: Pool, minIdx: number, rng: Rng): RarityBucket | null {
  let total = 0, usableCount = 0;
  for (const b of BUCKETS) if (BUCKET_INDEX[b] >= minIdx && pool[b].length > 0) { usableCount++; total += weights[b] || 0; }
  if (usableCount === 0) return null;
  if (total <= 0) { // ningún peso: el más alto disponible
    for (let i = BUCKETS.length - 1; i >= 0; i--) { const b = BUCKETS[i]; if (BUCKET_INDEX[b] >= minIdx && pool[b].length > 0) return b; }
  }
  let roll = rng.next() * total;
  for (const b of BUCKETS) {
    if (BUCKET_INDEX[b] < minIdx || pool[b].length === 0) continue;
    roll -= weights[b] || 0;
    if (roll <= 0) return b;
  }
  for (let i = BUCKETS.length - 1; i >= 0; i--) { const b = BUCKETS[i]; if (BUCKET_INDEX[b] >= minIdx && pool[b].length > 0) return b; }
  return null;
}

/**
 * DECIDE las cartas de UN sobre (sin acuñar). Determinista dado (pack, ctx). Devuelve las decisiones en
 * ORDEN DE SORTEO (el orden de revelado lo aplica la orquestación tras acuñar, para respetar seriales).
 */
export function openPack(registry: CardRegistry, pack: PackDef, ctx: DecideContext): OpenPackResult {
  const rng = makeRng(ctx.seed);
  const { pool, flat: flatAll } = buildPool(registry, pack);
  const reqs = slotRequirements(pack);
  const repeatable = pack.repeatable !== false;
  const policy = pack.antiDuplicate ?? "allow";

  const owned = ctx.owned;
  const drawn = new Set<string>();
  let pity = ctx.pity;

  const decisions: DropDecision[] = [];
  for (let i = 0; i < pack.cardCount; i++) {
    // Requisito efectivo del hueco (+ pity si está pendiente).
    const req: SlotReq = { ...reqs[i] };
    const forcedByPity = pack.pity != null && pityDue(pack, pity);
    if (forcedByPity) req.minIdx = Math.max(req.minIdx, BUCKET_INDEX[pack.pity!.minBucket]);

    // Ruta rápida (pool base, sin copiar) o lenta (garantías por grupo/serie) con fallback si vacía.
    const slow = needsFilter(req, repeatable);
    let fp = slow ? filtered(registry, pool, req, drawn, repeatable) : pool;
    let bucket = rollBucket(pack.weights, fp, slow ? 0 : req.minIdx, rng);
    if (!bucket && slow) {
      fp = filtered(registry, pool, { ...req, minIdx: 0 }, drawn, repeatable);
      bucket = rollBucket(pack.weights, fp, 0, rng);
    }
    if (!bucket) continue; // pool imposible para este hueco: se omite

    const candidates = fp[bucket];
    const rawCard = rng.pick(candidates);
    const { card, compensated } = resolveAntiDup(policy, rawCard, candidates, flatAll, owned, registry, rng);
    const finalBucket = bucketForRank(registry.variant(card.variantId).rank);
    drawn.add(card.id);

    decisions.push({
      card, bucket: finalBucket, compensated,
      byPity: forcedByPity && BUCKET_INDEX[finalBucket] >= BUCKET_INDEX[pack.pity!.minBucket],
    });
    pity = updatePity(pack, pity, finalBucket);
  }

  return { decisions, pityAfter: pity };
}
