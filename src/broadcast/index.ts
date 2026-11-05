/**
 * DRL BROADCAST — API pública del Broadcast Engine.
 * Cerebro de la retransmisión: estado de juego → BroadcastState listo para emitir.
 * Puro, independiente de sim/Director/Camera/React.
 */
export { buildBroadcastState } from "./engine";
export type { BroadcastInput } from "./engine";
export { winProbability, roundPrediction } from "./winprob";
export { buildKillFeed, detectFlags } from "./events";
export type {
  BroadcastState, MatchInfo, TeamInfo, PlayerInfo, KillFeedItem,
  BroadcastEvents, BroadcastFlags, BroadcastStats, RoundPrediction, ObserverInfo, SpikeStatus, MvpInfo, PlanInfo,
  LoadoutInfo, LoadoutSideInfo,
} from "./types";

// ── Match Presentation Engine (capa de presentación AAA; extiende Broadcast) ──
export { liveCasters, roundEndCasters, postMatchCasters, type CasterLine, type CasterVoice, type CasterTone, type CasterNames } from "./casters";
export { liveStats, spaceControl, type LiveStatLine } from "./liveStats";
export { detectPresentationEvents, type PresentationEvent, type PresentationEventType } from "./narrative";
export { buildMatchIntro, type MatchIntro, type IntroTeam, type IntroPlayer } from "./intro";
export { extractHighlights, type HighlightClip, type HighlightKind } from "./replay";
export { buildPostRound, type PostRound } from "./postround";
export { buildPostMatch, type PostMatch } from "./postmatch";
export { buildLivePresentation, type LivePresentation } from "./presentation";
