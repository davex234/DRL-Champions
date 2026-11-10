/**
 * LEGACY PRESENTATION & ENDGAME ENGINE — API pública (Career Fase 7/7, FINAL).
 *
 * La capa de CIERRE AAA del modo Carrera: documental, museo, Hall of Fame ampliado, estadísticas
 * históricas, récords, rueda de prensa final y New Game+. DERIVA todo de los datos REALES ya
 * persistidos (`ManagerCareer` + `WorldState` + `@/legacy`). Reutiliza Presentation/Narrative/
 * Timeline/News (buzón único). Cero motores nuevos. Determinista. Deja el modo Carrera cerrado.
 */
export * from "./types";
export { endgameStats } from "./stats";
export { careerRecords } from "./records";
export { buildMuseum } from "./museum";
export { buildDocumentary } from "./documentary";
export { pressConference } from "./press";
export { hallOfFameInduction } from "./induction";
export { newGamePlusSeed, applyNewGamePlus } from "./newgameplus";
export { buildEndgame, endgameNews, previewEndgame } from "./endgame";
