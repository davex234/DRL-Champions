/**
 * SPATIAL SIMULATION ENGINE — API pública.
 *
 * El LENGUAJE espacial del juego: el mapa como sistema táctico (visión, ángulos,
 * crossfires, control, cobertura, rutas, peligro, info) + el lenguaje de utilidad
 * (smokes/mollies/recon como infraestructura). Independiente y reutilizable en
 * cualquier mapa. La táctica lo consume; las habilidades futuras lo usarán.
 */
export { buildSpatialMap, type BuildOpts } from "./build";
export {
  computeControl, occupancy, sightOf, dangerAt, routeExposure,
  candidateRoutes, leastExposedRoute, knownEnemyZones,
} from "./control";
export {
  holdsCovering, crossfireFor, mostThreatenedChoke, attackLaneByExposure,
  rotationTarget, tradePairs,
} from "./query";
export { buildOverlay, smoke, molly, recon } from "./utility";
export { ascentSpatial, ascentDescriptor } from "./ascent";
export type {
  MapDescriptor, ZoneDesc, SpatialMap, Side, Occupancy, ControlState,
  UtilityKind, UtilityEffect, SpatialOverlay,
} from "./types";
