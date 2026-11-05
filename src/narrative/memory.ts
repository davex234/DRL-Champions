/**
 * MATCH NARRATIVE ENGINE — Memoria de la partida.
 *
 * "Recordar absolutamente todo": estructuras por ronda y por jugador que el resto
 * del motor consulta. Aquí también vive el proxy de ECONOMÍA (el sim no tiene
 * economía real: se ESTIMA por rachas de derrotas y rondas de pistola — claramente
 * marcado como estimado).
 */
import type { NarrativeEvent, TeamId } from "./types";
import { ns } from "@/i18n/runtime";

const tr = ns("narrative");

/** Línea de un jugador en una ronda concreta. */
export interface PlayerRoundLine {
  name: string;
  team: TeamId;
  side: "ATK" | "DEF";
  role: string;
  kills: number;
  deaths: number;
  firstBlood: boolean;
  firstDeath: boolean;
  multikill: number;   // 0,2,3,4,5
  ace: boolean;
  clutch: number;      // tamaño del clutch (enemigos vivos al quedarse solo); 0 = no
  clutchWon: boolean;
  survived: boolean;
  tradeKills: number;
  tradedDeath: boolean;
  confidenceEnd: number;
  tilt: number;
  momentum: number;
  pressure: number;
  /** Presencia (impacto bruto) en la ronda. */
  presence: number;
}

/** Todo lo recordado de una ronda. */
export interface RoundRecord {
  round: number;       // 1-based
  winner: TeamId;
  loser: TeamId;
  winnerSide: "ATK" | "DEF";
  endReason: string;
  scoreAfter: Record<TeamId, number>;
  /** Diferencia de bajas a favor del ganador. */
  killDiffWinner: number;
  pistol: boolean;
  plans: Record<TeamId, { approach: string; tempo: string }>;
  hadTimeout: TeamId | null;
  /** Líneas por nick. */
  lines: Record<string, PlayerRoundLine>;
  /** Eventos narrativos extraídos de esta ronda. */
  events: NarrativeEvent[];
  /** Confianza media (5 jugadores) por equipo al cerrar la ronda. */
  teamConfidence: Record<TeamId, number>;
  /** Momentum mental medio por equipo. */
  teamMomentum: Record<TeamId, number>;
}

/** Estado de economía ESTIMADO por equipo (no hay economía real en el sim). */
export interface EconomyState {
  /** Rachas de derrotas consecutivas (proxy de "eco/forzar"). */
  lossStreak: Record<TeamId, number>;
  /** Bucket cualitativo. */
  bucket: Record<TeamId, "full" | "force" | "eco">;
}

export function initEconomy(): EconomyState {
  return { lossStreak: { A: 0, B: 0 }, bucket: { A: "full", B: "full" } };
}

const other = (t: TeamId): TeamId => (t === "A" ? "B" : "A");

/**
 * Avanza la economía estimada con el resultado de una ronda y devuelve si hubo un
 * "eco_win" (el ganador venía sin dinero estimado) y un cambio de bucket por equipo.
 */
export function stepEconomy(eco: EconomyState, winner: TeamId): {
  ecoWin: boolean;
  changed: TeamId[];
} {
  const loser = other(winner);
  const prevWinnerBucket = eco.bucket[winner];
  eco.lossStreak[winner] = 0;
  eco.lossStreak[loser] += 1;
  const bucketFor = (streak: number): EconomyState["bucket"][TeamId] =>
    streak >= 2 ? "eco" : streak === 1 ? "force" : "full";
  const changed: TeamId[] = [];
  const newWinner: EconomyState["bucket"][TeamId] = "full";
  const newLoser = bucketFor(eco.lossStreak[loser]);
  if (eco.bucket[winner] !== newWinner) { eco.bucket[winner] = newWinner; changed.push(winner); }
  if (eco.bucket[loser] !== newLoser) { eco.bucket[loser] = newLoser; changed.push(loser); }
  // Un eco_win = el ganador venía de "eco/force" (rompió la economía rival).
  const ecoWin = prevWinnerBucket !== "full";
  return { ecoWin, changed };
}
