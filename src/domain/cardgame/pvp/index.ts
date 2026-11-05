/**
 * PVP MATCH MODEL — API pública (Bloque 7.2).
 *
 * Capa de IDENTIDAD, CONCURRENCIA, CICLO DE VIDA y SECRETO para partidas de dos personas.
 * NO contiene reglas de juego: el motor sigue siendo `../match` y no se ha tocado.
 *
 * Lo que este módulo NO hace, a propósito: matchmaking, transporte, MMR, recompensas y
 * pantallas. Ver `docs/pvp/PVP-MATCH-MODEL.md`.
 */
export * from "./types";
export { pvpLifecycle, lifecycleFromStatus, lifecycleOf, isTerminal, acceptsActions, canTransition, transitionsFrom } from "./lifecycle";
export { sideForPlayer, playerForSide, expectedPlayer, opponentOf, guardAction, nextVersion, turnWindow } from "./authority";
export { projectMatchFor, leakedUids, type ProjectedDuelMatch } from "./projection";
export {
  PVP_SYNC_VERSION, buildSnapshot, isTerminalLifecycle, unchanged, changed,
  type PvpMatchSnapshot, type PvpSyncResponse,
} from "./sync";
