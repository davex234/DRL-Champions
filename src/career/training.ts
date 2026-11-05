/**
 * MANAGER CAREER ENGINE · Fase 3 — entrenamiento dirigido por el mánager.
 *
 * El usuario decide qué/quién/intensidad. NO se crea otro sistema de entrenamiento: REUTILIZA
 * el Player Development Engine (`train`). Las instalaciones (centro de entrenamiento) y el
 * staff (assistant) AMPLÍAN el desarrollo (sesión de refuerzo). Determinista. Puro.
 */
import { train, type TrainingSession, type InnateProfile, type DevState, type DevTransition } from "@/development";
import type { ClubManagement } from "./types";
import { facilityEffects } from "./facilities";
import { staffEffects } from "./staff";

/** Nº de sesiones de entrenamiento que el club puede ejecutar por temporada. */
export function trainingCapacity(mgmt: ClubManagement): number {
  return 2 + mgmt.facilities.training_center; // 3..7
}

/** Eficacia global del entrenamiento (0..~1.4) por instalaciones + staff. */
export function trainingEffectiveness(mgmt: ClubManagement): number {
  return 1 + facilityEffects(mgmt.facilities).devBonus + staffEffects(mgmt.staff).trainingBoost;
}

/**
 * Entrena a un jugador (reusa `train`). Con instalaciones/staff fuertes, una SESIÓN DE
 * REFUERZO extra (desarrollo real adicional). Devuelve el nuevo DevState + transición.
 */
export function trainPlayer(innate: InnateProfile, dev: DevState, session: TrainingSession, mgmt: ClubManagement, season: number): { state: DevState; transition: DevTransition } {
  const first = train(dev, innate, session, season);
  const boost = facilityEffects(mgmt.facilities).devBonus + staffEffects(mgmt.staff).trainingBoost;
  if (boost >= 0.5) {
    // Refuerzo: una sesión ligera adicional del mismo foco (las grandes instalaciones rinden más).
    return train(first.state, innate, { id: session.id, intensity: "light" }, season);
  }
  return first;
}
