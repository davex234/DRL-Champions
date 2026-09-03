/**
 * ROLLBACK — vuelve un asset a CUALQUIER versión anterior sin tocar ningún otro asset:
 * la versión restaurada se convierte en la vigente (evento "rolled-back" en el historial;
 * jamás se borra nada) y se re-registra en el Artwork Manager.
 */
import type { ArtworkEngine } from "@/artwork";
import { getVersion } from "./versions";
import type { LifecycleState, UpdateMeta } from "./types";

export interface RollbackResult {
  ok: boolean;
  error?: string;
  state: LifecycleState;
}

export function rollbackAsset(
  state: LifecycleState, artwork: ArtworkEngine, assetId: string, toVersion: number, meta: UpdateMeta,
): RollbackResult {
  const entry = state.assets[assetId];
  if (!entry) return { ok: false, error: `asset desconocido: ${assetId}`, state };
  const target = getVersion(entry, toVersion);
  if (!target) return { ok: false, error: `versión inexistente: ${assetId} v${toVersion}`, state };
  if (entry.current === toVersion) return { ok: false, error: `v${toVersion} ya es la vigente`, state };

  const next: LifecycleState = {
    ...state,
    seq: state.seq + 1,
    assets: {
      ...state.assets,
      [assetId]: {
        ...entry,
        status: "active",
        current: toVersion,
        history: [...entry.history, {
          seq: state.seq + 1, at: meta.at, actor: meta.actor, assetId,
          kind: "rolled-back", version: toVersion, reason: meta.reason, provider: target.provider,
        }],
      },
    },
  };
  artwork.register(target.asset);
  return { ok: true, state: next };
}
