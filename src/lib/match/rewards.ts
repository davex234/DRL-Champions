/**
 * MATCH REWARDS — las recompensas del partido VUELVEN a la colección.
 *
 * Cierra el bucle Colección → Simulador → Colección: al terminar la ronda se
 * conceden créditos/XP a la cuenta del usuario (vía el aplicador de recompensas
 * compartido). En esta fase un "partido" = una ronda; el cálculo está centralizado
 * para que ampliarlo a 13 rondas sea trivial.
 */
import type { RoundState, Side } from "@/sim";
import type { MatchState } from "@/match";
import { applyReward } from "@/lib/rewards";
import { useGameStore } from "@/store/useGameStore";
import { useManagerStore } from "@/store/useManagerStore";

export interface MatchReward {
  won: boolean;
  credits: number;
  xp: number;
  /** Bajas del equipo entrenado (para el desglose de la recompensa). */
  teamKills: number;
}

const WIN = { credits: 150, xp: 40 };
const LOSS = { credits: 50, xp: 15 };
const PER_KILL = { credits: 10, xp: 2 };

/** Calcula la recompensa de un partido terminado (PURO, no aplica nada). */
export function computeMatchReward(state: RoundState): MatchReward {
  const coachSide: Side = state.coachSide;
  const won = state.winner === coachSide;
  const teamKills = state.events.filter(
    (e) => e.type === "kill" && (e.data as { bySide?: Side }).bySide === coachSide,
  ).length;

  const base = won ? WIN : LOSS;
  return {
    won,
    teamKills,
    credits: base.credits + teamKills * PER_KILL.credits,
    xp: base.xp + teamKills * PER_KILL.xp,
  };
}

/**
 * Calcula y APLICA la recompensa a la colección (créditos + XP). Devuelve el
 * desglose para mostrarlo en el análisis post-ronda. Idempotencia: el llamador debe
 * invocarlo UNA vez por ronda terminada (la UI lo controla con una guarda por seed).
 */
export function grantMatchReward(state: RoundState): MatchReward {
  const reward = computeMatchReward(state);
  applyReward({ credits: reward.credits, xp: reward.xp });
  return reward;
}

const MATCH_WIN_BONUS = { credits: 300, xp: 100 };

/**
 * Recompensa de un PARTIDO completo: agrega la recompensa de cada ronda (reutiliza
 * `computeMatchReward`) y añade un bonus por ganar el partido. Pura, no aplica nada.
 */
export function computeMatchOutcomeReward(match: MatchState): MatchReward {
  let credits = 0, xp = 0, teamKills = 0;
  for (const round of match.rounds) {
    const r = computeMatchReward(round);
    credits += r.credits; xp += r.xp; teamKills += r.teamKills;
  }
  const won = match.winner === "home";
  if (won) { credits += MATCH_WIN_BONUS.credits; xp += MATCH_WIN_BONUS.xp; }
  return { won, credits, xp, teamKills };
}

/** Calcula y APLICA la recompensa del partido a la colección. Llamar UNA vez al final. */
export function grantMatchOutcomeReward(match: MatchState): MatchReward {
  const reward = computeMatchOutcomeReward(match);
  applyReward({ credits: reward.credits, xp: reward.xp });
  // Récord de carrera (gancho de progresión: alimenta el hub y la ceremonia).
  useGameStore.getState().recordMatch(reward.won);
  // Carrera del ENTRENADOR (Career Engine): no-op si el usuario aún no creó su entrenador.
  useManagerStore.getState().applyMatch({
    won: reward.won,
    kills: reward.teamKills,
    teamName: match.config.teamNames?.home,
    opponentName: match.config.teamNames?.away,
    tier: "regional",
  });
  return reward;
}
