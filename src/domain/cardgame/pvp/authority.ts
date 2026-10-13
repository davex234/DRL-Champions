/**
 * AUTORIDAD DEL SERVIDOR EN PvP (Bloque 7.2).
 *
 * Responde a la única pregunta que decide si una acción entra o se rechaza:
 *
 *     ¿Puede ESTE usuario autenticado actuar en ESTA partida AHORA MISMO?
 *
 * REUTILIZACIÓN, no reimplementación: «a qué bando le toca» ya lo resuelve `actingSide()` del
 * motor de oponente, que lo deriva de `status`, `attacker` y `phase`. Aquí NO se vuelve a
 * calcular: se traduce de bando (`A`/`B`) a usuario, y se comprueba todo lo demás.
 *
 * El cliente no aporta autoridad en ningún punto: `playerId` sale del Bearer, el bando sale
 * de la fila y el turno sale del motor.
 */
import { actingSide } from "../opponent/controller";
import { acceptsActions, lifecycleOf } from "./lifecycle";
import { isPvpLike, type PvpActionEnvelope, type PvpGuard, type PvpMatchRecord, type Side } from "./types";

/**
 * Qué bando juega un usuario en una partida. `null` si no es ninguno de los dos.
 *
 * Es la traducción identidad → bando, y es la ÚNICA: nadie más debe comparar ids con bandos.
 */
export function sideForPlayer(rec: PvpMatchRecord, playerId: string): Side | null {
  if (playerId && playerId === rec.playerAId) return "A";
  if (playerId && playerId === rec.playerBId) return "B";
  return null;
}

/** Usuario que controla un bando. Inversa de `sideForPlayer`. */
export const playerForSide = (rec: PvpMatchRecord, side: Side): string =>
  side === "A" ? rec.playerAId : rec.playerBId;

/**
 * Quién tiene DERECHO a actuar ahora, como id de usuario. `null` si no le toca a nadie
 * (partida cerrada, o esperando a que el servidor confirme el turno).
 *
 * Esto es `expected_player`. Se DERIVA del estado autoritativo en cada llamada; no se guarda,
 * porque un campo guardado puede desincronizarse del motor y entonces habría dos verdades.
 */
export function expectedPlayer(rec: PvpMatchRecord): string | null {
  if (!acceptsActions(lifecycleOf(rec))) return null;
  const side = actingSide(rec.match);
  return side === null ? null : playerForSide(rec, side);
}

/** El rival de un jugador. Necesario para acreditar un abandono sin recalcular nada. */
export function opponentOf(rec: PvpMatchRecord, playerId: string): string | null {
  const side = sideForPlayer(rec, playerId);
  if (side === null) return null;
  return side === "A" ? rec.playerBId : rec.playerAId;
}

/**
 * LA PUERTA. Toda acción PvP pasa por aquí antes de tocar el motor.
 *
 * El orden de las comprobaciones importa y es de más general a más específico, para que el
 * código de rechazo sea el que de verdad explica el problema:
 *
 *   1. ¿Es una partida PvP?                → NOT_PVP
 *   2. ¿Eres uno de los dos jugadores?     → NOT_A_PLAYER   (antes que nada de turnos)
 *   3. ¿Sigue viva la partida?             → MATCH_CLOSED
 *   4. ¿Escribes sobre la versión actual?  → STALE_VERSION
 *   5. ¿Ha vencido el reloj del turno?     → TURN_EXPIRED
 *   6. ¿Te toca a TI?                      → NOT_YOUR_TURN
 *
 * `now` entra por parámetro a propósito: el reloj es del servidor y este módulo no debe poder
 * consultarlo por su cuenta.
 */
export function guardAction(rec: PvpMatchRecord, env: PvpActionEnvelope, now: number): PvpGuard {
  if (!isPvpLike(rec.mode)) return { ok: false, error: { code: "NOT_PVP" } };

  const side = sideForPlayer(rec, env.playerId);
  if (side === null) return { ok: false, error: { code: "NOT_A_PLAYER" } };

  const lifecycle = lifecycleOf(rec);
  if (!acceptsActions(lifecycle)) return { ok: false, error: { code: "MATCH_CLOSED", lifecycle } };

  if (env.expectedVersion !== rec.stateVersion) {
    return {
      ok: false,
      error: {
        code: "STALE_VERSION",
        expectedVersion: env.expectedVersion,
        actualVersion: rec.stateVersion,
      },
    };
  }

  // El reloj vence ANTES de mirar de quién es el turno: si el plazo pasó, da igual quién sea.
  if (rec.turnDeadlineAt !== null && now > rec.turnDeadlineAt) {
    return { ok: false, error: { code: "TURN_EXPIRED", side } };
  }

  const acting = actingSide(rec.match);
  if (acting === null || acting !== side) {
    return { ok: false, error: { code: "NOT_YOUR_TURN", side } };
  }

  return { ok: true, side };
}

/**
 * Siguiente versión de estado. Monotónica y de +1 en +1: dos acciones que salieron de la
 * versión 10 producen ambas la 11, y la segunda escritura no encuentra ya la 10 en la fila.
 * La exclusión REAL la impone el `UPDATE ... WHERE state_version = 10` de la persistencia;
 * esta función solo dice cuál es el número siguiente.
 */
export const nextVersion = (rec: PvpMatchRecord): number => rec.stateVersion + 1;

/** Ventana de turno del servidor. `null` cuando no hay reloj configurado. */
export function turnWindow(now: number, turnMs: number | null): { startedAt: number; deadlineAt: number | null } {
  return { startedAt: now, deadlineAt: turnMs === null ? null : now + turnMs };
}
