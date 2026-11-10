/**
 * PVP MATCH MODEL — vocabulario (Bloque 7.2).
 *
 * Esta capa NO es un segundo motor de duelo. El motor sigue siendo `../match` y aquí no se
 * decide ni una jugada: se responde a las preguntas que el motor deliberadamente NO responde
 * porque son de IDENTIDAD y de PERSISTENCIA, no de reglas:
 *
 *   · ¿Quién es A y quién es B, en usuarios reales?   → `PvpMatchRecord`
 *   · ¿A quién le toca actuar AHORA?                  → `authority.ts` (sobre `actingSide`)
 *   · ¿Sigue viva la partida?                         → `lifecycle.ts`
 *   · ¿Esta escritura pisa a otra?                    → `state_version`
 *   · ¿Esta acción ya se aplicó?                      → `action_id`
 *   · ¿Qué puede ver cada jugador?                    → `projection.ts`
 *
 * PURO y DETERMINISTA: sin reloj propio, sin azar, sin red, sin Supabase. El tiempo entra
 * SIEMPRE por parámetro (`now`), porque la autoridad temporal es el servidor y este módulo
 * no debe poder inventarse un reloj.
 */
import type { DuelMatch, Side } from "../match";

export type { DuelMatch, Side };

/** Versión del modelo PvP persistido. Una partida guarda con qué modelo se creó. */
export const PVP_MODEL_VERSION = "duel-pvp-1";

/**
 * Modo de la partida. Es la frontera entre los dos ciclos de vida: `PVE` conserva el
 * comportamiento histórico (rival bot, abandono = borrado) y `PVP` estrena el nuevo.
 */
export type DuelMode = "PVE" | "PVP" | "PVP_PRIVATE";

/**
 * Modos con DOS personas (FASE 29). `PVP` es ranked y liquida rating; `PVP_PRIVATE` es un duelo
 * privado entre amigos: mismo motor, mismas reglas, misma arena, misma reconexión… y NINGUNA
 * liquidación. La diferencia vive en el servidor (`isSettleable`) y en el RPC de liquidación.
 */
export type PvpPlayableMode = "PVP" | "PVP_PRIVATE";

/** ¿Es una partida de dos personas (ranked o privada)? Único sitio que lo decide. */
export const isPvpLike = (mode: string | null | undefined): mode is PvpPlayableMode =>
  mode === "PVP" || mode === "PVP_PRIVATE";

/**
 * Motivo de cierre NO contemplado por las reglas del duelo.
 *
 * El motor declara explícitamente que no inventa un estado `ABANDONED` porque el documento de
 * diseño no define abandono ni rendición. Esa decisión sigue en pie: el abandono NO es una
 * regla del juego, es un hecho de la sesión. Por eso vive aquí, en la capa de persistencia,
 * y NO en `MatchStatus`.
 */
export type PvpClosedReason = "ABANDONED" | "EXPIRED";

/**
 * Ciclo de vida efectivo de una partida PvP. Se DERIVA, no se guarda: la fuente de verdad
 * sigue siendo `DuelMatch.status` (reglas) más `closedReason` (sesión). Guardarlo sería un
 * tercer sitio donde el estado puede desincronizarse.
 *
 * Sobre los estados que el encargo enumeraba y aquí NO existen:
 *   · `READY` pertenece a un ready-check, que es MATCHMAKING (fuera de este bloque).
 *   · `TURN` ya lo expresa `TurnPhase` en el motor; un segundo enum lo duplicaría.
 * `STARTED` y `TURN` colapsan en `IN_TURN` por esa razón.
 */
export type PvpLifecycle =
  | "CREATED"
  | "IN_TURN"
  | "FINISHED"
  | "ABANDONED"
  | "EXPIRED";

/**
 * La partida PvP tal y como se PERSISTE. Es la fila, no el estado de juego: `match` es el
 * `DuelMatch` del motor, intacto, y todo lo demás es identidad, concurrencia y reloj.
 */
export interface PvpMatchRecord {
  id: string;
  mode: DuelMode;

  /** Identidad de bando, decidida por el SERVIDOR. Nunca llega del cliente. */
  playerAId: string;
  playerBId: string;
  deckAId: string;
  deckBId: string;

  /** Estado de juego. Propiedad exclusiva del motor. */
  match: DuelMatch;

  /** Contador monotónico de escrituras. Protege contra dos turnos simultáneos. */
  stateVersion: number;

  closedReason: PvpClosedReason | null;
  /** Quién provocó el cierre. Necesario para acreditar al rival sin recalcular nada. */
  closedBy: string | null;
  closedAt: number | null;

  /** Reloj de turno. Autoridad del servidor; el cliente no lo escribe ni lo negocia. */
  turnStartedAt: number | null;
  turnDeadlineAt: number | null;
}

/** Una acción entrante, ya autenticada. `playerId` viene del Bearer, JAMÁS del cuerpo. */
export interface PvpActionEnvelope {
  /** Clave de idempotencia. La misma acción reenviada produce UNA sola transición. */
  actionId: string;
  /** Versión que el cliente cree estar modificando. Si no coincide, se rechaza. */
  expectedVersion: number;
  /** Usuario autenticado que la envía. */
  playerId: string;
}

/** Códigos de rechazo del modelo PvP. Identificadores, nunca texto de interfaz. */
export type PvpErrorCode =
  | "NOT_PVP"
  | "SAME_PLAYER"
  | "NOT_A_PLAYER"
  | "NOT_YOUR_TURN"
  | "MATCH_CLOSED"
  | "STALE_VERSION"
  | "TURN_EXPIRED"
  | "DECK_NOT_OWNED";

export interface PvpError {
  code: PvpErrorCode;
  /** Bando afectado, cuando aplica. */
  side?: Side;
  expectedVersion?: number;
  actualVersion?: number;
  lifecycle?: PvpLifecycle;
}

export type PvpGuard =
  | { ok: true; side: Side }
  | { ok: false; error: PvpError };
