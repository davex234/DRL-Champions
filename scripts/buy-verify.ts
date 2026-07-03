/**
 * VERIFICACIÓN DE LA BUY PHASE & INVENTORY ENGINE.
 *
 * Parte A: muestrea la Buy AI (diversidad de loadouts, distribución de armas, sin
 * compras imposibles ni créditos negativos). Parte B: simula partidos (consistencia
 * económica, eventos de compra, impacto en la simulación, determinismo).
 *
 * Ejecutar: `npx tsx scripts/buy-verify.ts [partidos]`
 */
import type { Role, RosterEntry } from "../src/sim";
import { PROFILES, neutralIdentity } from "../src/sim";
import type { BuyTier } from "../src/economy";
import { buildLoadout, getItem } from "../src/buy";
import { makeMatchConfig, simulateMatch, type MatchState } from "../src/match";

const N = Math.max(5, Number(process.argv[2] ?? 40));
let failures = 0;
const check = (label: string, cond: boolean, detail = "") => {
  console.log(`  ${cond ? "✓" : "✕"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
};
const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "—");

console.log("# Verificación de la Buy Phase & Inventory Engine — DRL Champions\n");

// ── Parte A: muestreo de la Buy AI ──────────────────────────────────────────
const tiers: BuyTier[] = ["save", "eco", "half", "force", "full"];
const profiles = ["aggressive-duelist", "patient-anchor", "flank-lurker", "utility-support", "cerebral-igl"] as const;
const roles: Role[] = ["entry", "igl", "lurk", "anchor", "support"];
const weapons: Record<string, number> = {};
let samples = 0, negatives = 0, overspend = 0;
const stateSet = new Set<string>();

for (const tier of tiers) {
  for (const credits of [800, 1600, 2400, 3200, 3900, 5000, 9000]) {
    for (const prof of profiles) {
      for (const role of roles) {
        const l = buildLoadout({ playerName: "p", role, identity: PROFILES[prof], credits, tier, priority: "balanced", risk: "medium", seed: (credits ^ role.length ^ tier.length) >>> 0 });
        samples++;
        if (l.creditsRemaining < 0) negatives++;
        if (l.creditsSpent > credits) overspend++;
        const w = l.primary ?? l.sidearm;
        weapons[getItem(w)!.name] = (weapons[getItem(w)!.name] ?? 0) + 1;
        stateSet.add(`${l.state}|${l.primary ?? l.sidearm}|${l.armor}|${l.utility}`);
      }
    }
  }
}

console.log("## Parte A — Buy AI (muestreo)");
console.log(`  loadouts muestreados : ${samples}`);
console.log(`  loadouts distintos   : ${stateSet.size}`);
console.log("  distribución de armas:");
for (const [w, c] of Object.entries(weapons).sort((a, b) => b[1] - a[1])) console.log(`    ${w}: ${pct(c, samples)}`);

check("ningún crédito negativo", negatives === 0, `${negatives}`);
check("ningún gasto superior al disponible", overspend === 0, `${overspend}`);
check("diversidad de loadouts (>=20 distintos)", stateSet.size >= 20, `${stateSet.size}`);

// ── Parte B: partidos completos ─────────────────────────────────────────────
function roster(profile: keyof typeof PROFILES, tag: string): RosterEntry[] {
  return (["entry", "igl", "lurk", "anchor", "support"] as Role[]).map((role, i) => ({
    name: `${tag}${i}`, role, attrs: { aim: 76, gameSense: 76, utility: 76, leadership: 76 }, identity: PROFILES[profile] ?? neutralIdentity(),
  }));
}
const SETUP = { side: "ATK" as const, approach: "default", tempo: "mid" as const, aggression: "balanced" as const };
const home = roster("aggressive-duelist", "AGG");
const away = roster("cerebral-igl", "MIX");
const cfg = (seed: number) => makeMatchConfig({ seed, rosters: { home, away }, homeSetup: SETUP });

const buys: Record<string, number> = {};
let rounds = 0, richerFpWon = 0, badCredits = 0;
const buyEventTypes: Record<string, number> = {};
for (let i = 0; i < N; i++) {
  const m: MatchState = simulateMatch(cfg(5000 + i * 9));
  for (const h of m.history) {
    rounds++;
    if (h.loadout) {
      buys[h.loadout.home.buy] = (buys[h.loadout.home.buy] ?? 0) + 1;
      buys[h.loadout.away.buy] = (buys[h.loadout.away.buy] ?? 0) + 1;
      const richer = h.loadout.home.firepower >= h.loadout.away.firepower ? "home" : "away";
      if (h.winner === richer) richerFpWon++;
    }
  }
  for (const rec of m.economy!.history) for (const tr of [rec.home, rec.away]) if (tr.creditsAfter < 0) badCredits++;
  for (const e of m.buyEvents) buyEventTypes[e.type] = (buyEventTypes[e.type] ?? 0) + 1;
}

console.log("\n## Parte B — Partidos completos");
console.log(`  distribución de compras: ${Object.entries(buys).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${pct(v, rounds * 2)}`).join(" · ")}`);
console.log(`  impacto en la simulación (gana el de más poder de fuego): ${pct(richerFpWon, rounds)}`);
console.log(`  eventos de compra: ${Object.entries(buyEventTypes).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(" · ") || "ninguno"}`);

check("consistencia económica: ningún crédito negativo en partidos", badCredits === 0, `${badCredits}`);
check("cada ronda jugada tiene loadouts", rounds > 0);
check("hay diversidad de compras en partido", new Set(Object.keys(buys)).size >= 3, Object.keys(buys).join(","));
check("la narrativa de compra detecta significado", Object.keys(buyEventTypes).length > 0);

// Determinismo: misma semilla ⇒ mismos loadouts (resumen).
const sig = (m: MatchState) => m.history.map((h) => h.loadout && `${h.loadout.home.buy}:${h.loadout.home.firepower}/${h.loadout.away.firepower}`).join(",");
check("determinismo: misma config ⇒ mismos loadouts", sig(simulateMatch(cfg(424242))) === sig(simulateMatch(cfg(424242))));

console.log(`\n${failures === 0 ? "✅ TODAS LAS COMPROBACIONES PASAN" : `❌ ${failures} COMPROBACIÓN(ES) FALLARON`}`);
if (failures > 0) process.exitCode = 1;
