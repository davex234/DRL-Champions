/**
 * MANAGER CAREER ENGINE · Fase 2 — negociación (aceptar/renovar/rescindir).
 *
 * Transiciones PURAS de empleo: firmar una oferta, renovar, ser despedido. Actualizan
 * contrato/club/relación-directiva/historial y emiten eventos narrativos. No leen el reloj
 * (reciben `at`). Reusa `joinTeam` del historial (Fase 1). Determinista.
 */
import type { ManagerCareer, Offer, ClubView, CoachContract, CoachCareerEvent } from "./types";
import { createContract } from "./contracts";
import { initBoard } from "./board";
import { initManagement } from "./management";
import { joinTeam } from "./history";

function ev(type: CoachCareerEvent["type"], season: number, magnitude: number, detail: string, at: number): CoachCareerEvent {
  return { type, season, magnitude, detail, at };
}

/** Firma una oferta (nuevo club). Cierra el spell anterior, abre uno nuevo, resetea board. */
export function acceptOffer(career: ManagerCareer, offer: Offer, club: ClubView, at: number): { career: ManagerCareer; events: CoachCareerEvent[] } {
  const contract = createContract(club, offer.terms, career.season);
  const history = joinTeam(career.history, club.name, career.season);
  const wasFirst = career.history.spells.length === 0 || (career.stats.titles === 0 && career.clubId === null && career.history.spells.every((s) => s.toSeason !== null));
  const events: CoachCareerEvent[] = [];
  const historic = offer.prestige >= 75 && contract.salary >= 8000;
  events.push(ev(wasFirst && career.clubId === null && career.stats.matchesPlayed === 0 ? "first_contract" : "contract_signed", career.season,
    historic ? 80 : 55, `${career.coach.name} firma con ${club.name} (${contract.years} temporadas, ${contract.salary}/año).`, at));
  if (historic) events.push(ev("historic_contract", career.season, 88, `Contrato histórico: ${career.coach.name} llega a ${club.name}.`, at));
  events.push(ev("new_project", career.season, 50, `Nuevo proyecto en ${club.name}: ${PHIL[offer.philosophy]}.`, at));

  const next: ManagerCareer = {
    ...career,
    clubId: club.id,
    currentTeam: club.name,
    contract,
    board: initBoard(),
    // Gestión del club: conserva si renueva en el MISMO club; reinicia si cambia de club.
    management: career.management && career.management.clubId === club.id ? career.management : initManagement(club),
    offers: career.offers.map((o) => (o.id === offer.id ? { ...o, status: "accepted" } : { ...o, status: "rejected" })),
    unemployedSeasons: 0,
    stats: { ...career.stats, teamsCoached: career.stats.teamsCoached + (club.name !== career.currentTeam ? 1 : 0) },
    history,
    events: [...career.events, ...events].slice(-400),
  };
  return { career: next, events };
}

/** Renueva con el club actual (mismos club, nuevos términos). */
export function renewContract(career: ManagerCareer, offer: Offer, at: number): { career: ManagerCareer; events: CoachCareerEvent[] } {
  const contract: CoachContract = {
    ...createContract(
      { id: offer.clubId, name: offer.clubName } as ClubView,
      offer.terms,
      career.season,
    ),
  };
  const events = [ev("contract_renewed", career.season, 55, `${career.coach.name} renueva con ${offer.clubName} (${contract.years} temporadas).`, at)];
  const next: ManagerCareer = {
    ...career,
    contract,
    offers: career.offers.map((o) => (o.id === offer.id ? { ...o, status: "accepted" } : o)),
    board: { ...career.board, confidence: Math.min(100, career.board.confidence + 8), pressure: Math.max(0, career.board.pressure - 6) },
    events: [...career.events, ...events].slice(-400),
  };
  return { career: next, events };
}

/** Despido: deja el club, contrato terminado, daño de confianza y a buscar mercado. */
export function dismiss(career: ManagerCareer, reason: string, at: number): { career: ManagerCareer; events: CoachCareerEvent[] } {
  const club = career.currentTeam ?? "el club";
  const events = [ev("dismissed", career.season, 70, `${career.coach.name} es destituido de ${club} (${reason}).`, at)];
  const history = {
    ...career.history,
    spells: career.history.spells.map((s) => (s.toSeason === null ? { ...s, toSeason: career.season } : s)),
  };
  const next: ManagerCareer = {
    ...career,
    clubId: null,
    currentTeam: null,
    contract: career.contract ? { ...career.contract, status: "terminated" } : null,
    board: initBoard(),
    management: null,
    unemployedSeasons: 0,
    history,
    events: [...career.events, ...events].slice(-400),
  };
  return { career: next, events };
}

/** Rechaza una oferta (la marca y registra el evento). */
export function rejectOffer(career: ManagerCareer, offerId: string, at: number): { career: ManagerCareer; events: CoachCareerEvent[] } {
  const offer = career.offers.find((o) => o.id === offerId);
  const events = offer ? [ev("offer_rejected", career.season, 30, `${career.coach.name} rechaza la oferta de ${offer.clubName}.`, at)] : [];
  return {
    career: { ...career, offers: career.offers.map((o) => (o.id === offerId ? { ...o, status: "rejected" } : o)), events: [...career.events, ...events].slice(-400) },
    events,
  };
}

const PHIL: Record<string, string> = {
  develop_youth: "desarrollar jóvenes",
  buy_stars: "fichar estrellas",
  financial_control: "control económico",
  long_project: "proyecto a largo plazo",
  win_now: "ganar ya",
};
