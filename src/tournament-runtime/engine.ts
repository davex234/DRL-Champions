/**
 * RUNTIME FACTORY — ensambla el servicio con los CUATRO módulos congelados (instancias
 * nuevas o registries rehidratados para reinicios limpios) y las dependencias inyectadas
 * (fuente de snapshots, lock, reloj, sleeper). Nada de motores de negocio.
 */
import { WatchEngine, type WatcherRegistry } from "@/tournament-watcher";
import { SchedulerEngine, type SchedulerRegistry } from "@/tournament-scheduler";
import { CoordinatorEngine, type CoordinatorRegistry } from "@/tournament-autopipeline";
import {
  NotificationHub, ConsoleChannel, TelegramChannelAdapter, DiscordChannelAdapter,
  type HubRegistry, type NotificationChannel,
} from "@/tournament-notifications";
import { InMemoryLock } from "./lock";
import { TournamentRuntime, type RuntimeDeps } from "./runtime";
import type { RuntimeClock, RuntimeConfig, RuntimeLock, Sleeper, SnapshotSource } from "./types";

export interface CreateRuntimeOptions {
  config: RuntimeConfig;
  source: SnapshotSource;
  clock: RuntimeClock;
  sleeper?: Sleeper;
  lock?: RuntimeLock;
  channels?: NotificationChannel[];
  /** Registries previos (reinicio limpio SIN perder historial). */
  resume?: {
    watcher?: WatcherRegistry;
    scheduler?: SchedulerRegistry;
    coordinator?: CoordinatorRegistry;
    hub?: HubRegistry;
  };
}

export interface AssembledRuntime {
  runtime: TournamentRuntime;
  deps: RuntimeDeps;
  adapters: { console: ConsoleChannel; telegram: TelegramChannelAdapter };
}

export function createTournamentRuntime(opts: CreateRuntimeOptions): AssembledRuntime {
  const consoleCh = new ConsoleChannel(() => { /* sink silencioso por defecto */ });
  const telegram = new TelegramChannelAdapter(() => 0);
  const channels = opts.channels ?? [consoleCh, telegram, new DiscordChannelAdapter()];

  const deps: RuntimeDeps = {
    watcher: new WatchEngine(opts.resume?.watcher),
    scheduler: new SchedulerEngine(opts.clock, opts.resume?.scheduler),
    coordinator: new CoordinatorEngine(opts.clock, opts.resume?.coordinator),
    hub: new NotificationHub(opts.clock, channels, opts.resume?.hub),
    source: opts.source,
    lock: opts.lock ?? new InMemoryLock(),
    clock: opts.clock,
    sleeper: opts.sleeper ?? (async () => { /* sin espera por defecto */ }),
  };
  return { runtime: new TournamentRuntime(opts.config, deps), deps, adapters: { console: consoleCh, telegram } };
}
