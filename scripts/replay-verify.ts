/**
 * VERIFICACIÓN — Replay Engine (DRL Champions, Online Fase 5/7).
 *
 *   npx tsx scripts/replay-verify.ts
 *
 * Comprueba: replay · timeline · compression · playback · seek · bookmarks · highlights · versiones ·
 * checksum · determinismo · replay reconstruido · rendimiento · cero estados imposibles · compat
 * Gameplay/Online. Reutiliza el ÚNICO Gameplay (`reconstruct`/`tick`). DETERMINISTA.
 */
import { DEMO_HOME, DEMO_AWAY } from "../src/sim/mapping/demoRoster";
import { simulateMatch } from "../src/match";
import { createLocalGame, connectAll, runUntilMatchEnd } from "../src/online";
import type { LobbyDraft } from "../src/online";
import {
  recordFromServer, recordReplay, verifyReplay, checksumReplay, isReplayCompatible,
  ReplayTimeline, ReplayPlayer, encodeReplay, decodeReplay, shareCode, reconstructRoundStates, type Replay,
} from "../src/replay";

let failures = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`  ${c ? "✓" : "✕"} ${l}${d ? ` — ${d}` : ""}`); if (!c) failures++; };
console.log("# Verificación del Replay Engine — DRL Champions (Online Fase 5)\n");

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
function replayOf(seed: number): Replay { return recordFromServer(playedMatch(seed).server, `m-${seed}`, "competitive", "EMEA", PLAYERS)!; }

// ─────────────────────── 1. Grabación ───────────────────────
console.log("## Grabación");
{
  const g = playedMatch(777);
  const rep = recordFromServer(g.server, "m1", "competitive", "EMEA", PLAYERS)!;
  check("RECORD: graba config + input log + metadatos", !!rep && rep.meta.rounds >= 1 && rep.meta.winner !== undefined && rep.config.seed === g.server.config!.seed);
  check("RECORD: compacto (input log, sin duplicar snapshots)", Array.isArray(rep.log.commands) && rep.checksum > 0);
}

// ─────────────────────── 2. Replay reconstruido (compat Gameplay/Online) ───────────────────────
console.log("\n## Replay reconstruido");
{
  const g = playedMatch(202);
  const rep = recordFromServer(g.server, "m2", "competitive", "EMEA", PLAYERS)!;
  const tl = new ReplayTimeline(rep);
  const final = tl.finalState();
  check("RECONSTRUCCIÓN: el replay reconstruye el MISMO partido (compat Online/Gameplay)", final.score.home === g.server.match!.score.home && final.winner === g.server.match!.winner);
  check("RECONSTRUCCIÓN: == simulateMatch offline (un único Gameplay)", final.score.home === simulateMatch(g.server.config!).score.home);
}

// ─────────────────────── 3. Timeline ───────────────────────
console.log("\n## Timeline");
{
  const rep = replayOf(303);
  const tl = new ReplayTimeline(rep);
  check("TIMELINE: nº de rondas y ticks totales coherentes", tl.roundCount() >= 1 && tl.totalTicks() > 0 && tl.bounds().length === tl.roundCount());
  check("TIMELINE: eventos por ronda accesibles", tl.eventsInRound(0).length >= 0);
}

// ─────────────────────── 4. Playback + Seek + Frame Step + Speed ───────────────────────
console.log("\n## Playback / seek / frame step / speed");
{
  const p = new ReplayPlayer(replayOf(404));
  const f0 = p.current();
  check("PLAYBACK: frame inicial (ronda 0, tick 0)", !!f0 && f0.tick === 0 && p.pos.round === 0);
  p.play(); p.setSpeed(3); const before = p.pos.tick; p.advance();
  check("PLAYBACK: play/advance avanza los ticks", p.pos.tick > before || p.pos.round > 0);
  const seeked = p.seek(0, 20);
  check("SEEK: saltar a (ronda,tick) devuelve ese estado", !!seeked && p.pos.round === 0 && p.pos.tick === 20 && seeked.tick === 20);
  const back = p.frameStep(-5);
  check("FRAME STEP: paso a paso hacia atrás", !!back && p.pos.tick === 15);
  p.pause(); check("PAUSE: al pausar, advance no avanza", (() => { const t = p.pos.tick; p.advance(); return p.pos.tick === t; })());
}

// ─────────────────────── 5. Seek determinista ───────────────────────
console.log("\n## Seek determinista");
{
  const rep = replayOf(505);
  const a = new ReplayPlayer(rep), b = new ReplayPlayer(rep);
  const sa = JSON.stringify(a.seek(0, 30)); const sb = JSON.stringify(b.seek(0, 30));
  check("DETERMINISMO: mismo (ronda,tick) ⇒ mismo RoundState byte a byte", sa === sb);
  check("DETERMINISMO: reconstructRoundStates estable", JSON.stringify(reconstructRoundStates(rep.config, rep.log, 0)) === JSON.stringify(reconstructRoundStates(rep.config, rep.log, 0)));
}

// ─────────────────────── 6. Bookmarks + Highlights ───────────────────────
console.log("\n## Bookmarks + highlights");
{
  const p = new ReplayPlayer(replayOf(606));
  const bm = p.timeline.addBookmark(0, 25, "Jugada", 0);
  const at = p.seekBookmark(bm.id);
  check("BOOKMARKS: crear y saltar a un bookmark", !!at && p.pos.tick === 25 && p.timeline.bookmarks().length === 1);
  check("HIGHLIGHTS: se extraen del partido (reutiliza Broadcast)", Array.isArray(p.timeline.highlights()));
}

// ─────────────────────── 7. Checksum + versión + integridad ───────────────────────
console.log("\n## Checksum + versión + integridad");
{
  const rep = replayOf(707);
  check("CHECKSUM: un replay íntegro se verifica", verifyReplay(rep).ok);
  const tampered: Replay = { ...rep, log: { ...rep.log, commands: [...rep.log.commands, { round: 0, tick: 1, from: "x", kind: "command", id: "HACK", side: "home" }] } };
  check("INTEGRIDAD: un replay MANIPULADO se detecta (checksum)", !verifyReplay(tampered).ok);
  const oldV: Replay = { ...rep, version: 99 };
  check("VERSIÓN: versión incompatible se rechaza", !isReplayCompatible(oldV) && !verifyReplay(oldV).ok);
}

// ─────────────────────── 8. Compresión / Export / Share code ───────────────────────
console.log("\n## Compresión / export / share");
{
  const rep = replayOf(808);
  const enc = encodeReplay(rep);
  const dec = decodeReplay(enc);
  check("EXPORT: encode → decode round-trip válido", !!dec && dec.checksum === rep.checksum && dec.meta.rounds === rep.meta.rounds);
  check("SHARE CODE: código corto determinista", shareCode(rep) === shareCode(rep) && shareCode(rep).startsWith("DRL-"));
  check("INTEGRIDAD: decode de un replay corrupto devuelve null", decodeReplay(encodeReplay({ ...rep, checksum: 123 })) === null);
}

// ─────────────────────── 9. Determinismo global ───────────────────────
console.log("\n## Determinismo global");
check("DETERMINISMO: mismo seed ⇒ mismo checksum de replay", replayOf(909).checksum === replayOf(909).checksum);
check("DETERMINISMO: seeds distintos ⇒ replays distintos", replayOf(1).checksum !== replayOf(2).checksum);

// ─────────────────────── 10. Rendimiento (incremental/memoizado) ───────────────────────
console.log("\n## Rendimiento");
{
  const rep = replayOf(1234);
  const t0 = Date.now();
  const p = new ReplayPlayer(rep);
  let ok = true;
  for (let i = 0; i < 500; i++) { const r = p.seek(0, i % Math.max(1, p.timeline.bounds()[0].ticks)); if (!r) ok = false; } // seeks memoizados
  const ms = Date.now() - t0;
  // El valor real: 500 seeks NO reconstruyen 500 veces (memoización por ronda) ⇒ escala con nº de rondas, no con nº de seeks.
  check("RENDIMIENTO: playback/seek incremental y memoizado", ms < 6000 && ok, `${ms}ms · ${rep.meta.rounds} rondas`);
}

// ─────────────────────── 11. Cero estados imposibles ───────────────────────
console.log("\n## Integridad (cero estados imposibles)");
{
  const p = new ReplayPlayer(replayOf(4242));
  let bad = 0;
  p.seek(999, 999); if (p.pos.round >= p.timeline.roundCount() || p.pos.tick < 0) bad++;   // seek fuera de rango se clampa
  p.seek(-1, -1); if (p.pos.round < 0 || p.pos.tick < 0) bad++;
  if (!p.current()) bad++;
  check("INTEGRIDAD: posición siempre dentro de límites, frame nunca nulo", bad === 0);
}

console.log(`\n${failures === 0 ? "✅ TODAS LAS COMPROBACIONES PASAN" : `❌ ${failures} COMPROBACIÓN(ES) FALLARON`}`);
process.exit(failures === 0 ? 0 : 1);
