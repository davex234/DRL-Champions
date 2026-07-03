/**
 * DRL PREDICT — análisis en LOTE con la Batch API de Anthropic (escala).
 *
 * Para narrar muchos partidos de forma asíncrona a mitad de coste. Devuelve un
 * mapa matchId → AIAnalysis. Solo servidor; requiere ANTHROPIC_API_KEY.
 */
import type { AIAnalysis } from "@/domain/esports/predict/types";
import {
  type AIAnalysisInput, AI_ANALYSIS_SCHEMA, LEAGUE_SYSTEM_PROMPT, matchBrief,
} from "./provider";

const BULK_MODEL = process.env.ANTHROPIC_MODEL_BULK || "claude-haiku-4-5";

async function getClient() {
  const mod = await import("@anthropic-ai/sdk");
  const Anthropic = mod.default;
  return new Anthropic();
}

/**
 * Envía un lote y espera (poll) su finalización. `items` mapea matchId → input.
 * Devuelve matchId → AIAnalysis para los que completaron correctamente.
 */
export async function submitAnalysisBatch(
  items: { matchId: string; input: AIAnalysisInput }[],
  opts: { pollMs?: number; maxWaitMs?: number } = {},
): Promise<Record<string, AIAnalysis>> {
  if (!items.length) return {};
  const client = await getClient();

  const requests = items.map(({ matchId, input }) => ({
    custom_id: matchId,
    params: {
      model: BULK_MODEL,
      max_tokens: 1024,
      system: [{ type: "text", text: LEAGUE_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: matchBrief(input) }],
      output_config: { format: { type: "json_schema", schema: AI_ANALYSIS_SCHEMA } },
    },
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const batch = await client.messages.batches.create({ requests } as any);

  const pollMs = opts.pollMs ?? 5000;
  const maxWaitMs = opts.maxWaitMs ?? 1000 * 60 * 20;
  const start = Date.now();
  let status = batch as { id: string; processing_status?: string };
  while (status.processing_status !== "ended") {
    if (Date.now() - start > maxWaitMs) throw new Error("Batch de IA: tiempo de espera agotado");
    await new Promise((r) => setTimeout(r, pollMs));
    status = await client.messages.batches.retrieve(status.id);
  }

  const out: Record<string, AIAnalysis> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for await (const res of (await client.messages.batches.results(status.id)) as any) {
    if (res.result?.type !== "succeeded") continue;
    const text = res.result.message.content.find((b: { type: string }) => b.type === "text")?.text ?? "{}";
    try {
      const data = JSON.parse(text) as Partial<AIAnalysis>;
      out[res.custom_id] = {
        provider: "claude-batch",
        narrative: data.narrative ?? "",
        keyFactors: Array.isArray(data.keyFactors) ? data.keyFactors : [],
        upsetRisk: typeof data.upsetRisk === "number" ? data.upsetRisk : undefined,
        mvpReasoning: data.mvpReasoning,
      };
    } catch {
      // ignora resultados con JSON inválido
    }
  }
  return out;
}
