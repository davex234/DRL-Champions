/**
 * VERIFICACIÓN DEL ECONOMY ENGINE — comparación Sin vs Con economía.
 *
 * Simula cientos de rondas en 3 modos y mide: diversidad de compras (ecos/forces/
 * full…), economía rota, eventos narrativos económicos, impacto en victorias,
 * determinismo y ausencia de estados imposibles.
 *
 * Ejecutar: `npx tsx scripts/economy-verify.ts [partidosPorModo]`
 */
import type { CardDef, OwnedCard } from "../src/domain/cards/types";
import { CARDS, getPlayer } from "../src/data/catalog";
import type { CoachSetup } from "../src/sim";
import { buildMatchRosters } from "../src/lib/match/roster";
import { makeMatchConfig, simulateMatch, type MatchState } from "../src/match";
import { DEFAULT_RULES } from "../src/economy";

const N = Math.max(5, Number(process.argv[2] ?? 30));
let failures = 0;
const check = (label: string, cond: boolean, detail = "") => {
  console.log(`  ${cond ? "✓" : "✕"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
};

// 5 cartas reales distintas.
const seen = new Set<string>();
const five: CardDef[] = [];
for (const c of CARDS) { if (seen.has(c.playerId)) continue; seen.add(c.playerId); five.push(c); if (five.length >= 5) break; }
const owned: OwnedCard[] = five.map((c) => ({ uid: `own-${c.id}`, cardId: c.id, obtainedAt: 0 }));
const { rosters } = buildMatchRosters(owned.map((o) => o.uid), owned, 1);
const nicks = five.map((c) => getPlayer(c.playerId)!.nick);
const SETUP: CoachSetup = { side: "ATK", approach: "default", tempo: "mid", aggression: "balanced" };

type Mode = "baseline" | "economy" | "economy+tactics";
function cfg(mode: Mode, seed: number) {
  return makeMatchConfig({
    seed, rosters, homeSetup: SETUP,
    economy: mode === "baseline" ? null : DEFAULT_RULES,
    useEconomyTactics: mode === "economy+tactics",
  });
}

interface Agg {
  matches: number; rounds: number; teamRounds: number;
  buys: Record<string, number>; broken: number; richerWon: number;
  events: Record<string, number>;
}
function run(mode: Mode): Agg {
  const a: Agg = { matches: 0, rounds: 0, teamRounds: 0, buys: {}, broken: 0, richerWon: 0, events: {} };
  for (let i = 0; i < N; i++) {
    const m: MatchState = simulateMatch(cfg(mode, 1000 + i * 7));
    a.matches++; a.rounds += m.history.length;
    if (!m.economy) continue;
    for (const rec of m.economy.history) {
      a.teamRounds += 2;
      for (const tr of [rec.home, rec.away]) { a.buys[tr.buy] = (a.buys[tr.buy] ?? 0) + 1; if (tr.status === "broken") a.broken++; }
      const richer = rec.home.creditsBefore >= rec.away.creditsBefore ? "home" : "away";
      if (rec.winner === richer) a.richerWon++;
    }
    for (const e of m.economy.events) a.events[e.type] = (a.events[e.type] ?? 0) + 1;
  }
  return a;
}

console.log("# Verificación del Economy Engine — DRL Champions\n");
console.log(`Equipo: ${nicks.join(", ")} · ${N} partidos por modo.\n`);

const base = run("baseline");
const eco = run("economy");
const ecoTac = run("economy+tactics");

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "—");
function dist(a: Agg): string {
  const order = ["save", "eco", "half", "force", "full"];
  return order.map((b) => `${b} ${pct(a.buys[b] ?? 0, a.teamRounds)}`).join(" · ");
}

console.log("## Distribución de compras (% de team-rondas)");
console.log(`  baseline        : sin economía (no hay estados de compra)`);
console.log(`  economy         : ${dist(eco)}`);
console.log(`  economy+tactics : ${dist(ecoTac)}`);

console.log("\n## Diversidad / estados");
console.log(`  tipos de compra distintos (economy): ${new Set(Object.keys(eco.buys)).size}`);
console.log(`  rondas de economía rota (economy)  : ${eco.broken}`);

console.log("\n## Eventos narrativos económicos (economy, total en ${N} partidos)".replace("${N}", String(N)));
for (const [t, c] of Object.entries(eco.events).sort((x, y) => y[1] - x[1])) console.log(`  ${t}: ${c}`);
if (Object.keys(eco.events).length === 0) console.log("  (ninguno)");

console.log("\n## Impacto en victorias (equipo con más créditos gana la ronda)");
console.log(`  economy (sin tactics) : ${pct(eco.richerWon, eco.teamRounds / 2)}  (info: la economía no altera el combate)`);
console.log(`  economy + tactics     : ${pct(ecoTac.richerWon, ecoTac.teamRounds / 2)}  (la economía muerde vía Tactical)`);

console.log("\n## Comprobaciones");
check("baseline no produce economía", base.teamRounds === 0);
check("con economía hay diversidad de compras (>=3 tipos)", new Set(Object.keys(eco.buys)).size >= 3,
  Object.keys(eco.buys).join(","));
check("aparecen ecos y full buys", (eco.buys.eco ?? 0) + (eco.buys.save ?? 0) > 0 && (eco.buys.full ?? 0) > 0);
check("se generan eventos narrativos económicos", Object.keys(eco.events).length > 0,
  `${Object.values(eco.events).reduce((a, b) => a + b, 0)} eventos`);

// Determinismo.
const d1 = simulateMatch(cfg("economy", 555)).economy!;
const d2 = simulateMatch(cfg("economy", 555)).economy!;
check("determinismo: misma config ⇒ misma economía",
  JSON.stringify(d1.history.map((r) => [r.home.buy, r.away.buy, r.winner])) ===
  JSON.stringify(d2.history.map((r) => [r.home.buy, r.away.buy, r.winner])));

// Estados imposibles.
let impossible = 0;
for (let i = 0; i < N; i++) {
  const m = simulateMatch(cfg("economy", 2000 + i));
  for (const rec of m.economy!.history) for (const tr of [rec.home, rec.away]) {
    if (tr.creditsAfter < 0 || tr.creditsAfter > DEFAULT_RULES.max * 5 || Number.isNaN(tr.creditsAfter)) impossible++;
    if (tr.buy === "full" && tr.status !== "bonus" && tr.creditsBefore / 5 < DEFAULT_RULES.costs.full - 1) impossible++;
  }
}
check("no hay estados económicos imposibles", impossible === 0, `${impossible} violaciones`);

console.log(`\n${failures === 0 ? "✅ TODAS LAS COMPROBACIONES PASAN" : `❌ ${failures} COMPROBACIÓN(ES) FALLARON`}`);
if (failures > 0) process.exitCode = 1;
