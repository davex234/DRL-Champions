/**
 * LEGACY PRESENTATION & ENDGAME — tipos (Career Fase 7/7, FINAL).
 *
 * La capa de CIERRE del modo Carrera: documental, museo, Hall of Fame ampliado, estadísticas
 * históricas, récords, rueda de prensa final y New Game+. NO es otro Career/Presentation/
 * Timeline/News/Replay Engine: DERIVA todo de los datos REALES ya persistidos (`ManagerCareer`
 * + `WorldState` + `@/legacy`). Todo EMERGE, DETERMINISTA, sin scripts ni cinemáticas falsas.
 */
import type { HallOfFame } from "@/legacy";

// ───────────────────────────── Estadísticas históricas ─────────────────────────────

export interface EndgameStats {
  seasonsCoached: number;
  teamsCoached: number;
  matches: number;
  wins: number;
  losses: number;
  winRate: number;          // 0..100
  titles: number;
  finals: number;
  mvps: number;
  bestWinStreak: number;
  playersTrained: number;
  rookiesDiscovered: number;
  moneyGenerated: number;   // ingresos acumulados
  clubValue: number;
  sponsorsSigned: number;
  facilitiesBuilt: number;  // niveles totales de instalaciones
  reputationScore: number;
  reputationTier: string;
  overall: number;
  level: number;
}

// ───────────────────────────── Récords ─────────────────────────────

export interface RecordLine { label: string; value: string; detail?: string }
export interface CareerRecords {
  personal: RecordLine[];
  club: RecordLine[];
  world: RecordLine[];
  career: RecordLine[];
}

// ───────────────────────────── Museo ─────────────────────────────

export type MuseumSection = "trophies" | "jerseys" | "players" | "coaches" | "seasons" | "records" | "matches" | "transfers" | "news";
export interface MuseumItem { section: MuseumSection; title: string; subtitle: string; season: number; detail: string }
export interface Museum {
  clubName: string;
  founded: number;
  items: MuseumItem[];
  counts: Record<MuseumSection, number>;
}

// ───────────────────────────── Documental ─────────────────────────────

export type ChapterId = "start" | "first_signing" | "first_title" | "worst_defeat" | "greatest_comeback" | "greatest_rivalry" | "favourite_player" | "favourite_coach" | "last_match" | "retirement";
export interface DocumentaryChapter { id: ChapterId; title: string; narration: string; season: number | null }
export interface Documentary { title: string; subtitle: string; chapters: DocumentaryChapter[]; epilogue: string }

// ───────────────────────────── Rueda de prensa ─────────────────────────────

export type PressRole = "journalist" | "analyst" | "fan" | "ex_player" | "coach" | "legend";
export interface PressQuote { speaker: string; role: PressRole; quote: string; sentiment: number }
export interface PressConference { headline: string; quotes: PressQuote[] }

// ───────────────────────────── Hall of Fame (inducción) ─────────────────────────────

export interface HofInduction {
  inducted: boolean;
  tier: string;             // nivel de leyenda alcanzado
  citation: string;         // texto de inducción (Narrative)
  halls: HallOfFame;        // los 9 halls del mundo (reusa @/legacy)
  coachRank: number;        // ranking histórico del entrenador
}

// ───────────────────────────── New Game+ ─────────────────────────────

export type ReconversionRole = "coach" | "sporting_director" | "analyst" | "caster" | "scout" | "ambassador" | "legend";
export interface Reconversion { id: string; nick: string; from: string; newRole: ReconversionRole; note: string }
export interface NewGamePlusSeed {
  retiredCoachId: string;
  legendsCarried: number;   // leyendas que permanecen en el mundo
  recordsCarried: number;   // récords que permanecen
  reconversions: Reconversion[]; // ex-jugadores del usuario que se reconvierten
  worldMemoryNote: string;
}

// ───────────────────────────── Evento / estado / dashboard ─────────────────────────────

export type EndgameEventType = "retirement" | "hall_of_fame" | "career_record" | "last_season" | "legacy" | "successor";
export interface EndgameEvent { id: string; type: EndgameEventType; season: number; at: number; subject: string; detail: string; magnitude: number }

/** Estado CONGELADO de fin de carrera (persistible, visible incluso tras New Game+). */
export interface EndgameState {
  coachName: string;
  clubName: string | null;
  retiredSeason: number;
  headline: string;
  stats: EndgameStats;
  records: CareerRecords;
  museum: Museum;
  documentary: Documentary;
  press: PressConference;
  induction: HofInduction;
  newGamePlus: NewGamePlusSeed;
  worldRankPos: number;
  worldRankTotal: number;
  impactScore: number;      // impacto mundial 0..100
}
