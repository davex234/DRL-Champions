/**
 * MANAGER CAREER ENGINE — tipos.
 *
 * El usuario deja de ser "el usuario": ahora es un ENTRENADOR con identidad propia,
 * atributos, personalidad, reputación, experiencia, licencias, historial y objetivos.
 * Su carrera puede durar DÉCADAS dentro del universo de DRL Champions.
 *
 * Este módulo es PURO (sin React, sin store): produce estados PLANOS y clonables
 * (persistibles). Reutiliza el Player Identity Engine (`@/sim/identity`) para el ADN de
 * personalidad y el patrón de noticias (`@/intel` NewsItem). No duplica ningún motor.
 */
import type { Identity } from "@/sim/identity";
import type { Region, RoleId } from "@/domain/cards/types";
import type { NewsItem } from "@/intel";
import type { InnateProfile, DevState, ScoutReport } from "@/development";

export type { Region };

// ───────────────────────── Atributos del entrenador ─────────────────────────

/** 15 atributos REALES de entrenador (no stats de combate). Todos 0..100, 50 = medio. */
export type CoachAttributeKey =
  | "leadership"
  | "communication"
  | "discipline"
  | "motivation"
  | "talentDevelopment"
  | "tacticalVision"
  | "scouting"
  | "pressureManagement"
  | "mediaHandling"
  | "negotiation"
  | "teamManagement"
  | "analytics"
  | "mentalCoaching"
  | "trainingQuality"
  | "adaptability";

export type CoachAttributes = Record<CoachAttributeKey, number>;

// ───────────────────────── Personalidad (reusa Identity) ─────────────────────

/** ADN de personalidad del entrenador. Se mapea a un vector `Identity` (reutilizado). */
export type CoachPersonalityId =
  | "calm"
  | "aggressive"
  | "innovative"
  | "traditional"
  | "motivator"
  | "analytical"
  | "patient"
  | "demanding"
  | "flexible"
  | "controlling";

/** Estilo de juego declarado por el entrenador en la creación. */
export type CoachStyle =
  | "aggressive"
  | "control"
  | "tactical"
  | "balanced"
  | "developer"
  | "motivator";

/** Especialidad declarada (sesga atributos y la narrativa de carrera). */
export type CoachSpecialty =
  | "aim"
  | "igl"
  | "strategy"
  | "psychology"
  | "scouting"
  | "management";

// ───────────────────────────── Reputación ───────────────────────────────────

/** Reputación mundial por ámbitos. Todos 0..100. */
export interface Reputation {
  local: number;
  regional: number;
  continental: number;
  global: number;
}

export type ReputationTierId =
  | "unknown"
  | "local"
  | "regional"
  | "continental"
  | "global"
  | "legendary";

// ───────────────────────────── Licencias ────────────────────────────────────

/** Progresión de licencias. NO por tiempo: por RESULTADOS (nivel/títulos/reputación). */
export type LicenseId = "nivel-1" | "nivel-2" | "nivel-3" | "nivel-4" | "elite" | "legend";

export interface LicenseDef {
  id: LicenseId;
  name: string;
  /** Requisitos por resultados (todos deben cumplirse). */
  req: { level: number; titles: number; reputation: number };
}

// ───────────────────────────── Identidad ────────────────────────────────────

export interface Coach {
  id: string;
  name: string;
  age: number;
  country: string;
  /** Clave/emoji de avatar (la UI lo resuelve; persistimos solo el identificador). */
  avatar: string;
  bio: string;
  language: string;
  style: CoachStyle;
  specialty: CoachSpecialty;
  personality: CoachPersonalityId;
  /** Vector de personalidad reutilizando el Player Identity Engine. */
  identity: Identity;
  region: Region;
  createdAt: number;
}

// ───────────────────────────── Historial ────────────────────────────────────

export interface CareerSpell {
  team: string;
  fromSeason: number;
  toSeason: number | null; // null = en activo
}

export interface CareerTitle {
  season: number;
  team: string;
  competition: string;
  tier: CompetitionTier;
}

export interface CareerResult {
  season: number;
  team: string;
  competition: string;
  /** "champion" | "final" | "defeat" — para palmarés y derrotas históricas. */
  kind: "champion" | "final" | "defeat";
}

export interface CareerSeasonRecord {
  season: number;
  team: string;
  wins: number;
  losses: number;
  titles: number;
  finals: number;
  reputationEnd: number;
}

/** Estadísticas vitalicias acumuladas. NUNCA se borran. */
export interface CareerStats {
  matchesPlayed: number;
  wins: number;
  losses: number;
  titles: number;
  finals: number;
  defeats: number;
  mvps: number;
  bestWinStreak: number;
  currentWinStreak: number;
  seasonsCoached: number;
  teamsCoached: number;
}

export interface CareerHistory {
  spells: CareerSpell[];
  titles: CareerTitle[];
  results: CareerResult[];
  seasons: CareerSeasonRecord[];
}

// ───────────────────────────── Objetivos ────────────────────────────────────

export type ObjectiveHorizon = "short" | "medium" | "long" | "lifetime";
export type ObjectiveStatus = "active" | "achieved" | "failed";

export interface CareerObjective {
  id: string;
  horizon: ObjectiveHorizon;
  text: string;
  /** Métrica evaluada (clave de CareerStats) y meta. */
  metric: keyof CareerStats;
  target: number;
  /** Base desde la que se mide (para objetivos incrementales). */
  base: number;
  status: ObjectiveStatus;
  createdSeason: number;
}

// ───────────────────────────── Logros ───────────────────────────────────────

/** Contexto para evaluar el progreso de un logro de entrenador. */
export interface CoachAchievementContext {
  stats: CareerStats;
  reputation: Reputation;
  level: number;
  license: LicenseId;
  perfectSeasons: number;
}

export interface CoachAchievementDef {
  id: string;
  name: string;
  description: string;
  icon: string;
  reward: number; // DRL Credits (se conceden vía useGameStore al reclamar)
  goal: number;
  progress: (ctx: CoachAchievementContext) => number;
}

// ───────────────────────────── Narrativa ────────────────────────────────────

export type CoachCareerEventType =
  | "first_contract"
  | "first_victory"
  | "first_trophy"
  | "career_milestone"
  | "perfect_season"
  | "mastermind"
  | "historic_career"
  | "coach_legend"
  | "historic_coach"
  | "golden_coach"
  | "license_unlocked"
  | "level_up"
  | "objective_achieved"
  // — Career Fase 2: Club & Contract —
  | "contract_signed"
  | "contract_renewed"
  | "dismissed"
  | "offer_received"
  | "offer_accepted"
  | "offer_rejected"
  | "historic_contract"
  | "new_project"
  | "philosophy_change"
  | "max_pressure"
  | "objectives_failed"
  // — Career Fase 3: Manager & Club Management —
  | "sponsor_signed"
  | "facility_upgraded"
  | "rookie_promoted"
  | "prospect_scouted"
  | "record_sale"
  | "staff_hired"
  | "financial_trouble"
  | "investment";

export interface CoachCareerEvent {
  type: CoachCareerEventType;
  season: number;
  magnitude: number; // 1..100
  detail: string;
  at: number;
}

// ───────────────────────────── Competiciones ────────────────────────────────

export type CompetitionTier = "regional" | "continental" | "global";

/** Resultado de UN partido (entrada desacoplada del motor de partido). */
export interface MatchOutcome {
  won: boolean;
  teamName?: string;
  opponentName?: string;
  kills?: number;
  mvp?: boolean;
  /** Importancia del partido (sesga la ganancia de reputación). */
  tier?: CompetitionTier;
}

/** Resultado de UNA temporada/competición (entrada desacoplada). */
export interface SeasonOutcome {
  team: string;
  competition: string;
  tier: CompetitionTier;
  wins: number;
  losses: number;
  /** Campeón de la competición. */
  champion: boolean;
  /** Llegó a la final (aunque no ganara). */
  finalist: boolean;
  /** Un jugador del entrenador se llevó el MVP. */
  mvpAwarded: boolean;
  /** Posición final (1 = campeón). */
  placement: number;
  /** Nº de equipos en la competición (para "temporada perfecta"). */
  fieldSize?: number;
}

// ───────────────────────────── Estado raíz ──────────────────────────────────

/** Estado PERSISTENTE de la carrera del entrenador. Plano y clonable. */
export interface ManagerCareer {
  coach: Coach;
  attributes: CoachAttributes;
  reputation: Reputation;
  xp: number;
  level: number;
  license: LicenseId;
  season: number;
  currentTeam: string | null;
  stats: CareerStats;
  history: CareerHistory;
  objectives: CareerObjective[];
  /** Objetivo personal vitalicio elegido en la creación. */
  personalGoal: string;
  /** Ids de logros reclamados. */
  claimedAchievements: string[];
  perfectSeasons: number;
  events: CoachCareerEvent[];
  /** Semilla determinista derivada de la identidad (objetivos, jitter de atributos). */
  seed: number;

  // ── Career Fase 2: Club & Contract (opcionales para retro-compat con Fase 1) ──
  /** Id del club del Living World que dirige (null = en paro). */
  clubId: string | null;
  /** Contrato vigente con el club (null = sin contrato). */
  contract: CoachContract | null;
  /** Relación con directiva/afición/jugadores (confianza/presión). */
  board: BoardRelation;
  /** Ofertas activas del mercado de entrenadores. */
  offers: Offer[];
  /** Temporadas consecutivas en paro (afecta a la reputación y a las ofertas). */
  unemployedSeasons: number;

  // ── Career Fase 3: gestión integral del club (null si está en paro) ──
  management: ClubManagement | null;
}

/** Salida de un paso del motor: nuevo estado + eventos + noticias derivadas. */
export interface CareerStep {
  career: ManagerCareer;
  events: CoachCareerEvent[];
  news: NewsItem[];
}

// ══════════════════════ Career Fase 2 — Club & Contract ══════════════════════

/** Filosofía del director deportivo (define qué entrenador busca el club). */
export type ClubPhilosophy =
  | "develop_youth"
  | "buy_stars"
  | "financial_control"
  | "long_project"
  | "win_now";

/** Vista DESACOPLADA de un club del Living World (lo que el motor de carrera necesita). */
export interface ClubView {
  id: string;
  name: string;
  tag: string;
  region: Region;
  prestige: number; // 0..100
  budget: number;
  fanbase: number;
  titles: number;
  /** Última posición en liga (1 = campeón). */
  position: number;
  totalTeams: number;
  /** ¿Tiene entrenador ahora mismo? */
  hasCoach: boolean;
  /** Rating del entrenador actual (0 si vacante). */
  coachRating: number;
  philosophy: ClubPhilosophy;
}

export interface ContractBonuses {
  win: number;          // por victoria
  playoffs: number;     // por clasificarse a playoffs
  major: number;        // por ganar un Major/continental
  worlds: number;       // por ganar el mundial/global
  qualification: number;// por clasificar a internacional
  perTitle: number;     // prima por cada título
}

export type ClubObjectiveKind =
  | "win_league"
  | "reach_playoffs"
  | "top4"
  | "win_major"
  | "win_worlds"
  | "develop_rookies"
  | "cut_costs"
  | "raise_prestige"
  | "grow_fanbase"
  | "keep_dynasty"
  | "qualify_international";

export interface ClubObjective {
  kind: ClubObjectiveKind;
  text: string;
  /** Posición de liga requerida (0 = objetivo no posicional). */
  targetPosition: number;
  mandatory: boolean;
  status: "pending" | "met" | "failed";
}

export type ContractStatus = "active" | "expired" | "terminated" | "fulfilled";

export interface CoachContract {
  clubId: string;
  clubName: string;
  role: string;
  startSeason: number;
  endSeason: number;
  years: number;
  salary: number;        // anual
  bonuses: ContractBonuses;
  releaseClause: number; // lo que otro club paga para llevárselo
  exitClause: number;    // lo que el coach paga para irse
  objectives: ClubObjective[];
  status: ContractStatus;
  signedSeason: number;
}

/** Relación con el entorno del club (todo 0..100). Persistente. */
export interface BoardRelation {
  confidence: number;    // confianza de la directiva
  pressure: number;      // presión sobre el entrenador
  boardTrust: number;    // relación con la directiva
  fanSupport: number;    // relación con la afición
  playerRespect: number; // relación con los jugadores
}

export type OfferStatus = "pending" | "accepted" | "rejected" | "expired";

export interface OfferTerms {
  years: number;
  salary: number;
  bonuses: ContractBonuses;
  releaseClause: number;
  exitClause: number;
  objectives: ClubObjective[];
}

export interface Offer {
  id: string;
  clubId: string;
  clubName: string;
  region: Region;
  season: number;
  prestige: number;
  philosophy: ClubPhilosophy;
  terms: OfferTerms;
  /** Atractivo de la oferta para el entrenador (0..100). */
  appeal: number;
  status: OfferStatus;
}

/** Decisión del club sobre su entrenador al cerrar la temporada. */
export type ClubDecision =
  | { kind: "keep" }
  | { kind: "renew"; offer: Offer }
  | { kind: "fire"; reason: string }
  | { kind: "warn"; reason: string };

/** Clasificación del mercado de entrenadores (reusa los WorldCoach del Living World). */
export interface CoachMarketRow {
  id: string;
  name: string;
  rating: number;
  titles: number;
  seasons: number;
  teamId: string | null;
}
export interface CoachMarket {
  free: CoachMarketRow[];
  occupied: CoachMarketRow[];
  legends: CoachMarketRow[];
  rookies: CoachMarketRow[];
}

// ══════════════════ Career Fase 3 — Manager & Club Management ══════════════════

/** Instalaciones del club. Cada una afecta REALMENTE al juego (nivel 0..5). */
export type FacilityId =
  | "training_center"  // + desarrollo
  | "academy"          // mejores rookies
  | "medical"          // menos fatiga
  | "analysis"         // + info para el coach
  | "scouting"         // mejores descubrimientos
  | "offices"          // + ingresos/negociación
  | "tactical_room"    // + ventaja táctica
  | "gaming_house"     // + química/condición
  // ── Career Fase 5: organización completa ──
  | "psychology"       // + mental / menos tilt (centro psicológico)
  | "fitness"          // + recuperación / resistencia a lesiones (centro físico)
  | "media_studio"     // + alcance de contenido / streaming (estudio multimedia)
  | "fan_center";      // + engagement de afición / merchandising (fan center)

export type Facilities = Record<FacilityId, number>;

/** Modificadores REALES derivados de las instalaciones. */
export interface FacilityEffects {
  devBonus: number;        // 0..1 desarrollo extra (training_center)
  academyQuality: number;  // 0..1 calidad de cantera (academy)
  fatigueReduction: number;// 0..1 menos fatiga (medical)
  infoBonus: number;       // 0..1 info del coach (analysis + tactical_room)
  scoutBonus: number;      // 0..1 mejor scouting (scouting)
  incomeBonus: number;     // 0..1 más ingresos (offices)
  chemistryBonus: number;  // 0..1 química (gaming_house)
  // ── Career Fase 5 ──
  mentalBonus: number;     // 0..1 mental / menos tilt (psychology)
  recoveryBonus: number;   // 0..1 recuperación + resistencia a lesiones (fitness + medical)
  contentReach: number;    // 0..1 alcance de contenido/streaming (media_studio)
  fanEngagement: number;   // 0..1 engagement de afición/merch (fan_center)
}

export type StaffRoleId =
  | "assistant_coach" | "analyst" | "psychologist" | "scout" | "performance" | "manager"
  // ── Career Fase 5: organización profesional ──
  | "sporting_director" | "content_manager" | "marketing_manager" | "community_manager" | "ceo";

/** Personalidad del staff (sesga sus efectos y su historia). Fase 5. */
export type StaffPersonality = "ambitious" | "loyal" | "innovative" | "methodical" | "charismatic" | "demanding";

export interface StaffMember {
  id: string;
  role: StaffRoleId;
  name: string;
  rating: number; // 0..100
  salary: number; // anual
  // ── Career Fase 5 (opcionales para retro-compat con Fase 3) ──
  experience?: number;      // 0..100 años/bagaje
  specialty?: string;       // especialidad declarada
  personality?: StaffPersonality;
  potential?: number;       // 0..100 techo
  prestige?: number;        // 0..100 caché
  contractYears?: number;   // temporadas restantes
  history?: string[];       // hitos/trayectoria
}

/** Modificadores REALES del staff (no cosméticos). */
export interface StaffEffects {
  trainingBoost: number;   // assistant_coach
  infoBoost: number;       // analyst
  mentalBoost: number;     // psychologist
  scoutBoost: number;      // scout
  fatigueBoost: number;    // performance
  incomeBoost: number;     // manager
  // ── Career Fase 5 ──
  contentBoost: number;    // content_manager (contenido/streaming)
  marketingBoost: number;  // marketing_manager (fanbase/comercial)
  communityBoost: number;  // community_manager (retención de afición)
  commercialBoost: number; // ceo + sporting_director (ingresos/negociación)
}

export type SponsorTier = "local" | "regional" | "global" | "title";

/** Personalidad/exigencia de un patrocinador (Fase 5). No todos pagan igual ni piden lo mismo. */
export type SponsorPersonality = "moneybags" | "results" | "visibility" | "youth" | "content" | "titles";

export interface Sponsor {
  id: string;
  name: string;
  tier: SponsorTier;
  income: number;          // por temporada
  /** Objetivo posicional exigido (0 = sin exigencia). */
  objectivePosition: number;
  years: number;
  signedSeason: number;
  // ── Career Fase 5 ──
  personality?: SponsorPersonality;
  satisfaction?: number;   // 0..100 (cumplir sus exigencias mantiene/renueva el patrocinio)
}

/** Promesa NO jugadora de la academia (coach/analista/scout/manager). Fase 5. */
export interface StaffProspect {
  id: string;
  name: string;
  role: StaffRoleId;
  rating: number;
  potential: number;
  personality: StaffPersonality;
  signedSeason: number;
}

/** Joven de la academia (reusa el Player Development Engine: innate + dev + scout). */
export interface AcademyProspect {
  id: string;
  name: string;
  age: number;
  region: Region;
  role: RoleId;
  innate: InnateProfile;
  dev: DevState;
  scout: ScoutReport;
  potential: number;
  rating: number;          // progreso actual 0..100
  value: number;
  signedSeason: number;
}

/** Objetivo de ojeo descubierto por los scouts (reusa scoutPlayer). */
export interface ScoutTarget {
  id: string;
  name: string;
  region: Region;
  role: RoleId;
  rating: number;
  potential: number;
  value: number;
  cost: number;            // coste de fichaje estimado
  risk: number;            // 0..100
  compatibility: number;   // 0..100 con el estilo del coach
  chemistry: number;       // 0..100 con la plantilla
  report: ScoutReport;
}

/** Desglose económico de una temporada. Fase 5 amplía las líneas (streaming/contenido/derechos,
 *  marketing/bootcamps/impuestos-preparado). */
export interface SeasonLedger {
  season: number;
  income: { sponsors: number; prizes: number; merchandising: number; tickets: number; events: number; sales: number; streaming: number; content: number; rights: number };
  expenses: { salaries: number; facilities: number; academy: number; travel: number; scouting: number; staff: number; purchases: number; marketing: number; bootcamps: number; taxes: number };
  net: number;
  balanceEnd: number;
}

/** Estado de GESTIÓN del club del usuario. Plano y clonable. */
export interface ClubManagement {
  clubId: string;
  facilities: Facilities;
  staff: StaffMember[];
  sponsors: Sponsor[];
  academy: AcademyProspect[];
  scouting: ScoutTarget[];
  ledger: SeasonLedger[];
  /** Saldo del club gestionado por el usuario (se refleja en WorldTeam.budget). */
  balance: number;
  // ── Career Fase 5 (opcional para retro-compat) ──
  /** Promesas NO jugadoras de la academia (coaches/analistas/scouts/managers). */
  academyStaff?: StaffProspect[];
  /** Fanbase acumulada del club (mood/merch) — reflejada en WorldTeam.fanbase. */
  fanbaseMood?: number; // 0..100 (50 = neutral)
}
