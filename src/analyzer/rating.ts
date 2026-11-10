/**
 * ADAPTADOR DE RATING — REUTILIZA el motor de rating objetivo `@/intel/rating` (rawPerformance /
 * contextualRating), sin duplicarlo. Solo añade el mapeo puro Torneo canónico → TournamentType/Stage.
 * NO usa `ratingToOvr` ni nada de cartas.
 */
import type { TournamentType } from "@/engine/types";
import type { Tournament } from "@/importer";
import { rawPerformance, contextualRating, type PlayerPerf, type Stage } from "@/intel/rating";

/** Torneo canónico → TournamentType (peso del rating). Puro y determinista. */
export function tournamentType(t: Tournament): TournamentType {
  const s = `${t.tier ?? ""} ${t.type ?? ""} ${t.name ?? ""}`.toLowerCase();
  if (s.includes("champions")) return "champions";
  if (s.includes("ewc")) return "ewc";
  if (s.includes("masters") || t.tier === "vct-international") return "masters";
  if (t.tier === "game-changers" || s.includes("game changers")) return "game-changers";
  if (t.tier === "ascension") return "ascension";
  if (t.tier === "challengers" || s.includes("regional")) return "regional";
  if (s.includes("off") && s.includes("season")) return "off-season";
  return "other";
}

/** Etiqueta de ronda → Stage del rating. */
export function stageFor(round?: string): Stage {
  const s = (round ?? "").toLowerCase();
  if (s.includes("final")) return "final";
  if (s.includes("playoff") || s.includes("semi") || s.includes("quarter") || s.includes("bracket") || s.includes("upper") || s.includes("lower")) return "playoffs";
  return "groups";
}

export { rawPerformance, contextualRating };
export type { PlayerPerf, Stage };
