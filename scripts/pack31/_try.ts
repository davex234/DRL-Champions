import { evalPlan } from "./_explore";
import type { ClassTable, MainPackPlan, PackCardClass } from "@/domain/packs/packClass";
const T = (o: Partial<Record<PackCardClass, number>>): ClassTable => ({ base: 0, plata: 0, oro: 0, masters: 0, champions: 0, prime: 0, icon: 0, ...o });
const plans: Record<string, MainPackPlan> = JSON.parse(process.env.PLANS!);
for (const [ids, plan] of Object.entries(plans)) for (const id of ids.split(",")) {
  const p = { ...plan, regular: T(plan.regular), featured: T(plan.featured) };
  const x = evalPlan(id, p, (plan as unknown as { price?: number }).price);
  console.log("error" in x ? `${id}: ${x.error}` : `${x.id.padEnd(14)} ${String(x.price).padStart(6)} ${x.cards}c EV ${String(x.ev).padStart(6)} ${x.perCredit}/cr best ${x.best.p50}/${x.best.p90}/${x.best.p99} ≥90 ${x.ge90}% ≥93 ${x.ge93}% ≥95 ${x.ge95}% 2×90 ${x.two90}% P/I ${x.jackpot}% salv ${x.salvage}%`);
}
