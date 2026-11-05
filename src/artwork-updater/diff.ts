/**
 * DIFF — comparación exacta entre el estado versionado y un snapshot entrante: nuevos ·
 * modificados (contenido/nombre/proveedor/alias/licencia/hash) · eliminados · obsoletos
 * (sin referencias vivas) · reutilizables (cache intacta) · sin cambios. Determinista.
 */
import type { ArtworkRefs } from "@/artwork";
import { contentChecksum } from "./fingerprint";
import { currentVersion } from "./versions";
import type { AssetDiff, IncomingAsset, LifecycleState, ModifiedAsset } from "./types";

const sameSet = (a: string[], b: string[]): boolean =>
  a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|");

/** Cambios entre la versión vigente y el asset entrante (vacío = sin cambios). */
export function changesOf(prev: { checksum: string; provider?: string; license?: string; asset: { name: string; aliases: string[]; hash: string } }, next: IncomingAsset): ModifiedAsset["changes"] {
  const changes: ModifiedAsset["changes"] = [];
  if (contentChecksum(next) !== prev.checksum) changes.push("content-changed");
  if (next.asset.name !== prev.asset.name) changes.push("renamed");
  if ((next.provider ?? prev.provider) !== prev.provider) changes.push("provider-changed");
  if (!sameSet(next.asset.aliases, prev.asset.aliases)) changes.push("alias-changed");
  if ((next.license ?? prev.license) !== prev.license) changes.push("license-changed");
  if (next.asset.hash !== prev.asset.hash) changes.push("hash-changed");
  return changes;
}

/**
 * Diff completo. `refs` (opcional) marca OBSOLETOS: assets activos cuyo sujeto ya no está
 * referenciado por el juego (jamás se eliminan solos: solo se señalan).
 */
export function diffStates(state: LifecycleState, incoming: IncomingAsset[], refs?: ArtworkRefs): AssetDiff {
  const byId = new Map(incoming.map((i) => [i.asset.id, i]));
  const added: string[] = [];
  const modified: ModifiedAsset[] = [];
  const unchanged: string[] = [];

  for (const inc of incoming) {
    const prev = state.assets[inc.asset.id];
    if (!prev || prev.status === "removed") { added.push(inc.asset.id); continue; }
    const changes = changesOf(currentVersion(prev), inc);
    if (changes.length) modified.push({ assetId: inc.asset.id, changes });
    else unchanged.push(inc.asset.id);
  }

  const removed = Object.keys(state.assets)
    .filter((id) => state.assets[id].status === "active" && !byId.has(id))
    .sort();

  const referenced = refs ? new Set([
    ...refs.players.map((s) => `player:${s}`),
    ...refs.teams.map((s) => `team:${s}`),
    ...refs.countries.map((s) => `country:${s}`),
    ...refs.tournaments.map((s) => `tournament-logo:${s}`),
    ...refs.collections.map((s) => `collection:${s}`),
    ...refs.badges.map((s) => `badge:${s}`),
  ]) : null;
  const obsolete = referenced
    ? incoming.map((i) => i.asset.id).filter((id) => {
        const a = byId.get(id)!.asset;
        return !!a.subjectId && !referenced.has(id);
      }).sort()
    : [];

  return {
    added: added.sort(),
    modified: modified.sort((a, b) => (a.assetId < b.assetId ? -1 : 1)),
    removed,
    obsolete,
    reusable: [...unchanged].sort(),
    unchanged: [...unchanged].sort(),
  };
}
