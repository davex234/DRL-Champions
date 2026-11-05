/**
 * VLR CONNECTOR — API pública (Tournament Automation · Fase 1/5).
 *
 * Primer conector oficial de fuente real: URL de torneo de vlr.gg → `RawSnapshot` OFICIAL del
 * Data Import Engine (`@/importer`). Flujo único:
 *
 *   URL → parseVlrUrl → fetch(evento/stats/partidos [+detalle por partido]) →
 *   parsers PUROS (teams/stats/matches/maps/agents) → toRawSnapshot → (Importer).
 *
 * Solo importa datos objetivos: NO calcula OVR, NO decide rarezas, NO crea cartas, NO publica.
 * La red vive únicamente detrás de `VlrFetcher` (inyectable): el resto es puro y determinista.
 */
export * from "./types";
export { parseVlrUrl, eventUrls, matchUrl, createHttpFetcher, VLR_BASE } from "./client";
export { parseEventInfo, parseEventTeams } from "./teams";
export { parseEventStats } from "./stats";
export { parseEventMatches } from "./matches";
export { parseEventBrackets, deriveBracketStructure, parseBracketStructure, type VlrBracketStructure, type VlrStructuralEdge } from "./brackets";
export { parseMatchPage, type VlrMatchDetail } from "./maps";
export { buildPlayers, buildTagToTeam, type VlrPlayerMerged } from "./players";
export { agentName, agentFromSrc } from "./agents";
export { toRawSnapshot, inferTier, inferRegion } from "./normalize";
export { importVlrTournament, vlrSnapshotToModel, createVlrProvider, parseEventLinks } from "./engine";
export {
  decodeEntities, textOf, findAll, sliceBetween, num, flagCountry,
  parseVlrDates, utcTsToIso, looseName,
} from "./parser";
