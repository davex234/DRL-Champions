/**
 * QUALITY ASSISTANT ENGINE — fachada de SOLO LECTURA: construye el contexto (assets del
 * Manager + análisis de píxeles + ciclo de vida + referencias + composiciones, todo
 * inyectado) y produce el QualityReport. CERO escrituras, CERO decisiones automáticas:
 * el informe es la única salida.
 */
import type { ArtworkEngine, ArtworkRefs } from "@/artwork";
import type { ArtworkComposition } from "@/artwork-composer";
import type { LifecycleState } from "@/artwork-updater";
import { analyzeManagerPixels, type QualityReader } from "./analysis";
import { buildReport } from "./report";
import type { AnalysisContext, QualityReport } from "./types";

export interface QualityAssistantOptions {
  /** Lector local de solo lectura para el análisis de píxeles (opcional). */
  reader?: QualityReader;
  lifecycle?: LifecycleState;
  refs?: ArtworkRefs;
  compositions?: ArtworkComposition[];
  now: number;
  scope?: string;
}

export class ArtworkQualityAssistant {
  constructor(private artwork: ArtworkEngine, private opts: QualityAssistantOptions) {}

  /** Construye el contexto de análisis (lecturas puras; nada se modifica). */
  async buildContext(): Promise<AnalysisContext> {
    return {
      assets: this.artwork.registry.list().filter((a) => !a.placeholder).sort((a, b) => (a.id < b.id ? -1 : 1)),
      pixels: await analyzeManagerPixels(this.artwork, this.opts.reader),
      lifecycle: this.opts.lifecycle,
      refs: this.opts.refs,
      compositions: this.opts.compositions,
      now: this.opts.now,
      scope: this.opts.scope,
    };
  }

  /** Analiza y genera el QualityReport (única salida del asistente). */
  async analyze(): Promise<QualityReport> {
    return buildReport(await this.buildContext());
  }
}
