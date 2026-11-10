/**
 * F87 · PICK'EMS 2.0 — EL CUADRO DE PREDICCIÓN (funciones PURAS).
 *
 * Dos estados que NUNCA se mezclan:
 *
 *   ESTADO REAL       lo que trae el worker: equipos, marcador, ganador, estado del partido.
 *   ESTADO PREDICHO   los picks de UN jugador: `matchId → teamId`. Se guardan aparte y jamás se
 *                     escriben sobre el real.
 *
 * El cuadro que ve el jugador se DERIVA de los dos:
 *
 *   participantes(M)[hueco] =
 *     · semilla            → el equipo real de ese lado (o «por definir»);
 *     · ganador/perdedor F → si F ya tiene ganador REAL, el real (el cuadro se «cura» con la realidad);
 *                            si no, lo que el jugador predijo en F (ganador = su pick; perdedor = el
 *                            otro participante predicho de F); si no predijo, «por definir».
 *     · y si el partido real ya tiene sus dos equipos, esos (la realidad manda).
 *
 * Un pick es VÁLIDO si su equipo es uno de los dos participantes (conocidos) del partido. Un pick que
 * deja de serlo porque la realidad fue por otro lado se CONSERVA (es historia: se puntuará como
 * fallo) y no se propaga. Un pick que deja de serlo porque el JUGADOR cambió algo aguas arriba se
 * BORRA, solo en ese caso y solo si ese partido sigue abierto (`invalidatedBy`).
 *
 * Nada de esto decide si se puede guardar: el cierre lo decide la base de datos con su reloj.
 */
import {
  descendantsOf, maxPointsOf, slotSources, teamRef, topoOrder,
  type FormatDescriptor, type RealMatchRow, type TeamRef,
} from "./format";

export type Picks = Readonly<Record<string, string>>;

const FINISHED = new Set(["finished", "completed"]);
const VOID_STATUS = new Set(["cancelled", "canceled", "void", "voided"]);

export interface RealState {
  teamA: TeamRef | null;
  teamB: TeamRef | null;
  winnerId: string | null;
  loserId: string | null;
  final: boolean;
  status: string;
  scoreA: number | null;
  scoreB: number | null;
  startTime: string | null;
}

/** Estado real normalizado de cada partido del ámbito. */
export function realStateOf(rows: RealMatchRow[]): Map<string, RealState> {
  const out = new Map<string, RealState>();
  for (const r of rows) {
    const teamA = teamRef(r.team_a_id, r.team_a), teamB = teamRef(r.team_b_id, r.team_b);
    const status = (r.status ?? "upcoming").toLowerCase();
    const winnerId = r.winner_team_id && (r.winner_team_id === teamA?.id || r.winner_team_id === teamB?.id) ? r.winner_team_id : null;
    const loserId = winnerId ? (winnerId === teamA?.id ? teamB?.id ?? null : teamA?.id ?? null) : null;
    out.set(r.id, {
      teamA, teamB, winnerId, loserId, final: FINISHED.has(status) && !!winnerId, status,
      scoreA: r.score_a, scoreB: r.score_b, startTime: r.start_time,
    });
  }
  return out;
}

export interface PredictionContext {
  descriptor: FormatDescriptor;
  real: ReadonlyMap<string, RealState>;
  /** Partidos anulados (VOID) del ámbito. */
  voided?: ReadonlySet<string>;
}

export type Pair = [TeamRef | null, TeamRef | null];

/**
 * Participantes predichos de cada partido para UN jugador. Determinista, en orden topológico.
 */
export function predictedParticipants(ctx: PredictionContext, picks: Picks): Map<string, Pair> {
  const order = topoOrder(ctx.descriptor) ?? ctx.descriptor.nodes.map((n) => n.matchId);
  const sources = slotSources(ctx.descriptor);
  const out = new Map<string, Pair>();
  const names = new Map<string, TeamRef>();
  for (const r of ctx.real.values()) for (const t of [r.teamA, r.teamB]) if (t) names.set(t.id, t);

  const winnerOf = (id: string): TeamRef | null => {
    const r = ctx.real.get(id);
    if (r?.final && r.winnerId) return names.get(r.winnerId) ?? { id: r.winnerId, name: r.winnerId };
    const pair = out.get(id);
    const pick = picks[id];
    if (!pair || !pick) return null;
    return pair[0]?.id === pick ? pair[0] : pair[1]?.id === pick ? pair[1] : null;
  };
  const loserOf = (id: string): TeamRef | null => {
    const r = ctx.real.get(id);
    if (r?.final && r.loserId) return names.get(r.loserId) ?? { id: r.loserId, name: r.loserId };
    const pair = out.get(id);
    const w = winnerOf(id);
    if (!pair || !w || !pair[0] || !pair[1]) return null;
    return pair[0].id === w.id ? pair[1] : pair[0];
  };

  for (const id of order) {
    const real = ctx.real.get(id);
    if (real?.teamA && real.teamB) {
      // La realidad manda: si el partido ya tiene sus dos equipos, son esos. Se respeta el hueco
      // que el grafo predice para que la caja no «salte» de lado.
      const [s1] = sources.get(id) ?? [];
      let a = real.teamA, b = real.teamB;
      if (s1 && s1.kind === "FROM") {
        const expected = s1.source === "WINNER" ? winnerOf(s1.matchId) : loserOf(s1.matchId);
        if (expected && expected.id === b.id) [a, b] = [b, a];
      }
      out.set(id, [a, b]);
      continue;
    }
    const pair = (sources.get(id) ?? [{ kind: "SEED", index: 1 }, { kind: "SEED", index: 2 }]).map((s) => {
      if (s.kind === "SEED") return s.index === 1 ? real?.teamA ?? null : real?.teamB ?? null;
      return s.source === "WINNER" ? winnerOf(s.matchId) : loserOf(s.matchId);
    }) as Pair;
    out.set(id, pair);
  }
  return out;
}

const inPair = (pair: Pair | undefined, teamId: string | null | undefined): boolean =>
  !!pair && !!teamId && (pair[0]?.id === teamId || pair[1]?.id === teamId);
const complete = (pair: Pair | undefined): boolean => !!pair && !!pair[0] && !!pair[1] && pair[0].id !== pair[1].id;

export type PickCheck =
  | { ok: true }
  | { ok: false; code: "UNKNOWN_MATCH" | "PARTICIPANTS_UNKNOWN" | "TEAM_NOT_IN_MATCH" | "VOID" };

/** ¿Puede este jugador elegir `teamId` en `matchId` con sus picks actuales? (El cierre va aparte.) */
export function checkPick(ctx: PredictionContext, picks: Picks, matchId: string, teamId: string): PickCheck {
  if (!ctx.descriptor.nodes.some((n) => n.matchId === matchId)) return { ok: false, code: "UNKNOWN_MATCH" };
  if (ctx.voided?.has(matchId)) return { ok: false, code: "VOID" };
  const pair = predictedParticipants(ctx, picks).get(matchId);
  if (!complete(pair)) return { ok: false, code: "PARTICIPANTS_UNKNOWN" };
  if (!inPair(pair, teamId)) return { ok: false, code: "TEAM_NOT_IN_MATCH" };
  return { ok: true };
}

/**
 * Qué picks hay que BORRAR porque el jugador cambió (o quitó) su pick en `matchId`.
 *
 * Solo descendientes de `matchId`, solo los que eran válidos ANTES del cambio y dejan de serlo
 * DESPUÉS, y solo si siguen abiertos (`isOpen`). Lo independiente no se toca; un pick ya inválido
 * por la realidad tampoco (no lo invalida este cambio). Se itera hasta punto fijo: borrar un pick
 * puede vaciar el hueco de otro más abajo.
 */
export function invalidatedBy(
  ctx: PredictionContext, before: Picks, matchId: string, teamId: string | null, isOpen: (matchId: string) => boolean,
): { next: Record<string, string>; cleared: string[] } {
  const next: Record<string, string> = { ...before };
  if (teamId) next[matchId] = teamId; else delete next[matchId];
  const desc = descendantsOf(ctx.descriptor, matchId);
  const validBefore = predictedParticipants(ctx, before);
  const cleared: string[] = [];
  for (let guard = 0; guard <= desc.size; guard++) {
    const now = predictedParticipants(ctx, next);
    const hit = [...desc].filter((id) => next[id] && isOpen(id) && inPair(validBefore.get(id), before[id]) && !inPair(now.get(id), next[id]));
    if (hit.length === 0) break;
    for (const id of hit) { delete next[id]; cleared.push(id); }
  }
  return { next, cleared: cleared.sort() };
}

/* ═══════════════════════════════ PUNTUACIÓN ═══════════════════════════════ */

export type PickOutcome = "CORRECT" | "WRONG" | "MISSED" | "VOID" | "PENDING" | "OPEN";

export interface MatchScore {
  matchId: string;
  outcome: PickOutcome;
  pick: string | null;
  /** El pick ya no puede acertar (su equipo no juega este partido). */
  dead: boolean;
  points: number;
  awarded: number;
}

export interface ScoreSummary {
  points: number;
  maxPoints: number;
  correct: number;
  wrong: number;
  missed: number;
  voided: number;
  pending: number;
  picked: number;
  /** Partidos puntuables (no anulados). */
  scorable: number;
  /** picked / scorable, 0..1. */
  completion: number;
  /** points / maxPoints, 0..1. */
  ratio: number;
  /** Todos los puntuables decididos (finales o anulados). */
  decided: boolean;
  /** Todos los puntuables con pick y acertados (los anulados no cuentan). */
  perfect: boolean;
  matches: MatchScore[];
}

/**
 * Puntuación de un jugador. `isLocked` dice si un partido ya está cerrado (para distinguir «sin
 * predicción y cerrado» de «aún puedes»). Un partido VOID no suma ni resta y sale del máximo.
 */
export function scoreEntry(ctx: PredictionContext, picks: Picks, isLocked: (matchId: string) => boolean): ScoreSummary {
  const voided = ctx.voided ?? new Set<string>();
  const pairs = predictedParticipants(ctx, picks);
  const matches: MatchScore[] = [];
  let points = 0, correct = 0, wrong = 0, missed = 0, nVoid = 0, pending = 0, picked = 0;
  for (const n of ctx.descriptor.nodes) {
    const pick = picks[n.matchId] ?? null;
    const real = ctx.real.get(n.matchId);
    const dead = !!pick && complete(pairs.get(n.matchId)) && !inPair(pairs.get(n.matchId), pick);
    let outcome: PickOutcome;
    if (voided.has(n.matchId) || (real && VOID_STATUS.has(real.status))) { outcome = "VOID"; nVoid++; }
    else {
      if (pick) picked++;
      if (real?.final) outcome = !pick ? "MISSED" : pick === real.winnerId ? "CORRECT" : "WRONG";
      else outcome = pick ? "PENDING" : isLocked(n.matchId) ? "MISSED" : "OPEN";
      if (outcome === "CORRECT") correct++;
      else if (outcome === "WRONG") wrong++;
      else if (outcome === "MISSED") missed++;
      else if (outcome === "PENDING") pending++;
    }
    const awarded = outcome === "CORRECT" ? n.points : 0;
    points += awarded;
    matches.push({ matchId: n.matchId, outcome, pick, dead, points: n.points, awarded });
  }
  const scorable = ctx.descriptor.nodes.length - nVoid;
  const maxPoints = maxPointsOf(ctx.descriptor, new Set(matches.filter((m) => m.outcome === "VOID").map((m) => m.matchId)));
  const decided = matches.every((m) => m.outcome === "VOID" || ctx.real.get(m.matchId)?.final);
  return {
    points, maxPoints, correct, wrong, missed, voided: nVoid, pending, picked, scorable,
    completion: scorable > 0 ? picked / scorable : 0,
    ratio: maxPoints > 0 ? points / maxPoints : 0,
    decided,
    perfect: decided && scorable > 0 && correct === scorable,
    matches,
  };
}

/* ═══════════════════════════════ CLASIFICACIÓN ═══════════════════════════════ */

export interface LeaderRow { userId: string; points: number; correct: number }

/** Posiciones con empates: mismos puntos y aciertos = misma posición (1, 1, 3…). */
export function rankRows<T extends LeaderRow>(rows: T[], tieBreak: (a: T, b: T) => number = () => 0): (T & { position: number })[] {
  const sorted = [...rows].sort((a, b) => b.points - a.points || b.correct - a.correct || tieBreak(a, b) || a.userId.localeCompare(b.userId));
  let pos = 0;
  return sorted.map((r, i) => {
    const prev = sorted[i - 1];
    if (!prev || prev.points !== r.points || prev.correct !== r.correct) pos = i + 1;
    return { ...r, position: pos };
  });
}

/* ═══════════════════════════════ ESTADO DEL ÁMBITO ═══════════════════════════════ */

export type BracketPhase = "DRAFT" | "UPCOMING" | "OPEN" | "IN_PROGRESS" | "SETTLING" | "SETTLED" | "CANCELLED";

export const PHASE_LABEL: Record<BracketPhase, string> = {
  DRAFT: "Borrador",
  UPCOMING: "Próximamente",
  OPEN: "Predicciones abiertas",
  IN_PROGRESS: "En juego",
  SETTLING: "Liquidándose",
  SETTLED: "Liquidado",
  CANCELLED: "Cancelado",
};

/**
 * Fase pública derivada. Persistidos solo: DRAFT, PUBLISHED, SETTLED, CANCELLED. El resto se deduce
 * de los cierres y los resultados reales (sin escrituras en lecturas).
 */
export function phaseOf(
  status: "DRAFT" | "PUBLISHED" | "SETTLED" | "CANCELLED",
  opts: { anyOpen: boolean; anyPickable: boolean; allDecided: boolean },
): BracketPhase {
  if (status !== "PUBLISHED") return status;
  if (opts.allDecided) return "SETTLING";
  if (opts.anyOpen) return opts.anyPickable ? "OPEN" : "UPCOMING";
  return "IN_PROGRESS";
}

/** Partidos abiertos que el jugador aún podría predecir (participantes conocidos, sin pick). */
export function pendingPicks(ctx: PredictionContext, picks: Picks, isOpen: (matchId: string) => boolean): string[] {
  const pairs = predictedParticipants(ctx, picks);
  return ctx.descriptor.nodes
    .filter((n) => !ctx.voided?.has(n.matchId) && isOpen(n.matchId) && !picks[n.matchId] && complete(pairs.get(n.matchId)))
    .map((n) => n.matchId);
}

/** Simula picks para todo el cuadro con un elector (pruebas y análisis económico). */
export function fillBracket(ctx: PredictionContext, choose: (matchId: string, pair: [TeamRef, TeamRef]) => string, base: Picks = {}): Record<string, string> {
  const picks: Record<string, string> = { ...base };
  for (const id of topoOrder(ctx.descriptor) ?? []) {
    if (picks[id] || ctx.voided?.has(id)) continue;
    const pair = predictedParticipants(ctx, picks).get(id);
    if (!complete(pair)) continue;
    picks[id] = choose(id, pair as [TeamRef, TeamRef]);
  }
  return picks;
}
