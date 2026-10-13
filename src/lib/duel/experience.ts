/**
 * MATCH EXPERIENCE 3.0 (Fase 33) — PRESENTACIÓN PURA de una partida de duelo.
 *
 *     MOTOR CANÓNICO (domain/cardgame)  →  PROYECCIÓN (matchView / projectMatchFor)  →  ESTO  →  PANTALLA
 *
 * Sin React, sin red, sin reloj, sin `window`. Todo lo que hay aquí TRANSFORMA hechos que el servidor
 * ya resolvió en frases, estados visuales y líneas de tiempo. Nada decide un ganador, un punto, un eje
 * del defensor, un rating o una recompensa: si un dato falta o no cuadra, se dice que falta en vez de
 * adivinarlo («Turno resuelto por el servidor.»).
 *
 * LO QUE DICE EL CÓDIGO CANÓNICO (y esta capa respeta):
 *   · `duel-turns-2`: 10 turnos; el atacante alterna y lo guarda el orquestador (`attacker`).
 *   · Un TURNO se decide solo por el valor del eje enfrentado; a igualdad es `TIE` y NADIE puntúa
 *     (OPD-05 · `NO_POINT`). No hay desempate por turno.
 *   · La PARTIDA (`duel-combat-2`): marcador → si hay empate, suma de OVR, que SÍ suma un punto
 *     (`OVR_TIEBREAK`) → si sigue el empate, total de estadísticas declaradas, SIN punto
 *     (`STAT_MARGIN`) → si sigue, empate (`NONE`).
 *   · Las vistas por turno llegan en la perspectiva de quien mira: `outcome "A"` = ganas tú,
 *     `attacker "A"` = atacaste tú (normalizado en `toTurnView`).
 */
import type { RatingEvent } from "@/domain/cardgame/rating";
import { K_PROVISIONAL } from "@/domain/cardgame/rating";
import {
  STAT_INFO,
  type CombatStatKey, type DuelDeckCardDTO, type DuelMatchView, type DuelReplay, type DuelResultView, type DuelTurnView,
} from "./types";

/** Fase 39 · `DRAFT_GAUNTLET` es el mismo final PvE pero sin recompensa ni rating (v1). */
export type MatchMode = "PVE" | "PVP" | "PVP_PRIVATE" | "DRAFT_GAUNTLET";
export type TurnResult = "WIN" | "LOSS" | "DRAW";
export type MatchVerdict = "WIN" | "LOSS" | "DRAW";

const isStat = (k: unknown): k is CombatStatKey => typeof k === "string" && Object.prototype.hasOwnProperty.call(STAT_INFO, k);
const isNum = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const statLabel = (k: CombatStatKey) => STAT_INFO[k].label;

/* ═════════════════════════════ fase visual ═════════════════════════════ */

export type MatchPhase =
  | "RECOVERING" | "OFFLINE" | "RESYNC" | "INTRO" | "SELECT_CARD" | "SELECT_STAT" | "CONFIRM"
  | "LOCKED" | "WAITING_RIVAL" | "REVEAL" | "FINISHED";

export type SyncStatusLike = "IDLE" | "SYNCING" | "SYNCED" | "STALE" | "ERROR" | "TERMINAL";
export type LifecycleLike = "CREATED" | "IN_TURN" | "FINISHED" | "ABANDONED" | "EXPIRED";

export interface PhaseInput {
  view: Pick<DuelMatchView, "status" | "youAreAttacker" | "yourHand"> | null;
  /** Informativo: la fase no depende del modo (PvE y PvP comparten máquina). */
  mode?: MatchMode;
  /** Estado LOCAL de la pantalla: nunca manda sobre el servidor. */
  selectedUid?: string | null;
  selectedStat?: CombatStatKey | null;
  submitting?: boolean;
  revealing?: boolean;
  introOpen?: boolean;
  /** Solo PvP: lo que dice el poller (servidor). */
  sync?: { status: SyncStatusLike; isYourTurn: boolean; lifecycle: LifecycleLike } | null;
}

/**
 * La fase de PRESENTACIÓN. Orden de prioridad: primero la verdad del servidor (terminado, sin
 * conexión, resincronizando), después lo que la pantalla está enseñando (intro, revelación, jugada
 * en vuelo) y al final lo que el jugador está eligiendo. Una selección local que ya no está en la
 * mano del servidor se ignora.
 */
export function derivePhase(i: PhaseInput): MatchPhase {
  const { view, sync } = i;
  if (!view) return sync?.status === "ERROR" ? "OFFLINE" : "RECOVERING";
  const terminal = sync ? sync.lifecycle === "FINISHED" || sync.lifecycle === "ABANDONED" || sync.lifecycle === "EXPIRED" : false;
  if (terminal || view.status !== "IN_PROGRESS") return "FINISHED";
  if (sync?.status === "ERROR") return "OFFLINE";
  if (sync?.status === "STALE") return "RESYNC";
  if (i.introOpen) return "INTRO";
  if (i.revealing) return "REVEAL";
  if (i.submitting) return "LOCKED";
  if (sync && !sync.isYourTurn) return "WAITING_RIVAL";
  const selected = i.selectedUid ? view.yourHand.some((c) => c.uid === i.selectedUid) : false;
  if (!selected) return "SELECT_CARD";
  if (view.youAreAttacker && !i.selectedStat) return "SELECT_STAT";
  return "CONFIRM";
}

export const phaseAllowsSelection = (p: MatchPhase): boolean => p === "SELECT_CARD" || p === "SELECT_STAT" || p === "CONFIRM";

/** Rótulo de cada fase, tal y como lo lee el jugador (chip del HUD y `data-phase`). */
export const PHASE_LABEL: Record<MatchPhase, string> = {
  RECOVERING: "RECUPERANDO PARTIDA",
  OFFLINE: "SIN CONEXIÓN",
  RESYNC: "RESINCRONIZANDO",
  INTRO: "PRESENTACIÓN",
  SELECT_CARD: "ELIGE CARTA",
  SELECT_STAT: "ELIGE ESTADÍSTICA",
  CONFIRM: "CONFIRMA LA JUGADA",
  LOCKED: "CARTA BLOQUEADA",
  WAITING_RIVAL: "ESPERANDO AL RIVAL",
  REVEAL: "REVELANDO EL TURNO",
  FINISHED: "PARTIDA TERMINADA",
};

/** Cartas que se pueden elegir AHORA: las de tu mano, y solo si la fase lo permite. */
export function selectableUids(view: Pick<DuelMatchView, "yourHand"> | null, phase: MatchPhase): string[] {
  return view && phaseAllowsSelection(phase) ? view.yourHand.map((c) => c.uid) : [];
}

/* ─────────── cerrojo de la jugada ─────────── */

export interface ActionLock { pending: boolean; key: string | null }
export const UNLOCKED: ActionLock = Object.freeze({ pending: false, key: null });

/** Pedir la jugada: si ya hay una en vuelo, se rechaza (sin doble envío). */
export function lockAction(lock: ActionLock, key: string): { lock: ActionLock; accepted: boolean } {
  if (lock.pending) return { lock, accepted: false };
  return { lock: { pending: true, key }, accepted: true };
}

/**
 * Soltar el cerrojo cuando responde el servidor. `STALE`: la jugada no se aplicó porque la partida
 * avanzó; se suelta y se pide resincronizar (nunca un error fatal).
 */
export function releaseAction(_lock: ActionLock, outcome: "APPLIED" | "REJECTED" | "STALE"): { lock: ActionLock; resync: boolean } {
  return { lock: UNLOCKED, resync: outcome === "STALE" };
}

/* ═════════════════════════════ cabecera del turno ═════════════════════════════ */

export interface TurnHeader {
  turn: number;
  total: number;
  label: string;
  role: "ATTACK" | "DEFENSE" | null;
  roleLabel: "ATACAS" | "DEFIENDES" | null;
  finalTurn: boolean;
  finalLabel: string | null;
  matchPoint: "YOU" | "RIVAL" | "BOTH" | null;
  matchPointLabel: string | null;
  secured: "YOU" | "RIVAL" | null;
}

/**
 * PUNTO DE PARTIDA, derivado estrictamente de las reglas (sin dramatismo inventado):
 *   · quedan `after = total − turn` turnos DESPUÉS del actual;
 *   · un marcador está ASEGURADO si `a > b + (after + 1)`: ni perdiendo todo lo que queda lo alcanzan;
 *   · hay punto de partida para A si NO está asegurado y `a + 1 > b + after`: ganar este turno deja
 *     una ventaja que los turnos restantes ya no pueden igualar ⇒ gana por marcador (el desempate por
 *     OVR solo existe a igualdad).
 *   · «BOTH» solo ocurre en el último turno con empate: quien lo gane, gana el duelo.
 */
export function matchPoint(you: number, rival: number, turn: number, total: number): { point: TurnHeader["matchPoint"]; secured: TurnHeader["secured"] } {
  if (![you, rival, turn, total].every(isNum) || turn < 1 || turn > total) return { point: null, secured: null };
  const after = total - turn;
  const secured = you > rival + after + 1 ? "YOU" : rival > you + after + 1 ? "RIVAL" : null;
  if (secured) return { point: null, secured };
  const y = you + 1 > rival + after;
  const r = rival + 1 > you + after;
  return { point: y && r ? "BOTH" : y ? "YOU" : r ? "RIVAL" : null, secured: null };
}

export function turnHeader(view: Pick<DuelMatchView, "status" | "turn" | "totalTurns" | "youAreAttacker" | "scoreYou" | "scoreRival">): TurnHeader {
  const total = view.totalTurns;
  const turn = Math.min(Math.max(view.turn, 1), total);
  const live = view.status === "IN_PROGRESS";
  const role = live ? (view.youAreAttacker ? "ATTACK" : "DEFENSE") : null;
  const mp = live ? matchPoint(view.scoreYou, view.scoreRival, turn, total) : { point: null, secured: null };
  return {
    turn, total,
    label: `TURNO ${turn} DE ${total}`,
    role,
    roleLabel: role === "ATTACK" ? "ATACAS" : role === "DEFENSE" ? "DEFIENDES" : null,
    finalTurn: live && turn === total,
    finalLabel: live && turn === total ? "ÚLTIMO TURNO" : null,
    matchPoint: mp.point,
    matchPointLabel: mp.point === "YOU" ? "PUNTO DE PARTIDA · si ganas este turno, ganas el duelo"
      : mp.point === "RIVAL" ? "PUNTO DE PARTIDA DEL RIVAL · si gana este turno, gana el duelo"
        : mp.point === "BOTH" ? "TURNO DECISIVO · quien gane este turno gana el duelo" : null,
    secured: mp.secured,
  };
}

/* ═════════════════════════════ eje ═════════════════════════════ */

export type AxisMode = "CHOOSE" | "IMPOSED" | "WAITING_ATTACK" | "NONE";

export interface AxisPresentation {
  mode: AxisMode;
  options: CombatStatKey[];
  rivalStat: CombatStatKey | null;
  yourStat: CombatStatKey | null;
  text: string | null;
}

export const STAT_ORDER: CombatStatKey[] = ["stronghold", "gamesense", "entryfrag"];

/**
 * Quién elige el eje. Atacando eliges entre los tres ejes REALES. Defendiendo no eliges: el eje
 * del rival llega en `pendingRival` y el tuyo en `requiredStat`, los dos del servidor. Si el rival
 * aún no ha declarado, no hay eje que enseñar (y no se infiere).
 */
export function axisPresentation(view: Pick<DuelMatchView, "status" | "youAreAttacker" | "pendingRival" | "requiredStat">): AxisPresentation {
  if (view.status !== "IN_PROGRESS") return { mode: "NONE", options: [], rivalStat: null, yourStat: null, text: null };
  if (view.youAreAttacker) return { mode: "CHOOSE", options: [...STAT_ORDER], rivalStat: null, yourStat: null, text: "ATACAS · ELIGE CARTA Y ESTADÍSTICA" };
  const rs = view.pendingRival?.stat;
  const req = view.requiredStat;
  if (isStat(rs) && isStat(req)) {
    return { mode: "IMPOSED", options: [], rivalStat: rs, yourStat: req, text: `EL RIVAL ATACA CON ${statLabel(rs).toUpperCase()} · RESPONDES CON ${statLabel(req).toUpperCase()}` };
  }
  return { mode: "WAITING_ATTACK", options: [], rivalStat: null, yourStat: null, text: "EL RIVAL ESTÁ ELIGIENDO SU ATAQUE" };
}

/* ═════════════════════════════ turno resuelto ═════════════════════════════ */

export const TURN_HEADLINE: Record<TurnResult, string> = { WIN: "PUNTO PARA TI", LOSS: "PUNTO PARA EL RIVAL", DRAW: "EMPATE" };
export const UNKNOWN_TURN_TEXT = "Turno resuelto por el servidor.";

export const turnResult = (t: Pick<DuelTurnView, "outcome">): TurnResult =>
  t.outcome === "A" ? "WIN" : t.outcome === "B" ? "LOSS" : "DRAW";

export type TurnReason = "STAT_WIN" | "STAT_LOSS" | "STAT_DRAW" | "UNKNOWN";

export interface TurnExplanation {
  reason: TurnReason;
  result: TurnResult | null;
  headline: string;
  text: string;
  /** Quién suma el punto, según el `outcome` del servidor (nunca comparando aquí). */
  point: "YOU" | "RIVAL" | null;
  /** Marcador DESPUÉS del turno, tal y como lo guardó el orquestador. */
  scoreYou: number | null;
  scoreRival: number | null;
  contested: { you: { stat: CombatStatKey; label: string; value: number }; rival: { stat: CombatStatKey; label: string; value: number } } | null;
}

/**
 * La frase de un turno. El resultado es el `outcome` del servidor; las cifras solo se usan para
 * CONTAR el porqué. Si las cifras no cuadran con el resultado (o faltan), no se inventa un motivo:
 * «Turno resuelto por el servidor.».
 */
export function explainTurn(t: DuelTurnView | null | undefined): TurnExplanation {
  const unknown = (partial: Partial<TurnExplanation> = {}): TurnExplanation => ({
    reason: "UNKNOWN", result: null, headline: "TURNO RESUELTO", text: UNKNOWN_TURN_TEXT, point: null,
    scoreYou: null, scoreRival: null, contested: null, ...partial,
  });
  if (!t) return unknown();
  const scores = { scoreYou: isNum(t.scoreAfterYou) ? t.scoreAfterYou : null, scoreRival: isNum(t.scoreAfterRival) ? t.scoreAfterRival : null };
  const result = t.outcome === "A" || t.outcome === "B" || t.outcome === "TIE" ? turnResult(t) : null;
  if (!result) return unknown(scores);
  const point = result === "WIN" ? "YOU" : result === "LOSS" ? "RIVAL" : null;
  const you = t.you; const rival = t.rival;
  if (!you || !rival || !isStat(you.stat) || !isStat(rival.stat) || !isNum(you.value) || !isNum(rival.value)) {
    return unknown({ ...scores, result, point, headline: TURN_HEADLINE[result] });
  }
  const contested = {
    you: { stat: you.stat, label: statLabel(you.stat), value: you.value },
    rival: { stat: rival.stat, label: statLabel(rival.stat), value: rival.value },
  };
  const consistent = result === "WIN" ? you.value > rival.value : result === "LOSS" ? you.value < rival.value : you.value === rival.value;
  if (!consistent) return unknown({ ...scores, result, point, headline: TURN_HEADLINE[result], contested });
  const text = result === "WIN"
    ? `Tu ${contested.you.label} ${you.value} supera a ${contested.rival.label} ${rival.value} del rival.`
    : result === "LOSS"
      ? `${contested.rival.label} ${rival.value} del rival supera a tu ${contested.you.label} ${you.value}.`
      : `Empate a ${you.value}: ningún jugador suma punto.`;
  return {
    reason: result === "WIN" ? "STAT_WIN" : result === "LOSS" ? "STAT_LOSS" : "STAT_DRAW",
    result, headline: TURN_HEADLINE[result], text, point, ...scores, contested,
  };
}

/* ═════════════════════════════ línea de turnos ═════════════════════════════ */

export type CellState = "WIN" | "LOSS" | "DRAW" | "CURRENT" | "PENDING";

export interface TimelineCell { number: number; state: CellState; role: "ATTACK" | "DEFENSE" | null; glyph: string; label: string }

const GLYPH: Record<CellState, string> = { WIN: "●", LOSS: "○", DRAW: "—", CURRENT: "◆", PENDING: "·" };
const STATE_WORD: Record<CellState, string> = { WIN: "ganado", LOSS: "perdido", DRAW: "empatado", CURRENT: "en juego", PENDING: "pendiente" };

/**
 * Una casilla por turno canónico (`totalTurns`). Los jugados, con su resultado real; el actual,
 * marcado; los futuros, «pendiente» y SIN ningún dato (no se revela quién atacará ni qué pasará).
 */
export function buildTimeline(view: Pick<DuelMatchView, "totalTurns" | "turn" | "status" | "youAreAttacker" | "history">): TimelineCell[] {
  const byNumber = new Map(view.history.map((t) => [t.number, t]));
  const live = view.status === "IN_PROGRESS";
  return Array.from({ length: view.totalTurns }, (_, i) => {
    const n = i + 1;
    const t = byNumber.get(n);
    let state: CellState; let role: TimelineCell["role"] = null;
    if (t) { state = turnResult(t); role = t.attacker === "A" ? "ATTACK" : "DEFENSE"; }
    else if (live && n === view.turn) { state = "CURRENT"; role = view.youAreAttacker ? "ATTACK" : "DEFENSE"; }
    else state = "PENDING";
    const roleWord = role === "ATTACK" ? (t ? ", atacaste" : ", atacas") : role === "DEFENSE" ? (t ? ", defendiste" : ", defiendes") : "";
    return { number: n, state, role, glyph: GLYPH[state], label: `Turno ${n}: ${STATE_WORD[state]}${roleWord}` };
  });
}

/** Detalle de un turno ANTERIOR. Un turno futuro o el actual no tienen detalle: `null`. */
export function turnDetail(view: Pick<DuelMatchView, "history" | "yourUsed" | "yourHand" | "rivalUsed">, n: number): {
  turn: DuelTurnView; explanation: TurnExplanation; yourCard: DuelDeckCardDTO | null; rivalCard: DuelDeckCardDTO | null;
} | null {
  const turn = view.history.find((t) => t.number === n);
  if (!turn) return null;
  const find = (pool: DuelDeckCardDTO[], uid: string) => pool.find((c) => c.uid === uid) ?? null;
  return {
    turn,
    explanation: explainTurn(turn),
    yourCard: find([...view.yourUsed, ...view.yourHand], turn.you.uid),
    rivalCard: find(view.rivalUsed, turn.rival.uid),
  };
}

/* ═════════════════════════════ resultado ═════════════════════════════ */

export const VERDICT_TITLE: Record<MatchVerdict, string> = { WIN: "VICTORIA", LOSS: "DERROTA", DRAW: "EMPATE" };

export function matchVerdict(r: Pick<DuelResultView, "winner" | "isDraw">): MatchVerdict {
  if (r.isDraw) return "DRAW";
  return r.winner === "YOU" ? "WIN" : r.winner === "RIVAL" ? "LOSS" : "DRAW";
}

export interface DecisionStep {
  key: "SCORE" | "OVR" | "STAT_TOTAL";
  label: string;
  you: number | null;
  rival: number | null;
  outcome: "YOU" | "RIVAL" | "TIE" | "UNKNOWN";
  note: string;
}

/**
 * CÓMO SE DECIDIÓ, paso a paso y SOLO con los pasos que de verdad se aplicaron (`decidedBy`):
 *   SCORE        → [turnos]
 *   OVR_TIEBREAK → [turnos empatados, suma de OVR (+1 punto)]
 *   STAT_MARGIN  → [turnos empatados, OVR empatado, total de estadísticas (sin punto)]
 *   NONE         → [turnos empatados, OVR empatado, estadísticas empatadas]
 * El marcador previo al desempate por OVR es el del resultado menos el punto que ese desempate
 * otorga (regla canónica: exactamente uno). Si un número no llegó, el paso lo dice.
 */
export function decisionSteps(r: DuelResultView): DecisionStep[] {
  const winner = r.winner === "YOU" ? "YOU" : r.winner === "RIVAL" ? "RIVAL" : null;
  const steps: DecisionStep[] = [];
  const pre = r.decidedBy === "OVR_TIEBREAK" ? Math.min(r.scoreYou, r.scoreRival) : null;
  steps.push({
    key: "SCORE", label: "Turnos ganados",
    you: pre ?? r.scoreYou, rival: pre ?? r.scoreRival,
    outcome: r.decidedBy === "SCORE" ? (winner ?? "UNKNOWN") : "TIE",
    note: r.decidedBy === "SCORE" ? "Gana quien suma más turnos." : "Empate en turnos ganados.",
  });
  if (r.decidedBy === "SCORE") return steps;
  const ovrKnown = isNum(r.sumOvrYou) && isNum(r.sumOvrRival);
  steps.push({
    key: "OVR", label: "Suma de OVR",
    you: ovrKnown ? r.sumOvrYou : null, rival: ovrKnown ? r.sumOvrRival : null,
    outcome: r.decidedBy === "OVR_TIEBREAK" ? (winner ?? "UNKNOWN") : ovrKnown ? "TIE" : "UNKNOWN",
    note: r.decidedBy === "OVR_TIEBREAK" ? "La suma de OVR desempata y da un punto." : "Empate también en OVR.",
  });
  if (r.decidedBy === "OVR_TIEBREAK") return steps;
  steps.push({
    key: "STAT_TOTAL", label: "Total de estadísticas",
    you: isNum(r.statTotalYou) ? r.statTotalYou : null, rival: isNum(r.statTotalRival) ? r.statTotalRival : null,
    outcome: r.decidedBy === "STAT_MARGIN" ? (winner ?? "UNKNOWN") : "TIE",
    note: r.decidedBy === "STAT_MARGIN" ? "El total de estadísticas declaradas decide, sin punto adicional." : "Empate total. Ningún jugador suma punto.",
  });
  return steps;
}

export const DECISION_TITLE: Record<DuelResultView["decidedBy"], string> = {
  SCORE: "Por turnos ganados",
  OVR_TIEBREAK: "Desempate por suma de OVR",
  STAT_MARGIN: "Desempate por total de estadísticas",
  NONE: "Empate total",
};

/* ─────────── carta de la partida ─────────── */

export interface CardOfTheMatch { uid: string; turn: number; stat: CombatStatKey; value: number; rivalValue: number; margin: number; why: string }

/**
 * CARTA DE LA PARTIDA — algoritmo documentado sobre hechos persistidos:
 *   0. Cada carta se juega UNA vez por partida, así que una carta suma como mucho 1 punto: solo
 *      compiten las cartas que GANARON su turno (si ninguna ganó, NO hay carta de la partida).
 *   1. mayor margen en el eje enfrentado (valor propio − valor rival);
 *   2. mayor valor propio;
 *   3. turno más temprano;
 *   4. uid (orden estable).
 * No da créditos, XP ni mejora ninguna carta: es presentación.
 */
export function cardOfTheMatch(history: DuelTurnView[]): CardOfTheMatch | null {
  const candidates = history
    .filter((t) => t.outcome === "A" && isNum(t.you?.value) && isNum(t.rival?.value) && t.you.value > t.rival.value && isStat(t.you.stat))
    .map((t) => ({ uid: t.you.uid, turn: t.number, stat: t.you.stat, value: t.you.value, rivalValue: t.rival.value, margin: t.you.value - t.rival.value }))
    .sort((a, b) => b.margin - a.margin || b.value - a.value || a.turn - b.turn || a.uid.localeCompare(b.uid));
  const best = candidates[0];
  if (!best) return null;
  return { ...best, why: `Ganó el turno ${best.turn}: ${statLabel(best.stat)} ${best.value} contra ${best.rivalValue} (+${best.margin}).` };
}

/* ─────────── rating y recompensa ─────────── */

export interface RatingPresentation {
  state: "READY" | "PENDING" | "NOT_APPLICABLE";
  before: number | null;
  after: number | null;
  delta: number | null;
  deltaLabel: string | null;
  provisional: boolean;
  note: string | null;
}

/** Rating SOLO en ranked y SOLO desde el evento real de la liquidación. Nunca se resta nada. */
export function ratingPresentation(mode: MatchMode, event: RatingEvent | null | undefined): RatingPresentation {
  if (mode !== "PVP") return { state: "NOT_APPLICABLE", before: null, after: null, delta: null, deltaLabel: null, provisional: false, note: mode === "PVP_PRIVATE" ? "Duelo privado: no mueve el rating." : null };
  if (!event || !isNum(event.oldRating) || !isNum(event.newRating) || !isNum(event.delta)) {
    return { state: "PENDING", before: null, after: null, delta: null, deltaLabel: null, provisional: false, note: "El rating llegará en cuanto el servidor liquide la partida." };
  }
  const provisional = event.kFactor === K_PROVISIONAL;
  return {
    state: "READY", before: event.oldRating, after: event.newRating, delta: event.delta,
    deltaLabel: event.delta > 0 ? `+${event.delta}` : event.delta < 0 ? `−${Math.abs(event.delta)}` : "0",
    provisional,
    note: provisional ? "Rating provisional: las primeras 10 partidas mueven más el rating." : null,
  };
}

export interface RewardPresentation {
  state: "GRANTED" | "NONE" | "UNAVAILABLE" | "NOT_APPLICABLE";
  credits: number; xp: number; points: number;
  note: string;
}

/** Recompensa SOLO la del servidor (`result.award`). Se abona sola al terminar: no hay «Reclamar». */
export function rewardPresentation(mode: MatchMode, result: Pick<DuelResultView, "award"> | null | undefined): RewardPresentation {
  if (mode === "DRAFT_GAUNTLET") return { state: "NOT_APPLICABLE", credits: 0, xp: 0, points: 0, note: "Draft Gauntlet no da créditos, sobres ni XP en esta versión." };
  if (mode !== "PVE") return { state: "NOT_APPLICABLE", credits: 0, xp: 0, points: 0, note: "Los duelos PvP no dan créditos ni XP." };
  const a = result?.award;
  if (!a || !isNum(a.credits) || !isNum(a.xp) || !isNum(a.points)) return { state: "UNAVAILABLE", credits: 0, xp: 0, points: 0, note: "Recompensa no disponible." };
  if (a.credits <= 0 && a.xp <= 0 && a.points <= 0) return { state: "NONE", credits: 0, xp: 0, points: 0, note: "Esta partida no da recompensa." };
  return { state: "GRANTED", credits: a.credits, xp: a.xp, points: a.points, note: "Abonada automáticamente al terminar." };
}

/** Acciones siguientes por modo, con los textos que ya tiene el producto. */
export function resultActions(mode: MatchMode): { id: string; label: string }[] {
  if (mode === "PVP") return [{ id: "search", label: "Buscar otro rival" }, { id: "replay", label: "Ver la partida" }, { id: "ranked", label: "Ver la escalera" }, { id: "team", label: "Mis equipos" }];
  if (mode === "PVP_PRIVATE") return [{ id: "rematch", label: "Revancha" }, { id: "social", label: "Volver a Social" }, { id: "replay", label: "Ver la partida" }, { id: "team", label: "Mis equipos" }];
  return [{ id: "again", label: "Revancha" }, { id: "change", label: "Cambiar rival o equipo" }, { id: "replay", label: "Ver la partida" }, { id: "team", label: "Mis equipos" }];
}

/* ─────────── transición de final de partida ─────────── */

export interface MatchEndPresentation {
  verdict: MatchVerdict;
  title: string;
  /** Marcador final del resolver; si la partida se cerró sin resultado (abandono/tiempo), el del último turno guardado. */
  score: { you: number; rival: number; label: "Marcador final" | "Marcador al cierre" } | null;
  /** Cómo se decidió (solo si hay resultado del resolver). */
  decision: string | null;
  /** El último turno resuelto, contado con su explicación real. */
  lastTurn: { number: number; headline: string; text: string; result: TurnResult | null } | null;
}

/**
 * El «VICTORIA / DERROTA / EMPATE» que abre el final. El veredicto ENTRA ya decidido (lo dice el servidor:
 * `result.winner`, `closedBySide` o el asiento de rating); aquí solo se ordena lo que se enseña con él.
 * Nunca se fabrica un marcador: sin resultado ni turnos, no hay marcador.
 */
export function matchEndPresentation(i: { verdict: MatchVerdict; view: Pick<DuelMatchView, "result" | "lastTurn"> | null }): MatchEndPresentation {
  const r = i.view?.result ?? null;
  const last = i.view?.lastTurn ?? null;
  const score = r
    ? { you: r.scoreYou, rival: r.scoreRival, label: "Marcador final" as const }
    : last && isNum(last.scoreAfterYou) && isNum(last.scoreAfterRival)
      ? { you: last.scoreAfterYou, rival: last.scoreAfterRival, label: "Marcador al cierre" as const }
      : null;
  const e = last ? explainTurn(last) : null;
  return {
    verdict: i.verdict,
    title: VERDICT_TITLE[i.verdict],
    score,
    decision: r ? DECISION_TITLE[r.decidedBy] : null,
    lastTurn: last && e ? { number: last.number, headline: e.headline, text: e.text, result: e.result } : null,
  };
}

/* ═════════════════════════════ red, reconexión y cola visual ═════════════════════════════ */

/** Máximo de revelaciones pendientes. Si el servidor va por delante, se enseña SOLO la última. */
export const MAX_QUEUED_REVEALS = 1;

/**
 * Qué turno revelar al llegar una foto nueva. `lastSeen === null` (primera foto: entrada o
 * reconexión) ⇒ no se anima nada: la mesa se pinta en el estado del servidor. Si llegan varios
 * turnos de golpe, se revela el último y el resto se salta (cola acotada, sin backlog).
 */
export function planReveals(lastSeen: number | null, history: DuelTurnView[]): { reveal: DuelTurnView | null; skipped: number; seen: number } {
  const seen = history.length;
  if (lastSeen === null || seen <= lastSeen) return { reveal: null, skipped: 0, seen };
  const fresh = seen - lastSeen;
  const ordered = [...history].sort((a, b) => a.number - b.number);
  return { reveal: ordered[ordered.length - 1] ?? null, skipped: Math.max(0, fresh - MAX_QUEUED_REVEALS), seen };
}

/** Aviso de resincronización tras un conflicto de versión (el poller ya pide el estado completo). */
export function syncBanner(status: SyncStatusLike, errorKind: string | null | undefined): { text: string; tone: "warn" } | null {
  if (errorKind === "CONFLICT" && (status === "STALE" || status === "SYNCING")) {
    return { text: "La partida avanzó mientras decidías. Actualizando al estado del servidor…", tone: "warn" };
  }
  return null;
}

/**
 * Tiempo del turno: SOLO si el servidor dio un plazo (`remainingMs` ya descontado con su reloj).
 * Sin plazo no hay reloj. Al llegar a cero no se declara nada: se espera al cierre del servidor.
 */
export function timeoutPresentation(remainingMs: number | null, isYourTurn: boolean): { show: boolean; urgent: boolean; expired: boolean; text: string | null } {
  if (remainingMs === null || !isNum(remainingMs)) return { show: false, urgent: false, expired: false, text: null };
  const expired = remainingMs <= 0;
  return {
    show: true,
    urgent: remainingMs <= 15_000,
    expired,
    text: expired ? (isYourTurn ? "Se agotó tu tiempo. Esperando al servidor…" : "El tiempo del rival se agotó. El servidor está cerrando el turno…") : null,
  };
}

/* ═════════════════════════════ repetición ═════════════════════════════ */

export type ReplayAvailability = "FULL" | "PARTIAL" | "UNAVAILABLE";
export const REPLAY_UNAVAILABLE_TEXT = "Detalle no disponible para esta partida.";
export const REPLAY_STEP_MS: Record<1 | 2, number> = { 1: 1800, 2: 900 };

export interface ReplayFrame {
  index: number;
  number: number;
  attackerYou: boolean;
  yourCard: DuelDeckCardDTO | null;
  rivalCard: DuelDeckCardDTO | null;
  explanation: TurnExplanation;
  result: TurnResult;
  scoreYou: number;
  scoreRival: number;
  final: boolean;
}

export interface ReplayTimeline {
  availability: ReplayAvailability;
  frames: ReplayFrame[];
  note: string | null;
  expectedTurns: number;
  verdict: MatchVerdict | null;
  decision: DecisionStep[] | null;
}

/**
 * La repetición reproduce HECHOS persistidos (los turnos que proyectó el servidor). No vuelve a
 * ejecutar el motor ni reconstruye cartas: si falta algo, la repetición es PARCIAL y lo dice.
 */
export function buildReplayTimeline(replay: DuelReplay | null | undefined, expectedTurns = 10): ReplayTimeline {
  const empty: ReplayTimeline = { availability: "UNAVAILABLE", frames: [], note: REPLAY_UNAVAILABLE_TEXT, expectedTurns, verdict: null, decision: null };
  if (!replay || !Array.isArray(replay.turns) || replay.turns.length === 0) return empty;
  const byUid = new Map([...(replay.yourCards ?? []), ...(replay.rivalCards ?? [])].map((c) => [c.uid, c]));
  const ordered = [...replay.turns].sort((a, b) => a.number - b.number);
  const frames: ReplayFrame[] = ordered.map((t, i) => ({
    index: i,
    number: t.number,
    attackerYou: t.attacker === "A",
    yourCard: byUid.get(t.you?.uid) ?? null,
    rivalCard: byUid.get(t.rival?.uid) ?? null,
    explanation: explainTurn(t),
    result: turnResult(t),
    scoreYou: t.scoreAfterYou,
    scoreRival: t.scoreAfterRival,
    final: i === ordered.length - 1,
  }));
  const gaps = ordered.some((t, i) => t.number !== i + 1);
  const missingCards = frames.some((f) => !f.yourCard || !f.rivalCard);
  const short = ordered.length < expectedTurns;
  const notes = [
    short ? `La partida terminó en el turno ${ordered[ordered.length - 1].number}.` : null,
    gaps ? "Faltan turnos en el registro de esta partida." : null,
    missingCards ? "Faltan datos de alguna carta." : null,
  ].filter(Boolean);
  return {
    availability: short || gaps || missingCards ? "PARTIAL" : "FULL",
    frames,
    note: notes.length ? notes.join(" ") : null,
    expectedTurns,
    verdict: replay.result ? matchVerdict(replay.result) : null,
    decision: replay.result ? decisionSteps(replay.result) : null,
  };
}

export function replayStep(index: number, total: number, cmd: "first" | "prev" | "next" | "last"): number {
  if (total <= 0) return 0;
  const i = cmd === "first" ? 0 : cmd === "last" ? total - 1 : cmd === "prev" ? index - 1 : index + 1;
  return Math.max(0, Math.min(total - 1, i));
}

/* ═══════════════════════ FASE 45 · IMPACTO Y SEÑALES DE LA ARENA ═══════════════════════ */

/** Cómo se siente un turno YA RESUELTO por el servidor, desde tu lado. No compara nada: lee `outcome`. */
export function turnImpact(outcome: DuelTurnView["outcome"]): { result: "win" | "loss" | "tie"; sound: "turn.win" | "turn.loss" | "turn.tie" } {
  if (outcome === "TIE") return { result: "tie", sound: "turn.tie" };
  return outcome === "A" ? { result: "win", sound: "turn.win" } : { result: "loss", sound: "turn.loss" };
}

/** Señales del escenario: quién ataca, si es el último turno y el golpe del turno recién resuelto. */
export interface ArenaSignals {
  attacker: "you" | "rival" | "none";
  finalTurn: boolean;
  /** Turno de la partida, acotado al total (el servidor puede mandar `turn` = total + 1 al cerrar). */
  turn: number;
}

export function arenaSignals(view: Pick<DuelMatchView, "status" | "youAreAttacker" | "turn" | "totalTurns">): ArenaSignals {
  const live = view.status === "IN_PROGRESS";
  const turn = Math.max(1, Math.min(view.turn, view.totalTurns));
  return {
    attacker: live ? (view.youAreAttacker ? "you" : "rival") : "none",
    finalTurn: live && view.turn >= view.totalTurns,
    turn,
  };
}
