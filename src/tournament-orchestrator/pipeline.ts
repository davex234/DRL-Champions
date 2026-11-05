/**
 * PIPELINE — las 8 etapas EXACTAS, en orden, cada una envolviendo UNA llamada pública de un
 * motor terminado (F1→F7 + conector VLR). Ninguna etapa transforma resultados: la salida de
 * cada motor viaja INTACTA a la siguiente. Si una etapa falla, el engine detiene el pipeline.
 *
 *   1. Importer VLR       importVlrTournament(url)        → RawSnapshot
 *   2. Importer           importSnapshot(snapshot, ctx)   → CanonicalModel
 *   3. Analyzer           analyzeTournament(model)        → TournamentReport
 *   4. Performance        analyze(model, history)         → AnalyzerResult enriquecido
 *   5. Card Generator     generateCards(analysis, ctx)    → CardGenerationResult
 *   6. Materializer       materialize(generation, ctx)    → MaterializationResult
 *   7. Catalog Builder    buildCatalog(materialization)   → CatalogBuildResult
 *   8. Publisher          publish(build, ctx)             → PublishResult (transacción+rollback)
 */
import { importVlrTournament } from "@/importer-vlr";
import { importSnapshot } from "@/importer";
import { analyzeTournament, analyze } from "@/analyzer";
import { generateCards, type GeneratorCtx } from "@/card-generator";
import { materialize } from "@/materializer";
import { buildCatalog } from "@/catalog-builder";
import { publish } from "@/publisher";
import type { ResolvedOrchestratorCtx } from "./context";
import { STAGE_LABELS, type PipelineOutputs, type StageId } from "./types";

export interface PipelineState {
  url: string;
  outputs: Partial<PipelineOutputs>;
}

export interface StageDef {
  id: StageId;
  label: string;
  run(state: PipelineState, ctx: ResolvedOrchestratorCtx): Promise<void> | void;
}

const stage = (id: StageId, run: StageDef["run"]): StageDef => ({ id, label: STAGE_LABELS[id], run });

/** Definición ordenada del pipeline. El orden ES el contrato: no se añaden ni saltan pasos. */
export const STAGES: readonly StageDef[] = [
  // 1. URL de vlr.gg → RawSnapshot oficial. Lanza si la URL no es de un torneo de VLR o si las
  //    páginas del evento no llegan (los fallos por-partido degradan a warnings, no abortan).
  stage("importer-vlr", async (s, ctx) => {
    s.outputs.vlr = await importVlrTournament(s.url, ctx.vlr);
  }),

  // 2. RawSnapshot → CanonicalModel validado. `importSnapshot` no lanza: acumula issues; un
  //    modelo con errores NO puede seguir pipeline abajo.
  stage("importer", (s, ctx) => {
    const res = importSnapshot(s.outputs.vlr!.snapshot, ctx.importCtx);
    s.outputs.importResult = res;
    if (!res.ok) {
      const errors = res.issues.filter((i) => i.severity === "error");
      throw new Error(`modelo canónico inválido: ${errors.length} error(es) — ${errors.slice(0, 3).map((i) => `[${i.kind}] ${i.message}`).join(" · ")}`);
    }
  }),

  // 3. CanonicalModel → TournamentReport (Analyzer F2).
  stage("analyzer", (s) => {
    s.outputs.report = analyzeTournament(s.outputs.importResult!.model);
  }),

  // 4. CanonicalModel → AnalyzerResult enriquecido (Performance F3). Incluye el informe F2
  //    byte a byte (garantía del propio Analyzer), por lo que nada se modifica ni se pierde.
  stage("performance", (s, ctx) => {
    s.outputs.analysis = analyze(s.outputs.importResult!.model, ctx.history);
  }),

  // 5. AnalyzerResult → CardGenerationResult (el ÚNICO motor que decide qué cartas existen).
  stage("card-generator", (s, ctx) => {
    const gctx: GeneratorCtx = {
      roster: ctx.roster, now: ctx.now,
      ledger: ctx.ledger, overrides: ctx.overrides, aliases: ctx.aliases, season: ctx.season,
    };
    s.outputs.generation = generateCards(s.outputs.analysis!, gctx);
  }),

  // 6. CardGenerationResult → MaterializationResult (CardDefs + patches incrementales).
  stage("materializer", async (s, ctx) => {
    s.outputs.materialization = await materialize(s.outputs.generation!, { roster: ctx.roster, now: ctx.now });
  }),

  // 7. MaterializationResult → CatalogBuildResult (catálogo lógico + manifiesto + validación).
  stage("catalog-builder", async (s, ctx) => {
    s.outputs.build = await buildCatalog(s.outputs.materialization!, { roster: ctx.roster, now: ctx.now });
  }),

  // 8. CatalogBuildResult → PublishResult. El Publisher conserva SU transacción: idempotencia
  //    por huella (ok && !applied = no-op) y auto-rollback ante fallo (ok === false).
  stage("publisher", (s, ctx) => {
    const pub = publish(s.outputs.build!, { now: ctx.now, persist: ctx.persist });
    s.outputs.publish = pub;
    if (!pub.ok) {
      const issues = pub.validation.issues.filter((i) => i.severity === "error");
      throw new Error(`publicación ${pub.transaction.finalState}${pub.rolledBackTo ? ` (rollback automático a runtime v${pub.rolledBackTo.runtimeVersion})` : ""}: ${issues.slice(0, 3).map((i) => `[${i.section}] ${i.message}`).join(" · ") || "sin detalle"}`);
    }
  }),
] as const;
