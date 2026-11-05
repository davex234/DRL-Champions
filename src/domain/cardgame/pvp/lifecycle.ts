/**
 * CICLO DE VIDA PvP (Bloque 7.2).
 *
 * REGLA DE DISEÑO: aquí NO se declara un segundo enum de estado de partida. `MatchStatus`
 * (WAITING · IN_PROGRESS · COMPLETED · DRAW · UNRESOLVED) sigue siendo la ÚNICA fuente de
 * verdad sobre las reglas, y este módulo solo la COMPONE con el único hecho que las reglas
 * no contemplan: que una sesión se cierre sin haberse jugado (abandono o expiración).
 *
 *   MatchStatus (reglas)  +  closedReason (sesión)  ⇒  PvpLifecycle (efectivo)
 *
 * El cierre GANA siempre. Una partida abandonada en el turno 4 sigue teniendo
 * `status: IN_PROGRESS` en su estado de juego —eso es cierto y no se falsea— pero su ciclo
 * de vida efectivo es `ABANDONED` y no acepta ni una acción más.
 */
import type { DuelMatch, MatchStatus } from "../match";
import type { PvpClosedReason, PvpLifecycle, PvpMatchRecord } from "./types";

/**
 * Ciclo de vida efectivo. Deriva; no se guarda.
 *
 * El orden de comprobación es deliberado: el cierre de sesión tiene prioridad sobre el estado
 * de reglas, porque una partida se puede abandonar en cualquier momento y el motor no se
 * entera (ni debe).
 */
export function pvpLifecycle(match: DuelMatch, closedReason: PvpClosedReason | null): PvpLifecycle {
  return lifecycleFromStatus(match.status, closedReason);
}

/**
 * F76 · LA MISMA derivación a partir de las dos COLUMNAS de `duel_matches` (`status`, `closed_reason`), sin cargar el
 * estado de juego. `status` se escribe con `state.status` en cada transición (creación, acción, barrido), así que es
 * el mismo dato. La usa la cola ranked para decidir si una entrada MATCHED apunta a una partida VIVA.
 *
 * Es también la regla de la guarda SQL `_duel_pvp_has_active_match` (0048): viva ⇔ `status IN (WAITING, IN_PROGRESS)`
 * y `closed_reason IS NULL` ⇔ `CREATED | IN_TURN` ⇔ `!isTerminal`. Un `closed_reason` desconocido no reabre nada: cuenta
 * como cerrada.
 */
export function lifecycleFromStatus(status: MatchStatus | string, closedReason: string | null | undefined): PvpLifecycle {
  if (closedReason === "ABANDONED") return "ABANDONED";
  if (closedReason === "EXPIRED") return "EXPIRED";
  if (closedReason !== null && closedReason !== undefined) return "ABANDONED";
  switch (status) {
    case "WAITING": return "CREATED";
    case "IN_PROGRESS": return "IN_TURN";
    // COMPLETED, DRAW y UNRESOLVED son las TRES formas de terminar por reglas. Un empate no
    // es un fallo y `UNRESOLVED` es histórico, pero las tres son igual de terminales.
    default: return "FINISHED";
  }
}

/** Atajo sobre el registro completo. */
export const lifecycleOf = (rec: PvpMatchRecord): PvpLifecycle =>
  pvpLifecycle(rec.match, rec.closedReason);

/** Estados de los que ya no se sale. Ninguna acción los modifica. */
const TERMINAL: ReadonlySet<PvpLifecycle> = new Set<PvpLifecycle>(["FINISHED", "ABANDONED", "EXPIRED"]);

export const isTerminal = (l: PvpLifecycle): boolean => TERMINAL.has(l);

/**
 * ¿Acepta acciones de jugador este ciclo de vida?
 *
 * Solo `IN_TURN`. `CREATED` tampoco: una partida que no ha empezado no tiene turno que jugar,
 * y dejarla actuar sería exactamente el agujero que `WRONG_PHASE` cierra en el motor.
 */
export const acceptsActions = (l: PvpLifecycle): boolean => l === "IN_TURN";

/**
 * Transiciones permitidas. Se declara la tabla COMPLETA en vez de deducirla: una máquina de
 * estados que se deduce es una máquina de estados que nadie puede auditar.
 */
const TRANSITIONS: Readonly<Record<PvpLifecycle, readonly PvpLifecycle[]>> = {
  CREATED: ["IN_TURN", "ABANDONED", "EXPIRED"],
  IN_TURN: ["IN_TURN", "FINISHED", "ABANDONED", "EXPIRED"],
  FINISHED: [],
  ABANDONED: [],
  EXPIRED: [],
};

/** ¿Es legal pasar de `from` a `to`? `FINISHED → IN_TURN` nunca lo es. */
export const canTransition = (from: PvpLifecycle, to: PvpLifecycle): boolean =>
  TRANSITIONS[from].includes(to);

/** Estados alcanzables desde uno dado. Expuesto para que los tests no repitan la tabla. */
export const transitionsFrom = (from: PvpLifecycle): readonly PvpLifecycle[] => TRANSITIONS[from];
