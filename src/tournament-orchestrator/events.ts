/**
 * EVENTOS — emisión SEGURA de progreso: un observador que lanza jamás rompe el pipeline
 * (los eventos son informativos; el resultado canónico es el `OrchestratorResult`).
 */
import type { OrchestratorEvents, PipelineError, PipelineOutputs, StageId } from "./types";

export function emitStart(ev: OrchestratorEvents, stage: StageId, label: string): void {
  try { ev.onStageStart?.(stage, label); } catch { /* observador roto: ignorar */ }
}

export function emitEnd(ev: OrchestratorEvents, stage: StageId, ms: number, outputs: Readonly<Partial<PipelineOutputs>>): void {
  try { ev.onStageEnd?.(stage, ms, outputs); } catch { /* observador roto: ignorar */ }
}

export function emitError(ev: OrchestratorEvents, stage: StageId, error: PipelineError): void {
  try { ev.onStageError?.(stage, error); } catch { /* observador roto: ignorar */ }
}
