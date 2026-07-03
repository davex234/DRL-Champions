/**
 * DRL PREDICT — orquestador (servidor, service_role).
 *
 * Flujo: datos (0003) → features → modelo estadístico → proyección de jugadores
 * → capa de IA → upsert en predictions / prediction_players. Además recomputa
 * los ratings Elo (`team_ratings`) desde los partidos finalizados.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MatchRow } from "@/lib/supabase/esports.types";
import { toMatch } from "@/lib/esports/repos/mappers";
import { DEFAULT_RATING, DEFAULT_K, updateElo, marginMultiplier } from "@/domain/esports/predict/elo";
import { recentForm, headToHead } from "@/domain/esports/predict/form";
import { runModel } from "@/domain/esports/predict/model";
import { projectMvp, projectBreakout } from "@/domain/esports/predict/players";
import { MODEL_VERSION, type MatchFeatures, type PlayerForm } from "@/domain/esports/predict/types";
import { getAIProvider, type ProviderChoice } from "@/lib/esports/ai";

const clamp = (n: number, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, n));

/** Recomputa los ratings Elo recorriendo los partidos finalizados en orden. */
export async function rebuildRatings(sb: SupabaseClient): Promise<{ teams: number; matches: number }> {
  const { data: teamRows } = await sb.from("teams").select("id, region");
  const region: Record<string, string | null> = {};
  for (const t of (teamRows as { id: string; region: string | null }[]) ?? []) region[t.id] = t.region;

  const { data } = await sb
    .from("matches")
    .select("*")
    .eq("status", "finished")
    .order("start_time", { ascending: true });
  const matches = ((data as MatchRow[]) ?? []).map(toMatch).filter((m) => m.teamAId && m.teamBId && m.winnerTeamId);

  type Acc = { rating: number; peak: number; games: number; wins: number; losses: number; last?: number };
  const acc = new Map<string, Acc>();
  const ensure = (id: string): Acc => {
    let a = acc.get(id);
    if (!a) { a = { rating: DEFAULT_RATING, peak: DEFAULT_RATING, games: 0, wins: 0, losses: 0 }; acc.set(id, a); }
    return a;
  };

  for (const m of matches) {
    const a = ensure(m.teamAId!); const b = ensure(m.teamBId!);
    const aWon = m.winnerTeamId === m.teamAId;
    const mult = marginMultiplier(m.scoreA, m.scoreB);
    const upd = updateElo(a.rating, b.rating, aWon ? 1 : 0, DEFAULT_K, mult);
    a.rating = upd.ratingA; b.rating = upd.ratingB;
    a.peak = Math.max(a.peak, a.rating); b.peak = Math.max(b.peak, b.rating);
    a.games++; b.games++;
    if (aWon) { a.wins++; b.losses++; } else { a.losses++; b.wins++; }
    a.last = b.last = m.startTime;
  }

  const rows = [...acc.entries()].map(([team_id, a]) => ({
    team_id, rating: Math.round(a.rating * 10) / 10, peak_rating: Math.round(a.peak * 10) / 10,
    games: a.games, wins: a.wins, losses: a.losses, region: region[team_id] ?? null,
    last_match_at: a.last ? new Date(a.last).toISOString() : null, updated_at: new Date().toISOString(),
  }));
  if (rows.length) {
    const { error } = await sb.from("team_ratings").upsert(rows, { onConflict: "team_id" });
    if (error) throw new Error(`team_ratings: ${error.message}`);
  }
  return { teams: rows.length, matches: matches.length };
}

interface MatchContext {
  features: MatchFeatures;
  rosterForms: PlayerForm[];
  nick: Record<string, string>;
}

async function buildContext(sb: SupabaseClient, matchId: string): Promise<MatchContext | null> {
  const { data: mRow } = await sb.from("matches").select("*").eq("id", matchId).maybeSingle();
  if (!mRow) return null;
  const match = toMatch(mRow as MatchRow);
  const A = match.teamAId, B = match.teamBId;
  if (!A || !B) return null;

  // Histórico de ambos equipos (para forma y H2H).
  const { data: histRows } = await sb
    .from("matches").select("*").eq("status", "finished")
    .or(`team_a_id.in.(${A},${B}),team_b_id.in.(${A},${B})`)
    .order("start_time", { ascending: false }).limit(300);
  const history = ((histRows as MatchRow[]) ?? []).map(toMatch);

  const { data: ratingRows } = await sb.from("team_ratings").select("team_id, rating").in("team_id", [A, B]);
  const elo: Record<string, number> = { [A]: DEFAULT_RATING, [B]: DEFAULT_RATING };
  for (const r of (ratingRows as { team_id: string; rating: number }[]) ?? []) elo[r.team_id] = Number(r.rating);

  const { data: teamRows } = await sb.from("teams").select("id, name").in("id", [A, B]);
  const teamName: Record<string, string> = {};
  for (const t of (teamRows as { id: string; name: string }[]) ?? []) teamName[t.id] = t.name;

  const formA = recentForm(history, A);
  const formB = recentForm(history, B);
  const features: MatchFeatures = {
    matchId, teamAId: A, teamBId: B, teamAName: teamName[A], teamBName: teamName[B],
    bestOf: match.bestOf || 3, eloA: elo[A], eloB: elo[B], formA, formB,
    h2h: headToHead(history, A, B),
    mapEdgeA: clamp(formA.mapWinRate - formB.mapWinRate),
  };

  // Plantillas y forma de jugador (rating reciente vs base) desde player_event_stats.
  const { data: playerRows } = await sb.from("players").select("id, nick, team_id").in("team_id", [A, B]);
  const players = (playerRows as { id: string; nick: string; team_id: string }[]) ?? [];
  const nick: Record<string, string> = {};
  for (const p of players) nick[p.id] = p.nick;
  const ids = players.map((p) => p.id);

  const rosterForms: PlayerForm[] = [];
  if (ids.length) {
    const { data: statRows } = await sb
      .from("player_event_stats").select("player_id, rating, maps").in("player_id", ids);
    const byPlayer = new Map<string, number[]>();
    const mapsByPlayer = new Map<string, number>();
    for (const s of (statRows as { player_id: string; rating: number | null; maps: number }[]) ?? []) {
      if (s.rating == null) continue;
      const arr = byPlayer.get(s.player_id) ?? []; arr.push(Number(s.rating)); byPlayer.set(s.player_id, arr);
      mapsByPlayer.set(s.player_id, (mapsByPlayer.get(s.player_id) ?? 0) + (s.maps ?? 0));
    }
    for (const p of players) {
      const arr = byPlayer.get(p.id) ?? [];
      if (!arr.length) continue;
      const baseline = arr.reduce((a, b) => a + b, 0) / arr.length;
      const recent = Math.max(...arr); // mejor pico reciente como "forma"
      rosterForms.push({
        playerId: p.id, teamId: p.team_id, nick: p.nick,
        recentRating: recent, baselineRating: baseline, maps: mapsByPlayer.get(p.id) ?? arr.length,
      });
    }
  }

  return { features, rosterForms, nick };
}

/** Predice un partido concreto y persiste la predicción. */
export async function predictMatch(sb: SupabaseClient, matchId: string, choice: ProviderChoice = "auto") {
  const ctx = await buildContext(sb, matchId);
  if (!ctx) throw new Error(`Partido sin datos suficientes: ${matchId}`);
  const { features, rosterForms, nick } = ctx;

  const model = runModel(features);
  const mvp = projectMvp(rosterForms, model.predictedWinnerId);
  const breakout = projectBreakout(rosterForms);

  const provider = getAIProvider(choice, { marquee: true });
  const analysis = await provider.analyze({
    features, model,
    teamAName: features.teamAName ?? features.teamAId,
    teamBName: features.teamBName ?? features.teamBId,
    mvp: mvp ?? undefined, breakout: breakout ?? undefined,
    mvpNick: mvp ? nick[mvp.playerId] : undefined,
    breakoutNick: breakout ? nick[breakout.playerId] : undefined,
  });

  const { error: pErr } = await sb.from("predictions").upsert({
    match_id: matchId, model_version: MODEL_VERSION, provider: analysis.provider,
    win_prob_a: model.winProbA, win_prob_b: model.winProbB,
    predicted_winner_id: model.predictedWinnerId,
    predicted_score_a: model.predictedScoreA, predicted_score_b: model.predictedScoreB,
    confidence: model.confidence, upset_risk: analysis.upsetRisk ?? model.upsetRisk,
    mvp_player_id: mvp?.playerId ?? null, breakout_player_id: breakout?.playerId ?? null,
    narrative: analysis.narrative, key_factors: analysis.keyFactors, features,
    updated_at: new Date().toISOString(),
  }, { onConflict: "match_id,model_version" });
  if (pErr) throw new Error(`predictions: ${pErr.message}`);

  const projRows = [
    mvp && { match_id: matchId, player_id: mvp.playerId, team_id: mvp.teamId, kind: "mvp",
             projected_rating: mvp.projectedRating, mvp_prob: mvp.mvpProb ?? null },
    breakout && { match_id: matchId, player_id: breakout.playerId, team_id: breakout.teamId, kind: "breakout",
                  projected_rating: breakout.projectedRating, breakout_score: breakout.breakoutScore ?? null },
  ].filter(Boolean) as Record<string, unknown>[];
  if (projRows.length) {
    await sb.from("prediction_players").upsert(projRows, { onConflict: "match_id,player_id,kind" });
  }

  return { matchId, ...model, provider: analysis.provider, mvpPlayerId: mvp?.playerId, breakoutPlayerId: breakout?.playerId };
}

/** Predice todos los partidos próximos / en vivo. */
export async function predictUpcoming(sb: SupabaseClient, choice: ProviderChoice = "auto") {
  const { data } = await sb.from("matches").select("id").in("status", ["upcoming", "live"]).limit(200);
  const ids = ((data as { id: string }[]) ?? []).map((m) => m.id);
  const results = [];
  for (const id of ids) {
    try { results.push(await predictMatch(sb, id, choice)); }
    catch (e) { results.push({ matchId: id, error: e instanceof Error ? e.message : String(e) }); }
  }
  return results;
}
