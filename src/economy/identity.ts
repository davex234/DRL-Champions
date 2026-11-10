/**
 * ECONOMY ENGINE × PLAYER IDENTITY — el temperamento económico EMERGE del ADN.
 *
 * No se hardcodea "este jugador fuerza": se deriva de la identidad (agresividad, ego,
 * apetito de riesgo empujan a comprar/forzar; disciplina y paciencia empujan al eco).
 * Solo LEE la identidad del roster; no modifica el Identity Engine.
 */
import type { RosterEntry } from "@/sim";
import { clamp } from "./rules";

const unit = (t: number): number => (Math.max(0, Math.min(100, t)) - 50) / 50; // -1..1

/**
 * Sesgo de compra del equipo (-1..1). Positivo → tiende a forzar/comprar;
 * negativo → acepta eco/save. Promedio del temperamento de los 5 jugadores.
 */
export function teamBuyBias(roster: RosterEntry[]): number {
  const withId = roster.filter((r) => r.identity);
  if (withId.length === 0) return 0;
  let sum = 0;
  for (const r of withId) {
    const id = r.identity!;
    sum +=
      unit(id.aggression) * 0.35 +
      unit(id.ego) * 0.3 +
      unit(id.riskAppetite) * 0.25 -
      unit(id.discipline) * 0.3 -
      unit(id.patience) * 0.2;
  }
  return clamp(sum / withId.length, -1, 1);
}
