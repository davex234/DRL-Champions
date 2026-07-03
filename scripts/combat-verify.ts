/**
 * VERIFICACIÓN DEL COMBAT INTEGRATION ENGINE — clásico vs integrado.
 *
 * Compara combate clásico (sin loadout) vs integrado (con loadout) y mide: impacto del
 * equipamiento, influencia del ADN, distribución de victorias, eventos de combate,
 * determinismo y ausencia de estados imposibles.
 *
 * Ejecutar: `npx tsx scripts/combat-verify.ts [partidos]`
 */
import type { Role, RosterEntry } from "../src/sim";
import { PROFILES, neutralIdentity } from "../src/sim";
import { makeMatchConfig, simulateMatch, type MatchState } from "../src/match";

const N = Math.max(5, Number(process.argv[2] ?? 50));
let failures = 0;
const check = (label: string, cond: boolean, detail = "") => {
  console.log(`  ${cond ? "✓" : "✕"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
};
const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "—");

function roster(profile: keyof typeof PROFILES, tag: string): RosterEntry[] {
  return (["entry", "igl", "lurk", "anchor", "support"] as Role[]).map((role, i) => ({
    name: `${tag}${i}`, role, attrs: { aim: 76, gameSense: 76, utility: 76, leadership: 76 }, identity: PROFILES[profile] ?? neutralIdentity(),
  }));
}
const SETUP = { side: "ATK" as const, approach: "default", tempo: "mid" as const, aggression: "balanced" as const };
const home = roster("aggressive-duelist", "AGG");
// Rival que ENGANCHA (no turtle): evita rondas de stalemate que llegan al timeout (1700 ticks),
// un artefacto de posicionamiento ajeno al combate. Así la verificación es rápida y representativa.
const away = roster("explosive-star", "RIV");
const cfg = (useLoadoutCombat: boolean, seed: number) =>
  makeMatchConfig({ seed, rosters: { home, away }, homeSetup: SETUP, useLoadoutCombat });

interface Tally { matches: number; rounds: number; richerFpWon: number; richerFpRounds: number; homeWins: number; homeRoundWins: number; combat: Record<string, number>; }
const FP_GAP = 15; // diferencia de poder de fuego que marca una ventaja CLARA de equipamiento
function run(useLoadoutCombat: boolean): Tally {
  const t: Tally = { matches: 0, rounds: 0, richerFpWon: 0, richerFpRounds: 0, homeWins: 0, homeRoundWins: 0, combat: {} };
  for (let i = 0; i < N; i++) {
    const m: MatchState = simulateMatch(cfg(useLoadoutCombat, 6000 + i * 17));
    t.matches++;
    if (m.winner === "home") t.homeWins++;
    for (const h of m.history) {
      t.rounds++;
      if (h.winner === "home") t.homeRoundWins++;
      // Solo rondas con ventaja CLARA de poder de fuego (aísla el efecto del arma del ruido
      // económico del bonus de derrota, donde el equipo "más rico" suele venir de perder).
      if (h.loadout && Math.abs(h.loadout.home.firepower - h.loadout.away.firepower) >= FP_GAP) {
        t.richerFpRounds++;
        const richer = h.loadout.home.firepower > h.loadout.away.firepower ? "home" : "away";
        if (h.winner === richer) t.richerFpWon++;
      }
    }
    for (const e of m.combatEvents) t.combat[e.type] = (t.combat[e.type] ?? 0) + 1;
  }
  return t;
}

console.log("# Verificación del Combat Integration Engine — DRL Champions\n");
console.log(`${N} partidos por modo.\n`);

const classic = run(false);
const integrated = run(true);

console.log("## Impacto del equipamiento (gana el equipo con más poder de fuego)");
console.log(`  combate clásico   : ${pct(classic.richerFpWon, classic.richerFpRounds)}  (el loadout NO influye en el duelo)`);
console.log(`  combate integrado : ${pct(integrated.richerFpWon, integrated.richerFpRounds)}  (el loadout SÍ influye)`);

console.log("\n## Eventos de combate (integrado)");
console.log(`  ${Object.entries(integrated.combat).map(([k, v]) => `${k}: ${v}`).join(" · ") || "ninguno"}`);

// Influencia del ADN: mismo loadout, distinto ESTILO entre roster agresivo y disciplinado.
// Se mide a nivel de RONDA (no de partido): contra un rival débil ambos ganan casi todos los
// partidos, pero la DISTRIBUCIÓN de rondas (cómo de dominante es cada estilo) difiere mucho.
const aggro = run(true);
const discCfg = (seed: number) => makeMatchConfig({ seed, rosters: { home: roster("utility-support", "DIS"), away }, homeSetup: SETUP, useLoadoutCombat: true });
let discWins = 0, discRounds = 0, discRoundWins = 0;
for (let i = 0; i < N; i++) {
  const m = simulateMatch(discCfg(6000 + i * 17));
  if (m.winner === "home") discWins++;
  for (const h of m.history) { discRounds++; if (h.winner === "home") discRoundWins++; }
}
const aggroShare = aggro.homeRoundWins / aggro.rounds;
const discShare = discRoundWins / discRounds;

console.log("\n## Influencia del ADN (mismas reglas, distinto ADN del equipo home)");
console.log(`  home agresivo    — partidos: ${pct(aggro.homeWins, N)} · rondas: ${pct(aggro.homeRoundWins, aggro.rounds)}`);
console.log(`  home disciplinado — partidos: ${pct(discWins, N)} · rondas: ${pct(discRoundWins, discRounds)}`);

console.log("\n## Comprobaciones");
check("el equipamiento INFLUYE más en integrado que en clásico",
  integrated.richerFpWon / Math.max(1, integrated.richerFpRounds) > classic.richerFpWon / Math.max(1, classic.richerFpRounds),
  `${pct(integrated.richerFpWon, integrated.richerFpRounds)} vs ${pct(classic.richerFpWon, classic.richerFpRounds)}`);
check("se generan eventos de combate por equipamiento", Object.keys(integrated.combat).length > 0);
check("el ADN cambia la distribución de victorias (rondas)", Math.abs(aggroShare - discShare) > 0.05, `${pct(aggro.homeRoundWins, aggro.rounds)} vs ${pct(discRoundWins, discRounds)}`);

// Determinismo
const sig = (m: MatchState) => `${m.score.home}-${m.score.away}:${m.winner}:${m.combatEvents.length}`;
check("determinismo: misma config ⇒ mismo resultado",
  sig(simulateMatch(cfg(true, 31337))) === sig(simulateMatch(cfg(true, 31337))));

// No estados imposibles (créditos, marcador coherente)
let bad = 0;
for (let i = 0; i < N; i++) {
  const m = simulateMatch(cfg(true, 8000 + i));
  if (m.score.home + m.score.away !== m.history.length) bad++;
  for (const rec of m.economy!.history) for (const tr of [rec.home, rec.away]) if (tr.creditsAfter < 0) bad++;
}
check("no hay estados imposibles", bad === 0, `${bad}`);

console.log(`\n${failures === 0 ? "✅ TODAS LAS COMPROBACIONES PASAN" : `❌ ${failures} COMPROBACIÓN(ES) FALLARON`}`);
if (failures > 0) process.exitCode = 1;
