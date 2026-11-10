/**
 * DRAFT GAUNTLET · ESTADO DE LA RUN (Fase 39) — transiciones puras; la persistencia y la autoridad son del servidor.
 *
 * El estado guardado (`draft_runs.state`, jsonb acotado) contiene lo necesario para recuperar la run EXACTA aunque el
 * catálogo cambie: el orden de roles, TODAS las ofertas ya mostradas (ids), las elecciones, los rivales fijados al
 * completar el draft y un registro acotado de acciones para idempotencia. La semilla vive en su columna y nunca sale
 * hacia el cliente.
 */
import type { RoleId } from "@/domain/cards/types";
import type { BotDifficulty } from "@/domain/cardgame/opponent/types";
import {
  DRAFT_PICKS, DRAFT_RULES_VERSION, GAUNTLET_STAGES, MAX_ACTION_LOG, RIVAL_NAMES, STAGE_DIFFICULTY, STAGE_LABEL,
  type DraftRunStatus, type StageOutcome,
} from "./rules";
import { offerFor, rivalDeckFor, roleOrderFor, type DraftPool } from "./generate";
import { DRAFT_JACKPOT, type DraftEntryState, type DraftRewardState } from "./economy";

export type DraftActionKind = "start" | "pick" | "start_match" | "abandon";
export interface DraftActionEntry { id: string; kind: DraftActionKind; version: number }

export interface DraftRivalPlan { stage: number; difficulty: BotDifficulty; name: string; cardIds: string[] }

export interface DraftRunState {
  rulesVersion: string;
  dataVersion: string;
  roleOrder: RoleId[];
  picks: string[];
  /** offers[i] = las opciones mostradas en el hueco i (persistidas: recargar no las cambia). */
  offers: string[][];
  /** Fijados al completar el draft (no se enseñan al cliente: son información oculta del rival). */
  rivals: DraftRivalPlan[] | null;
  actions: DraftActionEntry[];
  /** F72 · entrada de la run (servidor). Ausente = run anterior a F72: gratis y sin recompensa. */
  entry?: DraftEntryState;
  /** F72 · recompensa fijada al cerrar la run (servidor). */
  reward?: DraftRewardState;
}

export function createRunState(pool: DraftPool, seed: number): DraftRunState {
  const roleOrder = roleOrderFor(seed);
  return {
    rulesVersion: DRAFT_RULES_VERSION,
    dataVersion: pool.dataVersion,
    roleOrder,
    picks: [],
    offers: [offerFor(pool, seed, 0, roleOrder[0], [])],
    rivals: null,
    actions: [],
  };
}

export const currentPickIndex = (s: DraftRunState): number => s.picks.length;
export const isDraftComplete = (s: DraftRunState): boolean => s.picks.length >= DRAFT_PICKS;
export const currentOffer = (s: DraftRunState): string[] => (isDraftComplete(s) ? [] : s.offers[s.picks.length] ?? []);
export const currentRole = (s: DraftRunState): RoleId | null => (isDraftComplete(s) ? null : s.roleOrder[s.picks.length] ?? null);

export type PickFailure = "DRAFT_COMPLETE" | "NOT_OFFERED" | "CARD_UNAVAILABLE" | "ROLE_MISMATCH" | "ALREADY_PICKED" | "PLAYER_TAKEN" | "NO_OPTIONS";

export function rivalsFor(pool: DraftPool, seed: number): DraftRivalPlan[] {
  return Array.from({ length: GAUNTLET_STAGES }, (_, i) => ({
    stage: i + 1, difficulty: STAGE_DIFFICULTY[i], name: RIVAL_NAMES[i], cardIds: rivalDeckFor(pool, seed, i + 1),
  }));
}

/**
 * Aplica UNA elección. Solo vale una carta de la oferta ACTUAL (persistida), del rol del hueco, no elegida y de un
 * jugador no elegido. Tras la décima, fija los rivales. Nunca acepta una lista de cartas del cliente.
 */
export function applyPick(state: DraftRunState, pool: DraftPool, seed: number, cardId: string):
  { ok: true; state: DraftRunState; complete: boolean } | { ok: false; code: PickFailure } {
  if (isDraftComplete(state)) return { ok: false, code: "DRAFT_COMPLETE" };
  const idx = state.picks.length;
  if (!(state.offers[idx] ?? []).includes(cardId)) return { ok: false, code: "NOT_OFFERED" };
  if (state.picks.includes(cardId)) return { ok: false, code: "ALREADY_PICKED" };
  const card = pool.byId.get(cardId);
  if (!card) return { ok: false, code: "CARD_UNAVAILABLE" };
  if (card.role !== state.roleOrder[idx]) return { ok: false, code: "ROLE_MISMATCH" };
  if (state.picks.some((p) => pool.byId.get(p)?.playerId === card.playerId)) return { ok: false, code: "PLAYER_TAKEN" };
  const picks = [...state.picks, cardId];
  if (picks.length < DRAFT_PICKS) {
    const next = offerFor(pool, seed, picks.length, state.roleOrder[picks.length], picks);
    if (next.length === 0) return { ok: false, code: "NO_OPTIONS" };
    return { ok: true, complete: false, state: { ...state, picks, offers: [...state.offers.slice(0, picks.length), next] } };
  }
  return { ok: true, complete: true, state: { ...state, picks, offers: state.offers.slice(0, DRAFT_PICKS), rivals: rivalsFor(pool, seed) } };
}

export function recordAction(state: DraftRunState, entry: DraftActionEntry): DraftRunState {
  return { ...state, actions: [...state.actions.filter((a) => a.id !== entry.id), entry].slice(-MAX_ACTION_LOG) };
}
export const findAction = (state: DraftRunState, id: string): DraftActionEntry | undefined => state.actions.find((a) => a.id === id);

/** Transición tras un combate liquidado por el servidor. Ganar avanza; perder o empatar termina la run. */
export function settleTransition(run: { status: DraftRunStatus; stage: number }, outcome: StageOutcome): { status: DraftRunStatus; stage: number } {
  if (run.status !== "IN_MATCH") return run;
  if (outcome === "WIN") return run.stage >= GAUNTLET_STAGES ? { status: "COMPLETED", stage: GAUNTLET_STAGES } : { status: "READY", stage: run.stage + 1 };
  return { status: "FAILED", stage: run.stage };
}

/** Resultado del combate para el HUMANO (bando A), con la resolución canónica del motor. */
export function outcomeForHuman(result: { winner: "A" | "B" | null; isDraw: boolean } | null): StageOutcome | null {
  if (!result) return null;
  if (result.isDraw || result.winner === null) return "DRAW";
  return result.winner === "A" ? "WIN" : "LOSS";
}

export interface DraftMatchFact {
  stage: number;
  status: "STARTED" | "SETTLED" | "ABANDONED";
  result: StageOutcome | null;
  matchId: string | null;
  scoreYou: number | null;
  scoreRival: number | null;
}

export type StageNodeState = "LOCKED" | "CURRENT" | "IN_MATCH" | "WON" | "LOST" | "DRAW" | "ABANDONED";

export interface StageNode {
  stage: number;
  label: string;
  difficulty: BotDifficulty;
  rivalName: string;
  state: StageNodeState;
  matchId: string | null;
  scoreYou: number | null;
  scoreRival: number | null;
}

export function stageBoard(run: { status: DraftRunStatus; stage: number }, matches: readonly DraftMatchFact[]): StageNode[] {
  return Array.from({ length: GAUNTLET_STAGES }, (_, i) => {
    const stage = i + 1;
    const m = matches.find((x) => x.stage === stage) ?? null;
    let state: StageNodeState = "LOCKED";
    if (m?.status === "SETTLED") state = m.result === "WIN" ? "WON" : m.result === "LOSS" ? "LOST" : "DRAW";
    else if (m?.status === "ABANDONED") state = "ABANDONED";
    else if (run.status === "IN_MATCH" && run.stage === stage) state = "IN_MATCH";
    else if (run.status === "READY" && run.stage === stage) state = "CURRENT";
    return {
      stage, label: STAGE_LABEL[i], difficulty: STAGE_DIFFICULTY[i], rivalName: RIVAL_NAMES[i], state,
      matchId: m?.matchId ?? null, scoreYou: m?.scoreYou ?? null, scoreRival: m?.scoreRival ?? null,
    };
  });
}

/** Lo que VE el cliente de una run: sin semilla, sin mazos rivales, solo la oferta actual y lo elegido. */
export interface DraftRunView {
  runId: string;
  status: DraftRunStatus;
  version: number;
  rulesVersion: string;
  dataVersion: string;
  pickIndex: number;
  totalPicks: number;
  roleOrder: RoleId[];
  currentRole: RoleId | null;
  offer: string[];
  picks: string[];
  stage: number;
  stages: StageNode[];
  currentMatchId: string | null;
  wins: number;
  createdAt: string;
  completedAt: string | null;
  /** F72 · `null` = run sin entrada (anterior a F72). `paid` lo decide el servidor (libro mayor). */
  entry: { fee: number; paid: boolean } | null;
  /** F72 · lo que la run paga/pagó; `null` mientras sigue o si es anterior a F72. */
  reward: { wins: number; credits: number; title: boolean; jackpot: boolean | null; jackpotPack: string | null; granted: boolean } | null;
}

export interface DraftRunRow {
  id: string;
  status: DraftRunStatus;
  stage: number;
  version: number;
  rules_version: string;
  data_version: string;
  state: DraftRunState;
  current_match_id: string | null;
  created_at: string;
  completed_at: string | null;
}

export function toRunView(row: DraftRunRow, matches: readonly DraftMatchFact[]): DraftRunView {
  const stages = stageBoard(row, matches);
  return {
    runId: row.id,
    status: row.status,
    version: row.version,
    rulesVersion: row.rules_version,
    dataVersion: row.data_version,
    pickIndex: row.state.picks.length,
    totalPicks: DRAFT_PICKS,
    roleOrder: row.state.roleOrder,
    currentRole: row.status === "DRAFTING" ? currentRole(row.state) : null,
    offer: row.status === "DRAFTING" ? currentOffer(row.state) : [],
    picks: row.state.picks,
    stage: row.stage,
    stages,
    currentMatchId: row.status === "IN_MATCH" ? row.current_match_id : null,
    wins: stages.filter((s) => s.state === "WON").length,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    entry: row.state.entry ? { fee: row.state.entry.fee, paid: !!row.state.entry.paidAt } : null,
    reward: row.state.reward ? {
      wins: row.state.reward.wins, credits: row.state.reward.credits, title: row.state.reward.title,
      jackpot: row.state.reward.jackpot, jackpotPack: row.state.reward.jackpotWeek ? DRAFT_JACKPOT.packName : null,
      granted: !!row.state.reward.grantedAt,
    } : null,
  };
}
