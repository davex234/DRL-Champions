/**
 * DRAFT GAUNTLET · REGLAS (Fase 39) — «CONSTRUYE. ADÁPTATE. SOBREVIVE.»
 *
 * Modo PvE nuevo: el jugador entra SIN su equipo, el servidor crea una RUN, ofrece 10 elecciones de 3 cartas REALES
 * del catálogo (una por rol requerido, en un orden determinista con exactamente 2 de cada rol) y, con la plantilla
 * legal de 10, se juegan 5 combates consecutivos contra los bots canónicos con el MOTOR canónico (duel-turns-2 /
 * duel-combat-2). Ganar avanza; perder o empatar termina la run. Las cartas del draft NO son propiedad: no entran en
 * `user_cards` ni tienen serial. F72: entrada en créditos y recompensa por victorias → `./economy` (0 XP, 0 rating).
 */
import type { BotDifficulty } from "@/domain/cardgame/opponent/types";

export const DRAFT_MODE_NAME = "DRAFT GAUNTLET";
export const DRAFT_MODE_TAGLINE = "Construye. Adáptate. Sobrevive.";
export const DRAFT_ROUTE = "/jugar/draft-gauntlet";
/** La arena canónica, en contexto de draft: el combate activo se recupera desde la run, nunca desde la partida rápida. */
export const DRAFT_MATCH_HREF = "/duelos/jugar?draft=1";

/** Versión de las reglas del modo guardada con cada run: una run activa se resuelve con SUS reglas. */
export const DRAFT_RULES_VERSION = "draft-gauntlet-1";
/** Valor de `duel_matches.mode` para los combates del modo (0053). Aísla rating, campaña, recompensas y contadores. */
export const DRAFT_MATCH_MODE = "DRAFT_GAUNTLET";

export const DRAFT_PICKS = 10;
export const DRAFT_OPTIONS = 3;
export const GAUNTLET_STAGES = 5;

/** Bots canónicos por combate (mismos coeficientes 0 / 0,5 / 0,85 de `opponent/bots`). */
export const STAGE_DIFFICULTY: readonly BotDifficulty[] = ["EASY", "NORMAL", "NORMAL", "HARD", "HARD"];
export const STAGE_LABEL: readonly string[] = ["01", "02", "03", "04", "FINAL"];

/** Rivales originales NEXUS (no se presentan como equipos reales de esports). */
export const RIVAL_NAMES: readonly string[] = ["NEXUS Challenger", "NEXUS Contender", "NEXUS Vanguard", "NEXUS Elite", "NEXUS Apex"];

/**
 * Banda de OVR (percentiles del pool de cada rol) de la que salen las cartas REALES del rival de cada combate.
 * No toca stats: solo decide QUÉ cartas trae el rival. Combates tempranos con cartas más modestas; la final, arriba.
 */
export const STAGE_OVR_BAND: readonly (readonly [number, number])[] = [[0, 0.6], [0.2, 0.8], [0.2, 0.8], [0.4, 1], [0.5, 1]];

export type DraftRunStatus = "DRAFTING" | "READY" | "IN_MATCH" | "COMPLETED" | "FAILED" | "ABANDONED";
export const DRAFT_STATUSES: readonly DraftRunStatus[] = ["DRAFTING", "READY", "IN_MATCH", "COMPLETED", "FAILED", "ABANDONED"];
export const ACTIVE_STATUSES: readonly DraftRunStatus[] = ["DRAFTING", "READY", "IN_MATCH"];
export const FINAL_STATUSES: readonly DraftRunStatus[] = ["COMPLETED", "FAILED", "ABANDONED"];
export const isActiveStatus = (s: string): s is DraftRunStatus => (ACTIVE_STATUSES as readonly string[]).includes(s);

export type StageOutcome = "WIN" | "LOSS" | "DRAW";

/** Tamaño del registro de acciones idempotentes guardado en la run (acotado). */
export const MAX_ACTION_LOG = 40;
/** Historial mínimo de runs terminadas que devuelve la lectura. */
export const HISTORY_LIMIT = 5;

