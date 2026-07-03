/**
 * MANAGER CAREER ENGINE · Fase 2 — PUENTE con el Living World.
 *
 * La carrera NO duplica el mundo: lo CONSUME. Aquí se traduce el `WorldState` (clubes,
 * standings, entrenadores) a las vistas desacopladas que usa el motor puro (`ClubView`,
 * `CoachLike`, `SeasonOutcome`). Import SOLO de tipos de `@/world` (sin ciclo: el mundo no
 * importa la carrera). Determinista.
 */
import type { WorldState } from "@/world";
import type { ClubView, SeasonOutcome } from "./types";
import type { CoachLike } from "./market";
import { derivePhilosophy } from "./club";
import { makeRng, seedOf } from "./rng";

/** Traduce un equipo del mundo a una `ClubView` (con filosofía determinista). */
function toClubView(world: WorldState, teamId: string): ClubView | null {
  const t = world.teams[teamId];
  if (!t) return null;
  const total = Object.keys(world.teams).length;
  const last = t.standings[t.standings.length - 1];
  const rng = makeRng(seedOf(world.seed, "philo", t.id));
  return {
    id: t.id,
    name: t.name,
    tag: t.tag,
    region: t.region,
    prestige: Math.round(t.prestige),
    budget: t.budget,
    fanbase: t.fanbase,
    titles: t.titles,
    position: last?.pos ?? total,
    totalTeams: total,
    hasCoach: !!t.coachId,
    coachRating: t.coachId ? world.coaches[t.coachId]?.rating ?? 0 : 0,
    philosophy: derivePhilosophy(t.prestige, t.budget, rng),
  };
}

/** Todas las `ClubView` del mundo. */
export function clubViewsFromWorld(world: WorldState): ClubView[] {
  return Object.keys(world.teams)
    .map((id) => toClubView(world, id))
    .filter((c): c is ClubView => c !== null);
}

/** `ClubView` de un club concreto. */
export function clubViewFor(world: WorldState, teamId: string): ClubView | null {
  return toClubView(world, teamId);
}

/** Entrenadores del mundo como `CoachLike` (para el mercado). */
export function coachesFromWorld(world: WorldState): CoachLike[] {
  return Object.values(world.coaches).map((c) => ({
    id: c.id, name: c.name, rating: c.rating, titles: c.titles, seasons: c.seasons, teamId: c.teamId,
  }));
}

/** Deriva el resultado de la temporada del club del usuario a partir de sus standings. */
export function seasonOutcomeFromWorld(world: WorldState, teamId: string): SeasonOutcome | null {
  const t = world.teams[teamId];
  if (!t) return null;
  const total = Object.keys(world.teams).length;
  const last = t.standings[t.standings.length - 1];
  if (!last) return null;
  const champion = !!last.champion;
  const finalist = last.pos <= 2;
  return {
    team: t.name,
    competition: "Liga DRL",
    tier: champion ? "continental" : "regional",
    wins: last.wins,
    losses: last.losses,
    champion,
    finalist,
    mvpAwarded: false,
    placement: last.pos,
    fieldSize: total,
  };
}
