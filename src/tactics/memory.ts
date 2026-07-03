/**
 * TACTICAL DIRECTOR 2.0 · MEMORIA DE PARTIDO — REANIMA el modelo de rival que estaba muerto en el
 * juego (se recreaba vacío cada ronda). Persiste el modelo de AMBOS equipos a lo largo del partido
 * y lo realimenta al Tactical Engine, de modo que el Director ADAPTA de verdad (stack del carril
 * predicho, finta del carril perdido, leer rotaciones…). Reutiliza `learnRound` (no reimplementa).
 */
import type { RoundState, Side } from "../sim";
import type { OpponentModel } from "./types";
import { emptyModel } from "./types";
import { learnRound } from "./opponent";

/** Cada equipo guarda su modelo del RIVAL: `home` = lo que el home sabe del away, y viceversa. */
export interface MatchTacticalMemory {
  home: OpponentModel;
  away: OpponentModel;
}

export function createTacticalMemory(): MatchTacticalMemory {
  return { home: emptyModel(), away: emptyModel() };
}

const other = (side: Side): Side => (side === "ATK" ? "DEF" : "ATK");

/**
 * Aprende de una ronda terminada para AMBOS equipos. `homeSide` = lado que jugó el home en esa
 * ronda. No muta el RoundState (solo los modelos). Determinista.
 */
export function learnMatchRound(mem: MatchTacticalMemory, round: RoundState, homeSide: Side): void {
  learnRound(mem.home, round, homeSide);          // el home estudia al away
  learnRound(mem.away, round, other(homeSide));    // el away estudia al home
}
