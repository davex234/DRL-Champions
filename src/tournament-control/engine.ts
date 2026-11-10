/**
 * CONTROL ENGINE — las acciones del panel. Cada una compone EXCLUSIVAMENTE llamadas públicas
 * de los motores terminados y devuelve un ledger NUEVO (inmutable); una acción rechazada
 * devuelve `error` y EL MISMO ledger (cero estados imposibles). Aquí no hay dominio: ni una
 * carta se decide, calcula o publica fuera de los motores.
 *
 *   ingestRun            ← OrchestratorResult (run completo de `tournament:generate`)
 *   generateForReview    ← RawSnapshot → importSnapshot → analyze → generateCards (SIN publicar)
 *   openReview           ← submitGeneration (Editorial F4)
 *   decideRecordCards    ← decide (única puerta editorial)
 *   approveGenerationRecord ← approveGeneration
 *   reopenReview         ← returnToReview sobre todo lo reabrible
 *   duplicateForReview   ← nuevo caso editorial sobre la MISMA generación (jamás regenera)
 */
import type { OrchestratorResult } from "@/tournament-orchestrator";
import { computeMetrics } from "@/tournament-orchestrator";
import {
  importSnapshot, makeClock, createIdentityResolver, buildRegistry,
  type RawSnapshot, type ImportCtx, type IdentityRegistry,
} from "@/importer";
import { analyze, type TournamentFact } from "@/analyzer";
import { generateCards, type GeneratorLedger, type EditorialOverride } from "@/card-generator";
import type { Player } from "@/domain/cards/types";
import {
  submitGeneration, decide, approveGeneration, returnToReview, cardsInState,
  type EditorialAction, type DecisionResult,
} from "@/editorial";
import {
  TOURNAMENT_CONTROL_SCHEMA_VERSION,
  type ControlActionMeta, type ControlActionResult, type ControlEventKind,
  type ControlLedger, type GenerationRecord,
} from "./types";
import { makeEvents, withRecord } from "./internal";
import { ns, td } from "@/i18n/runtime";

const t = ns("tournamentcontrol");

export function createLedger(): ControlLedger {
  return { schemaVersion: TOURNAMENT_CONTROL_SCHEMA_VERSION, records: {}, order: [], events: [] };
}

const reject = <T>(ledger: ControlLedger, error: string): ControlActionResult<T> => ({ ledger, error });

/* ── Registro de un run COMPLETO del Orchestrator ─────────────────────────── */

/** Registra en el panel un `OrchestratorResult` (importación + generación + publicación del run). */
export function ingestRun(l: ControlLedger, run: OrchestratorResult, meta: ControlActionMeta): ControlActionResult<GenerationRecord> {
  const gen = run.outputs.generation;
  if (!gen) return reject(l, t("el run no llegó a generar cartas{v}", { v: run.failedStage ? t(" (falló en {failedStage})", { failedStage: run.failedStage }) : "" }));
  if (l.records[gen.generationId]) return reject(l, t("generación ya registrada: {generationId}", { generationId: gen.generationId }));

  const rec: GenerationRecord = {
    recordId: gen.generationId,
    generationId: gen.generationId,
    tournamentId: gen.tournamentId,
    tournamentName: run.tournamentName ?? gen.tournamentName,
    season: gen.season,
    url: run.url,
    source: "orchestrator",
    importedAt: meta.at,
    metrics: run.metrics,
    generation: gen,
    editorial: null,
  };
  const specs: { kind: ControlEventKind; detail?: string }[] = [
    { kind: "import", detail: run.url },
    { kind: "generate", detail: `${gen.cards.length} cartas` },
  ];
  if (run.outputs.publish?.applied) {
    specs.push({ kind: "publish", detail: t("publicación directa del Orchestrator (runtime v{runtimeVersion})", { runtimeVersion: run.outputs.publish.runtimeVersion }) });
  }
  return { ledger: withRecord(l, rec, makeEvents(l, rec.recordId, rec.generationId, meta, specs)), value: rec };
}

/* ── Generación para revisión (SIN publicar) ──────────────────────────────── */

export interface GenerateForReviewCtx {
  now: number;
  roster: Player[];
  registry?: IdentityRegistry;
  history?: TournamentFact[];
  ledger?: GeneratorLedger;
  overrides?: EditorialOverride[];
  aliases?: Record<string, string>;
  season?: number;
}

/**
 * RawSnapshot → generación registrada en el panel, sin tocar catálogo ni runtime: compone
 * los motores públicos `importSnapshot → analyze → generateCards` (mismas llamadas que el
 * pipeline oficial) y deja la publicación EXCLUSIVAMENTE en manos del circuito editorial.
 */
export function generateForReview(
  l: ControlLedger, snapshot: RawSnapshot, ctx: GenerateForReviewCtx, meta: ControlActionMeta,
): ControlActionResult<GenerationRecord> {
  const ictx: ImportCtx = {
    clock: makeClock(ctx.now),
    identity: createIdentityResolver(ctx.registry ?? buildRegistry([])),
  };
  const importResult = importSnapshot(snapshot, ictx);
  if (!importResult.ok) {
    const errors = importResult.issues.filter((i) => i.severity === "error");
    return reject(l, t("modelo canónico inválido: {length} error(es)", { length: errors.length }));
  }
  const analysis = analyze(importResult.model, ctx.history);
  const gen = generateCards(analysis, {
    roster: ctx.roster, now: ctx.now,
    ledger: ctx.ledger, overrides: ctx.overrides, aliases: ctx.aliases, season: ctx.season,
  });
  if (gen.skipped) return reject(l, t("torneo ya procesado por el ledger del generador: {tournamentId}", { tournamentId: gen.tournamentId }));
  if (l.records[gen.generationId]) return reject(l, t("generación ya registrada: {generationId}", { generationId: gen.generationId }));

  const rec: GenerationRecord = {
    recordId: gen.generationId,
    generationId: gen.generationId,
    tournamentId: gen.tournamentId,
    tournamentName: gen.tournamentName,
    season: gen.season,
    source: "control",
    importedAt: meta.at,
    // Métricas OFICIALES del Orchestrator sobre las salidas reales (sin publicar: runtime v0).
    metrics: computeMetrics({ importResult, analysis, generation: gen }, [], 0),
    generation: gen,
    editorial: null,
  };
  const events = makeEvents(l, rec.recordId, rec.generationId, meta, [
    { kind: "import", detail: snapshot.tournament.name },
    { kind: "generate", detail: t("{length} cartas (sin publicar)", { length: gen.cards.length }) },
  ]);
  return { ledger: withRecord(l, rec, events), value: rec };
}

/* ── Circuito editorial (passthrough del F4) ──────────────────────────────── */

/** Abre la revisión: somete la generación registrada al circuito editorial (F4). */
export function openReview(l: ControlLedger, recordId: string, meta: ControlActionMeta): ControlActionResult<GenerationRecord> {
  const rec = l.records[recordId];
  if (!rec) return reject(l, `registro desconocido: ${recordId}`);
  if (rec.editorial) return reject(l, t("la revisión de {recordId} ya está abierta", { recordId: td(recordId) }));
  const editorial = submitGeneration(rec.generation, { ...meta, tournamentName: rec.tournamentName });
  const next: GenerationRecord = { ...rec, editorial };
  return {
    ledger: withRecord(l, next, makeEvents(l, recordId, rec.generationId, meta, [{ kind: "open-review", detail: t("{length} cartas en review", { length: rec.generation.cards.length }) }])),
    value: next,
  };
}

/** Decisión editorial sobre cartas del registro (aprobar/rechazar/ocultar/bloquear/…). */
export function decideRecordCards(
  l: ControlLedger, recordId: string, cardIds: string[], action: EditorialAction, meta: ControlActionMeta,
): ControlActionResult<DecisionResult> {
  const rec = l.records[recordId];
  if (!rec) return reject(l, `registro desconocido: ${recordId}`);
  if (!rec.editorial) return reject(l, t("la revisión de {recordId} no está abierta", { recordId: td(recordId) }));
  const r = decide(rec.editorial, cardIds, action, meta);
  if (!r.applied.length) return reject(l, r.skipped[0]?.error ?? t("ninguna transición aplicable"));
  const detail = t("{action}: {length} carta(s)", { action, length: r.applied.length }) + (r.skipped.length ? ` · ${r.skipped.length} rechazada(s)` : "");
  return {
    ledger: withRecord(l, { ...rec, editorial: r.case }, makeEvents(l, recordId, rec.generationId, meta, [{ kind: "decision", detail: detail }])),
    value: r,
  };
}

/** Aprueba la generación completa (todas las cartas en review). */
export function approveGenerationRecord(l: ControlLedger, recordId: string, meta: ControlActionMeta): ControlActionResult<DecisionResult> {
  const rec = l.records[recordId];
  if (!rec) return reject(l, `registro desconocido: ${recordId}`);
  if (!rec.editorial) return reject(l, t("la revisión de {recordId} no está abierta", { recordId: td(recordId) }));
  const r = approveGeneration(rec.editorial, meta);
  if (!r.applied.length) return reject(l, t("sin cartas en review que aprobar"));
  return {
    ledger: withRecord(l, { ...rec, editorial: r.case }, makeEvents(l, recordId, rec.generationId, meta, [{ kind: "decision", detail: t("approve-generation: {length} carta(s)", { length: r.applied.length }) }])),
    value: r,
  };
}

/** Reabre la revisión: TODO lo reabrible (approved/rejected/hidden/blocked) vuelve a review. */
export function reopenReview(l: ControlLedger, recordId: string, meta: ControlActionMeta): ControlActionResult<DecisionResult> {
  const rec = l.records[recordId];
  if (!rec) return reject(l, `registro desconocido: ${recordId}`);
  if (!rec.editorial) return reject(l, t("la revisión de {recordId} no está abierta", { recordId: td(recordId) }));
  const reopenable = (["approved", "rejected", "hidden", "blocked"] as const)
    .flatMap((s) => cardsInState(rec.editorial!, s));
  if (!reopenable.length) return reject(l, t("nada que reabrir (ninguna carta en approved/rejected/hidden/blocked)"));
  const r = returnToReview(rec.editorial, reopenable, meta);
  return {
    ledger: withRecord(l, { ...rec, editorial: r.case }, makeEvents(l, recordId, rec.generationId, meta, [{ kind: "reopen-review", detail: t("{length} carta(s) de vuelta a review", { length: r.applied.length }) }])),
    value: r,
  };
}

/** Duplica una generación para re-revisión: MISMA generación, caso editorial NUEVO (`~R<n>`). */
export function duplicateForReview(l: ControlLedger, recordId: string, meta: ControlActionMeta): ControlActionResult<GenerationRecord> {
  const rec = l.records[recordId];
  if (!rec) return reject(l, `registro desconocido: ${recordId}`);
  const root = rec.revisionOf ?? rec.recordId;
  const revision = 2 + Object.values(l.records).filter((r) => r.revisionOf === root).length;
  const dupId = `${root}~R${revision}`;
  if (l.records[dupId]) return reject(l, t("revisión ya existente: {dupId}", { dupId: td(dupId) }));
  const dup: GenerationRecord = {
    ...rec,
    recordId: dupId,
    revisionOf: root,
    importedAt: meta.at,
    editorial: submitGeneration(rec.generation, { ...meta, tournamentName: rec.tournamentName }),
  };
  return {
    ledger: withRecord(l, dup, makeEvents(l, dupId, rec.generationId, meta, [{ kind: "duplicate", detail: t("revisión R{revision} de {root}", { revision, root: td(root) }) }])),
    value: dup,
  };
}
