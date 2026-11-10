/**
 * MAP METRICS + ECONOMÍA (Fase 3) — métricas por GameMap del pool y economía objetiva por equipo.
 * La economía se deriva de `model.rounds` (tipo pistol/eco/force/buy + ganador): esto RELLENA el
 * hueco documentado en F2 (`TeamReport.economy: undefined`) SIN tocar el Team Analyzer.
 * Interpretación del dato del importer: `Round.side` = lado que GANÓ la ronda.
 * Puro, determinista, O(n). Sin dato suficiente → campo undefined (nunca se inventa).
 */
import type { CanonicalModel, RoundType } from "@/importer";
import { groupBy } from "./aggregate";
import type { MapMetrics, TeamEconomy } from "./types";

const pct1 = (wins: number, total: number): number => Math.round((wins / total) * 1000) / 10;

export function computeMapMetrics(model: CanonicalModel): MapMetrics[] {
  const withMap = model.maps.filter((mm) => typeof mm.mapId === "string");
  const byMap = groupBy(withMap, (mm) => mm.mapId!);

  // Rondas con lado ganador, agrupadas por GameMap (round → matchMap → mapId).
  const sideTally = new Map<string, { atk: number; def: number }>();
  for (const rd of model.rounds) {
    if (!rd.side || !rd.winnerTeamId) continue;
    const mapId = model.index.mapById.get(rd.matchMapId)?.mapId;
    if (!mapId) continue;
    let t = sideTally.get(mapId);
    if (!t) { t = { atk: 0, def: 0 }; sideTally.set(mapId, t); }
    if (rd.side === "attack") t.atk++; else t.def++;
  }

  const out: MapMetrics[] = [];
  for (const [mapId, played] of byMap) {
    // Rondas medias por mapa (desde scores presentes).
    const withScores = played.filter((mm) => typeof mm.scoreA === "number" && typeof mm.scoreB === "number");
    const avgRoundsPerMap = withScores.length
      ? Math.round((withScores.reduce((a, mm) => a + mm.scoreA! + mm.scoreB!, 0) / withScores.length) * 10) / 10
      : undefined;

    // Equipo dominante: más mapas ganados (empate → undefined).
    const winCounts = new Map<string, number>();
    for (const mm of played) if (mm.winnerTeamId) winCounts.set(mm.winnerTeamId, (winCounts.get(mm.winnerTeamId) ?? 0) + 1);
    let dominantTeamId: string | undefined, bestWins = 0, tied = false;
    for (const [teamId, w] of [...winCounts.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      if (w > bestWins) { bestWins = w; dominantTeamId = teamId; tied = false; }
      else if (w === bestWins) tied = true;
    }
    if (tied) dominantTeamId = undefined;

    const sides = sideTally.get(mapId);
    const total = sides ? sides.atk + sides.def : 0;
    out.push({
      mapId, played: played.length,
      attackWinPct: total ? pct1(sides!.atk, total) : undefined,
      defenseWinPct: total ? pct1(sides!.def, total) : undefined,
      avgRoundsPerMap, dominantTeamId,
    });
  }
  return out.sort((a, b) => b.played - a.played || a.mapId.localeCompare(b.mapId));
}

const ECON_TYPES: readonly RoundType[] = ["pistol", "eco", "force", "buy"];

/** Economía por equipo: % de victoria en rondas pistol/eco/force/buy (ganador + perdedor cuentan). */
export function computeTeamEconomy(model: CanonicalModel): TeamEconomy[] {
  type Tally = Record<string, { w: number; n: number }>;
  const perTeam = new Map<string, Tally>();
  const bump = (teamId: string, type: string, won: boolean): void => {
    let t = perTeam.get(teamId);
    if (!t) { t = {}; perTeam.set(teamId, t); }
    const cell = (t[type] ??= { w: 0, n: 0 });
    cell.n++; if (won) cell.w++;
  };

  for (const rd of model.rounds) {
    if (!rd.type || !rd.winnerTeamId || !ECON_TYPES.includes(rd.type)) continue;
    const mm = model.index.mapById.get(rd.matchMapId);
    const match = mm ? model.index.matchById.get(mm.matchId) : undefined;
    const A = match?.teamAId, B = match?.teamBId;
    if (!A || !B) continue;
    if (rd.winnerTeamId !== A && rd.winnerTeamId !== B) continue; // referencia inconsistente → se ignora
    bump(A, rd.type, rd.winnerTeamId === A);
    bump(B, rd.type, rd.winnerTeamId === B);
  }

  const out: TeamEconomy[] = [];
  for (const [teamId, t] of perTeam) {
    const pctOf = (type: string): number | undefined => (t[type]?.n ? pct1(t[type].w, t[type].n) : undefined);
    out.push({
      teamId,
      pistolWinPct: pctOf("pistol"), ecoWinPct: pctOf("eco"),
      forceWinPct: pctOf("force"), buyWinPct: pctOf("buy"),
      roundsSampled: ECON_TYPES.reduce((a, ty) => a + (t[ty]?.n ?? 0), 0),
    });
  }
  return out.sort((a, b) => a.teamId.localeCompare(b.teamId));
}
