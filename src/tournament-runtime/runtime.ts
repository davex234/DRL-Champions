/**
 * RUNTIME — el servicio: adquiere el lock (o termina INMEDIATAMENTE con lock-denied),
 * ejecuta el loop con el orden exacto del contrato, duerme con el sleeper inyectado y se
 * apaga limpiamente. Solo coordina los cuatro módulos congelados de la vigilancia.
 */
import type { WatchEngine } from "@/tournament-watcher";
import type { SchedulerEngine } from "@/tournament-scheduler";
import type { CoordinatorEngine } from "@/tournament-autopipeline";
import type { NotificationHub } from "@/tournament-notifications";
import { healthOf } from "./health";
import { runIteration } from "./loop";
import { runtimeMetrics } from "./metrics";
import { gracefulShutdown } from "./shutdown";
import { createRuntimeState, withError, withIteration, withStatus } from "./state";
import type {
  IterationReport, RuntimeClock, RuntimeConfig, RuntimeHealth, RuntimeLock, RuntimeMetrics,
  RuntimeState, Sleeper, SnapshotSource,
} from "./types";

export interface RuntimeDeps {
  scheduler: SchedulerEngine;
  watcher: WatchEngine;
  coordinator: CoordinatorEngine;
  hub: NotificationHub;
  source: SnapshotSource;
  lock: RuntimeLock;
  clock: RuntimeClock;
  sleeper: Sleeper;
}

export class TournamentRuntime {
  state: RuntimeState = createRuntimeState();
  readonly reports: IterationReport[] = [];
  private stopRequested = false;

  constructor(private config: RuntimeConfig, private deps: RuntimeDeps) {}

  /** Adquiere el lock. false ⇒ OTRO runtime activo (estado controlado lock-denied). */
  start(): boolean {
    if (!this.deps.lock.acquire(this.config.lockKey, this.config.owner)) {
      this.state = withStatus(this.state, "lock-denied", this.deps.clock());
      return false;
    }
    this.state = withStatus(this.state, "running", this.deps.clock());
    return true;
  }

  /** UNA iteración del loop (orden exacto: plan → take → observe → ingest → notify). */
  tick(): IterationReport | null {
    if (this.state.status !== "running" && this.state.status !== "sleeping") return null;
    this.state = withStatus(this.state, "running", this.deps.clock());
    try {
      const report = runIteration({ ...this.deps, watchlist: this.config.watchlist ?? [] }, this.state.iterations + 1);
      this.state = withIteration(this.state, report.at, report.latencies);
      this.reports.push(report);
      return report;
    } catch (e) {
      this.state = withError(this.state, e instanceof Error ? e.message : String(e));
      return null;
    }
  }

  /** Loop principal: iterar → dormir → repetir (acotado; el daemon NO existe todavía). */
  async run(iterations: number): Promise<IterationReport[]> {
    const out: IterationReport[] = [];
    for (let i = 0; i < iterations && !this.stopRequested; i++) {
      const report = this.tick();
      if (report) out.push(report);
      this.state = withStatus(this.state, "sleeping", this.deps.clock());
      await this.deps.sleeper(this.config.sleepMs);
    }
    return out;
  }

  /** Apagado limpio: drena, libera el lock, sella el estado. Historial intacto. */
  stop(): { drainedMessages: number; lockReleased: boolean } {
    this.stopRequested = true;
    const { state, drainedMessages, lockReleased } = gracefulShutdown(
      this.state, this.deps.hub, this.deps.lock, this.config.lockKey, this.config.owner, this.deps.clock,
    );
    this.state = state;
    return { drainedMessages, lockReleased };
  }

  health(): RuntimeHealth {
    return healthOf(this.state, this.deps.lock, this.config.lockKey, this.config.owner, this.deps.clock);
  }

  metrics(): RuntimeMetrics {
    return runtimeMetrics(this.state, this.deps.watcher.registry, this.deps.coordinator.registry, this.deps.hub.registry);
  }
}
