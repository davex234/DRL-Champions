/**
 * MANAGER CAREER ENGINE · Fase 3 — scouting.
 *
 * Los ojeadores DESCUBREN jugadores (no aparecen por arte de magia): leen talento, potencial,
 * coste, riesgo, compatibilidad y química. REUTILIZA `scoutPlayer` y `playerValue`. La calidad
 * del descubrimiento escala con la instalación de Scouting y el staff scout. Determinista. Puro.
 */
import type { WorldPlayer } from "@/world";
import { scoutPlayer, progress, ageBand } from "@/development";
import { playerValue } from "@/world";
import type { ClubManagement, ScoutTarget, ManagerCareer } from "./types";
import { facilityEffects } from "./facilities";
import { staffEffects } from "./staff";
import type { Rng } from "./rng";

/** Jugador "ojeable" (desacoplado del WorldPlayer para no exigir el mundo entero). */
export interface ScoutPoolEntry extends WorldPlayer {}

const clamp100 = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

/**
 * Ejecuta una campaña de ojeo sobre un `pool` (agentes libres del mundo). Devuelve los mejores
 * descubrimientos. Mejor instalación/staff ⇒ más y mejores objetivos, con menos incertidumbre.
 */
export function runScouting(mgmt: ClubManagement, career: ManagerCareer, pool: ScoutPoolEntry[], rng: Rng): ScoutTarget[] {
  const fx = facilityEffects(mgmt.facilities);
  const sx = staffEffects(mgmt.staff);
  const power = Math.min(1, fx.scoutBonus * 0.7 + sx.scoutBoost); // 0..1
  const found = Math.max(1, Math.round(2 + power * 6)); // 2..8 objetivos

  // El ojeo prioriza valor/potencial; la "vista" del scout añade ruido inverso a su nivel.
  const scored = pool.map((p) => {
    const noise = (rng.next() - 0.5) * (1 - power) * 30;
    return { p, score: p.value + p.innate.potential * 30 + noise };
  }).sort((a, b) => b.score - a.score).slice(0, found);

  return scored.map(({ p }) => {
    const report = scoutPlayer(p.innate, p.dev);
    const band = ageBand(p.dev.age, p.innate);
    const rating = Math.round(progress(p.dev));
    const value = playerValue(p);
    // Riesgo: menos seguro cuanto peor el scouting (potencial incierto, burnout, edad).
    const risk = clamp100((1 - power) * 40 + p.dev.condition.burnout * 0.4 + (band === "declive" ? 25 : 0));
    // Compatibilidad con el estilo del coach (vía Identity) y química con la plantilla.
    const compatibility = clamp100(50 + (career.coach.identity.tacticalIQ - 50) * 0.3 + (p.innate.workEthic - 50) * 0.4);
    const chemistry = clamp100(50 + (p.dev.condition.morale - 50) * 0.3 + rng.int(-10, 10));
    const cost = Math.round(value * (0.2 + p.innate.potential / 400));
    return { id: p.id, name: p.nick, region: p.region, role: p.role, rating, potential: p.innate.potential, value, cost, risk, compatibility, chemistry, report };
  });
}
