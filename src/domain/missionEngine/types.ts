/**
 * F73 · MOTOR DE MISIONES — vocabulario. PURO.
 *
 * Una misión es CONFIGURACIÓN (admin): una condición tipada con parámetros, un objetivo, dependencias y, si procede, una
 * recompensa. El progreso lo calcula SOLO el servidor a partir de EVENTOS que él mismo produce (fin de partida guardado,
 * apertura de sobre, crafteo), cada uno con una clave única que se procesa una vez por usuario.
 *
 * Misiones de UNA vez (no se repiten ni rotan): se completan y, si llevan recompensa, se reclaman una vez.
 * Los PROYECTOS agrupan misiones y, completadas todas, permiten reclamar UNA carta REAL del catálogo.
 */
import type { RoleId } from "@/domain/cards/types";

export const CONDITION_TYPES = [
  "MATCH_PLAY", "MATCH_WIN", "WIN_STREAK", "TURN_WIN",
  "USE_CARD", "USE_PLAYER", "USE_TEAM", "USE_COUNTRY", "USE_ROLE",
  "DECK_CONTAINS_PLAYER", "DECK_MIN_TEAM", "DECK_MIN_COUNTRY", "DECK_MIN_ROLE",
  "WIN_WITH_PLAYER", "WIN_WITH_TEAM_COUNT", "WIN_WITH_COUNTRY_COUNT", "WIN_WITH_ROLE_COUNT",
  "WIN_PVE", "WIN_PVP", "WIN_COMPETITIVE", "WIN_DRAFT",
  "CRAFT_PACK", "CRAFT_CARD", "OPEN_PACK",
] as const;
export type ConditionType = (typeof CONDITION_TYPES)[number];

/** Modos de partida que pueden contar. PVP_PRIVATE no cuenta NUNCA (anti-farm entre cuentas amigas). */
export const MATCH_MODES = ["PVE", "DRAFT", "RANKED"] as const;
export type MatchModeKey = (typeof MATCH_MODES)[number];
export type Difficulty = "EASY" | "NORMAL" | "HARD";

export interface MissionCondition {
  type: ConditionType;
  /** Restringe los modos (por defecto: los tres). */
  modes?: MatchModeKey[];
  /** PvE: dificultad mínima del bot. */
  minDifficulty?: Difficulty;
  cardId?: string;
  playerId?: string;
  /** Equipo CANÓNICO (clave de `canonicalCardTeam`, el impreso en la carta). */
  team?: string;
  /** País ISO-2 del jugador. */
  country?: string;
  role?: RoleId;
  /** Mínimo de cartas que cumplen (DECK_MIN_* / WIN_WITH_*_COUNT). Sin `team`/`country`/`role`: «del MISMO …». */
  min?: number;
  /** OPEN_PACK / CRAFT_PACK: un sobre concreto (opcional). */
  packId?: string;
}

export type MissionStatusCfg = "DRAFT" | "ACTIVE" | "RETIRED";

export interface MissionReward { credits?: number; xp?: number; packId?: string; packCount?: number }

export interface MissionDef {
  id: string;
  name: string;
  description: string;
  condition: MissionCondition;
  target: number;
  dependsOn: string[];
  reward: MissionReward;
  projectId: string | null;
  status: MissionStatusCfg;
  sortOrder: number;
  availableFrom: number | null;
  availableTo: number | null;
  version: number;
}

export interface ProjectDef {
  id: string;
  name: string;
  description: string;
  /** Carta REAL del catálogo que se entrega al reclamar. */
  targetCardId: string;
  status: MissionStatusCfg;
  sortOrder: number;
  availableFrom: number | null;
  availableTo: number | null;
  version: number;
}

/** Progreso guardado de un usuario. */
export interface MissionProgressRow { missionId: string; progress: number; completedAt: number | null; claimedAt: number | null }

export type MissionState = "LOCKED" | "ACTIVE" | "COMPLETED" | "CLAIMED";

/* ── EVENTOS (los produce el servidor; nunca el cliente) ── */

export interface DeckFact { cardId: string; playerId: string; team: string; country: string; role: RoleId }

export interface MatchEvent {
  kind: "MATCH";
  /** `match:<matchId>`: una partida se procesa UNA vez por usuario. */
  key: string;
  mode: MatchModeKey | "PRIVATE";
  difficulty: Difficulty | null;
  won: boolean;
  draw: boolean;
  /** Terminada por reglas (no abandono, no cierre). */
  finished: boolean;
  turnsWon: number;
  /** Decisiones propias: las de la persona y las que jugó el reloj (F72.8). */
  humanDecisions: number;
  autoDecisions: number;
  /** El equipo con el que se jugó, tal como lo congeló el servidor al empezar. */
  deck: DeckFact[];
}
export interface PackEvent { kind: "OPEN_PACK" | "CRAFT_PACK"; key: string; packId: string }
export interface CraftCardEvent { kind: "CRAFT_CARD"; key: string; recipeId: string }
export type MissionEvent = MatchEvent | PackEvent | CraftCardEvent;

/** Lo que el servidor aplica en la base de datos, de forma atómica, por misión. */
export type ProgressOp = { missionId: string; op: "INC"; value: number; target: number } | { missionId: string; op: "STREAK_WIN" | "STREAK_RESET"; target: number };

export const ID_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;
