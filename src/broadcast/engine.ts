/**
 * DRL BROADCAST — `buildBroadcastState` (PURO).
 * Ensambla el estado de retransmisión desde el estado de juego, la decisión del
 * Director y el viewport. No muta nada; los componentes solo lo muestran.
 */
import { TPS, ROUND_TICKS, SPIKE_TICKS, type RoundState, type SimPlayer, type Side, type Phase } from "../sim";
import type { DirectorDecision } from "../spectator";
import type { Viewport } from "../camera";
import type { BroadcastState, TeamInfo, PlayerInfo, MatchInfo, SpikeStatus, PlanInfo, LoadoutInfo } from "./types";
import { winProbability, roundPrediction } from "./winprob";
import { buildKillFeed, detectFlags, topFragger } from "./events";

export interface BroadcastInput {
  state: RoundState;
  decision: DirectorDecision;
  viewport: Viewport;
  /**
   * Contexto de PARTIDO opcional: marcador de la serie y número de ronda REALES.
   * Lo alimenta el Match Engine. Si no se pasa, el broadcast muestra una ronda suelta
   * (comportamiento anterior). No cambia el cerebro del broadcast: solo lo nutre.
   */
  match?: { round: number; score: { atk: number; def: number } };
  /**
   * Contexto ECONÓMICO opcional: créditos y tipo de compra reales por lado. Lo alimenta
   * el Economy Engine. Si se pasa, sustituye la estimación de economía. Aditivo.
   */
  economy?: { atk: { credits: number; buy: string }; def: { credits: number; buy: string } };
  /**
   * Plan de ronda opcional (lo alimentan Preparation y Coach): objetivo, compra, riesgo,
   * entrada, tempo y —si hay entrenador— concepto/confianza/cambio. Aditivo.
   */
  prep?: PlanInfo;
  /**
   * Equipamiento por lado (lo alimenta la Buy Phase): compra, valor, poder de fuego,
   * arma principal. Aditivo; no cambia el cerebro del broadcast.
   */
  loadout?: LoadoutInfo;
}

const PHASE_LABEL: Record<Phase, string> = {
  SETUP: "Compra / setup",
  EXECUTE: "En juego",
  POSTPLANT: "Post-plant",
  ENDED: "Fin de ronda",
};

function fmtTime(secs: number): string {
  const s = Math.max(0, Math.ceil(secs));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function playerInfo(p: SimPlayer, tick: number, focusId: string | null): PlayerInfo {
  return {
    id: p.id, name: p.name, role: p.role, alive: p.alive,
    isFocus: p.id === focusId, flashed: p.flashedUntil > tick,
  };
}

function teamInfo(s: RoundState, side: Side, focusId: string | null): TeamInfo {
  const players = s.players.filter((p) => p.side === side).map((p) => playerInfo(p, s.tick, focusId));
  const alive = players.filter((p) => p.alive).length;
  return {
    side, alive, total: players.length, players,
    economyEstimate: alive * 4500, // estimación (no hay economía real aún)
    loadout: "—",                  // preparado para el futuro
    ultReady: 0,                   // preparado para el futuro
  };
}

function spikeStatus(s: RoundState): SpikeStatus {
  if (s.spike.planted) return s.spike.defuseProgress > 0 ? "defusing" : "planted";
  return "carried";
}

export function buildBroadcastState(input: BroadcastInput): BroadcastState {
  const { state: s, decision, viewport } = input;
  const focusId = decision.focusPlayerId;

  const atk = teamInfo(s, "ATK", focusId);
  const def = teamInfo(s, "DEF", focusId);

  // Economía real (si la aporta el Economy Engine): sustituye la estimación.
  if (input.economy) {
    atk.economyEstimate = input.economy.atk.credits;
    atk.loadout = input.economy.atk.buy;
    def.economyEstimate = input.economy.def.credits;
    def.loadout = input.economy.def.buy;
  }

  const timeLeft = s.spike.planted && s.spike.plantedTick != null
    ? (s.spike.plantedTick + SPIKE_TICKS - s.tick) / TPS
    : (ROUND_TICKS - s.tick) / TPS;

  const score = input.match?.score
    ?? (s.winner ? { atk: s.winner === "ATK" ? 1 : 0, def: s.winner === "DEF" ? 1 : 0 } : { atk: 0, def: 0 });
  const round = input.match?.round ?? 1;

  const match: MatchInfo = {
    map: "Ascent", site: "A", coachSide: s.coachSide, score, round,
    timeLeft: Math.max(0, timeLeft), timeLabel: fmtTime(timeLeft),
    phase: s.phase, phaseLabel: PHASE_LABEL[s.phase], spike: spikeStatus(s),
  };

  const wp = winProbability(atk.alive, def.alive, s.spike.planted);
  const coachWp = s.coachSide === "ATK" ? wp.atk : wp.def;
  const stats = {
    winProb: { atk: wp.atk, def: wp.def, coach: coachWp },
    numbersAdvantage: s.coachSide === "ATK" ? atk.alive - def.alive : def.alive - atk.alive,
    prediction: roundPrediction(wp),
  };

  const focus = focusId ? s.players.find((p) => p.id === focusId) ?? null : null;

  return {
    match,
    teams: { atk, def },
    events: { killFeed: buildKillFeed(s), flags: detectFlags(s) },
    stats,
    observer: {
      camera: viewport.cameraType,
      focusPlayerId: focusId,
      focusName: focus?.name ?? null,
      priority: decision.priority,
      situation: decision.situation,
      reason: decision.reason,
    },
    mvp: topFragger(s),
    plan: input.prep ?? null,
    loadout: input.loadout ?? null,
  };
}
