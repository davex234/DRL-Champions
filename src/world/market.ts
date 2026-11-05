/**
 * MERCADO — el VALOR de cada jugador (vivo). Reutiliza el desarrollo (progress) + edad +
 * potencial + forma + palmarés. El valor cambia con las actuaciones, los torneos y las
 * "lesiones mentales" (burnout/forma baja). Distinto del marketplace de cartas (que vende
 * instancias); aquí es el valor de TRASPASO del jugador. PURO.
 */
import type { WorldPlayer, WorldState } from "./types";
import { progress, ageBand } from "@/development";

/** Valor de mercado (créditos) de un jugador a partir de su estado de desarrollo. */
export function playerValue(p: WorldPlayer): number {
  const r = progress(p.dev); // 0..100
  const band = ageBand(p.dev.age, p.innate);
  const ageMult = band === "joven" ? 1.15 : band === "prime" ? 1.25 : band === "veterano" ? 0.8 : 0.45;
  const potMult = 1 + (p.innate.potential - 60) / 180;       // el potencial cotiza
  const formMult = 0.85 + p.dev.condition.form / 300;
  const mentalMult = 1 - p.dev.condition.burnout / 250;       // "lesión mental" baja el valor
  const ach = 1 + p.titles * 0.08 + p.mvps * 0.12;
  const base = r * r * 0.55;                                  // curva convexa: la élite vale mucho más
  return Math.max(40, Math.round(base * ageMult * potMult * formMult * mentalMult * ach));
}

/** Recalcula el valor de todos los jugadores (guardando el de la temporada anterior). */
export function recomputeValues(world: WorldState): void {
  for (const p of Object.values(world.players)) {
    if (p.status !== "active") { p.prevValue = p.value; p.value = Math.round(p.value * 0.6); continue; }
    p.prevValue = p.value;
    p.value = playerValue(p);
  }
}
