import type { PlayerSource } from "./types";
import { localSource } from "./local";
import { vlrSource } from "./vlr";

/** Registro de fuentes de datos disponibles. */
export const SOURCES: Record<string, PlayerSource> = {
  local: localSource,
  vlr: vlrSource,
};

/** Fuente activa actualmente. Cambiar aquí para usar otra importación. */
export const ACTIVE_SOURCE: PlayerSource = localSource;

export type { PlayerSource, RawPlayer } from "./types";
