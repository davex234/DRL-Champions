/**
 * COMBAT INTEGRATION — Efecto ABSTRACTO de la utilidad (sin habilidades).
 * Valores de capacidad: tomar espacio, retrasar, ejecutar y retomar. Preparado para
 * que las habilidades de agentes (fase futura) sustituyan estos valores abstractos.
 */
export interface UtilityEffect {
  /** Tomar espacio (ataque). */
  space: number;
  /** Retrasar/aguantar (defensa). */
  delay: number;
  /** Ejecutar un sitio (ataque). */
  execute: number;
  /** Retomar un sitio (defensa post-plant). */
  retake: number;
}

export function utilityEffect(charges: number): UtilityEffect {
  const c = Math.max(0, charges);
  return { space: c * 0.10, delay: c * 0.08, execute: c * 0.12, retake: c * 0.10 };
}
