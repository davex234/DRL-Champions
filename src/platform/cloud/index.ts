// ❄️ FROZEN (Consolidation F1.1, 2026-07-06): motor completo y verificado SIN consumidores de
// producto hoy. Se conserva por valor de roadmap (wire before kill). NO crecer ni integrar
// sin decision explicita. Registro y criterios: docs/FROZEN.md
/**
 * GLOBAL ESPORTS PLATFORM — API pública (Online Fase 7/7 · FINAL).
 *
 * La capa SUPERIOR que conecta absolutamente todo el proyecto (Online/Matchmaking/Competitive/
 * Social/Replay/Spectator/Custom/Tournament/Career/World/Presentation) SIN duplicar ningún motor:
 * transporte (adapters) · servidores dedicados/instancias/regiones · gateway/routing/API · registros
 * en vivo/presence · analytics/telemetry/metrics/heatmaps · storage/replay-CDN/search · moderación ·
 * administración/auditoría · webhooks/streaming · monitoring/health/dashboards · escalado/failover/HA.
 * DESACOPLADA (interfaces + adapters + DI), DETERMINISTA, sin ciclos. Nadie depende de esta capa.
 */
export * from "./types";
export {
  type TransportAdapter, TransportRegistry,
  LoopbackAdapter, LanAdapter, OfflineAdapter, WebSocketAdapter, RealtimeAdapter, CloudAdapter,
} from "./transport";
export { InstanceManager, RegionManager, HEARTBEAT_TIMEOUT, type AllocateResult } from "./servers";
export {
  Gateway, ProtocolRegistry, AuthService, RateLimiter, ApiGateway,
  type Handshake, type RouteResult, type Token, type ApiRoute, type ApiScope,
} from "./gateway";
export {
  LiveMatchRegistry, LiveTournamentRegistry, PresenceSync,
  type LiveMatch, type LiveTournament, type Presence, type PresenceStatus,
} from "./registry";
export {
  ReplayStore, AssetStore, CdnLayer, MemoryBlobAdapter,
  type BlobAdapter, type ReplayIndexEntry, type ReplayQuery,
} from "./storage";
export {
  analyzeMatch, analyzeTournament, analyzePlayer, TelemetrySink, Metrics,
  type MatchAnalytics, type TournamentAnalytics, type PlayerAnalytics, type TelemetryEvent, type StandingRow,
} from "./analytics";
export {
  ModerationEngine,
  type Report, type Sanction, type Appeal, type SanctionType, type ReportReason, type AppealStatus,
} from "./moderation";
export { AdminTools, AuditLog, type AdminAction, type AuditEntry, type AdminResult } from "./admin";
export {
  PlatformEventBus, MemorySink, HttpWebhook, StreamingHook, DiscordHook,
  type WebhookSink, type StreamCue,
} from "./webhooks";
export {
  HealthChecker, Dashboards, DistributedLog, CrashReporter,
  type HealthReport, type ServerDashboard, type LiveDashboard, type PerformanceDashboard,
  type DistLogEntry, type CrashRecord, type LogLevel,
} from "./monitoring";
export { ScalingManager, DEFAULT_POLICY, type ScalingPolicy, type ScaleEvent } from "./scaling";
export { PlatformEngine, type HostRequest, type HostResult } from "./engine";
