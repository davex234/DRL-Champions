/**
 * PACKS (Fase 6) — pools y drop tables sobre el catálogo aplicado, REUTILIZANDO `buildPool`
 * (el constructor de pools REAL de domain/packs) con el CardRegistry nuevo. Odds = pesos del
 * PackDef normalizados entre buckets no vacíos (metadatos; el sorteo sigue siendo del motor
 * de sobres, que NO se toca). Solo packs afectados por el patch + los que ganan cartas.
 */
import { buildPool, BUCKETS } from "@/domain/packs/pool";
import { PACKS } from "@/data/packs";
import type { RarityBucket } from "@/domain/packs/types";
import type { MaterializationResult } from "@/materializer";
import type { PacksArtifact, PackPoolArtifact } from "./types";
import type { AppliedCatalog } from "./catalog";

const r4 = (x: number): number => Math.round(x * 10000) / 10000;

export function buildPacks(mat: MaterializationResult, applied: AppliedCatalog): PacksArtifact {
  const affected = new Set(mat.packPatch.pools.map((p) => p.packId));
  const addedBy = new Map(mat.packPatch.pools.map((p) => [p.packId, p.add.map((e) => e.cardId).sort()]));

  const pools: PackPoolArtifact[] = [];
  for (const pack of PACKS) {
    if (!affected.has(pack.id)) continue; // incremental: solo packs con cambios
    const built = buildPool(applied.registry, pack);
    const buckets = Object.fromEntries(BUCKETS.map((b) => [b, built.pool[b].length])) as Record<RarityBucket, number>;
    const activeWeight = BUCKETS.reduce((a, b) => a + (buckets[b] > 0 ? pack.weights[b] : 0), 0);
    const odds = Object.fromEntries(
      BUCKETS.map((b) => [b, activeWeight > 0 && buckets[b] > 0 ? r4(pack.weights[b] / activeWeight) : 0]),
    ) as Record<RarityBucket, number>;
    pools.push({ packId: pack.id, size: built.size, buckets, added: addedBy.get(pack.id) ?? [], odds });
  }
  pools.sort((a, b) => a.packId.localeCompare(b.packId));
  return { pools, invalidated: [...mat.packPatch.invalidate].sort() };
}
