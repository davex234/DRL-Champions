/**
 * ROAD TO CHAMPIONS — TIPOS DEL DOMINIO (Fase 35).
 *
 * La campaña es CONTEXTO sobre el motor PvE canónico: un nodo decide contra QUÉ equipo real, con qué
 * dificultad canónica (EASY/NORMAL/HARD) y qué calidad de cartas trae el rival. Nada de aquí toca reglas,
 * turnos, resolución ni bots: la partida la juega `domain/cardgame` exactamente igual que una rápida.
 *
 * Separación deliberada:
 *   · DEFINICIÓN (`CampaignDefinition`) → versionada, determinista, en código, cacheable.
 *   · PROGRESO (`NodeProgress`)         → por usuario, en servidor (0051, local sin aplicar), no-store.
 */
import type { BotDifficulty } from "@/domain/cardgame/opponent";
import type { Region, RoleId } from "@/domain/cards/types";

export type CampaignNodeType = "MATCH" | "ELITE" | "BOSS";

/** Dificultad de CAMPAÑA. Se traduce 1:1 a la dificultad canónica del bot (`difficulty.ts`). */
export type CampaignTier = "ROOKIE" | "PRO" | "CHAMPION";

/** Qué versión de cada jugador real trae el rival: la más baja, la mediana o la más alta del catálogo. */
export type CardTier = "BASE" | "MID" | "TOP";

export interface CampaignNodeDef {
  /** Estable entre versiones: el progreso y la clave de recompensa cuelgan de él. */
  id: string;
  chapterId: string;
  order: number;
  type: CampaignNodeType;
  name: string;
  /** Objetivo en lenguaje de jugador. Siempre «gana la partida»: no hay modificadores de reglas. */
  objective: string;
  /** Equipo REAL por su id canónico (`data/teamIdentities`). Nunca un nombre libre. */
  opponent: { teamId: string };
  difficulty: CampaignTier;
  /** Nodos que hay que COMPLETAR para que este quede disponible. Vacío = nodo de entrada. */
  requirements: { completed: string[] };
  nextNodes: string[];
  rewards: { firstClear: { credits: number } };
}

export interface CampaignChapterDef {
  id: string;
  order: number;
  name: string;
  description: string;
  /** Clave de atmósfera visual (color, partículas). Presentación pura. */
  theme: "clasificatorio" | "circuito" | "campeones";
  nodes: CampaignNodeDef[];
}

export interface CampaignDefinition {
  campaignId: string;
  version: string;
  name: string;
  tagline: string;
  chapters: CampaignChapterDef[];
}

export type CampaignOutcome = "WIN" | "LOSS" | "DRAW";
export type NodeStatus = "LOCKED" | "AVAILABLE" | "COMPLETED";

/** Progreso persistido de UN nodo para UN usuario (proyección de `campaign_progress`). */
export interface NodeProgress {
  nodeId: string;
  /** Versión de la definición con la que se escribió por última vez. */
  version: string;
  status: "ATTEMPTED" | "COMPLETED";
  bestResult: CampaignOutcome | null;
  attempts: number;
  wins: number;
  firstClearedAt: number | null;
  firstClearMatchId: string | null;
  updatedAt: number;
}

/** Carta elegida para el mazo del rival. `source` dice de dónde sale, para contarlo con honestidad. */
export interface OpponentCardPick {
  cardId: string;
  playerId: string;
  role: RoleId;
  ovr: number;
  source: "TEAM" | "REGION" | "GLOBAL";
}

export type OpponentPlan =
  | {
      ok: true;
      teamId: string;
      teamName: string;
      tag: string;
      region: Region;
      tier: CardTier;
      cards: OpponentCardPick[];
      /** Jugadores del roster actual del equipo en el mazo. */
      coreCount: number;
      sumOvr: number;
    }
  | { ok: false; teamId: string; reason: "UNKNOWN_TEAM" | "UNVERIFIED_TEAM" | "NO_CURRENT_ROSTER" | "CORE_TOO_SMALL" | "INSUFFICIENT_CARDS" };

export type { BotDifficulty };
