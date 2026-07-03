/**
 * MANAGER CAREER ENGINE — driver de progresión.
 *
 * Compone TODOS los subsistemas (xp/nivel, reputación, atributos, objetivos, licencias,
 * historial, narrativa, noticias) en dos transiciones puras: por PARTIDO y por TEMPORADA.
 * Mismas entradas ⇒ misma salida (determinista). No muta el `career` recibido.
 */
import type {
  ManagerCareer,
  CareerStep,
  MatchOutcome,
  SeasonOutcome,
  CoachAttributes,
  CoachAttributeKey,
  CoachCareerEvent,
} from "./types";
import { levelFromXp, xpForMatch, xpForSeason } from "./experience";
import { reputationAfterMatch, reputationAfterSeason, globalReputationScore } from "./reputation";
import { licenseFor } from "./licenses";
import { recordSeason, joinTeam } from "./history";
import { evaluateObjectives } from "./objectives";
import { detectCareerEvents } from "./narrative";
import { careerNews } from "./news";
import { makeRng, seedOf } from "./rng";

/**
 * Crecimiento con rendimientos decrecientes: cuanto más alto el atributo, menos sube.
 * Mantiene PRECISIÓN FRACCIONAL (no redondea): así las ganancias pequeñas por partido se
 * acumulan a lo largo de la carrera. La UI redondea solo al mostrar (vía `attrOverall`).
 */
function grow(attrs: CoachAttributes, deltas: Partial<Record<CoachAttributeKey, number>>): CoachAttributes {
  const next = { ...attrs };
  for (const k in deltas) {
    const key = k as CoachAttributeKey;
    const amount = deltas[key]!;
    const headroom = (100 - next[key]) / 100; // 0 cerca del techo
    next[key] = Math.max(0, Math.min(100, next[key] + amount * headroom));
  }
  return next;
}

/** Recalcula nivel + licencia (monótona) tras cambiar xp/stats/reputación. */
function recomputeDerived(career: ManagerCareer): ManagerCareer {
  const level = levelFromXp(career.xp);
  const withLevel = { ...career, level };
  return { ...withLevel, license: licenseFor(withLevel) };
}

/** Convierte ids de objetivos cumplidos en eventos narrativos. */
function objectiveEvents(career: ManagerCareer, achievedIds: string[], at: number): CoachCareerEvent[] {
  return achievedIds.map((id) => {
    const o = career.objectives.find((x) => x.id === id);
    return {
      type: "objective_achieved" as const,
      season: career.season,
      magnitude: 40,
      detail: `Objetivo cumplido: ${o?.text ?? id}.`,
      at,
    };
  });
}

/** Transición por PARTIDO. */
export function applyMatchResult(prev: ManagerCareer, o: MatchOutcome, at: number): CareerStep {
  const stats = { ...prev.stats };
  stats.matchesPlayed += 1;
  if (o.won) {
    stats.wins += 1;
    stats.currentWinStreak += 1;
    stats.bestWinStreak = Math.max(stats.bestWinStreak, stats.currentWinStreak);
  } else {
    stats.losses += 1;
    stats.currentWinStreak = 0;
  }
  if (o.mvp) stats.mvps += 1;

  const attributes = grow(prev.attributes, o.won
    ? { motivation: 0.6, leadership: 0.4, pressureManagement: 0.5, communication: 0.3 }
    : { mentalCoaching: 0.5, adaptability: 0.4, analytics: 0.3 });

  let next: ManagerCareer = {
    ...prev,
    stats,
    attributes,
    xp: prev.xp + xpForMatch(o),
    reputation: reputationAfterMatch(prev.reputation, o),
  };
  next = recomputeDerived(next);

  const rng = makeRng(seedOf(prev.seed, "obj-match", stats.matchesPlayed));
  const { objectives, achievedIds } = evaluateObjectives(next, rng);
  next = { ...next, objectives };

  const events = [...detectCareerEvents(prev, next, at), ...objectiveEvents(next, achievedIds, at)];
  next = { ...next, events: [...next.events, ...events].slice(-400) };
  return { career: next, events, news: careerNews(events) };
}

/** Transición por TEMPORADA/competición (avanza a la siguiente temporada). */
export function applySeasonResult(prev: ManagerCareer, o: SeasonOutcome, at: number): CareerStep {
  const stats = { ...prev.stats };
  stats.seasonsCoached += 1;
  stats.wins += o.wins;
  stats.losses += o.losses;
  if (o.champion) stats.titles += 1;
  if (o.finalist || o.champion) stats.finals += 1;
  if (!o.champion && !o.finalist) stats.defeats += 1;
  if (o.mvpAwarded) stats.mvps += 1;

  const perfect = o.champion && o.losses === 0 && o.wins > 0;
  const perfectSeasons = prev.perfectSeasons + (perfect ? 1 : 0);

  // Cambio de equipo → abre un nuevo spell y cuenta equipos dirigidos.
  let currentTeam = prev.currentTeam;
  let teamsCoached = stats.teamsCoached;
  let history = prev.history;
  if (o.team && o.team !== prev.currentTeam) {
    history = joinTeam(history, o.team, prev.season);
    currentTeam = o.team;
    teamsCoached += 1;
  }
  stats.teamsCoached = teamsCoached;

  const reputation = reputationAfterSeason(prev.reputation, o);
  history = recordSeason(history, o, prev.season, globalReputationScore(reputation));

  const attributes = grow(prev.attributes, o.champion
    ? { tacticalVision: 1.2, teamManagement: 1, talentDevelopment: 0.8, mediaHandling: 0.8, leadership: 0.8 }
    : { adaptability: 0.8, analytics: 0.7, mentalCoaching: 0.6, scouting: 0.5 });

  let next: ManagerCareer = {
    ...prev,
    stats,
    attributes,
    reputation,
    history,
    currentTeam,
    perfectSeasons,
    xp: prev.xp + xpForSeason(o),
    season: prev.season + 1,
  };
  next = recomputeDerived(next);

  const rng = makeRng(seedOf(prev.seed, "obj-season", next.season));
  const { objectives, achievedIds } = evaluateObjectives(next, rng);
  next = { ...next, objectives };

  const events = [...detectCareerEvents(prev, next, at), ...objectiveEvents(next, achievedIds, at)];
  next = { ...next, events: [...next.events, ...events].slice(-400) };
  return { career: next, events, news: careerNews(events) };
}
