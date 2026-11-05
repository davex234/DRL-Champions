/**
 * LIFECYCLE ENGINE — el pipeline oficial de la fase:
 *
 *   registry actual → fingerprints → comparar → diff → actualizar SOLO lo necesario →
 *   invalidar cache (quirúrgica) → registrar nueva versión → Artwork Manager
 *
 * Estado serializable (persistible entre pasadas); reloj lógico inyectado; jamás genera
 * cartas, jamás renderiza, jamás descarga: la ENTRADA son assets ya adquiridos/registrados.
 */
import type { ArtworkEngine, ArtworkRefs } from "@/artwork";
import { invalidationOf } from "./cache";
import { diffStates } from "./diff";
import { computeLifecycleMetrics } from "./metrics";
import { rollbackAsset, type RollbackResult } from "./rollback";
import { applyDiff } from "./update";
import {
  UPDATER_SCHEMA_VERSION,
  type IncomingAsset, type LifecycleMetrics, type LifecycleState, type UpdateMeta, type UpdateResult,
} from "./types";

export function createLifecycleState(): LifecycleState {
  return { schemaVersion: UPDATER_SCHEMA_VERSION, assets: {}, seq: 0 };
}

export class AssetLifecycleEngine {
  private lastResult?: UpdateResult;

  constructor(
    private artwork: ArtworkEngine,
    public state: LifecycleState = createLifecycleState(),
  ) {}

  /** Sincroniza el estado con un snapshot entrante. Actualiza SOLO lo necesario. */
  sync(incoming: IncomingAsset[], meta: UpdateMeta, refs?: ArtworkRefs): UpdateResult {
    const diff = diffStates(this.state, incoming, refs);
    const invalidated = invalidationOf(diff, this.state, incoming);
    const { state, newVersions } = applyDiff(this.state, diff, incoming, this.artwork, meta);
    this.state = state;
    this.lastResult = { diff, invalidated, newVersions };
    return this.lastResult;
  }

  /** Rollback de UN asset a una versión anterior (el resto del registry no se toca). */
  rollback(assetId: string, toVersion: number, meta: UpdateMeta): RollbackResult {
    const r = rollbackAsset(this.state, this.artwork, assetId, toVersion, meta);
    if (r.ok) this.state = r.state;
    return r;
  }

  metrics(): LifecycleMetrics {
    return computeLifecycleMetrics(this.state, this.lastResult);
  }
}
