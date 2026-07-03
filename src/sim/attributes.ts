/**
 * Atributos del Vertical Slice (solo 4) + roles + curvas de conversión.
 * Todo PURO y tuneable desde un único sitio.
 *
 * NOTA: los equipos ya NO se hardcodean aquí. Los rosters reales nacen de la
 * colección del usuario vía el Player Mapper (`src/lib/match/playerMapper.ts`).
 * Un roster de demostración (solo para tests/scripts) vive en `mapping/demoRoster.ts`.
 */
import type { Identity } from "./identity/traits";

export interface Attributes {
  /** Puntería: gana duelos igualados. */
  aim: number;
  /** Lectura de juego: consigue duelos favorables, reacciona antes. */
  gameSense: number;
  /** Utilidad: calidad de flashes/humos (ventaja de entrada/retake). */
  utility: number;
  /** Liderazgo: timing de decisiones de equipo cuando el coach calla (IGL). */
  leadership: number;
}

export type Role = "entry" | "igl" | "lurk" | "anchor" | "support";

// --- Curvas de conversión (atributo 0..99 → efecto de juego) ---

/** Factor de letalidad por tick a partir del aim (≈0.5 .. 1.4). */
export const aimFactor = (aim: number): number => 0.5 + (clamp(aim) / 99) * 0.9;

/** Ticks de reacción para abrir fuego (mejor gameSense = reacciona antes, 0..8). */
export const peekDelayTicks = (gameSense: number): number => Math.round((1 - clamp(gameSense) / 99) * 8);

/** Duración de ceguera por flash recibido, en ticks (según utility del lanzador, 0..30). */
export const flashBlindTicks = (utility: number): number => Math.round((clamp(utility) / 99) * 30);

/** Retardo del IGL para transicionar de fase si el coach no interviene (0..50 ticks). */
export const iglLatencyTicks = (leadership: number): number => Math.round((1 - clamp(leadership) / 99) * 50);

function clamp(n: number): number {
  return Math.max(0, Math.min(99, n));
}

export function ovr(a: Attributes): number {
  return Math.round((a.aim * 0.35 + a.gameSense * 0.3 + a.utility * 0.2 + a.leadership * 0.15));
}

// --- Roster del motor (lo construye el Player Mapper a partir de cartas) ---

/**
 * Identidad de CARTA que viaja con cada jugador hacia la retransmisión.
 * El motor NO la usa para simular (eso son `attrs`/`identity`): existe para que
 * Broadcast/Visualizer puedan mostrar foto, equipo, rareza… SIN inventar datos.
 */
export interface SimPlayerMeta {
  /** Instancia poseída (OwnedCard.uid). */
  cardUid: string;
  /** CardDef.id (`${playerId}__${variantId}`). */
  cardId: string;
  /** Jugador real (Player.id). */
  playerId: string;
  /** Nombre completo del equipo real de la carta. */
  team: string;
  teamTag: string;
  region: string;
  country: string;
  variantId: string;
  variantLabel: string;
  ovr: number;
  serial?: number;
  /** Ruta de la foto del jugador (ya resuelta). */
  image: string;
}

/**
 * Equipamiento de un jugador que la simulación RECIBE (no sabe cómo se compró).
 * Lo produce la Buy Phase. La simulación de esta fase no modela armas en el combate;
 * el loadout viaja con el jugador, disponible para fases futuras y para broadcast.
 */
export interface SimLoadout {
  /** Arma principal (id de catálogo) o null. */
  primary: string | null;
  /** Arma secundaria (id de catálogo; por defecto la pistola gratis). */
  sidearm: string;
  armor: "none" | "light" | "heavy";
  /** Cargas de utilidad (abstracto; sin mecánica de habilidades). */
  utility: number;
  /** Poder de fuego agregado (0..~100). */
  firepower: number;
  /** Valor económico del equipamiento. */
  econValue: number;
  /** Tipo de compra (etiqueta). */
  buy: string;
}

/**
 * Entrada de roster: el "plano" de un jugador para el motor. Es la ÚNICA forma
 * en la que un jugador entra a la simulación; `makePlayer` lo instancia como
 * `SimPlayer` (posiciones + estado mental). El Player Mapper produce estos planos
 * a partir de cartas reales; nada en el juego real los escribe a mano.
 */
export interface RosterEntry {
  name: string;
  role: Role;
  attrs: Attributes;
  /** ADN de personalidad. Si se omite, el motor usa una identidad neutra. */
  identity?: Identity;
  /** Identidad de carta para la retransmisión (opcional; presente en el juego real). */
  meta?: SimPlayerMeta;
}
