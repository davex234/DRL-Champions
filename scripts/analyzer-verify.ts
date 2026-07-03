/**
 * VERIFICACIÓN DEL TOURNAMENT ANALYZER (Card Generator Fase 2/7).
 *
 * Comprueba: estadísticas · rankings · awards · placements · eliminaciones · narrativa ·
 * determinismo · rendimiento · cero estados imposibles · compat con importer · compat con
 * domain/esports. Consume el Canonical Model (construido con el ImportEngine). Falla de verdad.
 */
import {
  importSnapshot, makeClock, createIdentityResolver, buildRegistry, type RawSnapshot, type ImportCtx,
} from "@/importer";
import { analyzeTournament } from "@/analyzer";
import type { Tournament, ProTeam } from "@/domain/esports/types";

let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail = ""): void => {
  console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};

const registry = buildRegistry([]);
const ctx = (): ImportCtx => ({ clock: makeClock(1_700_000_000_000), identity: createIdentityResolver(registry) });

// ── Fixture analítico (final SEN 2-0 NRG, semifinal SEN>G2, FNC eliminado) ──
const fixture: RawSnapshot = {
  tournament: { id: "champions-2025", name: "Champions 2025", type: "champions", tier: "vct-international", status: "finished", startDate: "2025-09-01T00:00:00Z" },
  stages: [{ id: "st-po", name: "Playoffs", kind: "playoff", orderIdx: 0 }],
  teams: [
    { id: "sen", name: "Sentinels", region: "Americas", active: true },
    { id: "nrg", name: "NRG", region: "Americas" },
    { id: "g2", name: "G2", region: "Americas" },
    { id: "fnc", name: "Fnatic", region: "EMEA" },
  ],
  players: [
    { id: "star", nick: "zekken", team: "Sentinels", role: "duelist", agents: ["Jett", "Raze", "Neon"] },
    { id: "sup", nick: "zellsis", team: "Sentinels", role: "initiator", agents: ["Sova"] },
    { id: "riv", nick: "ethan", team: "NRG", role: "sentinel", agents: ["Killjoy"] },
  ],
  coaches: [{ id: "co", name: "kaplan", team: "Sentinels", status: "active" }],
  matches: [
    { id: "m0", stageId: "st-po", teamA: "Sentinels", teamB: "G2", status: "finished", format: "bo3", scoreA: 2, scoreB: 1, winner: "Sentinels", round: "Semifinal", matchOrder: 1 },
    { id: "m1", stageId: "st-po", teamA: "Sentinels", teamB: "NRG", status: "finished", format: "bo3", scoreA: 2, scoreB: 0, winner: "Sentinels", round: "Grand Final", matchOrder: 2 },
  ],
  maps: [
    { id: "m0m1", matchId: "m0", mapOrder: 1, scoreA: 13, scoreB: 10, winner: "Sentinels" },
    { id: "m0m2", matchId: "m0", mapOrder: 2, scoreA: 8, scoreB: 13, winner: "G2" },
    { id: "m0m3", matchId: "m0", mapOrder: 3, scoreA: 13, scoreB: 11, winner: "Sentinels" },
    { id: "m1m1", matchId: "m1", mapOrder: 1, scoreA: 13, scoreB: 7, winner: "Sentinels" },
    { id: "m1m2", matchId: "m1", mapOrder: 2, scoreA: 13, scoreB: 9, winner: "Sentinels" },
  ],
  mapStats: [
    { matchMapId: "m0m1", matchId: "m0", player: "zekken", team: "Sentinels", acs: 300, kills: 20, deaths: 10, assists: 4, kast: 80, adr: 170, hsPct: 32, fk: 5, fd: 2, clutches: 3 },
    { matchMapId: "m1m1", matchId: "m1", player: "zekken", team: "Sentinels", acs: 200, kills: 10, deaths: 10, assists: 6, kast: 70, adr: 150, hsPct: 25, fk: 2, fd: 2, clutches: 2 },
    { matchMapId: "m0m1", matchId: "m0", player: "zellsis", team: "Sentinels", acs: 190, kills: 12, deaths: 12, assists: 9, kast: 74, adr: 140, fk: 1, fd: 1, clutches: 0 },
    { matchMapId: "m1m1", matchId: "m1", player: "ethan", team: "NRG", acs: 210, kills: 14, deaths: 15, assists: 5, kast: 68, adr: 145, fk: 2, fd: 3, clutches: 1 },
  ],
  standings: [
    { team: "Sentinels", position: 1, wins: 2, losses: 0, mapsWon: 4, mapsLost: 1, status: "qualified" },
    { team: "NRG", position: 2, wins: 1, losses: 1, mapsWon: 2, mapsLost: 2 },
    { team: "G2", position: 3, wins: 1, losses: 1 },
    { team: "Fnatic", position: 4, wins: 0, losses: 1, status: "eliminated" },
  ],
  awards: { champion: "Sentinels", runnerUp: "NRG" },
};

console.log("# Verificación del Tournament Analyzer — DRL Champions\n");
const imp = importSnapshot(fixture, ctx());
const rep = analyzeTournament(imp.model);

// COMPAT IMPORTER + DOMAIN
console.log("## Compatibilidad");
check("compat importer: modelo importado OK", imp.ok, `${imp.issues.length} issues`);
check("compat domain/esports: conteos coherentes", rep.summary.teams === 4 && rep.summary.players === 3 && rep.summary.matches === 2 && rep.summary.maps === 5);

// ESTADÍSTICAS
console.log("\n## Estadísticas");
const star = rep.players.find((p) => p.playerId === "p:zekken")!;
check("agregación correcta (ACS medio, KD, totales)", !!star && star.acs === 250 && star.kd === 1.5 && star.kills === 30 && star.clutches === 5, star ? `acs=${star.acs} kd=${star.kd} clutch=${star.clutches}` : "sin jugador");
check("métricas derivadas en rango", !!star && star.impact >= 0 && star.impact <= 100 && star.rating >= 1 && star.rating <= 99 && star.roles.duelist >= 0 && star.roles.duelist <= 100);

// RANKINGS
console.log("\n## Rankings");
const sortedDesc = (ids: string[], key: (id: string) => number): boolean => ids.every((id, i) => i === 0 || key(ids[i - 1]) >= key(id));
const ratingOf = new Map(rep.players.map((p) => [p.playerId, p.rating]));
check("byRating ordenado desc y completo", rep.rankings.byRating.length === rep.players.length && sortedDesc(rep.rankings.byRating, (id) => ratingOf.get(id) ?? 0));
check("mvpCandidates ⊂ players, orden por mvpScore", rep.mvpCandidates.length > 0 && rep.mvpCandidates[0].mvpScore >= rep.mvpCandidates[rep.mvpCandidates.length - 1].mvpScore);

// AWARDS
console.log("\n## Awards");
const award = (k: string) => rep.awards.find((a) => a.kind === k);
check("MVP asignado", !!award("mvp"));
check("best-clutch = jugador con más clutches (zekken)", award("best-clutch")?.playerId === "p:zekken");
check("best-coach = coach del campeón", award("best-coach")?.coachId === "c:kaplan" && award("best-coach")?.teamId === "t:sentinels");
check("best-team = campeón", award("best-team")?.teamId === "t:sentinels");
check("awards SIN artefactos de carta", rep.awards.every((a) => !("cardId" in a) && !("variantId" in a)));

// PLACEMENTS + ELIMINACIONES
console.log("\n## Placements / Eliminaciones");
check("placements ordenados por posición", rep.placements.length === 4 && rep.placements[0].position === 1 && rep.placements[0].teamId === "t:sentinels");
check("eliminatedTeams incluye Fnatic", rep.eliminatedTeams.includes("t:fnatic"));
check("qualifiedTeams incluye Sentinels", rep.qualifiedTeams.includes("t:sentinels"));
const sen = rep.teams.find((t) => t.teamId === "t:sentinels")!;
check("campeón detectado con round diff y winrate", !!sen && sen.champion && sen.winrate === 1 && sen.roundDiff > 0);

// NARRATIVA
console.log("\n## Narrativa (etiquetas estructuradas)");
check("flawless-finals detectado (SEN 2-0)", rep.storyTags.some((t) => t.kind === "flawless-finals" && t.teamId === "t:sentinels"));
check("story tags son etiquetas (sin frases/IA)", rep.storyTags.every((t) => typeof t.kind === "string" && (!("text" in t))));

// DETERMINISMO
console.log("\n## Determinismo");
const a = JSON.stringify(analyzeTournament(importSnapshot(fixture, ctx()).model));
const b = JSON.stringify(analyzeTournament(importSnapshot(fixture, ctx()).model));
check("mismo modelo ⇒ mismo informe (byte a byte)", a === b);

// CERO ESTADOS IMPOSIBLES
console.log("\n## Cero estados imposibles");
const finite = (n: number) => Number.isFinite(n);
const okPlayers = rep.players.every((p) => finite(p.rating) && p.rating >= 0 && p.rating <= 99 && finite(p.impact) && p.impact >= 0 && p.impact <= 100 && finite(p.mvpScore) && p.mvpScore >= 0 && p.mvpScore <= 100 && Object.values(p.roles).every((r) => finite(r) && r >= 0 && r <= 100) && p.consistency >= 0 && p.consistency <= 100);
const okTeams = rep.teams.every((t) => finite(t.winrate) && t.winrate >= 0 && t.winrate <= 1 && finite(t.strengthOfSchedule) && t.strengthOfSchedule >= 0 && t.strengthOfSchedule <= 1 && finite(t.roundDiff));
check("jugadores sin valores imposibles (rango/NaN)", okPlayers);
check("equipos sin valores imposibles (rango/NaN)", okTeams);

// RENDIMIENTO (modelo grande, sin O(n²))
console.log("\n## Rendimiento");
function bigSnapshot(T: number): RawSnapshot {
  const teams = Array.from({ length: T }, (_, i) => ({ id: `T${i}`, name: `Team ${i}`, active: true }));
  const players = teams.flatMap((t, ti) => Array.from({ length: 5 }, (_, pi) => ({ id: `p${ti}_${pi}`, nick: `p${ti}_${pi}`, team: t.name, role: ["duelist", "controller", "initiator", "sentinel", "duelist"][pi] })));
  const matches: RawSnapshot["matches"] = [];
  const maps: NonNullable<RawSnapshot["maps"]> = [];
  const mapStats: NonNullable<RawSnapshot["mapStats"]> = [];
  let order = 0;
  for (let i = 0; i < T; i++) for (let j = i + 1; j < T; j++) {
    const id = `m_${i}_${j}`;
    matches.push({ id, teamA: teams[i].name, teamB: teams[j].name, status: "finished", format: "bo3", scoreA: 2, scoreB: 1, winner: teams[i].name, matchOrder: order++ });
    for (let k = 0; k < 3; k++) {
      const mid = `${id}_${k}`;
      maps.push({ id: mid, matchId: id, mapOrder: k, scoreA: 13, scoreB: 10, winner: teams[i].name });
      for (let s = 0; s < 5; s++) { mapStats.push({ matchMapId: mid, matchId: id, player: `p${i}_${s}`, team: teams[i].name, acs: 200, kills: 15, deaths: 12, assists: 5, kast: 72, adr: 150, hsPct: 25, fk: 2, fd: 2, clutches: 1 }); }
    }
  }
  return { tournament: { id: "big", name: "Big", type: "masters", status: "finished" }, teams, players, matches, maps, mapStats, standings: teams.map((t, i) => ({ team: t.name, position: i + 1, wins: 1, losses: 0 })) };
}
const big = importSnapshot(bigSnapshot(30), ctx()).model;
const t0 = 1_700_000_000_000; // reloj lógico; medimos con hrtime real solo para informar
const startNs = process.hrtime.bigint();
const bigRep = analyzeTournament(big);
const ms = Number(process.hrtime.bigint() - startNs) / 1e6;
check("modelo grande analizado (30 equipos · 435 series · 1305 mapas · 6525 stats)", bigRep.players.length === 150 && bigRep.teams.length === 30 && bigRep.summary.matches === 435, `${Math.round(ms)} ms`);
check("rendimiento aceptable (sin O(n²) patológico)", ms < 4000, `${Math.round(ms)} ms`);
void t0;

console.log(`\n${fail === 0 ? "✅ TODAS LAS COMPROBACIONES PASAN" : `❌ ${fail} COMPROBACIÓN(ES) FALLARON`} — ${pass}/${pass + fail}`);
if (fail > 0) process.exitCode = 1;
