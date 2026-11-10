/** PACK OPENING 3.0 · identidad EXACTA por sobre (instrumento). */
import { PackEngine } from "@/pack/engine";
import { getPack } from "@/data/packs";
import { classPool } from "@/domain/packs/openPack";
import { MAIN_PACK_LINE, mainPackPlan } from "@/domain/packs/packClass";
import { tierIdentity } from "@/domain/packs/tierIdentity";
import { marketValue } from "@/domain/economy/pricing";
const reg = new PackEngine().registry;
const f = (x: number) => (x * 100).toFixed(3) + "%";
for (const id of MAIN_PACK_LINE) {
  const p = getPack(id)!; const plan = mainPackPlan(id)!;
  const r = tierIdentity(plan, classPool(reg as never, p, null), marketValue);
  console.log(`${id.padEnd(9)} best p50/p90/p99 ${r.best.p50}/${r.best.p90}/${r.best.p99} mean ${r.best.mean.toFixed(2)} · ≥90 ${f(r.bestAtLeast[90])} ≥95 ${f(r.bestAtLeast[95])} · 2×≥90 ${f(r.ge90Count.atLeast2)} 3×≥90 ${f(r.ge90Count.atLeast3)} · jackpot ${f(r.jackpot)} · EV ${r.expectedValue.toFixed(1)} (${(r.expectedValue / p.price).toFixed(3)}/cr) · ovr ${r.meanOvr.toFixed(2)}`);
}
