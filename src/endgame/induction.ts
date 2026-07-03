/**
 * HALL OF FAME — inducción del entrenador (Career Fase 7/7).
 *
 * REUTILIZA `hallOfFame` del Legacy Engine (los 9 halls del mundo) y añade la inducción del
 * propio entrenador (tier + cita narrada + ranking histórico). PURO. Determinista.
 */
import type { ManagerCareer } from "@/career";
import type { WorldState } from "@/world";
import { hallOfFame } from "@/legacy";
import type { HofInduction, EndgameStats } from "./types";

export function hallOfFameInduction(career: ManagerCareer, world: WorldState, stats: EndgameStats): HofInduction {
  const halls = hallOfFame(world);
  const inducted = stats.titles >= 1 || stats.reputationScore >= 40;
  const tier = stats.reputationScore >= 85 || stats.titles >= 8 ? "Leyenda mundial"
    : stats.titles >= 4 ? "Leyenda"
    : stats.titles >= 1 ? "Maestro del banquillo"
    : "Entrenador consagrado";
  const coachRank = Object.values(world.coaches).filter((c) => c.titles > stats.titles).length + 1;
  const citation = inducted
    ? `${career.coach.name} es inducido al Hall of Fame como ${tier}: ${stats.titles} títulos, ${stats.seasonsCoached} temporadas y reputación ${stats.reputationScore}. Su legado perdurará.`
    : `${career.coach.name} cierra una carrera digna, a las puertas del Hall of Fame.`;
  return { inducted, tier, citation, halls, coachRank };
}
