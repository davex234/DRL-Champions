/**
 * RELEASE SYSTEM — API pública del sistema de releases (Fase 1/7).
 *
 * Arquitectura modular y desacoplada. Cada engine = una responsabilidad:
 *   Version · Build · Sign · Artifact · Manifest · Publish · Pipeline (orquestador)
 *
 * Las fases siguientes (CI/CD, transporte/servidor, canales avanzados, rollback remoto…)
 * consumirán estos mismos engines sin reescribir nada.
 */
export { default as VersionEngine } from "./version-engine.mjs";
export { default as BuildEngine } from "./build-engine.mjs";
export { default as SignEngine } from "./sign-engine.mjs";
export { default as ArtifactEngine } from "./artifact-engine.mjs";
export { default as ManifestEngine } from "./manifest-engine.mjs";
export { default as PublishEngine } from "./publish-engine.mjs";
export { default as ReleasePipeline } from "./pipeline.mjs";
