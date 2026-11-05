/**
 * DASHBOARD — proyección pura del ledger a filas de panel: torneo · generationId · fecha ·
 * estado · nº de cartas · aprobadas/pendientes/bloqueadas/rechazadas/publicadas · runtime y
 * catálogo. El estado del registro se DERIVA (editorial + eventos), nunca se almacena.
 */
import { stateCounts } from "@/editorial";
import { runtimeVersion, runtimeGenerationId } from "@/publisher";
import type {
  ControlLedger, DashboardRow, GenerationRecord, RecordStatus, RuntimeInfo,
} from "./types";

/** Info del runtime vigente vía accesores oficiales del Publisher (para inyectar al dashboard). */
export const currentRuntimeInfo = (): RuntimeInfo => ({
  runtimeVersion: runtimeVersion(),
  generationId: runtimeGenerationId(),
});

/**
 * Estado derivado del registro. El rollback del Publisher es de PUNTO DE RESTAURACIÓN
 * (restaura el runtime A una publicación), así que un registro publicado está "published"
 * mientras siga vigente (live) o nada lo haya revertido; si un rollback posterior a su
 * publicación devolvió el runtime a otro punto, queda "rolled-back".
 */
export function recordStatus(l: ControlLedger, rec: GenerationRecord, rt: RuntimeInfo): RecordStatus {
  const counts = rec.editorial ? stateCounts(rec.editorial) : null;
  let lastPublishSeq = -1;
  let lastRollbackSeq = -1;
  for (const e of l.events) {
    if (e.kind === "rollback") lastRollbackSeq = e.seq;
    if (e.kind === "publish" && e.recordId === rec.recordId) lastPublishSeq = e.seq;
  }
  if (counts && rec.generation.cards.length > 0 && counts.archived === rec.generation.cards.length) return "archived";
  const published = lastPublishSeq >= 0 || (counts?.published ?? 0) > 0;
  if (published) {
    const live = rt.generationId === rec.generationId && rec.generationId.length > 0;
    if (live) return "published";
    return lastRollbackSeq > lastPublishSeq ? "rolled-back" : "published";
  }
  if (counts) {
    const pending = counts.draft + counts.review;
    if (pending === 0 && counts.approved > 0) return "approved";
    return "in-review";
  }
  return "generated";
}

function toRow(l: ControlLedger, rec: GenerationRecord, rt: RuntimeInfo): DashboardRow {
  const counts = rec.editorial ? stateCounts(rec.editorial) : null;
  const status = recordStatus(l, rec, rt);
  return {
    recordId: rec.recordId,
    tournamentId: rec.tournamentId,
    tournamentName: rec.tournamentName,
    generationId: rec.generationId,
    season: rec.season,
    date: rec.importedAt,
    status,
    cards: rec.generation.cards.length,
    approved: counts?.approved ?? 0,
    pending: counts ? counts.draft + counts.review : 0,
    blocked: counts?.blocked ?? 0,
    rejected: counts?.rejected ?? 0,
    hidden: counts?.hidden ?? 0,
    published: counts?.published ?? (status === "published" ? rec.metrics.cardsPublished : 0),
    archived: counts?.archived ?? 0,
    runtimeVersion: rt.runtimeVersion,
    catalogVersion: rec.metrics.catalogVersion,
    live: rt.generationId === rec.generationId && rec.generationId.length > 0,
    source: rec.source,
    revisionOf: rec.revisionOf,
  };
}

/** Todas las filas del panel, en orden cronológico de entrada. */
export function buildDashboard(l: ControlLedger, rt: RuntimeInfo): DashboardRow[] {
  return l.order.map((id) => toRow(l, l.records[id], rt));
}

/** Fila de un registro concreto (o undefined si no existe). */
export function dashboardRow(l: ControlLedger, recordId: string, rt: RuntimeInfo): DashboardRow | undefined {
  const rec = l.records[recordId];
  return rec ? toRow(l, rec, rt) : undefined;
}
