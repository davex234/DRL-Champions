/**
 * F86.1 · CLASIFICACIÓN INEQUÍVOCA DE UNA PARTIDA (puro).
 *
 * El motor solo conoce `duel_matches.mode` (PVE · PVP · PVP_PRIVATE · DRAFT_GAUNTLET). Un cruce de torneo es, a
 * propósito, un `PVP_PRIVATE` (mismo motor, cero rating/misiones/XP/economía): lo que lo distingue de un duelo entre
 * amigos es el enlace ÚNICO `cup_matches.game_match_id` (0069). Esta función es la ÚNICA regla para decidir el tipo:
 *
 *   PVP                              → RANKED
 *   PVP_PRIVATE con enlace de torneo → TOURNAMENT
 *   PVP_PRIVATE sin enlace           → PRIVATE   (duelo amistoso F29/F85)
 *   PVE                              → PVE
 *   DRAFT_GAUNTLET                   → DRAFT
 *
 * No se crea un modo nuevo en `duel_matches`: tocarlo exigiría reescribir el CHECK de modos y una veintena de lecturas
 * del motor, y el enlace único ya es una clasificación exacta.
 */
export type DuelKind = "RANKED" | "PRIVATE" | "TOURNAMENT" | "PVE" | "DRAFT";

export function duelKind(dbMode: string, isCupGame: boolean): DuelKind | null {
  switch (dbMode) {
    case "PVP": return "RANKED";
    case "PVP_PRIVATE": return isCupGame ? "TOURNAMENT" : "PRIVATE";
    case "PVE": return "PVE";
    case "DRAFT_GAUNTLET": return "DRAFT";
    default: return null;
  }
}
