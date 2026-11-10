/**
 * VERIFICACIÓN DEL MATCH ENGINE — partido completo con cartas REALES.
 *
 * Demuestra: Match → Round → Simulation, marcador, cambio de lado, condición de
 * victoria configurable, historial, eventos, narrativa del partido y determinismo.
 *
 * Ejecutar: `npx tsx scripts/match-verify.ts`
 */
import type { CardDef, OwnedCard } from "../src/domain/cards/types";
import { CARDS, getPlayer } from "../src/data/catalog";
import type { CoachSetup } from "../src/sim";
import { buildMatchRosters } from "../src/lib/match/roster";
import { makeMatchConfig, simulateMatch, createMatch, stepMatch, matchBroadcastContext } from "../src/match";

let failures = 0;
const log = (s = "") => console.log(s);
function check(label: string, cond: boolean, detail = "") {
  log(`  ${cond ? "✓" : "✕"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

// 5 cartas reales distintas (una por jugador).
const seen = new Set<string>();
const five: CardDef[] = [];
for (const c of CARDS) {
  if (seen.has(c.playerId)) continue;
  seen.add(c.playerId);
  five.push(c);
  if (five.length >= 5) break;
}
const owned: OwnedCard[] = five.map((c) => ({ uid: `own-${c.id}`, cardId: c.id, obtainedAt: 0 }));
const nicks = five.map((c) => getPlayer(c.playerId)!.nick);
const { rosters } = buildMatchRosters(owned.map((o) => o.uid), owned, 42);

const SETUP: CoachSetup = { side: "ATK", approach: "default", tempo: "mid", aggression: "balanced" };
const config = makeMatchConfig({ seed: 777, rosters, homeSetup: SETUP, teamNames: { home: "Mi Equipo", away: "Rival" } });

log("# Verificación del Match Engine — DRL Champions\n");
log(`Equipo del entrenador: ${nicks.join(", ")}`);
log(`Reglas: primero a ${config.win.firstTo}, ventaja ${config.win.winBy}, cambio de lado en ${config.switchAfter}, tope ${config.maxRounds}.\n`);

const m = simulateMatch(config);

log("## Resultado");
log(`  Marcador final: home ${m.score.home} — ${m.score.away} away · gana ${m.winner} en ${m.history.length} rondas.`);
log(`  MVP del partido: ${m.mvp?.name ?? "—"} (${m.mvp?.kills ?? 0} bajas).`);
log(`  Duración total: ${m.totalSeconds}s · momentum final ${m.momentum}.`);

log("\n## Historial (primeras y últimas rondas)");
const showRow = (h: typeof m.history[number]) =>
  log(`  R${String(h.number).padStart(2)} [${h.homeSide}] gana ${h.winner} (${h.reason}) → ${h.scoreAfter.home}-${h.scoreAfter.away} · MVP ${h.mvp?.name ?? "—"} · impacto ${h.impact}`);
m.history.slice(0, 3).forEach(showRow);
log("  …");
m.history.slice(-3).forEach(showRow);

log("\n## Comprobaciones");
check("el partido termina (MATCH_END)", m.phase === "MATCH_END");
check("hay ganador y perdedor", m.winner != null && m.loser != null, `${m.winner} vence a ${m.loser}`);
check("marcador == historial", m.score.home + m.score.away === m.history.length);
check("ganador cumple firstTo+winBy", (m.winner === "home" ? m.score.home : m.score.away) >= config.win.firstTo);
check("exactamente un cambio de lado", m.events.filter((e) => e.type === "SIDE_SWITCHED").length === 1);
check("el lado del home cambia tras la media parte", m.history[config.switchAfter].homeSide !== m.history[0].homeSide,
  `${m.history[0].homeSide} → ${m.history[config.switchAfter].homeSide}`);
check("la narrativa cubre el partido entero", m.narrative != null && m.narrative.match.rounds === m.history.length);
check("la narrativa usa nombres reales", m.narrative != null &&
  m.narrative.timeline.some((e) => e.participants?.some((p) => nicks.includes(p.name))),
  m.narrative?.summary.mvp ?? "");

// Broadcast context (datos reales hacia el broadcast, paso a paso).
log("\n## Contexto de Broadcast (paso a paso, ronda real)");
let s = createMatch(config);
let shown = 0;
while (s.phase !== "MATCH_END" && shown < 3) {
  s = stepMatch(s);
  if (s.phase === "ROUND_RUNNING") {
    const ctx = matchBroadcastContext(s);
    log(`  Ronda ${ctx.round}: scoreboard ATK ${ctx.score.atk} — ${ctx.score.def} DEF (lado home ${s.currentHomeSide})`);
    shown++;
  }
}
check("el broadcast recibe número de ronda y marcador reales", shown === 3);

// Determinismo.
const a = simulateMatch(config);
const b = simulateMatch(config);
check("determinismo: misma config ⇒ mismo resultado",
  a.score.home === b.score.home && a.score.away === b.score.away && a.winner === b.winner,
  `${a.score.home}-${a.score.away} == ${b.score.home}-${b.score.away}`);

log(`\n${failures === 0 ? "✅ TODAS LAS COMPROBACIONES PASAN" : `❌ ${failures} COMPROBACIÓN(ES) FALLARON`}`);
if (failures > 0) process.exitCode = 1;
