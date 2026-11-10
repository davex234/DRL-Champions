/**
 * DRL BROADCAST — probabilidad de victoria y predicción de ronda (PURO).
 * Modelo logístico ligero a partir de vivos + estado del spike. Acotado a [0,1].
 */
import type { RoundPrediction } from "./types";
import type { Side } from "../sim";

export interface WinProb { atk: number; def: number }

/** Probabilidad de que gane el ATAQUE (y su complementaria). */
export function winProbability(atkAlive: number, defAlive: number, planted: boolean): WinProb {
  const z = 0.55 * (atkAlive - defAlive) + (planted ? 1.1 : 0);
  const atk = 1 / (1 + Math.exp(-z));
  const clamped = Math.max(0.02, Math.min(0.98, atk));
  return { atk: clamped, def: 1 - clamped };
}

/** Predicción de ronda (favorito + confianza 0..1). */
export function roundPrediction(wp: WinProb): RoundPrediction {
  const winner: Side = wp.atk >= 0.5 ? "ATK" : "DEF";
  const p = Math.max(wp.atk, wp.def);
  return {
    winner,
    confidence: Math.round((p - 0.5) * 2 * 100) / 100,
    label: `${winner === "ATK" ? "Ataque" : "Defensa"} ${Math.round(p * 100)}%`,
  };
}
