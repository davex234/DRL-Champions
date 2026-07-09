/**
 * COLLECTIONS APPLIER (Fase 7) — publica las colecciones del artefacto F6 en el runtime
 * (sustitución por id, orden determinista). No toca stores: el runtime del publisher es la
 * fuente que la app consultará.
 */
import type { CollectionDef } from "@/domain/collections/types";
import { internal } from "./runtime";

export function applyCollectionsRuntime(collections: CollectionDef[]): number {
  const state = internal.state();
  const byId = new Map(state.collections.map((c) => [c.id, c]));
  for (const c of collections) byId.set(c.id, c);
  state.collections = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  return state.collections.length;
}
