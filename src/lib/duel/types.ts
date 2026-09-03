/**
 * DUELOS — CONTRATO ENTRE SERVIDOR E INTERFAZ (Fase 8).
 *
 * Todo lo que la interfaz puede saber de un duelo está aquí, y NADA MÁS. Es deliberado: si un dato
 * no está en estos tipos, el cliente no lo recibe. En particular no existe ningún campo con las
 * cartas no jugadas del rival, ni con el estado del generador, ni con las semillas.
 *
 * Estos tipos NO son reglas: son la forma de lo que el servidor ya decidió. Las reglas viven en
 * `@/domain/cardgame` y no se duplican aquí.
 */
import type { CombatStats, CombatStatKey } from "@/domain/cards/combat";
import type { Region, RoleId, VariantId } from "@/domain/cards/types";
import type { EncounterOutcome, Side } from "@/domain/cardgame/combat";
import type { MatchStatus, TurnPhase } from "@/domain/cardgame/match";
import type { BotDifficulty } from "@/domain/cardgame/opponent";
import type { DuelDeckErrorCode, DuelDeckStatus } from "@/domain/cardgame";

export type { CombatStatKey, BotDifficulty, DuelDeckStatus, Side, EncounterOutcome, MatchStatus, TurnPhase };

/** Una carta tal y como la pinta la interfaz. Datos públicos del catálogo, ya resueltos. */
export interface DuelDeckCardDTO {
  uid: string;
  cardId: string;
  /** Identidad del jugador: permite reutilizar las capas visuales del catálogo (foto, bandera). */
  playerId: string;
  nick: string;
  team: string;
  country: string;
  role: RoleId;
  region: Region;
  variantId: VariantId;
  ovr: number;
  /** Trío de combate ya congelado. La interfaz lo MUESTRA; no lo calcula. */
  combat: CombatStats;
  serial: number | null;
}

/** Error de composición, ya explicado en servidor: la interfaz nunca traduce códigos. */
export interface DuelDeckErrorDTO {
  code: DuelDeckErrorCode;
  message: string;
}

/** Un mazo guardado, con su validación hecha contra el inventario real. */
export interface DuelDeckDTO {
  id: string;
  name: string;
  cardUids: string[];
  cards: DuelDeckCardDTO[];
  valid: boolean;
  status: DuelDeckStatus;
  roleCounts: Record<RoleId, number>;
  missingByRole: Record<RoleId, number>;
  errors: DuelDeckErrorDTO[];
  sumOvr: number;
  updatedAt: number;
}

/** Un bando dentro de un enfrentamiento ya resuelto. */
export interface DuelEncounterSideView {
  uid: string;
  nick: string;
  team: string;
  role: RoleId;
  stat: CombatStatKey;
  value: number;
}

/** Un turno YA JUGADO. Todo lo que contiene ocurrió a la vista de los dos bandos. */
export interface DuelTurnView {
  number: number;
  attacker: Side;
  outcome: EncounterOutcome;
  scoreAfterYou: number;
  scoreAfterRival: number;
  you: DuelEncounterSideView;
  rival: DuelEncounterSideView;
  reason: string;
}

/** Resultado final, tal y como lo explica el Combat Resolver. */
/**
 * Lo que una partida ha dado (Fase 10).
 *
 * Es DETERMINISTA a partir del resultado y la dificultad (`domain/progression/duelRewards`),
 * así que no se guarda en ninguna tabla: se recalcula al proyectar la vista. Lo que sí se
 * guarda es el PAGO, en el libro mayor, con la partida como clave de idempotencia.
 */
export interface DuelAwardView {
  /** Puntos competitivos: los que mueven el rango. Cero en derrota. */
  points: number;
  credits: number;
  /** XP de cuenta (nivel del perfil), no XP del pase. */
  xp: number;
}

export interface DuelResultView {
  winner: "YOU" | "RIVAL" | null;
  isDraw: boolean;
  scoreYou: number;
  scoreRival: number;
  tiedEncounters: number;
  decidedBy: "SCORE" | "OVR_TIEBREAK" | "STAT_MARGIN" | "NONE";
  reason: string;
  sumOvrYou: number | null;
  sumOvrRival: number | null;
  statTotalYou: number;
  statTotalRival: number;
  rulesVersion: string;
  /**
   * Qué ha dado esta partida. Es la respuesta a «¿para qué sirve jugar?», que hasta la
   * Fase 10 no tenía ninguna: un duelo terminaba y no pasaba nada más.
   */
  award: DuelAwardView;
}

/**
 * La partida tal y como puede verla el jugador.
 *
 * `rivalRemaining` es un NÚMERO a propósito: cuántas cartas le quedan al rival es público, cuáles
 * son no lo es.
 */
export interface DuelMatchView {
  matchId: string;
  difficulty: BotDifficulty;
  status: MatchStatus;
  phase: TurnPhase;
  turn: number;
  totalTurns: number;
  attacker: Side | null;
  youAreAttacker: boolean;
  scoreYou: number;
  scoreRival: number;
  ties: number;
  yourHand: DuelDeckCardDTO[];
  yourUsed: DuelDeckCardDTO[];
  rivalUsed: DuelDeckCardDTO[];
  rivalRemaining: number;
  yourDeckName: string;
  yourSumOvr: number;
  rivalSumOvr: number;
  /** Lo que el rival acaba de declarar, cuando ataca él. Ya está sobre la mesa. */
  pendingRival: { card: DuelDeckCardDTO; stat: CombatStatKey; value: number } | null;
  /** Estadística con la que estás obligado a responder, si defiendes. */
  requiredStat: CombatStatKey | null;
  yourDraftCardUid: string | null;
  yourDraftStat: CombatStatKey | null;
  history: DuelTurnView[];
  lastTurn: DuelTurnView | null;
  result: DuelResultView | null;
}

/** Repetición completa de una partida terminada. */
export interface DuelReplay {
  matchId: string;
  difficulty: BotDifficulty;
  rulesVersion: string;
  yourDeckName: string;
  turns: DuelTurnView[];
  result: DuelResultView | null;
  yourCards: DuelDeckCardDTO[];
  rivalCards: DuelDeckCardDTO[];
}

/** Entrada de la lista de repeticiones. */
export interface DuelReplayRow {
  matchId: string;
  difficulty: string;
  status: string;
  scoreYou: number;
  scoreRival: number;
  deckName: string;
  playedAt: number;
}

/** Descripción de cada nivel, en lenguaje de producto. Sin porcentajes internos. */
export const DIFFICULTY_INFO: Record<BotDifficulty, { label: string; tagline: string; detail: string; level: 1 | 2 | 3 }> = {
  EASY: {
    label: "Fácil",
    tagline: "Imprevisible",
    detail: "Juega de forma legal pero sin plan. Perfecto para aprender el ritmo de los diez turnos.",
    level: 1,
  },
  NORMAL: {
    label: "Normal",
    tagline: "Competitivo",
    detail: "Mezcla decisiones estratégicas con decisiones improvisadas. Se le gana, pero castiga los errores.",
    level: 2,
  },
  HARD: {
    label: "Difícil",
    tagline: "Exigente",
    detail: "Elige con criterio casi siempre: guarda cartas, responde con el margen justo y sacrifica lo que no le sirve.",
    level: 3,
  },
};

/** Presentación de las tres estadísticas. La tabla de enfrentamientos vive en el dominio. */
export const STAT_INFO: Record<CombatStatKey, { abbr: string; label: string; color: string; blurb: string }> = {
  stronghold: { abbr: "SH", label: "Stronghold", color: "#e8595b", blurb: "Aguantar la posición" },
  gamesense: { abbr: "GS", label: "Gamesense", color: "#4f9ede", blurb: "Leer el juego" },
  entryfrag: { abbr: "EF", label: "Entryfrag", color: "#4fbe78", blurb: "Abrir la ronda" },
};
