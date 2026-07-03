/**
 * REDES SOCIALES — contenido, virales y tendencias (Career Fase 6/7).
 *
 * Los clubes generan contenido, los jugadores se vuelven virales (saltos de valor/rendimiento),
 * las jugadas son tendencia; fans y sponsors reaccionan modificando fanbase/popularidad. EMERGE
 * de los datos del mundo (valores, prevValue, eventos). PURO. Determinista.
 */
import type { WorldState } from "@/world";
import { progress } from "@/development";
import type { SocialTrend } from "./types";

/** Tendencias sociales de la temporada. Determinista (deriva de valores/eventos del mundo). */
export function socialTrends(world: WorldState, limit = 8): SocialTrend[] {
  const trends: SocialTrend[] = [];

  // Jugadores virales: mayores saltos de valor respecto a la temporada anterior.
  const risers = Object.values(world.players)
    .filter((p) => p.status === "active" && p.value > p.prevValue * 1.25 && p.value > 800)
    .sort((a, b) => (b.value / Math.max(1, b.prevValue)) - (a.value / Math.max(1, a.prevValue)))
    .slice(0, 3);
  for (const p of risers) trends.push({ id: `soc:viral:${p.id}:${world.season}`, kind: "viral_player", subject: p.nick, reach: Math.round(Math.min(100, 40 + (p.value / Math.max(1, p.prevValue) - 1) * 120)), sentiment: 80, fanDelta: 30, note: `${p.nick} se vuelve viral tras dispararse su valor` });

  // Jugadas tendencia: irrupciones/wonderkids del narrador.
  for (const e of world.events.filter((e) => e.type === "the_next_star" || e.type === "academy_wonderkid").slice(0, 3))
    trends.push({ id: `soc:play:${e.subject}:${e.season}`, kind: "trending_play", subject: e.subject, reach: e.magnitude, sentiment: 75, fanDelta: 15, note: `Una jugada de ${e.subject} es tendencia` });

  // Contenido de club: los clubes más populares generan engagement.
  const topClubs = Object.values(world.teams).sort((a, b) => b.fanbase - a.fanbase).slice(0, 2);
  for (const t of topClubs) trends.push({ id: `soc:club:${t.id}:${world.season}`, kind: "club_content", subject: t.name, reach: Math.min(100, Math.round(t.fanbase / 40)), sentiment: 60, fanDelta: 12, note: `El contenido de ${t.name} arrasa` });

  // Reacción de fans a un colapso (sentimiento negativo).
  for (const e of world.events.filter((e) => e.type === "great_collapse").slice(0, 1))
    trends.push({ id: `soc:react:${e.subject}:${e.season}`, kind: "fan_reaction", subject: e.subject, reach: e.magnitude, sentiment: 20, fanDelta: -20, note: `Los fans de ${e.subject} estallan en redes` });

  return trends.sort((a, b) => b.reach - a.reach).slice(0, limit);
}

/** Aplica el impacto social a la fanbase de los clubes implicados. Muta el mundo. */
export function applySocial(world: WorldState, trends: SocialTrend[], protectTeamId: string | null): void {
  for (const tr of trends) {
    // Localiza el club: por jugador (teamId) o por nombre de club.
    let clubId: string | null = null;
    const player = Object.values(world.players).find((p) => p.nick === tr.subject);
    if (player?.teamId) clubId = player.teamId;
    else { const team = Object.values(world.teams).find((t) => t.name === tr.subject); clubId = team?.id ?? null; }
    if (!clubId || clubId === protectTeamId) continue;
    const team = world.teams[clubId];
    if (team) team.fanbase = Math.max(0, Math.round(team.fanbase + tr.fanDelta));
  }
}

/** Popularidad social de un jugador (para el dashboard). */
export function playerHype(world: WorldState, playerId: string): number {
  const p = world.players[playerId];
  if (!p) return 0;
  return Math.min(100, Math.round(progress(p.dev) * 0.5 + (p.value / Math.max(1, p.prevValue) - 1) * 60 + p.mvps * 5));
}
