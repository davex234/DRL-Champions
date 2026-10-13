/**
 * VALIDATOR — un dato corrupto NUNCA debe entrar limpio al modelo. Seis comprobaciones PURAS:
 * Schema · Identity · Reference · Duplicate · Consistency · Version. No lanza: acumula `ImportIssue`
 * con severidad. `ok` del import = no hay ninguna de severidad "error".
 */
import { IMPORTER_SCHEMA_VERSION, type CanonicalModel, type ImportIssue } from "../types";
import { ns } from "@/i18n/runtime";

const tr = ns("importer");

type Push = (i: ImportIssue) => void;

/** 1) SCHEMA — campos requeridos, tipos y rangos objetivos. */
export function validateSchema(m: CanonicalModel, push: Push): void {
  if (!m.tournament.id || !m.tournament.name) push({ kind: "schema", severity: "error", entity: "tournament", ref: m.tournament.id, message: tr("torneo sin id/nombre") });
  for (const t of m.teams) if (!t.id || !t.name) push({ kind: "schema", severity: "error", entity: "team", ref: t.id, message: tr("equipo sin id/nombre") });
  for (const p of m.players) {
    if (!p.id || !p.nick) push({ kind: "schema", severity: "error", entity: "player", ref: p.id, message: tr("jugador sin id/nick") });
    if (!Array.isArray(p.agents)) push({ kind: "schema", severity: "warning", entity: "player", ref: p.id, message: tr("agents no es lista") });
  }
  const pct = (v: number | undefined): boolean => v == null || (v >= 0 && v <= 100);
  for (const s of m.mapStats) {
    if (s.kills != null && s.kills < 0) push({ kind: "schema", severity: "warning", entity: "mapStat", ref: s.id, message: "kills negativos" });
    if (!pct(s.kast) || !pct(s.hsPct)) push({ kind: "schema", severity: "warning", entity: "mapStat", ref: s.id, message: tr("porcentaje fuera de [0,100]") });
    if (s.acs != null && s.acs < 0) push({ kind: "schema", severity: "warning", entity: "mapStat", ref: s.id, message: "acs negativo" });
  }
  for (const st of m.standings) if (st.wins < 0 || st.losses < 0) push({ kind: "schema", severity: "warning", entity: "standing", ref: st.id, message: tr("récord negativo") });
}

/** 2) IDENTITY — todo id resuelto, estable y con prefijo de tipo; nada "unknown". */
export function validateIdentity(m: CanonicalModel, push: Push): void {
  const check = (id: string, prefix: string, entity: string): void => {
    if (!id || !id.startsWith(`${prefix}:`) || id.endsWith(":unknown")) push({ kind: "identity", severity: "warning", entity, ref: id, message: tr("id no resuelto ({id})", { id }) });
  };
  for (const t of m.teams) check(t.id, "t", "team");
  for (const p of m.players) check(p.id, "p", "player");
  for (const c of m.coaches) check(c.id, "c", "coach");
}

/** 3) REFERENCE — integridad de claves foráneas en memoria (lo que antes solo hacía Supabase). */
export function validateReference(m: CanonicalModel, push: Push): void {
  const { teamById, playerById, matchById, mapById } = m.index;
  const team = (id: string | undefined, entity: string, ref?: string): void => { if (id && !teamById.has(id)) push({ kind: "reference", severity: "error", entity, ref, message: `teamId inexistente: ${id}` }); };
  const player = (id: string | undefined, entity: string, ref?: string): void => { if (id && !playerById.has(id)) push({ kind: "reference", severity: "error", entity, ref, message: `playerId inexistente: ${id}` }); };
  for (const mt of m.matches) { team(mt.teamAId, "match", mt.id); team(mt.teamBId, "match", mt.id); team(mt.winnerTeamId, "match", mt.id); player(mt.mvpPlayerId, "match", mt.id); }
  for (const mm of m.maps) { if (!matchById.has(mm.matchId)) push({ kind: "reference", severity: "error", entity: "map", ref: mm.id, message: `matchId inexistente: ${mm.matchId}` }); team(mm.winnerTeamId, "map", mm.id); }
  for (const s of m.mapStats) { if (!mapById.has(s.matchMapId)) push({ kind: "reference", severity: "error", entity: "mapStat", ref: s.id, message: `matchMapId inexistente: ${s.matchMapId}` }); if (!matchById.has(s.matchId)) push({ kind: "reference", severity: "error", entity: "mapStat", ref: s.id, message: `matchId inexistente: ${s.matchId}` }); player(s.playerId, "mapStat", s.id); team(s.teamId, "mapStat", s.id); }
  for (const r of m.rounds) if (!mapById.has(r.matchMapId)) push({ kind: "reference", severity: "error", entity: "round", ref: r.id, message: `matchMapId inexistente: ${r.matchMapId}` });
  for (const st of m.standings) team(st.teamId, "standing", st.id);
  for (const g of m.groups) for (const tid of g.teamIds) team(tid, "group", g.id);
  for (const b of m.brackets) for (const n of b.nodes) if (n.matchId && !matchById.has(n.matchId)) push({ kind: "reference", severity: "warning", entity: "bracketNode", ref: n.id, message: `matchId inexistente: ${n.matchId}` });
  for (const ros of m.rosters) { team(ros.teamId, "roster", ros.teamId); for (const pid of ros.playerIds) player(pid, "roster", ros.teamId); }
  if (m.awards) { team(m.awards.championTeamId, "awards", m.awards.tournamentId); team(m.awards.runnerUpTeamId, "awards", m.awards.tournamentId); player(m.awards.mvpPlayerId, "awards", m.awards.tournamentId); for (const pl of m.awards.placements) team(pl.teamId, "awards", m.awards.tournamentId); }
}

/** 4) DUPLICATE — ids únicos por colección (equipos/jugadores ya colapsados en el normalizer). */
export function validateDuplicate(m: CanonicalModel, push: Push): void {
  const dup = (ids: string[], entity: string): void => {
    const seen = new Set<string>();
    for (const id of ids) { if (seen.has(id)) push({ kind: "duplicate", severity: "error", entity, ref: id, message: `id duplicado: ${id}` }); seen.add(id); }
  };
  dup(m.teams.map((t) => t.id), "team");
  dup(m.players.map((p) => p.id), "player");
  dup(m.coaches.map((c) => c.id), "coach");
  dup(m.matches.map((mt) => mt.id), "match");
  dup(m.maps.map((mm) => mm.id), "map");
  dup(m.stages.map((s) => s.id), "stage");
  dup(m.rounds.map((r) => r.id), "round");
}

/** 5) CONSISTENCY — invariantes objetivos (marcador vs mapas, ganador dentro del enfrentamiento). */
export function validateConsistency(m: CanonicalModel, push: Push): void {
  if (m.tournament.status === "finished" && m.matches.length === 0) push({ kind: "consistency", severity: "warning", entity: "tournament", ref: m.tournament.id, message: tr("torneo finalizado sin partidos") });
  for (const mt of m.matches) {
    if (mt.winnerTeamId && mt.winnerTeamId !== mt.teamAId && mt.winnerTeamId !== mt.teamBId) push({ kind: "consistency", severity: "error", entity: "match", ref: mt.id, message: tr("ganador fuera del enfrentamiento") });
    const won = m.maps.filter((mm) => mm.matchId === mt.id && mm.winnerTeamId).length;
    if (mt.scoreA != null && mt.scoreB != null && won > 0 && mt.scoreA + mt.scoreB !== won) push({ kind: "consistency", severity: "warning", entity: "match", ref: mt.id, message: `marcador ${mt.scoreA}-${mt.scoreB} ≠ ${won} mapas jugados` });
  }
  for (const mm of m.maps) {
    const parent = m.index.matchById.get(mm.matchId);
    if (parent && mm.winnerTeamId && mm.winnerTeamId !== parent.teamAId && mm.winnerTeamId !== parent.teamBId) push({ kind: "consistency", severity: "error", entity: "map", ref: mm.id, message: tr("ganador de mapa fuera del enfrentamiento") });
  }
}

/** 6) VERSION — el modelo declara una versión de esquema soportada. */
export function validateVersion(m: CanonicalModel, push: Push): void {
  if (m.schemaVersion !== IMPORTER_SCHEMA_VERSION) push({ kind: "version", severity: "error", entity: "model", message: tr("versión de esquema no soportada: {schemaVersion} (esperado {IMPORTER_SCHEMA_VERSION})", { schemaVersion: m.schemaVersion, IMPORTER_SCHEMA_VERSION }) });
}

/** Ejecuta las 6 validaciones. Puro; devuelve todos los issues. */
export function validateModel(m: CanonicalModel): ImportIssue[] {
  const issues: ImportIssue[] = [];
  const push: Push = (i) => issues.push(i);
  validateSchema(m, push);
  validateIdentity(m, push);
  validateReference(m, push);
  validateDuplicate(m, push);
  validateConsistency(m, push);
  validateVersion(m, push);
  return issues;
}
