/**
 * MANAGER CAREER ENGINE · Fase 2 — contratos de entrenador.
 *
 * Salario/bonus/cláusulas/objetivos/duración. Las cifras NO son aleatorias: dependen del
 * prestigio y presupuesto del club, y de la reputación/licencia/palmarés del entrenador.
 * Determinista (Rng sembrado). Puro.
 */
import type { ClubView, CoachContract, ContractBonuses, OfferTerms, ManagerCareer } from "./types";
import type { Rng } from "./rng";
import { boardObjectivesFor } from "./club";
import { globalReputationScore } from "./reputation";
import { licenseRank } from "./licenses";
import { attrOverall } from "./attributes";

/** Rating global del entrenador (0..100): atributos + reputación + licencia + palmarés. */
export function coachRating(career: ManagerCareer): number {
  const rep = globalReputationScore(career.reputation);
  const lic = licenseRank(career.license) * 4;
  const titles = Math.min(18, career.stats.titles);
  return Math.max(0, Math.min(100, Math.round(attrOverall(career.attributes) * 0.45 + rep * 0.35 + lic + titles)));
}

/** Factor de caché del entrenador (0.4..~2.2) según reputación, licencia y títulos. */
export function coachWageFactor(career: ManagerCareer): number {
  const rep = globalReputationScore(career.reputation) / 100; // 0..1
  const lic = licenseRank(career.license) / 5;                 // 0..1
  const titles = Math.min(1, career.stats.titles / 20);        // 0..1
  return 0.4 + rep * 1.0 + lic * 0.5 + titles * 0.3;
}

/** Términos que un club ofrece a un entrenador (deterministas). */
export function termsFor(club: ClubView, career: ManagerCareer, rng: Rng): OfferTerms {
  const factor = coachWageFactor(career);
  // Base salarial ligada al presupuesto y prestigio del club.
  const base = Math.round((club.budget * 0.04 + club.prestige * 120) * factor);
  const salary = Math.max(500, base + rng.int(-200, 200));
  const years = 1 + (club.philosophy === "long_project" ? 2 : club.philosophy === "win_now" ? 0 : 1) + rng.int(0, 1);
  const bonuses: ContractBonuses = {
    win: Math.round(salary * 0.01) + 20,
    playoffs: Math.round(salary * 0.15),
    major: Math.round(salary * 0.4),
    worlds: Math.round(salary * 0.9),
    qualification: Math.round(salary * 0.2),
    perTitle: Math.round(salary * 0.5),
  };
  const releaseClause = Math.round(salary * (3 + club.prestige / 25));
  const exitClause = Math.round(salary * (1 + (5 - licenseRank(career.license)) * 0.3));
  return { years, salary, bonuses, releaseClause, exitClause, objectives: boardObjectivesFor(club) };
}

/** Crea un contrato a partir de unos términos aceptados. */
export function createContract(club: ClubView, terms: OfferTerms, season: number): CoachContract {
  return {
    clubId: club.id,
    clubName: club.name,
    role: "Head Coach",
    startSeason: season,
    endSeason: season + terms.years,
    years: terms.years,
    salary: terms.salary,
    bonuses: terms.bonuses,
    releaseClause: terms.releaseClause,
    exitClause: terms.exitClause,
    objectives: terms.objectives.map((o) => ({ ...o, status: "pending" })),
    status: "active",
    signedSeason: season,
  };
}

/** Avanza el contrato una temporada (consume un año). No decide el despido (eso es clubAI). */
export function tickContract(contract: CoachContract, season: number): CoachContract {
  const yearsLeft = contract.endSeason - (season + 1);
  return {
    ...contract,
    status: yearsLeft <= 0 ? "expired" : contract.status,
  };
}

/** Años restantes de contrato a una temporada dada. */
export function yearsLeft(contract: CoachContract, season: number): number {
  return Math.max(0, contract.endSeason - season);
}
