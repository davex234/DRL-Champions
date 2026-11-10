/**
 * F87 · FIXTURES DEL ARNÉS DE QA (sin servidor). Construye `BracketView` con el MISMO dominio que el servidor.
 *
 *   · Grupos y playoffs de Champions 2026 = snapshot REAL (`vlr-2766`, capturado de producción en solo lectura).
 *   · Los playoffs NO publican los cruces de perdedores: el arnés usa aristas de admin DE PRUEBA (etiquetadas) para
 *     poder pintar el cuadro bajo; no afirman nada sobre el cuadro oficial.
 *   · Escenas con resultados de playoffs = resultados SIMULADOS para QA visual (etiquetados en pantalla).
 *   · Eliminación simple y todos contra todos = fixtures FICTICIOS de pruebas.
 * Los tiempos de las escenas «abiertas» se desplazan a «ahora + horas» para que la cuenta atrás tenga sentido.
 */
import snapshot from "@/domain/pickems/fixtures/vlr-2766-champions-2026.snapshot.json";
import { deriveFormat, type FormatEdge, type RealMatchRow, type StageRow, FORMAT_LABEL } from "@/domain/pickems/format";
import { fillBracket, pendingPicks, phaseOf, rankRows, realStateOf, scoreEntry } from "@/domain/pickems/prediction";
import { proposedRewards, type RewardTierId } from "@/domain/pickems/bracketRewards";
import { publicRewards, type BracketView, type BracketStatus } from "@/server/services/pickemBrackets";
import { rrPlayoffs, se8 } from "@/domain/pickems/testing/formatFixtures";
import { evaluateEligibility, REWARD_ELIGIBILITY_V1, type Eligibility } from "@/domain/pickems/eligibility";

const REAL = snapshot.matches as unknown as RealMatchRow[];
const STAGES = snapshot.stages as StageRow[];
const G = STAGES.find((s) => s.kind === "group")!;
const P = STAGES.find((s) => s.kind === "playoff")!;
export const TEST_ADMIN_EDGES: Omit<FormatEdge, "origin">[] = [
  { from: "754732", to: "754738", source: "LOSER", slot: 1 }, { from: "754733", to: "754738", source: "LOSER", slot: 2 },
  { from: "754730", to: "754739", source: "LOSER", slot: 1 }, { from: "754731", to: "754739", source: "LOSER", slot: 2 },
  { from: "754734", to: "754741", source: "LOSER", slot: null }, { from: "754735", to: "754740", source: "LOSER", slot: null },
];

function shift(rows: RealMatchRow[], firstInHours: number): RealMatchRow[] {
  const first = Math.min(...rows.map((r) => Date.parse(r.start_time ?? "")).filter(Number.isFinite));
  const delta = Date.now() + firstInHours * 3_600_000 - first;
  return rows.map((r) => ({ ...r, start_time: r.start_time ? new Date(Date.parse(r.start_time) + delta).toISOString() : null }));
}
const finish = (rows: RealMatchRow[], id: string, side: "a" | "b", sc: [number, number] = [2, 1]): RealMatchRow[] =>
  rows.map((m) => (m.id !== id ? m : { ...m, status: "finished", winner_team_id: side === "a" ? m.team_a_id : m.team_b_id, score_a: side === "a" ? sc[0] : sc[1], score_b: side === "a" ? sc[1] : sc[0], start_time: new Date(Date.now() - 6 * 3_600_000).toISOString() }));
const placeTeams = (rows: RealMatchRow[], id: string, a: { id: string; name: string }, b: { id: string; name: string }): RealMatchRow[] =>
  rows.map((m) => (m.id !== id ? m : { ...m, team_a_id: a.id, team_a: a.name, team_b_id: b.id, team_b: b.name }));

interface Opts {
  title: string; slug: string; status?: BracketStatus; matches: RealMatchRow[]; stages: StageRow[]; adminEdges?: Omit<FormatEdge, "origin">[];
  picks?: Record<string, string> | ((v: { descriptor: NonNullable<ReturnType<typeof deriveFormat>["descriptor"]>; real: ReturnType<typeof realStateOf> }) => Record<string, string>);
  signedIn?: boolean; voided?: string[]; rewards?: boolean; tier?: RewardTierId | null; claimed?: boolean; eventName?: string;
  /** F87.2 · elegibilidad de la cuenta (por defecto, elegible). */
  eligibility?: Eligibility;
}

/** F87.2 · elegibilidad de PRUEBA con el MISMO evaluador que espeja a la BD. */
export function qaEligibility(kind: "eligible" | "new" | "matches", referenceAt: string, now = Date.now()): Eligibility {
  const ref = Date.parse(referenceAt);
  const created = kind === "new" ? new Date(ref - 2 * 86_400_000).toISOString() : new Date(ref - 40 * 86_400_000).toISOString();
  return evaluateEligibility({ policyId: REWARD_ELIGIBILITY_V1, accountCreatedAt: created, completedMatches: kind === "matches" ? 1 : 12, referenceAt, now });
}

export function makeView(o: Opts): { view: BracketView; picks: Record<string, string> } {
  const d = deriveFormat({ eventId: "vlr-2766", stages: o.stages, matches: o.matches, adminEdges: o.adminEdges }).descriptor!;
  const real = realStateOf(o.matches);
  const voided = new Set(o.voided ?? []);
  const status = o.status ?? "PUBLISHED";
  const now = Date.now();
  const nodes = d.nodes.map((n) => {
    const m = o.matches.find((x) => x.id === n.matchId)!;
    const at = m.start_time ? Date.parse(m.start_time) : null;
    const locked = status !== "PUBLISHED" || voided.has(n.matchId) || (m.status ?? "upcoming") !== "upcoming" || (at !== null && now >= at);
    return { matchId: n.matchId, lockAt: m.start_time, locked, voided: voided.has(n.matchId), points: n.points };
  });
  const ctx = { descriptor: d, real, voided };
  const picks = typeof o.picks === "function" ? o.picks({ descriptor: d, real }) : o.picks ?? {};
  const lockedSet = new Set(nodes.filter((n) => n.locked).map((n) => n.matchId));
  const s = scoreEntry(ctx, picks, (id) => lockedSet.has(id));
  const isOpen = (id: string) => !lockedSet.has(id);
  const open = nodes.filter((n) => !n.locked);
  const phase = phaseOf(status, { anyOpen: open.length > 0, anyPickable: pendingPicks(ctx, {}, isOpen).length > 0, allDecided: d.nodes.every((n) => voided.has(n.matchId) || real.get(n.matchId)?.final) });
  const rewards = o.rewards ? publicRewards({ ...proposedRewards(o.slug), status: "ACTIVE" }) : null;
  const board = rankRows([
    { userId: "me", points: s.points, correct: s.correct },
    { userId: "a", points: s.points + 3, correct: s.correct + 1 },
    { userId: "b", points: Math.max(0, s.points - 2), correct: Math.max(0, s.correct - 1) },
    { userId: "c", points: s.points, correct: s.correct },
  ]);
  const NAMES: Record<string, [string, string]> = { me: ["qa_tu_cuenta", "#QA87AAA"], a: ["qa_jugador_uno", "#QA87BBB"], b: ["qa_jugador_dos", "#QA87CCC"], c: ["qa_jugador_tres", "#QA87DDD"] };
  const rows = board.map((r) => ({ position: r.position, username: NAMES[r.userId][0], tag: NAMES[r.userId][1], points: r.points, correct: r.correct, ...(r.userId === "me" && o.signedIn !== false ? { me: true } : {}) }));
  const future = open.map((n) => Date.parse(n.lockAt ?? "")).filter(Number.isFinite).sort((a, b) => a - b);
  const signedIn = o.signedIn !== false;
  return {
    picks: signedIn ? picks : {},
    view: {
      id: "qa", slug: o.slug, title: o.title, eventId: "vlr-2766", eventName: o.eventName ?? "Valorant Champions 2026", status, phase,
      formatKind: d.kind, formatLabel: FORMAT_LABEL[d.kind], descriptor: d, matches: o.matches, nodes, maxPoints: d.nodes.reduce((t, n) => t + n.points, 0),
      scoringVersion: "pickem-scoring-v1", nextLockAt: future.length ? new Date(future[0]).toISOString() : null, serverNow: new Date(now).toISOString(),
      rewards, rewardsNote: rewards ? "Recompensas de PRUEBA del arnés (la propuesta F87 sigue sin activar)." : "Recompensas aún no activadas para este Pick'em. Cuenta para la clasificación.",
      leaderboard: { participants: rows.length, provisional: status !== "SETTLED", rows: signedIn ? rows : rows.map(({ me: _m, ...r }) => r), me: null },
      me: signedIn ? {
        revision: Object.keys(picks).length, picks,
        score: { points: s.points, maxPoints: s.maxPoints, correct: s.correct, wrong: s.wrong, missed: s.missed, voided: s.voided, pending: s.pending, picked: s.picked, scorable: s.scorable, completion: s.completion, ratio: s.ratio, perfect: s.perfect, decided: s.decided },
        pending: pendingPicks(ctx, picks, isOpen).length, tier: o.tier ?? null, position: rows.find((r) => "me" in r)?.position ?? null,
        claim: o.claimed && o.tier ? { tier: o.tier, claimedAt: new Date().toISOString(), items: ["Sobre Masters", "Insignia «Pick'em perfecto»"] } : null,
        claimable: !!rewards && status === "SETTLED" && !!o.tier && !o.claimed && (o.eligibility?.eligible ?? true),
        rewardEligibility: rewards ? o.eligibility ?? qaEligibility("eligible", o.matches.map((m) => m.start_time).filter(Boolean).sort()[0] ?? new Date(now).toISOString(), now) : null,
      } : null,
    },
  };
}

const playoffsBase = () => shift(REAL.filter((m) => m.stage_id === P.id), 5);
const groupsReal = () => REAL.filter((m) => m.stage_id === G.id);

export function scene(name: string) {
  switch (name) {
    case "playoffs": return makeView({ title: "Champions 2026 · Playoffs", slug: "champions-2026-playoffs", stages: [P], matches: playoffsBase(), adminEdges: TEST_ADMIN_EDGES,
      picks: { "754732": "vlr-t-1034", "754733": "vlr-t-624", "754735": "vlr-t-1034", "754730": "vlr-t-11058" } });
    case "playoffs-anon": return makeView({ title: "Champions 2026 · Playoffs", slug: "champions-2026-playoffs", stages: [P], matches: playoffsBase(), adminEdges: TEST_ADMIN_EDGES, signedIn: false });
    case "playoffs-progress": {
      let ms = playoffsBase();
      ms = finish(ms, "754732", "a"); ms = finish(ms, "754733", "b"); // SIMULADOS
      const t = (id: string, side: "a" | "b") => { const m = ms.find((x) => x.id === id)!; return { id: (side === "a" ? m.team_a_id : m.team_b_id)!, name: (side === "a" ? m.team_a : m.team_b)! }; };
      ms = placeTeams(ms, "754735", t("754732", "a"), t("754733", "b"));
      ms = placeTeams(ms, "754738", t("754732", "b"), t("754733", "a"));
      return makeView({ title: "Champions 2026 · Playoffs", slug: "champions-2026-playoffs", stages: [P], matches: ms, adminEdges: TEST_ADMIN_EDGES,
        picks: { "754732": "vlr-t-1034", "754733": "vlr-t-624", "754735": "vlr-t-1034", "754730": "vlr-t-120" }, voided: [] });
    }
    case "groups": return makeView({ title: "Champions 2026 · Grupos", slug: "champions-2026-grupos", status: "SETTLED", stages: [G], matches: groupsReal(), rewards: true, tier: "GREAT",
      picks: ({ descriptor, real }) => fillBracket({ descriptor, real }, (id, pair) => { const w = real.get(id)?.winnerId; return id.endsWith("5") && w ? (pair[0].id === w ? pair[1].id : pair[0].id) : w ?? pair[0].id; }) });
    case "groups-claimed": return makeView({ title: "Champions 2026 · Grupos", slug: "champions-2026-grupos", status: "SETTLED", stages: [G], matches: groupsReal(), rewards: true, tier: "PERFECT", claimed: true,
      picks: ({ descriptor, real }) => fillBracket({ descriptor, real }, (id, pair) => real.get(id)?.winnerId ?? pair[0].id) });
    case "single": { const f = se8(); return makeView({ title: "Prueba · Eliminación simple a 8", slug: "qa-simple-8", eventName: "Fixture FICTICIO", stages: f.stages, matches: shift(f.matches, 3), picks: {} }); }
    case "rr": { const f = rrPlayoffs().groups; return makeView({ title: "Prueba · Todos contra todos", slug: "qa-rr", eventName: "Fixture FICTICIO", stages: f.stages, matches: shift(f.matches, 2), picks: { "rr-1": "t-01" } }); }
    case "groups-ineligible": return makeView({ title: "Champions 2026 · Grupos", slug: "champions-2026-grupos", status: "SETTLED", stages: [G], matches: groupsReal(), rewards: true, tier: "PERFECT",
      eligibility: qaEligibility("new", groupsReal().map((m) => m.start_time!).sort()[0]),
      picks: ({ descriptor, real }) => fillBracket({ descriptor, real }, (id, pair) => real.get(id)?.winnerId ?? pair[0].id) });
    case "playoffs-rewards-matches": { const ms = playoffsBase(); return makeView({ title: "Champions 2026 · Playoffs", slug: "champions-2026-playoffs", stages: [P], matches: ms, adminEdges: TEST_ADMIN_EDGES, rewards: true,
      eligibility: qaEligibility("matches", ms.map((m) => m.start_time!).sort()[0]), picks: { "754732": "vlr-t-1034" } }); }
    case "playoffs-rewards-eligible": { const ms = playoffsBase(); return makeView({ title: "Champions 2026 · Playoffs", slug: "champions-2026-playoffs", stages: [P], matches: ms, adminEdges: TEST_ADMIN_EDGES, rewards: true,
      eligibility: qaEligibility("eligible", ms.map((m) => m.start_time!).sort()[0]), picks: { "754732": "vlr-t-1034" } }); }
    case "void": return makeView({ title: "Champions 2026 · Playoffs", slug: "champions-2026-playoffs", stages: [P], matches: playoffsBase(), adminEdges: TEST_ADMIN_EDGES, voided: ["754731"], picks: { "754732": "vlr-t-14" } });
    default: return null;
  }
}
export const SCENES = ["playoffs", "playoffs-anon", "playoffs-progress", "groups", "groups-claimed", "groups-ineligible", "playoffs-rewards-matches", "playoffs-rewards-eligible", "single", "rr", "void"] as const;
