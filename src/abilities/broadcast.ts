/**
 * AGENT ABILITY ENGINE × BROADCAST — DATOS de habilidades en vivo (no UI): usadas/restantes,
 * timeline, combos (sinergia), valor generado, espacio/info/control conseguidos. PURO; lee el
 * mapa vivo (Utility Engine) + el log de casts.
 */
import type { RoundState, Side } from "../sim";

export interface AbilityCastLine {
  tick: number; by: string; side: Side; ability: string; effect: string; zone: string | null; value: number;
}
export interface SideAbilityBroadcast {
  side: Side;
  used: number;
  remaining: number;
  /** Valor táctico generado (suma de los casts). */
  value: number;
  /** Zonas controladas (espacio) / reveladas (info). */
  space: number;
  info: number;
  /** ¿Combo de utilidad en curso (≥2 casts del mismo equipo en ventana corta)? */
  combo: boolean;
  timeline: AbilityCastLine[];
}
export interface AbilityBroadcast {
  tick: number;
  sides: Record<Side, SideAbilityBroadcast>;
}

const COMBO_WINDOW = 20; // ticks (~1 s)

function sideData(s: RoundState, side: Side): SideAbilityBroadcast {
  const map = s.map;
  const casts: AbilityCastLine[] = [];
  for (const e of s.events) {
    if (e.type !== "util") continue;
    const d = e.data as { side?: Side; by?: string; ability?: string; abilityEffect?: string; zone?: string | null; value?: number };
    if (d.side !== side || !d.ability) continue;
    casts.push({ tick: e.tick, by: String(d.by), side, ability: String(d.ability), effect: String(d.abilityEffect ?? ""), zone: d.zone ?? null, value: Number(d.value ?? 0.5) });
  }
  // Combo: dos casts del equipo en ventana corta cerca del tick actual.
  let combo = false;
  for (let i = 1; i < casts.length; i++) if (casts[i].tick - casts[i - 1].tick <= COMBO_WINDOW && s.tick - casts[i].tick < 3 * COMBO_WINDOW) combo = true;
  // Espacio / info desde el mapa vivo.
  let space = map?.control[side] ?? 0;
  let info = 0;
  if (map) for (const z of Object.values(map.zones)) if (z.status.includes("revealed") && (side === "ATK" ? z.info.ATK : z.info.DEF) > 0.6) info++;
  return {
    side,
    used: map?.spent[side] ?? casts.length,
    remaining: Math.max(0, (map?.charges[side] ?? 0) - (map?.spent[side] ?? 0)),
    value: Math.round(casts.reduce((a, c) => a + c.value, 0) * 100) / 100,
    space, info, combo, timeline: casts,
  };
}

/** Datos de broadcast de habilidades del estado actual. */
export function abilityBroadcast(s: RoundState): AbilityBroadcast {
  return { tick: s.tick, sides: { ATK: sideData(s, "ATK"), DEF: sideData(s, "DEF") } };
}
