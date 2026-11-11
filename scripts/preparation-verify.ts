/**
 * VERIFICACIÓN DEL ROUND PREPARATION ENGINE.
 *
 * Simula cientos de partidos y mide: diversidad de planes, relación con la economía,
 * con el ADN (agresivo vs disciplinado) y con la narrativa (presión), determinismo y
 * ausencia de planes imposibles.
 *
 * ECONOMÍA → ENTRADA (regla de negocio en `src/coach/ecoEntry.ts`): en ataque con compra eco/save, el plan automático
 * usa `eco_rush`, y el plan JUGADO también, salvo que el entrenador lo cambie con una justificación reconocida
 * (`pistol_round`, `react_match_point`, `react_to_losses`) y el equipo obedezca. La compra del plan es la real.
 * Antes se exigía eco_rush al plan jugado sin excepciones: fallaba siempre por esas decisiones del entrenador
 * (activo por defecto), que son intencionadas (véase `src/coach/preparation-eco.characterization.test.ts`).
 *
 * Ejecutar: `npx tsx scripts/preparation-verify.ts [partidos]`
 */
import type { RosterEntry } from "../src/sim";
import { PROFILES } from "../src/sim";
import { makeMatchConfig, simulateMatch, type MatchState } from "../src/match";
import { DEFAULT_SWITCH_AFTER } from "../src/match/config";
import { buildRoundPlan, isValidPlan } from "../src/preparation";
import { createEconomy, planRound, buyContexts } from "../src/economy";
import { checkEcoEntry } from "../src/coach/ecoEntry";

const N = Math.max(5, Number(process.argv[2] ?? 40));
let failures = 0;
const check = (label: string, cond: boolean, detail = "") => {
  console.log(`  ${cond ? "✓" : "✕"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
};

function roster(profile: keyof typeof PROFILES, tag: string): RosterEntry[] {
  const roles = ["entry", "igl", "lurk", "anchor", "support"] as const;
  return roles.map((role, i) => ({
    name: `${tag}${i}`, role,
    attrs: { aim: 76, gameSense: 76, utility: 76, leadership: 76 },
    identity: PROFILES[profile],
  }));
}
const SETUP = { side: "ATK" as const, approach: "default", tempo: "mid" as const, aggression: "balanced" as const };

function cfg(home: RosterEntry[], away: RosterEntry[], seed: number) {
  return makeMatchConfig({ seed, rosters: { home, away }, homeSetup: SETUP });
}
const plansOf = (m: MatchState) => m.history.map((h) => h.plan).filter((p): p is NonNullable<typeof p> => p != null);

interface EcoTally { total: number; ok: number; byReason: Record<string, number>; failures: string[] }
interface Tally { plans: number; combos: Set<string>; tempo: Record<string, number>; risk: Record<string, number>; entry: Record<string, number>; aggression: Record<string, number>; invalid: number; eco: EcoTally; }
function run(home: RosterEntry[], away: RosterEntry[]): Tally {
  const t: Tally = { plans: 0, combos: new Set(), tempo: {}, risk: {}, entry: {}, aggression: {}, invalid: 0, eco: { total: 0, ok: 0, byReason: {}, failures: [] } };
  for (let i = 0; i < N; i++) {
    const m = simulateMatch(cfg(home, away, 3000 + i * 13));
    for (const h of m.history) {
      const p = h.plan;
      if (!p) continue;
      t.plans++;
      t.combos.add(`${p.side}|${p.entryType}|${p.tempo}|${p.aggression}`);
      t.tempo[p.tempo] = (t.tempo[p.tempo] ?? 0) + 1;
      t.risk[p.riskLevel] = (t.risk[p.riskLevel] ?? 0) + 1;
      t.entry[p.entryType] = (t.entry[p.entryType] ?? 0) + 1;
      t.aggression[p.aggression] = (t.aggression[p.aggression] ?? 0) + 1;
      if (!isValidPlan(p)) t.invalid++;
      // Economía → entrada, ronda a ronda, con el plan JUGADO, la decisión del entrenador y la compra real.
      const v = checkEcoEntry({
        side: p.side, planBuy: p.economy.buy, entryType: p.entryType, realBuy: h.loadout?.home.buy ?? null,
        coach: h.coach ? { notes: h.coach.notes, deviated: h.coach.deviated } : null,
      });
      if (!v.applies) continue;
      t.eco.total++;
      t.eco.byReason[v.reason] = (t.eco.byReason[v.reason] ?? 0) + 1;
      if (v.ok) t.eco.ok++;
      else t.eco.failures.push(`partido ${i} ronda ${h.number}: ${v.reason} (entrada ${p.entryType}, compra plan ${p.economy.buy} / real ${h.loadout?.home.buy ?? "—"}) [${h.coach?.notes.join(",") ?? "sin entrenador"}]`);
    }
  }
  return t;
}

/** Regla 1: el motor de preparación, sin entrenador, pone eco_rush en ATK con compra eco/save (pistolas incluidas). */
function autoPlanEcoRush(home: RosterEntry[], away: RosterEntry[]): { total: number; bad: string[] } {
  let e = createEconomy({ home, away });
  for (const k of Object.keys(e.home.players)) e.home.players[k] = 800;
  e = planRound(e, buyContexts({ home: 0, away: 0 }, []));
  const bad: string[] = [];
  let total = 0;
  for (const round of [1, 2, 5, 9, DEFAULT_SWITCH_AFTER + 1, 18]) {
    for (let seed = 1; seed <= 10; seed++) {
      const p = buildRoundPlan({ round, side: "ATK", score: { home: 0, away: 0 }, matchPoint: [], momentum: 0, homeRoster: home, economy: e, seed });
      if (p.economy.buy !== "eco" && p.economy.buy !== "save") continue;
      total++;
      if (p.entryType !== "eco_rush") bad.push(`ronda ${round} seed ${seed}: ${p.entryType}`);
    }
  }
  return { total, bad };
}

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "—");
const fmt = (r: Record<string, number>, total: number) => Object.entries(r).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${pct(v, total)}`).join(" · ");

console.log("# Verificación del Round Preparation Engine — DRL Champions\n");
console.log(`${N} partidos por configuración.\n`);

const aggro = roster("aggressive-duelist", "AGG");
const disc = roster("patient-anchor", "DIS");
const mixed = roster("cerebral-igl", "MIX");

const tA = run(aggro, mixed);
const tD = run(disc, mixed);

console.log("## Diversidad de planes (equipo agresivo)");
console.log(`  planes totales        : ${tA.plans}`);
console.log(`  combinaciones únicas  : ${tA.combos.size}`);
console.log(`  entradas              : ${fmt(tA.entry, tA.plans)}`);
console.log(`  tempo                 : ${fmt(tA.tempo, tA.plans)}`);
console.log(`  riesgo                : ${fmt(tA.risk, tA.plans)}`);

console.log("\n## Relación con el ADN (agresión de los planes)");
console.log(`  equipo agresivo   : ${fmt(tA.aggression, tA.plans)}`);
console.log(`  equipo disciplinado: ${fmt(tD.aggression, tD.plans)}`);

console.log("\n## Relación con la economía (ATK con compra eco/save, plan jugado)");
const ecoLine = (t: Tally) => `${t.eco.total} rondas · ${Object.entries(t.eco.byReason).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(" · ") || "—"}`;
console.log(`  equipo agresivo    : ${ecoLine(tA)}`);
console.log(`  equipo disciplinado: ${ecoLine(tD)}`);
const ecoFailures = [...tA.eco.failures.map((f) => `agresivo · ${f}`), ...tD.eco.failures.map((f) => `disciplinado · ${f}`)];
for (const f of ecoFailures.slice(0, 10)) console.log(`    ✕ ${f}`);
if (ecoFailures.length > 10) console.log(`    … y ${ecoFailures.length - 10} más`);
const autoEco = autoPlanEcoRush(aggro, mixed);

console.log("\n## Comprobaciones");
check("se generan planes en cada ronda", tA.plans > 0);
check("hay diversidad de planes (>=5 combinaciones)", tA.combos.size >= 5, `${tA.combos.size} combos`);
check("ningún plan imposible", tA.invalid === 0 && tD.invalid === 0, `${tA.invalid + tD.invalid} inválidos`);
check("plan automático: ATK eco ⇒ eco_rush (motor de preparación, pistolas incluidas)",
  autoEco.total > 0 && autoEco.bad.length === 0, autoEco.bad.length ? autoEco.bad.slice(0, 3).join(" · ") : `${autoEco.total} planes eco`);
const BUY_REASONS = /: (buy_mismatch|no_real_buy) /;
const buyBad = ecoFailures.filter((f) => BUY_REASONS.test(f)).length;
const entryBad = ecoFailures.length - buyBad;
check("la compra eco del plan es la compra real de la ronda", buyBad === 0, `${buyBad} incoherentes de ${tA.eco.total + tD.eco.total}`);
check("la economía manda la entrada (ATK eco ⇒ eco_rush, salvo pistola / punto de partido / racha decididos por el entrenador)",
  entryBad === 0 && tA.eco.total + tD.eco.total > 0,
  `${tA.eco.total + tD.eco.total - entryBad}/${tA.eco.total + tD.eco.total} rondas cumplen`);
const aggrShare = (t: Tally) => (t.aggression.aggressive ?? 0) / Math.max(1, t.plans);
check("el ADN agresivo produce más planes agresivos que el disciplinado",
  aggrShare(tA) > aggrShare(tD), `${pct(tA.aggression.aggressive ?? 0, tA.plans)} vs ${pct(tD.aggression.aggressive ?? 0, tD.plans)}`);

// Determinismo
const seqOf = (m: MatchState) => plansOf(m).map((p) => `${p.entryType}/${p.tempo}/${p.aggression}/${p.economy.buy}`).join(",");
check("determinismo: misma config ⇒ mismos planes",
  seqOf(simulateMatch(cfg(aggro, mixed, 999))) === seqOf(simulateMatch(cfg(aggro, mixed, 999))));

console.log(`\n${failures === 0 ? "✅ TODAS LAS COMPROBACIONES PASAN" : `❌ ${failures} COMPROBACIÓN(ES) FALLARON`}`);
if (failures > 0) process.exitCode = 1;
