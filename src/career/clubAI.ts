/**
 * MANAGER CAREER ENGINE · Fase 2 — IA de clubes.
 *
 * Al cerrar la temporada, el club DECIDE solo sobre su entrenador: mantener, renovar,
 * despedir o avisar. Determinista (Rng sembrado). Reusa `dismissalRisk` (todos los factores)
 * y `termsFor` (renovación coherente). Puro.
 */
import type { ClubView, ClubDecision, ManagerCareer, SeasonOutcome, Offer } from "./types";
import type { Rng } from "./rng";
import { dismissalRisk } from "./board";
import { termsFor, yearsLeft } from "./contracts";
import { offerAppeal } from "./offers";
import { ns } from "@/i18n/runtime";

const t = ns("career");

/**
 * Decisión del club sobre el entrenador del usuario tras la temporada.
 * @param failedMandatory nº de objetivos obligatorios incumplidos.
 */
export function clubSeasonDecision(
  career: ManagerCareer,
  club: ClubView,
  failedMandatory: number,
  o: SeasonOutcome,
  rng: Rng,
): ClubDecision {
  const risk = dismissalRisk(career, club, failedMandatory, o);

  // 1) Despido (nunca aleatorio: probabilidad = riesgo calculado).
  if (risk >= 0.55 && rng.chance(risk)) {
    const reason = failedMandatory > 0 ? t("objetivos incumplidos") : career.board.pressure > 75 ? t("presión insostenible") : t("malos resultados");
    return { kind: "fire", reason };
  }

  // 2) Renovación si el contrato expira o está a punto y el rendimiento convence.
  const left = career.contract ? yearsLeft(career.contract, career.season) : 0;
  const happy = career.board.confidence >= 58 && failedMandatory === 0;
  if (left <= 1 && happy) {
    const terms = termsFor(club, career, rng);
    const offer: Offer = {
      id: `renew:${club.id}:${career.season}`,
      clubId: club.id,
      clubName: club.name,
      region: club.region,
      season: career.season,
      prestige: Math.round(club.prestige),
      philosophy: club.philosophy,
      terms,
      appeal: offerAppeal(club, terms, career),
      status: "pending",
    };
    return { kind: "renew", offer };
  }

  // 3) Aviso si la presión es alta pero aún no despiden.
  if (risk >= 0.4) return { kind: "warn", reason: t("la directiva exige resultados") };

  return { kind: "keep" };
}
