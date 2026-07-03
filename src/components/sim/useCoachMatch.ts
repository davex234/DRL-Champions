"use client";

/**
 * COACH MATCH LOOP — convierte el PARTIDO en un juego de entrenador.
 *
 * A diferencia de `useMatchLoop` (que saltaba PREPARATION→BUY→START y solo dejaba
 * MIRAR), este hook DETIENE la máquina de estados del Match Engine en cada punto de
 * decisión del entrenador:
 *
 *   ROUND END → PREPARACIÓN (panel táctico) → COMPRA (override) → INICIO → OBSERVAR
 *             → MICRODECISIONES / TIMEOUT → ROUND END (briefing) → ...
 *
 * No reescribe NINGÚN motor: orquesta `stepMatch` paso a paso e inyecta las decisiones
 * del jugador (plan manual del Coach Engine, override de compra del Economy Engine,
 * órdenes en vivo vía `applyCall`). El entrenador dirige; los 5 jugadores IA ejecutan.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { applyCall, analyze, tick, TPS, type CoachCallId, type RoundState } from "@/sim";
import { createMatch, matchPointTeams, matchWinner, stepMatch, type MatchConfig, type MatchState } from "@/match";
import { buildManualPlan, applyCommand, type CoachCommandId, type CoachContext, type CoachDecision, type ManualCoachInput } from "@/coach";
import { timeoutDossier, type TimeoutDossier } from "@/lib/match/timeoutDossier";
import { roundBriefing, type RoundBriefing } from "@/lib/match/briefing";
import { teamEconomyView, type BuyTier, type TeamEconomyView } from "@/economy";
import { LiveDirector, liveInput, type DirectorDecision } from "@/spectator";
import { createViewport, updateCamera, type Viewport } from "@/camera";
import { grantMatchOutcomeReward, type MatchReward } from "@/lib/match/rewards";
import { scout, type ScoutReport } from "@/lib/match/scouting";
import {
  buildPlayerCards, recommendationReasons,
  type PlayerCardModel,
} from "@/lib/match/coachIntel";
import { detectMicro, type MicroPrompt } from "@/lib/match/microDecisions";
import { detectRoundMoments, type MomentBadge } from "@/lib/match/moments";
import { matchCompositions, type MatchCompositions } from "@/lib/match/lineups";
import type { RoundPlan } from "@/preparation";
import type { Side } from "@/sim";

export type CoachPhase = "menu" | "preparation" | "buy" | "playing" | "roundEnd" | "ended";
export interface RoundView { vp: Viewport; decision: DirectorDecision }

interface EconomyPair { home: TeamEconomyView; away: TeamEconomyView }

export interface PrepView {
  roundNumber: number;
  side: Side;
  isPistol: boolean;
  isSideSwitch: boolean;
  score: { home: number; away: number };
  teamNames?: { home: string; away: string };
  recommendation: CoachDecision;
  reasons: string[];
  plan: RoundPlan;
  scout: ScoutReport;
  cards: PlayerCardModel[];
  economy: EconomyPair | null;
  /** Match point: "home" = el tuyo, "away" = del rival, null = ninguno. */
  matchPoint: "home" | "away" | null;
  /** Composiciones (Agent Engine): la tuya, la del rival y el matchup. */
  composition: MatchCompositions;
}

export interface BuyView {
  roundNumber: number;
  side: Side;
  recommendedTier: BuyTier | null;
  economy: EconomyPair | null;
  scout: ScoutReport;
  cards: PlayerCardModel[];
}

export interface RoundEndView {
  won: boolean;
  winnerSide: Side | null;
  reason: string | null;
  roundNumber: number;
  causes: ReturnType<typeof analyze>;
  topFragger: { name: string; kills: number } | null;
  /** Marcador YA con esta ronda aplicada. */
  score: { home: number; away: number };
  /** ¿Esta ronda decide el partido? */
  isLast: boolean;
  /** Momentos de producción de la ronda (ACE/FLAWLESS/THRIFTY…), [0] = titular. */
  moments: MomentBadge[];
  /** Briefing rico entre rondas (resumen/aprendizajes/qué hacer). */
  briefing: RoundBriefing;
}

const TIMEOUTS_PER_HALF = 1;
const MAX_MICRO_PER_ROUND = 2;
const STEP_CAP = 600;

const economyPair = (m: MatchState): EconomyPair | null =>
  m.economy
    ? {
        home: teamEconomyView(m.economy.home, m.economy.rules),
        away: teamEconomyView(m.economy.away, m.economy.rules),
      }
    : null;

function topFragger(round: RoundState): { name: string; kills: number } | null {
  const k: Record<string, number> = {};
  for (const e of round.events) {
    if (e.type !== "kill") continue;
    const name = String((e.data as { byName?: string }).byName ?? "");
    if (name) k[name] = (k[name] ?? 0) + 1;
  }
  let best: { name: string; kills: number } | null = null;
  for (const [name, kills] of Object.entries(k)) if (!best || kills > best.kills) best = { name, kills };
  return best;
}

export function useCoachMatch() {
  const [phase, setPhase] = useState<CoachPhase>("menu");
  const [match, setMatch] = useState<MatchState | null>(null);
  const [snap, setSnap] = useState<RoundState | null>(null);
  const [view, setView] = useState<RoundView | null>(null);
  const [prep, setPrep] = useState<PrepView | null>(null);
  const [buy, setBuy] = useState<BuyView | null>(null);
  const [micro, setMicro] = useState<MicroPrompt | null>(null);
  const [timeoutPanel, setTimeoutPanel] = useState<TimeoutDossier | null>(null);
  const [roundEnd, setRoundEnd] = useState<RoundEndView | null>(null);
  const [reward, setReward] = useState<MatchReward | null>(null);
  const [speed, setSpeed] = useState(2);
  const [paused, setPaused] = useState(false);
  const [timeoutsLeft, setTimeoutsLeft] = useState(TIMEOUTS_PER_HALF);

  const matchRef = useRef<MatchState | null>(null);
  const roundRef = useRef<RoundState | null>(null);
  const dirRef = useRef<LiveDirector | null>(null);
  const vpRef = useRef<Viewport | null>(null);
  /** Compuerta que detiene el avance de la simulación (modal abierto / fin de ronda). */
  const gateRef = useRef<null | "micro" | "timeout" | "roundEnd">(null);
  const firedRef = useRef<Set<string>>(new Set());
  const microCountRef = useRef(0);
  const timeoutsRef = useRef(TIMEOUTS_PER_HALF);
  const rewardedRef = useRef(false);
  const speedRef = useRef(speed);
  const pausedRef = useRef(paused);
  const accRef = useRef(0);
  const lastRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => { speedRef.current = speed; }, [speed]);
  useEffect(() => { pausedRef.current = paused; }, [paused]);

  const renderCamera = useCallback((st: RoundState, dt: number) => {
    if (!dirRef.current || !vpRef.current) return;
    const decision = dirRef.current.decide(liveInput(st));
    vpRef.current = updateCamera(vpRef.current, { decision, state: st, dt });
    setView({ vp: vpRef.current, decision });
  }, []);

  // -- builders de vista ----------------------------------------------------
  const coachCtx = (m: MatchState): CoachContext => ({
    autoPlan: m.currentPlan!,
    side: m.currentHomeSide,
    roster: m.config.rosters.home,
    momentum: m.momentum,
    lossStreak: m.economy?.home.lossStreak ?? 0,
    matchPoint: matchPointTeams(m.score, m.config.win),
    lastRoundAce: false,
    seed: (m.config.seed ^ Math.imul(m.roundNumber + 1, 2654435761)) >>> 0,
  });

  const buildPrep = (m: MatchState): PrepView => {
    const rn = m.roundNumber;
    const isSideSwitch = rn === m.config.switchAfter + 1;
    const isPistol = rn === 1 || isSideSwitch;
    const mp = matchPointTeams(m.score, m.config.win);
    const matchPoint = mp.includes("home") ? "home" : mp.includes("away") ? "away" : null;
    const s = scout(m);
    return {
      roundNumber: rn,
      side: m.currentHomeSide,
      isPistol,
      isSideSwitch,
      score: m.score,
      teamNames: m.config.teamNames,
      recommendation: m.currentDecision!,
      reasons: recommendationReasons(m.currentDecision!, s, m),
      plan: m.currentPlan!,
      scout: s,
      cards: buildPlayerCards(m),
      economy: economyPair(m),
      matchPoint: matchPoint as "home" | "away" | null,
      composition: matchCompositions(m.config.rosters.home, m.config.rosters.away),
    };
  };

  const buildBuy = (m: MatchState): BuyView => ({
    roundNumber: m.roundNumber,
    side: m.currentHomeSide,
    recommendedTier: m.economy?.home.plannedBuy ?? null,
    economy: economyPair(m),
    scout: scout(m),
    cards: buildPlayerCards(m),
  });

  // -- ciclo de vida --------------------------------------------------------
  const finish = useCallback((m: MatchState) => {
    if (!rewardedRef.current) { rewardedRef.current = true; setReward(grantMatchOutcomeReward(m)); }
    matchRef.current = m;
    setMatch(m);
    setPhase("ended");
  }, []);

  /** Avanza hasta ROUND_PREPARATION, ejecuta la preparación (IA) y abre el panel. */
  const enterPreparation = useCallback((from: MatchState) => {
    let s = from, guard = 0;
    while (s.phase !== "ROUND_PREPARATION" && s.phase !== "MATCH_END" && guard++ < 12) s = stepMatch(s);
    if (s.phase === "MATCH_END") { finish(s); return; }
    const prepared = stepMatch(s); // onRoundPreparation → BUY_PHASE (plan + recomendación IA listos)
    const rn = prepared.roundNumber;
    if (rn === 1 || rn === prepared.config.switchAfter + 1) {
      timeoutsRef.current = TIMEOUTS_PER_HALF;
      setTimeoutsLeft(TIMEOUTS_PER_HALF);
    }
    matchRef.current = prepared;
    setMatch(prepared);
    setPrep(buildPrep(prepared));
    setPhase("preparation");
  }, [finish]);

  const start = useCallback((config: MatchConfig) => {
    rewardedRef.current = false;
    setReward(null);
    timeoutsRef.current = TIMEOUTS_PER_HALF;
    setTimeoutsLeft(TIMEOUTS_PER_HALF);
    setSnap(null); setView(null); setMicro(null); setTimeoutPanel(null); setRoundEnd(null);
    gateRef.current = null;
    enterPreparation(createMatch(config));
  }, [enterPreparation]);

  const reset = useCallback(() => {
    matchRef.current = null; roundRef.current = null; dirRef.current = null; vpRef.current = null;
    gateRef.current = null; rewardedRef.current = false;
    setReward(null); setSnap(null); setView(null); setMatch(null);
    setPrep(null); setBuy(null); setMicro(null); setTimeoutPanel(null); setRoundEnd(null);
    setPhase("menu");
  }, []);

  /** El entrenador confirma su plan: reescribe currentPlan/currentDecision (modo manual). */
  const confirmPreparation = useCallback((input: ManualCoachInput) => {
    const m = matchRef.current;
    if (!m) return;
    const { plan, decision } = buildManualPlan(coachCtx(m), input);
    m.currentPlan = plan;
    m.currentDecision = decision;
    setBuy(buildBuy(m));
    setPhase("buy");
  }, []);

  /** El entrenador confirma (o cambia) la compra y arranca la ronda. */
  const confirmBuy = useCallback((tier: BuyTier) => {
    const m = matchRef.current;
    if (!m) return;
    if (m.economy) m.economy.home.plannedBuy = tier;
    if (m.currentPlan) m.currentPlan.economy = { ...m.currentPlan.economy, buy: tier };
    let s = stepMatch(m);   // BUY_PHASE → ROUND_START (loadouts con el tier elegido)
    s = stepMatch(s);       // ROUND_START → ROUND_RUNNING (createRound)
    matchRef.current = s;
    roundRef.current = s.currentRound;
    dirRef.current = new LiveDirector();
    vpRef.current = createViewport();
    firedRef.current = new Set();
    microCountRef.current = 0;
    accRef.current = 0;
    lastRef.current = 0;
    gateRef.current = null;
    setMatch(s);
    setSnap(roundRef.current);
    setMicro(null); setTimeoutPanel(null);
    setPaused(false);
    setPhase("playing");
    if (roundRef.current) renderCamera(roundRef.current, 1 / TPS);
  }, [renderCamera]);

  const openRoundEnd = useCallback(() => {
    const finished = roundRef.current;
    const m = matchRef.current;
    if (!finished || !m) return;
    gateRef.current = "roundEnd";
    const homeWon = finished.winner === finished.coachSide;
    const score = { home: m.score.home + (homeWon ? 1 : 0), away: m.score.away + (homeWon ? 0 : 1) };
    const isLast = matchWinner(score, m.config.win) !== null || m.roundNumber >= m.config.maxRounds;
    setRoundEnd({
      won: homeWon,
      winnerSide: finished.winner,
      reason: finished.endReason,
      roundNumber: m.roundNumber,
      causes: analyze(finished),
      topFragger: topFragger(finished),
      score,
      isLast,
      moments: detectRoundMoments(m, finished),
      briefing: roundBriefing(m, finished),
    });
    setPhase("roundEnd");
  }, []);

  /** El entrenador pasa de la pantalla de fin de ronda a la siguiente preparación. */
  const continueAfterRound = useCallback(() => {
    const finished = roundRef.current;
    const m = matchRef.current;
    if (!finished || !m) return;
    let next = stepMatch(m, () => finished); // ROUND_RUNNING → ROUND_END
    next = stepMatch(next);                   // ROUND_END → siguiente (settle)
    matchRef.current = next;
    setRoundEnd(null);
    gateRef.current = null;
    if (next.phase === "MATCH_END") { finish(next); return; }
    enterPreparation(next);
  }, [enterPreparation, finish]);

  // -- microdecisiones, órdenes en vivo y timeout --------------------------
  const respondMicro = useCallback((call?: CoachCallId) => {
    if (call && roundRef.current) {
      roundRef.current = applyCall(roundRef.current, { id: call });
      setSnap(roundRef.current);
    }
    setMicro(null);
    gateRef.current = null;
  }, []);

  /** Orden en vivo del entrenador (Coach Command Layer). Consume Voz; no pausa la ronda. */
  const command = useCallback((id: CoachCommandId) => {
    if (!roundRef.current || roundRef.current.phase === "ENDED" || roundRef.current.voz.left <= 0) return;
    roundRef.current = applyCommand(roundRef.current, id);
    setSnap(roundRef.current);
  }, []);

  const callTimeout = useCallback(() => {
    const m = matchRef.current;
    if (timeoutsRef.current <= 0 || gateRef.current || !m || !roundRef.current || roundRef.current.phase === "ENDED") return;
    gateRef.current = "timeout";
    setTimeoutPanel(timeoutDossier(m, roundRef.current));
  }, []);

  const respondTimeout = useCallback((call?: CoachCommandId) => {
    timeoutsRef.current = Math.max(0, timeoutsRef.current - 1);
    setTimeoutsLeft(timeoutsRef.current);
    if (call && roundRef.current) {
      // El timeout concede una orden aunque no quede Voz (el entrenador habla en la pausa).
      const granted: RoundState = { ...roundRef.current, voz: { ...roundRef.current.voz, left: roundRef.current.voz.left + 1 } };
      roundRef.current = applyCommand(granted, call);
      setSnap(roundRef.current);
    }
    setTimeoutPanel(null);
    gateRef.current = null;
  }, []);

  // -- bucle de simulación (solo en "playing") ------------------------------
  useEffect(() => {
    if (phase !== "playing") return;
    const step = (ts: number) => {
      rafRef.current = requestAnimationFrame(step);
      const r = roundRef.current;
      if (!r) return;
      if (lastRef.current === 0) lastRef.current = ts;
      const dt = Math.min(0.1, (ts - lastRef.current) / 1000);
      lastRef.current = ts;

      const gated = gateRef.current !== null;
      if (!pausedRef.current && !gated && roundRef.current!.phase !== "ENDED") {
        accRef.current += dt * speedRef.current * TPS;
        let steps = 0;
        while (accRef.current >= 1 && roundRef.current!.phase !== "ENDED" && steps < STEP_CAP) {
          roundRef.current = tick(roundRef.current!);
          accRef.current -= 1; steps++;
          // Microdecisión: detén el reloj y pregunta al entrenador.
          if (microCountRef.current < MAX_MICRO_PER_ROUND) {
            const prompt = detectMicro(roundRef.current, firedRef.current);
            if (prompt) {
              firedRef.current.add(prompt.key);
              microCountRef.current++;
              gateRef.current = "micro";
              setMicro(prompt);
              break;
            }
          }
        }
      }
      setSnap(roundRef.current);
      renderCamera(roundRef.current!, dt);

      if (roundRef.current!.phase === "ENDED" && gateRef.current !== "roundEnd") {
        openRoundEnd();
      }
    };
    rafRef.current = requestAnimationFrame(step);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); lastRef.current = 0; };
  }, [phase, renderCamera, openRoundEnd]);

  return {
    phase, match, snap, view, prep, buy, micro, timeoutPanel, roundEnd, reward,
    speed, paused, timeoutsLeft,
    start, reset, confirmPreparation, confirmBuy, continueAfterRound,
    respondMicro, command, callTimeout, respondTimeout, setSpeed, setPaused,
  };
}
