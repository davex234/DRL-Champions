/**
 * VERIFICACIÓN DEL ROUND PREPARATION ENGINE.
 *
 * Simula cientos de partidos y mide: diversidad de planes, relación con la economía,
 * con el ADN (agresivo vs disciplinado) y con la narrativa (presión), determinismo y
 * ausencia de planes imposibles.
 *
 * Ejecutar: `npx tsx scripts/preparation-verify.ts [partidos]`
 */
import type { RosterEntry } from "../src/sim";
import { PROFILES } from "../src/sim";
import { makeMatchConfig, simulateMatch, type MatchState } from "../src/match";
import { isValidPlan } from "../src/preparation";

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

interface Tally { plans: number; combos: Set<string>; tempo: Record<string, number>; risk: Record<string, number>; entry: Record<string, number>; aggression: Record<string, number>; invalid: number; ecoConsistent: number; ecoTotal: number; }
function run(home: RosterEntry[], away: RosterEntry[]): Tally {
  const t: Tally = { plans: 0, combos: new Set(), tempo: {}, risk: {}, entry: {}, aggression: {}, invalid: 0, ecoConsistent: 0, ecoTotal: 0 };
  for (let i = 0; i < N; i++) {
    const m = simulateMatch(cfg(home, away, 3000 + i * 13));
    for (const p of plansOf(m)) {
      t.plans++;
      t.combos.add(`${p.side}|${p.entryType}|${p.tempo}|${p.aggression}`);
      t.tempo[p.tempo] = (t.tempo[p.tempo] ?? 0) + 1;
      t.risk[p.riskLevel] = (t.risk[p.riskLevel] ?? 0) + 1;
      t.entry[p.entryType] = (t.entry[p.entryType] ?? 0) + 1;
      t.aggression[p.aggression] = (t.aggression[p.aggression] ?? 0) + 1;
      if (!isValidPlan(p)) t.invalid++;
      if (p.side === "ATK" && (p.economy.buy === "eco" || p.economy.buy === "save")) {
        t.ecoTotal++;
        if (p.entryType === "eco_rush") t.ecoConsistent++;
      }
    }
  }
  return t;
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

console.log("\n## Relación con la economía");
console.log(`  ATK eco/save → eco_rush: ${pct(tA.ecoConsistent, tA.ecoTotal)} (${tA.ecoConsistent}/${tA.ecoTotal})`);

console.log("\n## Comprobaciones");
check("se generan planes en cada ronda", tA.plans > 0);
check("hay diversidad de planes (>=5 combinaciones)", tA.combos.size >= 5, `${tA.combos.size} combos`);
check("ningún plan imposible", tA.invalid === 0 && tD.invalid === 0, `${tA.invalid + tD.invalid} inválidos`);
check("la economía manda la entrada (ATK eco ⇒ eco_rush 100%)", tA.ecoTotal === 0 || tA.ecoConsistent === tA.ecoTotal);
const aggrShare = (t: Tally) => (t.aggression.aggressive ?? 0) / Math.max(1, t.plans);
check("el ADN agresivo produce más planes agresivos que el disciplinado",
  aggrShare(tA) > aggrShare(tD), `${pct(tA.aggression.aggressive ?? 0, tA.plans)} vs ${pct(tD.aggression.aggressive ?? 0, tD.plans)}`);

// Determinismo
const seqOf = (m: MatchState) => plansOf(m).map((p) => `${p.entryType}/${p.tempo}/${p.aggression}/${p.economy.buy}`).join(",");
check("determinismo: misma config ⇒ mismos planes",
  seqOf(simulateMatch(cfg(aggro, mixed, 999))) === seqOf(simulateMatch(cfg(aggro, mixed, 999))));

console.log(`\n${failures === 0 ? "✅ TODAS LAS COMPROBACIONES PASAN" : `❌ ${failures} COMPROBACIÓN(ES) FALLARON`}`);
if (failures > 0) process.exitCode = 1;
