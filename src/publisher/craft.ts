/**
 * CRAFT APPLIER (Fase 7) — verifica que el Craft Engine vigente opera sobre el catálogo nuevo:
 * cada ruta de upgrade/evolución del artefacto debe ser resoluble en el registry vigente
 * (misma identidad que el Pack Engine — sin referencias antiguas).
 */
import type { CraftArtifact } from "@/catalog-builder";
import type { RuntimeValidationIssue } from "./types";
import { runtimeRegistry } from "./runtime";
import { ns, td } from "@/i18n/runtime";

const t = ns("publisher");

export function applyCraftRuntime(craft: CraftArtifact): { linked: number; issues: RuntimeValidationIssue[] } {
  const issues: RuntimeValidationIssue[] = [];
  const registry = runtimeRegistry();
  for (const p of [...craft.upgradeGraph, ...craft.evolutionGraph]) {
    if (!registry.card(p.from) || !registry.card(p.to)) {
      issues.push({ severity: "error", section: "craft", message: t("ruta {from}→{to} irresoluble en el runtime", { from: td(p.from), to: td(p.to) }) });
    }
  }
  for (const l of craft.links) {
    if (!registry.card(l.cardId)) issues.push({ severity: "error", section: "craft", message: t("enlace de carta ausente: {cardId}", { cardId: l.cardId }) });
  }
  return { linked: craft.links.length, issues };
}
