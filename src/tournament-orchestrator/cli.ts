/**
 * CLI — `npm run tournament:generate <url>`: una URL de torneo de vlr.gg (evento o
 * /event/stats/) → pipeline completo F1→F7 con salida legible por consola. Toda la lógica vive
 * en los motores; aquí solo hay parseo de argumentos, wiring de eventos y formato.
 */
import { runTournamentPipeline } from "./engine";
import { STAGE_LABELS, type OrchestratorCtx, type OrchestratorEvents, type OrchestratorResult, type PipelineOutputs } from "./types";
import { ns, td } from "@/i18n/runtime";

const t = ns("tournamentorchestrator");

const BAR = "========================================";
const USAGE = [
  "Uso: npm run tournament:generate <url>",
  "",
  "  <url>  URL de un torneo de vlr.gg. Se aceptan ambas formas:",
  "         https://www.vlr.gg/event/2765/valorant-masters-london-2026",
  "         https://www.vlr.gg/event/stats/2765/valorant-masters-london-2026",
].join("\n");

export interface CliRun {
  exitCode: number;
  result?: OrchestratorResult;
}

const fmtMs = (ms: number): string => (ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`);

/** Eventos → líneas de progreso con el formato oficial de la fase. */
function progressEvents(out: (line: string) => void): OrchestratorEvents {
  return {
    onStageStart(stage) {
      if (stage === "analyzer") out("\nAnalizando...\n");
      if (stage === "card-generator") out(("\n" + t("Generando cartas...") + "\n"));
      if (stage === "materializer") out("\nMaterializando...\n");
      if (stage === "catalog-builder") out(("\n" + t("Construyendo catálogo...") + "\n"));
      if (stage === "publisher") out("\nPublicando...\n");
    },
    onStageEnd(stage, _ms, outputs: Readonly<Partial<PipelineOutputs>>) {
      if (stage === "importer-vlr") {
        out(`Tournament:\n${outputs.vlr!.snapshot.tournament.name}\n`);
        out("Importando...\n");
        for (const w of outputs.vlr!.warnings) out(`  ⚠ ${w}`);
      }
      if (stage === "importer") {
        const m = outputs.importResult!.model;
        out(t("✓ {length} equipos", { length: m.teams.length }));
        out(t("✓ {length} jugadores", { length: m.players.length }));
        out(`✓ ${m.matches.length} partidos`);
        out(`✓ ${m.maps.length} mapas`);
      }
      if (stage === "analyzer") out("✓ Analyzer completado");
      if (stage === "performance") out("✓ Performance completado");
      if (stage === "card-generator") out(t("✓ {length} cartas generadas", { length: outputs.generation!.cards.length }));
      if (stage === "materializer") out(`✓ ${outputs.materialization!.cards.length} CardDefs`);
      if (stage === "catalog-builder") out(t("✓ Catálogo actualizado (v{catalogVersion})", { catalogVersion: outputs.build!.catalogVersion }));
      if (stage === "publisher") {
        out(outputs.publish!.applied ? "✓ Runtime actualizado" : t("✓ Runtime sin cambios (publicación idempotente)"));
      }
    },
  };
}

export async function runCli(
  argv: string[],
  ctx: OrchestratorCtx = {},
  out: (line: string) => void = console.log,
): Promise<CliRun> {
  const url = argv.find((a) => a && !a.startsWith("-"));
  if (!url) {
    out(USAGE);
    return { exitCode: 1 };
  }

  out(BAR + "\n");
  const result = await runTournamentPipeline(url, { ...ctx, events: ctx.events ?? progressEvents(out) });

  out("\n" + BAR);
  if (result.ok) {
    out("\nPipeline completado correctamente.\n");
    out(`GenerationId:   ${result.metrics.generationId}`);
    out(`CatalogVersion: ${result.metrics.catalogVersion}`);
    out(`RuntimeVersion: ${result.metrics.runtimeVersion}`);
    out(`Tiempo total:   ${fmtMs(result.metrics.totalMs)}`);
    out("\n" + BAR);
    return { exitCode: 0, result };
  }

  out(t("\n✗ Pipeline FALLIDO en el paso: {v} ({failedStage})\n", { v: td(STAGE_LABELS[result.failedStage!]), failedStage: result.failedStage }));
  if (result.error?.stack) out(result.error.stack);
  else out(result.error?.message ?? t("error desconocido"));
  out("\n" + BAR);
  return { exitCode: 1, result };
}
