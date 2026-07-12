/**
 * ORCHESTRATOR ENGINE — `runTournamentPipeline(url)`: ejecuta las 8 etapas EN ORDEN, mide cada
 * una, y ante un fallo DETIENE el pipeline en el acto (sin continuar, conservando el stack de
 * la causa). No lanza: devuelve siempre un `OrchestratorResult` serializable; el Publisher
 * mantiene su propia transacción/rollback intacta dentro de la etapa 8.
 */
import { resolveCtx } from "./context";
import { emitEnd, emitError, emitStart } from "./events";
import { computeMetrics } from "./metrics";
import { STAGES, type PipelineState } from "./pipeline";
import { PipelineError, type OrchestratorCtx, type OrchestratorResult, type StageTiming } from "./types";

export async function runTournamentPipeline(url: string, ctx: OrchestratorCtx = {}): Promise<OrchestratorResult> {
  const rctx = resolveCtx(ctx);
  const state: PipelineState = { url, outputs: {} };
  const stages: StageTiming[] = [];
  const t0 = rctx.timer();

  for (const stage of STAGES) {
    emitStart(rctx.events, stage.id, stage.label);
    const s0 = rctx.timer();
    try {
      await stage.run(state, rctx);
    } catch (e) {
      stages.push({ stage: stage.id, ms: rctx.timer() - s0 });
      const err = e instanceof PipelineError
        ? e
        : new PipelineError(stage.id, e instanceof Error ? e.message : String(e), e);
      emitError(rctx.events, stage.id, err);
      return {
        ok: false,
        url,
        ref: state.outputs.vlr?.ref,
        tournamentName: state.outputs.vlr?.snapshot.tournament.name,
        outputs: state.outputs,
        metrics: computeMetrics(state.outputs, stages, rctx.timer() - t0),
        failedStage: err.stage,
        error: { stage: err.stage, message: err.message, stack: err.stack },
      };
    }
    stages.push({ stage: stage.id, ms: rctx.timer() - s0 });
    emitEnd(rctx.events, stage.id, stages[stages.length - 1].ms, state.outputs);
  }

  return {
    ok: true,
    url,
    ref: state.outputs.vlr?.ref,
    tournamentName: state.outputs.vlr?.snapshot.tournament.name,
    outputs: state.outputs,
    metrics: computeMetrics(state.outputs, stages, rctx.timer() - t0),
  };
}
