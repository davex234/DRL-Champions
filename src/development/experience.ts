/**
 * EXTRACCIÓN DE EXPERIENCIA — qué VIVIÓ cada jugador en el partido.
 *
 * No inventa señales: lee las que el Narrative Engine ya agrega por jugador
 * (`MatchState.narrative.players` = PlayerArc: clutches/aces/first-deaths/trades/form/
 * impact/estados) + la utilidad desplegada (eventos `util` por jugador) + MVP/victoria.
 * De aquí nace el desarrollo EMERGENTE. PURO: solo lee el MatchState terminado.
 */
import type { MatchState } from "@/match";
import type { PlayerArc } from "@/narrative";
import type { ExperienceSignals } from "./types";

/** name(nick) → playerId, desde la metadata del roster (cae al nick si no hay meta). */
function nameToId(match: MatchState): Record<string, string> {
  const map: Record<string, string> = {};
  for (const e of [...match.config.rosters.home, ...match.config.rosters.away]) {
    map[e.name] = e.meta?.playerId ?? e.name;
  }
  return map;
}

/** name → rol del roster (para sesgar el aprendizaje por rol). */
function nameToRole(match: MatchState): Record<string, string> {
  const map: Record<string, string> = {};
  for (const e of [...match.config.rosters.home, ...match.config.rosters.away]) map[e.name] = e.role;
  return map;
}

/** Utilidad desplegada por jugador (agrega eventos `util` mapeando id→name por ronda). */
function utilityByName(match: MatchState): Record<string, number> {
  const out: Record<string, number> = {};
  for (const round of match.rounds) {
    const idToName: Record<string, string> = {};
    for (const p of round.players) idToName[p.id] = p.name;
    for (const ev of round.events) {
      if (ev.type !== "util") continue;
      const by = (ev.data as { by?: string }).by;
      const name = by ? idToName[by] : undefined;
      if (name) out[name] = (out[name] ?? 0) + 1;
    }
  }
  return out;
}

/**
 * Señales de experiencia por jugador del partido. Devuelve una entrada por arco
 * narrativo (todos los jugadores de ambos equipos → la IA también evoluciona).
 */
export function extractExperience(match: MatchState): ExperienceSignals[] {
  const arcs: PlayerArc[] = match.narrative?.players ?? [];
  if (arcs.length === 0) return [];
  const ids = nameToId(match);
  const roles = nameToRole(match);
  const util = utilityByName(match);
  const rounds = match.rounds.length;
  const winnerTeam = match.winner; // "home" | "away" | null
  const mvpName = match.mvp?.name ?? null;

  return arcs.map((a): ExperienceSignals => {
    const isHome = a.team === "A"; // A = home, B = away (buildMatchNarrative)
    const won = winnerTeam != null && ((isHome && winnerTeam === "home") || (!isHome && winnerTeam === "away"));
    return {
      playerId: ids[a.name] ?? a.name,
      name: a.name,
      rounds,
      kills: a.kills,
      deaths: a.deaths,
      firstBloods: a.firstBloods,
      firstDeaths: a.firstDeaths,
      multikills: a.multikills,
      aces: a.aces,
      clutches: a.clutches,
      clutchWins: a.clutchWins,
      tradeKills: a.tradeKills,
      impactScore: a.impactScore,
      roundsDecisive: a.roundsDecisive,
      form: a.form,
      tiltPeak: a.tiltPeak,
      confidenceEnd: a.confidenceEnd,
      states: a.states,
      utilityCasts: util[a.name] ?? 0,
      won,
      mvp: mvpName === a.name,
      role: roles[a.name] ?? a.role ?? "lurk",
    };
  });
}
