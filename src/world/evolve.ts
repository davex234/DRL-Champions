/**
 * EVOLUCIÓN DE TEMPORADA — todos los jugadores del mundo progresan/envejecen.
 *
 * Reutiliza el Player Development Engine (`advanceSeasonFor`: edad + curva + recuperación)
 * y modula la condición por el RENDIMIENTO de la temporada. Aplica standings/títulos a los
 * equipos y registra a campeones/MVP en el Timeline de `src/live` (carrera real). PURO.
 */
import type { WorldState } from "./types";
import type { SeasonResult } from "./season";
import { advanceSeasonFor, progress } from "@/development";
import { ensurePlayer, recordCard } from "@/live/timeline";
import { recomputeValues } from "./market";

const clamp100 = (n: number) => Math.max(0, Math.min(100, n));

export function evolveSeason(world: WorldState, result: SeasonResult): void {
  const season = world.season;

  // Standings → equipos.
  for (const s of result.standings) {
    const t = world.teams[s.teamId];
    if (!t) continue;
    t.standings.push({ season, pos: s.pos, wins: s.wins, losses: s.losses, champion: s.teamId === result.championId });
    if (t.standings.length > 24) t.standings = t.standings.slice(-24);
  }

  // Campeón: título + prestigio + fanbase + título del entrenador.
  const champ = world.teams[result.championId];
  if (champ) {
    champ.titles++;
    champ.prestige = clamp100(champ.prestige + 5);
    champ.fanbase = Math.round(champ.fanbase * 1.08 + 50);
    if (champ.coachId && world.coaches[champ.coachId]) world.coaches[champ.coachId].titles++;
    world.history.champions.push({ season, teamId: champ.id, teamName: champ.name });
  }

  // Jugadores: desarrollo (edad/curva) + condición por rendimiento + palmarés.
  for (const p of Object.values(world.players)) {
    if (p.status !== "active") continue;
    p.dev = advanceSeasonFor(p.dev, p.innate, season).state;
    if (world.coaches[p.id]) world.coaches[p.id].seasons++;
    const perf = result.perf[p.id] ?? 40;
    const c = p.dev.condition;
    c.form = clamp100(c.form + (perf - 50) * 0.3);
    c.confidence = clamp100(c.confidence + (perf - 55) * 0.15);
    c.motivation = clamp100(c.motivation + (perf > 60 ? 3 : -3));
    if (p.teamId === result.championId) p.titles++;
    if (p.id === result.mvpId) { p.mvps++; c.confidence = clamp100(c.confidence + 6); }
  }

  // Timeline (src/live): carrera real de campeones + MVP (anti-duplicado por temporada).
  for (const id of champ?.roster ?? []) {
    const p = world.players[id];
    if (!p || p.status !== "active") continue;
    ensurePlayer(world.timeline, { id: p.id, nick: p.nick }, season, result.championId);
    recordCard(world.timeline, p.id, { season, tournamentId: `champ-${season}`, family: "champion", rating: Math.round(progress(p.dev)), createdAt: season });
  }
  const mvp = world.players[result.mvpId];
  if (mvp) recordCard(world.timeline, mvp.id, { season, tournamentId: `champ-${season}`, family: "mvp", rating: Math.round(progress(mvp.dev)), createdAt: season });

  recomputeValues(world);
}
