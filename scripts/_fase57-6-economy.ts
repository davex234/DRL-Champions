/**
 * FASE 57.6 · ECONOMÍA DE TODOS LOS SOBRES (pura: sin escrituras, sin cuentas). Fuera de CI.
 *
 * Motor REAL (`PackEngine`) con los pools REALES de producción: `pool-snapshot-v942.json` es la salida de
 * `app_content_distribution_snapshot()` (SELECT, función `stable`) y se compone con `composeDistribution`, igual que
 * `server/catalog/distribution.ts`. Valor = `marketValue`, liquidación = `salvageValue` (la única vía de convertir una
 * carta en créditos desde la F57.6). Se informa además la venta rápida local ANTERIOR (80 % del valor) como referencia.
 *
 *   npx tsx scripts/_fase57-6-economy.ts --label before|after [--n 200000]
 */
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CardRegistry } from "@/collection";
import { PackEngine } from "@/pack/engine";
import { PACKS } from "@/data/packs";
import { PACK_STATS } from "@/data/packStats";
import { freshPity } from "@/domain/packs/pity";
import { buildPool } from "@/domain/packs/pool";
import { packLifecycle } from "@/domain/packs/lifecycle";
import { composeDistribution, type PackDistribution, type PoolDef } from "@/domain/packs/distribution";
import { marketValue } from "@/domain/economy/pricing";
import { salvageValue } from "@/domain/economy/salvage";
import { MAIN_PACK_LINE, packCardClass } from "@/domain/packs/packClass";
import type { CardDef } from "@/domain/cards/types";

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined; };
const N = Number(arg("n") ?? 200_000);
const LABEL = arg("label") ?? "after";
const OUT = join("docs", "product", "qa", "fase57-6-economy-final");
mkdirSync(OUT, { recursive: true });
const r2 = (x: number) => Math.round(x * 100) / 100;
const r4 = (x: number) => Math.round(x * 10_000) / 10_000;
const q = (s: number[], p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];

/* ── pools reales ── */
type Snap = {
  version: number;
  pools: { id: string; mode: PoolDef["mode"]; rules: PoolDef["rules"]; available_from: string | null; available_to: string | null }[];
  entries: { pool_id: string; card_id: string; weight: string | number; mode: "INCLUDE" | "EXCLUDE" }[];
  packPools: { pack_id: string; pool_id: string; priority: number }[];
};
const snap = JSON.parse(readFileSync(join(OUT, "pool-snapshot-v942.json"), "utf8")) as Snap;
const pools = new Map<string, PoolDef>();
for (const p of snap.pools) pools.set(p.id, { id: p.id, mode: p.mode, rules: p.rules ?? {}, entries: [], availableFrom: p.available_from ? Date.parse(p.available_from) : null, availableTo: p.available_to ? Date.parse(p.available_to) : null });
for (const e of snap.entries) pools.get(e.pool_id)?.entries.push({ cardId: e.card_id, weight: Number(e.weight), mode: e.mode });
const byPack = new Map<string, PackDistribution>();
const lists = new Map<string, { pool: PoolDef; priority: number }[]>();
for (const pp of snap.packPools) { const pool = pools.get(pp.pool_id); if (!pool) continue; const l = lists.get(pp.pack_id) ?? []; l.push({ pool, priority: pp.priority }); lists.set(pp.pack_id, l); }
for (const [id, l] of lists) { const d = composeDistribution(l, Date.now()); if (d) byPack.set(id, d); }

const reg = new CardRegistry();
const engine = new PackEngine(reg, (id) => byPack.get(id) ?? null);
const legacyQuickSell = (c: CardDef) => Math.round((marketValue(c) * 0.8) / 5) * 5;

type Row = Record<string, unknown>;
const rows: Row[] = [];
for (const pack of PACKS) {
  const life = packLifecycle(pack);
  const status = pack.price <= 0 ? "RECOMPENSA" : life === "DRAFT" ? "NO COMPRABLE" : life === "RETIRED" ? "NO COMPRABLE" : MAIN_PACK_LINE.includes(pack.id) ? (pack.id === "icon" ? "PREMIUM" : "OK") : "OK";
  const buyable = pack.price > 0 && life === "ACTIVE";
  const dist = byPack.get(pack.id) ?? null;
  const poolSize = buildPool(reg, pack, dist).flat.length;
  const vals: number[] = [], salv: number[] = [], qs: number[] = [];
  let prime = 0, icon = 0, cards = 0, ovr = 0, packsWithPrimeOrIcon = 0;
  for (let i = 0; i < N; i++) {
    const r = engine.draw(pack, { seed: (i * 2246822519 + 13) >>> 0, owned: [], mintCounts: {}, pity: freshPity(), now: 0 });
    let v = 0, s = 0, k = 0, hit = false;
    for (const ins of r.instances) {
      const c = reg.card(ins.cardId)!;
      v += marketValue(c); s += salvageValue(c); k += legacyQuickSell(c);
      const cls = packCardClass(c); cards++; ovr += c.ovr;
      if (cls === "prime") { prime++; hit = true; }
      if (cls === "icon") { icon++; hit = true; }
    }
    if (hit) packsWithPrimeOrIcon++;
    vals.push(v); salv.push(s); qs.push(k);
  }
  vals.sort((a, b) => a - b); salv.sort((a, b) => a - b); qs.sort((a, b) => a - b);
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  const ev = mean(vals), sev = mean(salv), qev = mean(qs);
  const per = (x: number) => (pack.price > 0 ? r4(x / pack.price) : null);
  rows.push({
    packId: pack.id, name: pack.name, kind: pack.kind ?? "normal", lifecycle: life, buyable, status,
    price: pack.price, cards: pack.cardCount, poolSize, restrictRegion: pack.restrictRegion ?? null, team: pack.team ?? null,
    boostedTeamCards: dist && !dist.uniform ? [...pools.values()].find((p) => p.id === `boost-${pack.id}`)?.entries.length ?? null : null,
    ev: Math.round(ev), evOverPrice: per(ev),
    p10: q(vals, 0.1), p50: q(vals, 0.5), p90: q(vals, 0.9), p99: q(vals, 0.99), min: vals[0], max: vals[N - 1],
    salvageEV: Math.round(sev), salvageOverPrice: per(sev), salvageP99: q(salv, 0.99), salvageMax: salv[N - 1],
    pSalvageAtLeastPrice: pack.price > 0 ? r4(salv.filter((x) => x >= pack.price).length / N) : null,
    legacyQuickSellEV: Math.round(qev), legacyQuickSellOverPrice: per(qev), pLegacyQuickSellAtLeastPrice: pack.price > 0 ? r4(qs.filter((x) => x >= pack.price).length / N) : null,
    primePerCard: r4(prime / cards), iconPerCard: r4(icon / cards), pPackPrimeOrIcon: r4(packsWithPrimeOrIcon / N),
    meanOvr: r2(ovr / cards), packStatsMeanValue: PACK_STATS[pack.id]?.meanValue ?? null, packStatsMeanSalvage: PACK_STATS[pack.id]?.meanSalvage ?? null,
  });
  console.log(`${pack.id.padEnd(14)} ${String(pack.price).padStart(6)} ${life.padEnd(8)} EV/p ${per(ev) ?? "—"} · desguace/p ${per(sev) ?? "—"} · Prime ${r2((prime / cards) * 100)} % · Icon ${r2((icon / cards) * 100)} % · pool ${poolSize}`);
}

/* ── banda de la línea principal ── */
const five = rows.filter((r) => MAIN_PACK_LINE.includes(r.packId as string) && r.packId !== "icon");
const ratios = five.map((r) => r.evOverPrice as number).sort((a, b) => a - b);
const median = ratios[2];
const BAND = 0.12;
const band = { median, lo: r4(median * (1 - BAND)), hi: r4(median * (1 + BAND)), tolerance: BAND };
for (const r of rows) r.vsMainMedian = r.evOverPrice == null ? null : r2(((r.evOverPrice as number) / median - 1) * 100);

writeFileSync(join(OUT, `all-pack-economy-${LABEL}.json`), JSON.stringify({ label: LABEL, samplesPerPack: N, poolSnapshotVersion: snap.version, mainBand: band, packs: rows }, null, 2));
console.log(`banda principal: mediana ${median}× · ±12 % = ${band.lo}–${band.hi}× → ${join(OUT, `all-pack-economy-${LABEL}.json`)}`);
