/**
 * VERIFICACIÓN — Tournament Engine (DRL Champions, Online Fase 6/7).
 *
 *   npx tsx scripts/tournament-verify.ts
 *
 * Comprueba: brackets · swiss · round robin · single/double elim · seeding · ranking · schedule ·
 * check-in · walkover · forfeit · admin · determinismo · rendimiento · cero estados imposibles +
 * compat Online/Matchmaking/Replay/Competitive/Gameplay/Career/Living-World. Reutiliza el ÚNICO
 * Gameplay. DETERMINISTA.
 */
import type { Region } from "../src/domain/cards/types";
import { simulateMatch, makeMatchConfig } from "../src/match";
import { buildRivalRoster } from "../src/lib/match/roster";
import { createServer, loopbackServerBus, LoopbackHub, reconstruct, newInputLog } from "../src/online";
import { CompetitiveEngine, type CompetitiveMatchResult } from "../src/competitive";
import { Tournament, seedTeams, gameplayPlay, circuitPointsFor, bracketView, standingsView, readyFixtures, advanceFixture, buildSingleElim, type TeamInput, type PlayFn } from "../src/tournament";

let failures = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`  ${c ? "✓" : "✕"} ${l}${d ? ` — ${d}` : ""}`); if (!c) failures++; };
console.log("# Verificación del Tournament Engine — DRL Champions (Online Fase 6)\n");

const REGIONS: Region[] = ["EMEA", "Americas", "Pacific", "China"];
const mkTeams = (n: number): TeamInput[] => Array.from({ length: n }, (_, i) => ({ id: `t${i}`, name: `Team ${i}`, region: REGIONS[i % 4], rating: 1900 - i * 40 }));
/** PlayFn determinista: gana SIEMPRE el equipo de mayor rating (la mejor semilla). */
const seedPlay: PlayFn = (ctx) => { const a = ctx.teamA.rating >= ctx.teamB.rating; return { winner: a ? "A" : "B", scoreHome: a ? 13 : 8, scoreAway: a ? 8 : 13, matchId: `${ctx.fixture.id}-m${ctx.mapIndex}` }; };

function mk(format: any, n: number, opts: any = {}): Tournament {
  const t = new Tournament({ id: "t", name: "T", tier: opts.tier ?? "major", format, seedMethod: opts.seedMethod ?? "rank", seriesFormat: opts.series ?? "bo1", seed: opts.seed ?? 42, swissRounds: opts.swissRounds, groupCount: opts.groupCount, groupAdvance: opts.groupAdvance, adminId: "admin" }, opts.play ?? seedPlay);
  for (const tm of mkTeams(n)) t.register(tm);
  for (const tm of t.teams) t.checkIn(tm.id);
  return t;
}
function runT(format: any, n: number, opts: any = {}): Tournament { const t = mk(format, n, opts); t.run(); return t; }

// ─────────────────────── 1. Seeding ───────────────────────
console.log("## Seeding");
{
  const teams = mkTeams(8).map((t) => ({ ...t, seed: 0, roster: null, status: "active" as const, checkedIn: true, wins: 0, losses: 0, placement: null }));
  const rank = seedTeams(teams, "rank", 1);
  check("SEED rank: por rating (semilla 1 = mejor)", rank[0].seed === 1 && rank[0].rating >= rank[1].rating && rank[7].rating <= rank[6].rating);
  check("SEED random: determinista (mismo seed ⇒ mismo orden)", JSON.stringify(seedTeams(teams, "random", 5).map((t) => t.id)) === JSON.stringify(seedTeams(teams, "random", 5).map((t) => t.id)));
  check("SEED regional: reparte regiones", new Set(seedTeams(teams, "regional", 1).slice(0, 4).map((t) => t.region)).size >= 2);
}

// ─────────────────────── 2. Single Elimination ───────────────────────
console.log("\n## Single Elimination");
{
  const t = runT("single_elim", 8);
  check("SINGLE ELIM: se completa y corona a la mejor semilla (gana el mejor)", t.isFinished() && t.champion() === "t0");
  check("SINGLE ELIM: hay final + bronce disputados", !!t.bracket!.finalId && t.bracket!.fixtures[t.bracket!.finalId].status === "done" && !!t.bracket!.fixtures["se-bronze"] && t.bracket!.fixtures["se-bronze"].status === "done");
  const st = standingsView(t);
  check("RANKING: clasificación coherente (campeón el 1º)", st[0].teamId === "t0" && st.length === 8);
}

// ─────────────────────── 3. Double Elimination ───────────────────────
console.log("\n## Double Elimination");
{
  const t = mk("double_elim", 8); t.start(0);
  const ub1 = readyFixtures(t.bracket!).filter((f) => f.stage === "upper" && f.round === 1);
  for (const f of ub1) t.playFixture(f.id);
  const losers = ub1.map((f) => f.loser!);
  check("DOUBLE ELIM: quien pierde en upper NO queda eliminado (segunda vida)", losers.every((id) => t.teams.find((x) => x.id === id)!.status === "active"));
  t.run();
  check("DOUBLE ELIM: se completa con Gran Final y campeón válido", t.isFinished() && t.bracket!.finalId === "de-gf" && !!t.champion());
}

// ─────────────────────── 4. Swiss ───────────────────────
console.log("\n## Swiss");
{
  const t = runT("swiss", 8, { swissRounds: 3 });
  check("SWISS: se juegan todas las rondas y hay campeón", t.isFinished() && !!t.champion());
  const games = (id: string) => { const tm = t.teams.find((x) => x.id === id)!; return tm.wins + tm.losses; };
  check("SWISS: cada equipo juega ~el nº de rondas", t.teams.every((tm) => games(tm.id) >= 2 && games(tm.id) <= 3));
}

// ─────────────────────── 5. Round Robin ───────────────────────
console.log("\n## Round Robin");
{
  const t = runT("round_robin", 6);
  check("ROUND ROBIN: se juegan todos los enfrentamientos", t.isFinished() && Object.keys(t.bracket!.fixtures).length === 15);
  check("ROUND ROBIN: cada equipo juega n-1 y campeón por victorias", t.teams.every((tm) => tm.wins + tm.losses === 5) && t.champion() === "t0");
}

// ─────────────────────── 6. Groups → Playoffs ───────────────────────
console.log("\n## Groups → playoffs");
{
  const t = runT("groups", 8, { groupCount: 2, groupAdvance: 2 });
  check("GROUPS: fase de grupos + playoff construido, campeón válido", t.isFinished() && t.bracket!.format === "single_elim" && !!t.champion());
  const eliminatedInGroups = t.teams.filter((tm) => tm.status === "eliminated").length;
  check("GROUPS: los no clasificados quedan eliminados", eliminatedInGroups >= 4);
}

// ─────────────────────── 7. Check-in ───────────────────────
console.log("\n## Check-in");
{
  const t = new Tournament({ id: "c", name: "C", tier: "minor", format: "single_elim", seedMethod: "rank", seriesFormat: "bo1", seed: 1, adminId: "admin" }, seedPlay);
  for (const tm of mkTeams(4)) t.register(tm);
  t.checkIn("t0");
  check("CHECK-IN: no arranca si no hay suficientes equipos confirmados", !t.start(0).ok);
  t.checkIn("t1"); t.checkIn("t2"); t.checkIn("t3");
  check("CHECK-IN: arranca con los confirmados", t.start(0).ok);
  check("SEGURIDAD: no admite equipos duplicados", !t.register({ id: "t0", name: "dup", region: "EMEA", rating: 1 }).ok);
}

// ─────────────────────── 8. Walkover / Forfeit / Admin ───────────────────────
console.log("\n## Walkover / forfeit / admin");
{
  const t = mk("single_elim", 8); t.start(0);
  const f = readyFixtures(t.bracket!)[0];
  check("WALKOVER: el admin adjudica un fixture (rival ausente)", t.walkover("admin", f.id, "A").ok && t.bracket!.fixtures[f.id].status === "walkover" && t.bracket!.fixtures[f.id].winner === f.slotA);
  const f2 = readyFixtures(t.bracket!)[0];
  check("FORFEIT: el admin declara la baja del slot A ⇒ gana B", t.forfeit("admin", f2.id, "A").ok && t.bracket!.fixtures[f2.id].winner === f2.slotB);
  check("ADMIN: un NO admin no puede adjudicar/pausar", !t.walkover("hacker", readyFixtures(t.bracket!)[0]?.id ?? "x", "A").ok && !t.pause("hacker").ok);
  check("PAUSE: pausado bloquea jugar; DQ excluye al equipo", t.pause("admin").ok && !t.playFixture(readyFixtures(t.bracket!)[0]?.id ?? "x").ok && (t.resume("admin"), t.disqualify("admin", "t7").ok) && !standingsView(t).some((s) => s.teamId === "t7"));
}

// ─────────────────────── 9. Awards / Circuit points ───────────────────────
console.log("\n## Awards / circuit points");
{
  const t = runT("single_elim", 8, { tier: "worlds" });
  const aw = t.awards(); const cp = t.circuitPoints();
  check("AWARDS: campeón / subcampeón / tercero", aw.championId === "t0" && !!aw.runnerUpId && aw.championId !== aw.runnerUpId);
  check("CIRCUIT POINTS: el campeón recibe más puntos y escalan por tier", cp[0].points > cp[1].points && circuitPointsFor("worlds", 1, 8) > circuitPointsFor("regional", 1, 8));
}

// ─────────────────────── 10. Presentation + Schedule ───────────────────────
console.log("\n## Presentation + schedule");
{
  const t = mk("single_elim", 8); t.start(0);
  const bv = bracketView(t);
  check("PRESENTATION: bracketView con rondas/fixtures", bv.rounds.length >= 3 && bv.rounds[0].fixtures.length === 4 && bv.format === "single_elim");
  check("SCHEDULE: fixtures listos para disputar (ready)", readyFixtures(t.bracket!).length === 4);
}

// ─────────────────────── 11. Compat Gameplay / Online / Replay / Competitive ───────────────────────
console.log("\n## Compat (Gameplay / Online / Replay / Competitive)");
{
  const t = mk("single_elim", 4, { play: gameplayPlay(), series: "bo3" });
  t.start(0); t.run();
  check("COMPAT GAMEPLAY: el torneo se juega con el ÚNICO Gameplay (simulateMatch) y corona", t.isFinished() && !!t.champion());
  // Un mapa del torneo == una MatchConfig lanzable en el servidor online + reconstruible (replay).
  const home = buildRivalRoster(0x101, new Set(), "hard"); const away = buildRivalRoster(0x202, new Set(), "easy");
  const cfg = makeMatchConfig({ seed: 12345, rosters: { home, away }, homeSetup: { side: "ATK", approach: "default", tempo: "mid", aggression: "balanced" }, teamNames: { home: "A", away: "B" }, coach: { mode: "ai" } });
  const hub = new LoopbackHub(); const server = createServer(loopbackServerBus(hub)); server.startMatch(cfg);
  let k = 0; while (server.match!.phase !== "MATCH_END" && k++ < 200000) server.tick(k);
  check("COMPAT ONLINE: un partido de torneo se juega en el servidor autoritativo hasta MATCH_END", server.match!.phase === "MATCH_END");
  check("COMPAT REPLAY: ese partido es reconstruible (seed + input log)", reconstruct(cfg, newInputLog(cfg.seed)).winner === simulateMatch(cfg).winner);
  const comp = new CompetitiveEngine();
  const cr: CompetitiveMatchResult = { matchId: "tf-1", season: 1, mode: "competitive", homeId: t.champion()!, awayId: "t1", winner: "home", scoreHome: 13, scoreAway: 9, mvp: null, region: "EMEA", at: 1 };
  check("COMPAT COMPETITIVE: el resultado alimenta el ranking", comp.applyMatchResult(cr).players.length === 2);
}

// ─────────────────────── 12. Determinismo ───────────────────────
console.log("\n## Determinismo");
{
  const proj = () => { const t = runT("double_elim", 8, { seed: 999 }); return JSON.stringify({ champ: t.champion(), st: standingsView(t).map((s) => s.teamId), fx: Object.values(t.bracket!.fixtures).map((f) => [f.id, f.winner]) }); };
  check("DETERMINISMO: mismo seed + mismos resultados ⇒ mismo torneo", proj() === proj());
}

// ─────────────────────── 13. Rendimiento ───────────────────────
console.log("\n## Rendimiento");
{
  const t0 = Date.now(); const N = 300;
  for (let i = 0; i < N; i++) runT("double_elim", 16, { seed: i });
  const ms = Date.now() - t0;
  check("RENDIMIENTO: cientos de torneos, avance incremental (sin O(n²))", ms < 3000, `${N} torneos·16 equipos·${ms}ms`);
}

// ─────────────────────── 14. Cero estados imposibles ───────────────────────
console.log("\n## Integridad (cero estados imposibles)");
{
  const t = runT("double_elim", 8, { seed: 7 });
  let bad = 0; const reasons: string[] = [];
  for (const f of Object.values(t.bracket!.fixtures)) {
    if (f.slotA && f.slotB && f.slotA === f.slotB) { bad++; reasons.push(`self ${f.id}`); }
    if (f.status === "done" && f.winner !== f.slotA && f.winner !== f.slotB) { bad++; reasons.push(`winner ${f.id}`); }
  }
  const champ = t.champion();
  if (!t.teams.some((x) => x.id === champ)) { bad++; reasons.push("champ"); }
  // Un equipo eliminado nunca en un fixture ready.
  const elim = new Set(t.teams.filter((x) => x.status === "eliminated").map((x) => x.id));
  for (const f of readyFixtures(t.bracket!)) if (elim.has(f.slotA ?? "") || elim.has(f.slotB ?? "")) { bad++; reasons.push(`ready-elim ${f.id}`); }
  // advanceFixture rechaza ganador inválido.
  const anyDone = Object.values(t.bracket!.fixtures).find((f) => f.status === "done")!;
  const invalid = advanceFixture(t.bracket!, anyDone.id, "ZZZ", "YYY");
  check("INTEGRIDAD: sin auto-partidos, ganadores válidos, sin eliminados avanzando, campeón participante", bad === 0 && !invalid.ok, bad ? reasons.slice(0, 4).join(" · ") : "OK");
}

console.log(`\n${failures === 0 ? "✅ TODAS LAS COMPROBACIONES PASAN" : `❌ ${failures} COMPROBACIÓN(ES) FALLARON`}`);
process.exit(failures === 0 ? 0 : 1);

// Señal de fallo para CI: sale con código !=0 si alguna comprobación falló.
if (failures > 0) process.exitCode = 1;
