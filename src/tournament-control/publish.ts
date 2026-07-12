/**
 * PUBLISH — publicación y rollback desde el panel. La publicación pasa EXCLUSIVAMENTE por
 * `publishApproved` (Editorial F4: solo cartas aprobadas, jamás automática) y el rollback por
 * `rollback` del Publisher (restauración exacta por GenerationId). El panel solo registra el
 * resultado; no valida, no filtra y no toca el catálogo por su cuenta.
 */
import { publishApproved, type PublishApprovedCtx, type PublishApprovedResult } from "@/editorial";
import { rollback, type PublishResult } from "@/publisher";
import type { Player } from "@/domain/cards/types";
import type { ControlActionMeta, ControlActionResult, ControlLedger, GenerationRecord } from "./types";

/** Reutiliza la puerta de escritura del engine sin duplicarla. */
import { appendToLedger } from "./internal";

/** Publica SOLO las cartas aprobadas del registro (única vía de publicación del panel). */
export async function publishRecord(
  l: ControlLedger, recordId: string, ctx: PublishApprovedCtx,
): Promise<ControlActionResult<PublishApprovedResult>> {
  const rec = l.records[recordId];
  if (!rec) return { ledger: l, error: `registro desconocido: ${recordId}` };
  if (!rec.editorial) return { ledger: l, error: `la revisión de ${recordId} no está abierta: la publicación solo pasa por publishApproved` };

  const r = await publishApproved(rec.editorial, ctx);
  if (!r.ok || !r.publish) return { ledger: l, error: r.error ?? "publicación no aplicada" };

  const next: GenerationRecord = {
    ...rec,
    editorial: r.case,
    // Proyección de las salidas REALES de los motores (nunca recalculado por el panel).
    metrics: {
      ...rec.metrics,
      cardsMaterialized: r.materialization?.cards.length ?? rec.metrics.cardsMaterialized,
      cardsUnchanged: r.materialization?.unchanged.length ?? rec.metrics.cardsUnchanged,
      cardsPublished: r.publish.metrics.newCards + r.publish.metrics.updatedCards,
      catalogVersion: r.build?.catalogVersion ?? rec.metrics.catalogVersion,
      catalogFingerprint: r.build?.catalogFingerprint ?? rec.metrics.catalogFingerprint,
      runtimeVersion: r.publish.runtimeVersion,
    },
  };
  const detail = `publishApproved: runtime v${r.publish.runtimeVersion} · ${r.published.length} aprobada(s)` +
    (r.excluded.length ? ` · ${r.excluded.length} excluida(s)` : "");
  return {
    ledger: appendToLedger(l, next, "publish", { actor: ctx.actor, at: ctx.at }, detail),
    value: r,
  };
}

export interface RollbackCtx extends ControlActionMeta {
  persist?: (players: Player[]) => void;
}

/** Rollback exacto de la generación del registro (Publisher: restauración por GenerationId). */
export function rollbackRecord(
  l: ControlLedger, recordId: string, ctx: RollbackCtx,
): ControlActionResult<PublishResult> {
  const rec = l.records[recordId];
  if (!rec) return { ledger: l, error: `registro desconocido: ${recordId}` };

  const r = rollback({ generationId: rec.generationId }, { now: ctx.at, persist: ctx.persist });
  if (!r.ok) return { ledger: l, error: `rollback ${r.transaction.finalState}` };

  return {
    ledger: appendToLedger(l, rec, "rollback", ctx, `restaurado a runtime v${r.runtimeVersion} (pre-${rec.generationId})`),
    value: r,
  };
}
