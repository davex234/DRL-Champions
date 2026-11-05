/**
 * SERIES ENGINE — BO1/BO3/BO5/BO7 + selección/veto de mapas (Online Fase 6/7).
 *
 * Resuelve una serie jugando mapas con el ÚNICO Gameplay (via `PlayFn`) hasta que un equipo
 * alcanza el objetivo. Veto de mapas (ban/pick) DETERMINISTA. PURO salvo `play`. DETERMINISTA.
 */
import { makeRng, seedFrom, type Rng } from "@/sim/rng";
import type { Team, Fixture, SeriesFormat, SeriesState, MapVeto, PlayFn } from "./types";

export const MAP_POOL = ["Ascent", "Bind", "Haven", "Split", "Icebox", "Breeze", "Lotus"];
const SERIES: Record<SeriesFormat, { maps: number; target: number }> = { bo1: { maps: 1, target: 1 }, bo3: { maps: 3, target: 2 }, bo5: { maps: 5, target: 3 }, bo7: { maps: 7, target: 4 } };

export function seriesInfo(format: SeriesFormat): { maps: number; target: number } { return SERIES[format]; }
export function newSeries(format: SeriesFormat): SeriesState { const s = SERIES[format]; return { format, target: s.target, scoreA: 0, scoreB: 0, maps: [], veto: null }; }

/** Veto de mapas determinista: bans alternos hasta dejar `maps`, luego picks alternos. */
export function buildVeto(format: SeriesFormat, tSeed: number, fixtureId: string): MapVeto {
  const rng: Rng = makeRng(seedFrom(`veto:${tSeed}:${fixtureId}`));
  const need = SERIES[format].maps;
  const avail = [...MAP_POOL];
  const bans: MapVeto["bans"] = [];
  let turn: "A" | "B" = "A";
  while (avail.length > need) { const m = avail.splice(rng.int(0, avail.length - 1), 1)[0]; bans.push({ team: turn, map: m }); turn = turn === "A" ? "B" : "A"; }
  const picks: MapVeto["picks"] = avail.map((map, i) => ({ team: (i % 2 === 0 ? "A" : "B") as "A" | "B", map }));
  const decider = need % 2 === 1 ? avail[avail.length - 1] : null;
  return { pool: [...MAP_POOL], bans, picks, decider };
}

/** Juega la serie hasta el objetivo. Muta `fixture.series`. Devuelve el ganador (team id). */
export function resolveSeries(fixture: Fixture, teamA: Team, teamB: Team, play: PlayFn, tSeed: number): { winner: string; loser: string } {
  const s = fixture.series;
  if (!s.veto) s.veto = buildVeto(s.format, tSeed, fixture.id);
  const maps = SERIES[s.format].maps;
  const order = s.veto.picks.map((p) => p.map);
  for (let i = 0; i < maps; i++) {
    if (s.scoreA >= s.target || s.scoreB >= s.target) break;
    const map = order[i] ?? MAP_POOL[i % MAP_POOL.length];
    const mapSeed = seedFrom(`${tSeed}:${fixture.id}:m${i}`) >>> 0;
    const out = play({ fixture, teamA, teamB, mapIndex: i, mapSeed, map });
    s.maps.push({ index: i, map, seed: mapSeed, winner: out.winner, scoreHome: out.scoreHome, scoreAway: out.scoreAway, matchId: out.matchId });
    if (out.winner === "A") s.scoreA++; else s.scoreB++;
  }
  return s.scoreA > s.scoreB ? { winner: teamA.id, loser: teamB.id } : { winner: teamB.id, loser: teamA.id };
}
