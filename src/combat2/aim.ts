/**
 * COMBAT 3.0 · PUNTERÍA EMERGENTE — el jugador NUNCA apunta, pero el resultado se SIENTE como si
 * apuntara. Todo son MODIFICADORES PEQUEÑOS y EXPLICABLES, nunca binarios:
 *
 *   "tiene un 7% más de headshot porque: excelente crosshair placement · buena reacción ·
 *    rival entrando en movimiento"
 *
 * Reutiliza attrs (aim/gameSense), identidad (disciplina/composure/IQ/agresividad) y estado
 * mental (confianza/tilt/presión). PURO; el azar vive en el Rng del motor (duel.ts).
 */
import type { SimPlayer } from "../sim/types";
import type { WeaponProfile } from "./weapons";
import type { MovementProfile } from "./movement";
import { clampTrait, unit } from "../sim/identity/traits";

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export interface ShotContext {
  att: SimPlayer;
  def: SimPlayer;
  weapon: WeaponProfile;
  /** Distancia normalizada 0..1. */
  distance: number;
  attMove: MovementProfile;
  defMove: MovementProfile;
  /** Primer disparo del enfrentamiento (pre-apuntado). */
  firstShot: boolean;
  /** Índice del disparo dentro de la ráfaga (0 = primera bala). */
  sprayIndex: number;
  /** Supresión sobre el atacante (0..1): fuego entrante en su zona. */
  suppression: number;
  /** Ventaja combinada del duelo (aim/mental/holder/flash/loadout/agente) ya calculada. */
  edge: number;
}

/** Crosshair placement (0..1): pre-apuntado a la altura de la cabeza. */
export function crosshairPlacement(p: SimPlayer): number {
  const id = p.identity;
  const gs = clampTrait(p.attrs.gameSense) / 99;
  const disc = clampTrait(id.discipline) / 100;
  const iq = clampTrait(id.tacticalIQ) / 100;
  const comp = clampTrait(id.composure) / 100;
  return clamp(0.35 * gs + 0.25 * disc + 0.2 * iq + 0.2 * comp, 0, 1);
}

/** Calidad de reacción (0..1): gameSense + cabeza fría − tilt/presión. */
export function reactionQuality(p: SimPlayer): number {
  const gs = clampTrait(p.attrs.gameSense) / 99;
  const comp = clampTrait(p.identity.composure) / 100;
  const m = p.mental;
  return clamp(0.55 * gs + 0.25 * comp + 0.12 * ((m.confidence - 50) / 50) - 0.18 * (m.tilt / 100) - 0.15 * (m.pressure / 100), 0, 1);
}

export interface Reasoned { p: number; reasons: { label: string; delta: number }[] }

/** Probabilidad EMERGENTE de que un impacto sea a la cabeza (0.03..0.6), con explicación. */
export function headshotChance(ctx: ShotContext): Reasoned {
  const { att, def, weapon, distance, attMove, defMove, firstShot, sprayIndex, suppression } = ctx;
  const m = att.mental;
  const reasons: { label: string; delta: number }[] = [];
  const add = (label: string, delta: number) => { if (Math.abs(delta) >= 0.005) reasons.push({ label, delta }); return delta; };

  let p = 0.15;
  p += add("crosshair placement", 0.12 * (crosshairPlacement(att) - 0.45));
  p += add("primer disparo pre-apuntado", firstShot ? 0.035 * reactionQuality(att) : 0);
  p += add("precisión del arma", 0.08 * (weapon.accuracy - 0.5));
  p += add("distancia", -0.10 * distance * (1 - weapon.accuracy));
  p += add("atacante en movimiento", -0.12 * (1 - attMove.accuracyMult));
  p += add("rival entrando en movimiento", defMove.moving ? 0.04 : 0);
  p += add("confianza", 0.035 * ((m.confidence - 50) / 50));
  p += add("tilt", -0.05 * (m.tilt / 100));
  p += add("presión", -0.045 * (m.pressure / 100));
  p += add("control del spray", -(1 - weapon.control) * 0.04 * sprayIndex);
  p += add("supresión", -0.06 * suppression);
  p += add("agresividad (busca el tiro)", 0.025 * Math.max(0, unit(att.identity.aggression)));

  return { p: clamp(p, 0.03, 0.6), reasons: reasons.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)) };
}

/** Probabilidad de que un disparo IMPACTE (0.03..0.9). El `edge` se COMPRIME (raíz) para que la
 *  mejor mano gane más duelos, pero no todos: deja ventana de trade y remontada. */
export function hitChance(ctx: ShotContext): number {
  const { weapon, distance, attMove, edge, sprayIndex, suppression } = ctx;
  // El edge ya trae las ventajas TÁCTICAS (holder/flash/loadout/agente): se respeta casi entero
  // (solo acotado) para no neutralizar la defensa. La VARIEDAD la aporta la "forma" del duelo (luck).
  const edgeC = clamp(edge, 0.55, 1.75);
  let h = 0.28 * edgeC;
  h *= 0.85 + 0.30 * weapon.power;                        // armas con más pegada/precisión aciertan más
  h *= attMove.accuracyMult;
  h *= 0.72 + 0.28 * weapon.reliability;
  h *= 1 - 0.25 * distance * (1 - weapon.range);          // falloff de acierto por alcance
  h *= 1 - (1 - weapon.control) * 0.12 * sprayIndex;       // el spray pierde control
  h *= 1 - 0.12 * suppression;                             // bajo fuego: dudas
  return clamp(h, 0.03, 0.9);
}
