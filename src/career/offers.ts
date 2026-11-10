/**
 * MANAGER CAREER ENGINE · Fase 2 — mercado de ofertas.
 *
 * Genera ofertas de los clubes al entrenador. NUNCA aleatorias: dependen del interés del
 * club (vacante/mejora + reputación + capacidad económica + proximidad de prestigio) y del
 * atractivo de la oferta para el entrenador. Determinista (Rng sembrado). Puro.
 */
import type { ClubView, Offer, ManagerCareer, OfferTerms } from "./types";
import type { Rng } from "./rng";
import { makeRng, seedOf } from "./rng";
import { termsFor, coachRating } from "./contracts";
import { globalReputationScore } from "./reputation";

/** ¿Cuánto le interesa este club al entrenador? 0..100. */
export function offerAppeal(club: ClubView, terms: OfferTerms, career: ManagerCareer): number {
  const prestige = club.prestige * 0.4;
  const sportProject = (club.philosophy === "win_now" || club.philosophy === "buy_stars" ? 14 : 6);
  const salaryPull = career.contract ? Math.max(-12, Math.min(20, ((terms.salary - career.contract.salary) / Math.max(1, career.contract.salary)) * 40)) : 16;
  const fans = Math.min(12, club.fanbase / 100);
  const home = club.region === career.coach.region ? 6 : 0;
  return Math.max(0, Math.min(100, Math.round(prestige + sportProject + salaryPull + fans + home + 10)));
}

/** Interés del club por el entrenador (0..1). Necesidad × reputación × encaje de prestigio. */
function clubInterest(club: ClubView, career: ManagerCareer, rating: number): number {
  const rep = globalReputationScore(career.reputation);
  // Necesidad: vacante = máxima; con coach, solo si el nuestro es claramente mejor.
  const need = club.hasCoach ? Math.max(0, (rating - club.coachRating - 6) / 40) : 0.7;
  // Encaje de prestigio: el club busca un nivel parecido al suyo (±). Penaliza desajustes grandes.
  const fit = 1 - Math.min(1, Math.abs(club.prestige - rating) / 60);
  // Reputación mínima por prestigio (un club top no llama a un desconocido).
  const reputable = rep >= club.prestige * 0.5 ? 1 : 0.25;
  return Math.max(0, Math.min(1, need * 0.5 + fit * 0.35 + 0.15) * reputable);
}

/**
 * Genera las ofertas activas para el entrenador en una temporada. Solo clubes interesados
 * Y capaces de pagar. Determinista. `max` limita el nº de ofertas (orden por atractivo).
 */
export function generateOffers(career: ManagerCareer, clubs: ClubView[], season: number, max = 4): Offer[] {
  const rating = coachRating(career);
  const offers: Offer[] = [];
  for (const club of clubs) {
    if (club.id === career.clubId) continue; // su propio club no le "ficha"
    const rng: Rng = makeRng(seedOf(career.seed, "offer", club.id, season));
    const interest = clubInterest(club, career, rating);
    if (interest < 0.45) continue;
    if (!rng.chance(interest)) continue;
    const terms = termsFor(club, career, rng);
    if (terms.salary > club.budget * 0.25 + club.prestige * 200) continue; // no puede pagarlo
    offers.push({
      id: `offer:${club.id}:${season}`,
      clubId: club.id,
      clubName: club.name,
      region: club.region,
      season,
      prestige: Math.round(club.prestige),
      philosophy: club.philosophy,
      terms,
      appeal: offerAppeal(club, terms, career),
      status: "pending",
    });
  }
  return offers.sort((a, b) => b.appeal - a.appeal).slice(0, max);
}
