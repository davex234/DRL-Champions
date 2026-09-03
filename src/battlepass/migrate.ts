/**
 * MIGRACIÓN DEL PASS STATE (Collection Fase 6/7).
 *
 * Normaliza un estado antiguo/corrupto sin romper ni perder progreso: sanea arrays/números, mantiene el
 * archivo (historial) y fija la versión. Determinista.
 */
import { freshPassState } from "./season";
import { BP_SCHEMA_VERSION, type PassState, type ActiveMission, type ArchivedSeason } from "./types";

const numArr = (v: unknown): number[] => (Array.isArray(v) ? v.filter((x): x is number => typeof x === "number" && x >= 0) : []);

export function migratePassState(raw: unknown, fallbackSeasonId: string): PassState {
  if (!raw || typeof raw !== "object") return freshPassState(fallbackSeasonId);
  const r = raw as Partial<PassState>;
  const missions: ActiveMission[] = Array.isArray(r.missions)
    ? r.missions.filter((m): m is ActiveMission => !!m && typeof m.id === "string" && typeof m.metric === "string" && typeof m.goal === "number")
    : [];
  const archive: ArchivedSeason[] = Array.isArray(r.archive) ? r.archive.filter((a): a is ArchivedSeason => !!a && typeof a.seasonId === "string") : [];
  return {
    version: BP_SCHEMA_VERSION,
    seasonId: typeof r.seasonId === "string" ? r.seasonId : fallbackSeasonId,
    xp: typeof r.xp === "number" && r.xp >= 0 ? Math.floor(r.xp) : 0,
    premium: !!r.premium,
    boost: typeof r.boost === "number" && r.boost > 0 ? r.boost : 1,
    autoClaim: !!r.autoClaim,
    claimedFree: [...new Set(numArr(r.claimedFree))],
    // Un estado anterior a la Fase 9E no conoce el carril competitivo: entra vacío y
    // cerrado, que es exactamente el punto de partida de quien nunca lo ha abierto.
    claimedCompetitive: [...new Set(numArr(r.claimedCompetitive))],
    competitiveUnlocked: !!r.competitiveUnlocked,
    claimedPremium: [...new Set(numArr(r.claimedPremium))],
    missions,
    missionsCompleted: typeof r.missionsCompleted === "number" && r.missionsCompleted >= 0 ? Math.floor(r.missionsCompleted) : 0,
    archive,
  };
}
