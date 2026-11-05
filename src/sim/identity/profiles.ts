/**
 * PLAYER IDENTITY ENGINE — Perfiles de ejemplo (ARQUETIPOS).
 *
 * IMPORTANTE: aquí NO se hardcodea ningún jugador. Son vectores de rasgos
 * declarativos; cualquier pro presente o futuro se modela eligiendo/afinando uno
 * de estos arquetipos o escribiendo el suyo. Los nombres describen un ESTILO, no a
 * una persona. La huella de comportamiento emerge sólo de estos números.
 */
import { makeIdentity, type Identity } from "./traits";

export type ArchetypeId =
  | "aggressive-duelist"
  | "explosive-star"
  | "cerebral-igl"
  | "patient-anchor"
  | "flank-lurker"
  | "utility-support";

/** Duelista de fuego: entra el primero, asume riesgo, confía y tiene ego. */
export const aggressiveDuelist: Identity = makeIdentity({
  aggression: 92, patience: 22, riskAppetite: 84,
  composure: 70, selfBelief: 88, resilience: 72, consistency: 74, ego: 78,
  tacticalIQ: 58, adaptability: 55, discipline: 38, creativity: 60,
  entryDrive: 90, lurkTendency: 18, tradeInstinct: 55, utilityLean: 35, clutchFactor: 74,
  leadershipDrive: 40, communication: 52,
});

/** Estrella explosiva: techo altísimo pero ERRÁTICA (highlight o desastre). */
export const explosiveStar: Identity = makeIdentity({
  aggression: 88, patience: 25, riskAppetite: 90,
  composure: 55, selfBelief: 92, resilience: 58, consistency: 40, ego: 84,
  tacticalIQ: 54, adaptability: 60, discipline: 30, creativity: 88,
  entryDrive: 82, lurkTendency: 30, tradeInstinct: 45, utilityLean: 30, clutchFactor: 82,
  leadershipDrive: 38, communication: 48,
});

/** IGL cerebral: disciplina, sangre fría, lee la ronda y dirige; poco ego. */
export const cerebralIGL: Identity = makeIdentity({
  aggression: 50, patience: 78, riskAppetite: 42,
  composure: 88, selfBelief: 70, resilience: 84, consistency: 82, ego: 24,
  tacticalIQ: 92, adaptability: 88, discipline: 86, creativity: 66,
  entryDrive: 36, lurkTendency: 40, tradeInstinct: 78, utilityLean: 70, clutchFactor: 70,
  leadershipDrive: 92, communication: 90,
});

/** Ancla paciente: aguanta ángulos, no regala nada, ultra consistente. */
export const patientAnchor: Identity = makeIdentity({
  aggression: 24, patience: 92, riskAppetite: 26,
  composure: 90, selfBelief: 66, resilience: 80, consistency: 88, ego: 22,
  tacticalIQ: 82, adaptability: 64, discipline: 90, creativity: 44,
  entryDrive: 18, lurkTendency: 30, tradeInstinct: 70, utilityLean: 76, clutchFactor: 76,
  leadershipDrive: 60, communication: 82,
});

/** Lurker de flanco: se separa, juega timings, frío en el clutch, creativo. */
export const flankLurker: Identity = makeIdentity({
  aggression: 52, patience: 80, riskAppetite: 58,
  composure: 82, selfBelief: 74, resilience: 76, consistency: 78, ego: 50,
  tacticalIQ: 80, adaptability: 72, discipline: 60, creativity: 86,
  entryDrive: 28, lurkTendency: 94, tradeInstinct: 40, utilityLean: 48, clutchFactor: 88,
  leadershipDrive: 46, communication: 58,
});

/** Soporte de utilidad: monta las jugadas con util, comunica, disciplina. */
export const utilitySupport: Identity = makeIdentity({
  aggression: 40, patience: 70, riskAppetite: 38,
  composure: 78, selfBelief: 60, resilience: 78, consistency: 80, ego: 28,
  tacticalIQ: 78, adaptability: 74, discipline: 84, creativity: 62,
  entryDrive: 34, lurkTendency: 26, tradeInstinct: 72, utilityLean: 94, clutchFactor: 58,
  leadershipDrive: 56, communication: 88,
});

export const PROFILES: Record<ArchetypeId, Identity> = {
  "aggressive-duelist": aggressiveDuelist,
  "explosive-star": explosiveStar,
  "cerebral-igl": cerebralIGL,
  "patient-anchor": patientAnchor,
  "flank-lurker": flankLurker,
  "utility-support": utilitySupport,
};
