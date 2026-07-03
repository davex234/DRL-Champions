/**
 * MANAGER CAREER ENGINE — API pública.
 *
 * Motor PURO de la carrera del entrenador (Career Fase 1/7). El usuario deja de ser "el
 * usuario": ahora es un ENTRENADOR con identidad, atributos, personalidad, reputación,
 * experiencia, licencias, historial y objetivos persistentes que pueden durar décadas.
 *
 * Reutiliza, sin duplicar: `@/sim/identity` (ADN de personalidad), `@/sim/rng` (RNG
 * sembrado) y `@/intel` (NewsItem). El store (`useManagerStore`) orquesta y persiste.
 */
export * from "./types";
export { ATTR_KEYS, ATTR_FAMILIES, ATTR_LABEL, neutralAttributes, makeAttributes, clampAttr, attrOverall, deriveAttributes } from "./attributes";
export { PERSONALITY_LABEL, PERSONALITY_IDENTITY, personalityIdentity, personalityTags } from "./personality";
export { ZERO_REPUTATION, globalReputationScore, reputationAfterMatch, reputationAfterSeason, reputationTier } from "./reputation";
export { xpForLevel, levelFromXp, levelProgress, xpForMatch, xpForSeason } from "./experience";
export { LICENSES, licenseDef, licenseRank, licenseFor, nextLicense } from "./licenses";
export { emptyHistory, joinTeam, recordSeason } from "./history";
export { generateObjectives, evaluateObjectives } from "./objectives";
export { COACH_ACHIEVEMENTS, buildCoachAchievementContext, coachAchievementViews, claimableReward, type CoachAchievementView } from "./achievements";
export { detectCareerEvents } from "./narrative";
export { careerNews } from "./news";
export { createCoach, type CoachCreateInput } from "./create";
export { applyMatchResult, applySeasonResult } from "./progress";
export { careerBroadcast, type CoachCareerBroadcast, type AttrRow } from "./broadcast";
export { makeRng, seedFrom, seedOf, type Rng } from "./rng";

// ── Career Fase 2 — Club & Contract ──
export { PHILOSOPHY_LABEL, derivePhilosophy, expectedPosition, boardObjectivesFor } from "./club";
export { coachWageFactor, termsFor, createContract, tickContract, yearsLeft, coachRating } from "./contracts";
export { initBoard, boardAfterMatch, boardAfterSeason, evaluateBoardObjectives, dismissalRisk } from "./board";
export { offerAppeal, generateOffers } from "./offers";
export { clubSeasonDecision } from "./clubAI";
export { acceptOffer, renewContract, dismiss, rejectOffer } from "./negotiate";
export { classifyMarket, type CoachLike } from "./market";
export { clubViewsFromWorld, clubViewFor, coachesFromWorld, seasonOutcomeFromWorld } from "./worldBridge";
export { applyMatchToCareer, runCareerSeason, runUnemployedSeason } from "./season";
export { careerDashboard, type CoachDashboard, clubDashboard, type ClubManagementDashboard, organizationDashboard, type OrganizationDashboard } from "./dashboard";

// ── Career Fase 3 — Manager & Club Management ──
export { FACILITY_IDS, FACILITY_LABEL, FACILITY_EFFECT_LABEL, MAX_FACILITY_LEVEL, initFacilities, backfillFacilities, upgradeCost, facilitiesUpkeep, facilityEffects, upgradeFacility } from "./facilities";
export { STAFF_ROLES, STAFF_LABEL, STAFF_PERSONALITIES, staffEffects, staffSalaries, generateStaffCandidates, hireStaff } from "./staff";
export { sponsorIncome, availableSponsors, signSponsor, sponsorSatisfaction, SPONSOR_PERSONALITY_LABEL } from "./sponsors";
export { computeSeasonFinances, ledgerTotals } from "./clubEconomy";
export { generateAcademyIntake, promoteProspect, generateAcademyStaff, promoteStaffProspect } from "./academy";
export { runScouting, type ScoutPoolEntry } from "./scouting";
export { trainingCapacity, trainingEffectiveness, trainPlayer } from "./training";
export { initManagement, runManagementSeason, type ManagementStep } from "./management";

// ── Career Fase 5 — Club Organization & Facilities ──
export {
  ORG_POSITIONS, computePrestige, computeFanbase, clubValue, runAiOrganizations, orgNews, prestigeTier,
  type PrestigeBreakdown, type PrestigeInputs, type FanbaseResult, type FanbaseInputs, type FanbaseMood,
  type ClubValue, type OrgEvent, type OrgEventType,
} from "./organization";
