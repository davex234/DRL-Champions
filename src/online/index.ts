/**
 * ONLINE CORE — API pública (Online Fase 1/7).
 *
 * Infraestructura de red DESACOPLADA que conduce el ÚNICO Gameplay existente de forma
 * AUTORITATIVA: transporte (DI) · protocolo/versionado · paquetes/serializer · identidad/auth ·
 * sesión · lobby · connection manager · heartbeat · latencia · reloj · replicación (snapshot/
 * delta) · input log (lockstep/replay) · predicción · servidor autoritativo · cliente/observador.
 * Reutiliza `@/sim`+`@/match`+`@/coach`+`@/spectator`+`@/broadcast`+`@/platform`. Determinista.
 * NO matchmaking/ranking/amigos/torneos (fases posteriores). Offline INTACTO.
 */
export * from "./types";
export { PROTOCOL_VERSION, MIN_COMPATIBLE_PROTOCOL, localHandshake, isProtocolCompatible, incompatibilityReason, type Handshake } from "./protocol";
export { makeIdentity, makeServerIdentity, authFromUser, anonymousAuth, type AuthSource, type AuthSession } from "./identity";
export { makePacket, verifyPacket, checksumOf, encodePacket, decodePacket, identityCompressor, type Compressor } from "./packet";
export { LoopbackHub, loopbackClient, loopbackServerBus, websocketTransport, REALTIME_PREPARED, type Transport, type ServerBus, type TransportKind } from "./transport";
export { estimateClock, serverTickEstimate, type NetClock, type ClockSample } from "./clock";
export { newLatency, recordRtt, connectionQuality, type LatencyMonitor } from "./latency";
export { newHeartbeat, dueForPing, timedOut, onPingSent, onPongReceived, type Heartbeat } from "./heartbeat";
export { newOutbound, enqueueOut, ackUpTo, newInbound, acceptSeq, NetEventBus, type OutboundQueue, type InboundOrder } from "./events";
export { createSession, canTransition, transition, attachLobby, type OnlineSession, type SessionPhase } from "./session";
export { createLobby, joinLobby, leaveLobby, setReady, assignSide, canStart, startLobby, type Lobby, type LobbyMember, type LobbyDraft, type LobbyStatus } from "./lobby";
export {
  newInputLog, appendCommand, commandsForRound, applyRoundCommands, driveMatch, reconstruct,
  matchScalars, snapshotRound, diffRound, applyDelta,
} from "./replication";
export { newPrediction, predict, confirmUpTo, reconcile, type Prediction } from "./prediction";
export { OnlineServer, createServer, type ServerOptions } from "./server";
export { OnlineClient } from "./client";
export { ConnectionManager } from "./connection";
export { createLocalGame, connectAll, runUntilMatchEnd, type LocalGame, type ClientSpec } from "./orchestrator";
