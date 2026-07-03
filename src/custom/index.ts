/**
 * CUSTOM GAME ENGINE — API pública (Online Fase 5/7).
 *
 * Partidas privadas: private/password/open · slots player/observer/coach/referee · ready check ·
 * team switch · side swap · kick · bot replace · settings · pausa/resume/restart (host/árbitro).
 * PRODUCE una `MatchConfig` del ÚNICO Online Core (reutiliza makeMatchConfig + buildRivalRoster).
 * NO crea otro Lobby/Match/Server. Determinista. Depende de match/sim/lib (nunca al revés).
 */
export * from "./types";
export { CustomGameEngine } from "./game";
