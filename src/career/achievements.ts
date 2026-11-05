/**
 * MANAGER CAREER ENGINE — logros de entrenador.
 *
 * Logros REALES de carrera (primer título, dinastía, descubridor de talentos…). Siguen el
 * MISMO contrato que `AchievementDef` del juego (`progress(ctx) >= goal`), con un contexto
 * propio de entrenador. El reclamo de la recompensa se canaliza por `useGameStore` (créditos),
 * sin duplicar el flujo de logros. Puro.
 */
import type { CoachAchievementDef, CoachAchievementContext, ManagerCareer } from "./types";
import { globalReputationScore } from "./reputation";

export const COACH_ACHIEVEMENTS: CoachAchievementDef[] = [
  {
    id: "first-title",
    name: "Primer título",
    description: "Gana tu primera competición.",
    icon: "🏆",
    reward: 5000,
    goal: 1,
    progress: (c) => c.stats.titles,
  },
  {
    id: "100-wins",
    name: "Centurión",
    description: "Gana 100 partidos.",
    icon: "💯",
    reward: 12000,
    goal: 100,
    progress: (c) => c.stats.wins,
  },
  {
    id: "perfect-season",
    name: "Temporada perfecta",
    description: "Gana una competición sin perder un partido.",
    icon: "✨",
    reward: 20000,
    goal: 1,
    progress: (c) => c.perfectSeasons,
  },
  {
    id: "champions",
    name: "Campeón del mundo",
    description: "Gana una competición global (Champions).",
    icon: "🌍",
    reward: 30000,
    goal: 1,
    progress: (c) => c.stats.titles, // se valida con tier global en la concesión narrativa
  },
  {
    id: "dynasty",
    name: "Dinastía",
    description: "Acumula 10 títulos.",
    icon: "👑",
    reward: 50000,
    goal: 10,
    progress: (c) => c.stats.titles,
  },
  {
    id: "talent-scout",
    name: "Descubridor de talentos",
    description: "Forma 10 jugadores MVP.",
    icon: "🔭",
    reward: 15000,
    goal: 10,
    progress: (c) => c.stats.mvps,
  },
  {
    id: "mastermind",
    name: "Maestro táctico",
    description: "Alcanza reputación global 80.",
    icon: "🧠",
    reward: 25000,
    goal: 80,
    progress: (c) => globalReputationScore(c.reputation),
  },
  {
    id: "legend",
    name: "Leyenda",
    description: "Obtén la licencia Legend.",
    icon: "🌟",
    reward: 100000,
    goal: 1,
    progress: (c) => (c.license === "legend" ? 1 : 0),
  },
];

export function buildCoachAchievementContext(career: ManagerCareer): CoachAchievementContext {
  return {
    stats: career.stats,
    reputation: career.reputation,
    level: career.level,
    license: career.license,
    perfectSeasons: career.perfectSeasons,
  };
}

export interface CoachAchievementView {
  id: string;
  name: string;
  description: string;
  icon: string;
  reward: number;
  goal: number;
  current: number;
  complete: boolean;
  claimed: boolean;
}

export function coachAchievementViews(career: ManagerCareer): CoachAchievementView[] {
  const ctx = buildCoachAchievementContext(career);
  const claimed = new Set(career.claimedAchievements);
  return COACH_ACHIEVEMENTS.map((d) => {
    const current = Math.min(d.goal, d.progress(ctx));
    return {
      id: d.id,
      name: d.name,
      description: d.description,
      icon: d.icon,
      reward: d.reward,
      goal: d.goal,
      current,
      complete: current >= d.goal,
      claimed: claimed.has(d.id),
    };
  });
}

/** ¿Se puede reclamar? (completo y no reclamado). Devuelve la recompensa o 0. */
export function claimableReward(career: ManagerCareer, id: string): number {
  if (career.claimedAchievements.includes(id)) return 0;
  const def = COACH_ACHIEVEMENTS.find((d) => d.id === id);
  if (!def) return 0;
  const ctx = buildCoachAchievementContext(career);
  return def.progress(ctx) >= def.goal ? def.reward : 0;
}
