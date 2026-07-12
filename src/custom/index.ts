// ❄️ FROZEN (Consolidation F1.1, 2026-07-06): motor completo y verificado SIN consumidores de
// producto hoy. Se conserva por valor de roadmap (wire before kill). NO crecer ni integrar
// sin decision explicita. Registro y criterios: docs/FROZEN.md
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
