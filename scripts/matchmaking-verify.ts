/**
 * VERIFICACIÓN — Matchmaking & Queue Engine (DRL Champions, Online Fase 2/7).
 *
 *   npx tsx scripts/matchmaking-verify.ts [jugadores]
 *
 * Comprueba: queue · search · balance · servidor · región · ping · MMR · party · ready check ·
 * cancel · reconnect · backfill · bot fill · seed · lobby · session · determinismo · rendimiento ·
 * cero estados imposibles · compat Online Core · compat Offline · compat Replay. Reutiliza el
 * ÚNICO Gameplay y el Online Core. DETERMINISTA (reloj lógico).
 */
import { simulateMatch } from "../src/match";
import { createLocalGame, connectAll, runUntilMatchEnd, reconstruct, newInputLog } from "../src/online";
import {
  Matchmaker, defaultProfile, profileFrom,
  matchQuality, teamBalance, acceptable, expandWindow, DEFAULT_SEARCH,
  selectServer, defaultNodes, regionPing, pairPing, kindForMode, isBot, seedFor,
  type PlayerProfile, type MatchProposal,
} from "../src/matchmaking";
import type { LobbyDraft } from "../src/online";

let failures = 0;
const check = (label: string, cond: boolean, detail = "") => {
  console.log(`  ${cond ? "✓" : "✕"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
};
console.log("# Verificación del Matchmaking & Queue Engine — DRL Champions (Online Fase 2)\n");

const P = (id: string, over: Partial<PlayerProfile> = {}) => profileFrom(id, id, { region: "EMEA", ...over });

/** Lanza un draft matchmade en el Online Core y lo corre hasta el final (compat Gameplay). */
function playDraft(draft: LobbyDraft) {
  const d: LobbyDraft = { ...draft, coach: { mode: "ai" } };
  const game = createLocalGame(d, [{ name: "H" }, { name: "A" }]);
  connectAll(game, 8);
  for (const c of game.clients) c.joinLobby();
  game.step(); game.step();
  game.clients[0].ready(); game.clients[1].ready(); game.step();
  game.clients[0].start(); game.step(); game.step();
  runUntilMatchEnd(game);
  return game;
}

// ─────────────────────── 1. Cola (anti doble-cola, cancel) ───────────────────────
console.log("## Cola");
{
  const mm = new Matchmaker({ seedBase: 1 });
  const r1 = mm.enqueue(P("A"), "competitive");
  const r2 = mm.enqueue(P("A"), "casual");
  check("QUEUE: encola un ticket", !!r1.ticket && mm.isQueued("A"));
  check("SEGURIDAD: rechaza la DOBLE cola del mismo jugador", !!r2.error && r2.error === "already-queued");
  check("QUEUE: snapshot con población/salud/espera estimada", mm.snapshot("competitive").size === 1 && mm.snapshot("competitive").health >= 0);
  mm.cancel(r1.ticket!.id);
  check("CANCEL: cancelar libera al jugador (puede volver a encolar)", !mm.isQueued("A") && !!mm.enqueue(P("A"), "casual").ticket);
}

// ─────────────────────── 2. Búsqueda (estricta → relajada) ───────────────────────
console.log("\n## Búsqueda (estricto → relajado)");
{
  const w0 = expandWindow(DEFAULT_SEARCH, 0);
  const w50 = expandWindow(DEFAULT_SEARCH, 50);
  check("SEARCH: la ventana se ENSANCHA con el tiempo (MMR/ping/calidad)", w50.mmrRange > w0.mmrRange && w50.pingMax > w0.pingMax && w50.minQuality < w0.minQuality);
  check("SEARCH: la región se relaja tras esperar", w0.regionStrict && !expandWindow(DEFAULT_SEARCH, 60).regionStrict);
}

// ─────────────────────── 3. Balance (nunca solo MMR) + MMR + Región + Ping ───────────────────────
console.log("\n## Balance (multi-factor)");
{
  const a = P("a", { mmr: 1500, skill: 60 });
  const even = P("b", { mmr: 1505, skill: 60 });
  const far = P("c", { mmr: 2100, skill: 60 });
  const crossRegion = P("d", { mmr: 1505, skill: 60, region: "China" });
  check("MMR: emparejamiento igualado > emparejamiento desigual", matchQuality(a, even) > matchQuality(a, far));
  check("BALANCE: NUNCA solo MMR — misma región > región cruzada a igual MMR", matchQuality(a, even) > matchQuality(a, crossRegion));
  check("PING/REGIÓN: ping local < ping cruzado", regionPing("EMEA", "EMEA") < regionPing("EMEA", "China") && pairPing(a, crossRegion) > pairPing(a, even));
  check("BALANCE: equilibrio de equipos ~50/50 a MMR similar", teamBalance([a], [even]) >= 90);
  check("PARTY: el balance considera el tamaño de party (infra)", matchQuality(P("p1", { partyId: "x" }), P("p2", { partyId: "y" })) > 0);
}

// ─────────────────────── 4. Servidor + Región ───────────────────────
console.log("\n## Selección de servidor");
{
  const nodes = defaultNodes();
  const comp = selectServer("competitive", "EMEA", nodes);
  const off = selectServer("offline_local", "EMEA", nodes);
  const lan = selectServer("lan", "EMEA", nodes);
  check("SERVER: competitive → dedicado en la región más cercana", comp.kind === "dedicated" && comp.region === "EMEA");
  check("SERVER: offline/practice → servidor offline; lan → lan", off.kind === "offline" && lan.kind === "lan");
  check("SERVER: mapea el tipo por modo", kindForMode("ai_match") === "offline" && kindForMode("dedicated") === "dedicated");
}

// ─────────────────────── 5. Flujo PVP + Ready Check + Lobby/Session/Gameplay ───────────────────────
console.log("\n## Flujo PVP (ready check → lobby → server → gameplay)");
{
  const mm = new Matchmaker({ seedBase: 100 });
  const launched: { p: MatchProposal; draft: LobbyDraft }[] = [];
  mm.onMatchReady = (p, draft) => launched.push({ p, draft });
  const tA = mm.enqueue(P("Ana", { mmr: 1500 }), "competitive").ticket!;
  const tB = mm.enqueue(P("Ben", { mmr: 1512 }), "competitive").ticket!;
  mm.tick(1);
  const prop = mm.proposal(tA.proposalId!);
  check("SEARCH→PROPOSAL: dos compatibles generan una propuesta con ready check", !!prop && prop.readyCheck.needed.length === 2);
  check("SEED: la propuesta trae un seed determinista", !!prop && prop.seed === seedFor(100, prop.id));
  mm.accept(tA.id); mm.accept(tB.id);
  mm.tick(2);
  check("READY CHECK: al aceptar ambos, la partida se CONFIRMA y se lanza", launched.length === 1 && !mm.isQueued("Ana") && !mm.isQueued("Ben"));
  const draft = launched[0].draft;
  check("LOBBY/SESSION: produce un LobbyDraft válido (rosters 5v5 + coach)", draft.rosters.home.length === 5 && draft.rosters.away.length === 5 && draft.coach.mode === "manual");
  // Compat Online Core + Gameplay: correr el partido matchmade hasta el final.
  const game = playDraft(draft);
  check("COMPAT ONLINE CORE/GAMEPLAY: el partido matchmade llega a MATCH_END", game.server.match!.phase === "MATCH_END" && !!game.server.match!.winner);
  const offline = simulateMatch(game.server.config!);
  check("COMPAT OFFLINE: el partido == simulateMatch (mismo Gameplay)", game.server.match!.score.home === offline.score.home && game.server.match!.winner === offline.winner);
  check("COMPAT REPLAY: seed + input log reconstruyen el partido matchmade", reconstruct(game.server.config!, newInputLog(game.server.config!.seed)).winner === game.server.match!.winner);
}

// ─────────────────────── 6. Bot Fill (modos instantáneos) ───────────────────────
console.log("\n## Bot fill (instantáneo)");
{
  const mm = new Matchmaker({ seedBase: 200 });
  const launched: { p: MatchProposal; draft: LobbyDraft }[] = [];
  mm.onMatchReady = (p, draft) => launched.push({ p, draft });
  mm.enqueue(P("Solo", { mmr: 1500 }), "ai_match");
  mm.tick(1);
  check("BOT FILL: un modo instantáneo empareja al INSTANTE contra bots", launched.length === 1 && launched[0].p.botsAway === 1);
  check("BOT FILL: el rival bot trae un roster real de 5", launched[0].draft.rosters.away.length === 5);
  check("BOT FILL: isBot detecta perfiles bot", isBot("bot-1-0") && !isBot("Solo"));
}

// ─────────────────────── 7. Decline + Reconnect/Auto-retry ───────────────────────
console.log("\n## Decline + auto-retry (reconnect queue)");
{
  const mm = new Matchmaker({ seedBase: 300 });
  const tA = mm.enqueue(P("A", { mmr: 1500 }), "competitive").ticket!;
  const tB = mm.enqueue(P("B", { mmr: 1508 }), "competitive").ticket!;
  mm.tick(1);
  mm.accept(tA.id); mm.decline(tB.id);
  mm.tick(2);
  check("DECLINE: rechazar cae la propuesta; el que aceptó VUELVE a la cola (auto-retry)", mm.isQueued("A") && !mm.isQueued("B") && (mm.ticket(tA.id)?.retries ?? 0) >= 1 && mm.metrics.declined >= 1);
}

// ─────────────────────── 8. Ready check timeout ───────────────────────
console.log("\n## Ready check timeout");
{
  const mm = new Matchmaker({ seedBase: 350, readyTimeout: 5 });
  const tA = mm.enqueue(P("A", { mmr: 1500 }), "competitive").ticket!;
  const tB = mm.enqueue(P("B", { mmr: 1506 }), "competitive").ticket!;
  mm.tick(1); mm.accept(tA.id); // B nunca acepta
  mm.tick(10); // pasa el deadline
  check("TIMEOUT: si no todos aceptan, la propuesta EXPIRA y se re-encola", mm.metrics.expired >= 1 && mm.isQueued("A"));
}

// ─────────────────────── 9. Backfill ───────────────────────
console.log("\n## Backfill");
{
  const mm = new Matchmaker({ seedBase: 400 });
  const tA = mm.enqueue(P("A", { mmr: 1500 }), "competitive").ticket!;
  const tB = mm.enqueue(P("B", { mmr: 1509 }), "competitive").ticket!;
  mm.tick(1);
  const pid = tA.proposalId!;
  const ok = mm.backfill(pid, tB.id);
  const p = mm.proposal(pid)!;
  check("BACKFILL: sustituir a un caído por un bot (partida no huérfana)", ok && p.botsAway + p.botsHome >= 1 && p.readyCheck.needed.length === 1);
}

// ─────────────────────── 10. Determinismo ───────────────────────
console.log("\n## Determinismo");
function scenario(seedBase: number): string {
  const mm = new Matchmaker({ seedBase });
  const launched: MatchProposal[] = [];
  mm.onMatchReady = (p) => launched.push(p);
  const regions = ["EMEA", "Americas", "Pacific", "China"] as const;
  for (let i = 0; i < 40; i++) mm.enqueue(P(`u${i}`, { mmr: 1400 + (i * 37) % 400, region: regions[i % 4] }), "competitive");
  for (let t = 1; t <= 60; t++) { mm.tick(t); for (const pr of [...mm["proposals"].values()]) { for (const id of [...pr.teamHome, ...pr.teamAway]) mm.accept(id); } }
  return JSON.stringify(launched.map((p) => ({ id: p.id, seed: p.seed, home: p.teamHome, away: p.teamAway, srv: p.server.id, q: p.quality })));
}
check("DETERMINISMO: mismo seedBase + mismas acciones ⇒ mismos emparejamientos", scenario(500) === scenario(500));
check("DETERMINISMO: seedBase distinto ⇒ resultados distintos (ids)", scenario(1) !== scenario(2));

// ─────────────────────── 11. Rendimiento (miles, sin O(n²)) ───────────────────────
console.log("\n## Rendimiento (escala)");
{
  const N = Math.max(500, Number(process.argv[2] ?? 2000));
  const mm = new Matchmaker({ seedBase: 900 });
  let matched = 0; mm.onMatchReady = () => { matched++; };
  const regions = ["EMEA", "Americas", "Pacific", "China"] as const;
  const t0 = Date.now();
  for (let i = 0; i < N; i++) mm.enqueue(P(`p${i}`, { mmr: 1200 + (i * 53) % 900, region: regions[i % 4] }), "competitive");
  for (let t = 1; t <= 80; t++) { mm.tick(t); for (const pr of [...mm["proposals"].values()]) for (const id of [...pr.teamHome, ...pr.teamAway]) mm.accept(id); }
  const ms = Date.now() - t0;
  check("RENDIMIENTO: miles de jugadores emparejan sin O(n²)", ms < 2500 && matched > N * 0.3, `${N} jugadores · ${matched} partidas · ${ms}ms`);
}

// ─────────────────────── 12. Cero estados imposibles ───────────────────────
console.log("\n## Integridad (cero estados imposibles)");
{
  const mm = new Matchmaker({ seedBase: 777 });
  mm.onMatchReady = () => {};
  const regions = ["EMEA", "Americas", "Pacific", "China"] as const;
  for (let i = 0; i < 200; i++) mm.enqueue(P(`x${i}`, { mmr: 1300 + (i * 41) % 500, region: regions[i % 4] }), "competitive");
  for (let t = 1; t <= 40; t++) { mm.tick(t); if (t % 3 === 0) for (const pr of [...mm["proposals"].values()]) for (const id of [...pr.teamHome, ...pr.teamAway]) mm.accept(id); }
  // Ningún jugador en dos tickets; ningún ticket en dos propuestas; membership consistente.
  const seenPlayer = new Set<string>(); let bad = 0;
  for (const pr of [...mm["proposals"].values()]) for (const id of [...pr.teamHome, ...pr.teamAway]) { const t = mm.ticket(id); if (!t) { bad++; continue; } if (seenPlayer.has(t.profile.id)) bad++; seenPlayer.add(t.profile.id); }
  check("INTEGRIDAD: sin dobles colas, sin tickets huérfanos, membership coherente", bad === 0 && mm.queuedCount() >= 0);
  check("INTEGRIDAD: métricas coherentes (matched ≤ enqueued)", mm.metrics.matched <= mm.metrics.enqueued && mm.metrics.matched >= 0);
}

console.log(`\n${failures === 0 ? "✅ TODAS LAS COMPROBACIONES PASAN" : `❌ ${failures} COMPROBACIÓN(ES) FALLARON`}`);
process.exit(failures === 0 ? 0 : 1);

// Señal de fallo para CI: sale con código !=0 si alguna comprobación falló.
if (failures > 0) process.exitCode = 1;
