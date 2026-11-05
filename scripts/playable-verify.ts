import "./_polyfill-localstorage";
/**
 * VERIFICACIÓN DEL PRIMER PARTIDO JUGABLE (Vertical 8).
 *
 * Reproduce EXACTAMENTE el camino que usa la UI (`useMatchLoop` + la página):
 * construir config (roster del usuario + rival elegido) → createMatch → avanzar fases →
 * tickear cada ronda en vivo → entregar la ronda al Match Engine → … → MATCH_END →
 * pantalla final + recompensa. Y alimenta el Broadcast cada ronda con TODOS los
 * contextos (match/economía/coach/loadout) para confirmar que no rompe.
 *
 * Ejecutar: `npx tsx scripts/playable-verify.ts`
 */
import type { CardDef, OwnedCard } from "../src/domain/cards/types";
import { CARDS, getPlayer } from "../src/data/catalog";
import { tick, type RoundState } from "../src/sim";
import { createMatch, stepMatch, simulateMatch, makeMatchConfig, matchBroadcastContext, type MatchState } from "../src/match";
import { buildHomeRoster, buildRivalRoster } from "../src/lib/match/roster";
import { summarizeMatch } from "../src/lib/match/rewards";
import { economyBroadcastContext } from "../src/economy";
import { coachBroadcastContext } from "../src/coach";
import { loadoutBroadcastContext } from "../src/buy";
import { LiveDirector, liveInput } from "../src/spectator";
import { createViewport, updateCamera } from "../src/camera";
import { buildBroadcastState } from "../src/broadcast";
import { buildRenderFrame } from "../src/visualizer";

let failures = 0;
const check = (label: string, cond: boolean, detail = "") => {
  console.log(`  ${cond ? "✓" : "✕"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
};

// 1) Config como la página: 5 cartas reales + rival elegido (dificultad normal).
const seen = new Set<string>();
const five: CardDef[] = [];
for (const c of CARDS) { if (seen.has(c.playerId)) continue; seen.add(c.playerId); five.push(c); if (five.length >= 5) break; }
const owned: OwnedCard[] = five.map((c) => ({ uid: `own-${c.id}`, cardId: c.id, obtainedAt: 0 }));
const nicks = five.map((c) => getPlayer(c.playerId)!.nick);
const seed = 20250626;
const { roster: home, playerIds } = buildHomeRoster(owned.map((o) => o.uid), owned);
const away = buildRivalRoster((seed ^ 0x9e3779b9) >>> 0, playerIds, "normal");
const config = makeMatchConfig({
  seed, rosters: { home, away },
  homeSetup: { side: "ATK", approach: "default", tempo: "mid", aggression: "balanced" },
  teamNames: { home: "Mi Equipo", away: "Rival (Normal)" },
});

console.log("# Verificación del Primer Partido Jugable — DRL Champions\n");
console.log(`Equipo del usuario: ${nicks.join(", ")}\n`);

// 2) Reproduce el bucle de la UI (mismo camino: createMatch/stepMatch + tick por ronda).
const advance = (s: MatchState): MatchState => {
  let m = s, g = 0;
  while (m.phase !== "ROUND_RUNNING" && m.phase !== "MATCH_END" && g++ < 60) m = stepMatch(m);
  return m;
};

let m = advance(createMatch(config));
const dir = new LiveDirector();
let vp = createViewport();
let bsFrames = 0, renderFrames = 0, rounds = 0;

while (m.phase !== "MATCH_END") {
  rounds++;
  let r: RoundState = m.currentRound!;
  let g = 0;
  while (r.phase !== "ENDED" && g++ < 6000) {
    r = tick(r);
    if (g % 60 === 0) {
      // Alimenta el Broadcast EXACTAMENTE como la página (todos los contextos).
      const decision = dir.decide(liveInput(r));
      vp = updateCamera(vp, { decision, state: r, dt: 0.05 });
      const bs = buildBroadcastState({
        state: r, decision, viewport: vp,
        match: matchBroadcastContext(m),
        economy: m.economy ? economyBroadcastContext(m.economy, m.currentHomeSide) : undefined,
        prep: m.currentDecision ? coachBroadcastContext(m.currentDecision) : undefined,
        loadout: m.currentLoadouts ? loadoutBroadcastContext(m.currentLoadouts, m.currentHomeSide) : undefined,
      });
      buildRenderFrame({ state: r, viewport: vp, broadcast: bs });
      bsFrames++; renderFrames++;
      // El scoreboard muestra ronda y marcador reales:
      if (bs.match.round !== m.roundNumber) failures++;
    }
  }
  const finished = r;
  m = advance(stepMatch(m, () => finished));
}

// 3) Pantalla final + resumen (F69 · F68-010: el Coach no concede créditos ni XP).
const summary = summarizeMatch(m);

console.log("## Resultado del partido");
console.log(`  Marcador final: ${m.score.home}-${m.score.away} · gana ${m.winner} en ${m.history.length} rondas`);
console.log(`  MVP: ${m.mvp?.name ?? "—"} (${m.mvp?.kills ?? 0} bajas)`);
console.log(`  Narrativa: ${m.narrative?.summary.headline ?? "—"}`);
console.log(`  Resumen: ${summary.teamKills} bajas del equipo (sin créditos ni XP)`);
console.log(`  Frames de broadcast/render generados: ${bsFrames}`);

console.log("\n## Comprobaciones (camino real de la UI)");
check("el partido llega a la pantalla final (MATCH_END)", m.phase === "MATCH_END");
check("hay ganador y MVP", m.winner != null && m.mvp != null, `${m.winner} · MVP ${m.mvp?.name}`);
check("marcador coherente con el historial", m.score.home + m.score.away === m.history.length);
check("la narrativa del partido está lista para la pantalla final", m.narrative != null && m.narrative.match.rounds === m.history.length);
check("hay eventos de compra y de combate para mostrar", m.buyEvents.length > 0 && m.combatEvents.length > 0);
check("el resumen del entrenamiento no lleva créditos ni XP", !("credits" in summary) && !("xp" in summary));
check("el Broadcast se alimenta cada ronda sin romper (scoreboard real)", bsFrames > 0 && failures === 0);

// 4) El bucle de la UI coincide con el motor headless (fidelidad).
const head = simulateMatch(config);
check("el partido jugado en la UI == simulateMatch (determinista y fiel)",
  head.score.home === m.score.home && head.score.away === m.score.away && head.winner === m.winner,
  `${head.score.home}-${head.score.away} == ${m.score.home}-${m.score.away}`);

console.log(`\n${failures === 0 ? "✅ FLUJO JUGABLE COMPLETO Y VERIFICADO" : `❌ ${failures} COMPROBACIÓN(ES) FALLARON`}`);
if (failures > 0) process.exitCode = 1;
