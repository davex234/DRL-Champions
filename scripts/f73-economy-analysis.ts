/**
 * F73 · ANÁLISIS ECONÓMICO DEL CRAFTEO — `npx tsx scripts/f73-economy-analysis.ts [--sims=4000]`
 *
 * Lee (no cambia) la economía congelada: precios y cartas por sobre (`data/packs`), probabilidades por clase
 * (`MAIN_PACK_DISTRIBUTION`), estadísticas del motor real (`PACK_STATS`, 20.000 aperturas), `marketValue` y
 * `salvageValue`. Deriva los ratios con `domain/crafting/economy.ts` y SIMULA con el motor de apertura real los bucles
 * de explotación. Escribe `docs/product/qa/fase73/economy-analysis.json`.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runtimePackEngine } from "@/publisher/runtime";
import { CARDS, getCard } from "@/data/catalog";
import { getPack } from "@/data/packs";
import { PACK_STATS } from "@/data/packStats";
import { MAIN_PACK_LINE, MAIN_PACK_DISTRIBUTION, PACK_CLASS_ORDER, packCardClass, type PackCardClass } from "@/domain/packs/packClass";
import { marketValue } from "@/domain/economy/pricing";
import { salvageValue } from "@/domain/economy/salvage";
import { analyzeRatio, CRAFT_PREMIUM, CRAFT_MAX_INPUT, type RatioAnalysis } from "@/domain/crafting/economy";
import type { OwnedCard } from "@/domain/cards/types";

const SIMS = Number(process.argv.find((a) => a.startsWith("--sims="))?.split("=")[1] ?? 4000);
const OUT = join(process.cwd(), process.env.F73_ECON_OUT ?? "docs/product/qa/fase73");
mkdirSync(OUT, { recursive: true });

/* ── 1 · Clases de carta: pool real (cartas del catálogo con clase), mínimo/medio de valor y desguace ── */
const byClass = Object.fromEntries(PACK_CLASS_ORDER.map((k) => [k, CARDS.filter((c) => packCardClass(c) === k)])) as Record<PackCardClass, typeof CARDS>;
const classStats = Object.fromEntries(PACK_CLASS_ORDER.map((k) => {
  const cs = byClass[k];
  const mv = cs.map(marketValue), sv = cs.map(salvageValue);
  // Coste directo de UNA carta de la clase: el mejor sobre comprable de la línea principal para esa clase.
  const direct = MAIN_PACK_LINE.map((id) => {
    const p = getPack(id)!; const pct = MAIN_PACK_DISTRIBUTION[id as keyof typeof MAIN_PACK_DISTRIBUTION][k] / 100;
    return pct > 0 ? { pack: id, costPerCard: p.price / (p.cardCount * pct) } : null;
  }).filter(Boolean) as { pack: string; costPerCard: number }[];
  const best = direct.sort((a, b) => a.costPerCard - b.costPerCard)[0] ?? null;
  return [k, {
    cards: cs.length,
    marketMin: Math.min(...mv), marketMean: Math.round(mv.reduce((s, x) => s + x, 0) / cs.length), marketMax: Math.max(...mv),
    salvageMin: Math.min(...sv), salvageMean: Math.round(sv.reduce((s, x) => s + x, 0) / cs.length), salvageMax: Math.max(...sv),
    directCostPerCard: best ? Math.round(best.costPerCard) : null, directBestPack: best?.pack ?? null,
  }];
})) as Record<PackCardClass, { cards: number; marketMin: number; marketMean: number; marketMax: number; salvageMin: number; salvageMean: number; salvageMax: number; directCostPerCard: number | null; directBestPack: string | null }>;

/* ── 2 · Recetas de SOBRES: pares consecutivos de la línea principal ── */
const packRecipes = MAIN_PACK_LINE.slice(0, -1).map((lo, i) => {
  const hi = MAIN_PACK_LINE[i + 1];
  const L = PACK_STATS[lo], H = PACK_STATS[hi];
  const a = analyzeRatio({ cost: L.price, value: L.meanValue, salvage: L.meanSalvage }, { cost: H.price, value: H.meanValue, salvage: H.meanSalvage });
  return { id: `pack-${lo}-${hi}`, kind: "PACK" as const, ...a, inputSide: a.input, outputSide: a.output, input: lo, output: hi };
});

/* ── 3 · Recetas de CARTAS (intercambio): clase → clase siguiente. Entrada = peor caso (la más barata), salida = media ── */
const cardRecipes = PACK_CLASS_ORDER.slice(0, -1).map((k, i) => {
  const next = PACK_CLASS_ORDER[i + 1];
  const I = classStats[k], O = classStats[next];
  const a = analyzeRatio(
    { cost: I.directCostPerCard ?? 0, value: I.marketMin, salvage: I.salvageMin },
    { cost: O.directCostPerCard ?? 0, value: O.marketMean, salvage: O.salvageMean },
  );
  // Escasez: una clase de salida con muy pocas cartas convierte el intercambio en una garantía de alta categoría.
  const scarce = O.cards < 10;
  return { id: `card-${k}-${next}`, kind: "CARD" as const, ...a, inputSide: a.input, outputSide: a.output, input: k, output: next, outputPoolSize: O.cards, scarceOutput: scarce, proposedStatus: a.viable && !scarce ? "ACTIVE" : "DISABLED" };
});

/* ── 4 · SIMULACIONES con el motor real ── */
const engine = runtimePackEngine();
let seed = 73_000_001;
function open(packId: string) {
  const r = engine.open(getPack(packId)!, { seed: seed++, owned: [] as OwnedCard[], mintCounts: {}, pity: { version: 1, counters: {} } as never, now: 0 });
  return (r.instances as { cardId: string }[]).map((x) => getCard(x.cardId)!).filter(Boolean);
}
const salvageAll = (cs: ReturnType<typeof open>) => cs.reduce((s, c) => s + salvageValue(c), 0);
const valueAll = (cs: ReturnType<typeof open>) => cs.reduce((s, c) => s + marketValue(c), 0);

function simPackLoop(r: (typeof packRecipes)[number]) {
  // Compra X sobres inferiores → craftea 1 superior → ábrelo → desguaza TODO. Y la alternativa: abrir los X inferiores.
  let spent = 0, back = 0, valueCraft = 0, valueDirect = 0, best = -Infinity, worst = Infinity;
  for (let i = 0; i < SIMS; i++) {
    const cost = r.ratio * getPack(r.input)!.price;
    const out = open(r.output);
    const s = salvageAll(out);
    spent += cost; back += s; valueCraft += valueAll(out);
    let v = 0; for (let j = 0; j < r.ratio; j++) v += valueAll(open(r.input));
    valueDirect += v;
    best = Math.max(best, s - cost); worst = Math.min(worst, s - cost);
  }
  return { cycles: SIMS, creditsSpent: spent, creditsBack: back, netPerCycle: Math.round((back - spent) / SIMS), bestCycleNet: best, worstCycleNet: worst,
    meanValueCrafted: Math.round(valueCraft / SIMS), meanValueOpeningInputs: Math.round(valueDirect / SIMS), profitable: back > spent };
}

function simCardLoop(r: (typeof cardRecipes)[number]) {
  // Con entradas del PEOR caso (las más baratas de la clase): craftea → salida aleatoria real → desguaza la salida.
  // Frente a desguazar directamente las X entradas. Y el ciclo «compra sobres para fabricar las entradas».
  const inCards = byClass[r.input].slice().sort((a, b) => marketValue(a) - marketValue(b));
  const cheapest = inCards[0];
  const pool = byClass[r.output];
  let salvIn = 0, salvOut = 0, valIn = 0, valOut = 0, maxOut = 0;
  for (let i = 0; i < SIMS; i++) {
    const out = pool[Math.floor(((seed = (seed * 48271) % 2147483647) / 2147483647) * pool.length)];
    salvIn += r.ratio * salvageValue(cheapest); valIn += r.ratio * marketValue(cheapest);
    salvOut += salvageValue(out); valOut += marketValue(out); maxOut = Math.max(maxOut, salvageValue(out));
  }
  const costViaPacks = r.ratio * (classStats[r.input].directCostPerCard ?? 0);
  return { cycles: SIMS, inputCard: cheapest.id, salvageInputs: salvIn / SIMS, salvageOutputMean: Math.round(salvOut / SIMS), salvageOutputMax: maxOut,
    valueInputs: valIn / SIMS, valueOutputMean: Math.round(valOut / SIMS),
    creditsBuyingInputsViaPacks: Math.round(costViaPacks), directCostOutputViaPacks: classStats[r.output].directCostPerCard,
    salvageLoopProfitable: salvOut > salvIn, cheaperThanBuying: costViaPacks < (classStats[r.output].directCostPerCard ?? Infinity) };
}

/* ── 5 · Bucles de fuentes gratuitas (acotados por su propio tope) ── */
const freeSources = {
  signup: { packs: { inicial: 3, estandar: 1 }, credits: 6000, note: "Una vez por cuenta. 1 Bronce no alcanza para ninguna receta (mínimo X del primer escalón)." },
  starterAssist: { pack: "inicial", maxClaims: 8, note: "`inicial` NO es entrada de ninguna receta: no se puede convertir." },
  missionsF73: { note: "Misiones F73 NO repetibles: cada una se completa una vez por usuario (sin rotación). Recompensa acotada por el admin (validación: créditos ≤ 5.000, sobres ≤ 3, carta = la del proyecto)." },
};

const report = {
  generatedAt: new Date().toISOString(),
  method: { premium: CRAFT_PREMIUM, maxInput: CRAFT_MAX_INPUT, sims: SIMS, packStatsSample: 20000, rule: "X = max(2, ceil(1,25·salida/entrada)) en coste, valor (entrada peor caso) y desguace, a la vez" },
  frozenInputs: { mainLine: MAIN_PACK_LINE.map((id) => ({ id, price: getPack(id)!.price, cards: getPack(id)!.cardCount, meanValue: PACK_STATS[id].meanValue, meanSalvage: PACK_STATS[id].meanSalvage, distribution: MAIN_PACK_DISTRIBUTION[id as keyof typeof MAIN_PACK_DISTRIBUTION] })), classStats },
  packRecipes: packRecipes.map((r) => ({ ...r, simulation: simPackLoop(r) })),
  cardRecipes: cardRecipes.map((r) => ({ ...r, simulation: simCardLoop(r) })),
  freeSources,
};
const exploits = [
  ...report.packRecipes.filter((r) => r.simulation.profitable).map((r) => `${r.id}: bucle sobre→crafteo→desguace rentable`),
  ...report.cardRecipes.filter((r) => r.proposedStatus === "ACTIVE" && (r.simulation.salvageLoopProfitable || r.simulation.cheaperThanBuying)).map((r) => `${r.id}: bucle de cartas rentable`),
];
writeFileSync(join(OUT, "economy-analysis.json"), JSON.stringify({ ...report, exploitChecks: { exploits, pass: exploits.length === 0 } }, null, 2) + "\n");
console.log("SOBRES");
for (const r of report.packRecipes) console.log(`  ${r.input}→${r.output}: X=${r.ratio} (coste ${r.byCost}, valor ${r.byValue}, desguace ${r.bySalvage}) pérdida coste ${(r.lossCost * 100).toFixed(1)}% valor ${(r.lossValue * 100).toFixed(1)}% · bucle neto/ciclo ${r.simulation.netPerCycle} · valor craft ${r.simulation.meanValueCrafted} vs abrir entradas ${r.simulation.meanValueOpeningInputs}`);
console.log("CARTAS");
for (const r of report.cardRecipes) console.log(`  ${r.input}→${r.output}: X=${r.ratio} (coste ${r.byCost}, valor ${r.byValue}, desguace ${r.bySalvage}) viable=${r.viable} pool=${r.outputPoolSize} → ${r.proposedStatus} · desguace in ${r.simulation.salvageInputs} vs out ${r.simulation.salvageOutputMean}`);
console.log("clases", JSON.stringify(classStats));
console.log(`exploits: ${exploits.length ? exploits.join(" | ") : "ninguno"}`);
