/**
 * MATCH NARRATIVE ENGINE — API pública.
 *
 * Módulo independiente: solo CONSUME estado/eventos del sim. Nunca decide gameplay
 * ni muta nada. El cerebro que permitirá replay/highlights/comentarista/resúmenes/
 * noticias/carrera del jugador en fases futuras.
 */
export { MatchNarrator, buildMatchNarrative, type MatchMeta } from "./engine";
export { answerQuestions, type QueryAnswers, type QueryAnswer } from "./query";
export type {
  NarrativeState, NarrativeEvent, NarrativeEventType, TeamId, TeamRef,
  StoryGraph, StoryEdge, EdgeRelation,
  MomentumPoint, MomentumShift, PlayerArc, PlayerStateTag, RivalryRecord,
  MatchShape, MatchShapeId, KeyMoment, Standout, StoryBeat, MatchSummary,
  EventParticipant, ParticipantRole,
} from "./types";
export type { RoundRecord, PlayerRoundLine } from "./memory";
export type { StaticPlayer } from "./arcs";
