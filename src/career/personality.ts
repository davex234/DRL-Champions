/**
 * MANAGER CAREER ENGINE — personalidad del entrenador.
 *
 * REUTILIZA el Player Identity Engine (`@/sim/identity`): cada arquetipo de personalidad
 * del entrenador se expresa como un vector `Identity` (mismo modelo 0..100, `makeIdentity`).
 * No se crea un modelo de personalidad nuevo. Puro.
 */
import { makeIdentity, type Identity } from "@/sim/identity";
import type { CoachPersonalityId } from "./types";
import { ns } from "@/i18n/runtime";

const t = ns("career");

export const PERSONALITY_LABEL: Record<CoachPersonalityId, string> = {
  calm: "Calmado",
  aggressive: "Agresivo",
  innovative: "Innovador",
  traditional: "Tradicional",
  motivator: "Motivador",
  analytical: "Analítico",
  patient: "Paciente",
  demanding: "Exigente",
  flexible: "Flexible",
  controlling: "Controlador",
};

/** Cada personalidad = un preset de `Identity` (reutilizando el motor existente). */
export const PERSONALITY_IDENTITY: Record<CoachPersonalityId, Identity> = {
  calm: makeIdentity({ composure: 86, patience: 80, resilience: 78, aggression: 30, ego: 28 }),
  aggressive: makeIdentity({ aggression: 88, riskAppetite: 82, entryDrive: 80, patience: 24, discipline: 38 }),
  innovative: makeIdentity({ creativity: 90, adaptability: 84, tacticalIQ: 74, discipline: 42 }),
  traditional: makeIdentity({ discipline: 88, consistency: 82, creativity: 30, adaptability: 38 }),
  motivator: makeIdentity({ leadershipDrive: 88, communication: 86, selfBelief: 80, composure: 70 }),
  analytical: makeIdentity({ tacticalIQ: 92, adaptability: 78, discipline: 76, aggression: 36, creativity: 60 }),
  patient: makeIdentity({ patience: 90, composure: 80, riskAppetite: 28, consistency: 78 }),
  demanding: makeIdentity({ discipline: 90, ego: 64, leadershipDrive: 78, resilience: 70, patience: 36 }),
  flexible: makeIdentity({ adaptability: 90, creativity: 70, composure: 72, discipline: 50 }),
  controlling: makeIdentity({ discipline: 84, leadershipDrive: 82, tacticalIQ: 76, creativity: 32, ego: 58 }),
};

export function personalityIdentity(id: CoachPersonalityId): Identity {
  return PERSONALITY_IDENTITY[id];
}

/** Etiquetas descriptivas derivadas del vector de identidad (para la UI/informe). */
export function personalityTags(identity: Identity): string[] {
  const tags: string[] = [];
  if (identity.composure >= 75) tags.push(t("Sangre fría"));
  if (identity.aggression >= 75) tags.push("Proactivo");
  if (identity.patience >= 75) tags.push("Paciente");
  if (identity.creativity >= 75) tags.push("Creativo");
  if (identity.discipline >= 80) tags.push("Disciplinado");
  if (identity.tacticalIQ >= 80) tags.push("Cerebral");
  if (identity.leadershipDrive >= 80) tags.push("Líder");
  if (identity.adaptability >= 80) tags.push("Flexible");
  return tags.length ? tags : ["Equilibrado"];
}
