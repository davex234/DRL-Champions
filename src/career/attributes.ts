/**
 * MANAGER CAREER ENGINE — atributos del entrenador.
 *
 * 15 atributos reales (0..100), agrupados en familias para el informe/UI. Sigue el
 * MISMO patrón que el Player Identity Engine (`neutral`/`make`/`clamp`) para no inventar
 * un modelo nuevo. Puro y determinista.
 */
import type { CoachAttributeKey, CoachAttributes, CoachStyle, CoachSpecialty } from "./types";

/** Familias para la radar/informe de la UI. 15 atributos en total. */
export const ATTR_FAMILIES: Record<string, CoachAttributeKey[]> = {
  "Liderazgo": ["leadership", "communication", "motivation", "teamManagement"],
  "Táctica": ["tacticalVision", "analytics", "adaptability", "discipline"],
  "Desarrollo": ["talentDevelopment", "trainingQuality", "mentalCoaching", "scouting"],
  "Gestión": ["pressureManagement", "mediaHandling", "negotiation"],
};

export const ATTR_KEYS: CoachAttributeKey[] = Object.values(ATTR_FAMILIES).flat();

/** Etiquetas legibles (ES) por atributo. */
export const ATTR_LABEL: Record<CoachAttributeKey, string> = {
  leadership: "Liderazgo",
  communication: "Comunicación",
  discipline: "Disciplina",
  motivation: "Motivación",
  talentDevelopment: "Desarrollo de talento",
  tacticalVision: "Visión táctica",
  scouting: "Scouting",
  pressureManagement: "Gestión de presión",
  mediaHandling: "Manejo de prensa",
  negotiation: "Negociación",
  teamManagement: "Gestión de equipo",
  analytics: "Análisis",
  mentalCoaching: "Coaching mental",
  trainingQuality: "Calidad de entrenamiento",
  adaptability: "Adaptabilidad",
};

export const clampAttr = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));

export function neutralAttributes(): CoachAttributes {
  const a = {} as CoachAttributes;
  for (const k of ATTR_KEYS) a[k] = 50;
  return a;
}

export function makeAttributes(partial: Partial<CoachAttributes>): CoachAttributes {
  const a = neutralAttributes();
  for (const k of ATTR_KEYS) {
    if (partial[k] != null) a[k] = clampAttr(partial[k]!);
  }
  return a;
}

/** Media global del entrenador (OVR) — 0..100. */
export function attrOverall(a: CoachAttributes): number {
  let sum = 0;
  for (const k of ATTR_KEYS) sum += a[k];
  return Math.round(sum / ATTR_KEYS.length);
}

/** Sesgos de atributos por ESTILO (suman sobre la base neutra). */
const STYLE_BIAS: Record<CoachStyle, Partial<CoachAttributes>> = {
  aggressive: { motivation: 14, leadership: 10, pressureManagement: 8, discipline: -6 },
  control: { discipline: 14, tacticalVision: 12, analytics: 8, motivation: -4 },
  tactical: { tacticalVision: 16, analytics: 14, adaptability: 8 },
  balanced: { teamManagement: 8, communication: 8, adaptability: 6 },
  developer: { talentDevelopment: 16, trainingQuality: 14, scouting: 8 },
  motivator: { motivation: 16, mentalCoaching: 12, communication: 10, analytics: -4 },
};

/** Sesgos de atributos por ESPECIALIDAD. */
const SPECIALTY_BIAS: Record<CoachSpecialty, Partial<CoachAttributes>> = {
  aim: { trainingQuality: 12, talentDevelopment: 8 },
  igl: { tacticalVision: 12, communication: 10, leadership: 8 },
  strategy: { analytics: 14, tacticalVision: 10, adaptability: 6 },
  psychology: { mentalCoaching: 16, pressureManagement: 10, motivation: 6 },
  scouting: { scouting: 18, negotiation: 8, analytics: 6 },
  management: { teamManagement: 14, negotiation: 12, mediaHandling: 10 },
};

/**
 * Atributos iniciales derivados del estilo + especialidad + un jitter SEMBRADO.
 * Determinista: misma entrada ⇒ mismos atributos.
 */
export function deriveAttributes(
  style: CoachStyle,
  specialty: CoachSpecialty,
  rng: { int: (min: number, max: number) => number },
): CoachAttributes {
  const base: Partial<CoachAttributes> = {};
  const styleBias = STYLE_BIAS[style];
  const specBias = SPECIALTY_BIAS[specialty];
  for (const k of ATTR_KEYS) {
    // Base de rookie (no genios de salida): centro ~44 + sesgos + jitter ±5.
    const jitter = rng.int(-5, 5);
    base[k] = 44 + (styleBias[k] ?? 0) + (specBias[k] ?? 0) + jitter;
  }
  return makeAttributes(base);
}
