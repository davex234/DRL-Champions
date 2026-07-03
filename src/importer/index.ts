/**
 * DATA IMPORT ENGINE — API pública (Fase 1/7).
 *
 * Flujo único: Datasource(provider) → Importer → Parser → Normalizer → Validator → Canonical Model.
 * SOLO datos objetivos: sin cartas, sin OVR, sin rareza, sin economía. Puro y determinista.
 * Read-only respecto a Collection/Gameplay/Career/World (no importa ningún store mutable).
 */
export * from "./model";
export * from "./types";
export { parseIso, makeClock, type ImportClock } from "./clock";
export {
  createIdentityResolver, buildRegistry,
  type IdentityResolver, type IdentityRegistry, type IdentityRef, type ImportEntityKind,
} from "./identity";
export type { ImportProvider, ProviderId, ProviderHealth } from "./provider/types";
export { parseSnapshot, type ParsedSnapshot, type ParseOutput } from "./parse";
export { normalizeSnapshot } from "./normalize";
export {
  validateModel, validateSchema, validateIdentity, validateReference,
  validateDuplicate, validateConsistency, validateVersion,
} from "./validate";
export { importSnapshot, importFromProvider } from "./engine";
