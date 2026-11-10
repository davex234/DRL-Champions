/**
 * MÉTRICAS — proyección de solo-lectura sobre las salidas del pipeline: tiempos por etapa,
 * volúmenes del modelo canónico, cartas generadas/materializadas/publicadas e identificadores
 * (GenerationId · CatalogVersion · CatalogFingerprint · RuntimeVersion). No calcula dominio.
 */
import type { OrchestratorMetrics, PipelineOutputs, StageTiming } from "./types";

export function computeMetrics(
  outputs: Partial<PipelineOutputs>,
  stages: StageTiming[],
  totalMs: number,
): OrchestratorMetrics {
  const model = outputs.importResult?.model;
  const pub = outputs.publish;
  return {
    stages,
    totalMs,
    teams: model?.teams.length ?? 0,
    players: model?.players.length ?? 0,
    matches: model?.matches.length ?? 0,
    maps: model?.maps.length ?? 0,
    cardsGenerated: outputs.generation?.cards.length ?? 0,
    cardsMaterialized: outputs.materialization?.cards.length ?? 0,
    cardsUnchanged: outputs.materialization?.unchanged.length ?? 0,
    cardsPublished: pub ? pub.metrics.newCards + pub.metrics.updatedCards : 0,
    generationId: outputs.generation?.generationId ?? "",
    catalogVersion: outputs.build?.catalogVersion ?? "",
    catalogFingerprint: outputs.build?.catalogFingerprint ?? "",
    runtimeVersion: pub?.runtimeVersion ?? 0,
  };
}
