/**
 * FIXTURES QA SYNTHETIC · FASE 30 — solo para el arnés `/design-system/fase30` y sus capturas.
 * Misma forma que `GET /api/game/live-events`; eventos, equipos, jugadores, partidos y cartas
 * INVENTADOS con nombres ficticios (nunca equipos/eventos reales). Las rutas reales NO los usan.
 */
import { deriveEventState, eventActions, eventActivity, collectionProgress, teamRecords, LIFECYCLE_LABEL, type MatchLike, type EventLifecycle } from "@/domain/liveEvents/eventState";
import type { EventsOverviewSnapshot, EventHubSnapshot, EventMatchSnapshot, EventCardView, MatchSummary, TeamView, PlayerView, EventCardItem, PickemView, SyncView } from "@/server/services/liveEvents";

export const QA_NOW = Date.UTC(2026, 8, 14, 18, 30);
const H = 3600_000, D = 24 * H;
const iso = (ms: number) => new Date(ms).toISOString();

const TEAMS = [
  { id: "qa-t-aurora", name: "Aurora Nova", tag: "AUR", region: "EMEA" },
  { id: "qa-t-basalto", name: "Basalto Club", tag: "BAS", region: "EMEA" },
  { id: "qa-t-cierzo", name: "Cierzo Esports", tag: "CZO", region: "Americas" },
  { id: "qa-t-duna", name: "Duna Gaming", tag: "DUN", region: "Pacific" },
  { id: "qa-t-eter", name: "Éter Squad", tag: "ETR", region: "EMEA" },
  { id: "qa-t-fulgor", name: "Fulgor", tag: "FLG", region: "China" },
  { id: "qa-t-granizo", name: "Granizo", tag: "GRZ", region: "Americas" },
  { id: "qa-t-halo", name: "Halo Norte", tag: "HLN", region: "Pacific" },
];
const T = Object.fromEntries(TEAMS.map((t) => [t.id, t]));

const STAGES = [
  { id: "qa-s-groups", name: "Fase de grupos", kind: "group", orderIdx: 0 },
  { id: "qa-s-playoffs", name: "Playoffs", kind: "playoff", orderIdx: 1 },
];

type Row = EventHubSnapshot["matches"][number];
function match(id: string, a: string | null, b: string | null, status: "upcoming" | "live" | "finished", at: number, opts: Partial<Row> & { sa?: number | null; sb?: number | null; win?: "a" | "b" | null; stage?: string; round?: string; order?: number; to?: [string, 1 | 2] | null } = {}): Row {
  const win = opts.win ?? null;
  const winnerId = win === "a" ? a : win === "b" ? b : null;
  const label: Row["label"] = status === "live" ? "EN CURSO" : status === "finished" ? "FINALIZADO" : "PROGRAMADO";
  return {
    id, event_id: "qa-ev-live", team_a: a ? T[a].name : null, team_b: b ? T[b].name : null, team_a_id: a, team_b_id: b, start_time: iso(at), status,
    score_a: opts.sa ?? (status === "upcoming" ? null : 0), score_b: opts.sb ?? (status === "upcoming" ? null : 0), winner_team_id: winnerId, winner_team: winnerId ? T[winnerId].name : null,
    round: opts.round ?? "Ronda 1", match_order: opts.order ?? 1, stage_id: opts.stage ?? "qa-s-groups", format: "bo3", best_of: 3,
    winner_to_match_id: opts.to?.[0] ?? null, winner_to_slot: opts.to?.[1] ?? null, loser_to_match_id: null, loser_to_slot: null,
    winner_qualifies: null, winner_qualifies_label: null, progression_evidence: opts.to ? "SOURCE_EXPLICIT" : null, progression_confidence: opts.to ? "CONFIRMED" : null,
    label, winner: win, stageName: (STAGES.find((s) => s.id === (opts.stage ?? "qa-s-groups"))?.name) ?? null,
  };
}

/** Un torneo en curso: grupos terminados, playoffs con un partido en directo y el resto programado. */
export const MATCHES_LIVE: Row[] = [
  match("qa-m-g1", "qa-t-aurora", "qa-t-basalto", "finished", QA_NOW - 3 * D, { sa: 2, sb: 0, win: "a", round: "Jornada 1", order: 1 }),
  match("qa-m-g2", "qa-t-cierzo", "qa-t-duna", "finished", QA_NOW - 3 * D + 3 * H, { sa: 1, sb: 2, win: "b", round: "Jornada 1", order: 2 }),
  match("qa-m-g3", "qa-t-eter", "qa-t-fulgor", "finished", QA_NOW - 2 * D, { sa: 2, sb: 1, win: "a", round: "Jornada 2", order: 3 }),
  match("qa-m-g4", "qa-t-granizo", "qa-t-halo", "finished", QA_NOW - 2 * D + 3 * H, { sa: 0, sb: 2, win: "b", round: "Jornada 2", order: 4 }),
  match("qa-m-q1", "qa-t-aurora", "qa-t-duna", "finished", QA_NOW - D, { sa: 2, sb: 1, win: "a", stage: "qa-s-playoffs", round: "Quarterfinals", order: 10, to: ["qa-m-s1", 1] }),
  match("qa-m-q2", "qa-t-eter", "qa-t-halo", "finished", QA_NOW - D + 3 * H, { sa: 0, sb: 2, win: "b", stage: "qa-s-playoffs", round: "Quarterfinals", order: 11, to: ["qa-m-s1", 2] }),
  match("qa-m-q3", "qa-t-basalto", "qa-t-cierzo", "live", QA_NOW - 40 * 60_000, { sa: 1, sb: 1, stage: "qa-s-playoffs", round: "Quarterfinals", order: 12, to: ["qa-m-s2", 1] }),
  match("qa-m-q4", "qa-t-fulgor", "qa-t-granizo", "upcoming", QA_NOW + 2 * H, { stage: "qa-s-playoffs", round: "Quarterfinals", order: 13, to: ["qa-m-s2", 2] }),
  match("qa-m-s1", "qa-t-aurora", "qa-t-halo", "upcoming", QA_NOW + D, { stage: "qa-s-playoffs", round: "Semifinals", order: 20, to: ["qa-m-f", 1] }),
  match("qa-m-s2", null, null, "upcoming", QA_NOW + D + 3 * H, { stage: "qa-s-playoffs", round: "Semifinals", order: 21, to: ["qa-m-f", 2] }),
  match("qa-m-f", null, null, "upcoming", QA_NOW + 2 * D, { stage: "qa-s-playoffs", round: "Grand Final", order: 30 }),
];
export const MATCHES_TWO_LIVE: Row[] = MATCHES_LIVE.map((m) => (m.id === "qa-m-q4" ? { ...m, status: "live", label: "EN CURSO", score_a: 0, score_b: 1, start_time: iso(QA_NOW - 10 * 60_000) } : m));
export const MATCHES_NO_LIVE: Row[] = MATCHES_LIVE.map((m) => (m.id === "qa-m-q3" ? { ...m, status: "upcoming", label: "PROGRAMADO", score_a: null, score_b: null, start_time: iso(QA_NOW + 45 * 60_000) } : m));
export const MATCHES_UPCOMING: Row[] = MATCHES_LIVE.map((m, i) => ({ ...m, status: "upcoming", label: "PROGRAMADO", score_a: null, score_b: null, winner_team_id: null, winner_team: null, winner: null, start_time: iso(QA_NOW + (3 + i) * D) }));
export const MATCHES_DONE: Row[] = MATCHES_LIVE.map((m, i) => {
  const a = m.team_a_id ?? "qa-t-aurora", b = m.team_b_id ?? "qa-t-halo";
  const win = i % 3 === 0 ? "b" : "a";
  return { ...m, team_a_id: a, team_b_id: b, team_a: T[a].name, team_b: T[b].name, status: "finished", label: "FINALIZADO", score_a: win === "a" ? 2 : 1, score_b: win === "b" ? 2 : 1, winner: win, winner_team_id: win === "a" ? a : b, winner_team: T[win === "a" ? a : b].name, start_time: iso(QA_NOW - (12 - i) * D) };
});
/** Liga sin cuadro: todo en una fase de grupos con jornadas. */
export const MATCHES_LEAGUE: Row[] = MATCHES_LIVE.slice(0, 4).map((m, i) => ({ ...m, stage_id: "qa-s-groups", stageName: "Fase de grupos", round: `Jornada ${i + 1}`, winner_to_match_id: null, winner_to_slot: null, progression_evidence: null, progression_confidence: null }));

const toLike = (r: Row): MatchLike => ({ id: r.id, status: r.status, startTime: r.start_time, teamA: r.team_a, teamB: r.team_b, teamAId: r.team_a_id, teamBId: r.team_b_id, scoreA: r.score_a, scoreB: r.score_b, winnerTeamId: r.winner_team_id, round: r.round, matchOrder: r.match_order, stageId: r.stage_id, bestOf: r.best_of });
const sum = (r: Row): MatchSummary => ({ id: r.id, status: r.status, label: r.label, teamA: r.team_a, teamB: r.team_b, teamAId: r.team_a_id, teamBId: r.team_b_id, scoreA: r.score_a, scoreB: r.score_b, winner: r.winner, startTime: r.start_time, round: r.round, stageName: r.stageName, bestOf: r.best_of ?? null });

const FRESH: SyncView = { freshness: "FRESH", notice: null, lastSuccessAt: iso(QA_NOW - 90_000) };
export const STALE: SyncView = { freshness: "STALE", notice: "Los datos del evento pueden tardar en actualizarse.", lastSuccessAt: iso(QA_NOW - 3 * H) };

const PLAYERS: PlayerView[] = TEAMS.flatMap((t, ti) => Array.from({ length: 5 }, (_, i) => ({
  id: `qa-p-${ti}-${i}`, nick: `${t.tag.toLowerCase()}${["ace", "bolt", "cinder", "drift", "echo"][i]}`, teamId: t.id, teamName: t.name,
  role: i === 4 ? null : ["Duelista", "Iniciador", "Controlador", "Centinela"][i], country: "ES", substitute: i === 4,
  cardIds: i < 3 ? [`qa-card-${ti}-${i}__base`, ...(i === 0 ? [`qa-card-${ti}-${i}__champions`] : [])] : [],
})));
const CARDS: EventCardItem[] = PLAYERS.flatMap((p) => p.cardIds.map((id, k) => ({ cardId: id, playerId: p.id, nick: p.nick, variantId: k === 0 ? "base" : "champions", ovr: 78 + (p.id.length % 15) + k * 4, owned: false, teamName: p.teamName })));
const owned = new Set(CARDS.filter((_, i) => i % 3 === 0).map((c) => c.cardId));
const CARDS_OWNED = CARDS.map((c) => ({ ...c, owned: owned.has(c.cardId) }));

function teams(rows: Row[], opts: { packs?: string[]; standings?: boolean } = {}): TeamView[] {
  const rec = teamRecords(rows.map(toLike));
  return TEAMS.map((t, i) => ({
    id: t.id, name: t.name, tag: t.tag, region: t.region,
    identity: i % 4 === 3 ? null : { canonicalId: t.id, displayName: t.name, tag: t.tag, verified: i !== 2 },
    record: rec.get(t.id) ?? null, eventStatus: opts.standings ? (i < 4 ? "qualified" : "eliminated") : null, players: 5,
    pack: opts.packs?.includes(t.id) ? { id: `team-${t.tag.toLowerCase()}`, name: `Sobre ${t.name}` } : null,
  }));
}

const PICKEM_PENDING: PickemView = {
  id: "qa-pe-1", status: "open", title: "Pick'em QA", locksAt: iso(QA_NOW + 2 * D), open: 5, answered: 7, pending: 3, total: 11, resolved: 6, correct: 4,
  nextLockAt: iso(QA_NOW + 2 * H), score: { points: 40, correct: 4, total: 6 }, tier: { id: "acertante", label: "Acertante" },
  byMatch: { "qa-m-g1": { questionId: "q1", state: "correct", locked: true }, "qa-m-g2": { questionId: "q2", state: "wrong", locked: true }, "qa-m-q3": { questionId: "q3", state: "locked", locked: true }, "qa-m-q4": { questionId: "q4", state: "open", locked: false }, "qa-m-s1": { questionId: "q5", state: "picked", locked: false } },
};
const PICKEM_DONE: PickemView = { ...PICKEM_PENDING, pending: 0, answered: 11, byMatch: { ...PICKEM_PENDING.byMatch, "qa-m-q4": { questionId: "q4", state: "picked", locked: false } } };
const PICKEM_CLOSED: PickemView = { ...PICKEM_DONE, status: "scored", open: 0, resolved: 11, correct: 8, nextLockAt: null, score: { points: 92, correct: 8, total: 11 }, tier: { id: "oraculo", label: "Oráculo" } };

const OBJECTIVES = (progress: number[], claimed: number[] = []) => {
  const defs = [
    { id: "participar", label: "Entra al torneo", description: "Envía una predicción del evento.", goal: 1, reward: { credits: 500, xp: 50 } },
    { id: "pronostico", label: "Ojo clínico", description: "Acierta 3 predicciones del evento.", goal: 3, reward: { credits: 1000, xp: 100 } },
    { id: "competir", label: "En forma", description: "Juega 5 duelos mientras dure el evento.", goal: 5, reward: { credits: 800, xp: 120 } },
    { id: "dominar", label: "Racha de torneo", description: "Gana 3 duelos mientras dure el evento.", goal: 3, reward: { credits: 1200, xp: 180, packId: "estandar", packCount: 1 } },
    { id: "coleccionar", label: "Fiebre de sobres", description: "Abre 5 sobres mientras dure el evento.", goal: 5, reward: { credits: 500, xp: 80 } },
  ];
  const items = defs.map((d, i) => { const p = Math.min(progress[i] ?? 0, d.goal); const complete = p >= d.goal; const c = claimed.includes(i); return { ...d, progress: p, complete, claimed: c, claimable: complete && !c }; });
  return { set: "Torneo del circuito", items, claimable: items.filter((i) => i.claimable).length, pending: items.filter((i) => !i.complete).length, totalReward: { credits: 4000, xp: 530, packId: "estandar", packCount: 1 }, signedIn: true };
};
const NO_OBJECTIVES: EventHubSnapshot["objectives"] = { set: "Torneo del circuito", items: [], claimable: 0, pending: 0, totalReward: { credits: 0, xp: 0 }, signedIn: true };

const TIERS = (points: number) => [
  { id: "participacion", label: "Participación", minPoints: 1, reward: { credits: 500, xp: 50 }, reached: points >= 1 },
  { id: "acertante", label: "Acertante", minPoints: 20, reward: { credits: 1500, xp: 150, packId: "estandar", packCount: 1 }, reached: points >= 20 },
  { id: "analista", label: "Analista", minPoints: 50, reward: { credits: 3000, xp: 300, packId: "premium", packCount: 1 }, reached: points >= 50 },
  { id: "oraculo", label: "Oráculo", minPoints: 90, reward: { credits: 6000, xp: 600, packId: "champions", packCount: 1 }, reached: points >= 90 },
];

export function hub(over: {
  id?: string; name?: string; rows?: Row[]; pickem?: PickemView | null; objectives?: EventHubSnapshot["objectives"]; packs?: string[]; standings?: boolean; signedIn?: boolean; sync?: SyncView; cards?: EventCardItem[]; isDemo?: boolean;
  start?: number; end?: number; status?: string | null;
} = {}): EventHubSnapshot {
  const rows = over.rows ?? MATCHES_LIVE;
  const id = over.id ?? "qa-ev-live";
  const signedIn = over.signedIn ?? true;
  const event = { id, name: over.name ?? "QA Invitational 2026", status: over.status ?? null, startDate: iso(over.start ?? QA_NOW - 4 * D), endDate: iso(over.end ?? QA_NOW + 3 * D), region: "Internacional", type: "international", source: over.isDemo ? "demo" : "vlr" };
  const state = deriveEventState({ event, matches: rows.map(toLike), stages: STAGES, now: QA_NOW });
  const cards = over.cards ?? (signedIn ? CARDS_OWNED : CARDS);
  const collection = cards.length ? collectionProgress(cards.map((c) => c.cardId), signedIn ? cards.filter((c) => c.owned).map((c) => c.cardId) : []) : null;
  const objectives = over.objectives ?? OBJECTIVES([1, 4, 2, 1, 5], [0]);
  const pickem = over.pickem === undefined ? PICKEM_PENDING : over.pickem;
  const participants = teams(rows, { packs: over.packs ?? ["qa-t-aurora", "qa-t-cierzo"], standings: over.standings });
  const packs = participants.filter((t) => t.pack).map((t) => ({ id: t.pack!.id, name: t.pack!.name, teamName: t.name }));
  const points = pickem?.score?.points ?? 0;
  return {
    event: { id, name: event.name, region: event.region, type: event.type, isDemo: !!over.isDemo, startDate: event.startDate, endDate: event.endDate, location: "Madrid", prizePool: 250000 },
    state: { lifecycle: state.lifecycle, label: LIFECYCLE_LABEL[state.lifecycle], progress: { completed: state.completedMatches, total: state.totalMatches, pct: state.progressPct }, currentStage: state.currentStage?.name ?? null, liveCount: state.liveMatches.length, firstMatchAt: state.firstMatchAt, lastMatchAt: state.lastMatchAt },
    format: null,
    stages: STAGES.map((s) => ({ ...s, total: rows.filter((m) => m.stage_id === s.id).length, completed: rows.filter((m) => m.stage_id === s.id && m.status === "finished").length })),
    liveMatches: state.liveMatches.map((m) => sum(rows.find((r) => r.id === m.id)!)), nextMatches: state.nextMatches.map((m) => sum(rows.find((r) => r.id === m.id)!)), recentResults: state.recentResults.map((m) => sum(rows.find((r) => r.id === m.id)!)),
    matches: rows,
    standings: over.standings ? TEAMS.map((t, i) => ({ teamId: t.id, teamName: t.name, position: i + 1, wins: 3 - Math.floor(i / 3), losses: Math.floor(i / 3), ties: 0, mapDiff: 4 - i, roundDiff: 20 - 5 * i, points: (3 - Math.floor(i / 3)) * 3, group: i < 4 ? "A" : "B", stageId: "qa-s-groups", status: i < 4 ? "qualified" : "eliminated" })) : [],
    participants, players: PLAYERS, cards, collection, packs, pickem, objectives,
    rewards: { pickemTiers: TIERS(signedIn ? points : 0), challengesTotal: objectives.totalReward, claimed: objectives.items.filter((i) => i.claimed).length, earnedTier: pickem?.tier?.id ?? null },
    actions: eventActions({ eventId: id, pickem: pickem ? { pending: pickem.pending, nextLockAt: pickem.nextLockAt } : null, objectives: { claimable: objectives.claimable, pending: signedIn ? objectives.pending : 0 }, liveMatches: state.liveMatches, nextMatch: state.nextMatch, collection, packs, now: QA_NOW }),
    activity: eventActivity({ matches: rows.map(toLike), resolvedPicks: [{ matchId: "qa-m-g1", correct: true, at: iso(QA_NOW - 3 * D + 4 * H) }, { matchId: "qa-m-g2", correct: false, at: iso(QA_NOW - 3 * D + 7 * H) }], max: 8 }),
    sync: over.sync ?? FRESH, signedIn, serverNow: QA_NOW,
  };
}

export const HUB_LIVE = hub();
export const HUB_TWO_LIVE = hub({ rows: MATCHES_TWO_LIVE });
export const HUB_NO_LIVE = hub({ rows: MATCHES_NO_LIVE });
export const HUB_UPCOMING = hub({ id: "qa-ev-next", name: "QA Open Otoño", rows: MATCHES_UPCOMING, start: QA_NOW + 3 * D, end: QA_NOW + 14 * D, status: "upcoming", pickem: { ...PICKEM_PENDING, open: 11, answered: 0, pending: 11, total: 11, resolved: 0, correct: 0, score: null, tier: null, byMatch: {} }, objectives: OBJECTIVES([0, 0, 0, 0, 0]) });
export const HUB_COMPLETED = hub({ id: "qa-ev-done", name: "QA Clásico de Verano", rows: MATCHES_DONE, start: QA_NOW - 14 * D, end: QA_NOW - 2 * D, status: "finished", pickem: PICKEM_CLOSED, objectives: OBJECTIVES([1, 4, 5, 3, 5], [0, 1, 2, 3, 4]), standings: true });
export const HUB_NO_PICKEMS = hub({ pickem: null });
export const HUB_PICKEMS_DONE = hub({ pickem: PICKEM_DONE });
export const HUB_LEAGUE = hub({ rows: MATCHES_LEAGUE, standings: true });
export const HUB_NO_PACK = hub({ packs: [] });
export const HUB_NO_OBJECTIVES = hub({ objectives: NO_OBJECTIVES });
export const HUB_REWARD = hub({ objectives: OBJECTIVES([1, 4, 5, 3, 5], [0]) });
export const HUB_NO_CARDS = hub({ cards: [] });
export const HUB_STALE = hub({ sync: STALE });
export const HUB_ANON = hub({ signedIn: false, pickem: { ...PICKEM_PENDING, pending: 0, answered: 0, score: null, tier: null, byMatch: {} }, objectives: { ...OBJECTIVES([0, 0, 0, 0, 0]), signedIn: false } });
export const HUB_DEMO = hub({ isDemo: true });

function card(h: EventHubSnapshot, lifecycle?: EventLifecycle): EventCardView {
  return {
    id: h.event.id, name: h.event.name, region: h.event.region, type: h.event.type, isDemo: h.event.isDemo,
    lifecycle: lifecycle ?? h.state.lifecycle, label: LIFECYCLE_LABEL[lifecycle ?? h.state.lifecycle], startDate: h.event.startDate, endDate: h.event.endDate,
    progress: h.state.progress, liveCount: h.state.liveCount, liveMatch: h.liveMatches[0] ?? null, nextMatch: h.nextMatches[0] ?? null,
    participants: h.participants.length, currentStage: h.state.currentStage, pickem: h.pickem ? { open: h.pickem.open, pending: h.pickem.pending, nextLockAt: null } : null,
  };
}

export const OVERVIEW: EventsOverviewSnapshot = { active: [card(HUB_LIVE)], upcoming: [card(HUB_UPCOMING)], completed: [card(HUB_COMPLETED)], mainEventId: "qa-ev-live", sync: FRESH, serverNow: QA_NOW };
export const OVERVIEW_MULTI: EventsOverviewSnapshot = { ...OVERVIEW, active: [card(HUB_LIVE), card({ ...HUB_NO_LIVE, event: { ...HUB_NO_LIVE.event, id: "qa-ev-live-2", name: "QA Regional Sur", region: "Americas" } })] };
export const OVERVIEW_EMPTY: EventsOverviewSnapshot = { active: [], upcoming: [], completed: [], mainEventId: null, sync: { freshness: "UNKNOWN", notice: null, lastSuccessAt: null }, serverNow: QA_NOW };
export const OVERVIEW_STALE: EventsOverviewSnapshot = { ...OVERVIEW, sync: STALE };

const STATS = (order: number) => TEAMS.slice(1, 3).flatMap((t, ti) => Array.from({ length: 5 }, (_, i) => ({
  mapOrder: order, playerId: `qa-p-${ti + 1}-${i}`, nick: PLAYERS.find((p) => p.id === `qa-p-${ti + 1}-${i}`)!.nick, teamId: t.id, agent: ["jett", "sova", "omen", "killjoy", "raze"][i],
  acs: 180 + i * 17 + order * 3, kills: 10 + i * 2, deaths: 12 - i, assists: 3 + i, adr: 120 + i * 9, rating: Number((0.85 + i * 0.09).toFixed(2)),
})));

export const MATCH_LIVE: EventMatchSnapshot = {
  event: { id: "qa-ev-live", name: "QA Invitational 2026", isDemo: false },
  match: { ...sum(MATCHES_LIVE.find((m) => m.id === "qa-m-q3")!), format: "bo3", stageId: "qa-s-playoffs" },
  teams: { a: teams(MATCHES_LIVE)[1], b: teams(MATCHES_LIVE)[2] },
  maps: [
    { order: 1, name: "Ascent", tbd: false, scoreA: 13, scoreB: 9, winner: "a", duration: 2640 },
    { order: 2, name: "Lotus", tbd: false, scoreA: 8, scoreB: 13, winner: "b", duration: 2410 },
    { order: 3, name: "TBD", tbd: true, scoreA: null, scoreB: null, winner: null, duration: null },
  ],
  stats: [...STATS(1), ...STATS(2)],
  question: { id: "q3", kind: "match_winner", prompt: "¿Quién gana Basalto Club vs Cierzo Esports?", options: [{ key: "bas", label: "Basalto Club" }, { key: "czo", label: "Cierzo Esports" }], points: 10, locksAt: iso(QA_NOW - 40 * 60_000), locked: true, correctOption: null, myOption: "bas", myCorrect: null },
  sync: FRESH, signedIn: true, serverNow: QA_NOW,
};
export const MATCH_DONE: EventMatchSnapshot = {
  ...MATCH_LIVE,
  match: { ...sum(MATCHES_LIVE.find((m) => m.id === "qa-m-q1")!), format: "bo3", stageId: "qa-s-playoffs" },
  teams: { a: teams(MATCHES_LIVE)[0], b: teams(MATCHES_LIVE)[3] },
  maps: [
    { order: 1, name: "Bind", tbd: false, scoreA: 13, scoreB: 7, winner: "a", duration: 2300 },
    { order: 2, name: "Haven", tbd: false, scoreA: 11, scoreB: 13, winner: "b", duration: 2800 },
    { order: 3, name: "Sunset", tbd: false, scoreA: 13, scoreB: 10, winner: "a", duration: 2650 },
  ],
  question: { id: "q1", kind: "match_winner", prompt: "¿Quién gana Aurora Nova vs Duna Gaming?", options: [{ key: "aur", label: "Aurora Nova" }, { key: "dun", label: "Duna Gaming" }], points: 10, locksAt: iso(QA_NOW - D), locked: true, correctOption: "aur", myOption: "aur", myCorrect: true },
};
export const MATCH_TBD: EventMatchSnapshot = {
  ...MATCH_LIVE,
  match: { ...sum(MATCHES_LIVE.find((m) => m.id === "qa-m-q4")!), format: "bo3", stageId: "qa-s-playoffs" },
  teams: { a: teams(MATCHES_LIVE)[5], b: teams(MATCHES_LIVE)[6] },
  maps: [{ order: 1, name: "TBD", tbd: true, scoreA: null, scoreB: null, winner: null, duration: null }, { order: 2, name: "TBD", tbd: true, scoreA: null, scoreB: null, winner: null, duration: null }],
  stats: [],
  question: { id: "q4", kind: "match_winner", prompt: "¿Quién gana Fulgor vs Granizo?", options: [{ key: "flg", label: "Fulgor" }, { key: "grz", label: "Granizo" }], points: 10, locksAt: iso(QA_NOW + 2 * H), locked: false, correctOption: null, myOption: null, myCorrect: null },
};
