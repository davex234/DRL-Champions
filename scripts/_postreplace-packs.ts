/**
 * POST-REEMPLAZO · AUDITORÍA DE SOBRES (instrumento `_`, fuera de CI, SOLO LECTURA).
 *   npx tsx scripts/_postreplace-packs.ts
 */
import { PACKS } from "../src/data/packs";
import { CardRegistry } from "../src/collection/registry";
import { buildPool } from "../src/domain/packs/pool";
import { getVariant } from "../src/domain/cards/variants";
import { bucketForRank } from "../src/domain/packs/types";
import { isDraft } from "../src/domain/packs/lifecycle";
import { packStats } from "../src/data/packStats";
const reg = new CardRegistry();
for (const p of PACKS) {
  const flat = buildPool(reg, p).flat;
  const by: Record<string, number> = {};
  const ed: Record<string, number> = {};
  for (const c of flat) { const b = bucketForRank(getVariant(c.variantId).rank); by[b] = (by[b] ?? 0) + 1; ed[c.variantId] = (ed[c.variantId] ?? 0) + 1; }
  const s = packStats(p.id);
  const pa = p as any;
  console.log(`${p.id.padEnd(14)} ${(pa.lifecycle ?? "ACTIVE").padEnd(8)} ${String(p.price).padStart(5)}cr n=${String(flat.length).padStart(3)} groups=${JSON.stringify(pa.restrictGroups ?? null)} region=${pa.restrictRegion ?? "-"} team=${pa.team ?? "-"} min=${pa.guaranteedMin ?? "-"} w=${JSON.stringify(p.weights)}`);
  console.log(`   buckets=${JSON.stringify(by)} ediciones=${JSON.stringify(ed)} imposible=${JSON.stringify(s?.impossible ?? null)} ${isDraft(p) ? "(DRAFT)" : ""}`);
}
