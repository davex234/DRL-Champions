/**
 * DRL TORNEOS — tipos del sistema de generación automática de cartas.
 * Tipos PUROS de dominio. Los participantes referencian ids del catálogo del
 * juego (no la población VLR).
 */

import type { AwardKind } from "@/domain/collections/awards";

export type TournamentStatus = "upcoming" | "live" | "finished";
export type RuleKind = "rating" | "mvp" | "champion";
export type SpecialKind = "mvp" | "champion";
export type PhotoSource = "riot_media" | "event_official" | "social" | "broadcast_frame" | "manual";
export type PhotoApproval = "pending" | "approved" | "rejected";

export interface Tournament {
  id: string;
  name: string;
  region?: string;
  tier?: string;
  status: TournamentStatus;
  eventId?: string;
  winnerTeamId?: string;
  startDate?: string;
  endDate?: string;
  finishedAt?: string;
}

export interface TournamentTeam {
  tournamentId: string;
  teamId: string;
  teamName?: string;
  placement?: number;
  status: "active" | "eliminated" | "champion";
}

export interface TournamentPlayer {
  tournamentId: string;
  teamId?: string;
  playerId: string;
  nick?: string;
  rating?: number;
  acs?: number;
  kd?: number;
  kast?: number;
  maps?: number;
  isMvp: boolean;
  // Métricas para los premios del Collection Engine.
  kills?: number;
  assists?: number;
  hsPct?: number;
  clutch?: number;
  isRookie?: boolean;
  stats?: Record<string, unknown>;
}

/** Regla del motor de rareza (almacenada en BD, editable). */
export interface RarityRule {
  id?: string;
  kind: RuleKind;
  tier: string;
  label: string;
  /** Umbral mínimo de rating (solo kind='rating'). */
  minRating?: number;
  /** AccoladeId a conceder ('' o undefined = solo carta base por OVR). */
  accolade?: string;
  color?: string;
  priority: number;
  active: boolean;
}

export interface CardPhoto {
  id: string;
  playerId: string;
  url: string;
  source: PhotoSource;
  quality?: number;
  approvalStatus: PhotoApproval;
  priority: number;
}

/** Especificación de una carta generada (la aplica el cliente al roster local). */
export interface GeneratedCardSpec {
  playerId: string;
  teamId?: string;
  nick?: string;
  /** 'player' = carta por rating; 'mvp'/'champion' = especial; AwardKind = premio. */
  kind: "player" | SpecialKind | AwardKind;
  tier: string;
  /** AccoladeId aplicado ('' = carta base por OVR). */
  accolade: string;
  variantId: string;
  cardId: string;
  ovr: number;
  rating?: number;
  photoId?: string;
}

export interface GenerationResult {
  tournamentId: string;
  trigger: "finish" | "team_eliminated";
  teamId?: string;
  specs: GeneratedCardSpec[];
  cardsGenerated: number;
  specialGenerated: number;
}
