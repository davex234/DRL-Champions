/**
 * RANKINGS — top jugadores/equipos/coaches/promesas/veteranos/rookies/regiones.
 * Se recalculan cada temporada a partir del estado vivo del mundo. PURO.
 */
import type { WorldState, RankRow } from "./types";
import { progress, ageBand } from "@/development";

const top = <T>(xs: T[], n: number, score: (x: T) => number): T[] =>
  [...xs].sort((a, b) => score(b) - score(a)).slice(0, n);

export function recomputeRankings(world: WorldState): void {
  const active = Object.values(world.players).filter((p) => p.status === "active");
  const teamName = (id: string | null) => (id ? world.teams[id]?.name ?? "—" : "libre");

  world.rankings.players = top(active, 10, (p) => p.value).map((p) => ({ id: p.id, name: p.nick, value: p.value, detail: teamName(p.teamId) }));

  world.rankings.teams = top(Object.values(world.teams), 10, (t) => t.prestige + t.titles * 6).map((t) => ({
    id: t.id, name: t.name, value: Math.round(t.prestige + t.titles * 6), detail: `${t.titles} títulos · ${t.fanbase}k fans`,
  }));

  world.rankings.coaches = top(Object.values(world.coaches).filter((c) => c.teamId), 10, (c) => c.titles * 12 + c.rating).map((c) => ({
    id: c.id, name: c.name, value: c.titles * 12 + c.rating, detail: `${c.titles} títulos`,
  }));

  // Promesas: jóvenes con techo lejos del nivel actual.
  world.rankings.promises = top(active.filter((p) => ageBand(p.dev.age, p.innate) === "joven"), 10,
    (p) => p.innate.potential + (p.innate.potential - progress(p.dev))).map((p) => ({
      id: p.id, name: p.nick, value: p.innate.potential, detail: `${p.dev.age}a · pot ${p.innate.potential}`,
    }));

  world.rankings.veterans = top(active.filter((p) => { const b = ageBand(p.dev.age, p.innate); return b === "veterano" || b === "declive"; }), 10,
    (p) => p.value).map((p) => ({ id: p.id, name: p.nick, value: p.value, detail: `${p.dev.age}a · ${p.titles} títulos` }));

  world.rankings.rookies = top(active.filter((p) => p.origin === "academy" && p.dev.seasonsPlayed <= 1), 10,
    (p) => p.innate.potential).map((p) => ({ id: p.id, name: p.nick, value: p.innate.potential, detail: `${p.region}` }));

  // Regiones: fuerza agregada de sus equipos.
  const regionScore: Record<string, number> = {};
  for (const t of Object.values(world.teams)) regionScore[t.region] = (regionScore[t.region] ?? 0) + t.prestige + t.titles * 6;
  world.rankings.regions = top(Object.entries(regionScore), 10, ([, v]) => v).map(([region, v]) => ({ id: region, name: region, value: Math.round(v) }));
}
