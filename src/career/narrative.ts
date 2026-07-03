/**
 * MANAGER CAREER ENGINE — narrativa de carrera.
 *
 * Detecta HITOS comparando el estado anterior con el nuevo (First Contract, First Victory,
 * First Trophy, Coach Legend, Perfect Season, Mastermind, Historic Career…). Puro y
 * determinista: mismas entradas ⇒ mismos eventos. Sigue el patrón `detect…Events` del resto
 * de motores.
 */
import type { ManagerCareer, CoachCareerEvent, CoachCareerEventType } from "./types";
import { licenseRank, licenseDef } from "./licenses";
import { globalReputationScore } from "./reputation";

function ev(type: CoachCareerEventType, season: number, magnitude: number, detail: string, at: number): CoachCareerEvent {
  return { type, season, magnitude, detail, at };
}

/**
 * Compara `prev` → `next` y emite los hitos cruzados. `at` se inyecta (timestamp/orden) para
 * mantener la pureza: el motor no lee el reloj.
 */
export function detectCareerEvents(prev: ManagerCareer | null, next: ManagerCareer, at: number): CoachCareerEvent[] {
  const out: CoachCareerEvent[] = [];
  const season = next.season;
  const name = next.coach.name;

  // First Contract — nace la carrera (prev null = recién creada).
  if (!prev) {
    out.push(ev("first_contract", season, 60, `${name} firma su primer contrato con ${next.currentTeam ?? "un equipo"}.`, at));
    return out;
  }

  // First Victory / First Trophy.
  if (prev.stats.wins === 0 && next.stats.wins > 0) {
    out.push(ev("first_victory", season, 45, `${name} logra su primera victoria como entrenador.`, at));
  }
  if (prev.stats.titles === 0 && next.stats.titles > 0) {
    out.push(ev("first_trophy", season, 80, `${name} levanta su primer título.`, at));
  }

  // Level up.
  if (next.level > prev.level) {
    out.push(ev("level_up", season, 25, `${name} alcanza el nivel ${next.level}.`, at));
  }

  // License unlocked.
  if (licenseRank(next.license) > licenseRank(prev.license)) {
    const def = licenseDef(next.license);
    const legend = next.license === "legend";
    out.push(ev("license_unlocked", season, legend ? 95 : 55, `${name} obtiene la ${def.name}.`, at));
    if (legend) out.push(ev("coach_legend", season, 100, `${name} entra en la leyenda: licencia Legend.`, at));
  }

  // Perfect season.
  if (next.perfectSeasons > prev.perfectSeasons) {
    out.push(ev("perfect_season", season, 90, `${name} completa una TEMPORADA PERFECTA.`, at));
  }

  // Mastermind — reputación global cruza 80.
  const repPrev = globalReputationScore(prev.reputation);
  const repNext = globalReputationScore(next.reputation);
  if (repPrev < 80 && repNext >= 80) {
    out.push(ev("mastermind", season, 88, `${name} es reconocido como un MAESTRO TÁCTICO mundial.`, at));
  }

  // Career milestones — múltiplos de títulos.
  for (const m of [3, 5, 10, 20]) {
    if (prev.stats.titles < m && next.stats.titles >= m) {
      const type: CoachCareerEventType = m >= 20 ? "historic_career" : m >= 10 ? "historic_coach" : "career_milestone";
      out.push(ev(type, season, Math.min(100, 50 + m * 2), `${name} alcanza los ${m} títulos.`, at));
    }
  }

  // Golden coach — dinastía + reputación legendaria.
  if (
    (prev.stats.titles < 15 || globalReputationScore(prev.reputation) < 90) &&
    next.stats.titles >= 15 &&
    repNext >= 90
  ) {
    out.push(ev("golden_coach", season, 100, `${name} es coronado GOLDEN COACH de una era.`, at));
  }

  return out;
}
