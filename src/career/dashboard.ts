/**
 * MANAGER CAREER ENGINE · Fase 2 — dashboard profesional.
 *
 * Prepara los datos del PANEL del entrenador: estado de contrato, objetivos, confianza,
 * presión, reputación, ranking, ofertas y expectativas. Patrón "el motor prepara, la UI
 * pinta" (como `worldBroadcast`). Puro.
 */
import type { ManagerCareer, ClubView, CoachContract, BoardRelation, ClubObjective, Offer, ClubManagement, SeasonLedger, FacilityId, Sponsor, StaffMember, AcademyProspect, StaffProspect, FacilityEffects, StaffEffects } from "./types";
import { globalReputationScore, reputationTier } from "./reputation";
import { expectedPosition } from "./club";
import { dismissalRisk, evaluateBoardObjectives } from "./board";
import { yearsLeft, coachRating } from "./contracts";
import { ledgerTotals } from "./clubEconomy";
import { facilityEffects } from "./facilities";
import { staffEffects } from "./staff";
import { computePrestige, clubValue, prestigeTier, ORG_POSITIONS, type PrestigeBreakdown, type ClubValue, type FanbaseMood } from "./organization";

export interface CoachDashboard {
  employed: boolean;
  clubName: string | null;
  contract: {
    role: string;
    yearsLeft: number;
    endSeason: number;
    salary: number;
    releaseClause: number;
    status: CoachContract["status"];
  } | null;
  objectives: ClubObjective[];
  board: BoardRelation;
  /** Riesgo de despido 0..100 (para la barra de "estado del puesto"). */
  jobSecurity: number;
  reputationScore: number;
  reputationTier: string;
  coachRating: number;
  /** Posición que espera el club (1 = campeón). */
  expectation: number | null;
  unemployedSeasons: number;
  pendingOffers: Offer[];
}

export function careerDashboard(career: ManagerCareer, club?: ClubView | null): CoachDashboard {
  const c = career.contract;
  const objectives = c?.objectives ?? [];
  // Riesgo "en vivo" estimado contra la expectativa del club (si lo conocemos).
  let risk = career.board.pressure / 100;
  if (club && c) {
    const synthetic = { team: club.name, competition: "Liga DRL", tier: "regional" as const, wins: 0, losses: 0, champion: false, finalist: false, mvpAwarded: false, placement: club.position, fieldSize: club.totalTeams };
    const evald = evaluateBoardObjectives(objectives, synthetic, club);
    const failed = evald.filter((o) => o.mandatory && o.status === "failed").length;
    risk = dismissalRisk(career, club, failed, synthetic);
  }
  return {
    employed: career.clubId != null,
    clubName: career.currentTeam,
    contract: c ? {
      role: c.role,
      yearsLeft: yearsLeft(c, career.season),
      endSeason: c.endSeason,
      salary: c.salary,
      releaseClause: c.releaseClause,
      status: c.status,
    } : null,
    objectives,
    board: career.board,
    jobSecurity: Math.round(risk * 100),
    reputationScore: globalReputationScore(career.reputation),
    reputationTier: reputationTier(career.reputation).label,
    coachRating: coachRating(career),
    expectation: club ? expectedPosition(club) : null,
    unemployedSeasons: career.unemployedSeasons,
    pendingOffers: career.offers.filter((o) => o.status === "pending"),
  };
}

// ── Fase 3: dashboard de GESTIÓN del club ──

export interface ClubManagementDashboard {
  balance: number;
  lastSeasonIncome: number;
  lastSeasonExpense: number;
  lastSeasonNet: number;
  lastLedger: SeasonLedger | null;
  squadValue: number;
  academyValue: number;
  academyCount: number;
  facilities: { id: FacilityId; level: number }[];
  staff: StaffMember[];
  sponsors: Sponsor[];
  sponsorIncome: number;
  topProspects: AcademyProspect[];
  scoutTargets: number;
  fanbase: number;
  prestige: number;
  /** Salud financiera: -100 (quiebra) .. 100 (boyante). */
  financialHealth: number;
  effects: ReturnType<typeof facilityEffects>;
}

export function clubDashboard(mgmt: ClubManagement, club: ClubView | null, squadValue: number): ClubManagementDashboard {
  const last = mgmt.ledger[mgmt.ledger.length - 1] ?? null;
  const totals = last ? ledgerTotals(last) : { income: 0, expense: 0 };
  const academyValue = mgmt.academy.reduce((a, p) => a + p.value, 0);
  const sponsorInc = mgmt.sponsors.reduce((a, s) => a + s.income, 0);
  const net = last ? last.net : 0;
  const health = Math.max(-100, Math.min(100, Math.round(mgmt.balance / 500 + net / 300)));
  return {
    balance: mgmt.balance,
    lastSeasonIncome: totals.income,
    lastSeasonExpense: totals.expense,
    lastSeasonNet: net,
    lastLedger: last,
    squadValue,
    academyValue,
    academyCount: mgmt.academy.length,
    facilities: (Object.entries(mgmt.facilities) as [FacilityId, number][]).map(([id, level]) => ({ id, level })),
    staff: mgmt.staff,
    sponsors: mgmt.sponsors,
    sponsorIncome: sponsorInc,
    topProspects: [...mgmt.academy].sort((a, b) => b.potential - a.potential).slice(0, 5),
    scoutTargets: mgmt.scouting.length,
    fanbase: club?.fanbase ?? 0,
    prestige: club?.prestige ?? 0,
    financialHealth: health,
    effects: facilityEffects(mgmt.facilities),
  };
}

// ── Career Fase 5: dashboard de la ORGANIZACIÓN ──

function moodLabel(score: number): FanbaseMood {
  return score >= 82 ? "eufórica" : score >= 62 ? "contenta" : score >= 42 ? "neutral" : score >= 25 ? "inquieta" : "enfadada";
}

export interface OrganizationDashboard {
  clubValue: ClubValue;
  prestige: number;
  prestigeTier: string;
  prestigeBreakdown: PrestigeBreakdown;
  fanbase: number;
  fanbaseMood: FanbaseMood;
  fanbaseMoodScore: number;
  staff: StaffMember[];
  /** Posiciones de la organización sin cubrir. */
  vacancies: { key: string; label: string }[];
  academyPlayers: number;
  academyStaff: StaffProspect[];
  sponsors: Sponsor[];
  facilityEffects: FacilityEffects;
  staffEffects: StaffEffects;
  lastLedger: SeasonLedger | null;
}

/** Panel PROFESIONAL de la organización: valor total, prestigio desglosado, fanbase, staff, sponsors. */
export function organizationDashboard(mgmt: ClubManagement, club: ClubView, squadValue: number): OrganizationDashboard {
  const breakdown = computePrestige({ club, mgmt, champion: club.position === 1, legends: Math.floor(club.titles / 3), transferActivity: 0 });
  const moodScore = mgmt.fanbaseMood ?? 50;
  const filled = new Set(mgmt.staff.map((s) => s.role));
  const vacancies = ORG_POSITIONS.filter((p) => !p.isUser && !filled.has(p.key as StaffMember["role"])).map((p) => ({ key: p.key, label: p.label }));
  return {
    clubValue: clubValue(mgmt, squadValue, club),
    prestige: Math.round(club.prestige),
    prestigeTier: prestigeTier(club.prestige),
    prestigeBreakdown: breakdown,
    fanbase: club.fanbase,
    fanbaseMood: moodLabel(moodScore),
    fanbaseMoodScore: Math.round(moodScore),
    staff: mgmt.staff,
    vacancies,
    academyPlayers: mgmt.academy.length,
    academyStaff: mgmt.academyStaff ?? [],
    sponsors: mgmt.sponsors,
    facilityEffects: facilityEffects(mgmt.facilities),
    staffEffects: staffEffects(mgmt.staff),
    lastLedger: mgmt.ledger[mgmt.ledger.length - 1] ?? null,
  };
}
