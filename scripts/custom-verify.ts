/**
 * VERIFICACIÓN — Custom Game Engine (DRL Champions, Online Fase 5/7).
 *
 *   npx tsx scripts/custom-verify.ts
 *
 * Comprueba: custom games · private/password · slots observer/coach/referee · ready check · team
 * switch · side swap · kick · bot replace · settings · pause/resume/restart (autoridad) · determinismo ·
 * rendimiento · cero estados imposibles · compat Online/Gameplay/Competitive. Reutiliza makeMatchConfig
 * + Online Core. DETERMINISTA.
 */
import { simulateMatch } from "../src/match";
import { createServer, loopbackServerBus, LoopbackHub } from "../src/online";
import { CompetitiveEngine, type CompetitiveMatchResult } from "../src/competitive";
import { CustomGameEngine } from "../src/custom";

let failures = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`  ${c ? "✓" : "✕"} ${l}${d ? ` — ${d}` : ""}`); if (!c) failures++; };
console.log("# Verificación del Custom Game Engine — DRL Champions (Online Fase 5)\n");

const U = (id: string) => ({ id, name: id.toUpperCase() });

// ─────────────────────── 1. Crear + private/password + join ───────────────────────
console.log("## Crear + privacidad + join");
{
  const e = new CustomGameEngine(1);
  const g = e.create(U("host"), { privacy: "password", password: "1234", seed: 42 }, 0);
  check("CREATE: sala con host en home + slots observer/coach/referee", g.hostId === "host" && g.slots.some((s) => s.kind === "observer") && g.slots.some((s) => s.kind === "referee") && g.slots.find((s) => s.side === "home")!.userId === "host");
  check("PASSWORD: entra con la contraseña correcta, no sin ella", !e.join(g.id, U("p2"), "player", "bad").ok && e.join(g.id, U("p2"), "player", "1234").ok);
  const g2 = e.create(U("host2"), { seed: 99 }, 0);
  check("ANTI DOBLE JUEGO: un usuario en una sola sala (otra sala se rechaza)", !e.join(g2.id, U("p2"), "player", null).ok);
}

// ─────────────────────── 2. Slots (observer / coach / referee) ───────────────────────
console.log("\n## Slots");
{
  const e = new CustomGameEngine(2);
  const g = e.create(U("host"), { seed: 7 }, 0);
  e.join(g.id, U("p2"), "player", null);
  check("SLOTS: observador / coach / árbitro se ocupan", e.join(g.id, U("obs"), "observer", null).ok && e.join(g.id, U("co"), "coach", null).ok && e.join(g.id, U("ref"), "referee", null).ok);
  const gg = e.get(g.id)!;
  check("SLOTS: cada usuario en un único slot", new Set(gg.slots.filter((s) => s.userId).map((s) => s.userId)).size === gg.slots.filter((s) => s.userId).length);
}

// ─────────────────────── 3. Ready check + team switch + side swap ───────────────────────
console.log("\n## Ready check + team switch + side swap");
{
  const e = new CustomGameEngine(3);
  const g = e.create(U("host"), { seed: 9 }, 0);
  e.join(g.id, U("p2"), "player", null);
  e.ready(g.id, "host", true);
  check("READY CHECK: solo cuando todos los jugadores están listos", !e.readyCheck(g.id) && (e.ready(g.id, "p2", true), e.readyCheck(g.id)));
  const homeUser = e.get(g.id)!.slots.find((s) => s.kind === "player" && s.side === "home")!.userId;
  e.sideSwap(g.id, "host");
  check("SIDE SWAP: intercambia los lados (home ⇄ away)", e.get(g.id)!.slots.find((s) => s.kind === "player" && s.side === "away")!.userId === homeUser);
  e.join(g.id, U("co"), "coach", null);
  check("TEAM SWITCH: el host mueve a un usuario de slot", e.setSlot(g.id, "host", "co", "observer", null).ok);
}

// ─────────────────────── 4. Kick + bot replace (autoridad) ───────────────────────
console.log("\n## Kick + bot replace");
{
  const e = new CustomGameEngine(4);
  const g = e.create(U("host"), { seed: 11 }, 0);
  e.join(g.id, U("p2"), "player", null);
  e.join(g.id, U("ref"), "referee", null);
  check("KICK: un no autorizado no puede expulsar", !e.kick(g.id, "p2", "host").ok);
  check("KICK: host y árbitro autorizados", e.kick(g.id, "ref", "p2").ok);
  e.join(g.id, U("p3"), "player", null);
  check("BOT REPLACE: sustituye a un jugador por un bot", e.replaceWithBot(g.id, "host", "p3").ok && e.get(g.id)!.slots.some((s) => s.bot && s.userId!.startsWith("bot-")));
}

// ─────────────────────── 5. Controles (pausa/resume/restart, autoridad) ───────────────────────
console.log("\n## Controles en partida");
{
  const e = new CustomGameEngine(5);
  const g = e.create(U("host"), { seed: 13 }, 0);
  e.join(g.id, U("ref"), "referee", null);
  e.join(g.id, U("obs"), "observer", null);
  check("PAUSE: host/árbitro pausan; el observador NO", e.pauseMatch(g.id, "ref").ok && !e.pauseMatch(g.id, "obs").ok && e.get(g.id)!.controls.paused);
  check("RESUME: reanuda", e.resumeMatch(g.id, "host").ok && !e.get(g.id)!.controls.paused);
  check("RESTART: reinicio de ronda/partido (autorizado) + config relanzable", e.restartRound(g.id, "ref").ok && !!e.restartMatch(g.id, "host").config);
}

// ─────────────────────── 6. Settings + toMatchConfig + LAUNCH (compat Online/Gameplay) ───────────────────────
console.log("\n## Configuración + launch");
{
  const e = new CustomGameEngine(6);
  const g = e.create(U("host"), { seed: 555, firstTo: 4, economy: "infinite" }, 0);
  e.join(g.id, U("p2"), "player", null);
  check("SETTINGS: el host ajusta la sala (buy infinito ⇒ economía off)", e.setSettings(g.id, "host", { firstTo: 3 }).ok && !e.setSettings(g.id, "p2", { firstTo: 9 }).ok);
  const cfg = e.toMatchConfig(g.id)!;
  check("CONFIG: produce una MatchConfig válida (rosters 5v5, firstTo, buy infinito)", cfg.rosters.home.length === 5 && cfg.rosters.away.length === 5 && cfg.win.firstTo === 3 && cfg.economy === null);
  // Launch en el servidor autoritativo (compat Online) hasta MATCH_END.
  const hub = new LoopbackHub(); const server = createServer(loopbackServerBus(hub));
  server.startMatch(cfg);
  let t = 0; while (server.match!.phase !== "MATCH_END" && t++ < 200000) server.tick(t);
  check("COMPAT ONLINE/GAMEPLAY: la partida custom se juega hasta MATCH_END", server.match!.phase === "MATCH_END" && !!server.match!.winner);
  check("COMPAT GAMEPLAY: == simulateMatch (mismo motor)", server.match!.score.home === simulateMatch(cfg).score.home && server.match!.winner === simulateMatch(cfg).winner);
  // Compat Competitive.
  const comp = new CompetitiveEngine();
  const cr: CompetitiveMatchResult = { matchId: "cg-1", season: 1, mode: "competitive", homeId: "host", awayId: "p2", winner: server.match!.winner === "home" ? "home" : "away", scoreHome: server.match!.score.home, scoreAway: server.match!.score.away, mvp: null, region: "EMEA", at: 1 };
  check("COMPAT COMPETITIVE: el resultado alimenta el ranking", comp.applyMatchResult(cr).players.length === 2);
}

// ─────────────────────── 7. Determinismo ───────────────────────
console.log("\n## Determinismo");
{
  const build = () => { const e = new CustomGameEngine(8); const g = e.create(U("host"), { seed: 321, firstTo: 5 }, 0); e.join(g.id, U("p2"), "player", null); return JSON.stringify(e.toMatchConfig(g.id)); };
  check("DETERMINISMO: mismos ajustes ⇒ misma MatchConfig", build() === build());
}

// ─────────────────────── 8. Rendimiento + cero estados imposibles ───────────────────────
console.log("\n## Rendimiento + integridad");
{
  const e = new CustomGameEngine(9);
  const t0 = Date.now();
  const N = 2000;
  for (let i = 0; i < N; i++) { const g = e.create(U(`h${i}`), { seed: i }, i); e.join(g.id, U(`a${i}`), "player", null); }
  const ms = Date.now() - t0;
  check("RENDIMIENTO: miles de salas custom, incremental", ms < 2000 && e.size() === N, `${N} salas · ${ms}ms`);
  // Integridad.
  const eng = new CustomGameEngine(10);
  const g = eng.create(U("host"), { seed: 1 }, 0);
  eng.join(g.id, U("p2"), "player", null); eng.join(g.id, U("ref"), "referee", null);
  eng.sideSwap(g.id, "host"); eng.kick(g.id, "ref", "p2"); eng.replaceWithBot(g.id, "host", "host");
  const gg = eng.get(g.id)!;
  let bad = 0;
  const homeP = gg.slots.filter((s) => s.kind === "player" && s.side === "home").length;
  if (homeP !== 1) bad++;
  const users = gg.slots.filter((s) => s.userId && !s.bot).map((s) => s.userId);
  if (new Set(users).size !== users.length) bad++;
  check("INTEGRIDAD: un slot por lado, sin usuarios duplicados", bad === 0, bad ? "bad" : `${gg.slots.filter((s) => s.userId).length} ocupados OK`);
}

console.log(`\n${failures === 0 ? "✅ TODAS LAS COMPROBACIONES PASAN" : `❌ ${failures} COMPROBACIÓN(ES) FALLARON`}`);
process.exit(failures === 0 ? 0 : 1);
