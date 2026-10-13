/**
 * NEXUS ARENA SYSTEM — Fase 50 (Match Board 4.0).
 *
 * El recinto en el que se juega una partida deja de estar escrito a mano dentro del tablero: es
 * una CONFIGURACIÓN. Cada arena declara su nombre, su fondo, los acentos de los dos bandos y qué
 * efectos de ambiente enciende; el tablero y el recinto (`ArenaEnvironment`) solo la LEEN.
 *
 * Hoy existe UNA arena —NEXUS CHAMPIONS—, pero la forma está pensada para las siguientes
 * (NEXUS MASTERS, WORLD FINALS, NIGHT ARENA, NEON TOKYO…): añadir una es añadir una entrada a
 * `ARENAS` y sus imágenes bajo `public/game/arenas/<id>/`, sin tocar el tablero.
 *
 * ────────────────────────── QUÉ NO HACE ──────────────────────────
 *
 * Nada de juego. Una arena no cambia reglas, recompensas, dificultad ni el orden de los turnos:
 * es fondo, luz y marca. Por eso este módulo no importa el motor ni el servidor, y la elección de
 * arena depende solo del MODO de presentación, que ya decide la página.
 *
 * Identidad propia: ni imágenes ni logos de terceros. Los fondos se generaron en local para
 * NEXUS (Z-Image-Turbo, licencia Apache-2.0) y el nombre de cada recinto es de la casa.
 */

/** Identificadores de arena. Una entrada nueva aquí exige su entrada en `ARENAS`. */
export type ArenaId = "nexus-champions";

/** Modo de presentación de la partida: el mismo vocabulario que ya usa el tablero. */
export type ArenaMode = "quick" | "ranked" | "campaign" | "draft";

/** Efectos de ambiente que el recinto puede encender. Todos son CSS y se apagan con movimiento reducido. */
export interface ArenaAmbient {
  /** Motas de luz flotando (número fijo en el recinto: nunca «las que hagan falta»). */
  motes: boolean;
  /** Haces de foco que barren despacio desde el techo. */
  beams: boolean;
  /** Bruma baja que deriva sobre el suelo. */
  haze: boolean;
  /** Resplandor de la grada: el público late muy despacio. */
  crowd: boolean;
}

export interface ArenaTheme {
  arenaId: ArenaId;
  /** Nombre del recinto, tal y como se enseña en el HUD. */
  name: string;
  /** Lema corto de la arena (decorativo, solo en pantallas anchas). */
  tagline: string;
  /**
   * Imágenes del recinto. `wide` para escritorio, `narrow` para móvil (más ligera). Rutas públicas
   * servidas tal cual; son WebP.
   */
  background: { wide: string; narrow: string };
  /** Acento del jugador (abajo): cian. */
  accentPlayer: string;
  /** Acento del rival (arriba): rojo/magenta. */
  accentOpponent: string;
  ambient: ArenaAmbient;
  /** Marca opcional del recinto. Texto propio, sin logos de terceros. */
  branding?: { wordmark: string; sub: string };
}

/** Acentos de bando de NEXUS ARENA. El tablero entero los usa: aquí, y en ningún otro sitio. */
export const ARENA_ACCENT = {
  player: "#2fe0ff",
  opponent: "#ff2e63",
  draw: "#ffd35c",
} as const;

export const ARENAS: Record<ArenaId, ArenaTheme> = {
  "nexus-champions": {
    arenaId: "nexus-champions",
    name: "NEXUS Champions",
    tagline: "Arena principal",
    background: {
      wide: "/game/arenas/nexus-champions/stage-1920.webp",
      narrow: "/game/arenas/nexus-champions/stage-960.webp",
    },
    accentPlayer: ARENA_ACCENT.player,
    accentOpponent: ARENA_ACCENT.opponent,
    ambient: { motes: true, beams: true, haze: true, crowd: true },
    branding: { wordmark: "NEXUS", sub: "DRL Cards" },
  },
};

export const DEFAULT_ARENA_ID: ArenaId = "nexus-champions";

/**
 * Qué arena se juega en cada modo. Hoy todos comparten la principal; el día que haya más, este es el
 * único sitio que decide cuál toca. El modo NO cambia la estructura del tablero, solo el recinto.
 */
const ARENA_BY_MODE: Record<ArenaMode, ArenaId> = {
  quick: DEFAULT_ARENA_ID,
  ranked: DEFAULT_ARENA_ID,
  campaign: DEFAULT_ARENA_ID,
  draft: DEFAULT_ARENA_ID,
};

export function arenaFor(mode: ArenaMode = "quick"): ArenaTheme {
  return ARENAS[ARENA_BY_MODE[mode] ?? DEFAULT_ARENA_ID];
}

/** Nombre del modo tal y como lo enseña el HUD de la partida. */
export const ARENA_MODE_LABEL: Record<ArenaMode, string> = {
  quick: "Partida rápida",
  ranked: "Competitivo",
  campaign: "Road to Champions",
  draft: "Draft Gauntlet",
};
