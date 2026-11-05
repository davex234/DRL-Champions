/**
 * EL EVENTO VIVO (Fase 24.5) — funciones PURAS sobre el snapshot real del torneo.
 *
 * ────────────────────────── QUÉ ES ──────────────────────────
 *
 *   datos del servidor (partidos, preguntas, respuestas, puntuación, ranking, recompensa)
 *     → `buildBracketModel` (24.3/24.4)
 *     → `deriveLiveEventSnapshot`  →  lo que la pantalla enseña: estado, en directo, siguiente,
 *                                     hoy, recientes, pendientes, progreso, mi posición.
 *     → `diffLiveSnapshots`        →  qué ha cambiado entre dos refrescos (feedback en sesión).
 *
 * ────────────────────────── LO QUE NO HACE ──────────────────────────
 *
 * No inventa «en directo»: un partido está en directo solo si `matches.status` lo dice. No
 * decide ganadores, puntos, clasificados ni posiciones: los lee (`winner`, `points_award`,
 * `pickem_scores`, `ranking_pickem_event`, nodos de clasificación de 24.4). No fabrica
 * horas: las únicas que enseña son las que existen (`start_time` del partido, `created_at`
 * del asiento de recompensa). Y no persiste nada: el diff vive en memoria de la sesión.
 *
 * El ritmo de refresco sigue el patrón del sondeo PvP (`lib/duel/pvpPoller`): intervalo por
 * estado + retroceso por fallos + pausa con la pestaña oculta. Sin peticiones por segundo.
 */
import type { BracketModel, BracketMatch, BracketRound, QualificationNode, BracketTeam } from "./bracket";
import { progressOf, positionOf, stateOf, type AnswerMap, type EventPhase, type PickState, type QuestionLike } from "./progress";
import { ns } from "@/i18n/runtime";

const t = ns("pickems");

/* ═══════════════════════════════ ESTADO DEL EVENTO ═══════════════════════════════ */

/** Estado del torneo según sus partidos reales. Es la taxonomía del importador (`events.status`). */
export type EventStatus = "upcoming" | "live" | "finished";

const FINISHED = new Set(["finished", "completed"]);
const LIVE = new Set(["live", "ongoing"]);

export const isFinishedMatch = (m: { status: string }): boolean => FINISHED.has(m.status);
export const isLiveMatch = (m: { status: string }): boolean => LIVE.has(m.status);

/**
 * Estado del evento: los partidos mandan; sin partidos, `events.status` del origen; sin nada,
 * la fase de Pick'ems (24.2).
 */
export function tournamentStatus(
  matches: { status: string; start_time?: string | null; startsAt?: string | null }[],
  fallback: { eventStatus?: string | null; phase?: EventPhase },
  now: number,
): EventStatus {
  if (matches.length > 0) {
    if (matches.every(isFinishedMatch)) return "finished";
    if (matches.some(isLiveMatch) || matches.some(isFinishedMatch)) return "live";
    const starts = matches.map((m) => Date.parse(m.start_time ?? m.startsAt ?? "")).filter(Number.isFinite);
    if (starts.length > 0 && Math.min(...starts) <= now) return "live";
    return "upcoming";
  }
  const src = (fallback.eventStatus ?? "").toLowerCase();
  if (FINISHED.has(src)) return "finished";
  if (LIVE.has(src)) return "live";
  if (src === "upcoming") return "upcoming";
  return fallback.phase === "finalizado" ? "finished" : fallback.phase === "activo" ? "live" : "upcoming";
}

export const EVENT_STATUS_LABEL: Record<EventStatus, string> = {
  upcoming: "Próximamente", live: "En curso", finished: "Finalizado",
};

/* ═══════════════════════════════ SNAPSHOT ═══════════════════════════════ */

export interface LiveMatch extends BracketMatch {
  roundLabel: string;
  stageName: string | null;
  /** Cuánto queda para el cierre de su predicción, en ms; `null` sin pregunta o ya cerrada. */
  lockInMs: number | null;
}

export interface TournamentProgress {
  total: number;
  finished: number;
  live: number;
  upcoming: number;
  pct: number;
  stages: { id: string | null; name: string; total: number; finished: number; live: number; pct: number }[];
}

export type ActivityKind = "MATCH_FINISHED" | "PREDICTION_RESOLVED" | "QUALIFIED" | "REWARD_EARNED";

export interface ActivityItem {
  id: string;
  kind: ActivityKind;
  /** Hora REAL asociada (inicio del partido, asiento de la recompensa) o `null` si no existe. */
  at: string | null;
  title: string;
  detail: string;
  /** Solo para PREDICTION_RESOLVED. */
  outcome?: "acertada" | "fallada";
  /** Puntos concedidos por el corrector, cuando ya los escribió. */
  points?: number | null;
  team?: string | null;
}

export interface LiveEventSnapshot {
  status: EventStatus;
  statusLabel: string;
  /** Fase actual del torneo (la del partido en directo o del siguiente), si se sabe. */
  stageLabel: string | null;
  liveMatches: LiveMatch[];
  nextMatches: LiveMatch[];
  todayMatches: LiveMatch[];
  recentMatches: LiveMatch[];
  pendingQuestions: string[];
  progress: TournamentProgress;
  qualified: QualificationNode[];
  activity: ActivityItem[];
  userPosition: number | null;
  userPoints: number | null;
  userCorrect: number | null;
  rewardTier: string | null;
  /** Estado de cada pregunta para el usuario, por id: la base del diff. */
  questionStates: Record<string, { state: PickState; pointsAward: number | null }>;
  /** Participantes por partido (para detectar «TBD → equipo»). */
  participants: Record<string, [string | null, string | null]>;
  finishedMatchIds: string[];
  winners: Record<string, "a" | "b" | null>;
}

export interface LiveInput {
  model: BracketModel;
  stages?: { id: string; name: string }[] | null;
  event?: { status?: string | null } | null;
  phase?: EventPhase;
  questions: (QuestionLike & { match_id: string | null; kind: string; prompt: string })[];
  answers: AnswerMap;
  score: { points: number; correct: number; total: number } | null;
  ranking: { user_id: string }[];
  reward: { reason: string; created_at: string } | null;
  userId: string | null;
  now: number;
  /** Cuántos partidos recientes / hitos se listan. */
  limit?: number;
}

/** Clave de día LOCAL del navegador: «hoy» es el hoy de quien mira, no el UTC del servidor. */
export const dayKey = (ts: number | string): string => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

const startOf = (m: BracketMatch): number => (m.startsAt ? Date.parse(m.startsAt) : Number.NaN);
const byStart = (a: BracketMatch, b: BracketMatch) => (startOf(a) || 0) - (startOf(b) || 0) || a.order - b.order;

export function deriveLiveEventSnapshot(input: LiveInput): LiveEventSnapshot {
  const { model, now } = input;
  const limit = input.limit ?? 6;
  const roundById = new Map(model.rounds.map((r) => [r.id, r]));
  const stageName = new Map((input.stages ?? []).map((s) => [s.id, s.name]));
  const questionById = new Map(input.questions.map((q) => [q.id, q]));

  const all: LiveMatch[] = Object.values(model.matches).map((m) => {
    const round: BracketRound | undefined = roundById.get(m.roundId);
    const lockInMs = m.questionId && m.lockState === "open" && m.locksAt ? Math.max(0, Date.parse(m.locksAt) - now) : null;
    return { ...m, roundLabel: round?.label ?? "Partido", stageName: (m.stageId && stageName.get(m.stageId)) ?? null, lockInMs };
  });

  const liveMatches = all.filter(isLiveMatch).sort(byStart);
  const upcoming = all.filter((m) => !isLiveMatch(m) && !isFinishedMatch(m) && Number.isFinite(startOf(m)) && startOf(m) >= now - 3 * 3600_000).sort(byStart);
  const finished = all.filter(isFinishedMatch).sort((a, b) => byStart(b, a));
  const today = dayKey(now);
  const todayMatches = all.filter((m) => Number.isFinite(startOf(m)) && dayKey(startOf(m)) === today)
    .sort((a, b) => (isLiveMatch(a) ? -1 : isLiveMatch(b) ? 1 : byStart(a, b)));

  // Progreso del torneo, por fase.
  const stageIds = [...new Set(all.map((m) => m.stageId))];
  const stages = stageIds.map((sid) => {
    const own = all.filter((m) => m.stageId === sid);
    const fin = own.filter(isFinishedMatch).length;
    return {
      id: sid, name: (sid && stageName.get(sid)) ?? "Torneo", total: own.length, finished: fin,
      live: own.filter(isLiveMatch).length, pct: own.length ? Math.round((fin / own.length) * 100) : 0,
    };
  });
  const progress: TournamentProgress = {
    total: all.length, finished: finished.length, live: liveMatches.length,
    upcoming: all.length - finished.length - liveMatches.length,
    pct: all.length ? Math.round((finished.length / all.length) * 100) : 0,
    stages,
  };

  const status = tournamentStatus(all, { eventStatus: input.event?.status, phase: input.phase }, now);
  const focus = liveMatches[0] ?? upcoming[0] ?? null;
  const stageLabel = focus ? (focus.stageName ?? (model.rounds.length > 1 ? focus.roundLabel : null)) : (stages.find((s) => s.finished < s.total)?.name ?? stages[stages.length - 1]?.name ?? null);

  // Pendientes: abiertas sin responder, ordenadas por cierre.
  const pendingQuestions = input.questions
    .filter((q) => stateOf(q, input.answers[q.id], now) === "pendiente")
    .sort((a, b) => Date.parse(a.locks_at) - Date.parse(b.locks_at))
    .map((q) => q.id);

  // Estados por pregunta (base del diff) y actividad reciente.
  const questionStates: LiveEventSnapshot["questionStates"] = {};
  for (const q of input.questions) {
    const mine = input.answers[q.id];
    questionStates[q.id] = { state: stateOf(q, mine, now), pointsAward: mine?.pointsAward ?? null };
  }

  const activity: ActivityItem[] = [];
  for (const m of finished.slice(0, limit)) {
    const w = m.winner === "a" ? m.teamA : m.winner === "b" ? m.teamB : null;
    const l = m.winner === "a" ? m.teamB : m.winner === "b" ? m.teamA : null;
    if (!w || !l) continue;
    const score = m.scoreA !== null && m.scoreB !== null ? ` ${Math.max(m.scoreA, m.scoreB)}–${Math.min(m.scoreA, m.scoreB)}` : "";
    activity.push({ id: `match:${m.id}`, kind: "MATCH_FINISHED", at: m.startsAt, title: `${w.name} vence${score} a ${l.name}`, detail: m.roundLabel, team: w.name });
    const q = m.questionId ? questionById.get(m.questionId) : null;
    if (q) {
      const st = questionStates[q.id];
      if (st?.state === "acertada" || st?.state === "fallada") {
        const mine = input.answers[q.id];
        const pts = st.state === "acertada" ? (mine?.pointsAward ?? null) : 0;
        activity.push({
          id: `pick:${q.id}`, kind: "PREDICTION_RESOLVED", at: m.startsAt,
          title: st.state === "acertada" ? t("Acertaste") : t("Fallaste"),
          detail: `${m.teamA?.name} vs ${m.teamB?.name}`, outcome: st.state, points: pts,
        });
      }
    }
  }
  const qualified = model.qualificationNodes;
  for (const n of qualified) {
    if (!n.team) continue;
    const from = model.matches[n.fromMatchId];
    activity.push({ id: `qual:${n.key}`, kind: "QUALIFIED", at: from?.startsAt ?? null, title: t("{name} se clasifica", { name: n.team.name }), detail: n.label, team: n.team.name });
  }
  const rewardTier = input.reward ? (/^pickem_reward:(.+)$/.exec(input.reward.reason)?.[1] ?? null) : null;
  if (input.reward && rewardTier) {
    activity.push({ id: `reward:${rewardTier}`, kind: "REWARD_EARNED", at: input.reward.created_at, title: t("Recompensa conseguida"), detail: rewardTier });
  }
  activity.sort((a, b) => (Date.parse(b.at ?? "") || 0) - (Date.parse(a.at ?? "") || 0));

  const participants: LiveEventSnapshot["participants"] = {};
  const winners: LiveEventSnapshot["winners"] = {};
  for (const m of all) { participants[m.id] = [m.teamA?.name ?? null, m.teamB?.name ?? null]; winners[m.id] = m.winner; }

  return {
    status, statusLabel: EVENT_STATUS_LABEL[status], stageLabel,
    liveMatches, nextMatches: upcoming.slice(0, limit), todayMatches, recentMatches: finished.slice(0, limit),
    pendingQuestions, progress, qualified, activity: activity.slice(0, limit * 2),
    userPosition: positionOf(input.ranking, input.userId),
    userPoints: input.score?.points ?? null,
    userCorrect: input.score?.correct ?? null,
    rewardTier, questionStates, participants, finishedMatchIds: finished.map((m) => m.id), winners,
  };
}

/* ═══════════════════════════════ DIFF ENTRE REFRESCOS ═══════════════════════════════ */

export type LiveChange =
  | { id: string; kind: "MATCH_FINISHED"; matchId: string; winner: string | null }
  | { id: string; kind: "PREDICTION_RESOLVED"; questionId: string; outcome: "acertada" | "fallada"; points: number | null }
  | { id: string; kind: "QUALIFIED"; key: string; team: string }
  | { id: string; kind: "PARTICIPANT_SET"; matchId: string; slot: "a" | "b"; team: string }
  | { id: string; kind: "RANK_CHANGED"; from: number; to: number }
  | { id: string; kind: "POINTS_CHANGED"; from: number; to: number }
  | { id: string; kind: "REWARD_EARNED"; tier: string };

/**
 * Qué ha cambiado entre dos snapshots. Solo transiciones reales (de «no» a «sí»); nunca se
 * anuncia lo que ya estaba. Los ids son estables para poder deduplicar por sesión.
 */
export function diffLiveSnapshots(prev: LiveEventSnapshot | null, next: LiveEventSnapshot): LiveChange[] {
  if (!prev) return [];
  const out: LiveChange[] = [];
  const prevFinished = new Set(prev.finishedMatchIds);
  for (const id of next.finishedMatchIds) {
    if (prevFinished.has(id)) continue;
    const w = next.winners[id];
    const team = w ? next.participants[id]?.[w === "a" ? 0 : 1] ?? null : null;
    out.push({ id: `match:${id}`, kind: "MATCH_FINISHED", matchId: id, winner: team });
  }
  for (const [qid, st] of Object.entries(next.questionStates)) {
    const before = prev.questionStates[qid]?.state;
    const resolved = st.state === "acertada" || st.state === "fallada";
    if (resolved && before !== "acertada" && before !== "fallada") {
      out.push({ id: `pick:${qid}`, kind: "PREDICTION_RESOLVED", questionId: qid, outcome: st.state as "acertada" | "fallada", points: st.state === "acertada" ? st.pointsAward : 0 });
    }
  }
  const prevQual = new Map(prev.qualified.map((n) => [n.key, n.team?.name ?? null]));
  for (const n of next.qualified) {
    if (n.team && !prevQual.get(n.key)) out.push({ id: `qual:${n.key}`, kind: "QUALIFIED", key: n.key, team: n.team.name });
  }
  for (const [id, [a, b]] of Object.entries(next.participants)) {
    const before = prev.participants[id];
    if (a && before && !before[0]) out.push({ id: `team:${id}:a`, kind: "PARTICIPANT_SET", matchId: id, slot: "a", team: a });
    if (b && before && !before[1]) out.push({ id: `team:${id}:b`, kind: "PARTICIPANT_SET", matchId: id, slot: "b", team: b });
  }
  if (prev.userPosition !== null && next.userPosition !== null && prev.userPosition !== next.userPosition) {
    out.push({ id: `rank:${prev.userPosition}>${next.userPosition}`, kind: "RANK_CHANGED", from: prev.userPosition, to: next.userPosition });
  }
  if (prev.userPoints !== null && next.userPoints !== null && prev.userPoints !== next.userPoints) {
    out.push({ id: `points:${prev.userPoints}>${next.userPoints}`, kind: "POINTS_CHANGED", from: prev.userPoints, to: next.userPoints });
  }
  if (next.rewardTier && next.rewardTier !== prev.rewardTier) out.push({ id: `reward:${next.rewardTier}`, kind: "REWARD_EARNED", tier: next.rewardTier });
  return out;
}

/** Ids de partido / nodo que cambiaron: para el brillo breve en el cuadro. */
export function changedIdsOf(changes: LiveChange[]): Set<string> {
  const s = new Set<string>();
  for (const c of changes) {
    if (c.kind === "MATCH_FINISHED" || c.kind === "PARTICIPANT_SET") s.add(c.matchId);
    if (c.kind === "QUALIFIED") s.add(`qual:${c.key}`);
  }
  return s;
}

/** Deduplicación por sesión: devuelve solo los cambios no vistos y los marca. Puro sobre el set. */
export function dedupeChanges(changes: LiveChange[], seen: Set<string>): LiveChange[] {
  const out: LiveChange[] = [];
  for (const c of changes) { if (seen.has(c.id)) continue; seen.add(c.id); out.push(c); }
  return out;
}

/* ═══════════════════════════════ RITMO DE REFRESCO ═══════════════════════════════ */

/**
 * Intervalos por estado (ms). Mismo espíritu que `POLL_MS` del sondeo PvP: lo vivo, más a
 * menudo; lo futuro, poco; lo oculto, nada. Nunca por segundo.
 */
export const LIVE_POLL_MS = {
  /** Hay un partido en directo. */
  live: 20_000,
  /** Torneo en curso sin partido en directo ahora mismo. */
  active: 45_000,
  /** Todavía no ha empezado. */
  upcoming: 120_000,
  /** Terminado: por si llega una corrección tardía. */
  finished: 300_000,
} as const;

export const LIVE_BACKOFF_MS = [5_000, 10_000, 20_000, 40_000, 60_000] as const;
export const liveBackoffFor = (failures: number): number =>
  LIVE_BACKOFF_MS[Math.min(Math.max(failures, 1) - 1, LIVE_BACKOFF_MS.length - 1)];

export interface RefreshContext {
  status: EventStatus;
  hasLive: boolean;
  visibility: "visible" | "hidden";
  online: boolean;
  failures: number;
}

/** Intervalo que toca, o `null` para no sondear (pestaña oculta o sin red). Puro. */
export function refreshIntervalFor(ctx: RefreshContext): number | null {
  if (!ctx.online) return null;
  if (ctx.visibility === "hidden") return null;
  if (ctx.failures > 0) return liveBackoffFor(ctx.failures);
  if (ctx.hasLive) return LIVE_POLL_MS.live;
  if (ctx.status === "live") return LIVE_POLL_MS.active;
  if (ctx.status === "finished") return LIVE_POLL_MS.finished;
  return LIVE_POLL_MS.upcoming;
}

/* ═══════════════════════════════ URGENCIA ═══════════════════════════════ */

/** Una predicción «cierra pronto» por debajo de esto. Un solo sitio; los componentes lo leen. */
export const URGENT_LOCK_MS = 30 * 60_000;

export const isUrgent = (locksAt: string | null | undefined, now: number): boolean => {
  if (!locksAt) return false;
  const left = Date.parse(locksAt) - now;
  return left > 0 && left <= URGENT_LOCK_MS;
};

/** «hace 2 min», «hace 1 h». Sin segundos: nadie necesita verlos cambiar. */
export function agoLabel(then: number, now: number): string {
  const s = Math.max(0, Math.round((now - then) / 1000));
  if (s < 60) return t("hace un momento");
  const m = Math.floor(s / 60);
  if (m < 60) return t("hace {n} min", { n: m });
  const h = Math.floor(m / 60);
  return t("hace {n} h", { n: h });
}

/** Puntos ganables por lo pendiente + lo elegido: reutiliza el progreso de 24.2. */
export const pendingCount = (questions: QuestionLike[], answers: AnswerMap, now: number): number =>
  progressOf(questions, answers, now).pending;

export type { BracketTeam };
