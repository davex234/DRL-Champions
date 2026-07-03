/**
 * REPLAY — tipos (Online Fase 5/7).
 *
 * Un Replay es la grabación COMPACTA y DETERMINISTA de una partida: `MatchConfig` (seed) +
 * `InputLog` (comandos temporizados) + metadatos + checksum. NO duplica snapshots: el input log
 * es incremental y reconstruye el partido byte a byte con el ÚNICO Gameplay (`reconstruct`/`tick`).
 * Spectator y Replay consumen EXACTAMENTE los mismos datos (el stream de `RoundState`). PLANO.
 */
import type { MatchConfig } from "@/match";
import type { InputLog } from "@/online";

export const REPLAY_VERSION = 2; // v2: añade stateChecksum (validación del estado reconstruido)
export const MIN_REPLAY_VERSION = 1;

export interface ReplayPlayerMeta { id: string; name: string; side: "home" | "away" }

export interface ReplayMeta {
  matchId: string;
  mode: string;
  region: string;
  players: ReplayPlayerMeta[];
  teamNames: { home: string; away: string };
  createdAt: number;
  durationTicks: number;
  rounds: number;
  score: { home: number; away: number };
  winner: "home" | "away" | null;
}

export interface Bookmark { id: string; round: number; tick: number; label: string; at: number }

/** Grabación completa (persistible / compartible). */
export interface Replay {
  version: number;
  build: string;        // FULL_VERSION (compat de versión)
  meta: ReplayMeta;
  config: MatchConfig;
  log: InputLog;        // seed + comandos = la grabación (incremental, sin duplicar snapshots)
  checksum: number;     // integridad de INPUTS (FNV sobre config.seed + comandos)
  /** Checksum del ESTADO final reconstruido (v2+). Detecta divergencia de reconstrucción
   *  (build/motor distinto que reconstruye un partido diferente). Opcional en replays v1. */
  stateChecksum?: number;
  bookmarks: Bookmark[];
}

/** Posición en el replay (ronda + tick de esa ronda). */
export interface ReplayPosition { round: number; tick: number }

/** Límites de una ronda dentro del replay (para la timeline / seek). */
export interface RoundBoundary { round: number; seed: number; ticks: number; winner: "ATK" | "DEF" | null; endReason: string | null }
