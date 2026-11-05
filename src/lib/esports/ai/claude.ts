/**
 * DRL PREDICT — proveedor de IA con CLAUDE (real, solo servidor).
 *
 * Usa el SDK oficial de Anthropic. Modelo por defecto `claude-opus-4-8`
 * (`ANTHROPIC_MODEL`), `claude-haiku-4-5` para lotes (`ANTHROPIC_MODEL_BULK`).
 * Salida JSON estructurada (`output_config.format`), caché de prompt sobre el
 * contexto de liga estable, y `thinking: adaptive` en partidos destacados.
 * Guardado por `ANTHROPIC_API_KEY`; sin clave, `getAIProvider` usa el heurístico.
 */
import type { AIAnalysis } from "@/domain/esports/predict/types";
import {
  type PredictionAIProvider, type AIAnalysisInput,
  AI_ANALYSIS_SCHEMA, LEAGUE_SYSTEM_PROMPT, matchBrief,
} from "./provider";
import { heuristicProvider } from "./heuristic";

const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";
const BULK_MODEL = process.env.ANTHROPIC_MODEL_BULK || "claude-haiku-4-5";

export function isClaudeConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

// Carga perezosa del SDK (solo servidor; evita incluirlo en el bundle de cliente).
async function getClient() {
  const mod = await import("@anthropic-ai/sdk");
  const Anthropic = mod.default;
  return new Anthropic();
}

function parseAnalysis(text: string, marquee: boolean): AIAnalysis {
  const data = JSON.parse(text) as Partial<AIAnalysis>;
  return {
    provider: marquee ? "claude" : "claude-bulk",
    narrative: data.narrative ?? "",
    keyFactors: Array.isArray(data.keyFactors) ? data.keyFactors : [],
    upsetRisk: typeof data.upsetRisk === "number" ? data.upsetRisk : undefined,
    mvpReasoning: data.mvpReasoning,
  };
}

function buildParams(input: AIAnalysisInput, model: string, marquee: boolean) {
  const params: Record<string, unknown> = {
    model,
    max_tokens: 1024,
    // Contexto estable cacheado; el brief volátil va en el mensaje de usuario.
    system: [{ type: "text", text: LEAGUE_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: matchBrief(input) }],
    output_config: { format: { type: "json_schema", schema: AI_ANALYSIS_SCHEMA } },
  };
  // En partidos destacados, deja pensar al modelo (mejor análisis).
  if (marquee) params.thinking = { type: "adaptive" };
  return params;
}

function extractText(message: { content: Array<{ type: string; text?: string }> }): string {
  const block = message.content.find((b) => b.type === "text");
  return block?.text ?? "{}";
}

export function createClaudeProvider(opts: { marquee?: boolean } = {}): PredictionAIProvider {
  const marquee = opts.marquee ?? true;
  const model = marquee ? DEFAULT_MODEL : BULK_MODEL;
  return {
    id: "claude",
    async analyze(input: AIAnalysisInput): Promise<AIAnalysis> {
      try {
        const client = await getClient();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const message = await client.messages.create(buildParams(input, model, marquee) as any);
        return parseAnalysis(extractText(message as { content: Array<{ type: string; text?: string }> }), marquee);
      } catch {
        // Ante cualquier fallo (red, cuota, formato), no romper la predicción.
        return heuristicProvider.analyze(input);
      }
    },
    async analyzeBatch(inputs: AIAnalysisInput[]): Promise<AIAnalysis[]> {
      // Lote secuencial con el modelo económico. Para volúmenes grandes y
      // asíncronos, usar `submitAnalysisBatch` (Batch API) de ./batch.
      const out: AIAnalysis[] = [];
      for (const input of inputs) out.push(await this.analyze(input));
      return out;
    },
  };
}
