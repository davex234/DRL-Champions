/**
 * OPPONENT CONTROLLER (Fase 6).
 *
 * Sabe quién controla cada bando y hace avanzar al bot cuando le toca.
 *
 * REGLA CENTRAL: el bot es UN CONSUMIDOR MÁS de la API del orquestador. Cada decisión suya pasa
 * por `selectAttackerCard`, `selectAttackerStat`, `selectDefenderCard`, `selectDefenderStat` y
 * `confirmTurn`, con las mismas validaciones que aplicarían a una persona. El controlador NO toca
 * `usedCards`, `score`, `turns`, `phase` ni `attacker`.
 *
 * Consecuencia: Humano vs Humano, Humano vs Bot y Bot vs Bot usan exactamente las mismas reglas.
 */
import type { CombatStatKey } from "@/domain/cards/combat";
import {
  availableCards, confirmTurn, requiredDefenderStat,
  selectAttackerCard, selectAttackerStat, selectDefenderCard, selectDefenderStat,
  type DuelMatch, type MatchAction, type Side,
} from "../match";
import type { DuelDeckCard } from "../types";
import { isRngState, type RngState } from "./rng";
import type {
  BotStepResult, DecisionContext, DecisionLogEntry, DuelOpponent, DuelParticipant, OpponentError,
} from "./types";

const other = (s: Side): Side => (s === "A" ? "B" : "A");

const ALL_STATS: CombatStatKey[] = ["stronghold", "gamesense", "entryfrag"];

/** Quién controla cada bando. El dominio no asume que «A» sea siempre humano. */
export interface OpponentController {
  A: DuelParticipant;
  B: DuelParticipant;
}

/** Crea un controlador. Cualquier combinación de humano y bot es válida. */
export function createController(a: DuelParticipant, b: DuelParticipant): OpponentController {
  return { A: a, B: b };
}

/** ¿Le toca decidir a un bot en este momento? */
export function isBotTurn(match: DuelMatch, ctrl: OpponentController): boolean {
  const side = actingSide(match);
  return side !== null && ctrl[side].kind === "BOT";
}

/** Qué bando debe decidir ahora, según la fase. */
export function actingSide(match: DuelMatch): Side | null {
  if (match.status !== "IN_PROGRESS" || match.attacker === null) return null;
  switch (match.phase) {
    case "ATTACKER_CARD":
    case "ATTACKER_STAT":
      return match.attacker;
    case "DEFENDER_CARD":
    case "DEFENDER_STAT":
      return other(match.attacker);
    default:
      return null;
  }
}

/** Cartas del rival que el bot puede ver, según su dificultad. */
function visibleOpponentCards(match: DuelMatch, side: Side, bot: DuelOpponent): DuelDeckCard[] {
  const opp = other(side);
  const snapshot = opp === "A" ? match.snapshotA : match.snapshotB;
  // La visibilidad la DECLARA el bot, no la deduce el controlador de su dificultad: así se puede
  // medir la aportación de la información oculta con el nivel fijo (OPD-04).
  if (bot.perfectInformation) return availableCards(match, opp);      // información perfecta
  const played = new Set(opp === "A" ? match.usedA : match.usedB);
  return snapshot.cards.filter((c) => played.has(c.uid));             // solo lo ya jugado
}

/*
 * DUEL GAMEPLAY UX 2.0 · INFORMACIÓN OCULTA SIMÉTRICA. La carta que el atacante compromete es SECRETA para el defensor
 * hasta que el defensor compromete la suya: la persona que defiende solo ve un reverso y la estadística declarada. El
 * bot defensor no puede saber más que una persona en su lugar, así que ya NO recibe el valor de la carta atacante
 * (`attackerValue` siempre null): responde sabiendo solo el eje, igual que tú. La estrategia ya tenía ese camino
 * («sin saber contra qué compite, responde con su valor más alto en ese eje»).
 */

/** Construye el contexto de decisión. Es TODO lo que el bot puede ver. */
function buildContext(
  match: DuelMatch, side: Side, bot: DuelOpponent, rng: RngState, available: DuelDeckCard[],
): DecisionContext {
  const isAttacker = match.attacker === side;
  const required = requiredDefenderStat(match);
  return {
    role: isAttacker ? "ATTACKER" : "DEFENDER",
    side,
    turn: match.currentTurn,
    available,
    legalStats: isAttacker ? ALL_STATS : required ? [required] : [],
    attackerStat: match.draft.attackerStat,
    attackerValue: null, // la carta atacante es secreta para el defensor (ver arriba)
    visibleOpponentCards: visibleOpponentCards(match, side, bot),
    scoreSelf: side === "A" ? match.scoreA : match.scoreB,
    scoreOpponent: side === "A" ? match.scoreB : match.scoreA,
    rng,
  };
}

const failStep = (match: DuelMatch, rng: RngState, error: OpponentError): BotStepResult =>
  ({ ok: false, error, match, rng });

/**
 * Ejecuta UNA decisión del bot: la que corresponda a la fase actual.
 *
 * Si el orquestador rechaza la decisión —cosa que no debería pasar, porque el bot solo elige entre
 * opciones que el propio orquestador considera disponibles— se devuelve `ILLEGAL_DECISION` con el
 * código del rechazo. NUNCA se fuerza la jugada.
 */
export function advanceBotDecision(
  match: DuelMatch, ctrl: OpponentController, bot: DuelOpponent, rng: RngState,
): BotStepResult {
  if (!isRngState(rng)) return failStep(match, rng, { code: "INVALID_RNG_STATE" });
  if (match.status !== "IN_PROGRESS") {
    return failStep(match, rng, { code: "MATCH_NOT_IN_PROGRESS", turn: match.currentTurn });
  }

  const side = actingSide(match);
  if (side === null || ctrl[side].kind !== "BOT") {
    return failStep(match, rng, { code: "NOT_BOT_TURN", turn: match.currentTurn });
  }

  const available = availableCards(match, side);
  const ctx = buildContext(match, side, bot, rng, available);

  const needsCard = match.phase === "ATTACKER_CARD" || match.phase === "DEFENDER_CARD";
  if (needsCard && available.length === 0) {
    return failStep(match, rng, { code: "NO_AVAILABLE_CARDS", side, turn: match.currentTurn });
  }
  const needsStat = match.phase === "ATTACKER_STAT" || match.phase === "DEFENDER_STAT";
  if (needsStat && ctx.legalStats.length === 0) {
    return failStep(match, rng, { code: "NO_LEGAL_STATS", side, turn: match.currentTurn });
  }

  const role = ctx.role;
  let step: DecisionLogEntry["step"];
  let chosen: string;
  let options: string[];
  let explanation: string;
  let nextRng: RngState;
  let action: MatchAction;

  switch (match.phase) {
    case "ATTACKER_CARD": {
      const d = bot.chooseAttackerCard(ctx);
      step = "ATTACKER_CARD"; chosen = d.value; explanation = d.explanation; nextRng = d.rng;
      options = available.map((c) => c.uid);
      action = selectAttackerCard(match, d.value);
      break;
    }
    case "ATTACKER_STAT": {
      // La carta ya está fijada: el contexto solo le ofrece esa, para que la heurística sea coherente.
      const fixed = available.filter((c) => c.uid === match.draft.attackerCardUid);
      const d = bot.chooseAttackerStat({ ...ctx, available: fixed.length ? fixed : ctx.available });
      step = "ATTACKER_STAT"; chosen = d.value; explanation = d.explanation; nextRng = d.rng;
      options = ctx.legalStats;
      action = selectAttackerStat(match, d.value);
      break;
    }
    case "DEFENDER_CARD": {
      const d = bot.chooseDefenderCard(ctx);
      step = "DEFENDER_CARD"; chosen = d.value; explanation = d.explanation; nextRng = d.rng;
      options = available.map((c) => c.uid);
      action = selectDefenderCard(match, d.value);
      break;
    }
    case "DEFENDER_STAT": {
      const d = bot.chooseDefenderStat(ctx);
      step = "DEFENDER_STAT"; chosen = d.value; explanation = d.explanation; nextRng = d.rng;
      options = ctx.legalStats;
      action = selectDefenderStat(match, d.value);
      break;
    }
    default:
      return failStep(match, rng, { code: "NOT_BOT_TURN", turn: match.currentTurn });
  }

  if (!action.ok) {
    return failStep(match, nextRng, {
      code: "ILLEGAL_DECISION", side, turn: match.currentTurn, detail: action.error.code,
    });
  }

  const log: DecisionLogEntry[] = [{
    turn: match.currentTurn, side, role, step,
    actor: "BOT", strategy: `${bot.id}:${bot.difficulty}`,
    chosen, options, explanation,
  }];

  return { ok: true, match: action.match, rng: nextRng, log };
}

/**
 * Hace avanzar al bot todo lo que le corresponda: encadena decisiones mientras siga siendo su
 * turno, y confirma el turno cuando ambos lados han elegido.
 *
 * Se detiene en cuanto el turno pasa a manos de un humano, o cuando la partida termina.
 */
export function advanceBots(
  match: DuelMatch, ctrl: OpponentController, bots: Partial<Record<Side, DuelOpponent>>,
  rngA: RngState, rngB: RngState, maxSteps = 100,
): { match: DuelMatch; rngA: RngState; rngB: RngState; log: DecisionLogEntry[]; error?: OpponentError } {
  let m = match, ra = rngA, rb = rngB;
  const log: DecisionLogEntry[] = [];

  for (let i = 0; i < maxSteps; i++) {
    if (m.status !== "IN_PROGRESS") break;

    // Ambos lados han elegido: toca confirmar. Lo hace el controlador, no el bot.
    if (m.phase === "READY_TO_CONFIRM") {
      const c = confirmTurn(m);
      if (!c.ok) return { match: m, rngA: ra, rngB: rb, log, error: { code: "ILLEGAL_DECISION", detail: c.error.code } };
      m = c.match;
      continue;
    }

    const side = actingSide(m);
    if (side === null || ctrl[side].kind !== "BOT") break;   // le toca a una persona

    const bot = bots[side];
    if (!bot) break;

    const step = advanceBotDecision(m, ctrl, bot, side === "A" ? ra : rb);
    if (!step.ok) return { match: m, rngA: ra, rngB: rb, log, error: step.error };

    m = step.match;
    if (side === "A") ra = step.rng; else rb = step.rng;
    log.push(...step.log);
  }

  return { match: m, rngA: ra, rngB: rb, log };
}
