/**
 * MANAGER CAREER ENGINE · Fase 3 — driver de gestión integral del club.
 *
 * Compone economía + academia + instalaciones + staff + patrocinadores en UNA transición de
 * temporada (el FLUJO de gestión). Devuelve el nuevo estado de gestión + deltas para el club
 * del mundo (presupuesto/prestigio/fanbase) + eventos + noticias. Determinista. Puro.
 */
import type { ClubView, ClubManagement, SeasonOutcome, CoachCareerEvent, ManagerCareer } from "./types";
import type { Rng } from "./rng";
import { initFacilities, facilityEffects } from "./facilities";
import { computeSeasonFinances } from "./clubEconomy";
import { generateAcademyIntake, generateAcademyStaff } from "./academy";
import { sponsorSatisfaction } from "./sponsors";
import { computePrestige, computeFanbase, type OrgEvent } from "./organization";
import { careerNews } from "./news";

function ev(type: CoachCareerEvent["type"], season: number, magnitude: number, detail: string, at: number): CoachCareerEvent {
  return { type, season, magnitude, detail, at };
}

/** Estado de gestión inicial al ligarse a un club (instalaciones nivel 1, saldo = presupuesto). */
export function initManagement(club: ClubView): ClubManagement {
  return {
    clubId: club.id,
    facilities: initFacilities(),
    staff: [],
    sponsors: [],
    academy: [],
    scouting: [],
    ledger: [],
    balance: club.budget,
    academyStaff: [],
    fanbaseMood: 50,
  };
}

export interface ManagementStep {
  management: ClubManagement;
  /** Deltas para aplicar al WorldTeam (lo hace el store). */
  clubDeltas: { budget: number; prestige: number; fanbase: number };
  events: CoachCareerEvent[];
  news: ReturnType<typeof careerNews>;
  /** Eventos de organización (Fase 5) → orgNews en el store. */
  orgEvents: OrgEvent[];
}

/**
 * Cierra la temporada de GESTIÓN: balance económico, hornada de cantera, evolución de
 * prestigio/fanbase por instalaciones. `extra` = sueldos/ventas/compras reales del roster.
 */
export function runManagementSeason(
  career: ManagerCareer,
  club: ClubView,
  mgmt: ClubManagement,
  outcome: SeasonOutcome,
  extra: { playerWages: number; sales: number; purchases: number },
  season: number,
  rng: Rng,
  at: number,
): ManagementStep {
  const ledger = computeSeasonFinances(club, mgmt, outcome, extra);
  const balance = ledger.balanceEnd;
  const transferActivity = Math.max(0, extra.sales) + Math.max(0, extra.purchases);
  const bigSignings = extra.purchases > 15000 ? 1 : 0;

  // Hornada de cantera (jugadores + cuerpo técnico) de la nueva temporada.
  const intake = generateAcademyIntake(mgmt, club.region, season + 1, rng);
  const staffIntake = generateAcademyStaff(mgmt, season + 1, rng);

  // Satisfacción de los patrocinadores según SU personalidad (resultados/fans/cantera/contenido).
  const fx = facilityEffects(mgmt.facilities);
  const sponsors = mgmt.sponsors.map((s) => ({
    ...s,
    satisfaction: sponsorSatisfaction(s, { position: outcome.placement, totalTeams: outcome.fieldSize ?? club.totalTeams, champion: outcome.champion, fanbase: club.fanbase, academyCount: mgmt.academy.length, contentReach: fx.contentReach }),
  }));

  // PRESTIGIO multi-fuente y FANBASE viva (Fase 5).
  const prestigeBd = computePrestige({ club, mgmt: { ...mgmt, sponsors }, champion: outcome.champion, legends: Math.floor(club.titles / 3), transferActivity });
  const expectation = Math.max(1, Math.min(club.totalTeams, Math.round((1 - club.prestige / 100) * club.totalTeams)));
  const fan = computeFanbase({ club, mgmt: { ...mgmt, sponsors }, champion: outcome.champion, expectation, bigSignings });

  const management: ClubManagement = {
    ...mgmt,
    balance,
    sponsors,
    academy: [...mgmt.academy, ...intake].slice(-24),
    academyStaff: [...(mgmt.academyStaff ?? []), ...staffIntake].slice(-16),
    ledger: [...mgmt.ledger, ledger].slice(-50),
    fanbaseMood: fan.moodScore,
  };

  const events: CoachCareerEvent[] = [];
  const orgEvents: OrgEvent[] = [];
  if (balance < 0) events.push(ev("financial_trouble", season, 70, `${club.name} cierra la temporada en NÚMEROS ROJOS (${balance}).`, at));
  else if (ledger.net > 15000) events.push(ev("investment", season, 45, `${club.name} cierra con superávit de ${ledger.net}.`, at));
  const wonder = intake.find((p) => p.potential >= 90);
  if (wonder) events.push(ev("prospect_scouted", season + 1, 60, `La academia de ${club.name} produce una joya: ${wonder.name} (potencial ${wonder.potential}).`, at));
  if (staffIntake.length) orgEvents.push({ id: `org:${season}:staff_signed:${club.id}`, type: "staff_signed", season: season + 1, at, clubId: club.id, clubName: club.name, detail: `La academia de ${club.name} forma nuevo cuerpo técnico (${staffIntake.map((s) => s.name).join(", ")}).`, magnitude: 40 });
  if (fan.mood === "eufórica") orgEvents.push({ id: `org:${season}:fan_record:${club.id}`, type: "fan_record", season, at, clubId: club.id, clubName: club.name, detail: `${club.name}: ${fan.message}`, magnitude: 55 });
  if (ledger.net > 30000) orgEvents.push({ id: `org:${season}:income_record:${club.id}`, type: "income_record", season, at, clubId: club.id, clubName: club.name, detail: `${club.name} bate su récord de ingresos (${ledger.net}).`, magnitude: 60 });

  return { management, clubDeltas: { budget: balance, prestige: prestigeBd.total, fanbase: fan.delta }, events, news: careerNews(events), orgEvents };
}
