/**
 * PLAYER PROFILE — perfil de emparejamiento (Online Fase 2/7).
 *
 * DERIVA (opcionalmente) de Career/Development/Identity o usa valores por defecto. El MMR usa la
 * base Elo REUTILIZADA (`DEFAULT_RATING`), no un sistema nuevo. PURO. Determinista.
 */
import { DEFAULT_RATING } from "@/domain/esports/predict/elo";
import type { Region } from "@/domain/cards/types";
import type { PlayerProfile, SimRole } from "./types";

const ALL_ROLES: SimRole[] = ["entry", "igl", "lurk", "anchor", "support"];

export function defaultProfile(id: string, name: string, over: Partial<PlayerProfile> = {}): PlayerProfile {
  return {
    id, name, mmr: DEFAULT_RATING, skill: 50, level: 1, experience: 0,
    region: "EMEA", coachRating: 0, rolePrefs: ALL_ROLES, roster: null, partyId: null, ...over,
  };
}

/**
 * Deriva un perfil a partir de señales existentes (skill de desarrollo, coachRating de career,
 * nivel/experiencia). El MMR base = `DEFAULT_RATING` ajustado por skill/coachRating (Fase 2 NO
 * persiste ranking; el MMR es una ENTRADA al emparejamiento). Determinista.
 */
export function profileFrom(
  id: string, name: string,
  signals: { region?: Region; skill?: number; level?: number; experience?: number; coachRating?: number; rolePrefs?: SimRole[]; mmr?: number; roster?: PlayerProfile["roster"] } = {},
): PlayerProfile {
  const skill = signals.skill ?? 50;
  const coachRating = signals.coachRating ?? 0;
  const mmr = signals.mmr ?? Math.round(DEFAULT_RATING + (skill - 50) * 8 + coachRating * 4);
  return defaultProfile(id, name, { ...signals, skill, coachRating, mmr });
}

/** Rating efectivo para el balance (MMR es el eje principal, pero NUNCA el único — ver balance.ts). */
export function ratingOf(p: PlayerProfile): number { return p.mmr; }

/** Cobertura de composición de un quinteto (0..100): roles distintos cubiertos. */
export function compositionScore(roster: PlayerProfile["roster"]): number {
  if (!roster || roster.length === 0) return 50;
  const roles = new Set(roster.map((r) => r.role));
  return Math.round((roles.size / 5) * 100);
}
