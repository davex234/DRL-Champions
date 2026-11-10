/**
 * SEARCH APPLIER (Fase 7) — publica el índice de búsqueda del artefacto F6 (sustitución
 * completa: el índice ya viene ordenado y cacheable; el fingerprint decide si tocaba).
 */
import type { SearchArtifact } from "@/catalog-builder";
import { internal } from "./runtime";

export function applySearchRuntime(search: SearchArtifact): number {
  internal.state().search = { rows: [...search.rows] };
  return search.rows.length;
}
