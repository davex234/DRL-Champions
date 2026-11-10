/**
 * FASE 41 · SIMULADOR DE ECONOMÍA — `npx tsx scripts/economy-simulator.ts --rules=baseline|fase41 [--n=1000000] [--out=…]`
 *
 * Ejecuta `n` trayectorias deterministas (repartidas a partes iguales entre CASUAL/REGULAR/ENGAGED/HARDCORE y entre los
 * cuatro días de entrada en la temporada) con el núcleo `src/domain/economy/simulator.ts` y escribe percentiles
 * P10/P25/P50/P75/P90/P95/P99 por arquetipo y horizonte (1/7/30/90/180 días), fuentes y sumideros, progreso del pase por
 * día de entrada y las comprobaciones de salud (fuentes sin tope, primer equipo, inflación).
 *
 *   baseline → docs/product/qa/fase41/baseline-economy.json   (reglas ANTERIORES a la Fase 41)
 *   fase41   → docs/product/qa/fase41/final-economy.json      (reglas vigentes)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { performance } from "node:perf_hooks";
import { CardRegistry } from "../src/collection/registry";
import {
  ARCHETYPES, ARCHETYPE_PARAMS, HORIZONS, METRICS, SOURCES, SINKS, SEASON_STARTS, SEASON_DAYS, Simulator, buildSimCatalog,
  percentilesOf, seedOf, type RuleSet,
} from "../src/domain/economy/simulator";
import { dailyRecurringCeiling, seasonBudget, ECONOMY_VERSION } from "../src/domain/economy/catalog";
import { STARTER_POLICY } from "../src/domain/economy/starter";

const arg = (k: string, d: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const rules = arg("rules", "fase41") as RuleSet;
if (rules !== "baseline" && rules !== "fase41") throw new Error("--rules=baseline|fase41");
const N = Number(arg("n", "1000000"));
const OUT = arg("out", `docs/product/qa/fase41/${rules === "baseline" ? "baseline" : "final"}-economy.json`);

const t0 = performance.now();
const maxOf = (xs: ArrayLike<number>) => { let m = -Infinity; for (let i = 0; i < xs.length; i++) if (xs[i] > m) m = xs[i]; return m; };
const reg = new CardRegistry();
const cat = buildSimCatalog(reg);
const sim = new Simulator(cat);
const perArch = Math.floor(N / ARCHETYPES.length);
const H = HORIZONS.length;

const report: Record<string, unknown> = {
  phase: 41, rules, economyVersion: rules === "baseline" ? 2 : ECONOMY_VERSION, generatedAt: new Date().toISOString(),
  trajectories: perArch * ARCHETYPES.length, perArchetype: perArch, horizonsDays: HORIZONS, seasonStarts: SEASON_STARTS.map((s) => s + 1), seasonDays: SEASON_DAYS,
  catalog: { cards: cat.n, players: cat.nPlayers, odds: "buildPool + pesos reales (equivalencia con openPack en economy-simulation:verify)" },
  starterPolicy: rules === "fase41" ? STARTER_POLICY : { packId: "inicial", assistSlots: 0, maxFreeClaims: null, note: "gratis sin límite" },
  budget: seasonBudget(), dailyRecurringCeiling: dailyRecurringCeiling(), archetypes: {},
};
const health: { id: string; ok: boolean; detail: string }[] = [];

for (let a = 0; a < ARCHETYPES.length; a++) {
  const arch = ARCHETYPES[a];
  const ta = performance.now();
  const values = Array.from({ length: H }, () => METRICS.map(() => new Float32Array(perArch)));
  const srcSum = Array.from({ length: H }, () => new Float64Array(SOURCES.length));
  const snkSum = Array.from({ length: H }, () => new Float64Array(SINKS.length));
  const maxRecurring = new Float32Array(perArch); const maxDay = new Float32Array(perArch);
  // Nivel del pase a 90 días por día de entrada: TODAS las trayectorias de cada grupo (antes se muestreaba `i % 50`,
  // que con 4 grupos solo caía en los grupos 0 y 2).
  const passEnd = SEASON_STARTS.map(() => new Float32Array(Math.ceil(perArch / SEASON_STARTS.length)));
  const passN = SEASON_STARTS.map(() => 0);
  for (let i = 0; i < perArch; i++) {
    const start = SEASON_STARTS[i % SEASON_STARTS.length];
    const r = sim.run(arch, rules, seedOf(a, i, rules), start, HORIZONS[H - 1]);
    for (let h = 0; h < H; h++) {
      const snap = r.snapshots[h];
      for (let m = 0; m < METRICS.length; m++) values[h][m][i] = snap[m];
      for (let s = 0; s < SOURCES.length; s++) srcSum[h][s] += r.sources[h][s];
      for (let s = 0; s < SINKS.length; s++) snkSum[h][s] += r.sinks[h][s];
    }
    maxRecurring[i] = r.maxRecurringDay; maxDay[i] = r.maxDay;
    const g = i % SEASON_STARTS.length;
    passEnd[g][passN[g]++] = r.snapshots[3][METRICS.indexOf("passLevel")];
  }
  const horizons: Record<string, unknown> = {};
  for (let h = 0; h < H; h++) {
    const metrics: Record<string, unknown> = {};
    METRICS.forEach((m, k) => { metrics[m] = percentilesOf(values[h][k]); });
    horizons[`d${HORIZONS[h]}`] = {
      metrics,
      sourcesMean: Object.fromEntries(SOURCES.map((s, k) => [s, Math.round(srcSum[h][k] / perArch)])),
      sinksMean: Object.fromEntries(SINKS.map((s, k) => [s, Math.round(snkSum[h][k] / perArch)])),
    };
  }
  const passByStart = Object.fromEntries(SEASON_STARTS.map((s, k) => [`startDay${s + 1}`, percentilesOf(passEnd[k].subarray(0, passN[k]))]));
  (report.archetypes as Record<string, unknown>)[arch] = {
    params: ARCHETYPE_PARAMS[arch], horizons, passLevelAtDay90ByStart: passByStart,
    maxRecurringCreditsInADay: percentilesOf(maxRecurring), maxCreditsInADay: percentilesOf(maxDay),
    ms: Math.round(performance.now() - ta),
  };
  const d1 = values[0]; const d180 = values[H - 1];
  const ready1 = d1[METRICS.indexOf("deckReadyDay")].filter((x) => x === 1).length;
  const maxRec = maxOf(maxRecurring);
  health.push({ id: `${arch}:primer-equipo-dia-1`, ok: ready1 === perArch, detail: `${ready1}/${perArch} con plantilla posible el día 1` });
  health.push({ id: `${arch}:fuente-recurrente-acotada`, ok: maxRec <= dailyRecurringCeiling(), detail: `máximo diario recurrente ${maxRec} vs techo ${dailyRecurringCeiling()}` });
  const freeP99 = percentilesOf(d180[METRICS.indexOf("freeStarterPacks")]).P99;
  health.push({ id: `${arch}:sobre-inicial-acotado`, ok: maxOf(d180[METRICS.indexOf("freeStarterPacks")]) <= STARTER_POLICY.maxFreeClaims, detail: `Sobres Iniciales gratis a 180 días P99 ${freeP99} · máx ${maxOf(d180[METRICS.indexOf("freeStarterPacks")])} (tope ${STARTER_POLICY.maxFreeClaims})` });
  console.log(`${rules} · ${arch}: ${perArch} trayectorias en ${((performance.now() - ta) / 1000).toFixed(1)} s · créditos d30 P50 ${percentilesOf(values[2][0]).P50} · ganado d30 P50 ${percentilesOf(values[2][1]).P50} · pase d90 P50 ${percentilesOf(values[3][METRICS.indexOf("passLevel")]).P50} · máx diario recurrente ${maxRec}`);
}
report.health = health;
report.ms = Math.round(performance.now() - t0);
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(report, null, 2) + "\n");
console.log(`→ ${OUT} (${(report.ms as number / 1000).toFixed(1)} s) · salud: ${health.filter((x) => x.ok).length}/${health.length}`);
