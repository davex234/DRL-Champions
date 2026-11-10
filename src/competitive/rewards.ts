/**
 * COMPETITIVE REWARDS — infraestructura de recompensas de temporada (Online Fase 3/7).
 *
 * Deriva medalla/insignia del pico de liga. PREPARADO (no es economía ni marketplace). PURO.
 */
import type { CompetitiveProfile, SeasonReward, RewardTier, LeagueId } from "./types";
import { LEAGUE_LABEL } from "./leagues";

const MEDAL: Record<RewardTier, string> = {
  none: "—", iron: "🥉", bronze: "🥉", silver: "🥈", gold: "🥇", platinum: "🏅",
  diamond: "💎", master: "👑", grandmaster: "👑", champion: "🏆",
};

export function seasonReward(p: CompetitiveProfile): SeasonReward {
  const peak = p.season.peakLeague ?? p.league;
  const tier: RewardTier = (peak ?? "none") as RewardTier;
  return { playerId: p.id, tier, medal: MEDAL[tier] ?? "—", badge: peak ? `${LEAGUE_LABEL[peak as LeagueId]} S${p.season.season}` : "Sin clasificar", peakLeague: peak };
}
