/**
 * CALENDARIO — entidades objetivas que faltaban en `domain/esports`: Season y Group.
 * Aditivas: referencian Tournament/Stage existentes, no los modifican.
 */
import type { CircuitTier } from "@/domain/esports/types";

/** Temporada competitiva (agrupa torneos). Fechas en epoch ms (parseadas por el importer). */
export interface Season {
  id: string;
  name: string;
  year: number;
  circuitId?: string;
  tier?: CircuitTier;
  startDate?: number;
  endDate?: number;
  tournamentIds: string[];
}

/** Grupo dentro de una fase (formaliza `Standing.groupLabel` / `StageKind:"group"`). */
export interface Group {
  id: string;
  stageId: string;
  label: string;
  teamIds: string[];
}
