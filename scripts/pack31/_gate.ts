import { PACKS } from "@/data/packs";
import { packEconomyReport, economyLimits } from "@/domain/packs/economyGate";
import { isPurchasable } from "@/domain/packs/lifecycle";
console.log("límites", JSON.stringify(economyLimits()));
for (const p of PACKS) { const r = packEconomyReport(p); console.log(`${p.id.padEnd(15)} ${String(p.price).padStart(6)} buy:${isPurchasable(p) ? "Y" : "n"} plan:${r.hasPlan ? "Y" : "n"} ${r.perCredit?.toFixed(3) ?? "-"}/cr p95 ${(r.p95 * 100).toFixed(2)}% salv ${r.salvageOverPrice !== null ? (r.salvageOverPrice * 100).toFixed(1) : "-"}% pool ${r.poolSize} team ${r.teamCards} ${r.issues.map((i) => i.code).join(",") || "OK"}`); }
