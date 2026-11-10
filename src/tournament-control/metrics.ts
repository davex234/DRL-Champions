/**
 * METRICS — agregado de solo-lectura sobre las métricas OFICIALES de cada run (computeMetrics
 * del Orchestrator, nunca recalculadas): tiempos total/por etapa, volúmenes (equipos/jugadores/
 * mapas/cartas), materializaciones, publicaciones y rollbacks. También el informe exportable.
 */
import { stateCounts, type EditorialState } from "@/editorial";
import { TOURNAMENT_CONTROL_SCHEMA_VERSION, type ControlLedger, type ControlMetrics, type ControlReport, type RuntimeInfo } from "./types";
import { dashboardRow } from "./dashboard";
import { buildHistory } from "./history";

const emptyEditorial = (): Record<EditorialState, number> =>
  ({ draft: 0, review: 0, approved: 0, published: 0, archived: 0, rejected: 0, hidden: 0, blocked: 0 });

/** Métricas agregadas del panel. Los duplicados `~R<n>` no doblan volúmenes de pipeline. */
export function buildMetrics(l: ControlLedger): ControlMetrics {
  const roots = l.order.map((id) => l.records[id]).filter((r) => !r.revisionOf);
  const stages = new Map<string, number>();
  let totalMs = 0, teams = 0, players = 0, matches = 0, maps = 0;
  let cardsGenerated = 0, cardsMaterialized = 0, cardsPublished = 0;

  for (const r of roots) {
    const m = r.metrics;
    totalMs += m.totalMs;
    teams += m.teams; players += m.players; matches += m.matches; maps += m.maps;
    cardsGenerated += m.cardsGenerated;
    cardsMaterialized += m.cardsMaterialized;
    cardsPublished += m.cardsPublished;
    for (const s of m.stages) stages.set(s.stage, (stages.get(s.stage) ?? 0) + s.ms);
  }

  const editorial = emptyEditorial();
  for (const id of l.order) {
    const c = l.records[id].editorial;
    if (!c) continue;
    const counts = stateCounts(c);
    for (const k of Object.keys(counts) as EditorialState[]) editorial[k] += counts[k];
  }

  return {
    records: l.order.length,
    tournaments: new Set(roots.map((r) => r.tournamentId)).size,
    totalMs,
    stages: [...stages.entries()].map(([stage, ms]) => ({ stage, ms })),
    teams, players, matches, maps,
    cardsGenerated, cardsMaterialized, cardsPublished,
    publications: l.events.filter((e) => e.kind === "publish").length,
    rollbacks: l.events.filter((e) => e.kind === "rollback").length,
    editorial,
  };
}

/** Informe exportable de un registro: fila de panel + métricas + editorial + historial. */
export function buildReport(l: ControlLedger, recordId: string, rt: RuntimeInfo, at: number): ControlReport | null {
  const row = dashboardRow(l, recordId, rt);
  if (!row) return null;
  const rec = l.records[recordId];
  return {
    schemaVersion: TOURNAMENT_CONTROL_SCHEMA_VERSION,
    generatedAt: at,
    row,
    metrics: rec.metrics,
    editorial: rec.editorial ? stateCounts(rec.editorial) : null,
    history: buildHistory(l, recordId),
  };
}
