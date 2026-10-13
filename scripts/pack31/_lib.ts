/** PACK OPENING 3.1 · piezas comunes de los instrumentos (fuera de CI/release): motor real + distribución de PRODUCCIÓN. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PackEngine } from "@/pack/engine";
import { CardRegistry } from "@/collection/registry";
import { composeDistribution, type PackDistribution, type PoolDef } from "@/domain/packs/distribution";
import { freshPity } from "@/domain/packs/pity";
import { getPack } from "@/data/packs";
import type { CardDef } from "@/domain/cards/types";

type Snap = { version: number; pools: { id: string; mode: PoolDef["mode"]; rules: PoolDef["rules"]; available_from: string | null; available_to: string | null }[]; entries: { pool_id: string; card_id: string; weight: number | string; mode: "INCLUDE" | "EXCLUDE" }[]; packPools: { pack_id: string; pool_id: string; priority: number }[] };

export const SNAP = JSON.parse(readFileSync(join(process.cwd(), "docs/product/qa/pack31/prod-distribution-snapshot.json"), "utf8")) as Snap;

/** La distribución de cada sobre tal como la compone el servidor (`server/catalog/distribution.ts#build`). */
export function prodDistributions(now = Date.now()): Map<string, PackDistribution> {
  const pools = new Map<string, PoolDef>();
  for (const p of SNAP.pools) pools.set(p.id, { id: p.id, mode: p.mode, rules: p.rules ?? {}, entries: [], availableFrom: p.available_from ? Date.parse(p.available_from) : null, availableTo: p.available_to ? Date.parse(p.available_to) : null });
  for (const e of SNAP.entries) pools.get(e.pool_id)?.entries.push({ cardId: e.card_id, weight: Number(e.weight), mode: e.mode });
  const by = new Map<string, { pool: PoolDef; priority: number }[]>();
  for (const pp of SNAP.packPools) { const pool = pools.get(pp.pool_id); if (!pool) continue; by.set(pp.pack_id, [...(by.get(pp.pack_id) ?? []), { pool, priority: pp.priority }]); }
  const out = new Map<string, PackDistribution>();
  for (const [id, list] of by) { const d = composeDistribution(list, now); if (d) out.set(id, d); }
  return out;
}

export const REG = new CardRegistry();
const DISTS = prodDistributions();
export const PROD_ENGINE = new PackEngine(REG, (id) => DISTS.get(id) ?? null);
export const distFor = (id: string) => DISTS.get(id) ?? null;

export function drawCards(packId: string, seed: number, engine = PROD_ENGINE): CardDef[] {
  return engine.draw(getPack(packId)!, { seed, owned: [], mintCounts: {}, pity: freshPity(), now: 0 }).instances.map((i) => REG.card(i.cardId)!);
}
