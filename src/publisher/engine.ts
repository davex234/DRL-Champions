/**
 * PUBLISHER ENGINE (Fase 7, FINAL) — `publish(build)`: aplica un CatalogBuildResult al runtime
 * con TRANSACCIÓN (PREPARING → VALIDATING → PUBLISHING → COMPLETED | ROLLED_BACK | FAILED):
 * valida la build, invalida caches por huella (idempotencia por CatalogFingerprint), aplica
 * catálogo+secciones, recrea engines (fin del singleton congelado), valida el RUNTIME y, si
 * algo falla a mitad, restaura automáticamente la instantánea previa. Registra métricas y la
 * instantánea publicada (rollback exacto posterior). Aquí TERMINA el Card Generator (7/7).
 */
import { CARDS, totalCards } from "@/data/catalog";
import type { CatalogBuildResult } from "@/catalog-builder";
import {
  PUBLISHER_SCHEMA_VERSION,
  type PublishCtx, type PublishResult, type PublishTransaction,
  type RuntimeValidation, type RuntimeValidationIssue, type TransactionState,
} from "./types";
import {
  internal, captureSnapshot, runtimeRegistry, runtimePackEngine, runtimeCraftEngine,
  runtimeCollections, runtimeSearch, runtimeMarketEntries, runtimeNews, knownGenerationIds,
} from "./runtime";
import { planInvalidation, commitFingerprints } from "./cache";
import { applyCatalogRuntime } from "./catalog";
import { applyCollectionsRuntime } from "./collections";
import { applyPacksRuntime } from "./packs";
import { applyCraftRuntime } from "./craft";
import { applyMarketplaceRuntime } from "./marketplace";
import { applySearchRuntime } from "./search";
import { applyNewsRuntime } from "./news";
import { restoreSnapshot } from "./rollback";

/** Validación del RUNTIME tras aplicar (registry/engines/pools/secciones sin referencias viejas). */
export function validateRuntime(build: CatalogBuildResult): RuntimeValidation {
  const issues: RuntimeValidationIssue[] = [];
  const err = (section: string, message: string): void => { issues.push({ severity: "error", section, message }); };

  const registry = runtimeRegistry();
  if (totalCards() !== build.catalog.cards.length) err("catalog", `catálogo vivo ${totalCards()} ≠ build ${build.catalog.cards.length}`);
  if (registry.total !== build.catalog.cards.length) err("registry", `registry ${registry.total} ≠ build ${build.catalog.cards.length}`);
  for (const id of build.diff.added) if (!registry.has(id)) err("registry", `alta no indexada: ${id}`);

  // Singletones recreados: engines ligados EXACTAMENTE al registry/catálogo vigentes.
  if (runtimePackEngine().registry !== registry) err("engines", "PackEngine apunta a un registry antiguo");
  if (runtimeCraftEngine().registry !== registry) err("engines", "CraftEngine apunta a un registry antiguo");
  if (registry.cards !== CARDS) err("engines", "registry no construido sobre el catálogo vivo vigente");

  if (runtimeSearch().rows.length !== build.search.rows.length) err("search", "índice de búsqueda no publicado");
  const cols = new Set(runtimeCollections().map((c) => c.id));
  for (const c of build.collections.collections) if (!cols.has(c.id)) err("collections", `colección no publicada: ${c.id}`);
  const market = new Set(runtimeMarketEntries().map((e) => e.cardId));
  for (const e of build.marketplace.entries) if (!market.has(e.cardId)) err("marketplace", `entrada no publicada: ${e.cardId}`);
  const newsIds = new Set(runtimeNews().map((n) => n.id));
  for (const n of build.news) if (!newsIds.has(n.id)) err("news", `noticia no publicada: ${n.id}`);

  return { ok: !issues.some((i) => i.severity === "error"), issues };
}

export function publish(build: CatalogBuildResult, ctx: PublishCtx = {}): PublishResult {
  const now = ctx.now ?? 0;
  const states: PublishTransaction["states"] = [{ state: "PREPARING", at: now }];
  const result = (opts: {
    finalState: TransactionState; ok: boolean; applied: boolean;
    validation: RuntimeValidation; durationMs?: number; poolsRefreshed?: number; newsPublished?: number;
    rolledBackTo?: PublishResult["rolledBackTo"];
  }): PublishResult => ({
    schemaVersion: PUBLISHER_SCHEMA_VERSION,
    ok: opts.ok,
    applied: opts.applied,
    transaction: {
      id: `tx:${build.generationId || "noop"}:${internal.state().runtimeVersion}`,
      kind: "publish",
      generationId: build.generationId,
      states: [...states, { state: opts.finalState, at: now }],
      finalState: opts.finalState,
    },
    runtimeVersion: internal.state().runtimeVersion,
    catalogVersion: internal.state().catalogVersion,
    catalogFingerprint: internal.state().catalogFingerprint,
    generationId: internal.state().generationId,
    validation: opts.validation,
    metrics: {
      durationMs: opts.durationMs ?? 0,
      newCards: opts.applied ? build.diff.added.length : 0,
      updatedCards: opts.applied ? build.diff.updated.length : 0,
      retiredCards: opts.applied ? new Set([...build.diff.removed, ...build.diff.retired]).size : 0,
      catalogFingerprint: build.catalogFingerprint,
      materializationFingerprints: build.manifest.materializationFingerprints.length,
      sectionHashes: Object.keys(build.manifest.hashes).length,
      runtimeVersion: internal.state().runtimeVersion,
      poolsRefreshed: opts.poolsRefreshed ?? 0,
      newsPublished: opts.newsPublished ?? 0,
    },
    rolledBackTo: opts.rolledBackTo,
  });

  // ── VALIDATING: build sana + idempotencia por huella ──
  states.push({ state: "VALIDATING", at: now });
  if (build.skipped) return result({ finalState: "COMPLETED", ok: true, applied: false, validation: { ok: true, issues: [] } });
  if (!build.validation.ok) {
    return result({
      finalState: "FAILED", ok: false, applied: false,
      validation: { ok: false, issues: build.validation.issues.map((i) => ({ severity: i.severity, section: `build:${i.section}`, message: i.message })) },
    });
  }
  const plan = planInvalidation(build);
  if (plan.alreadyPublished) return result({ finalState: "COMPLETED", ok: true, applied: false, validation: { ok: true, issues: [] } });

  // ── PUBLISHING: instantánea previa (auto-rollback) + aplicación + refresco ──
  states.push({ state: "PUBLISHING", at: now });
  const before = captureSnapshot();
  const t0 = process.hrtime.bigint();

  applyCatalogRuntime(build.catalog.players, ctx.persist);
  if (plan.refreshCollections) applyCollectionsRuntime(build.collections.collections);
  const packsRes = applyPacksRuntime(build.packs);
  const craftRes = applyCraftRuntime(build.craft);
  if (plan.refreshMarket) applyMarketplaceRuntime(build.marketplace);
  if (plan.refreshSearch || runtimeSearch().rows.length === 0) applySearchRuntime(build.search);
  const newsPublished = plan.refreshNews ? applyNewsRuntime(build.news) : 0;

  const validation = validateRuntime(build);
  const issues = [...packsRes.issues, ...craftRes.issues, ...validation.issues];
  const ok = validation.ok && !issues.some((i) => i.severity === "error");
  const durationMs = Number(process.hrtime.bigint() - t0) / 1e6;

  if (!ok) {
    // Auto-rollback al estado previo por la MISMA ruta de restauración.
    restoreSnapshot(before, ctx.persist);
    return result({
      finalState: "ROLLED_BACK", ok: false, applied: false,
      validation: { ok: false, issues },
      durationMs,
      rolledBackTo: { runtimeVersion: before.runtimeVersion, catalogFingerprint: before.catalogFingerprint },
    });
  }

  // ── COMPLETED: sellar runtime + huellas + instantánea publicada ──
  internal.setPublished({ catalogVersion: build.catalogVersion, catalogFingerprint: build.catalogFingerprint, generationId: build.generationId });
  internal.bumpVersion();
  commitFingerprints(build);
  knownGenerationIds().add(build.generationId);
  internal.pushSnapshot({ ...captureSnapshot(), manifest: build.manifest });

  return result({
    finalState: "COMPLETED", ok: true, applied: true,
    validation: { ok: true, issues },
    durationMs,
    poolsRefreshed: packsRes.refreshed,
    newsPublished,
  });
}
