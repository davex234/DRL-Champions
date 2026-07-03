/**
 * DESARROLLO × BROADCAST — DATOS de progresión para retransmisión (no UI definitiva).
 *
 * Produce curvas/estado de desarrollo de un jugador y un resumen de eventos de evolución,
 * con el mismo patrón que `coachLiveBroadcast`/`coachEventsBroadcast`. PURO.
 */
import type { DevState, InnateProfile, DevelopmentEvent, SkillId } from "./types";
import { SKILL_IDS } from "./types";
import { ageBand } from "./innate";
import { progress } from "./evolve";

export interface DevelopmentInfo {
  playerId: string;
  name?: string;
  age: number;
  ageBand: "joven" | "prime" | "veterano" | "declive";
  rating: number;
  peak: number;
  potential: number;
  ceilingReached: number;
  /** Tendencia: rating actual − pico (negativo = declive). */
  trend: number;
  form: number;
  fatigue: number;
  burnout: number;
  motivation: number;
  matchesPlayed: number;
  seasonsPlayed: number;
  topSkills: { id: SkillId; value: number }[];
}

export function developmentBroadcast(state: DevState, innate: InnateProfile, name?: string): DevelopmentInfo {
  const rating = progress(state);
  const topSkills = SKILL_IDS.map((id) => ({ id, value: Math.round(state.skill[id]) }))
    .sort((a, b) => b.value - a.value).slice(0, 3);
  return {
    playerId: state.playerId, name,
    age: state.age, ageBand: ageBand(state.age, innate),
    rating: Math.round(rating), peak: Math.round(state.peak), potential: innate.potential,
    ceilingReached: Math.round(Math.min(100, (rating / Math.max(1, innate.potential)) * 100)),
    trend: Math.round((rating - state.peak) * 10) / 10,
    form: Math.round(state.condition.form), fatigue: Math.round(state.condition.fatigue),
    burnout: Math.round(state.condition.burnout), motivation: Math.round(state.condition.motivation),
    matchesPlayed: state.matchesPlayed, seasonsPlayed: state.seasonsPlayed,
    topSkills,
  };
}

export interface DevelopmentEventSummary { type: string; name?: string; season: number; magnitude: number; detail?: string }
export function developmentEventsBroadcast(events: DevelopmentEvent[]): DevelopmentEventSummary[] {
  return [...events].sort((a, b) => b.magnitude - a.magnitude).slice(0, 8)
    .map((e) => ({ type: e.type, name: e.name, season: e.season, magnitude: e.magnitude, detail: e.detail }));
}
