/**
 * DRL PREDICT — contrato de la capa de IA de análisis.
 *
 * El modelo estadístico ya produce las probabilidades; el proveedor de IA añade
 * el análisis cualitativo (narrativa, factores clave, riesgo de sorpresa,
 * razonamiento del MVP). Implementaciones: heurístico (sin LLM, por defecto) y
 * Claude (real, detrás de ANTHROPIC_API_KEY).
 */
import type { MatchFeatures, ModelOutput, PlayerProjection, AIAnalysis } from "@/domain/esports/predict/types";

export interface AIAnalysisInput {
  features: MatchFeatures;
  model: ModelOutput;
  teamAName: string;
  teamBName: string;
  mvp?: PlayerProjection;
  breakout?: PlayerProjection;
  mvpNick?: string;
  breakoutNick?: string;
}

export interface PredictionAIProvider {
  id: string;
  analyze(input: AIAnalysisInput): Promise<AIAnalysis>;
  /** Análisis en lote (opcional; Claude lo implementa con la Batch API). */
  analyzeBatch?(inputs: AIAnalysisInput[]): Promise<AIAnalysis[]>;
}

/** Esquema JSON de la respuesta de IA (salida estructurada). */
export const AI_ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    narrative: { type: "string", description: "Análisis del partido en 2-3 frases, en español." },
    keyFactors: { type: "array", items: { type: "string" }, description: "3-5 factores clave, en español." },
    upsetRisk: { type: "number", description: "Riesgo de sorpresa 0-1." },
    mvpReasoning: { type: "string", description: "Por qué ese jugador es el MVP probable, en español." },
  },
  required: ["narrative", "keyFactors"],
} as const;

/** Resumen compacto de las features para el prompt (volátil, va al final). */
export function matchBrief(input: AIAnalysisInput): string {
  const { features: f, model: m, teamAName, teamBName } = input;
  return JSON.stringify({
    partido: `${teamAName} vs ${teamBName}`,
    formato: `bo${f.bestOf}`,
    elo: { [teamAName]: Math.round(f.eloA), [teamBName]: Math.round(f.eloB) },
    forma: {
      [teamAName]: { winrate: round(f.formA.winRate), mapas: round(f.formA.mapWinRate), momento: round(f.formA.momentum) },
      [teamBName]: { winrate: round(f.formB.winRate), mapas: round(f.formB.mapWinRate), momento: round(f.formB.momentum) },
    },
    h2h: { [teamAName]: f.h2h.gamesA, [teamBName]: f.h2h.gamesB, difMapas: f.h2h.mapDiffA },
    ventajaMapasA: round(f.mapEdgeA),
    modelo: {
      probA: m.winProbA, probB: m.winProbB,
      marcador: `${m.predictedScoreA}-${m.predictedScoreB}`,
      confianza: m.confidence, riesgoSorpresa: m.upsetRisk,
    },
    mvpProbable: input.mvpNick ?? input.mvp?.playerId,
    revelacion: input.breakoutNick ?? input.breakout?.playerId,
  });
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Contexto de liga estable (cacheable) que comparten todas las peticiones. */
export const LEAGUE_SYSTEM_PROMPT = `Eres el analista competitivo de DRL Champions, experto en Valorant esports.
Recibes las métricas y la predicción ya calculada por un modelo estadístico (Elo,
forma reciente, enfrentamientos directos y rendimiento por mapas). Tu trabajo es
EXPLICAR la predicción de forma clara y atractiva para aficionados, en español.

Reglas:
- No contradigas las probabilidades del modelo; interprétalas.
- Sé concreto: cita la forma, el Elo, el H2H o los mapas como evidencia.
- 2-3 frases de narrativa y 3-5 factores clave, todo en español.
- Devuelve EXCLUSIVAMENTE el JSON pedido.`;
