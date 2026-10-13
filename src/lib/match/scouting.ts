/**
 * SCOUTING — el entrenador ESTUDIA al rival (anti-strat a través del humano).
 *
 * Reactiva el modelo de oponente del Tactical Engine (que estaba muerto fuera de los
 * scripts): reproduce `learnRound` sobre las rondas ya jugadas del partido y extrae
 * LECTURAS reales (por dónde ataca, qué carril no defiende, qué patrón repite, quién
 * es su jugador estrella, cómo está su economía). El Match Engine no se toca: esto LEE
 * `match.rounds` + `match.economy`. El jugador decide el contra; el sim ejecuta su pick.
 */
import type { MatchState } from "@/match";
import { teamEconomyView, type BuyTier } from "@/economy";
import {
  emptyModel, learnRound, predictedAttackLane, leastDefendedLane, patternStrength, worstAttackLane,
  type Lane,
} from "@/tactics";

export interface ScoutReport {
  /** Rondas observadas (0 = aún no hay lectura fiable). */
  rounds: number;
  /** Carril que el rival MÁS ataca + confianza 0..1. */
  predictedAttack: { lane: Lane; label: string; confidence: number };
  /** Carril que el rival MENOS defiende (mejor objetivo de ataque). */
  leastDefended: { lane: Lane; label: string };
  /** Patrón reciente del rival (repite el mismo carril → fuerza alta). */
  pattern: { lane: Lane; label: string; strength: number };
  /** Carril donde NOSOTROS perdemos más al atacar (evitar / fintar). */
  ourWorst: { lane: Lane; label: string; net: number };
  /** Jugador estrella del rival (más bajas acumuladas). */
  dominantFragger: string | null;
  /** Economía del rival la próxima ronda. */
  enemyEconomy: { health: string; buy: BuyTier | null; buyingPower: number };
}

// FULL GAME AUDIT (2026-10-07) · zonas por su función (`ZONE_LABEL`): «A Main»/«B/Tree» son de Ascent y no existen en los otros once mapas.
export const LANE_LABEL: Record<Lane, string> = {
  main: "la entrada principal",
  tree: "el flanco",
  mid: "mid",
};

/** Estudia al rival a partir de las rondas ya jugadas. Puro y determinista. */
export function scout(match: MatchState): ScoutReport {
  const model = emptyModel();
  match.rounds.forEach((round, i) => {
    const homeSide = match.history[i]?.homeSide ?? round.coachSide;
    learnRound(model, round, homeSide);
  });

  const atk = predictedAttackLane(model);
  const least = leastDefendedLane(model);
  const pat = patternStrength(model);
  const worst = worstAttackLane(model);

  const enemyEco = match.economy
    ? teamEconomyView(match.economy.away, match.economy.rules)
    : null;

  return {
    rounds: model.rounds,
    predictedAttack: { lane: atk.lane, label: LANE_LABEL[atk.lane], confidence: atk.confidence },
    leastDefended: { lane: least, label: LANE_LABEL[least] },
    pattern: { lane: pat.lane, label: LANE_LABEL[pat.lane], strength: pat.strength },
    ourWorst: { lane: worst.lane, label: LANE_LABEL[worst.lane], net: worst.net },
    dominantFragger: model.dominantFragger,
    enemyEconomy: {
      health: String(enemyEco?.status ?? enemyEco?.health ?? "—"),
      buy: enemyEco?.buy ?? null,
      buyingPower: enemyEco?.buyingPower ?? 0,
    },
  };
}
