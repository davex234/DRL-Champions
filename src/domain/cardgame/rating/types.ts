/**
 * RATING PvP DE DUELOS — vocabulario y política (Bloque 7.4.1).
 *
 * Este módulo NO calcula ratings y NO los guarda. El cálculo y la liquidación viven en
 * PostgreSQL (migración 0033) porque liquidar es «leer dos ratings + escribir dos filas de libro
 * + actualizar dos ratings» de forma indivisible, y el cliente de Supabase no sabe abrir
 * transacciones de varias sentencias. Aquí están los NOMBRES y la POLÍTICA escrita.
 *
 * ───────────────────────── QUÉ ES Y QUÉ NO ES ESTE RATING ─────────────────────────
 *
 *   ES:    el Elo de los DUELOS DE CARTAS entre dos personas.
 *   NO ES: `profiles.points` (Pick'ems), ni XP, ni créditos, ni el Elo competitivo del juego
 *          táctico 5v5 de `src/competitive/` (congelado y en memoria), ni `team_ratings`
 *          (equipos de esports reales).
 *
 * No hay ningún alias, wrapper ni vista que junte dos de esas cosas, a propósito.
 *
 * ───────────────────────── SOBRE LAS CONSTANTES DE ABAJO ─────────────────────────
 *
 * Son un ESPEJO de las que gobiernan de verdad, que están en SQL. Se declaran aquí para que el
 * servidor y una futura pantalla puedan hablar de la política sin consultar la base de datos.
 *
 * El riesgo evidente de un espejo es que derive. No se cierra con un comentario: el verificador
 * `pvp-rating:verify` compara CADA una de estas constantes contra el valor que devuelve la
 * función SQL correspondiente. Si alguien cambia una de las dos, el verify rompe.
 */

/** Resultado competitivo de una partida para UN jugador. */
export type RatingResult = "WIN" | "LOSS" | "DRAW";

/** El rating de un jugador, tal y como se persiste. */
export interface DuelRating {
  rating: number;
  gamesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  /**
   * DERIVADO de `gamesPlayed`, no guardado: un segundo sitio donde vive el mismo hecho es un
   * segundo sitio donde puede desincronizarse.
   */
  provisional: boolean;
  updatedAt: number;
}

/** Un movimiento del libro. Explica de dónde salió un rating; no lo sustituye. */
export interface RatingEvent {
  matchId: string;
  oldRating: number;
  delta: number;
  newRating: number;
  /** Contexto que hace el `delta` REPRODUCIBLE sin volver a mirar la partida. */
  opponentRating: number;
  kFactor: number;
  result: RatingResult;
  createdAt: number;
}

/** Códigos de `duel_pvp_settle_match`. Identificadores, nunca texto de interfaz. */
export type SettleCode =
  /** Se aplicó: dos movimientos escritos, dos ratings actualizados. */
  | "SETTLED"
  /** Ya se había aplicado. NO es un error: es la idempotencia funcionando. */
  | "ALREADY_SETTLED"
  /** La partida no existe. */
  | "NO_MATCH"
  /** No es una partida PvP entre dos personas. */
  | "NOT_PVP"
  /** Sigue en juego, o terminó sin un resultado que signifique algo. */
  | "NOT_FINISHED"
  /** Se cerró una partida que no había empezado: no da victoria a nadie. */
  | "NOT_COMPETITIVE"
  /**
   * Hay un cierre (abandono o vencimiento de turno) pero no consta quién perdió, o quien consta
   * no es de los dos jugadores. No se liquida a ciegas.
   *
   * Desde el bloque 7.4.3 cubre las dos causas: el abandono escribe `closed_by` con quien pulsó
   * el botón y el barrido del reloj lo escribe con quien debía mover. Sin ese dato no hay a quién
   * cargarle la derrota.
   */
  | "NO_ABANDONER";

// ───────────────────────────── POLÍTICA (espejo de SQL) ─────────────────────────────

/**
 * Rating inicial: **1000**, y no 1500.
 *
 *   1. Porque `src/competitive/` y `team_ratings` arrancan en 1500: si este también lo hiciera,
 *      un 1500 suelto en un log no diría de qué sistema es. La separación se ve en el dato.
 *   2. Porque deja recorrido real por debajo antes del suelo (0).
 *
 * El valor absoluto de un Elo es arbitrario —lo que significa algo son las diferencias—, así que
 * la elección se justifica por legibilidad, no por «calidad» del número.
 */
export const INITIAL_RATING = 1000;

/** Límites duros de la columna. Fuera de aquí es un error de cálculo, no un jugador excepcional. */
export const MIN_RATING = 0;
export const MAX_RATING = 5000;

/** Partidas antes de dejar de ser provisional. */
export const PLACEMENT_GAMES = 10;

/** K alto mientras el sistema no sabe nada del jugador: converge rápido. */
export const K_PROVISIONAL = 40;
/** K asentado: una mala tarde no borra veinte partidas. */
export const K_ESTABLISHED = 24;

export const kFactorFor = (gamesPlayed: number): number =>
  gamesPlayed < PLACEMENT_GAMES ? K_PROVISIONAL : K_ESTABLISHED;

export const isProvisional = (gamesPlayed: number): boolean => gamesPlayed < PLACEMENT_GAMES;

/**
 * Ventana de emparejamiento por tiempo en cola, en puntos de rating.
 *
 * CALIBRADA PARA LA POBLACIÓN QUE HAY, que es casi ninguna. Una ventana estrecha y perpetua, con
 * dos jugadores conectados, no produce partidas justas: produce cero partidas.
 *
 * Los porcentajes son la probabilidad del favorito según el propio Elo, no una intuición:
 *
 *   0–15 s   ±150   favorito ~70%
 *   15–45 s  ±300   ~85%
 *   45–90 s  ±600   ~97%
 *   90 s+    libre  pasado minuto y medio, cualquier rival es mejor que ninguno
 *
 * Y es solo la mitad de la política: la ventana dice qué es ACEPTABLE, mientras que el
 * emparejador elige siempre al candidato con la MENOR diferencia dentro de ella. Que la ventana
 * llegue a ±600 no significa emparejar a ±600 habiendo alguien a ±20.
 */
export const RATING_WINDOW_STEPS: readonly { untilSeconds: number; window: number }[] = [
  { untilSeconds: 15, window: 150 },
  { untilSeconds: 45, window: 300 },
  { untilSeconds: 90, window: 600 },
  { untilSeconds: Number.POSITIVE_INFINITY, window: 100_000 },
];

export function ratingWindowFor(waitSeconds: number): number {
  for (const step of RATING_WINDOW_STEPS) {
    if (waitSeconds < step.untilSeconds) return step.window;
  }
  return RATING_WINDOW_STEPS[RATING_WINDOW_STEPS.length - 1].window;
}
