/**
 * Resuelve el proveedor de IA de análisis: Claude si hay ANTHROPIC_API_KEY,
 * si no el heurístico local (cero coste, determinista).
 */
import type { PredictionAIProvider } from "./provider";
import { heuristicProvider } from "./heuristic";
import { isClaudeConfigured, createClaudeProvider } from "./claude";

export type ProviderChoice = "auto" | "claude" | "heuristic";

export function getAIProvider(choice: ProviderChoice = "auto", opts: { marquee?: boolean } = {}): PredictionAIProvider {
  if (choice === "heuristic") return heuristicProvider;
  if (choice === "claude" || (choice === "auto" && isClaudeConfigured())) {
    if (isClaudeConfigured()) return createClaudeProvider(opts);
  }
  return heuristicProvider;
}

export { heuristicProvider } from "./heuristic";
export { createClaudeProvider, isClaudeConfigured } from "./claude";
export type { PredictionAIProvider, AIAnalysisInput } from "./provider";
