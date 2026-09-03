/**
 * COORDINATOR ENGINE — fachada del Auto Pipeline Coordinator: ingesta de WatchEvents con
 * la política inyectada y gestión de la cola de PipelineRequests. AQUÍ NO SE EJECUTA NADA:
 * quien consuma las peticiones (Tournament Control decidirá cómo, en fases futuras) hará
 * las ejecuciones e informará de vuelta.
 */
import type { WatchEvent } from "@/tournament-watcher";
import { auditCoordinator } from "./history";
import { coordinatorMetrics } from "./metrics";
import { createCoordinatorRegistry, ingestEvents } from "./planner";
import { DEFAULT_DECISION_POLICY } from "./policy";
import { cancelRequest, markExecuted, markPlanned, pendingRequests } from "./queue";
import type {
  CoordinatorClock, CoordinatorMetrics, CoordinatorRegistry, DecisionPolicy, IngestResult,
  PipelineRequest,
} from "./types";

export class CoordinatorEngine {
  constructor(
    private clock: CoordinatorClock,
    public registry: CoordinatorRegistry = createCoordinatorRegistry(),
    private policy: DecisionPolicy = DEFAULT_DECISION_POLICY,
  ) {}

  /** Ingesta de eventos del Watcher → peticiones (creadas o fusionadas). */
  ingest(events: WatchEvent[]): IngestResult {
    const { registry, result } = ingestEvents(this.registry, events, this.policy, this.clock);
    this.registry = registry;
    return result;
  }

  /** Peticiones pendientes (el PLAN a consumir por el ejecutor externo). */
  plan(): PipelineRequest[] { return pendingRequests(this.registry); }

  markPlanned(id: string): void { this.registry = markPlanned(this.registry, id, this.clock); }
  markExecuted(id: string): void { this.registry = markExecuted(this.registry, id, this.clock); }
  cancel(id: string, reason?: string): void { this.registry = cancelRequest(this.registry, id, this.clock, reason); }

  metrics(): CoordinatorMetrics { return coordinatorMetrics(this.registry); }
  audit(): string[] { return auditCoordinator(this.registry); }
}
