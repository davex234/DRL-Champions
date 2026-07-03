/**
 * MATCH ENGINE — Controlador de PARTIDO mediante máquina de estados.
 *
 * Flujo (nunca ifs gigantes; un caso por estado):
 *   MATCH_START → ROUND_START → ROUND_RUNNING → ROUND_END
 *              → (UPDATE/NEXT)  → ROUND_START | SIDE_SWITCH → … → MATCH_END
 *
 * El Match Engine USA `createRound`/`tick` del sim; nunca al revés. No simula nada
 * por su cuenta: orquesta rondas, marcador, lado y fin de partido, y alimenta al
 * Match Narrative Engine ronda a ronda. Determinista: misma config ⇒ mismo partido.
 */
import { createRound, tick, nextRoundMemory, TPS, type CoachSetup, type RoundState, type Side } from "@/sim";
import { buildMatchNarrative } from "@/narrative";
import {
  createEconomy, planRound, commitBuy, settleRound, buyContexts, detectEconomicEvents, buildTacticalSetup,
} from "@/economy";
import { buildRoundPlan, planToSetup, type PrepContext, type RoundPlan } from "@/preparation";
import { runCoach, detectCoachEvents, type CoachContext } from "@/coach";
import {
  buildTeamLoadout, spentByName, priorityFromConcept, priorityFromTier, detectBuyEvents,
  type MatchLoadouts, type BuyNarrativeRound,
} from "@/buy";
import { detectCombatEvents } from "@/combat2";
import { createTacticalMemory, learnMatchRound, detectTacticalEvents, type ConceptOrder } from "@/tactics";
import type { CoachConcept } from "@/coach";
import {
  matchPointTeams, matchWinner, shouldSwitchSide,
} from "./config";
import type {
  MatchConfig, MatchEvent, MatchScore, MatchState, RoundHistoryEntry, RoundMvp, TeamSlot,
} from "./types";

/** Una función que lleva una ronda hasta el final. Por defecto: tick hasta ENDED. */
export type RoundRunner = (round: RoundState) => RoundState;

/** Runner por defecto: avanza la simulación hasta que la ronda termina. */
export function runRoundToEnd(round: RoundState): RoundState {
  let s = round;
  let guard = 0;
  while (s.phase !== "ENDED" && guard++ < 6000) s = tick(s);
  return s;
}

// ---------------------------------------------------------------------------
// Helpers puros
// ---------------------------------------------------------------------------
const other = (side: Side): Side => (side === "ATK" ? "DEF" : "ATK");

/** Semilla determinista por ronda a partir de la maestra. */
function roundSeed(master: number, round: number): number {
  return (Math.imul((master ^ 0x9e3779b9) >>> 0, 2654435761) ^ Math.imul(round + 1, 40503)) >>> 0;
}

function roundSetup(config: MatchConfig, homeSide: Side): CoachSetup {
  return {
    side: homeSide,
    approach: config.homeSetup.approach,
    tempo: config.homeSetup.tempo,
    aggression: config.homeSetup.aggression,
  };
}

interface NameSets { home: Set<string>; away: Set<string> }
function nameSets(config: MatchConfig): NameSets {
  return {
    home: new Set(config.rosters.home.map((r) => r.name)),
    away: new Set(config.rosters.away.map((r) => r.name)),
  };
}
const teamOfName = (name: string, sets: NameSets): TeamSlot => (sets.home.has(name) ? "home" : "away");

/** MVP de una ronda: el jugador con más bajas. */
function roundMvp(round: RoundState, sets: NameSets): RoundMvp | null {
  const kills: Record<string, number> = {};
  for (const e of round.events) {
    if (e.type !== "kill") continue;
    const name = String((e.data as { byName?: string }).byName ?? "");
    if (name) kills[name] = (kills[name] ?? 0) + 1;
  }
  let best: RoundMvp | null = null;
  for (const [name, k] of Object.entries(kills)) {
    if (!best || k > best.kills) best = { name, kills: k, team: teamOfName(name, sets) };
  }
  return best;
}

/** MVP provisional del partido: más bajas acumuladas en todas las rondas jugadas. */
function aggregateMvp(rounds: RoundState[], sets: NameSets): RoundMvp | null {
  const kills: Record<string, number> = {};
  for (const r of rounds) {
    for (const e of r.events) {
      if (e.type !== "kill") continue;
      const name = String((e.data as { byName?: string }).byName ?? "");
      if (name) kills[name] = (kills[name] ?? 0) + 1;
    }
  }
  let best: RoundMvp | null = null;
  for (const [name, k] of Object.entries(kills)) {
    if (!best || k > best.kills) best = { name, kills: k, team: teamOfName(name, sets) };
  }
  return best;
}

/** Bajas por nombre de jugador en una ronda (para la recompensa económica). */
function killsByName(round: RoundState): Record<string, number> {
  const kills: Record<string, number> = {};
  for (const e of round.events) {
    if (e.type !== "kill") continue;
    const name = String((e.data as { byName?: string }).byName ?? "");
    if (name) kills[name] = (kills[name] ?? 0) + 1;
  }
  return kills;
}

/** ¿Hubo un ace (5 bajas de un jugador) en la última ronda terminada? */
function aceInLastRound(rounds: RoundState[]): boolean {
  const last = rounds[rounds.length - 1];
  if (!last) return false;
  return Object.values(killsByName(last)).some((k) => k >= 5);
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Impacto de una ronda en el partido (0..100): cercanía del marcador + avance. */
function roundImpact(score: MatchScore, firstTo: number): number {
  const closeness = 1 - Math.abs(score.home - score.away) / Math.max(1, firstTo);
  const progress = Math.max(score.home, score.away) / Math.max(1, firstTo);
  return Math.round(clamp(100 * (0.45 * clamp(closeness, 0, 1) + 0.55 * clamp(progress, 0, 1)), 0, 100));
}

function nextMomentum(prev: number, homeWon: boolean): number {
  return Math.round(clamp(prev * 0.55 + (homeWon ? 45 : -45), -100, 100));
}

const ev = (type: MatchEvent["type"], round: number | null, data: Record<string, unknown> = {}): MatchEvent =>
  ({ type, round, data });

// ---------------------------------------------------------------------------
// Construcción y transiciones
// ---------------------------------------------------------------------------
/** Crea el estado inicial de un partido (en MATCH_START). */
export function createMatch(config: MatchConfig): MatchState {
  return {
    config,
    phase: "MATCH_START",
    roundNumber: 0,
    currentHomeSide: config.homeSetup.side,
    score: { home: 0, away: 0 },
    history: [],
    events: [],
    rounds: [],
    currentRound: null,
    memory: null,
    winner: null,
    loser: null,
    totalTicks: 0,
    totalSeconds: 0,
    mvp: null,
    momentum: 0,
    narrative: null,
    economy: config.economy ? createEconomy(config.rosters, config.economy) : null,
    currentPlan: null,
    currentDecision: null,
    currentLoadouts: null,
    buyEvents: [],
    combatEvents: [],
    tacticalMemory: config.useEconomyTactics ? createTacticalMemory() : null,
    tacticalEvents: [],
    coachEvents: [],
  };
}

/**
 * Mapea el CONCEPTO del coach a una ORDEN táctica para el equipo HOME, según el lado que juega.
 * El coach PROPONE; el Tactical Director la ejecuta (los jugadores la interpretan con su ADN).
 */
function coachOrderFor(concept: CoachConcept | undefined, homeSide: Side): ConceptOrder | null {
  if (!concept) return null;
  if (homeSide === "ATK") {
    switch (concept) {
      case "slow": return { intent: "default", tempo: "slow" };
      case "default": return { intent: "default", tempo: "mid" };
      case "explode_a": return { intent: "explode", lane: "main", tempo: "fast" };
      case "explode_b": return { intent: "explode", lane: "mid", tempo: "fast" };
      case "fake": return { intent: "fake", tempo: "mid" };
      case "play_picks": return { intent: "play_picks", tempo: "slow" };
      case "force": return { intent: "contact", tempo: "fast" };
      case "save": return { intent: "save" };
      default: return null;
    }
  }
  // Home en DEFENSA.
  switch (concept) {
    case "play_retake": return { intent: "retake", style: "aggressive" };
    case "slow": case "play_picks": return { intent: "spread", style: "passive" };
    case "save": return { intent: "spread", style: "save" };
    case "force": return { intent: "aggro_info", style: "aggressive" };
    default: return null;
  }
}

function onMatchStart(s: MatchState): MatchState {
  return {
    ...s,
    phase: "ROUND_PREPARATION",
    currentHomeSide: s.config.homeSetup.side,
    events: [...s.events, ev("MATCH_STARTED", null, { firstTo: s.config.win.firstTo, switchAfter: s.config.switchAfter })],
  };
}

/**
 * ROUND_PREPARATION: aquí ocurren TODAS las decisiones estratégicas (nunca en la
 * simulación). Economía decide la compra; Identity/Narrative/Tactical sintetizan el
 * RoundPlan. El Match Engine solo coordina.
 */
function onRoundPreparation(s: MatchState): MatchState {
  const roundNumber = s.roundNumber + 1;
  const events = [...s.events];

  // Match point: ¿algún equipo gana la ronda que se prepara?
  const mp = matchPointTeams(s.score, s.config.win);
  if (mp.length > 0) events.push(ev("MATCH_POINT", roundNumber, { teams: mp }));

  // Economía: planifica las compras de la ronda (decide + gasta).
  const economy = s.economy ? planRound(s.economy, buyContexts(s.score, mp)) : null;

  // El cerebro de preparación sintetiza el plan AUTOMÁTICO (economía + ADN + narrativa).
  const prepSeed = roundSeed(s.config.seed, roundNumber);
  const prepCtx: PrepContext = {
    round: roundNumber,
    side: s.currentHomeSide,
    score: s.score,
    matchPoint: mp,
    momentum: s.momentum,
    homeRoster: s.config.rosters.home,
    economy,
    seed: prepSeed,
  };
  const autoPlan = buildRoundPlan(prepCtx);

  // El ENTRENADOR decide (IA o manual) y reescribe el plan, modulado por la obediencia
  // del ADN. El Match solo coordina: ni mueve jugadores ni compra armas.
  let plan: RoundPlan = autoPlan;
  let decision = null as MatchState["currentDecision"];
  if (s.config.coach.mode !== "none") {
    const coachCtx: CoachContext = {
      autoPlan, side: s.currentHomeSide, roster: s.config.rosters.home,
      momentum: s.momentum, lossStreak: economy?.home.lossStreak ?? 0,
      matchPoint: mp, lastRoundAce: aceInLastRound(s.rounds), seed: prepSeed,
    };
    const result = runCoach(coachCtx, s.config.coach);
    plan = result.plan;
    decision = result.decision;
    events.push(ev("COACH_DECISION", roundNumber, {
      source: decision.source, concept: decision.concept, confidence: decision.confidence,
      changes: decision.changes, deviated: decision.deviated,
    }));
  }

  events.push(ev("ROUND_PREPARED", roundNumber, {
    objective: plan.primaryObjective, entry: plan.entryType, buy: plan.economy.buy,
    risk: plan.riskLevel, tempo: plan.tempo, approach: plan.approach,
  }));

  return { ...s, phase: "BUY_PHASE", roundNumber, economy, currentPlan: plan, currentDecision: decision, events };
}

/**
 * BUY_PHASE: la Buy AI transforma la decisión económica + el plan + el ADN en un
 * loadout por jugador. La economía sigue siendo la autoridad del dinero: la Buy Phase
 * calcula el gasto y la economía lo aplica (commitBuy). No simula nada.
 */
function onBuyPhase(s: MatchState): MatchState {
  const economy = s.economy;
  const plan = s.currentPlan;
  // Sin economía no hay Buy Phase real: pasa directo (loadouts nulos).
  if (!economy || !plan) {
    return { ...s, phase: "ROUND_START" };
  }

  const homeTier = economy.home.plannedBuy ?? "eco";
  const awayTier = economy.away.plannedBuy ?? "eco";
  const homePriority = s.currentDecision ? priorityFromConcept(s.currentDecision.concept) : priorityFromTier(homeTier);
  const seed = roundSeed(s.config.seed, s.roundNumber) ^ 0xb0;

  const homeLoadout = buildTeamLoadout(s.config.rosters.home, economy.home.players, homeTier, homePriority, plan.riskLevel, seed);
  const awayLoadout = buildTeamLoadout(s.config.rosters.away, economy.away.players, awayTier, priorityFromTier(awayTier), "medium", seed ^ 0x99);
  const loadouts: MatchLoadouts = { home: homeLoadout, away: awayLoadout };

  // La economía aplica el gasto real calculado por la Buy Phase.
  const spentEconomy = commitBuy(economy, { home: spentByName(homeLoadout), away: spentByName(awayLoadout) });

  const events = [...s.events, ev("LOADOUTS_READY", s.roundNumber, {
    home: { buy: homeLoadout.buy, value: homeLoadout.totalValue, firepower: homeLoadout.totalFirepower },
    away: { buy: awayLoadout.buy, value: awayLoadout.totalValue, firepower: awayLoadout.totalFirepower },
  })];

  return { ...s, phase: "ROUND_START", economy: spentEconomy, currentLoadouts: loadouts, events };
}

/** ROUND_START: instancia la ronda a partir del plan ya preparado y la lanza. */
function onRoundStart(s: MatchState): MatchState {
  const plan = s.currentPlan;
  // Plan → setup que consume el sim (si por algún motivo no hubiera plan, fallback).
  const setup = plan ? planToSetup(plan) : roundSetup(s.config, s.currentHomeSide);
  const seed = roundSeed(s.config.seed, s.roundNumber);
  const tactical = s.economy && s.config.useEconomyTactics
    ? buildTacticalSetup(s.economy, s.currentHomeSide, {
        memory: s.tacticalMemory ?? undefined,
        homeOrder: coachOrderFor(s.currentDecision?.concept, s.currentHomeSide),
      })
    : undefined;
  // El loadout de cada jugador llega a la simulación (Combat2 lo usa en los duelos).
  // Con useLoadoutCombat=false NO se pasa → combate clásico (para comparar).
  const loadouts = s.currentLoadouts && s.config.useLoadoutCombat
    ? { home: s.currentLoadouts.home.players, away: s.currentLoadouts.away.players }
    : undefined;
  const round = createRound(seed, setup, s.memory ?? undefined, tactical, s.config.rosters, loadouts);

  const events = [...s.events, ev("ROUND_STARTED", s.roundNumber, {
    homeSide: s.currentHomeSide, seed, approach: setup.approach, tempo: setup.tempo,
  })];

  return { ...s, phase: "ROUND_RUNNING", currentRound: round, events };
}

function onRoundRunning(s: MatchState, runner: RoundRunner): MatchState {
  const finished = runner(s.currentRound!);
  return { ...s, phase: "ROUND_END", currentRound: finished };
}

function onRoundEnd(s: MatchState): MatchState {
  const finished = s.currentRound!;
  const sets = nameSets(s.config);
  const winnerSide = finished.winner!;
  const winner: TeamSlot = winnerSide === s.currentHomeSide ? "home" : "away";

  const score: MatchScore = {
    home: s.score.home + (winner === "home" ? 1 : 0),
    away: s.score.away + (winner === "away" ? 1 : 0),
  };
  const rounds = [...s.rounds, finished];
  // Tactical Director 2.0: aprende del rival (modelo PERSISTIDO) para adaptar la próxima ronda.
  let tacticalMemory = s.tacticalMemory;
  if (s.config.useEconomyTactics && tacticalMemory) {
    tacticalMemory = structuredClone(tacticalMemory);
    learnMatchRound(tacticalMemory, finished, s.currentHomeSide);
  }
  const totalTicks = s.totalTicks + finished.tick;
  const momentum = nextMomentum(s.momentum, winner === "home");
  const mvp = aggregateMvp(rounds, sets);

  // Economía: liquida la ronda (premia, rachas, bonus, historial).
  const economy = s.economy ? settleRound(s.economy, { winner, kills: killsByName(finished) }) : null;
  const lastEco = economy?.history[economy.history.length - 1];

  const entry: RoundHistoryEntry = {
    number: s.roundNumber,
    homeSide: s.currentHomeSide,
    winner,
    winnerSide,
    durationTicks: finished.tick,
    durationSeconds: Math.round((finished.tick / TPS) * 10) / 10,
    reason: finished.endReason ?? "unknown",
    mvp: roundMvp(finished, sets),
    impact: roundImpact(score, s.config.win.firstTo),
    scoreAfter: { ...score },
    // El placeholder de Fase 1 se rellena con las compras reales.
    economy: lastEco ? { home: lastEco.home.buy, away: lastEco.away.buy } : null,
    // Plan y decisión del entrenador (persistidos para análisis/replay).
    plan: s.currentPlan,
    coach: s.currentDecision,
    // Resumen de loadouts de la ronda (para narrativa/análisis/broadcast).
    loadout: s.currentLoadouts ? {
      home: { buy: s.currentLoadouts.home.buy, value: s.currentLoadouts.home.totalValue, firepower: s.currentLoadouts.home.totalFirepower },
      away: { buy: s.currentLoadouts.away.buy, value: s.currentLoadouts.away.totalValue, firepower: s.currentLoadouts.away.totalFirepower },
    } : null,
  };

  const events = [...s.events, ev("ROUND_FINISHED", s.roundNumber, {
    winner, winnerSide, reason: entry.reason, score: { ...score },
  })];

  // ¿Decidido por reglas o por tope de seguridad?
  let decided = matchWinner(score, s.config.win);
  if (!decided && s.roundNumber >= s.config.maxRounds) {
    decided = score.home === score.away ? null : score.home > score.away ? "home" : "away";
  }

  const base: MatchState = {
    ...s,
    score, rounds, totalTicks,
    totalSeconds: Math.round((totalTicks / TPS) * 10) / 10,
    momentum, mvp,
    history: [...s.history, entry],
    currentRound: null,
    memory: nextRoundMemory(finished),
    events,
    economy,
    tacticalMemory,
  };

  if (decided) {
    const loser: TeamSlot = decided === "home" ? "away" : "home";
    base.events.push(ev(decided === "home" ? "VICTORY" : "DEFEAT", s.roundNumber, { winner: decided, score: { ...score } }));
    base.events.push(ev("MATCH_ENDED", s.roundNumber, { winner: decided, score: { ...score } }));
    // Narrativa del PARTIDO completo (alimentada ronda a ronda).
    const narrative = buildMatchNarrative(rounds, {
      target: s.config.win.firstTo,
      teamNames: s.config.teamNames
        ? { A: s.config.teamNames.home, B: s.config.teamNames.away }
        : undefined,
    });
    // Significado económico de todo el partido (no frases, eventos estructurados).
    const finalEconomy = economy ? { ...economy, events: detectEconomicEvents(economy.history) } : null;
    // Significado de COMPRA del partido (perfecta/arriesgada/heroica/error/milagro…).
    const buyRounds: BuyNarrativeRound[] = base.history
      .filter((h) => h.loadout != null)
      .map((h) => ({ round: h.number, winner: h.winner, home: h.loadout!.home, away: h.loadout!.away }));
    const buyEvents = detectBuyEvents(buyRounds);
    // Significado de combate por equipamiento (duelos ganados por superioridad/heroicos).
    const homeNames = new Set(s.config.rosters.home.map((r) => r.name));
    const combatEvents = detectCombatEvents(rounds, homeNames);
    // Significado TÁCTICO del partido (fakes/rotaciones/retakes/anti-strat/lecturas…).
    const tacticalEvents = s.config.useEconomyTactics ? detectTacticalEvents(rounds) : [];
    // Significado de las DECISIONES del entrenador (timeouts/lecturas/llamadas/remontadas).
    const coachEvents = detectCoachEvents(rounds);
    return { ...base, phase: "MATCH_END", winner: decided, loser, narrative, economy: finalEconomy, buyEvents, combatEvents, tacticalEvents, coachEvents };
  }

  // Entre rondas siempre se vuelve a PREPARACIÓN (tras el cambio de lado si toca).
  if (shouldSwitchSide(s.roundNumber, s.config)) return { ...base, phase: "SIDE_SWITCH" };
  return { ...base, phase: "ROUND_PREPARATION" };
}

function onSideSwitch(s: MatchState): MatchState {
  const currentHomeSide = other(s.currentHomeSide);
  return {
    ...s,
    phase: "ROUND_PREPARATION",
    currentHomeSide,
    events: [...s.events, ev("SIDE_SWITCHED", s.roundNumber, { homeSide: currentHomeSide })],
  };
}

/** Avanza la máquina de estados UN paso. Devuelve un NUEVO estado (inmutable). */
export function stepMatch(state: MatchState, runner: RoundRunner = runRoundToEnd): MatchState {
  switch (state.phase) {
    case "MATCH_START": return onMatchStart(state);
    case "ROUND_PREPARATION": return onRoundPreparation(state);
    case "BUY_PHASE": return onBuyPhase(state);
    case "ROUND_START": return onRoundStart(state);
    case "ROUND_RUNNING": return onRoundRunning(state, runner);
    case "ROUND_END": return onRoundEnd(state);
    case "SIDE_SWITCH": return onSideSwitch(state);
    case "MATCH_END": return state; // terminal
  }
}

/**
 * Juega un partido COMPLETO de forma headless (tests/uso sin UI). Para un driver
 * en vivo (RAF) se usa `stepMatch` paso a paso con un runner que controle el tick.
 */
export function simulateMatch(config: MatchConfig, runner: RoundRunner = runRoundToEnd): MatchState {
  let s = createMatch(config);
  let guard = 0;
  // Por ronda: PREPARATION→START→RUNNING→END (+ SIDE_SWITCH ocasional).
  while (s.phase !== "MATCH_END" && guard++ < config.maxRounds * 8 + 10) {
    s = stepMatch(s, runner);
  }
  return s;
}
