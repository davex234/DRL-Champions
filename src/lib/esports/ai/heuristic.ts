/**
 * DRL PREDICT — proveedor de IA HEURÍSTICO (sin LLM, por defecto).
 * Genera narrativa y factores de forma determinista a partir de las features.
 * Funciona sin red ni claves; es el respaldo cuando Claude no está configurado.
 */
import type { AIAnalysis } from "@/domain/esports/predict/types";
import type { PredictionAIProvider, AIAnalysisInput } from "./provider";

const pct = (n: number) => `${Math.round(n * 100)}%`;

function buildFactors(input: AIAnalysisInput): string[] {
  const { features: f, teamAName: A, teamBName: B } = input;
  const factors: string[] = [];
  const eloDiff = Math.round(f.eloA - f.eloB);
  if (Math.abs(eloDiff) >= 25) {
    const fav = eloDiff > 0 ? A : B;
    factors.push(`${fav} llega con mejor rating (${Math.abs(eloDiff)} pts de Elo de ventaja).`);
  }
  if (Math.abs(f.formA.winRate - f.formB.winRate) >= 0.15) {
    const fav = f.formA.winRate > f.formB.winRate ? A : B;
    const wr = Math.max(f.formA.winRate, f.formB.winRate);
    factors.push(`${fav} está en mejor forma reciente (${pct(wr)} de victorias).`);
  }
  if (Math.abs(f.formA.momentum - f.formB.momentum) >= 0.3) {
    const fav = f.formA.momentum > f.formB.momentum ? A : B;
    factors.push(`${fav} llega con más impulso en sus últimos partidos.`);
  }
  const h2hTotal = f.h2h.gamesA + f.h2h.gamesB;
  if (h2hTotal > 0 && f.h2h.gamesA !== f.h2h.gamesB) {
    const fav = f.h2h.gamesA > f.h2h.gamesB ? A : B;
    factors.push(`En el historial directo manda ${fav} (${f.h2h.gamesA}-${f.h2h.gamesB}).`);
  }
  if (Math.abs(f.mapEdgeA) >= 0.12) {
    const fav = f.mapEdgeA > 0 ? A : B;
    factors.push(`${fav} domina mejor el pool de mapas.`);
  }
  if (input.mvpNick) factors.push(`MVP probable: ${input.mvpNick}.`);
  if (input.breakoutNick) factors.push(`Jugador revelación a seguir: ${input.breakoutNick}.`);
  return factors.slice(0, 5);
}

export const heuristicProvider: PredictionAIProvider = {
  id: "heuristic",
  async analyze(input: AIAnalysisInput): Promise<AIAnalysis> {
    const { model: m, teamAName: A, teamBName: B } = input;
    const favName = m.winProbA >= 0.5 ? A : B;
    const favProb = Math.max(m.winProbA, m.winProbB);
    const close = favProb < 0.6;
    const narrative =
      `${favName} parte como favorito con ${pct(favProb)} de probabilidad y un marcador previsto de ` +
      `${m.predictedScoreA}-${m.predictedScoreB}. ` +
      (close
        ? `Es un duelo muy igualado: el riesgo de sorpresa (${pct(m.upsetRisk)}) es alto.`
        : `El modelo lo ve con claridad (confianza ${pct(m.confidence)}).`) +
      (input.mvpNick ? ` ${input.mvpNick} apunta a MVP.` : "");
    return {
      provider: "heuristic",
      narrative,
      keyFactors: buildFactors(input),
      upsetRisk: m.upsetRisk,
      mvpReasoning: input.mvpNick
        ? `${input.mvpNick} es quien mejor rating proyecta en el equipo favorito.`
        : undefined,
    };
  },
};
