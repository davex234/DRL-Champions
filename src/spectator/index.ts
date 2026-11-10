/**
 * DRL SPECTATOR — API pública del Director de Realización.
 * Capa independiente del simulador: consume estado, nunca lo modifica.
 */
export { LiveDirector, createLiveDirector, liveInput } from "./director";
export { detectCandidates } from "./priorities";
export { formatSwitch } from "./debug";
export {
  DEFAULT_CONFIG, TIER_RANK,
} from "./types";
export type {
  Director, DirectorInput, DirectorDecision, DirectorConfig,
  CameraType, SituationId, SituationTier, FocusCandidate, DebugEntry,
} from "./types";
// ── Online Fase 5: ReplayDirector + Observer cameras + Spectator session ──
export { ReplayDirector, createReplayDirector } from "./replayDirector";
export { initCamera, resolveCamera, type ObserverCameraMode, type ObserverCameraState } from "./cameras";
export { SpectatorSession, type SpectatorKind, type ObserverFrame } from "./observer";
