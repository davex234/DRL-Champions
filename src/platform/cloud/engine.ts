/**
 * PLATFORM ENGINE — orquestador de la Global Esports Platform (Online Fase 7/7 · FINAL).
 *
 * Compone TODOS los módulos de plataforma y conduce el ÚNICO flujo, reutilizando los motores ya
 * existentes sin duplicar ninguno:
 *
 *   Player → Gateway(auth/route) → Instance(alloc) → Online Core(createLocalGame) → Gameplay →
 *   Live Registry → Replay(recordFromServer) → Storage → Analytics → Event Bus → Streaming → Dashboard
 *
 * Determinista: reloj LÓGICO inyectado, ids/checksums estables, sin Date.now/Math.random.
 */
import {
  createLocalGame, connectAll, runUntilMatchEnd, type LobbyDraft, type ClientSpec,
} from "@/online";
import { recordFromServer, type ReplayPlayerMeta } from "@/replay";
import type { Region } from "@/domain/cards/types";

import { makeEvent, type Principal, type PlatformEvent, type PlatformEventType } from "./types";
import { TransportRegistry } from "./transport";
import { InstanceManager, RegionManager } from "./servers";
import { Gateway, type Handshake, type RouteResult } from "./gateway";
import { LiveMatchRegistry, LiveTournamentRegistry, PresenceSync } from "./registry";
import { ReplayStore } from "./storage";
import { TelemetrySink, Metrics, analyzeMatch, type MatchAnalytics } from "./analytics";
import { ModerationEngine } from "./moderation";
import { AdminTools } from "./admin";
import { PlatformEventBus, MemorySink, StreamingHook, DiscordHook } from "./webhooks";
import { HealthChecker, Dashboards, DistributedLog, CrashReporter } from "./monitoring";
import { ScalingManager } from "./scaling";

export interface HostRequest {
  matchId: string;
  draft: LobbyDraft;
  players: ReplayPlayerMeta[];
  mode: string;
  region: Region;
  clients?: ClientSpec[];
  tournamentId?: string | null;
}

export interface HostResult {
  matchId: string;
  instanceId: string | null;
  ticks: number;
  winner: "home" | "away" | null;
  score: { home: number; away: number };
  replayStored: boolean;
  share: string | null;
  analytics: MatchAnalytics | null;
}

export class PlatformEngine {
  readonly transports = new TransportRegistry();
  readonly instances = new InstanceManager();
  readonly regions = new RegionManager();
  readonly gateway = new Gateway(this.instances);
  readonly liveMatches = new LiveMatchRegistry();
  readonly liveTournaments = new LiveTournamentRegistry();
  readonly presence = new PresenceSync();
  readonly replays = new ReplayStore();
  readonly telemetry = new TelemetrySink();
  readonly metrics = new Metrics();
  readonly moderation = new ModerationEngine();
  readonly admin = new AdminTools();
  readonly bus = new PlatformEventBus();
  readonly crashes = new CrashReporter();
  readonly distLog = new DistributedLog();
  readonly health = new HealthChecker(this.instances);
  readonly dashboards = new Dashboards(this.instances, this.liveMatches, this.liveTournaments, this.presence, this.metrics);
  readonly scaling = new ScalingManager(this.instances, this.regions);
  readonly audit = new MemorySink("audit");

  private clock = 0;
  private seq = 0;

  constructor() {
    this.bus.subscribe(this.audit);
    this.bus.subscribe(new StreamingHook());
    this.bus.subscribe(new DiscordHook());
  }

  now(): number { return this.clock; }
  tick(dt = 1): number { this.clock += Math.max(0, dt); return this.clock; }

  /** Publica un evento de plataforma (bus + métrica). */
  emit<T>(type: PlatformEventType, actor: string, data: T, region?: Region): PlatformEvent<T> {
    const ev = makeEvent(this.seq++, type, this.clock, actor, data, region);
    this.bus.publish(ev);
    this.metrics.inc(`event.${type}`);
    return ev;
  }

  /** Arranque: garantiza alta disponibilidad (instancias mínimas por región). */
  boot(): void {
    this.scaling.ensureHA(this.clock);
    for (const i of this.instances.all()) this.emit("instance.up", "system", { instanceId: i.id }, i.region);
    this.distLog.log("info", "platform", `boot: ${this.instances.alive().length} instancias`, this.clock);
  }

  /** Player → Gateway: handshake + auth + routing a instancia (autoritativo). */
  route(h: Handshake): RouteResult {
    const res = this.gateway.open(h, this.clock);
    this.emit(res.ok ? "session.route" : "session.reject", h.principal.id, { reason: res.reason }, h.region);
    if (res.ok) this.presence.sync({ userId: h.principal.id, status: "online", region: h.region, matchId: null, at: this.clock });
    return res;
  }

  /**
   * Aloja y JUEGA una partida a través del flujo completo (el corazón de la plataforma).
   * Reutiliza el ÚNICO Online Core (`createLocalGame`) + Gameplay + Replay + Analytics + Storage.
   */
  hostMatch(req: HostRequest): HostResult {
    const region = req.region;
    // 1) Asignación de instancia (balanceo/autoescalado).
    const instanceId = this.scaling.distribute(req.matchId, region, this.clock);
    // 2) Alta en el registro en vivo + evento + streaming.
    this.liveMatches.open({
      matchId: req.matchId, instanceId: instanceId ?? "unassigned", region, mode: req.mode,
      teams: { home: req.draft.teamNames?.home ?? "H", away: req.draft.teamNames?.away ?? "A" },
      spectators: 0, startedAt: this.clock, score: { home: 0, away: 0 }, finished: false,
    });
    this.emit("match.start", "system", { matchId: req.matchId, instanceId }, region);

    // 3) Juega el partido en el Online Core (loopback determinista = servidor-en-proceso).
    const game = createLocalGame(req.draft, req.clients ?? [{ name: "P1" }, { name: "P2" }]);
    connectAll(game, 8);
    for (const c of game.clients) c.joinLobby();
    game.step(); game.step();
    game.clients[0].ready(); game.clients[1].ready();
    game.step();
    game.clients[0].start();
    game.step(); game.step();
    const ticks = runUntilMatchEnd(game);
    this.metrics.observe("route.ticks", ticks);
    this.telemetry.ingest({ kind: "match.ticks", value: ticks, at: this.clock });

    const match = game.server.match;
    const winner = match?.winner ?? null;
    const score = match ? { home: match.score.home, away: match.score.away } : { home: 0, away: 0 };
    this.liveMatches.update(req.matchId, { score });

    // 4) Grabación (Replay Engine) + almacenamiento + índice/CDN + share code.
    let replayStored = false, share: string | null = null, analytics: MatchAnalytics | null = null;
    const rep = recordFromServer(game.server, req.matchId, req.mode, region, req.players);
    if (rep) {
      const entry = this.replays.put(rep, this.clock, req.tournamentId ?? null);
      if (entry) {
        replayStored = true; share = entry.share;
        this.emit("replay.stored", "system", { matchId: req.matchId, share: entry.share }, region);
        // 5) Analítica derivada (no duplica el partido: lo re-lee vía ReplayTimeline).
        analytics = analyzeMatch(rep);
        this.telemetry.ingest({ kind: "match.rounds", value: analytics.rounds, at: this.clock });
      }
    }

    // 6) Cierre: fin en vivo + evento + liberar instancia.
    this.liveMatches.finish(req.matchId);
    this.emit("match.end", "system", { matchId: req.matchId, winner, score }, region);
    this.instances.release(req.matchId);

    return { matchId: req.matchId, instanceId, ticks, winner, score, replayStored, share, analytics };
  }

  /** Mantenimiento periódico: health sweep + autoescalado + failover de instancias caídas. */
  maintain(): void {
    const down = this.instances.sweep(this.clock);
    for (const i of down) {
      const orphans = i.matches.slice();
      const { moved, lost } = this.scaling.failover(i.id, orphans, this.clock);
      this.emit("instance.failover", "system", { instanceId: i.id, moved: Object.keys(moved).length, lost: lost.length }, i.region);
      this.crashes.report(i.id, "heartbeat_timeout", this.clock);
    }
    this.scaling.autoscale(this.clock);
  }

  /** Reporte de estado global (para el dashboard). */
  status(): { health: ReturnType<HealthChecker["check"]>; server: ReturnType<Dashboards["server"]>; live: ReturnType<Dashboards["live"]> } {
    return { health: this.health.check(this.clock), server: this.dashboards.server(), live: this.dashboards.live() };
  }

  /** Autoriza (y audita) una acción administrativa. */
  adminAction(action: Parameters<AdminTools["authorize"]>[0], by: Principal, target: string): boolean {
    const res = this.admin.authorize(action, by, target, this.clock);
    this.metrics.inc(res.ok ? "admin.ok" : "admin.denied");
    return res.ok;
  }
}
