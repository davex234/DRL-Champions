/** PACK OPENING 3.1 · composición por CLASE de los pools especiales (instrumento). */
import { getPack } from "@/data/packs";
import { buildPool } from "@/domain/packs/pool";
import { packCardClass, PACK_CLASS_ORDER } from "@/domain/packs/packClass";
import { marketValue } from "@/domain/economy/pricing";
import { REG, distFor } from "./_lib";
for (const id of process.argv.slice(2)) {
  const p = getPack(id)!; const d = distFor(id); const { flat } = buildPool(REG, p, d);
  const parts = PACK_CLASS_ORDER.map((k) => { const cs = flat.filter((c) => packCardClass(c) === k); if (!cs.length) return null; const o = cs.map((c) => c.ovr).sort((a, b) => a - b); const boosted = d ? cs.filter((c) => d.weightOf(c.id) > 1).length : 0; return `${k}:${cs.length}[${o[0]}-${o.at(-1)} ≥95:${o.filter((x) => x >= 95).length}${boosted ? ` boost:${boosted}` : ""} v̄${Math.round(cs.reduce((a, c) => a + marketValue(c), 0) / cs.length)}]`; }).filter(Boolean);
  const other = flat.filter((c) => !packCardClass(c)).length;
  console.log(id.padEnd(14), flat.length, parts.join(" "), other ? `sin clase:${other}` : "");
}
