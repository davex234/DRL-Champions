/**
 * FIXTURES QA SYNTHETIC · FASE 34 — solo para `/design-system/fase34` y sus capturas.
 *
 * Construyen `SeasonHubSnapshot` con la MISMA forma que `GET /api/game/season`, sobre contenido REAL
 * (calendario canónico `SEASON_CALENDAR`, carriles de `CURRENT_SEASON`, pool de misiones, logros) y con
 * cifras y eventos INVENTADOS. Los calendarios alternativos (próxima temporada conocida, hueco entre
 * temporadas) son QA SYNTHETIC y se etiquetan: no son decisiones de producto.
 */
import { SEASON_CALENDAR } from "@/data/seasonCalendar";
import { resolveCalendar, type SeasonCalendarEntry } from "@/domain/season/calendar";
import { buildSeasonRecap, rankedRecap, type RatingEventFact } from "@/domain/season/recap";
import { seasonActions } from "@/domain/season/actions";
import { snapshotFrom, PROGRESSED, NEW_PLAYER } from "../fase27/fixtures";
import type { SeasonCalendarSnapshot, SeasonEventLite, SeasonHubSnapshot, SeasonPersonal } from "@/server/services/season";
import type { MetaObjective } from "@/domain/progression/meta";

const D = 86_400_000;
export const S1 = SEASON_CALENDAR[0];
export const START = Date.parse(S1.startsAt);
export const END = Date.parse(S1.endsAt);
export const NOW_ACTIVE = START + 8 * D + 15.5 * 3600_000;

/** QA SYNTHETIC: una «Temporada 2» FICTICIA solo para fotografiar «próxima temporada conocida». */
export const QA_S2: SeasonCalendarEntry = {
  id: "qa-s2", slug: "qa-temporada-2", number: 2, name: "QA · Temporada 2 (ficticia)", displayName: "QA · Temporada 2 (ficticia) · Fixture",
  startsAt: "2026-12-14T00:00:00.000Z", endsAt: "2027-03-08T00:00:00.000Z", passSeasonId: null, themeKey: "qa",
};

export function calendarAt(now: number, entries: readonly SeasonCalendarEntry[] = SEASON_CALENDAR): SeasonCalendarSnapshot {
  const r = resolveCalendar(entries, now);
  if (!r.ok) throw new Error("calendario QA inválido");
  return { serverNow: now, phase: r.phase, current: r.current, next: r.next, previous: r.previous, seasons: r.seasons };
}

const ev = (id: string, name: string, lifecycle: SeasonEventLite["lifecycle"], label: string, liveCount: number, start: number, end: number, pickem: SeasonEventLite["pickem"] = null): SeasonEventLite => ({
  id, name, lifecycle, label, liveCount, isDemo: true, startDate: new Date(start).toISOString().slice(0, 10), endDate: new Date(end).toISOString().slice(0, 10), pickem,
});

export const EVENTS = {
  full: {
    available: true,
    live: [ev("qa-live", "QA SYNTHETIC · Masters en directo", "LIVE" as never, "En directo", 2, START + 6 * D, START + 16 * D, { open: 4, pending: 3 })],
    upcoming: [ev("qa-next", "QA SYNTHETIC · Clasificatorio EMEA", "UPCOMING" as never, "Próximamente", 0, START + 20 * D, START + 27 * D)],
    inWindow: [ev("qa-live", "QA SYNTHETIC · Masters en directo", "LIVE" as never, "En directo", 2, START + 6 * D, START + 16 * D), ev("qa-next", "QA SYNTHETIC · Clasificatorio EMEA", "UPCOMING" as never, "Próximamente", 0, START + 20 * D, START + 27 * D)],
  },
  upcomingOnly: { available: true, live: [], upcoming: [ev("qa-next", "QA SYNTHETIC · Clasificatorio EMEA", "UPCOMING" as never, "Próximamente", 0, START + 20 * D, START + 27 * D)], inWindow: [] },
  none: { available: true, live: [], upcoming: [], inWindow: [] },
  down: { available: false, live: [], upcoming: [], inWindow: [] },
} satisfies Record<string, SeasonHubSnapshot["events"]>;

const RATING: RatingEventFact[] = [
  { createdAt: START + 1 * D, result: "WIN", oldRating: 1000, newRating: 1040 },
  { createdAt: START + 2 * D, result: "WIN", oldRating: 1040, newRating: 1071 },
  { createdAt: START + 4 * D, result: "LOSS", oldRating: 1071, newRating: 1044 },
  { createdAt: START + 6 * D, result: "WIN", oldRating: 1044, newRating: 1068 },
  { createdAt: START + 7 * D, result: "DRAW", oldRating: 1068, newRating: 1068 },
  { createdAt: START + 8 * D, result: "WIN", oldRating: 1068, newRating: 1091 },
];

export interface PersonalOpts {
  profile?: "progressed" | "new";
  now: number;
  season?: { id: string; name: string; startsAtMs: number; endsAtMs: number; status: "UPCOMING" | "ACTIVE" | "ENDED" };
  competitive?: "provisional" | "established" | "none";
  pickems?: "pending" | "scored" | "none";
  objectives?: "normal" | "none";
  cardsReliable?: boolean;
  actions?: "normal" | "none";
  recapMinimal?: boolean;
  pendingPicks?: number;
  /** Evento en directo de la escena (lo pone `hubAt` desde sus eventos), como hace el servicio. */
  liveEvent?: { id: string; name: string } | null;
}

export function personal(o: PersonalOpts): SeasonPersonal {
  const meta = snapshotFrom(o.profile === "new" ? NEW_PLAYER : PROGRESSED);
  const view = meta.pass;
  const season = o.season ?? { id: S1.id, name: S1.name, startsAtMs: START, endsAtMs: END, status: "ACTIVE" as const };
  const objectivesList: MetaObjective[] = o.objectives === "none" ? [] : meta.objectives;
  const count = (k: string) => { const l = objectivesList.filter((x) => x.kind === k); return { done: l.filter((x) => x.complete || x.claimed).length, total: l.length }; };
  const free = view.tracks.free; const competitive = view.tracks.competitive;
  const next = free.find((l) => !l.claimed && l.level > view.level);
  const events = o.competitive === "none" || o.profile === "new" ? [] : RATING.filter((r) => r.createdAt <= o.now);
  const inSeason = rankedRecap(events, season.startsAtMs, season.endsAtMs)!;
  const comp = o.competitive === "none" || o.profile === "new" ? null : {
    rating: o.competitive === "established" ? 1_246 : 1_091, gamesPlayed: o.competitive === "established" ? 33 : 6,
    wins: o.competitive === "established" ? 20 : 4, losses: o.competitive === "established" ? 12 : 1, draws: o.competitive === "established" ? 1 : 1,
    provisional: o.competitive !== "established", position: o.competitive === "established" ? 98 : 212, rankedTotal: 500, inSeason,
    recent: [...events].reverse().slice(0, 5).map((r) => ({ at: r.createdAt, result: r.result, delta: r.newRating - r.oldRating, newRating: r.newRating })),
  };
  const scores = o.pickems === "scored" ? [{ scoredAt: START + 5 * D, points: 70, correct: 7, total: 10 }] : [];
  const pendingPicks = o.pendingPicks ?? (o.pickems === "pending" ? 3 : 0);
  const claimableLevels = free.filter((l) => l.claimable).length + competitive.filter((l) => l.claimable).length;
  const achievements = view.achievements;
  const collection = { distinct: o.profile === "new" ? 0 : 138, owned: o.profile === "new" ? 0 : 212, catalog: 2_345, obtainedInSeason: o.cardsReliable ? 27 : null, windowReliable: !!o.cardsReliable };
  // Como el servicio: el tablero solo existe con la temporada EN CURSO.
  const actions = o.actions === "none" || season.status !== "ACTIVE" ? [] : seasonActions({
    activeDuel: false,
    claimable: { levels: claimableLevels, missions: objectivesList.filter((x) => x.complete && !x.claimed).length, achievements: achievements.filter((a) => a.complete && !a.claimed).length },
    pendingPicks, unopenedPacks: meta.unopenedPacks, hasValidDeck: meta.decks.valid > 0, objectives: objectivesList,
    rankedGames: inSeason.games, liveEvent: o.liveEvent ?? null,
  });
  const recap = buildSeasonRecap({
    season,
    pass: o.recapMinimal || o.profile === "new" ? null : { level: view.level, maxLevel: view.season.maxLevel, xp: view.xp, missionsCompleted: 23, claimedFree: 5, claimedCompetitive: 0, source: "LIVE" },
    ratingEvents: o.recapMinimal ? [] : events,
    achievementClaims: o.recapMinimal ? [] : achievements.filter((a) => a.claimedAt).map((a) => Math.max(START + 3 * D, Date.parse(a.claimedAt!))),
    pickemScores: o.recapMinimal ? [] : scores,
    cardsObtainedInWindow: o.cardsReliable && !o.recapMinimal ? 27 : null,
  });
  return {
    account: meta.level,
    pass: season.status === "ACTIVE" ? {
      seasonId: view.season.id, name: view.season.name, level: view.level, maxLevel: view.season.maxLevel, xp: view.xp,
      xpIntoLevel: view.xpIntoLevel, xpForNext: view.xpForNext, progress: view.progress,
      competitiveUnlocked: view.competitiveUnlocked, competitiveUnlockPending: false, competitiveMinPoints: view.competitiveMinPoints, points: view.points,
      tracks: { free, competitive },
      claimable: { free: free.filter((l) => l.claimable).length, competitive: competitive.filter((l) => l.claimable).length },
      nextReward: next ? { track: "free", level: next.level, reward: next.reward } : null,
    } : null,
    objectives: season.status === "ACTIVE" ? {
      daily: count("daily"), weekly: count("weekly"), seasonal: count("seasonal"), progressive: count("progressive"),
      list: objectivesList.filter((x) => !x.claimed).slice(0, 6), all: objectivesList, claimable: objectivesList.filter((x) => x.complete && !x.claimed).length,
      rotationPending: false, unassigned: objectivesList.length === 0,
    } : null,
    achievements: {
      total: achievements.length, complete: achievements.filter((a) => a.complete).length, claimed: achievements.filter((a) => a.claimed).length,
      claimable: achievements.filter((a) => a.complete && !a.claimed).length, highlights: achievements.slice(0, 4),
    },
    competitive: comp,
    pickems: { pending: pendingPicks, inSeason: { scored: scores.length, points: scores.reduce((s, x) => s + x.points, 0), correct: scores.reduce((s, x) => s + x.correct, 0) } },
    collection, actions, recap,
  };
}

export function hubAt(now: number, opts: { entries?: readonly SeasonCalendarEntry[]; seasonId?: string; events?: SeasonHubSnapshot["events"]; personal?: Omit<PersonalOpts, "now" | "season"> | null } = {}): SeasonHubSnapshot {
  const calendar = calendarAt(now, opts.entries);
  const season = opts.seasonId ? calendar.seasons.find((s) => s.id === opts.seasonId)! : calendar.current ?? calendar.next ?? calendar.previous!;
  const events = opts.events ?? EVENTS.full;
  const live = events.live[0] ?? null;
  const p = opts.personal === null ? null : personal({ liveEvent: live ? { id: live.id, name: live.name } : null, ...(opts.personal ?? {}), now, season: { id: season.id, name: season.name, startsAtMs: season.startsAtMs, endsAtMs: season.endsAtMs, status: season.status } });
  return { serverNow: now, calendar, season, isCurrent: calendar.current?.id === season.id, events, personal: p };
}
