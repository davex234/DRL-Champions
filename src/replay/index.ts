/**
 * REPLAY ENGINE — API pública (Online Fase 5/7).
 *
 * Grabación COMPACTA (config+input log) + timeline + player (pause/resume/seek/frame-step/speed) +
 * bookmarks + highlights (reutiliza Broadcast) + export/share code + checksum/versión. Reutiliza el
 * ÚNICO Gameplay (`reconstruct`/`tick`). Spectator y Replay consumen los mismos `RoundState`.
 * Determinista. NO crea otro Replay/Match Engine. Depende de match/sim/online/broadcast (no al revés).
 */
export * from "./types";
export { checksumReplay, isReplayCompatible, verifyReplay, recordReplay, recordFromServer, metaFrom, reconstructRoundStates, roundBoundaries } from "./engine";
export { ReplayTimeline } from "./timeline";
export { ReplayPlayer } from "./player";
export { encodeReplay, decodeReplay, shareCode, identityCompressor, type ReplayCompressor } from "./share";
