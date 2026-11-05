/**
 * FINGERPRINT — huella determinista del torneo sobre su CONTENIDO: estructura (etapas y
 * bracket), equipos, rosters, partidos, resultados, mapas, estadísticas, clasificación y
 * metadatos del evento. JAMÁS timestamps de reloj ni ids efímeros de scraping: dos
 * observaciones del mismo estado real producen la MISMA huella (cero falsos positivos).
 */
import type { RawSnapshot } from "@/importer";
import { normalizeSnapshot } from "./snapshot";

/** FNV-1a 32-bit (huella local: el watcher no depende de ningún otro módulo del juego). */
export function watchHash(data: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) { h ^= data.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return `fnv1a:${(h >>> 0).toString(16).padStart(8, "0")}`;
}

/** Proyección firmable (solo contenido estable del torneo). */
export function fingerprintPayload(s: RawSnapshot): unknown {
  const n = normalizeSnapshot(s);
  return {
    tournament: {
      id: n.tournament.id, name: n.tournament.name, status: n.tournament.status,
      prizePool: n.tournament.prizePool ?? null, startDate: n.tournament.startDate ?? null,
      endDate: n.tournament.endDate ?? null, location: n.tournament.location ?? null,
    },
    stages: (n.stages ?? []).map((x) => [x.id, x.name, x.kind, x.orderIdx]),
    teams: n.teams.map((t) => [t.name, t.region ?? null]),
    rosters: n.players.map((p) => [p.nick, p.team ?? null, p.role ?? null]),
    matches: n.matches.map((m) => [m.id, m.stageId, m.teamA, m.teamB, m.status, m.scoreA ?? null, m.scoreB ?? null, m.winner ?? null, m.round ?? null, m.matchOrder ?? null]),
    maps: (n.maps ?? []).map((m) => [m.id, m.matchId, m.map, m.mapOrder, m.scoreA ?? null, m.scoreB ?? null, m.winner ?? null]),
    stats: (n.mapStats ?? []).map((x) => [x.matchMapId, x.player, x.acs ?? null, x.kills ?? null, x.deaths ?? null, x.assists ?? null]),
    standings: (n.standings ?? []).map((x) => [x.team, x.position ?? null, x.status ?? null, x.wins ?? null, x.losses ?? null]),
  };
}

export function tournamentFingerprint(s: RawSnapshot): string {
  return watchHash(JSON.stringify(fingerprintPayload(s)));
}
