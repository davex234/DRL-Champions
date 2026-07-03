/**
 * PIPELINE STATE — estructura de estado del Build Cloud (preparación para la Fase 3/dashboard).
 *
 * NO es UI: es solo la máquina de estados serializable que el runner de CI alimenta vía el
 * hook `onPhase` de ReleasePipeline. La Fase 3 podrá leer este objeto/`pipeline-state.json`
 * para pintar el dashboard sin tocar el pipeline.
 *
 *   Queued → Running → Building → Signing → Generating manifests →
 *   Uploading → Verifying → Published → Ready   (o → Failed)
 *
 * Las fases de publicación (uploading/verifying/published) las emite el sistema de publicación
 * (transport/), alimentando esta misma máquina vía el hook `onPhase`. "Ready" = release realmente
 * publicada y verificada → los launchers pueden verla.
 */
export const PHASES = [
  "queued", "running", "building", "signing", "manifests",
  "uploading", "verifying", "published", "ready",
];
export const PHASE_LABEL = {
  queued: "Queued",
  running: "Running",
  building: "Building",
  signing: "Signing",
  manifests: "Generating manifests",
  uploading: "Uploading",
  verifying: "Verifying",
  published: "Published",
  ready: "Ready",
  failed: "Failed",
};

/** Mapea los nombres del hook `onPhase` del pipeline a fases del dashboard. */
export const fromPipelinePhase = (name) => (PHASES.includes(name) ? name : "running");

export function createPipelineState({ now = () => Date.now() } = {}) {
  const startedAt = now();
  const transitions = [];
  let state = "queued";
  let error = null;

  const record = (next) => {
    transitions.push({ state: next, at: now(), elapsedMs: now() - startedAt });
    state = next;
  };
  record("queued");

  return {
    transition(next) {
      record(next);
      return state;
    },
    fail(err) {
      error = String(err?.message ?? err);
      record("failed");
      return state;
    },
    get current() {
      return state;
    },
    snapshot() {
      return {
        state,
        label: PHASE_LABEL[state] ?? state,
        error,
        startedAt,
        finishedAt: state === "ready" || state === "failed" ? now() : null,
        durationMs: now() - startedAt,
        transitions: transitions.slice(),
      };
    },
  };
}

export const PipelineState = { PHASES, PHASE_LABEL, fromPipelinePhase, createPipelineState };
export default PipelineState;
