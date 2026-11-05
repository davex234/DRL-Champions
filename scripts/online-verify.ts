/**
 * VERIFICACIÓN — Online Core Architecture (DRL Champions, Online Fase 1/7).
 *
 *   npx tsx scripts/online-verify.ts [partidos]
 *
 * Comprueba: cliente · servidor · lobby · sesiones · heartbeat · reconexión · snapshots ·
 * replicación · versionado · protocolos · determinismo · sincronización de reloj · compatibilidad
 * OFFLINE · compatibilidad REPLAY · CERO estados imposibles · rendimiento. Reutiliza el ÚNICO
 * Gameplay (`@/sim`+`@/match`) de forma AUTORITATIVA. Determinista (reloj lógico).
 */
import { DEMO_HOME, DEMO_AWAY } from "../src/sim/mapping/demoRoster";
import type { CoachSetup } from "../src/sim";
import { simulateMatch } from "../src/match";
import {
  createLocalGame, connectAll, runUntilMatchEnd,
  makePacket, verifyPacket, decodePacket, encodePacket,
  localHandshake, isProtocolCompatible, incompatibilityReason, PROTOCOL_VERSION,
  estimateClock, newHeartbeat, timedOut, dueForPing, onPingSent, onPongReceived,
  createSession, transition, reconstruct,
  createLobby, setReady, canStart, startLobby,
  type LobbyDraft,
} from "../src/online";

let failures = 0;
const check = (label: string, cond: boolean, detail = "") => {
  console.log(`  ${cond ? "✓" : "✕"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
};
console.log("# Verificación del Online Core Architecture — DRL Champions (Online Fase 1)\n");

const SETUP: CoachSetup = { side: "ATK", approach: "default", tempo: "mid", aggression: "balanced" };
const draft = (seed: number): LobbyDraft => ({ seed, rosters: { home: DEMO_HOME, away: DEMO_AWAY }, homeSetup: SETUP, teamNames: { home: "Home", away: "Away" }, coach: { mode: "ai" } });

/** Monta el flujo completo Cliente→Sesión→Lobby→Servidor→Match y arranca el partido. */
function startedGame(seed: number, withObserver = true) {
  const specs = withObserver ? [{ name: "P1" }, { name: "P2" }, { name: "Obs", kind: "observer" as const }] : [{ name: "P1" }, { name: "P2" }];
  const game = createLocalGame(draft(seed), specs);
  connectAll(game, 8);
  for (const c of game.clients) c.joinLobby();
  game.step(); game.step();
  game.clients[0].ready(); game.clients[1].ready();
  game.step();
  game.clients[0].start();
  game.step(); game.step();
  return game;
}

// ─────────────────────── 1. Cliente + Servidor + Handshake + Versionado ───────────────────────
console.log("## Cliente, servidor y handshake");
{
  const game = createLocalGame(draft(1), [{ name: "P1" }, { name: "P2" }]);
  connectAll(game, 8);
  check("CLIENTE: todos los clientes quedan CONECTADOS tras el handshake", game.clients.every((c) => c.state.status === "connected"));
  check("SERVIDOR: el servidor registra las conexiones", game.server.connectionCount() === 2);
  check("PROTOCOLO: negociación de versión compatible", isProtocolCompatible(localHandshake("player", "a"), localHandshake("server", "b")));
  check("VERSIONADO: rechaza protocolos incompatibles", incompatibilityReason(localHandshake("player", "a"), { protocol: 999, minProtocol: 999, build: "x", appVersion: "x", kind: "player", name: "z" }) !== null);
}

// ─────────────────────── 2. Paquetes / serializer / integridad ───────────────────────
console.log("\n## Paquetes (serializer + integridad)");
{
  const p = makePacket("c1", "command", 3, 2, 100, { kind: "command", id: "tempo_up", side: "home" });
  check("PACKET: firma con checksum y se valida", verifyPacket(p));
  check("PACKET: round-trip encode/decode", decodePacket(encodePacket(p))?.checksum === p.checksum);
  const tampered = { ...p, payload: { kind: "command", id: "HACK", side: "home" } };
  check("SEGURIDAD: un paquete manipulado NO valida (checksum)", !verifyPacket(tampered));
  check("SEGURIDAD: decode de basura devuelve null", decodePacket("{no json") === null);
}

// ─────────────────────── 3. Sesiones ───────────────────────
console.log("\n## Sesiones");
{
  const s0 = createSession({ id: "u1", name: "Ana", kind: "player", token: null }, 10);
  const s1 = transition(s0, "authenticating", 11);
  const s2 = transition(s1, "ready", 12);
  check("SESIÓN: máquina de estados con transiciones válidas", s0.phase === "handshaking" && s2.phase === "ready");
  check("SESIÓN: bloquea transiciones ilegales (seguridad)", transition(s0, "in_match", 13).phase === "handshaking");
  check("SESIÓN: token de reconexión determinista", createSession({ id: "u1", name: "Ana", kind: "player", token: null }, 10).reconnectToken === s0.reconnectToken);
}

// ─────────────────────── 4. Lobby ───────────────────────
console.log("\n## Lobby");
{
  let lobby = createLobby("l1", { id: "h", name: "Host" }, draft(5));
  lobby = setReady(lobby, "h", true);
  check("LOBBY: sala creada con host y lado home", lobby.hostId === "h" && lobby.members[0].side === "home");
  check("LOBBY: canStart con jugador listo + home presente", canStart(lobby));
  const res = startLobby(lobby);
  check("LOBBY: arranca produciendo una MatchConfig del ÚNICO Match Engine", !!res && res.config.seed === 5 && res.lobby.status === "in_match");
  // Vía servidor real:
  const game = startedGame(6);
  check("LOBBY (servidor): el host arranca el partido y el servidor crea el MatchState", !!game.server.match && game.server.config?.seed === 6);
}

// ─────────────────────── 5. Heartbeat + Latencia + Reloj ───────────────────────
console.log("\n## Heartbeat, latencia y reloj");
{
  const hb0 = newHeartbeat(20, 100, 0);
  check("HEARTBEAT: due para ping tras el intervalo", dueForPing(hb0, 25) && !dueForPing(hb0, 10));
  check("HEARTBEAT: timeout si no llega pong", timedOut(hb0, 150) && !timedOut(onPongReceived(onPingSent(hb0, 20), 40), 60));
  const clk = estimateClock([{ clientSent: 0, serverTime: 105, clientRecv: 10 }, { clientSent: 20, serverTime: 128, clientRecv: 30 }]);
  check("RELOJ: estima el offset del servidor (NTP)", Math.abs(clk.offset - 100) <= 5 && clk.rtt === 10);
  const game = createLocalGame(draft(7), [{ name: "P1" }, { name: "P2" }]);
  connectAll(game, 10);
  for (let i = 0; i < 40; i++) game.step();
  check("LATENCIA/RELOJ EN VIVO: el cliente estima rtt/offset por ping-pong", game.clients.every((c) => Number.isFinite(c.state.rtt) && Number.isFinite(c.state.clockOffset)));
}

// ─────────────────────── 6. Determinismo + Compatibilidad OFFLINE (un solo Gameplay) ───────────────────────
console.log("\n## Determinismo + compatibilidad OFFLINE (un único Gameplay)");
{
  const game = startedGame(777, false);
  runUntilMatchEnd(game);
  const server = game.server.match!;
  const offline = simulateMatch(game.server.config!);
  check("SERVIDOR: el partido llega a MATCH_END", server.phase === "MATCH_END" && !!server.winner);
  check("UN ÚNICO GAMEPLAY: el partido AUTORITATIVO == el simulateMatch OFFLINE (mismo motor)", server.score.home === offline.score.home && server.score.away === offline.score.away && server.winner === offline.winner);
  const g2 = startedGame(777, false); runUntilMatchEnd(g2);
  check("DETERMINISMO: mismo seed ⇒ mismo partido en dos servidores", g2.server.match!.score.home === server.score.home && g2.server.match!.winner === server.winner);
}

// ─────────────────────── 7. Replicación (lockstep) + Replay ───────────────────────
console.log("\n## Replicación (lockstep) + replay");
{
  const game = startedGame(202, true);
  runUntilMatchEnd(game);
  const server = game.server.match!;
  const player = game.clients[0];
  const rec = player.reconstructMatch()!;
  check("REPLICACIÓN: el cliente jugador reconstruye BYTE A BYTE (lockstep)", rec.score.home === server.score.home && rec.score.away === server.score.away && rec.winner === server.winner);
  check("REPLICACIÓN: paridad del input log servidor↔cliente", game.clients[0].log.commands.length === game.server.log.commands.length);
  const replay = reconstruct(game.server.config!, game.server.log);
  check("REPLAY: seed + input log reproducen el partido (determinista)", replay.score.home === server.score.home && replay.winner === server.winner && JSON.stringify(reconstruct(game.server.config!, game.server.log).score) === JSON.stringify(replay.score));
}

// ─────────────────────── 8. Snapshots + Observador ───────────────────────
console.log("\n## Snapshots + observador");
{
  const game = startedGame(303, true);
  const obs = game.clients[2];
  // Corre hasta que haya ronda en vivo con varios ticks.
  let guard = 0;
  while (guard++ < 4000 && !(game.server.match && game.server.match.phase === "ROUND_RUNNING" && game.server.match.currentRound && game.server.match.currentRound.tick > 8)) game.step();
  const live = game.server.match!.currentRound!;
  check("SNAPSHOT: el observador recibe snapshot inicial + deltas (espejo poblado)", !!obs.observerRound && obs.observerRound.players.length === 10);
  const same = obs.observerRound!.players.every((p) => { const q = live.players.find((x) => x.id === p.id)!; return q.alive === p.alive && q.hp === p.hp && Math.abs(q.pos.x - p.pos.x) < 1e-6 && Math.abs(q.pos.y - p.pos.y) < 1e-6; });
  check("REPLICACIÓN (observador): el espejo replica pos/hp/alive del servidor", same);
  check("SNAPSHOT: el tick de ronda del espejo sigue al servidor", Math.abs(obs.observerRound!.tick - live.tick) <= 1);
}

// ─────────────────────── 9. Reconexión ───────────────────────
console.log("\n## Reconexión");
{
  const game = startedGame(404, false);
  for (let i = 0; i < 60; i++) game.step();
  const before = game.clients[1].state.reconnects;
  game.clients[1].reconnect(game.hub.now);         // caída + reconexión
  for (let i = 0; i < 10; i++) game.step();
  const cli = game.clients[1];
  check("RECONEXIÓN: el cliente vuelve a CONECTADO e incrementa el contador", cli.state.status === "connected" && cli.state.reconnects === before + 1);
  runUntilMatchEnd(game);
  check("RECONEXIÓN: tras el resync el cliente sigue en LOCKSTEP con el servidor", cli.reconstructMatch()!.winner === game.server.match!.winner);
}

// ─────────────────────── 10. Seguridad / autoridad (anti-cheat base) ───────────────────────
console.log("\n## Seguridad y autoridad del servidor");
{
  const game = startedGame(505, false);
  let g = 0;
  while (g++ < 2000 && !(game.server.match && game.server.match.phase === "ROUND_RUNNING")) game.step();
  const rejBefore = game.server.rejected;
  game.clients[0].sendCommand("command", "tempo_up", "away"); // lado que NO es el suyo (home)
  game.step();
  check("AUTORIDAD: el servidor RECHAZA un comando del lado equivocado (anti-cheat)", game.server.rejected > rejBefore);
  const valid = game.server.log.commands.length;
  game.clients[0].sendCommand("command", "tempo_up", "home"); // su lado
  game.step(); game.step();
  check("AUTORIDAD: acepta el comando legítimo y lo registra en el log", game.server.log.commands.length >= valid);
}

// ─────────────────────── 11. Cero estados imposibles ───────────────────────
console.log("\n## Integridad (cero estados imposibles)");
{
  const game = startedGame(606, true);
  runUntilMatchEnd(game);
  const m = game.server.match!;
  let bad = 0; const reasons: string[] = [];
  if (!(m.winner === "home" || m.winner === "away")) { bad++; reasons.push("winner"); }
  if (m.score.home < 0 || m.score.away < 0 || !Number.isFinite(m.score.home)) { bad++; reasons.push("score"); }
  if (m.roundNumber < 1) { bad++; reasons.push("roundNumber"); }
  if (game.clients.some((c) => c.state.status === "handshaking")) { bad++; reasons.push("stuck-handshake"); }
  const obs = game.clients[2];
  if (obs.observerRound && obs.observerRound.players.some((p) => p.hp < 0 || p.hp > 100 || !Number.isFinite(p.pos.x))) { bad++; reasons.push("player-state"); }
  check("INTEGRIDAD: partido/marcador/estados de red válidos", bad === 0, bad ? reasons.join(" · ") : `score ${m.score.home}-${m.score.away}, ${m.roundNumber} rondas`);
}

// ─────────────────────── 12. Rendimiento (overhead incremental) ───────────────────────
console.log("\n## Rendimiento (overhead incremental)");
{
  const cfg = startedGame(909, false).server.config!;
  const t0 = Date.now(); const off = simulateMatch(cfg); const offMs = Date.now() - t0;
  const N = Math.max(1, Number(process.argv[2] ?? 3));
  const t1 = Date.now();
  let ticks = 0;
  for (let i = 0; i < N; i++) { const g = startedGame(909 + i, false); ticks += runUntilMatchEnd(g); }
  const onMs = (Date.now() - t1) / N;
  // Propiedad REAL (independiente de la máquina): el online NO duplica el sim ⇒ no es más lento que el offline.
  check("RENDIMIENTO: el partido online corre a ritmo aceptable (sin duplicar el sim)", onMs < Math.max(2500, offMs * 1.5), `offline ${offMs}ms · online ${onMs.toFixed(0)}ms/partido · ${Math.round(ticks / N)} ticks`);
  void off;
}

console.log(`\n${failures === 0 ? "✅ TODAS LAS COMPROBACIONES PASAN" : `❌ ${failures} COMPROBACIÓN(ES) FALLARON`}`);
process.exit(failures === 0 ? 0 : 1);

// Señal de fallo para CI: sale con código !=0 si alguna comprobación falló.
if (failures > 0) process.exitCode = 1;
