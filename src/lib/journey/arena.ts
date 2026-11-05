/**
 * PLAYER JOURNEY · CONTEXTO DE ARENA (Fase 40) — puro.
 *
 * `?dificultad=EASY` solo PRESELECCIONA la dificultad en la pre-partida (el jugador puede cambiarla y el servidor valida
 * como siempre). `?primera=1` solo enseña el coach del primer combate. Ninguno completa nada: la primera sesión se da por
 * completada cuando el servidor tiene una partida terminada (Daily Loop → `journey.justCompleted`).
 */
import type { BotDifficulty } from "@/domain/cardgame/opponent/types";

const LEVELS: readonly BotDifficulty[] = ["EASY", "NORMAL", "HARD"];

export function initialDifficulty(param: string | null, fallback: BotDifficulty = "NORMAL"): BotDifficulty {
  return param && (LEVELS as readonly string[]).includes(param) ? (param as BotDifficulty) : fallback;
}

export const isFirstMatchContext = (param: string | null) => param === "1";

/** ¿Debe la pantalla de resultado enseñar «Primera sesión completada»? Solo con el hecho del servidor. */
export const showFirstSessionComplete = (journey: { isComplete: boolean; justCompleted: boolean } | null | undefined) =>
  !!journey && journey.isComplete && journey.justCompleted;
