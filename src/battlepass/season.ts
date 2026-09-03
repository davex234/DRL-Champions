/**
 * TEMPORADAS (Collection Fase 6/7).
 *
 * Ciclo de vida de la temporada: estado fresco, archivo (legacy/historic) y soft-reset al avanzar.
 * Puro y determinista (reloj lógico inyectado). El historial nunca se pierde: se acumula en `archive`.
 */
import { levelProgress } from "./xp";
import { BP_SCHEMA_VERSION, type PassState, type SeasonDef, type ArchivedSeason } from "./types";

export function freshPassState(seasonId: string): PassState {
  return {
    version: BP_SCHEMA_VERSION, seasonId, xp: 0, premium: false, boost: 1, autoClaim: false,
    claimedFree: [], claimedCompetitive: [], claimedPremium: [],
    // El carril competitivo arranca cerrado: lo abre el servidor al comprobar el rango.
    competitiveUnlocked: false,
    missions: [], missionsCompleted: 0, archive: [],
  };
}

/** Instantánea archivable de la temporada actual (legacy). */
export function snapshotSeason(state: PassState, season: SeasonDef, now: number): ArchivedSeason {
  const level = levelProgress(state.xp, season).level;
  return {
    seasonId: state.seasonId, name: season.name, level, xp: state.xp,
    claimedFree: state.claimedFree.length,
    claimedCompetitive: state.claimedCompetitive.length,
    claimedPremium: state.claimedPremium.length,
    premium: state.premium, missionsCompleted: state.missionsCompleted, endedAt: now,
  };
}

/**
 * SOFT RESET al avanzar de temporada: archiva la actual y arranca fresca conservando SOLO el historial
 * (nunca se pierde progreso archivado). El premium y el nivel se reinician (nueva temporada).
 */
export function advanceToSeason(state: PassState, currentSeason: SeasonDef, nextSeasonId: string, now: number): PassState {
  const archived = snapshotSeason(state, currentSeason, now);
  return {
    ...freshPassState(nextSeasonId),
    boost: 1,
    archive: [...state.archive, archived],
  };
}
