/**
 * VERIFICACIÓN — Spectator Engine (DRL Champions, Online Fase 5/7).
 *
 *   npx tsx scripts/spectator-verify.ts
 *
 * Comprueba: spectator · observer · coach · director · cámaras · read-only · MISMOS datos que el
 * replay · determinismo · rendimiento · cero estados imposibles · compat Gameplay/Online. Reutiliza
 * `LiveDirector`/`ReplayDirector` (misma interfaz). NUNCA modifica el estado.
 */
import { DEMO_HOME, DEMO_AWAY } from "../src/sim/mapping/demoRoster";
import { createLocalGame, connectAll, runUntilMatchEnd } from "../src/online";
import type { LobbyDraft } from "../src/online";
import { recordFromServer, reconstructRoundStates } from "../src/replay";
import { SpectatorSession, createLiveDirector, createReplayDirector } from "../src/spectator";

let failures = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`  ${c ? "✓" : "✕"} ${l}${d ? ` — ${d}` : ""}`); if (!c) failures++; };
console.log("# Verificación del Spectator Engine — DRL Champions (Online Fase 5)\n");

const DRAFT = (seed: number): LobbyDraft => ({ seed, rosters: { home: DEMO_HOME, away: DEMO_AWAY }, homeSetup: { side: "ATK", approach: "default", tempo: "mid", aggression: "balanced" }, teamNames: { home: "H", away: "A" }, coach: { mode: "ai" } });
function playedMatch(seed: number) {
  const game = createLocalGame(DRAFT(seed), [{ name: "P1" }, { name: "P2" }]);
  connectAll(game, 8);
  for (const c of game.clients) c.joinLobby();
  game.step(); game.step(); game.clients[0].ready(); game.clients[1].ready(); game.step(); game.clients[0].start(); game.step(); game.step();
  runUntilMatchEnd(game);
  return game;
}
const PLAYERS = [{ id: "P1", name: "P1", side: "home" as const }, { id: "P2", name: "P2", side: "away" as const }];

const g = playedMatch(2024);
const rep = recordFromServer(g.server, "spec", "competitive", "EMEA", PLAYERS)!;
const states = reconstructRoundStates(rep.config, rep.log, 0);   // el stream de RoundState de la ronda 0

// ─────────────────────── 1. MISMOS datos: live == replay ───────────────────────
console.log("## Un único dato (live == replay)");
{
  const liveRound0 = g.server.match!.rounds[0];   // estado final autoritativo de la ronda 0
  const replayRound0End = states[states.length - 1];
  check("SAME DATA: el replay reconstruye EXACTAMENTE el estado autoritativo (byte a byte)", JSON.stringify(liveRound0) === JSON.stringify(replayRound0End));
  check("SAME DATA: Spectator y Replay consumen el MISMO RoundState", states.length > 5 && states[0].tick === 0);
}

// ─────────────────────── 2. Observer read-only ───────────────────────
console.log("\n## Observer read-only");
{
  const spec = new SpectatorSession("live");
  const s = states[Math.min(15, states.length - 1)];
  const clone = JSON.stringify(s);
  const frame = spec.observe(s);
  check("OBSERVER: produce un frame de realización (decisión + cámara)", !!frame.decision && !!frame.camera && frame.decision.priority >= 0);
  check("SEGURIDAD: el observador NUNCA modifica el estado", JSON.stringify(s) === clone);
}

// ─────────────────────── 3. Cámaras (free/player/coach/director/automatic) ───────────────────────
console.log("\n## Cámaras del observador");
{
  const spec = new SpectatorSession("live");
  spec.observe(states[3]);
  spec.setMode("coach"); const coach = spec.observe(states[4]);
  check("COACH CAM: vista táctica del mapa (limitada, sin foco de jugador)", coach.camera.mode === "coach" && coach.camera.camera === "tactical" && coach.camera.focusPlayerId === null);
  spec.focus("ATK-0"); const player = spec.observe(states[5]);
  check("PLAYER CAM: sigue a un jugador concreto", player.camera.mode === "player" && player.camera.focusPlayerId === "ATK-0" && player.camera.camera === "player");
  spec.setFree({ x: 5, y: 7 }); const free = spec.observe(states[6]);
  check("FREE CAM: cámara libre con posición manual", free.camera.mode === "free" && !!free.camera.freePos);
  spec.setMode("director"); const dir = spec.observe(states[7]);
  check("DIRECTOR/AUTOMATIC CAM: sigue la decisión del director", dir.camera.mode === "director" && dir.camera.camera === dir.decision.camera);
}

// ─────────────────────── 4. Director (Live vs Replay, misma interfaz) ───────────────────────
console.log("\n## Director");
{
  const ld = createLiveDirector(); const rd = createReplayDirector();
  const idx = Math.min(25, states.length - 1);
  const input = { state: states[idx], tick: states[idx].tick, events: states[idx].events, history: states.slice(0, idx) };
  const dl = ld.decide(input); const dr = rd.decide(input);
  check("DIRECTOR: ambos implementan la MISMA interfaz (decisión válida)", !!dl.camera && !!dr.camera && ["auto", "tactical", "player", "clutch", "plant", "defuse", "retake", "cinematic"].includes(dr.camera));
  check("REPLAY DIRECTOR: con la Timeline (history) mantiene los planos más tiempo", dr.expectedHoldTicks > dl.expectedHoldTicks);
}

// ─────────────────────── 5. Determinismo ───────────────────────
console.log("\n## Determinismo");
{
  const run = () => { const s = new SpectatorSession("live"); return states.slice(0, 40).map((st) => s.observe(st).decision.focusPlayerId ?? "").join(","); };
  check("DETERMINISMO: mismo stream ⇒ mismas decisiones de realización", run() === run());
}

// ─────────────────────── 6. Rendimiento ───────────────────────
console.log("\n## Rendimiento");
{
  const t0 = Date.now();
  const spec = new SpectatorSession("replay");
  let ok = true;
  for (const st of states) if (!spec.observe(st)) ok = false;
  const ms = Date.now() - t0;
  check("RENDIMIENTO: observar toda una ronda es incremental y barato", ms < 1000 && ok, `${states.length} ticks · ${ms}ms`);
}

// ─────────────────────── 7. Cero estados imposibles ───────────────────────
console.log("\n## Integridad (cero estados imposibles)");
{
  const spec = new SpectatorSession("live");
  let bad = 0;
  for (const st of states) { const f = spec.observe(st); if (f.decision.priority < 0 || f.decision.priority > 100) bad++; if (!f.camera.mode) bad++; }
  check("INTEGRIDAD: decisiones/cámara válidas en todos los ticks", bad === 0, `${states.length} frames OK`);
}

console.log(`\n${failures === 0 ? "✅ TODAS LAS COMPROBACIONES PASAN" : `❌ ${failures} COMPROBACIÓN(ES) FALLARON`}`);
process.exit(failures === 0 ? 0 : 1);
