/**
 * F83 · VISTA DE LA RUTA DE TEMPORADA (pura). El servidor la construye con la hora del SERVIDOR y los datos de BD; el
 * arnés de QA usa la MISMA función. El cliente no recalcula niveles, retos ni reclamables.
 */
import { levelProgress, type LevelProgress } from "./curve";
import { activeChallenges } from "./rotation";
import { phaseOf, type ChallengeDef, type GameSeason, type SeasonPhase, type SeasonReward, type SeasonXpRules } from "./types";

export type NodeState = "CLAIMED" | "AVAILABLE" | "LOCKED" | "EXPIRED";

export interface TrackNode { level: number; xpRequired: number; reward: SeasonReward | null; state: NodeState; current: boolean }
export interface ChallengeView { id: string; label: string; family: string; target: number; progress: number; completed: boolean; xp: number }
export interface ChallengeGroup { periodKey: string; endsAt: number; challenges: ChallengeView[] }
export interface RecentXp { source: string; eventKey: string; amount: number; at: number; /** Reto: el evento que lo completó (`meta.by`). */ by?: string | null }
export interface SeasonHistoryItem { seasonId: string; number: number; name: string; xp: number; finalLevel: number; maxLevel: number; rewardsClaimed: number; endedAt: number }

export interface SeasonOverview {
  /** NONE = no hay temporada F83 publicada que enseñar (ni activa, ni en gracia, ni programada). */
  phase: "NONE" | SeasonPhase;
  serverNow: number;
  season: { id: string; number: number; name: string; description: string; startsAt: number; endsAt: number; claimUntil: number; maxLevel: number } | null;
  progress: LevelProgress | null;
  track: TrackNode[];
  claimable: number[];
  daily: ChallengeGroup | null;
  weekly: ChallengeGroup | null;
  recent: RecentXp[];
  history: SeasonHistoryItem[];
  /** Temporada del pase heredado que corre ahora mismo (calendario del código), para explicarlo en la UI. */
  legacy: { name: string; endsAt: number } | null;
  /** Reglas de XP CONGELADAS de la temporada (transparencia: de dónde sale cada XP). */
  rules: SeasonXpRules | null;
}

export interface OverviewInput {
  now: number;
  season: GameSeason | null;
  legacy: { name: string; endsAt: number } | null;
  xp: number;
  claims: number[];
  challengeRows: { periodKey: string; challengeId: string; progress: number; completed: boolean }[];
  recent: RecentXp[];
  history: SeasonHistoryItem[];
}

function group(defs: ChallengeDef[], periodKey: string, endsAt: number, rows: OverviewInput["challengeRows"]): ChallengeGroup {
  const by = new Map(rows.filter((r) => r.periodKey === periodKey).map((r) => [r.challengeId, r]));
  return {
    periodKey, endsAt,
    challenges: defs.map((d) => {
      const r = by.get(d.id);
      return { id: d.id, label: d.label, family: d.family, target: d.target, progress: Math.min(d.target, r?.progress ?? 0), completed: !!r?.completed, xp: d.xp };
    }),
  };
}

export function buildOverview(i: OverviewInput): SeasonOverview {
  const s = i.season;
  if (!s) return { phase: "NONE", serverNow: i.now, season: null, progress: null, track: [], claimable: [], daily: null, weekly: null, recent: [], history: i.history, legacy: i.legacy, rules: null };
  const phase = phaseOf(s, i.now);
  const levels = s.config.levels;
  const progress = levelProgress(i.xp, levels);
  const claimed = new Set(i.claims);
  const rewards = new Map(s.config.rewards.map((r) => [r.level, r.reward]));
  const canClaim = phase === "ACTIVE" || phase === "GRACE";
  const track: TrackNode[] = levels.map((xpRequired, idx) => {
    const level = idx + 1;
    const reward = rewards.get(level) ?? null;
    const reached = progress.level >= level;
    const state: NodeState = claimed.has(level) ? "CLAIMED" : reached && reward ? (canClaim ? "AVAILABLE" : "EXPIRED") : "LOCKED";
    return { level, xpRequired, reward, state, current: level === Math.min(progress.level + 1, s.maxLevel) };
  });
  const active = phase === "ACTIVE" ? activeChallenges(s.id, s.config, i.now) : null;
  return {
    phase, serverNow: i.now,
    season: { id: s.id, number: s.number, name: s.name, description: s.description, startsAt: s.startsAt, endsAt: s.endsAt, claimUntil: s.claimUntil, maxLevel: s.maxLevel },
    progress: phase === "SCHEDULED" ? levelProgress(0, levels) : progress,
    track,
    claimable: track.filter((n) => n.state === "AVAILABLE").map((n) => n.level),
    daily: active ? group(active.daily.challenges, active.daily.period.key, active.daily.period.endsAt, i.challengeRows) : null,
    weekly: active ? group(active.weekly.challenges, active.weekly.period.key, active.weekly.period.endsAt, i.challengeRows) : null,
    recent: i.recent,
    history: i.history,
    legacy: i.legacy,
    rules: s.config.xp,
  };
}

/**
 * Lo que dejó UNA partida (post-partida): XP de la partida y de los retos que completó, y el nivel antes/después.
 * Se deriva del libro mayor que devuelve el servidor (asientos `match:<id>` y `ch:` creados por ese evento).
 */
export function matchGain(o: SeasonOverview, matchId: string): { matchXp: number; challengeXp: number; challenges: number; levelBefore: number; levelAfter: number } | null {
  if (!o.season || !o.progress) return null;
  const key = `match:${matchId}`;
  const own = o.recent.find((r) => r.eventKey === key);
  const ch = o.recent.filter((r) => r.source === "CHALLENGE" && r.by === key);
  if (!own && ch.length === 0) return null;
  const gained = (own?.amount ?? 0) + ch.reduce((s, r) => s + r.amount, 0);
  const levels = o.track.map((n) => n.xpRequired);
  const before = levelProgress(Math.max(0, o.progress.xp - gained), levels).level;
  return { matchXp: own?.amount ?? 0, challengeXp: ch.reduce((s, r) => s + r.amount, 0), challenges: ch.length, levelBefore: before, levelAfter: o.progress.level };
}
