/**
 * COMBAT 3.0 · MOVIMIENTO — el movimiento influye, pero NUNCA como animación ni de forma binaria:
 * solo MODIFICADORES pequeños de precisión y de ventaja de peek. Reutiliza `movedThisTick`, el
 * `intent` y la identidad (disciplina/agresividad/creatividad). PURO.
 *
 * Estilos emergentes: holding (quieto) · counter-strafe (frena para disparar) · peek/swing
 * (abre ángulo) · wide (entrada amplia) · jiggle (baile de información).
 */
import type { SimPlayer } from "../sim/types";
import { clampTrait, unit } from "../sim/identity/traits";

export type Stance = "hold" | "counterstrafe" | "peek" | "wide" | "jiggle";

export interface MovementProfile {
  stance: Stance;
  moving: boolean;
  /** Multiplicador de precisión del PRIMER disparo (0.78..1.05). */
  accuracyMult: number;
  /** Ventaja de quien abre el ángulo con buen timing (0..0.12) — peeker's advantage. */
  peekEdge: number;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Deriva el perfil de movimiento de un jugador (estilo + modificadores pequeños). */
export function movementProfile(p: SimPlayer): MovementProfile {
  const id = p.identity;
  const disc = clampTrait(id.discipline) / 100;
  const aggr = Math.max(0, unit(id.aggression));
  const creat = Math.max(0, unit(id.creativity));
  const moving = p.movedThisTick;
  const fighting = p.intent === "fight" || p.intent === "trade" || p.intent === "push";

  if (!moving) {
    // Quieto, manteniendo el ángulo: máxima precisión, sin ventaja de peek.
    return { stance: "hold", moving: false, accuracyMult: 1.0 + 0.05 * disc, peekEdge: 0 };
  }

  // En movimiento: el disciplinado "frena para disparar" (counter-strafe) y recupera precisión;
  // el agresivo hace wide-swing (más penalización pero más ventaja de apertura).
  let stance: Stance = "peek";
  if (fighting && disc > 0.6) stance = "counterstrafe";
  else if (aggr > 0.4 && fighting) stance = "wide";
  else if (creat > 0.4) stance = "jiggle";

  // Penalización base por moverse (pequeña), mitigada por disciplina (control de paso).
  const movePenalty = 0.18 * (1 - 0.55 * disc);
  let accuracyMult = 1 - movePenalty;
  let peekEdge = 0;
  switch (stance) {
    case "counterstrafe": accuracyMult = 1 - movePenalty * 0.35; peekEdge = 0.06 + 0.04 * disc; break;
    case "wide":          accuracyMult = 1 - movePenalty * 1.15; peekEdge = 0.08 + 0.04 * aggr; break;
    case "jiggle":        accuracyMult = 1 - movePenalty * 0.8;  peekEdge = 0.03; break;
    default:              peekEdge = 0.05; break; // peek normal
  }
  return { stance, moving: true, accuracyMult: clamp(accuracyMult, 0.78, 1.05), peekEdge: clamp(peekEdge, 0, 0.12) };
}
