/** PACK OPENING 3.0 · auditoría de pools por clase (instrumento, fuera de CI/release). */
import { PackEngine } from "@/pack/engine";
import { getPack } from "@/data/packs";
import { classPool } from "@/domain/packs/openPack";
import { MAIN_PACK_LINE, MAIN_PACK_DISTRIBUTION, PACK_CLASS_ORDER } from "@/domain/packs/packClass";
const engine = new PackEngine();
const reg = engine.registry;
for (const id of MAIN_PACK_LINE) {
  const p = getPack(id)!;
  console.log(id, p.name, "price", p.price, "cards", p.cardCount, "antiDup", p.antiDuplicate ?? "allow", "repeatable", p.repeatable !== false, "dist", JSON.stringify(MAIN_PACK_DISTRIBUTION[id]));
}
const pools = classPool(reg as never, getPack("premium")!, null);
for (const k of PACK_CLASS_ORDER) {
  const o = pools[k].map((c) => c.ovr).sort((a, b) => a - b);
  if (!o.length) { console.log(k, 0); continue; }
  const hist: Record<number, number> = {}; for (const x of o) hist[x] = (hist[x] ?? 0) + 1;
  console.log(k.padEnd(10), "n", o.length, "min", o[0], "max", o.at(-1), "mean", (o.reduce((a, b) => a + b, 0) / o.length).toFixed(2), ">=90:", o.filter((x) => x >= 90).length, ">=95:", o.filter((x) => x >= 95).length, JSON.stringify(hist));
}
for (const n of ["xross", "aspas", "brawk", "jemkin", "munchkin"]) {
  const cs = [...reg.cards].filter((c: any) => c.id.toLowerCase().startsWith(n + "__") || (c.playerId ?? "").toLowerCase() === n);
  console.log(n, cs.map((c: any) => `${c.id}:${c.variantId}:${c.ovr}`).join(" "));
}
