/**
 * COMBAT INTEGRATION × TACTICAL — postura táctica que sugiere el equipamiento.
 * Mucha utilidad + buen kit → executes elaborados; kit pobre → buscar picks y jugar
 * agrupados. Señal pura que el Tactical Engine puede consumir (no lo modifica).
 */
import type { SimLoadout } from "../sim";

export interface TeamPosture {
  /** Nivel medio de equipamiento (0..1). */
  kitLevel: number;
  /** Utilidad total del equipo. */
  utility: number;
  executes: boolean;
  picks: boolean;
  grouped: boolean;
  utilityHeavy: boolean;
}

export function teamPosture(loadouts: SimLoadout[]): TeamPosture {
  if (loadouts.length === 0) {
    return { kitLevel: 0, utility: 0, executes: false, picks: true, grouped: true, utilityHeavy: false };
  }
  const kitLevel = loadouts.reduce((s, l) => s + l.firepower, 0) / loadouts.length / 100;
  const utility = loadouts.reduce((s, l) => s + l.utility, 0);
  return {
    kitLevel,
    utility,
    executes: utility >= 4 && kitLevel > 0.6,
    picks: kitLevel < 0.45,
    grouped: kitLevel < 0.45,
    utilityHeavy: utility >= 4,
  };
}
