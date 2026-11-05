"use client";

import { getSupabase } from "@/lib/supabase/client";
import type {
  PredictionRow, PredictionPlayerRow, TeamRatingRow, ModelAccuracyRow,
} from "@/lib/supabase/esports.types";
import type { Prediction, PlayerProjection, TeamRating } from "@/domain/esports/predict/types";
import { MODEL_VERSION } from "@/domain/esports/predict/types";

const num = (n: number | null): number | undefined => (n == null ? undefined : Number(n));

function toPrediction(r: PredictionRow): Prediction {
  return {
    matchId: r.match_id, modelVersion: r.model_version, provider: r.provider,
    winProbA: num(r.win_prob_a) ?? 0.5, winProbB: num(r.win_prob_b) ?? 0.5,
    predictedWinnerId: r.predicted_winner_id ?? "",
    predictedScoreA: r.predicted_score_a ?? 0, predictedScoreB: r.predicted_score_b ?? 0,
    confidence: num(r.confidence) ?? 0, upsetRisk: num(r.upset_risk) ?? 0,
    mvpPlayerId: r.mvp_player_id ?? undefined, breakoutPlayerId: r.breakout_player_id ?? undefined,
    narrative: r.narrative ?? undefined, keyFactors: r.key_factors ?? [],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    features: r.features as any,
  };
}

export async function getPrediction(matchId: string, modelVersion = MODEL_VERSION): Promise<Prediction | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.from("predictions").select("*")
    .eq("match_id", matchId).eq("model_version", modelVersion).maybeSingle();
  return data ? toPrediction(data as PredictionRow) : null;
}

export async function listUpcomingPredictions(limit = 50): Promise<Prediction[]> {
  const sb = getSupabase();
  if (!sb) return [];
  // Predicciones de partidos próximos/en vivo (join lógico vía la vista de matches).
  const { data } = await sb
    .from("predictions").select("*, matches!inner(status, start_time)")
    .in("matches.status", ["upcoming", "live"])
    .order("created_at", { ascending: false }).limit(limit);
  return ((data as PredictionRow[]) ?? []).map(toPrediction);
}

export async function getMatchPlayerProjections(matchId: string): Promise<PlayerProjection[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb.from("prediction_players").select("*").eq("match_id", matchId);
  return ((data as PredictionPlayerRow[]) ?? []).map((r) => ({
    playerId: r.player_id ?? "", teamId: r.team_id ?? "", kind: r.kind as PlayerProjection["kind"],
    projectedRating: num(r.projected_rating) ?? 0, mvpProb: num(r.mvp_prob), breakoutScore: num(r.breakout_score),
  }));
}

export async function getTeamRatings(limit = 100): Promise<TeamRating[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb.from("team_ratings").select("*").order("rating", { ascending: false }).limit(limit);
  return ((data as TeamRatingRow[]) ?? []).map((r) => ({
    teamId: r.team_id, rating: Number(r.rating), peakRating: Number(r.peak_rating),
    games: r.games, wins: r.wins, losses: r.losses, region: r.region ?? undefined,
  }));
}

/** "Nota" del modelo: acierto de ganador, Brier medio y marcador exacto. */
export async function getModelAccuracy(): Promise<ModelAccuracyRow[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb.from("v_model_accuracy").select("*");
  return (data as ModelAccuracyRow[]) ?? [];
}
