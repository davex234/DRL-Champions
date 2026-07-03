/**
 * PERSONAS — ProCoach (coach profesional, ausente en `domain/esports`) y el historial de plantilla
 * (Roster/RosterChange), que cablea el tipo huérfano `RosterChangeRow` de Supabase.
 * Distinto del `Coach` de `career/types.ts` (ese es el avatar del USUARIO).
 */
export type ProCoachStatus = "active" | "inactive" | "retired";

export interface ProCoach {
  id: string;
  name: string;
  fullName?: string;
  teamId?: string;
  region?: string;
  country?: string;
  status: ProCoachStatus;
}

/** Un movimiento de plantilla (alta/baja). Fechas en epoch ms (parseadas por el importer). */
export interface RosterChange {
  id: string;
  teamId: string;
  playerId: string;
  role?: string;
  joinedAt?: number;
  leftAt?: number;
  isActive: boolean;
}

/** Plantilla de un equipo: activos + coach + historial completo de cambios. */
export interface Roster {
  teamId: string;
  playerIds: string[];
  coachId?: string;
  changes: RosterChange[];
}
