/**
 * SPATIAL SIMULATION ENGINE — Lenguaje de utilidad (infraestructura).
 *
 * AÚN NO hay habilidades reales de Valorant. Esto es el VOCABULARIO con el que, en el
 * futuro, un smoke/flash/molly/recon modificará el razonamiento espacial: un smoke
 * corta una línea de visión, una molly deniega una zona, un recon revela enemigos.
 * Las consultas espaciales (visión, control, peligro, rutas) ya respetan esta capa.
 */
import type { SpatialOverlay, UtilityEffect } from "./types";

const key = (a: string, b: string) => `${a}|${b}`;

/** Construye la superposición activa a partir de las utilidades vigentes en `tick`. */
export function buildOverlay(effects: UtilityEffect[], tick = 0): SpatialOverlay {
  const ov: SpatialOverlay = { blockedSight: new Set(), deniedZones: new Set(), revealedZones: new Set() };
  for (const e of effects) {
    if (e.untilTick != null && tick > e.untilTick) continue;
    switch (e.kind) {
      case "smoke":
        if (e.sightline) { ov.blockedSight.add(key(e.sightline[0], e.sightline[1])); ov.blockedSight.add(key(e.sightline[1], e.sightline[0])); }
        break;
      case "molly":
        if (e.zone) ov.deniedZones.add(e.zone);
        break;
      case "recon":
        if (e.zone) ov.revealedZones.add(e.zone);
        break;
      case "cover":
      case "flash":
        // Placeholders: la mecánica real llegará en fases posteriores.
        break;
    }
  }
  return ov;
}

// Constructores de conveniencia (azúcar declarativo).
export const smoke = (a: string, b: string, untilTick?: number, side?: UtilityEffect["side"]): UtilityEffect =>
  ({ kind: "smoke", sightline: [a, b], untilTick, side });
export const molly = (zone: string, untilTick?: number, side?: UtilityEffect["side"]): UtilityEffect =>
  ({ kind: "molly", zone, untilTick, side });
export const recon = (zone: string, untilTick?: number, side?: UtilityEffect["side"]): UtilityEffect =>
  ({ kind: "recon", zone, untilTick, side });
