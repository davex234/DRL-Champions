/**
 * DECAY ENGINE — decaimiento por inactividad en ligas altas (Online Fase 3/7).
 *
 * Solo Diamante+ decaen tras un umbral de inactividad; avanza `lastActiveAt` para no re-decaer
 * en bucle. PURO sobre el reloj lógico. Determinista.
 */
import type { CompetitiveProfile, RankEvent } from "./types";
import { leagueOrdinal, leagueForMmr, divisionForMmr, rankLabel } from "./leagues";
import { inPlacement } from "./profile";

export interface DecayConfig { idleThreshold: number; period: number; decayPerPeriod: number; minLeagueOrdinal: number }
export const DEFAULT_DECAY: DecayConfig = { idleThreshold: 200, period: 100, decayPerPeriod: 25, minLeagueOrdinal: 5 }; // 5 = diamond

export function applyDecay(p: CompetitiveProfile, now: number, cfg: DecayConfig = DEFAULT_DECAY): { profile: CompetitiveProfile; event: RankEvent | null } {
  if (inPlacement(p) || !p.league || leagueOrdinal(p.league) < cfg.minLeagueOrdinal) return { profile: p, event: null };
  const idle = now - p.lastActiveAt;
  if (idle < cfg.idleThreshold) return { profile: p, event: null };
  const periods = Math.floor((idle - cfg.idleThreshold) / cfg.period) + 1;
  const mmr = Math.max(0, p.mmr - periods * cfg.decayPerPeriod);
  if (mmr === p.mmr) return { profile: p, event: null };
  const league = leagueForMmr(mmr), division = divisionForMmr(mmr, league);
  const event: RankEvent = { type: "decayed", playerId: p.id, at: now, from: rankLabel(p.league, p.division), to: rankLabel(league, division), detail: "Decae por inactividad" };
  return { profile: { ...p, mmr, league, division, lastActiveAt: p.lastActiveAt + periods * cfg.period }, event };
}
