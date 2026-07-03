/**
 * ECONOMY ENGINE — Motor (puro, determinista, inmutable).
 *
 *   createEconomy → planRound (decide + gasta) → [ronda simulada] → settleRound (premia)
 *
 * El Match Engine lo orquesta: planifica antes de cada ronda y liquida después con el
 * resultado. No simula combate; solo lleva la economía y produce decisiones.
 */
import type { MatchRosters } from "@/sim";
import type {
  BuyContext, EconomyRoundRecord, EconomyRules, EconomyState, EconomyTeamRound,
  RoundEconomyResult, TeamEconomyState, TeamSlot,
} from "./types";
import { DEFAULT_RULES, lossBonus } from "./rules";
import { teamBuyBias } from "./identity";
import { teamMetrics } from "./metrics";
import { decideBuy } from "./decide";

function makeTeam(roster: MatchRosters["home"], rules: EconomyRules): TeamEconomyState {
  const players: Record<string, number> = {};
  for (const r of roster) players[r.name] = rules.start;
  return {
    players,
    lossStreak: 0,
    prevBuy: null,
    prevStatus: null,
    plannedBuy: null,
    lastDecision: null,
    bonus: false,
    spentThisRound: 0,
    beforeTotal: rules.start * roster.length,
    lostTotal: 0,
    buyBias: teamBuyBias(roster),
  };
}

/** Crea la economía del partido (ambos equipos en la ronda pistola). */
export function createEconomy(rosters: MatchRosters, rules: EconomyRules = DEFAULT_RULES): EconomyState {
  return {
    rules,
    round: 0,
    home: makeTeam(rosters.home, rules),
    away: makeTeam(rosters.away, rules),
    history: [],
    events: [],
  };
}

const totalOf = (t: TeamEconomyState): number => Object.values(t.players).reduce((a, b) => a + b, 0);

/**
 * Decide la compra de un equipo (DECIDE, no gasta). El gasto real lo aplica la Buy
 * Phase vía `commitBuy`: la economía sigue siendo la ÚNICA autoridad del dinero, pero
 * el importe lo determina el equipamiento concreto, no un coste fijo por nivel.
 */
function planTeam(team: TeamEconomyState, ctx: BuyContext, rules: EconomyRules): TeamEconomyState {
  const m = teamMetrics(team, rules);
  const decision = decideBuy(team, m, ctx, rules);
  return {
    ...team,
    plannedBuy: decision.tier,
    lastDecision: decision,
    spentThisRound: 0,
    beforeTotal: m.total,
  };
}

/** Planifica la SIGUIENTE ronda: DECIDE las compras (sin gastar aún). */
export function planRound(state: EconomyState, ctx: { home: BuyContext; away: BuyContext }): EconomyState {
  return {
    ...state,
    round: state.round + 1,
    home: planTeam(state.home, ctx.home, state.rules),
    away: planTeam(state.away, ctx.away, state.rules),
  };
}

function spendTeam(team: TeamEconomyState, spentByName: Record<string, number>): TeamEconomyState {
  const players = { ...team.players };
  let spent = 0;
  for (const name of Object.keys(players)) {
    const pay = Math.max(0, Math.min(players[name], spentByName[name] ?? 0));
    players[name] -= pay;
    spent += pay;
  }
  return { ...team, players, spentThisRound: spent };
}

/**
 * Aplica el gasto real de la Buy Phase (la economía es quien mueve el dinero). El
 * importe por jugador lo calcula la Buy Phase a partir del equipamiento elegido.
 * Nunca deja créditos negativos.
 */
export function commitBuy(
  state: EconomyState,
  spent: { home: Record<string, number>; away: Record<string, number> },
): EconomyState {
  return {
    ...state,
    home: spendTeam(state.home, spent.home),
    away: spendTeam(state.away, spent.away),
  };
}

interface SettledTeam { team: TeamEconomyState; record: EconomyTeamRound; }

function settleTeam(team: TeamEconomyState, won: boolean, kills: Record<string, number>, rules: EconomyRules): SettledTeam {
  const base = won ? rules.win : lossBonus(team.lossStreak, rules);
  const players = { ...team.players };
  let reward = 0;
  for (const name of Object.keys(players)) {
    const gain = base + rules.kill * (kills[name] ?? 0);
    players[name] = Math.min(rules.max, players[name] + gain);
    reward += gain;
  }
  const settled: TeamEconomyState = {
    ...team,
    players,
    lossStreak: won ? 0 : team.lossStreak + 1,
    // Bonus para la próxima: ganaron jugando eco/save (conservan "armas").
    bonus: (team.plannedBuy === "eco" || team.plannedBuy === "save") && won,
    prevBuy: team.plannedBuy,
    prevStatus: team.lastDecision?.status ?? null,
    lostTotal: team.lostTotal + (won ? 0 : team.spentThisRound),
  };
  const m = teamMetrics(settled, rules);
  const record: EconomyTeamRound = {
    buy: team.plannedBuy ?? "eco",
    status: team.lastDecision?.status ?? "stable",
    risk: team.lastDecision?.risk ?? 0,
    creditsBefore: team.beforeTotal,
    spent: team.spentThisRound,
    creditsAfter: m.total,
    reward,
    avg: Math.round(m.avg),
    min: m.min,
    max: m.max,
  };
  return { team: settled, record };
}

/** Liquida la ronda con su resultado: premia, actualiza rachas/bonus e historial. */
export function settleRound(state: EconomyState, result: RoundEconomyResult): EconomyState {
  const home = settleTeam(state.home, result.winner === "home", result.kills, state.rules);
  const away = settleTeam(state.away, result.winner === "away", result.kills, state.rules);
  const record: EconomyRoundRecord = {
    round: state.round,
    home: home.record,
    away: away.record,
    winner: result.winner,
  };
  return { ...state, home: home.team, away: away.team, history: [...state.history, record] };
}

/** Contexto de decisión por equipo a partir del marcador (lo aporta el Match Engine). */
export function buyContexts(
  score: { home: number; away: number },
  matchPointTeams: TeamSlot[],
): { home: BuyContext; away: BuyContext } {
  const homeMP = matchPointTeams.includes("home");
  const awayMP = matchPointTeams.includes("away");
  return {
    home: { matchPoint: homeMP, opponentMatchPoint: awayMP, scoreDiff: score.home - score.away },
    away: { matchPoint: awayMP, opponentMatchPoint: homeMP, scoreDiff: score.away - score.home },
  };
}

export { totalOf as economyTotal };
