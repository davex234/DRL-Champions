/**
 * VERIFICACIÓN DEL DATA IMPORT ENGINE (Fase 1/7).
 *
 * Comprueba: determinismo · identidad única · normalización · las 6 validaciones · integridad de
 * referencias · detección de duplicados · compatibilidad con `domain/esports`. Falla de verdad
 * (process.exitCode) si algo no cuadra. 100% en memoria, sin red, con reloj/identidad inyectados.
 */
import {
  importSnapshot, makeClock, createIdentityResolver, buildRegistry, parseIso,
  IMPORTER_SCHEMA_VERSION, type RawSnapshot, type ImportCtx,
} from "@/importer";
import type { Tournament, ProTeam, ProPlayer, Match, MatchMap, Standing } from "@/domain/esports/types";

let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail = ""): void => {
  console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};
const has = (arr: { kind: string; severity: string }[], kind: string, sev = "error"): boolean =>
  arr.some((i) => i.kind === kind && i.severity === sev);

// Registro de alias (DATO inyectado, sin global).
const registry = buildRegistry([
  { canonical: "sentinels", variants: ["SEN", "Sentinels"] },
  { canonical: "tenz", variants: ["TenZ", "Tenz", "Tyson Ngo"] },
]);
const ctx = (schemaVersion?: number): ImportCtx => ({ clock: makeClock(1_700_000_000_000), identity: createIdentityResolver(registry), schemaVersion });
const serialize = (m: object): string => JSON.stringify({ ...m, index: undefined });

// ── Fixture VÁLIDO (estilo Masters, todas las entidades) ──
const valid: RawSnapshot = {
  tournament: { id: "masters-london-2025", name: "Masters London 2025", type: "international", circuitId: "vct-2025", tier: "vct-international", region: "International", status: "finished", startDate: "2025-06-01T00:00:00Z", endDate: "2025-06-15T00:00:00Z" },
  circuit: { id: "vct-2025", name: "VCT 2025", tier: "vct-international", scope: "international" },
  season: { id: "s-2025", name: "2025", year: 2025 },
  stages: [{ id: "st-groups", name: "Groups", kind: "group", orderIdx: 0 }, { id: "st-playoffs", name: "Playoffs", kind: "playoff", orderIdx: 1 }],
  groups: [{ id: "g-a", stageId: "st-groups", label: "A", teams: ["Sentinels", "NRG"] }],
  brackets: [{ id: "br-1", stageId: "st-playoffs", kind: "single-elim", nodes: [{ id: "n1", round: 0, matchId: "m1" }] }],
  teams: [{ id: "t1", name: "Sentinels", tag: "SEN", region: "Americas", active: true }, { id: "t2", name: "SEN" }, { id: "t3", name: "NRG", region: "Americas" }],
  players: [
    { id: "p1", nick: "TenZ", fullName: "Tyson Ngo", team: "Sentinels", role: "duelist", agents: ["Jett"] },
    { id: "p2", nick: "Tyson Ngo", team: "Sentinels" },
    { id: "p3", nick: "zellsis", team: "Sentinels" }, { id: "p4", nick: "Ethan", team: "NRG" },
  ],
  coaches: [{ id: "c1", name: "kaplan", team: "NRG", status: "active" }],
  rosterChanges: [{ team: "Sentinels", player: "TenZ", joinedAt: "2023-01-01", isActive: true }],
  matches: [{ id: "m1", stageId: "st-playoffs", teamA: "Sentinels", teamB: "NRG", startTime: "2025-06-10T18:00:00Z", status: "finished", format: "bo3", scoreA: 2, scoreB: 1, winner: "Sentinels", mvp: "TenZ" }],
  maps: [
    { id: "mm1", matchId: "m1", map: "Ascent", mapOrder: 1, winner: "Sentinels" },
    { id: "mm2", matchId: "m1", map: "Bind", mapOrder: 2, winner: "NRG" },
    { id: "mm3", matchId: "m1", map: "Haven", mapOrder: 3, winner: "Sentinels" },
  ],
  mapStats: [{ matchMapId: "mm1", matchId: "m1", player: "Tyson Ngo", team: "Sentinels", agent: "Jett", acs: 280, kills: 22, deaths: 14, kast: 78, adr: 168, hsPct: 30 }],
  rounds: [{ matchMapId: "mm1", index: 1, winner: "Sentinels", side: "attack", type: "pistol", plant: true }],
  standings: [{ team: "Sentinels", position: 1, wins: 3, losses: 0, mapsWon: 6, mapsLost: 2, status: "qualified" }],
  awards: { champion: "Sentinels", runnerUp: "NRG", mvp: "TenZ", placements: [{ position: 1, team: "Sentinels", prize: 350000 }, { position: 2, team: "NRG" }] },
};

console.log("# Verificación del Data Import Engine — DRL Champions\n");

// 1) DETERMINISMO
console.log("## 1. Determinismo");
const r1 = importSnapshot(valid, ctx());
const r2 = importSnapshot(valid, ctx());
check("mismo crudo ⇒ mismo modelo (byte a byte)", serialize(r1.model) === serialize(r2.model));
check("parseIso PURO: epochs ancla conocidos", parseIso("1970-01-01T00:00:00Z") === 0 && parseIso("1970-01-02") === 86_400_000 && parseIso("2000-01-01T00:00:00Z") === 946_684_800_000, `${parseIso("2000-01-01T00:00:00Z")}`);
check("parseIso maneja offset y rechaza basura", parseIso("2025-06-10T18:00:00+02:00") === parseIso("2025-06-10T16:00:00Z") && parseIso("no-fecha") === undefined);

// 2) IDENTIDAD
console.log("\n## 2. Identidad única");
const m = r1.model;
check("TenZ / Tyson Ngo → un solo playerId", !!m.index.playerById.get("p:tenz") && m.players.filter((p) => p.id === "p:tenz").length === 1, `players=${m.players.length}`);
check("Sentinels / SEN → un solo teamId", !!m.index.teamById.get("t:sentinels") && m.teams.filter((t) => t.id === "t:sentinels").length === 1, `teams=${m.teams.length}`);
check("ids canónicos prefijados por tipo", m.teams.every((t) => t.id.startsWith("t:")) && m.players.every((p) => p.id.startsWith("p:")) && m.coaches.every((c) => c.id.startsWith("c:")));

// 3) NORMALIZACIÓN
console.log("\n## 3. Normalización");
check("entidades objetivas nuevas pobladas", !!m.season && m.groups.length === 1 && m.brackets.length === 1 && m.rounds.length === 1 && m.coaches.length === 1 && m.rosters.length === m.teams.length && !!m.awards);
check("referencias remapeadas a ids canónicos", m.matches[0].teamAId === "t:sentinels" && m.matches[0].teamBId === "t:nrg" && m.matches[0].mvpPlayerId === "p:tenz" && m.mapStats[0].playerId === "p:tenz");
check("fechas parseadas en entidades nuevas (epoch)", typeof m.season!.startDate === "number" && m.rosters.some((r) => r.changes.some((c) => typeof c.joinedAt === "number")));
check("enums coercidos válidos (format/status/standing)", (["bo1", "bo3", "bo5"] as const).includes(m.matches[0].format) && (["upcoming", "live", "finished"] as const).includes(m.tournament.status) && m.standings[0].mapDiff === 4);

// 4) VALIDACIONES + 5) REFERENCIAS + 6) DUPLICADOS (fixture válido → limpio)
console.log("\n## 4-6. Validaciones / Referencias / Duplicados");
check("fixture válido: import OK (sin errores)", r1.ok, `${r1.issues.length} issues`);
check("sin errores de referencia en fixture válido", !has(r1.issues, "reference"));
check("dedup emitió issue info (equipo/jugador colapsado)", r1.issues.some((i) => i.kind === "duplicate" && i.severity === "info"));

// Fixture CORRUPTO: ref colgante + id duplicado + inconsistencia + versión
const corrupt: RawSnapshot = {
  ...valid,
  matches: [
    { id: "mX", teamA: "Ghost Team", teamB: "NRG", status: "finished", winner: "Ghost Team", scoreA: 2, scoreB: 0 },
    { id: "mX", teamA: "Sentinels", teamB: "NRG" }, // id duplicado
    { id: "mY", teamA: "Sentinels", teamB: "NRG", winner: "NRG", scoreA: 2, scoreB: 1 }, // ganador ok, marcador 3≠0 mapas
  ],
  maps: [], mapStats: [], rounds: [], brackets: [], groups: [], standings: [], awards: undefined,
};
const rc = importSnapshot(corrupt, ctx());
check("ref colgante detectada (Ghost Team)", has(rc.issues, "reference"));
check("id de partido duplicado detectado", has(rc.issues, "duplicate"));
check("import corrupto NO es ok", !rc.ok);
const rv = importSnapshot(valid, ctx(2)); // versión de esquema no soportada
check("versión de esquema no soportada detectada", has(rv.issues, "version") && !rv.ok);

// 7) COMPATIBILIDAD con domain/esports (asignación estructural + runtime)
console.log("\n## 7. Compatibilidad con domain/esports");
const t: Tournament = m.tournament;
const team: ProTeam = m.teams[0];
const player: ProPlayer = m.players[0];
const match: Match = m.matches[0];
const map: MatchMap = m.maps[0];
const st: Standing = m.standings[0];
check("tipos asignables a domain/esports (compile-time)", !!t && !!team && !!player && !!match && !!map && !!st);
check("ProPlayer cumple forma requerida", typeof player.nick === "string" && Array.isArray(player.agents) && typeof player.isSubstitute === "boolean" && typeof player.status === "string");
check("Standing con derivados calculados", st.mapDiff === st.mapsWon - st.mapsLost && st.roundDiff === st.roundsWon - st.roundsLost);

console.log(`\n${fail === 0 ? "✅ TODAS LAS COMPROBACIONES PASAN" : `❌ ${fail} COMPROBACIÓN(ES) FALLARON`} — ${pass}/${pass + fail}`);
if (fail > 0) process.exitCode = 1;
