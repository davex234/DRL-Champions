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
import { ns, td } from "@/i18n/runtime";

const t = ns("endgame");

export function hallOfFameInduction(career: ManagerCareer, world: WorldState, stats: EndgameStats): HofInduction {
  const halls = hallOfFame(world);
  const inducted = stats.titles >= 1 || stats.reputationScore >= 40;
  const tier = stats.reputationScore >= 85 || stats.titles >= 8 ? "Leyenda mundial"
    : stats.titles >= 4 ? "Leyenda"
    : stats.titles >= 1 ? t("Maestro del banquillo")
    : t("Entrenador consagrado");
  const coachRank = Object.values(world.coaches).filter((c) => c.titles > stats.titles).length + 1;
  const citation = inducted
    ? t("{name} es inducido al Hall of Fame como {tier}: {titles} títulos, {seasonsCoached} temporadas y reputación {reputationScore}. Su legado perdurará.", { name: career.coach.name, tier: td(tier), titles: stats.titles, seasonsCoached: stats.seasonsCoached, reputationScore: stats.reputationScore })
    : t("{name} cierra una carrera digna, a las puertas del Hall of Fame.", { name: career.coach.name });
  return { inducted, tier, citation, halls, coachRank };
}
