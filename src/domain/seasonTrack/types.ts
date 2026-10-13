/**
 * F83 · TEMPORADAS Y RUTA DE TEMPORADA — vocabulario (puro).
 *
 * Una temporada es CONFIGURACIÓN versionada: fechas, curva de XP (con los umbrales congelados en `levels`), XP por
 * fuente con topes, recompensas por nivel y retos diarios/semanales. Publicada, no cambia (lo impone la BD). La FASE
 * (programada, activa, en gracia, archivada) se deriva de la hora del servidor; no se guarda.
 *
 * La XP de temporada es una unidad propia: no es la XP de cuenta (`profiles.xp`), ni la del pase heredado
 * (`user_pass`), ni el rating, ni créditos. Su fuente de verdad es `season_xp_ledger`; el nivel se DERIVA de la XP.
 */
import type { MissionCondition } from "@/domain/missionEngine/types";

export type SeasonStatus = "DRAFT" | "PUBLISHED" | "CANCELLED";
export type SeasonPhase = "DRAFT" | "CANCELLED" | "SCHEDULED" | "ACTIVE" | "GRACE" | "ARCHIVED";

/** Recompensa de nivel. Solo lo que el servidor ya sabe entregar: créditos y sobres por `award()`, insignia por cosméticos. */
export interface SeasonReward {
  credits?: number;
  packId?: string;
  packCount?: number;
  /** Insignia de temporada (familia `insignia` de `user_cosmetics`, la de F82/F89): `insignia:temporada:<slug>`. */
  badge?: string;
}

export interface LevelReward { level: number; reward: SeasonReward }

export type ChallengeKind = "daily" | "weekly";

/** Un reto: la MISMA condición tipada del motor de misiones de F73 (se evalúa con su evaluador), objetivo y XP. */
export interface ChallengeDef {
  id: string;
  /** Familia: dos retos de la misma familia no salen a la vez (sin «juega 3» + «juega 5» el mismo día). */
  family: string;
  label: string;
  condition: MissionCondition;
  target: number;
  xp: number;
}

export interface SeasonXpRules {
  /** XP base por partida que CUENTA (terminada por reglas, no privada, con decisiones humanas suficientes — F73). */
  match: { PVE: number; DRAFT: number; RANKED: number; winBonus: number; dailyCap: number };
  /** Crafteo real completado (sobre o carta). Nunca desguace. */
  craft: { amount: number; dailyCap: number };
  /** Collection Set de F82 completado DURANTE la temporada (una vez por set). */
  collection: number;
}

export interface SeasonConfig {
  version: 1;
  curve: { base: number; step: number };
  /** Umbrales acumulados para ALCANZAR cada nivel (levels[i] = XP para el nivel i+1). Congelados al publicar. */
  levels: number[];
  xp: SeasonXpRules;
  rewards: LevelReward[];
  challenges: { daily: { count: number; pool: ChallengeDef[] }; weekly: { count: number; pool: ChallengeDef[] } };
}

export interface GameSeason {
  id: string;
  number: number;
  name: string;
  description: string;
  status: SeasonStatus;
  startsAt: number;
  endsAt: number;
  claimUntil: number;
  maxLevel: number;
  config: SeasonConfig;
  configVersion: number;
  checksum: string | null;
  publishedAt: number | null;
  rowVersion: number;
}

export const SEASON_ID_RE = /^[a-z0-9][a-z0-9-]{1,47}$/;
export const SEASON_BADGE_RE = /^insignia:temporada:[a-z0-9-]{1,48}$/;

/** Fase derivada de la hora del SERVIDOR (nunca del navegador). */
export function phaseOf(s: Pick<GameSeason, "status" | "startsAt" | "endsAt" | "claimUntil">, now: number): SeasonPhase {
  if (s.status === "DRAFT") return "DRAFT";
  if (s.status === "CANCELLED") return "CANCELLED";
  if (now < s.startsAt) return "SCHEDULED";
  if (now < s.endsAt) return "ACTIVE";
  if (now < s.claimUntil) return "GRACE";
  return "ARCHIVED";
}
