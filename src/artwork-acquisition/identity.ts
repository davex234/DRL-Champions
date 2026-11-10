/**
 * IDENTITY — resolución de identidad de los sujetos: convierte lo que una generación
 * referencia (jugadores con nick, equipos con nombre, países ISO, torneo) en objetivos
 * canónicos de adquisición con sus términos de búsqueda. Determinista; jamás inventa ids:
 * usa los MISMOS del catálogo/generación.
 */
import type { CardGenerationResult } from "@/card-generator";
import type { ArtworkRefs } from "@/artwork";
import type { AcquisitionTarget } from "./types";

export const slugify = (s: string): string =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** Referencias vivas de una generación (para el manifest del Manager y los objetivos). */
export function refsOfGeneration(gen: CardGenerationResult): ArtworkRefs {
  const players = [...new Set(gen.players.filter((p) => p.playerId).map((p) => p.playerId!))].sort();
  const teams = [...new Set(gen.players.map((p) => p.draft?.team).filter((t): t is string => !!t).map(slugify))].sort();
  const countries = [...new Set(gen.players.map((p) => p.draft?.country).filter((c): c is string => !!c).map((c) => c.toLowerCase()))].sort();
  return { players, teams, countries, tournaments: [gen.tournamentId], collections: [], badges: [] };
}

/** Términos de búsqueda de un sujeto (nick/nombre/tag reales de la generación). */
export function targetsOfGeneration(
  gen: CardGenerationResult, missing: { category: AcquisitionTarget["category"]; subjectId: string }[],
): AcquisitionTarget[] {
  const byPlayer = new Map(gen.players.filter((p) => p.playerId).map((p) => [p.playerId!, p]));
  const teamNames = new Map<string, string>();
  for (const p of gen.players) if (p.draft?.team) teamNames.set(slugify(p.draft.team), p.draft.team);

  return missing.map((m) => {
    const terms: string[] = [m.subjectId];
    if (m.category === "player") {
      const p = byPlayer.get(m.subjectId);
      if (p) terms.unshift(p.nick, ...(p.draft?.team ? [`${p.nick} ${p.draft.team}`] : []));
    }
    if (m.category === "team") {
      const name = teamNames.get(m.subjectId);
      if (name) terms.unshift(name, `${name} logo`);
    }
    if (m.category === "tournament-logo") terms.unshift(gen.tournamentName, `${gen.tournamentName} logo`);
    return { category: m.category, subjectId: m.subjectId, searchTerms: [...new Set(terms)] };
  }).sort((a, b) => (a.category + a.subjectId < b.category + b.subjectId ? -1 : 1));
}
