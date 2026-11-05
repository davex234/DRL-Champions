/**
 * SNAPSHOT — normalización canónica del RawSnapshot para comparar y firmar: colecciones
 * ORDENADAS por claves estables (id/nombre), sin depender del orden de scraping. No añade,
 * quita ni interpreta datos: solo ordena.
 */
import type { RawSnapshot } from "@/importer";

const byId = <T extends { id?: string }>(a: T, b: T): number =>
  ((a.id ?? "") < (b.id ?? "") ? -1 : 1);

/** Forma canónica (mismo contenido ⇒ misma forma, da igual el orden de origen). */
export function normalizeSnapshot(s: RawSnapshot): RawSnapshot {
  return {
    ...s,
    stages: [...(s.stages ?? [])].sort(byId),
    teams: [...s.teams].sort((a, b) => (a.name < b.name ? -1 : 1)),
    players: [...s.players].sort((a, b) => (a.nick < b.nick ? -1 : 1)),
    coaches: [...(s.coaches ?? [])].sort((a, b) => (a.name < b.name ? -1 : 1)),
    matches: [...s.matches].sort(byId),
    maps: [...(s.maps ?? [])].sort(byId),
    mapStats: [...(s.mapStats ?? [])].sort((a, b) =>
      (`${a.matchMapId}|${a.player}` < `${b.matchMapId}|${b.player}` ? -1 : 1)),
    standings: [...(s.standings ?? [])].sort((a, b) => (a.team < b.team ? -1 : 1)),
  };
}

/** Identidad ESTABLE del torneo (el id oficial del snapshot del Importer). */
export const tournamentIdOf = (s: RawSnapshot): string => s.tournament.id;
