/**
 * ROLLBACK ENGINE (Fase 7) — vuelve EXACTAMENTE a una publicación anterior localizada por
 * CatalogFingerprint o GenerationId en el historial de instantáneas. Nunca reconstruye a
 * mano: restaura la instantánea por la MISMA ruta de aplicación (rebuildCatalog + appliers),
 * con transacción y bump de RuntimeVersion.
 */
import type { PublishCtx, PublishResult, PublishTransaction, RollbackTarget, RuntimeSnapshot, RuntimeValidation, RuntimeValidationIssue, TransactionState } from "./types";
import { PUBLISHER_SCHEMA_VERSION } from "./types";
import { totalCards } from "@/data/catalog";
import { internal, runtimeSnapshots, runtimePackEngine, runtimeRegistry } from "./runtime";
import { applyCatalogRuntime } from "./catalog";
import { ns } from "@/i18n/runtime";

const t = ns("publisher");

/** Validación tras un rollback (el runtime coincide con la instantánea restaurada). */
export function validateRestored(s: RuntimeSnapshot): RuntimeValidation {
  const issues: RuntimeValidationIssue[] = [];
  if (totalCards() !== s.cards.length) issues.push({ severity: "error", section: "rollback", message: t("catálogo {v} ≠ instantánea {length}", { v: totalCards(), length: s.cards.length }) });
  if (runtimePackEngine().registry !== runtimeRegistry()) issues.push({ severity: "error", section: "rollback", message: t("engines sin recrear tras rollback") });
  return { ok: !issues.some((i) => i.severity === "error"), issues };
}

export function findSnapshot(target: RollbackTarget): RuntimeSnapshot | undefined {
  const snaps = runtimeSnapshots();
  if ("generationId" in target) {
    for (let i = snaps.length - 1; i >= 0; i--) if (snaps[i].generationId === target.generationId) return snaps[i];
  } else {
    for (let i = snaps.length - 1; i >= 0; i--) if (snaps[i].catalogFingerprint === target.catalogFingerprint) return snaps[i];
  }
  return undefined;
}

/** Restaura una instantánea completa (catálogo vivo + secciones del runtime). */
export function restoreSnapshot(s: RuntimeSnapshot, persist?: (players: RuntimeSnapshot["players"]) => void): void {
  applyCatalogRuntime(s.players, persist);
  const state = internal.state();
  state.collections = [...s.collections];
  state.search = { rows: [...s.search.rows] };
  state.marketEntries = new Map(s.marketEntries.map((e) => [e.cardId, e]));
  state.news = [...s.news];
  internal.setPublished({ catalogVersion: s.catalogVersion, catalogFingerprint: s.catalogFingerprint, generationId: s.generationId });
}

export function rollback(target: RollbackTarget, ctx: PublishCtx = {}): PublishResult {
  const now = ctx.now ?? 0;
  const states: PublishTransaction["states"] = [{ state: "PREPARING", at: now }];
  const finish = (finalState: TransactionState, ok: boolean, snapshot?: RuntimeSnapshot, durationMs = 0): PublishResult => {
    const tx: PublishTransaction = {
      id: `tx:rollback:${snapshot?.generationId ?? "unknown"}:${internal.state().runtimeVersion}`,
      kind: "rollback",
      generationId: snapshot?.generationId ?? "",
      states: [...states, { state: finalState, at: now }],
      finalState,
    };
    return {
      schemaVersion: PUBLISHER_SCHEMA_VERSION,
      ok, applied: ok,
      transaction: tx,
      runtimeVersion: internal.state().runtimeVersion,
      catalogVersion: internal.state().catalogVersion,
      catalogFingerprint: internal.state().catalogFingerprint,
      generationId: internal.state().generationId,
      validation: ok ? validateRestored(snapshot!) : { ok: false, issues: [{ severity: "error", section: "rollback", message: t("instantánea no encontrada") }] },
      metrics: {
        durationMs, newCards: 0, updatedCards: 0,
        retiredCards: 0, catalogFingerprint: internal.state().catalogFingerprint,
        materializationFingerprints: 0, sectionHashes: 0,
        runtimeVersion: internal.state().runtimeVersion, poolsRefreshed: 0, newsPublished: 0,
      },
    };
  };

  const snapshot = findSnapshot(target);
  if (!snapshot) return finish("FAILED", false);

  states.push({ state: "VALIDATING", at: now }, { state: "PUBLISHING", at: now });
  const t0 = process.hrtime.bigint();
  restoreSnapshot(snapshot, ctx.persist);
  internal.bumpVersion();
  const durationMs = Number(process.hrtime.bigint() - t0) / 1e6;
  return finish("ROLLED_BACK", true, snapshot, durationMs);
}
