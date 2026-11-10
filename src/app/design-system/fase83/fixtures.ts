/**
 * F83 · FIXTURES DEL ARNÉS DE LA RUTA DE TEMPORADA — QA SYNTHETIC sobre la PLANTILLA real de la Temporada 2 (curva,
 * recompensas, retos). Las vistas salen de `buildOverview`, la MISMA función del servidor; lo sintético es la XP, los
 * reclamos, el progreso de los retos y la hora. Nunca se escribe ni se envía nada.
 */
import { buildOverview, type SeasonOverview } from "@/domain/seasonTrack/view";
import { activeChallenges } from "@/domain/seasonTrack/rotation";
import { t2Draft } from "@/domain/seasonTrack/template";
import type { GameSeason } from "@/domain/seasonTrack/types";

const DAY = 86_400_000;
const base = t2Draft();
export const SEASON: GameSeason = { ...base, status: "PUBLISHED", checksum: "qa", publishedAt: base.startsAt - 7 * DAY, rowVersion: 2 };
/** Día 23 de la temporada, 15:30 UTC. */
export const QA_NOW = SEASON.startsAt + 23 * DAY + 15.5 * 3_600_000;
const xpFor = (level: number, extra = 0) => (level === 0 ? 0 : SEASON.config.levels[level - 1]) + extra;

function rowsFor(now: number, frac: number) {
  const a = activeChallenges(SEASON.id, SEASON.config, now);
  return [...a.daily.challenges.map((c, i) => ({ periodKey: a.daily.period.key, c, i })), ...a.weekly.challenges.map((c, i) => ({ periodKey: a.weekly.period.key, c, i }))]
    .map(({ periodKey, c, i }) => {
      const progress = i === 0 ? c.target : Math.floor(c.target * frac * (i % 2 ? 0.5 : 1));
      return { periodKey, challengeId: c.id, progress, completed: progress >= c.target };
    });
}

const recent = (matchId: string, at: number) => [
  { source: "MATCH", eventKey: `match:${matchId}`, amount: 70, at, by: null },
  { source: "CHALLENGE", eventKey: "ch:d:x:d-ganar-1", amount: 150, at, by: `match:${matchId}` },
  { source: "MATCH", eventKey: "match:prev-1", amount: 40, at: at - 3_600_000, by: null },
  { source: "CRAFT", eventKey: "craft:qa", amount: 50, at: at - 7_200_000, by: null },
];

const history = [{ seasonId: "temporada-9", number: 9, name: "Temporada QA anterior", xp: 61_400, finalLevel: 29, maxLevel: 40, rewardsClaimed: 15, endedAt: SEASON.startsAt - 30 * DAY }];

const mk = (over: Partial<Parameters<typeof buildOverview>[0]>): SeasonOverview => buildOverview({
  now: QA_NOW, season: SEASON, legacy: null, xp: xpFor(12, 700), claims: [2, 4, 5, 6, 8], challengeRows: rowsFor(QA_NOW, 0.6), recent: recent("qa-m1", QA_NOW - 60_000), history: [], ...over,
});

export const ACTIVE = mk({});
export const CLAIM = mk({ claims: [2, 4, 6, 8] });
export const FRESH = mk({ xp: 0, claims: [], challengeRows: [], recent: [] });
export const MAX = mk({ xp: SEASON.config.levels.at(-1)! + 4_200, claims: SEASON.config.rewards.map((r) => r.level).filter((l) => l !== 40), challengeRows: rowsFor(QA_NOW, 1), history });
export const GRACE = buildOverview({ now: SEASON.endsAt + 3 * DAY, season: SEASON, legacy: null, xp: xpFor(26, 300), claims: [2, 4, 5, 6, 8, 10, 12, 14], challengeRows: [], recent: [], history });
export const SCHEDULED = buildOverview({ now: SEASON.startsAt - 5 * DAY, season: SEASON, legacy: { name: "Temporada 1 · Ascenso", endsAt: SEASON.startsAt }, xp: 0, claims: [], challengeRows: [], recent: [], history: [] });
export const NONE = buildOverview({ now: QA_NOW, season: null, legacy: null, xp: 0, claims: [], challengeRows: [], recent: [], history: [] });
/** Post-partida: la partida `qa-m1` dio 70 XP y completó un reto (+150) y cruzó del nivel 11 al 12. */
export const POSTMATCH = mk({ xp: xpFor(12, 120) });
/** Varios niveles de golpe (17 → 20). */
export const MULTI = mk({ xp: xpFor(20, 10), recent: [{ source: "COLLECTION", eventKey: "collection:team-g2-v1", amount: 300, at: QA_NOW, by: null }, { source: "MATCH", eventKey: "match:qa-big", amount: SEASON.config.levels[19] - SEASON.config.levels[16] - 290, at: QA_NOW, by: null }] });
