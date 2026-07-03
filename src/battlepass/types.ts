/**
 * BATTLE PASS, MISSIONS & SEASONAL PROGRESSION — vocabulario compartido (Collection Fase 6/7).
 *
 * Capa de progresión de temporada ENCIMA de todo el ecosistema. NO crea otro sistema de rewards/economy/
 * collection: las recompensas se aplican por la ÚNICA ruta (`applyReward` → PackEngine/Minter/game/events).
 * Las misiones consumen DATOS REALES del juego vía un `MetricSnapshot` (contadores acumulados que
 * proporciona el store desde Gameplay/Career/Collection/Marketplace/Competitive/Online/Living World): el
 * motor NO duplica estadísticas. Todo PURO, serializable y determinista (RNG del proyecto; reloj lógico
 * inyectado; sin `Date.now`/`Math.random`).
 *
 *   Collection/Gameplay/… → MetricSnapshot → Battle Pass → applyReward → Collection/Economy/…
 */
import type { Reward } from "@/domain/events/types";

export type { Reward };

/** Versión del estado persistible (migraciones/compat futura). */
export const BP_SCHEMA_VERSION = 1;

// ───────────────────────────── Misiones (100% por datos) ─────────────────────────────

export type MissionKind =
  | "daily" | "weekly" | "seasonal" | "event" | "special" | "hidden" | "repeatable" | "community" | "progressive";

/** Definición de misión: objetivo sobre una MÉTRICA real del juego (string libre, sin hardcode). */
export interface MissionDef {
  id: string;
  label: string;
  kind: MissionKind;
  /** Métrica acumulada del ecosistema (p. ej. "packs_opened", "matches_won", "market_sell"). */
  metric: string;
  goal: number;
  reward: Reward;
  /** XP que aporta al pase al completarse. */
  xp: number;
  /** Se puede volver a completar (re-baseline al reclamar). */
  repeatable?: boolean;
  /** Oculta hasta desbloquearse (no aparece en rolls normales). */
  hidden?: boolean;
  /** Peso relativo para los sorteos (refreshMissions). Por defecto 1. */
  weight?: number;
}

/** Instantánea de métricas acumuladas (fuente = stores reales; el motor solo lee). */
export type MetricSnapshot = Record<string, number>;

/** Estado de una misión activa (baseline sobre la métrica al asignarla). */
export interface ActiveMission {
  id: string;
  kind: MissionKind;
  metric: string;
  goal: number;
  baseline: number;
  claimed: boolean;
  /** Reloj lógico de asignación (para rotación). */
  assignedAt: number;
}

// ───────────────────────────── Temporada / pases / tracks ─────────────────────────────

/** Track de recompensas: nivel → recompensa. Libre o premium. */
export type Track = Record<number, Reward>;

export interface SeasonDef {
  id: string;
  name: string;
  maxLevel: number;
  /** XP necesaria por nivel (curva lineal determinista). */
  xpPerLevel: number;
  /** Recompensas del track gratuito por nivel. */
  free: Track;
  /** Recompensas del track premium por nivel. */
  premium: Track;
  /** Coste de desbloquear el premium. */
  premiumCost?: { credits?: number; tokens?: number };
  /** Piscina de misiones (por datos). */
  missionPool: MissionDef[];
  durationDays?: number;
}

/** Temporada archivada (legacy/historic). */
export interface ArchivedSeason {
  seasonId: string;
  name: string;
  level: number;
  xp: number;
  claimedFree: number;
  claimedPremium: number;
  premium: boolean;
  missionsCompleted: number;
  endedAt: number;
}

/** Estado persistible del Battle Pass del jugador. */
export interface PassState {
  version: number;
  seasonId: string;
  xp: number;
  premium: boolean;
  /** Multiplicador de XP (boost). 1 = neutro. */
  boost: number;
  /** Auto-reclamar recompensas de nivel al subir. */
  autoClaim: boolean;
  claimedFree: number[];
  claimedPremium: number[];
  missions: ActiveMission[];
  /** Total de misiones completadas esta temporada (para analytics/prestigio). */
  missionsCompleted: number;
  archive: ArchivedSeason[];
}

// ───────────────────────────── Progreso / resultados ─────────────────────────────

export interface LevelProgress {
  level: number;
  xpIntoLevel: number;
  xpForNext: number;
  progress: number; // 0..1
  max: boolean;
}

export type PassEventType =
  | "xp_gained" | "level_up" | "reward_claimed" | "track_claimed" | "premium_unlocked"
  | "mission_completed" | "mission_claimed" | "missions_refreshed" | "season_advanced" | "season_archived";

export interface PassEvent { type: PassEventType; at: number; data?: unknown }

/** Resultado de una operación: nuevo estado + recompensas a aplicar (por el store) + eventos. */
export interface PassResult {
  ok: boolean;
  error?: string;
  state: PassState;
  /** Recompensas a aplicar por la ÚNICA ruta (`applyReward`). El motor NO las aplica (es puro). */
  rewards: Reward[];
  events: PassEvent[];
}

export interface PassAnalytics {
  seasonId: string;
  level: number;
  maxLevel: number;
  xp: number;
  percentComplete: number;
  premium: boolean;
  claimedFree: number;
  claimedPremium: number;
  missionsActive: number;
  missionsCompleted: number;
  seasonsArchived: number;
}

export interface PassIssue { code: string; message: string }
export interface PassValidation { ok: boolean; issues: PassIssue[] }
