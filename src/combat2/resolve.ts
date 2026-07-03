/**
 * COMBAT INTEGRATION — Resolución ENRIQUECIDA del duelo.
 *
 * Devuelve un MULTIPLICADOR sobre la probabilidad de cerrar el duelo del atacante,
 * combinando arma (vs distancia y movimiento), escudo (supervivencia/repeek), utilidad
 * (ejecutar/retomar) e identidad (el mismo loadout rinde distinto según el ADN). PURO y
 * determinista. Si falta loadout, devuelve 1 (combate clásico intacto).
 */
import type { Phase, SimPlayer } from "../sim";
import { effectiveValue, profileFor } from "./weapons";
import { shieldEffect } from "./shield";
import { utilityEffect } from "./utility";

const MAX_RANGE = 600;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const unit = (t: number) => (clamp(t, 0, 100) - 50) / 50;

/** Ruido determinista por pareja de jugadores, en [-1, 1]. */
function pairNoise(a: string, b: string): number {
  let h = 2166136261 >>> 0;
  const s = `${a}|${b}`;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 1000) / 1000 * 2 - 1;
}

export function loadoutDuelMult(att: SimPlayer, def: SimPlayer, distance: number, phase: Phase): number {
  if (!att.loadout || !def.loadout) return 1;
  const d = clamp(distance / MAX_RANGE, 0, 1);

  // 1) Arma: valor efectivo del atacante vs defensor (dampeado).
  const effA = effectiveValue(profileFor(att.loadout), d, att.movedThisTick);
  const effD = effectiveValue(profileFor(def.loadout), d, def.movedThisTick);
  const weaponMult = clamp(Math.pow((effA + 0.12) / (effD + 0.12), 0.6), 0.6, 1.7);

  // 2) Identidad: la agresividad amplifica la ventaja de arma REALIZADA.
  const aggrAmp = 1 + Math.max(0, unit(att.identity.aggression)) * 0.3;
  let realized = 1 + (weaponMult - 1) * aggrAmp;

  // 3) Escudo: el defensor aguanta mejor (reduce); el propio da repeek/confianza.
  const defShield = shieldEffect(def.loadout.armor);
  const atkShield = shieldEffect(att.loadout.armor);
  const defFactor = 1 / defShield.survival;
  const atkFactor = 1 + atkShield.repeek * (0.04 + Math.max(0, unit(att.identity.aggression)) * 0.05) + atkShield.confidence * 0.1;

  // 4) Utilidad (abstracta): ejecutar en ataque, retomar en post-plant. El disciplinado
  //    la aprovecha mejor.
  const au = utilityEffect(att.loadout.utility), du = utilityEffect(def.loadout.utility);
  let util = 0;
  if (phase === "EXECUTE") util = au.space + au.execute * 0.5 - du.delay * 0.5;
  else if (phase === "POSTPLANT") util = -du.retake + au.space * 0.3;
  const disc = Math.max(0, unit(att.identity.discipline));
  const utilFactor = 1 + util * (1 + disc * 0.6);

  // 5) Variabilidad creativa (determinista por pareja).
  realized *= 1 + unit(att.identity.creativity) * 0.15 * pairNoise(att.name, def.name);

  return clamp(realized * defFactor * atkFactor * utilFactor, 0.5, 1.8);
}
