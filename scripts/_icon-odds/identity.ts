/** Instrumento ICON-ODDS: identidad EXACTA (tierIdentity) de la línea, en el formato de tierIdentity.test. */
import { getPack } from "@/data/packs";
import { MAIN_PACK_LINE, mainPackPlan } from "@/domain/packs/packClass";
import { tierIdentity } from "@/domain/packs/tierIdentity";
import { packClassPools } from "@/domain/packs/packPools";
import { marketValue } from "@/domain/economy/pricing";
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
for (const id of MAIN_PACK_LINE) {
  const pp = packClassPools(getPack(id)!); const r = tierIdentity(mainPackPlan(id)!, pp.pools, marketValue, pp.weightOf);
  console.log(`${id}: { best: [${r.best.p50}, ${r.best.p90}, ${r.best.p99}], ge90: ${r4(r.bestAtLeast[90])}, ge95: ${r4(r.bestAtLeast[95])}, two90: ${r4(r.ge90Count.atLeast2)}, jackpot: ${r4(r.jackpot)}, perCredit: ${(r.expectedValue / getPack(id)!.price).toFixed(3)} },  // mean best ${r.best.mean.toFixed(3)} 3x90 ${r4(r.ge90Count.atLeast3)} ovr ${r.meanOvr.toFixed(2)}`);
}
