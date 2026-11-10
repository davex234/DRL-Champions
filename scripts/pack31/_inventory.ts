/** PACK OPENING 3.1 · INVENTARIO COMPLETO DE SOBRES (instrumento). Escribe docs/product/qa/pack31/inventory.json. */
import { writeFileSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { PACKS } from "@/data/packs";
import { STORE_CATALOG } from "@/data/storeCatalog";
import { isPurchasable, packLifecycle } from "@/domain/packs/lifecycle";
import { buildPool } from "@/domain/packs/pool";
import { mainPackPlan, packCardClass } from "@/domain/packs/packClass";
import { getVariant } from "@/domain/cards/variants";
import { bucketForRank } from "@/domain/packs/types";
import { REG, distFor, SNAP } from "./_lib";

const store = new Map<string, { enabled: boolean; mode: string }[]>();
for (const sec of (STORE_CATALOG as unknown as { sections?: { products?: { id: string; packId?: string; enabled: boolean; purchaseMode: string }[] }[] }).sections ?? []) for (const p of sec.products ?? []) if (p.packId) store.set(p.packId, [...(store.get(p.packId) ?? []), { enabled: p.enabled, mode: p.purchaseMode }]);
const raw = readFileSync("src/data/storeCatalog.ts", "utf8");
const storeLine = (id: string) => [...raw.matchAll(new RegExp(`\\{ id: "([\\w-]+)",[^}]*packId: "${id}"[^}]*enabled: (true|false)[^}]*purchaseMode: "(\\w+)"`, "g"))].map((m) => `${m[1]}:${m[2] === "true" ? "on" : "off"}:${m[3]}`);
const rewardRefs = (id: string) => {
  try { return execSync(`git grep -l -E "packId: \\"${id}\\"" -- src/data src/domain src/server ':!*.test.*' ':!src/data/packs.ts' ':!src/data/packStats.ts' ':!src/data/storeCatalog.ts'`, { encoding: "utf8" }).trim().split("\n").filter(Boolean); } catch { return []; }
};
const rows = PACKS.map((p) => {
  const d = distFor(p.id);
  const { flat } = buildPool(REG, p, d);
  const byBucket: Record<string, number> = {}, byClass: Record<string, number> = {};
  for (const c of flat) { const b = bucketForRank(getVariant(c.variantId).rank); byBucket[b] = (byBucket[b] ?? 0) + 1; const k = packCardClass(c) ?? "otra"; byClass[k] = (byClass[k] ?? 0) + 1; }
  const ovr = flat.map((c) => c.ovr).sort((a, b) => a - b);
  const pools = SNAP.packPools.filter((x) => x.pack_id === p.id).map((x) => { const pl = SNAP.pools.find((q) => q.id === x.pool_id); const es = SNAP.entries.filter((e) => e.pool_id === x.pool_id); return `${x.pool_id}(${pl?.mode},${es.length}×w${[...new Set(es.map((e) => Number(e.weight)))].join("/")},prio ${x.priority})`; });
  const family = mainPackPlan(p.id) ? "A·línea principal" : p.id === "inicial" ? "F·inicial" : p.team ? "C·equipo" : p.restrictRegion ? "B·regional" : p.eventId === "ewc-2026" ? "D·EWC" : p.eventId ? "E·evento" : "I·otro";
  return {
    id: p.id, name: p.name, family, price: p.price, cards: p.cardCount, lifecycle: packLifecycle(p), purchasable: isPurchasable(p) && p.price > 0, store: storeLine(p.id),
    repeatable: p.repeatable !== false, drawMode: mainPackPlan(p.id) ? "plan 3.0 (ranuras+inclinación)" : "pesos por rareza", weights: p.weights, guaranteedMin: p.guaranteedMin ?? null,
    guarantees: p.guarantees ?? null, pity: p.pity ?? null, region: p.restrictRegion ?? null, team: p.team ?? null, eventId: p.eventId ?? null, antiDup: p.antiDuplicate ?? "allow",
    poolSize: flat.length, poolByBucket: byBucket, poolByClass: byClass, ovr: ovr.length ? { min: ovr[0], median: ovr[Math.floor(ovr.length / 2)], max: ovr.at(-1), ge90: ovr.filter((x) => x >= 90).length, ge95: ovr.filter((x) => x >= 95).length } : null,
    dbPools: pools, rewards: rewardRefs(p.id),
  };
});
writeFileSync("docs/product/qa/pack31/inventory.json", JSON.stringify(rows, null, 2));
for (const r of rows) console.log(`${r.family.padEnd(18)} ${r.id.padEnd(15)} ${String(r.price).padStart(6)} ${r.cards}c ${r.lifecycle.padEnd(7)} buy:${r.purchasable ? "Y" : "n"} store:[${r.store.join(" ")}] ${r.drawMode.slice(0, 8)} w=${JSON.stringify(r.weights)} gMin=${r.guaranteedMin ?? "-"} pity=${r.pity ? "Y" : "-"} reg=${r.region ?? "-"} team=${r.team ?? "-"} pool=${r.poolSize} ${JSON.stringify(r.poolByBucket)} ovr≥90:${r.ovr?.ge90} ≥95:${r.ovr?.ge95} db=${r.dbPools.join(",")} rewards=${r.rewards.join(",") || "-"}`);
