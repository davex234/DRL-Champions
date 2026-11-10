/**
 * MANAGER CAREER ENGINE — noticias de carrera.
 *
 * Mapea eventos de carrera → NewsItem (mismo tipo que el feed global). Ids DETERMINISTAS
 * para deduplicar. El store los empuja al ÚNICO buzón `useNewsStore`; no se crea otro feed.
 * Patrón calcado de `@/world` `worldNews`.
 */
import type { NewsItem, NewsKind } from "@/intel";
import type { CoachCareerEvent, CoachCareerEventType } from "./types";

const KIND: Record<CoachCareerEventType, NewsKind> = {
  first_contract: "event",
  first_victory: "record",
  first_trophy: "special",
  career_milestone: "record",
  perfect_season: "special",
  mastermind: "special",
  historic_career: "special",
  coach_legend: "special",
  historic_coach: "special",
  golden_coach: "special",
  license_unlocked: "event",
  level_up: "event",
  objective_achieved: "record",
  // Fase 2
  contract_signed: "transfer",
  contract_renewed: "transfer",
  dismissed: "transfer",
  offer_received: "event",
  offer_accepted: "transfer",
  offer_rejected: "event",
  historic_contract: "special",
  new_project: "event",
  philosophy_change: "event",
  max_pressure: "event",
  objectives_failed: "record",
  // Fase 3
  sponsor_signed: "event",
  facility_upgraded: "event",
  rookie_promoted: "transfer",
  prospect_scouted: "special",
  record_sale: "transfer",
  staff_hired: "event",
  financial_trouble: "record",
  investment: "event",
};

const TITLE: Record<CoachCareerEventType, string> = {
  first_contract: "Nuevo entrenador en escena",
  first_victory: "Primera victoria",
  first_trophy: "¡Primer título!",
  career_milestone: "Hito de carrera",
  perfect_season: "Temporada perfecta",
  mastermind: "Maestro táctico",
  historic_career: "Carrera histórica",
  coach_legend: "Leyenda del banquillo",
  historic_coach: "Entrenador histórico",
  golden_coach: "Golden Coach",
  license_unlocked: "Nueva licencia",
  level_up: "Sube de nivel",
  objective_achieved: "Objetivo cumplido",
  // Fase 2
  contract_signed: "Nuevo fichaje",
  contract_renewed: "Renovación",
  dismissed: "Destitución",
  offer_received: "Oferta recibida",
  offer_accepted: "Oferta aceptada",
  offer_rejected: "Oferta rechazada",
  historic_contract: "Contrato histórico",
  new_project: "Nuevo proyecto",
  philosophy_change: "Cambio de filosofía",
  max_pressure: "Presión máxima",
  objectives_failed: "Objetivos incumplidos",
  // Fase 3
  sponsor_signed: "Nuevo patrocinador",
  facility_upgraded: "Mejora de instalaciones",
  rookie_promoted: "Rookie promovido",
  prospect_scouted: "Joya de la academia",
  record_sale: "Venta histórica",
  staff_hired: "Refuerzo en el staff",
  financial_trouble: "Apuros económicos",
  investment: "Superávit del club",
};

export function careerNews(events: CoachCareerEvent[]): NewsItem[] {
  return events.map((e) => ({
    id: `career:${e.season}:${e.type}:${e.at}`,
    at: e.at,
    kind: KIND[e.type],
    title: TITLE[e.type],
    body: e.detail,
    tags: ["carrera", e.type],
  }));
}
