/**
 * ICON (2026-10-09) · AUDITORÍA ECONÓMICA EXACTA (sin simular) de la RC frente a PRODUCCIÓN (`drl-0.1.1-1-e5db60b6`).
 *
 *   npx tsx scripts/_icon-odds/audit-econ.ts [out.json]
 *
 * «Antes» = el plan de Pack Opening 3.0 que corre hoy en producción (Icon por tabla de la destacada; Sobre Icon de 3
 * cartas Prime/Icon a 60.000; receta Champions → Icon 2:1), reconstruido aquí tal cual. «Después» = el código de la RC.
 * Mismas piezas que el servidor: pools por clase (`packClassPools`), inclinación, tabla de calidad, `tierIdentity`.
 * Recetas: valor que entra frente a valor que sale (sobres: `PACK_STATS`; cartas: media de la clase), prima de coste, y
 * el bucle comprar → craftear → abrir → desguazar (créditos que vuelven por crédito gastado).
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { readFileSync } from "node:fs";
import { getPack } from "@/data/packs";
import { PACK_STATS } from "@/data/packStats";
import { marketValue } from "@/domain/economy/pricing";
import { salvageValue } from "@/domain/economy/salvage";
import { MAIN_PACK_LINE, MAIN_PACK_PLAN, PACK_CLASS_ORDER, packCardClass, type ClassTable, type MainPackPlan } from "@/domain/packs/packClass";
import { packClassPools } from "@/domain/packs/packPools";
import { slotTables, slotCardProbabilities, tierIdentity, type ClassPools } from "@/domain/packs/tierIdentity";
import { classEconomy } from "@/domain/crafting/floors";
import type { CardDef } from "@/domain/cards/types";

const OUT = process.argv[2] ?? "docs/product/qa/icon-odds/economy-audit.json";
const z = { base: 0, plata: 0, oro: 0, masters: 0, champions: 0, prime: 0, icon: 0 };
const t = (o: Partial<ClassTable>): ClassTable => ({ ...z, ...o });

/** PRODUCCIÓN hoy (Pack Opening 3.0, e5db60b6): tablas por mil con la Icon dentro de la destacada. */
const PROD: Record<string, { plan: MainPackPlan; price: number }> = {
  estandar: { price: 2500, plan: { cards: 5, ovrTilt: 0.3, regular: t({ base: 720, plata: 250, oro: 30 }), featured: t({ base: 250, plata: 400, oro: 200, masters: 100, champions: 30, prime: 15, icon: 5 }) } },
  premium: { price: 6000, plan: { cards: 6, ovrTilt: 0.22, regular: t({ plata: 820, oro: 150, masters: 30 }), featured: t({ plata: 150, oro: 395, masters: 290, champions: 100, prime: 50, icon: 15 }) } },
  oro: { price: 12000, plan: { cards: 5, ovrTilt: 0.12, regular: t({ oro: 700, masters: 270, champions: 30 }), featured: t({ oro: 200, masters: 350, champions: 220, prime: 150, icon: 80 }) } },
  masters: { price: 20000, plan: { cards: 5, ovrTilt: 0.03, regular: t({ oro: 350, masters: 520, champions: 130 }), featured: t({ masters: 300, champions: 290, prime: 260, icon: 150 }) } },
  champions: { price: 35000, plan: { cards: 5, ovrTilt: 0, regular: t({ oro: 200, masters: 330, champions: 400, prime: 70 }), featured: t({ champions: 300, prime: 420, icon: 280 }) } },
  icon: { price: 60000, plan: { cards: 3, ovrTilt: 0, regular: t({ prime: 720, icon: 280 }), featured: t({ prime: 500, icon: 500 }) } },
};

interface Row {
  price: number; cards: number; ev: number; evPerCredit: number; salvage: number; salvagePct: number;
  pAtLeastOneIcon: number; iconsPerPack: number; costPerIcon: number | null;
  icon95PerPack: number; costPerIcon95: number | null; pAtLeastOne95: number;
}

function measure(plan: MainPackPlan, price: number, pools: ClassPools, weightOf: (c: CardDef) => number): Row {
  const slots = slotTables(plan).map((tb) => slotCardProbabilities(tb, pools, plan, weightOf));
  let ev = 0, sv = 0, icons = 0, icon95 = 0;
  let noIcon = 1, no95 = 1;
  for (const s of slots) {
    let pIcon = 0, p95 = 0;
    for (const { card, p } of s.values()) {
      ev += p * marketValue(card); sv += p * salvageValue(card);
      if (packCardClass(card) === "icon") { pIcon += p; if (card.ovr >= 95) icon95 += p; }
      if (card.ovr >= 95) p95 += p;
    }
    icons += pIcon; noIcon *= 1 - pIcon; no95 *= 1 - p95;
  }
  const r = (x: number, d = 4) => Math.round(x * 10 ** d) / 10 ** d;
  return {
    price, cards: plan.cards, ev: Math.round(ev), evPerCredit: r(ev / price), salvage: Math.round(sv), salvagePct: r(sv / price),
    pAtLeastOneIcon: r(1 - noIcon, 6), iconsPerPack: r(icons, 6), costPerIcon: icons > 0 ? Math.round(price / icons) : null,
    icon95PerPack: r(icon95, 6), costPerIcon95: icon95 > 0 ? Math.round(price / icon95) : null, pAtLeastOne95: r(1 - no95, 6),
  };
}

// «Antes»: pools del catálogo, peso 1 (producción no tenía tabla de calidad).
const before: Record<string, Row> = {};
for (const [id, { plan, price }] of Object.entries(PROD)) before[id] = measure(plan, price, packClassPools(getPack(id === "icon" ? "icon" : id)!).pools, () => 1);
// «Después»: la RC, con los pesos REALES del servidor.
const after: Record<string, Row> = {};
for (const id of MAIN_PACK_LINE) { const pp = packClassPools(getPack(id)!); after[id] = measure(MAIN_PACK_PLAN[id], getPack(id)!.price, pp.pools, pp.weightOf); }

// ── Recetas de sobres (0059 + cambios de producción): valor que entra/sale, prima de coste, bucle de desguace ──
const PACK_RECIPES = { before: { "estandar→premium": 4, "premium→oro": 3, "oro→masters": 2, "masters→champions": 3, "champions→icon": 2 }, after: { "estandar→premium": 4, "premium→oro": 3, "oro→masters": 2, "masters→champions": 3, "champions→icon": 3 } } as const;
const recipeRows = (which: "before" | "after", stats: Record<string, Row>) => Object.fromEntries(Object.entries(PACK_RECIPES[which]).map(([k, q]) => {
  const [a, b] = k.split("→");
  const valueIn = q * stats[a].ev, valueOut = stats[b].ev, costIn = q * stats[a].price, costOut = stats[b].price;
  return [k, { qty: q, valueIn, valueOut, createsValue: valueOut > valueIn, valueRatio: +(valueOut / valueIn).toFixed(4), craftCostOverBuy: +(costIn / costOut).toFixed(4),
    // comprar las entradas → craftear → abrir → desguazar todo: créditos que vuelven por crédito gastado
    salvageLoop: +(stats[b].salvage / costIn).toFixed(4) }];
}));

// Recetas de CARTAS (0059: por clase; Prime → Icon DESACTIVADA): valor medio de la clase de entrada × cantidad vs salida.
const sql = readFileSync("supabase/migrations/0059_crafting_missions.sql", "utf8");
const ce = classEconomy();
const cardRecipes = [...sql.matchAll(/\('(card-[a-z-]+)',\s*'CARD',\s*'[^']+',\s*null,\s*null,\s*'([a-z]+)',\s*'([a-z]+)',\s*(\d+),\s*'(ACTIVE|DISABLED)'/g)].map((m) => ({
  id: m[1], from: m[2], to: m[3], qty: Number(m[4]), status: m[5],
  valueIn: Math.round(Number(m[4]) * ce[m[2] as keyof typeof ce].marketMean), valueOut: Math.round(ce[m[3] as keyof typeof ce].marketMean),
})).map((r) => ({ ...r, createsValue: r.valueOut > r.valueIn }));

// Desguace: tope F57.6 (≤ 6 % del precio en la línea) y liquidación total < 70 % en todo sobre comprable (packStats, motor real).
const salvageCheck = Object.fromEntries(MAIN_PACK_LINE.map((id) => [id, { measuredPct: +(PACK_STATS[id].meanSalvage / PACK_STATS[id].price).toFixed(4), within6pct: PACK_STATS[id].meanSalvage / PACK_STATS[id].price <= 0.06 }]));

const out = {
  generatedAt: new Date().toISOString(), method: "exacto (tierIdentity / slotCardProbabilities), mismos pools y pesos que el servidor",
  packs: { before, after }, packRecipes: { before: recipeRows("before", before), after: recipeRows("after", after) }, cardRecipes, salvageCheck,
  classes: Object.fromEntries(PACK_CLASS_ORDER.map((k) => [k, { cards: ce[k].cards, marketMean: Math.round(ce[k].marketMean), directCostPerCard: ce[k].directCostPerCard && Math.round(ce[k].directCostPerCard) }])),
};
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out, null, 1) + "\n");
const fmt = (n: number | null) => (n === null ? "—" : n.toLocaleString("es-ES"));
console.log("sobre        | precio      | EV (antes→después) | EV/crédito     | P(≥1 ICON)      | coste/ICON          | coste/ICON 95        | P(≥1 carta 95)  | desguace");
for (const id of MAIN_PACK_LINE) {
  const a = before[id], b = after[id];
  const ab = (f: (r: Row) => string) => (a ? `${f(a)} → ${f(b)}` : `nuevo → ${f(b)}`);
  console.log([id.padEnd(12), ab((r) => fmt(r.price)), ab((r) => fmt(r.ev)), ab((r) => r.evPerCredit.toFixed(3)), ab((r) => (r.pAtLeastOneIcon * 100).toFixed(2) + "%"), ab((r) => fmt(r.costPerIcon)), ab((r) => fmt(r.costPerIcon95)), ab((r) => (r.pAtLeastOne95 * 100).toFixed(2) + "%"), ab((r) => (r.salvagePct * 100).toFixed(2) + "%")].join(" | "));
}
console.log("\nrecetas de sobres (después):", JSON.stringify(out.packRecipes.after));
console.log("recetas de cartas:", JSON.stringify(cardRecipes.map((r) => [r.id, r.status, r.qty, r.valueIn, r.valueOut, r.createsValue ? "CREA" : "ok"])));
console.log("desguace:", JSON.stringify(salvageCheck));
console.log(`→ ${OUT}`);
