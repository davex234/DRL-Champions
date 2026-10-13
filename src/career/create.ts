/**
 * MANAGER CAREER ENGINE — creación del entrenador.
 *
 * Al comenzar una partida se CREA un entrenador: nombre, avatar, país, idioma, estilo,
 * especialidad, personalidad, biografía y objetivo personal. Todo determinista a partir de
 * una semilla derivada de la identidad. Puro (no lee el reloj salvo el `createdAt` inyectado).
 */
import type { CoachStyle, CoachSpecialty, CoachPersonalityId, Region, ManagerCareer, Coach } from "./types";
import { deriveAttributes } from "./attributes";
import { personalityIdentity } from "./personality";
import { ZERO_REPUTATION } from "./reputation";
import { emptyHistory, joinTeam } from "./history";
import { generateObjectives } from "./objectives";
import { initBoard } from "./board";
import { makeRng, seedOf } from "./rng";
import { ns } from "@/i18n/runtime";

const t = ns("career");

export interface CoachCreateInput {
  name: string;
  age: number;
  country: string;
  region: Region;
  avatar: string;
  bio: string;
  language: string;
  style: CoachStyle;
  specialty: CoachSpecialty;
  personality: CoachPersonalityId;
  /** Objetivo personal (vitalicio). */
  personalGoal: string;
  /** Equipo inicial (nombre). Si falta, el entrenador empieza en paro. */
  team?: string;
  /** Marca temporal de creación (inyectada para mantener pureza/determinismo en tests). */
  now: number;
}

const ZERO_STATS = {
  matchesPlayed: 0,
  wins: 0,
  losses: 0,
  titles: 0,
  finals: 0,
  defeats: 0,
  mvps: 0,
  bestWinStreak: 0,
  currentWinStreak: 0,
  seasonsCoached: 0,
  teamsCoached: 0,
};

export function createCoach(input: CoachCreateInput): ManagerCareer {
  const seed = seedOf(input.name, input.country, input.style, input.specialty, input.personality);
  const rng = makeRng(seed);

  const coach: Coach = {
    id: `coach-${seed.toString(36)}`,
    name: input.name.trim() || "Entrenador",
    age: Math.max(18, Math.min(80, Math.round(input.age))),
    country: input.country.trim() || "Internacional",
    avatar: input.avatar || "🧑‍🏫",
    bio: input.bio.trim(),
    language: input.language || "es",
    style: input.style,
    specialty: input.specialty,
    personality: input.personality,
    identity: personalityIdentity(input.personality),
    region: input.region,
    createdAt: input.now,
  };

  const attributes = deriveAttributes(input.style, input.specialty, rng);
  const stats = { ...ZERO_STATS, teamsCoached: input.team ? 1 : 0 };
  let history = emptyHistory();
  if (input.team) history = joinTeam(history, input.team, 1);

  const objectives = generateObjectives(stats, 1, makeRng(seedOf(seed, "objectives", 1)), input.personalGoal);

  return {
    coach,
    attributes,
    reputation: { ...ZERO_REPUTATION },
    xp: 0,
    level: 1,
    license: "nivel-1",
    season: 1,
    currentTeam: input.team ?? null,
    stats,
    history,
    objectives,
    personalGoal: input.personalGoal.trim() || t("Convertirse en leyenda"),
    claimedAchievements: [],
    perfectSeasons: 0,
    events: [],
    seed,
    // — Fase 2: empieza sin club del mundo; el empleo real llega vía ofertas/mercado —
    clubId: null,
    contract: null,
    board: initBoard(),
    offers: [],
    unemployedSeasons: 0,
    // — Fase 3: la gestión del club nace al ligarse a un club (vía oferta aceptada) —
    management: null,
  };
}
