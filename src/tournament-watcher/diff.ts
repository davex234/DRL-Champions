/**
 * DIFF — comparación de dos snapshots del MISMO torneo: detecta (jamás interpreta) cada
 * cambio del contrato: metadatos del evento (nombre/estado/premio/fechas/sede), equipos
 * (altas/bajas/clasificado/eliminado/roster), partidos (nuevos/actualizados/resultados/
 * bracket), mapas nuevos y estadísticas modificadas. Determinista y de orden estable.
 */
import type { RawSnapshot } from "@/importer";
import { normalizeSnapshot } from "./snapshot";
import type { WatchEventKind } from "./types";

export interface DetectedChange {
  kind: WatchEventKind;
  subject?: string;
  detail?: string;
}

const keyOf = (teamsOf: Map<string, Set<string>>, team: string): Set<string> =>
  teamsOf.get(team) ?? teamsOf.set(team, new Set()).get(team)!;

/** Cambios entre dos snapshots del mismo torneo (prev normalizado internamente). */
export function diffSnapshots(prevRaw: RawSnapshot, nextRaw: RawSnapshot): DetectedChange[] {
  const prev = normalizeSnapshot(prevRaw);
  const next = normalizeSnapshot(nextRaw);
  const out: DetectedChange[] = [];
  const add = (kind: WatchEventKind, subject?: string, detail?: string): void => { out.push({ kind, subject, detail }); };

  /* Metadatos del evento. */
  if (prev.tournament.name !== next.tournament.name) add("name-changed", next.tournament.id, `${prev.tournament.name} → ${next.tournament.name}`);
  if (prev.tournament.status !== next.tournament.status) {
    add("status-changed", next.tournament.id, `${prev.tournament.status} → ${next.tournament.status}`);
    if (next.tournament.status === "finished") add("tournament-finished", next.tournament.id);
  }
  if ((prev.tournament.prizePool ?? null) !== (next.tournament.prizePool ?? null)) add("prize-changed", next.tournament.id, `${prev.tournament.prizePool ?? "—"} → ${next.tournament.prizePool ?? "—"}`);
  if ((prev.tournament.startDate ?? "") !== (next.tournament.startDate ?? "") || (prev.tournament.endDate ?? "") !== (next.tournament.endDate ?? "")) {
    add("dates-changed", next.tournament.id, `${prev.tournament.startDate ?? "?"}..${prev.tournament.endDate ?? "?"} → ${next.tournament.startDate ?? "?"}..${next.tournament.endDate ?? "?"}`);
  }
  if ((prev.tournament.location ?? "") !== (next.tournament.location ?? "")) add("venue-changed", next.tournament.id, `${prev.tournament.location ?? "—"} → ${next.tournament.location ?? "—"}`);

  /* Equipos. */
  const prevTeams = new Set(prev.teams.map((t) => t.name));
  const nextTeams = new Set(next.teams.map((t) => t.name));
  for (const t of next.teams) if (!prevTeams.has(t.name)) add("team-added", t.name);
  for (const t of prev.teams) if (!nextTeams.has(t.name)) add("team-removed", t.name);

  /* Clasificación (qualified/eliminated: transición de estado, no interpretación). */
  const prevStanding = new Map((prev.standings ?? []).map((s) => [s.team, s.status ?? ""]));
  for (const s of next.standings ?? []) {
    const was = prevStanding.get(s.team) ?? "";
    const now = s.status ?? "";
    if (was !== now && now === "qualified") add("team-qualified", s.team);
    if (was !== now && now === "eliminated") add("team-eliminated", s.team);
  }

  /* Rosters (jugadores por equipo). */
  const rosterOf = (s: RawSnapshot): Map<string, Set<string>> => {
    const m = new Map<string, Set<string>>();
    for (const p of s.players) if (p.team) keyOf(m, p.team).add(p.nick);
    return m;
  };
  const prevRoster = rosterOf(prev);
  const nextRoster = rosterOf(next);
  for (const team of new Set([...prevRoster.keys(), ...nextRoster.keys()])) {
    const a = [...(prevRoster.get(team) ?? [])].sort().join(",");
    const b = [...(nextRoster.get(team) ?? [])].sort().join(",");
    if (a !== b && prevTeams.has(team) && nextTeams.has(team)) add("roster-changed", team, `${a || "—"} → ${b || "—"}`);
  }

  /* Partidos. */
  const prevMatch = new Map(prev.matches.map((m) => [m.id, m]));
  for (const m of next.matches) {
    const p = prevMatch.get(m.id);
    if (!p) { add("match-added", m.id, `${m.teamA} vs ${m.teamB}`); continue; }
    const resultChanged = (p.scoreA ?? null) !== (m.scoreA ?? null) || (p.scoreB ?? null) !== (m.scoreB ?? null) || (p.winner ?? "") !== (m.winner ?? "");
    if (resultChanged) add("result-changed", m.id, `${p.scoreA ?? "?"}-${p.scoreB ?? "?"} → ${m.scoreA ?? "?"}-${m.scoreB ?? "?"}`);
    else if (p.status !== m.status || (p.format ?? "") !== (m.format ?? "")) add("match-updated", m.id, `${p.status} → ${m.status}`);
    const bracketMoved = p.stageId !== m.stageId || (p.round ?? "") !== (m.round ?? "") || (p.matchOrder ?? null) !== (m.matchOrder ?? null) || p.teamA !== m.teamA || p.teamB !== m.teamB;
    if (bracketMoved) add("bracket-changed", m.id, `${p.round ?? p.stageId} → ${m.round ?? m.stageId}`);
  }
  const nextMatchIds = new Set(next.matches.map((m) => m.id));
  for (const m of prev.matches) if (!nextMatchIds.has(m.id)) add("bracket-changed", m.id, "partido retirado del cuadro");

  /* Mapas nuevos. */
  const prevMaps = new Set((prev.maps ?? []).map((m) => m.id));
  for (const m of next.maps ?? []) if (!prevMaps.has(m.id)) add("map-added", m.id, `${m.map} (${m.matchId})`);

  /* Estadísticas por jugador (agregado por jugador para no inundar). */
  const statKey = (s: NonNullable<RawSnapshot["mapStats"]>[number]): string =>
    `${s.matchMapId}|${s.player}|${s.acs ?? ""}|${s.kills ?? ""}|${s.deaths ?? ""}|${s.assists ?? ""}`;
  const prevStats = new Set((prev.mapStats ?? []).map(statKey));
  const changedPlayers = new Set<string>();
  for (const s of next.mapStats ?? []) if (!prevStats.has(statKey(s))) changedPlayers.add(s.player);
  for (const p of [...changedPlayers].sort()) add("statistics-changed", p);

  return out;
}
