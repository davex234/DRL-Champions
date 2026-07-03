/**
 * CLUB LEGACY & GLOBAL ECOSYSTEM — tipos (Career Fase 6/7).
 *
 * El club pasa a formar parte de un ECOSISTEMA MUNDIAL que cambia cada temporada. NO es otro
 * World/Finance/Career/Timeline/News Engine: es una capa de DERIVACIÓN + efectos EMERGENTES
 * sobre el `WorldState` ya persistido (history/events/rankings/transfers/timeline/standings/
 * rivalries). Todo EMERGE del mundo, DETERMINISTA (RNG sembrado), sin azar. Todo PLANO/clonable.
 */
import type { Region } from "@/domain/cards/types";

// ───────────────────────────── Legado del club ─────────────────────────────

export interface LegendEntry { id: string; name: string; kind: "player" | "coach"; titles: number; peakRating: number; note: string }
export interface Dynasty { team: string; teamId: string; titles: number; from: number; to: number }

export interface ClubLegacy {
  clubId: string;
  name: string;
  foundedSeason: number;
  seasonsPlayed: number;
  trophies: number;
  titles: { season: number; competition: string }[];
  bestFinish: number;
  bestSeason: number | null;
  worstSeason: number | null;
  longestTitleStreak: number;
  legendarySeasons: number[];   // temporadas legendarias (título + dominio)
  legends: LegendEntry[];        // jugadores/entrenadores históricos del club
  dynasties: Dynasty[];
  records: {
    biggestTransfer: { nick: string; fee: number; season: number } | null;
    greatestPlayer: { nick: string; rating: number } | null;
    greatestCoach: { name: string; titles: number } | null;
    academyGraduates: number;
  };
}

// ───────────────────────────── Hall of Fame ─────────────────────────────

export type HofCategory = "player" | "coach" | "club" | "season" | "team" | "dynasty" | "rookie" | "transfer";
export interface HofEntry { id: string; name: string; category: HofCategory; detail: string; score: number; season: number }
export interface HallOfFame {
  players: HofEntry[];
  coaches: HofEntry[];
  clubs: HofEntry[];
  seasons: HofEntry[];
  teams: HofEntry[];
  dynasties: HofEntry[];
  rookies: HofEntry[];
  transfers: HofEntry[];
}

// ───────────────────────────── Rivalidades dinámicas ─────────────────────────────

export type RivalryOrigin = "final" | "transfer" | "dominance" | "region" | "controversy";
export interface Rivalry {
  a: string; b: string; aName: string; bName: string;
  intensity: number;       // 0..100
  origin: RivalryOrigin;
  /** Efectos que la rivalidad inyecta en el ecosistema. */
  effects: { prestige: number; attendance: number; sponsor: number; motivation: number };
  note: string;
}

// ───────────────────────────── Economía mundial ─────────────────────────────

export type EconomyPhase = "boom" | "stable" | "cooling" | "crisis";
export interface RegionValue { region: Region; value: number; trend: number }
export interface GlobalEconomy {
  phase: EconomyPhase;
  inflation: number;        // factor multiplicador ~0.8..1.4
  marketTemperature: number;// 0..100 (frío..caliente)
  avgPlayerValue: number;
  totalMoney: number;       // dinero total del ecosistema
  transferVolume: number;   // volumen de traspasos de la temporada
  regionValues: RegionValue[];
  leagueValue: number;
  note: string;
}

// ───────────────────────────── Medios ─────────────────────────────

export type MediaOutlet = "newspaper" | "analyst" | "podcast" | "influencer" | "international";
export interface MediaItem { id: string; outlet: MediaOutlet; headline: string; body: string; subject: string; heat: number }

// ───────────────────────────── Redes sociales ─────────────────────────────

export type SocialKind = "viral_player" | "trending_play" | "club_content" | "fan_reaction";
export interface SocialTrend { id: string; kind: SocialKind; subject: string; reach: number; sentiment: number; fanDelta: number; note: string }

// ───────────────────────────── Competiciones ─────────────────────────────

export type CompetitionTierId = "regional" | "qualifier" | "masters" | "invitational" | "worlds";
export interface Competition {
  id: string; name: string; tier: CompetitionTierId; season: number;
  championId: string; championName: string; runnerUpId: string | null;
  prizePool: number; prestige: number;
}

// ───────────────────────────── Marca ─────────────────────────────

export interface BrandIdentity {
  clubId: string; name: string;
  identity: string;       // arquetipo (cantera/estrellas/dominio/underdog…)
  style: string;          // estilo de juego reconocible
  popularity: number;     // 0..100
  recognition: number;    // 0..100 reconocimiento mundial
  commercialValue: number;
  tier: string;
}

// ───────────────────────────── Directivas / objetivos ─────────────────────────────

export type DirectiveKind = "win_titles" | "qualify" | "develop_youth" | "profit" | "expand_brand" | "sign_star";
export interface Directive { kind: DirectiveKind; text: string; target: number; priority: number }

// ───────────────────────────── Eventos / dashboard ─────────────────────────────

export type LegacyEventType = "record" | "dynasty_end" | "rivalry_born" | "legend" | "hall_of_fame" | "economic_boom" | "economic_crisis" | "world_champion" | "club_of_year" | "transfer_record" | "viral";
export interface LegacyEvent { id: string; type: LegacyEventType; season: number; at: number; subject: string; detail: string; magnitude: number }

export interface LegacyDashboard {
  clubLegacy: ClubLegacy;
  brand: BrandIdentity;
  directives: Directive[];
  rivalries: Rivalry[];
  worldRankPos: number;
  worldRankTotal: number;
  hallOfFame: HallOfFame;
  economy: GlobalEconomy;
  competitions: Competition[];
  media: MediaItem[];
  social: SocialTrend[];
  worldValue: number;      // valor mundial del club (marca + palmarés + prestigio)
}
