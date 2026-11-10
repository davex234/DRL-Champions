/**
 * CONTRATO DE SINCRONIZACIÓN PvP (Bloque 7.3).
 *
 * Define QUÉ viaja por el cable, y nada más. Es puro: no sabe si el estado llegó por polling,
 * por Realtime o por un WebSocket, y ese desconocimiento es justamente el punto — el dominio
 * no debe acoplarse al transporte.
 *
 * DOS DECISIONES QUE IMPORTAN
 *
 * 1. **La respuesta es una unión discriminada por `changed`.** Cuando no ha cambiado nada, la
 *    respuesta NO lleva estado: solo la versión, el reloj del servidor y si la partida ya es
 *    terminal. Un sondeo sin cambios es, literalmente, cuatro campos.
 *
 * 2. **El turno viaja como BANDO, no como id de usuario.** `expectedPlayer` del modelo devuelve
 *    el `uuid` del jugador que debe actuar; publicarlo tal cual entregaría al rival un
 *    identificador interno de otra persona a cambio de nada. Aquí se traduce a `expectedSide`
 *    (`"A"`/`"B"`) y a `isYourTurn`, que es lo único que la pantalla necesita.
 *
 * El objeto se construye CAMPO A CAMPO. No se serializa la fila ni se filtra con una lista
 * negra: lo que no está escrito aquí, no sale.
 */
import type { Side } from "../match";
import { isTerminal, lifecycleOf } from "./lifecycle";
import { expectedPlayer, sideForPlayer } from "./authority";
import { projectMatchFor, type ProjectedDuelMatch } from "./projection";
import type { CountryOf, HintVisual } from "../hints";
import type { PvpLifecycle, PvpMatchRecord, PvpPlayableMode } from "./types";

/** Versión del contrato de sincronización. El cliente puede negarse a hablar con otra. */
export const PVP_SYNC_VERSION = 1;

/**
 * El estado de UNA partida, ya proyectado para UN jugador. Todo lo que hay aquí es visible
 * para quien lo recibe; no hay ningún campo que haya que ocultar después.
 */
export interface PvpMatchSnapshot {
  matchId: string;
  /**
   * `PVP` ranked · `PVP_PRIVATE` duelo privado sin rating (FASE 29). Lo dice el servidor.
   * Opcional por compatibilidad con snapshots anteriores a la fase: ausente = `PVP`.
   */
  mode?: PvpPlayableMode;
  lifecycle: PvpLifecycle;
  stateVersion: number;
  /** Bando del receptor. Lo dice el servidor. */
  yourSide: Side;
  /** Bando que debe actuar, o `null` si no le toca a nadie. NUNCA un id de usuario. */
  expectedSide: Side | null;
  /** Comodidad para la pantalla. Sigue siendo presentación: la autoridad es el servidor. */
  isYourTurn: boolean;
  /**
   * Quién cerró la partida (abandono o tiempo), como BANDO, nunca como id (FASE 29). Permite al
   * duelo privado —que no tiene asiento de rating— nombrar VICTORIA/DERROTA sin adivinar.
   * Opcional por compatibilidad: ausente = no cerrada por nadie.
   */
  closedBySide?: Side | null;
  /** Estado de juego YA REDACTADO por `projectMatchFor` (con las pistas F71 de las cartas ocultas del rival). */
  match: ProjectedDuelMatch;
  turnStartedAt: number | null;
  turnDeadlineAt: number | null;
}

/**
 * Respuesta de sincronización.
 *
 * `serverNow` viaja SIEMPRE, incluso sin cambios, porque es lo que permite al cliente estimar
 * su desfase de reloj y pintar una cuenta atrás estable. Es **solo presentación**: quien decide
 * si un turno ha vencido es el servidor, nunca el cliente.
 */
export type PvpSyncResponse =
  | {
      changed: false;
      stateVersion: number;
      serverNow: number;
      terminal: boolean;
    }
  | {
      changed: true;
      stateVersion: number;
      serverNow: number;
      terminal: boolean;
      snapshot: PvpMatchSnapshot;
    };

/**
 * Construye el snapshot de un jugador a partir del registro autoritativo.
 *
 * Devuelve `null` si el usuario no juega esta partida: quien no es de la partida no recibe
 * snapshot, y el llamante decide qué contar (un 404, para no crear un oráculo de existencia).
 */
export function buildSnapshot(rec: PvpMatchRecord, playerId: string, countryOf?: CountryOf, visual?: HintVisual): PvpMatchSnapshot | null {
  const side = sideForPlayer(rec, playerId);
  if (side === null) return null;

  // `expectedPlayer` es un id de usuario; se traduce a bando y NO se publica.
  const expected = expectedPlayer(rec);
  const expectedSide: Side | null =
    expected === null ? null : expected === rec.playerAId ? "A" : "B";

  return {
    matchId: rec.id,
    mode: rec.mode === "PVP_PRIVATE" ? "PVP_PRIVATE" : "PVP",
    lifecycle: lifecycleOf(rec),
    stateVersion: rec.stateVersion,
    yourSide: side,
    expectedSide,
    isYourTurn: expectedSide === side,
    closedBySide: rec.closedBy === null ? null : rec.closedBy === rec.playerAId ? "A" : "B",
    match: projectMatchFor(rec.match, side, countryOf, visual),
    turnStartedAt: rec.turnStartedAt,
    turnDeadlineAt: rec.turnDeadlineAt,
  };
}

/** ¿Debe el cliente dejar de sondear? Terminal = no habrá más cambios. */
export const isTerminalLifecycle = (l: PvpLifecycle): boolean => isTerminal(l);

/** Respuesta «no ha cambiado nada». Cuatro campos: es el caso que debe ser barato. */
export const unchanged = (stateVersion: number, serverNow: number, terminal: boolean): PvpSyncResponse =>
  ({ changed: false, stateVersion, serverNow, terminal });

/** Respuesta con estado nuevo. */
export const changed = (snapshot: PvpMatchSnapshot, serverNow: number): PvpSyncResponse =>
  ({
    changed: true,
    stateVersion: snapshot.stateVersion,
    serverNow,
    terminal: isTerminal(snapshot.lifecycle),
    snapshot,
  });
