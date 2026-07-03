/**
 * MANAGER CAREER ENGINE · Fase 2 — el FLUJO CONECTADO de una temporada.
 *
 * Compone Fase 1 (stats/reputación/xp/licencia/historial/narrativa) con Fase 2 (contrato,
 * objetivos de directiva, presión/confianza, decisión del club, mercado de ofertas):
 *
 *   resultado → objetivos → board → contrato → decisión del club → ofertas → noticias.
 *
 * Puro y determinista (recibe `rng` y `at`). El store conecta esto con el Living World.
 */
import type { ManagerCareer, ClubView, SeasonOutcome, MatchOutcome, CareerStep, CoachCareerEvent } from "./types";
import type { Rng } from "./rng";
import { applyMatchResult, applySeasonResult } from "./progress";
import { boardAfterMatch, boardAfterSeason, evaluateBoardObjectives } from "./board";
import { tickContract, yearsLeft } from "./contracts";
import { clubSeasonDecision } from "./clubAI";
import { dismiss } from "./negotiate";
import { generateOffers } from "./offers";
import { careerNews } from "./news";

function ev(type: CoachCareerEvent["type"], season: number, magnitude: number, detail: string, at: number): CoachCareerEvent {
  return { type, season, magnitude, detail, at };
}

/** Un partido: Fase 1 (stats/rep/xp) + actualización de la relación con el entorno. */
export function applyMatchToCareer(prev: ManagerCareer, o: MatchOutcome, at: number): CareerStep {
  const step = applyMatchResult(prev, o, at);
  const board = boardAfterMatch(step.career.board, o);
  const extra: CoachCareerEvent[] = [];
  if (board.pressure >= 85 && step.career.board.pressure < 85) {
    extra.push(ev("max_pressure", step.career.season, 75, `La presión sobre ${prev.coach.name} alcanza el límite.`, at));
  }
  const events = [...step.events, ...extra];
  const career = { ...step.career, board, events: [...step.career.events, ...extra].slice(-400) };
  return { career, events, news: [...step.news, ...careerNews(extra)] };
}

/**
 * Una temporada completa para el club del usuario. `clubs` = mercado (para ofertas).
 * Determinista. Devuelve nuevo estado + eventos + noticias.
 */
export function runCareerSeason(prev: ManagerCareer, club: ClubView, clubs: ClubView[], o: SeasonOutcome, rng: Rng, at: number): CareerStep {
  const playedSeason = prev.season;

  // 1) Objetivos del contrato evaluados contra el resultado.
  const contractObjectives = prev.contract?.objectives ?? [];
  const evaluated = evaluateBoardObjectives(contractObjectives, o, club);
  const failedMandatory = evaluated.filter((x) => x.mandatory && x.status === "failed").length;

  // 2) Relación con el entorno tras la temporada.
  const board = boardAfterSeason(prev.board, evaluated, o, club);

  // 3) Decisión del club (sobre un estado con el board ya actualizado).
  const careerForDecision: ManagerCareer = { ...prev, board };
  const decision = clubSeasonDecision(careerForDecision, club, failedMandatory, o, rng);

  // 4) Aplica el resultado deportivo (Fase 1): stats/reputación/xp/licencia/historial + season++.
  const base = applySeasonResult(prev, o, at);
  let career: ManagerCareer = {
    ...base.career,
    board,
    contract: prev.contract ? { ...tickContract(prev.contract, playedSeason), objectives: evaluated } : null,
  };
  const events: CoachCareerEvent[] = [...base.events];

  // 5) Eventos de objetivos/presión.
  if (failedMandatory > 0 && decision.kind !== "fire") {
    events.push(ev("objectives_failed", playedSeason, 60, `${prev.coach.name} no cumple ${failedMandatory} objetivo(s) obligatorio(s) de ${club.name}.`, at));
  }

  // 6) Aplica la decisión del club.
  if (decision.kind === "fire") {
    const d = dismiss(career, decision.reason, at);
    career = d.career;
    events.push(...d.events);
  } else if (decision.kind === "renew") {
    // La renovación es una OFERTA que el usuario decide aceptar (no automática).
    career = { ...career, offers: [decision.offer, ...career.offers.filter((x) => x.status === "pending")].slice(0, 6) };
    events.push(ev("offer_received", career.season, 45, `${club.name} ofrece renovación a ${prev.coach.name}.`, at));
  } else if (decision.kind === "warn") {
    events.push(ev("max_pressure", playedSeason, 65, `${club.name}: ${decision.reason}.`, at));
  }

  // 7) Mercado: si está libre, o el contrato expira/expira pronto, llegan ofertas.
  const contractEnding = !career.clubId || (career.contract ? yearsLeft(career.contract, career.season) <= 1 || career.contract.status !== "active" : true);
  if (contractEnding) {
    const offers = generateOffers(career, clubs, career.season);
    const fresh = offers.filter((of) => !career.offers.some((e) => e.clubId === of.clubId && e.status === "pending"));
    if (fresh.length) {
      career = { ...career, offers: [...fresh, ...career.offers.filter((x) => x.status === "pending")].slice(0, 6) };
      events.push(ev("offer_received", career.season, 40, `${prev.coach.name} recibe ${fresh.length} oferta(s) del mercado.`, at));
    }
  }

  career = { ...career, events: [...career.events, ...events.filter((e) => !base.events.includes(e))].slice(-400) };
  return { career, events, news: careerNews(events) };
}

/** Temporada en PARO: sin club, solo llegan (o no) ofertas. Determinista. */
export function runUnemployedSeason(prev: ManagerCareer, clubs: ClubView[], at: number): CareerStep {
  const offers = generateOffers(prev, clubs, prev.season + 1);
  const events: CoachCareerEvent[] = [];
  if (offers.length) events.push(ev("offer_received", prev.season + 1, 40, `${prev.coach.name} recibe ${offers.length} oferta(s) estando libre.`, at));
  const career: ManagerCareer = {
    ...prev,
    season: prev.season + 1,
    unemployedSeasons: prev.unemployedSeasons + 1,
    stats: { ...prev.stats, seasonsCoached: prev.stats.seasonsCoached },
    offers: [...offers, ...prev.offers.filter((x) => x.status === "pending")].slice(0, 6),
    events: [...prev.events, ...events].slice(-400),
  };
  return { career, events, news: careerNews(events) };
}
