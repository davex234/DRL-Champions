/**
 * PACK OPENING 3.1 · EXPLORACIÓN EXACTA de planes para sobres especiales (instrumento). Mismo cálculo que el contrato
 * (`tierIdentity`) sobre el pool REAL filtrado del sobre y su sesgo de equipo (distribución de producción).
 *
 *   npx tsx scripts/pack31/_explore.ts
 */
import { getPack } from "@/data/packs";
import { classPool } from "@/domain/packs/openPack";
import { PACK_CLASS_ORDER, type ClassTable, type MainPackPlan, type PackCardClass } from "@/domain/packs/packClass";
import { tierIdentity } from "@/domain/packs/tierIdentity";
import { marketValue } from "@/domain/economy/pricing";
import { salvageValue } from "@/domain/economy/salvage";
import { REG, distFor } from "./_lib";

const T = (o: Partial<Record<PackCardClass, number>>): ClassTable => ({ base: 0, plata: 0, oro: 0, masters: 0, champions: 0, prime: 0, icon: 0, ...o });
export function evalPlan(id: string, plan: MainPackPlan, price = getPack(id)!.price) {
  const pack = { ...getPack(id)!, cardCount: plan.cards };
  const d = distFor(id);
  const pools = classPool(REG as never, pack, d);
  const w = d ? (c: { id: string }) => d.weightOf(c.id) : undefined;
  for (const k of PACK_CLASS_ORDER) for (const t of [plan.regular, plan.featured]) if (t[k] > 0 && pools[k].length === 0) return { id, error: `clase ${k} vacía` };
  const r = tierIdentity(plan, pools, marketValue, w as never);
  const s = tierIdentity(plan, pools, salvageValue, w as never);
  return { id, price, cards: plan.cards, ev: Math.round(r.expectedValue), perCredit: +(r.expectedValue / price).toFixed(3), best: r.best, ge90: +(r.bestAtLeast[90] * 100).toFixed(2), ge93: +(r.bestAtLeast[93] * 100).toFixed(2), ge95: +(r.bestAtLeast[95] * 100).toFixed(2), two90: +(r.ge90Count.atLeast2 * 100).toFixed(2), jackpot: +(r.jackpot * 100).toFixed(2), salvage: +((s.expectedValue / price) * 100).toFixed(2), meanOvr: +r.meanOvr.toFixed(2) };
}
const show = (x: ReturnType<typeof evalPlan>) => console.log("error" in x ? `${x.id}: ${x.error}` : `${x.id.padEnd(14)} ${String(x.price).padStart(6)} ${x.cards}c EV ${String(x.ev).padStart(6)} ${x.perCredit}/cr best ${x.best.p50}/${x.best.p90}/${x.best.p99} ≥90 ${x.ge90}% ≥93 ${x.ge93}% ≥95 ${x.ge95}% 2×90 ${x.two90}% P/I ${x.jackpot}% salv ${x.salvage}% ovr ${x.meanOvr}`);

if (process.argv[1]?.includes("_explore")) {
  const REGIONAL: MainPackPlan = { cards: 5, ovrTilt: 0.25, regular: T({ base: 550, plata: 300, oro: 120, masters: 30 }), featured: T({ plata: 250, oro: 350, masters: 280, champions: 80, prime: 30, icon: 10 }) };
  for (const id of ["emea", "americas", "pacific", "team-heretics", "team-fnatic", "team-g2", "team-liquid", "team-karmine", "team-ns", "team-prx", "team-ge", "team-lev", "team-100t", "team-m8", "team-fut", "team-loud", "team-navi"]) show(evalPlan(id, REGIONAL));
}
