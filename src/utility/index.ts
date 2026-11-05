/**
 * UTILITY ENGINE — API pública.
 *
 * El motor que hace que la utilidad EXISTA en el mapa (lógicamente, no visualmente):
 * un MapState vivo por zona, despliegue emergente y lecturas tácticas. Reutiliza el
 * Spatial Engine como mecánica. Lo consumen Sim (perception/combat), Tactical, Coach,
 * Broadcast y Narrative.
 */
export { createMapState, tickUtility } from "./engine";
export { mapReads, executeProbability, utilitySummary, hotZones } from "./read";
export type {
  MapState, ZoneState, ZoneStatus, ActiveUtility, EffectType,
} from "./types";
