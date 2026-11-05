/**
 * UPDATE — aplica un diff al estado versionado ACTUALIZANDO SOLO LO NECESARIO: nuevos ⇒ v1,
 * modificados ⇒ versión nueva (todas las anteriores se conservan), eliminados ⇒ status
 * removed (historial y versiones INTACTOS), sin cambios ⇒ ni se tocan. Inmutable: devuelve
 * un estado NUEVO y registra los assets vigentes en el Artwork Manager.
 */
import type { ArtworkEngine } from "@/artwork";
import { makeVersion } from "./versions";
import type {
  AssetDiff, ChangeEvent, ChangeKind, IncomingAsset, LifecycleState, UpdateMeta, VersionedAsset,
} from "./types";

const event = (
  seq: number, meta: UpdateMeta, assetId: string, kind: ChangeKind, version: number, provider?: string,
): ChangeEvent => ({ seq, at: meta.at, actor: meta.actor, assetId, kind, version, reason: meta.reason, provider });

/** Aplica el diff (estado nuevo + registro en el Manager). Jamás pierde versiones/historial. */
export function applyDiff(
  state: LifecycleState, diff: AssetDiff, incoming: IncomingAsset[], artwork: ArtworkEngine, meta: UpdateMeta,
): { state: LifecycleState; newVersions: number } {
  const byId = new Map(incoming.map((i) => [i.asset.id, i]));
  const assets = { ...state.assets };
  let seq = state.seq;
  let newVersions = 0;

  for (const id of diff.added) {
    const inc = byId.get(id)!;
    const prev = assets[id];
    const version = prev ? prev.versions.length + 1 : 1;
    const v = makeVersion(inc, version, meta.at);
    assets[id] = {
      assetId: id,
      status: "active",
      current: version,
      versions: [...(prev?.versions ?? []), v],
      history: [...(prev?.history ?? []), event(++seq, meta, id, "added", version, inc.provider)],
    };
    artwork.register(inc.asset);
    newVersions++;
  }

  for (const m of diff.modified) {
    const inc = byId.get(m.assetId)!;
    const prev = assets[m.assetId];
    const version = prev.versions.length + 1;
    const v = makeVersion(inc, version, meta.at);
    const history = [...prev.history];
    for (const kind of m.changes) history.push(event(++seq, meta, m.assetId, kind, version, inc.provider));
    assets[m.assetId] = { ...prev, status: "active", current: version, versions: [...prev.versions, v], history };
    artwork.register(inc.asset);
    newVersions++;
  }

  for (const id of diff.removed) {
    const prev = assets[id];
    assets[id] = {
      ...prev,
      status: "removed",
      history: [...prev.history, event(++seq, meta, id, "removed", prev.current)],
    };
  }

  const obsoleteSet = new Set(diff.obsolete);
  for (const id of diff.obsolete) {
    const prev = assets[id];
    if (prev && prev.status === "active") assets[id] = { ...prev, status: "obsolete" };
  }
  // Un obsoleto que vuelve a estar referenciado y sin cambios recupera su estado activo.
  for (const id of diff.unchanged) {
    const prev = assets[id];
    if (prev && prev.status === "obsolete" && !obsoleteSet.has(id)) assets[id] = { ...prev, status: "active" };
  }

  return { state: { ...state, assets, seq }, newVersions };
}
