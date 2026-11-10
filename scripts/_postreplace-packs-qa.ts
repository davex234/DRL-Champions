/**
 * POST-REEMPLAZO · QA DE TODOS LOS SOBRES (instrumento `_`, fuera de CI, SOLO LECTURA).
 *
 *   npx tsx scripts/_postreplace-packs-qa.ts [HEAD-packs.ts]
 *
 * Para cada sobre del catálogo: pool > 0; entradas del pool persistido (BD, por el túnel) = las que deduce el
 * juego y todas a cartas existentes; rarezas posibles; probabilidades de la tienda (`packStats`) frente a
 * 20.000 aperturas reales del motor; asset del sobre; y precio igual al de HEAD (si el sobre existía en HEAD).
 * Escribe `docs/product/qa/catalog-post-replace/packs-qa.json`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { CARDS } from "../src/data/catalog";
import { PACKS } from "../src/data/packs";
import { packStats } from "../src/data/packStats";
import { packArtwork } from "../src/data/packArtwork";
import { CardRegistry } from "../src/collection/registry";
import { buildPool } from "../src/domain/packs/pool";
import { PackEngine } from "../src/pack";
import { freshPity } from "../src/domain/packs/pity";
import { getVariant } from "../src/domain/cards/variants";
import { bucketForRank, type RarityBucket } from "../src/domain/packs/types";
import { isPurchasable, isDraft } from "../src/domain/packs/lifecycle";
import { serverDistribution } from "../src/server/catalog/distribution";

for (const f of [".env.local", ".env"]) {
  const p = join(process.cwd(), f);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const headSrc = process.argv[2] && existsSync(process.argv[2]) ? readFileSync(process.argv[2], "utf8") : "";
const headPrice = new Map<string, number>();
for (const m of headSrc.matchAll(/id: "([a-z0-9-]+)",[\s\S]*?price: (\d+),/g)) if (!headPrice.has(m[1])) headPrice.set(m[1], Number(m[2]));

const BUCKETS: RarityBucket[] = ["common", "uncommon", "rare", "epic", "legendary"];
const N = 20_000;
let fails = 0;
const fail = (m: string) => { fails++; console.log(`    ✕ ${m}`); };

async function main() {
  const registry = new CardRegistry(CARDS);
  const known = new Set(CARDS.map((c) => c.id));
  const dist = await serverDistribution(db);
  const out: unknown[] = [];
  for (const p of PACKS) {
    const sellable = isPurchasable(p);
    const flat = buildPool(registry, p).flat;
    const buckets = new Set(flat.map((c) => bucketForRank(getVariant(c.variantId).rank)));
    console.log(`  ${p.id.padEnd(15)} ${sellable ? "EN VENTA" : isDraft(p) ? "DRAFT   " : "RETIRADO"} ${String(p.price).padStart(5)} cr · pool ${flat.length}`);
    if (flat.length === 0) fail(`${p.id}: pool vacío`);

    // Distribución persistida (la que usa el servidor): miembros ⊂ catálogo y = pool deducido.
    const d = dist.forPack(p.id);
    const members = d?.members ? [...d.members] : null;
    if (members) {
      const rotas = members.filter((id) => !known.has(id));
      if (rotas.length) fail(`${p.id}: ${rotas.length} entradas a cartas inexistentes`);
      const want = new Set(flat.map((c) => c.id));
      if (members.length !== want.size || members.some((id) => !want.has(id))) fail(`${p.id}: pool persistido (${members.length}) ≠ deducido (${want.size})`);
    } else if (sellable) fail(`${p.id}: en venta sin distribución persistida`);

    // Probabilidades: tienda vs motor real (con la distribución persistida del sobre).
    const s = packStats(p.id);
    const engine = new PackEngine(registry, (id) => (id === p.id ? d ?? null : null));
    const drawn: Record<RarityBucket, number> = { common: 0, uncommon: 0, rare: 0, epic: 0, legendary: 0 };
    let total = 0;
    for (let i = 0; i < N / p.cardCount; i++) {
      const r = engine.open(p, { seed: (0x5eed + i * 7919) >>> 0, owned: [], mintCounts: {}, pity: freshPity(), now: 1_700_000_000_000 });
      if (r.instances.length !== p.cardCount) fail(`${p.id}: abrió ${r.instances.length}/${p.cardCount} cartas`);
      for (const ins of r.instances) {
        if (!known.has(ins.cardId)) fail(`${p.id}: salió ${ins.cardId}, inexistente`);
        drawn[bucketForRank(getVariant(registry.card(ins.cardId)!.variantId).rank)]++; total++;
      }
    }
    const measured = Object.fromEntries(BUCKETS.map((b) => [b, +(drawn[b] / total).toFixed(4)])) as Record<RarityBucket, number>;
    let maxDiff = 0;
    if (s) {
      for (const b of BUCKETS) {
        maxDiff = Math.max(maxDiff, Math.abs(measured[b] - s.drawn[b]));
        if (s.drawn[b] > 0 && !buckets.has(b)) fail(`${p.id}/${b}: la tienda promete una rareza sin cartas`);
        if (s.impossible.includes(b) && buckets.has(b)) fail(`${p.id}/${b}: la tienda la da por imposible y existe`);
      }
      if (maxDiff > 0.02) fail(`${p.id}: tienda ≠ motor (desvío máx. ${maxDiff.toFixed(3)})`);
    } else if (sellable && p.price > 0) fail(`${p.id}: en venta sin estadística de tienda`);

    const art = packArtwork(p.id);
    const artOk = !art || existsSync(join(process.cwd(), "public", art));
    if (sellable && art && !artOk) fail(`${p.id}: artwork ${art} no existe`);
    const hp = headPrice.get(p.id);
    if (hp !== undefined && hp !== p.price) fail(`${p.id}: precio ${p.price} ≠ HEAD ${hp}`);

    out.push({ id: p.id, estado: sellable ? "EN_VENTA" : isDraft(p) ? "DRAFT" : "RETIRADO", price: p.price, priceHead: hp ?? null, pool: flat.length,
      persisted: members?.length ?? null, buckets: [...buckets], shop: s?.drawn ?? null, measured, maxDiff: +maxDiff.toFixed(4), impossible: s?.impossible ?? null,
      artwork: art, artworkOk: artOk });
  }
  const dir = join(process.cwd(), "docs/product/qa/catalog-post-replace");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "packs-qa.json"), JSON.stringify({ n: N, packs: out, fails }, null, 2));
  console.log(`\n  ${PACKS.length} sobres · ${fails === 0 ? "✓ TODO CORRECTO" : `✕ ${fails} fallos`}`);
  process.exit(fails === 0 ? 0 : 1);
}
main().catch((e) => { console.error("✕", e instanceof Error ? e.message : e); process.exit(1); });
