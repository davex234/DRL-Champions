/**
 * MANAGER CAREER ENGINE — broadcast (datos listos para mostrar).
 *
 * Prepara una vista de PERFIL de entrenador (identidad, atributos, reputación, licencia,
 * carrera, objetivos, logros, eventos). Patrón calcado de `worldBroadcast`: el motor produce
 * datos; la UI solo pinta. Puro.
 */
import type { ManagerCareer } from "./types";
import { ATTR_FAMILIES, ATTR_LABEL, attrOverall } from "./attributes";
import { personalityTags, PERSONALITY_LABEL } from "./personality";
import { reputationTier, globalReputationScore } from "./reputation";
import { licenseDef, nextLicense } from "./licenses";
import { levelProgress } from "./experience";
import { coachAchievementViews, type CoachAchievementView } from "./achievements";

export interface AttrRow {
  key: string;
  label: string;
  value: number;
}

export interface CoachCareerBroadcast {
  name: string;
  age: number;
  country: string;
  avatar: string;
  bio: string;
  styleLabel: string;
  personalityLabel: string;
  personalityTags: string[];
  region: string;
  overall: number;
  level: number;
  levelProgress: number;
  xp: number;
  xpToNext: number;
  license: { id: string; name: string };
  nextLicense: { name: string; req: { level: number; titles: number; reputation: number } } | null;
  reputation: ManagerCareer["reputation"];
  reputationScore: number;
  reputationTier: string;
  currentTeam: string | null;
  personalGoal: string;
  stats: ManagerCareer["stats"];
  attrFamilies: { family: string; rows: AttrRow[] }[];
  titles: ManagerCareer["history"]["titles"];
  spells: ManagerCareer["history"]["spells"];
  seasons: ManagerCareer["history"]["seasons"];
  objectives: ManagerCareer["objectives"];
  achievements: CoachAchievementView[];
  recentEvents: ManagerCareer["events"];
}

const STYLE_LABEL: Record<string, string> = {
  aggressive: "Agresivo",
  control: "Control",
  tactical: "Táctico",
  balanced: "Equilibrado",
  developer: "Formador",
  motivator: "Motivador",
};

export function careerBroadcast(career: ManagerCareer): CoachCareerBroadcast {
  const lp = levelProgress(career.xp);
  const next = nextLicense(career);
  const def = licenseDef(career.license);
  return {
    name: career.coach.name,
    age: career.coach.age,
    country: career.coach.country,
    avatar: career.coach.avatar,
    bio: career.coach.bio,
    styleLabel: STYLE_LABEL[career.coach.style] ?? career.coach.style,
    personalityLabel: PERSONALITY_LABEL[career.coach.personality],
    personalityTags: personalityTags(career.coach.identity),
    region: career.coach.region,
    overall: attrOverall(career.attributes),
    level: career.level,
    levelProgress: lp.progress,
    xp: career.xp,
    xpToNext: lp.toNext,
    license: { id: def.id, name: def.name },
    nextLicense: next ? { name: next.name, req: next.req } : null,
    reputation: career.reputation,
    reputationScore: globalReputationScore(career.reputation),
    reputationTier: reputationTier(career.reputation).label,
    currentTeam: career.currentTeam,
    personalGoal: career.personalGoal,
    stats: career.stats,
    attrFamilies: Object.entries(ATTR_FAMILIES).map(([family, keys]) => ({
      family,
      rows: keys.map((k) => ({ key: k, label: ATTR_LABEL[k], value: career.attributes[k] })),
    })),
    titles: career.history.titles,
    spells: career.history.spells,
    seasons: career.history.seasons,
    objectives: career.objectives,
    achievements: coachAchievementViews(career),
    recentEvents: career.events.slice(-12).reverse(),
  };
}
