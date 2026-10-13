/**
 * PACKS APPLIER (Fase 7) — refresco de pools: con los engines ya recreados sobre el catálogo
 * nuevo, verifica que cada pool afectado del artefacto coincide con el pool REAL
 * (`buildPool` del motor de sobres reutilizado — nunca se recalcula a mano).
 */
import { buildPool } from "@/domain/packs/pool";
import { getPack } from "@/data/packs";
import type { PacksArtifact } from "@/catalog-builder";
import type { RuntimeValidationIssue } from "./types";
import { runtimeRegistry } from "./runtime";
import { ns } from "@/i18n/runtime";

const t = ns("publisher");

export function applyPacksRuntime(packs: PacksArtifact): { refreshed: number; issues: RuntimeValidationIssue[] } {
  const issues: RuntimeValidationIssue[] = [];
  const registry = runtimeRegistry(); // engines vigentes (ya recreados por el catálogo nuevo)
  let refreshed = 0;
  for (const pool of packs.pools) {
    const pack = getPack(pool.packId);
    if (!pack) { issues.push({ severity: "error", section: "packs", message: `pack desconocido: ${pool.packId}` }); continue; }
    const built = buildPool(registry, pack);
    if (built.size !== pool.size) {
      issues.push({ severity: "error", section: "packs", message: `pool ${pool.packId}: runtime ${built.size} ≠ build ${pool.size}` });
      continue;
    }
    for (const id of pool.added) {
      if (!built.flat.some((c) => c.id === id)) {
        issues.push({ severity: "error", section: "packs", message: t("alta {id} ausente del pool runtime de {packId}", { id, packId: pool.packId }) });
      }
    }
    refreshed++;
  }
  return { refreshed, issues };
}
