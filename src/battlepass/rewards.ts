/**
 * RECOMPENSAS DE TRACK (Collection Fase 6/7).
 *
 * Recolecta las recompensas de los niveles de un track (libre/premium). El motor SOLO devuelve la lista
 * de `Reward`; el store las aplica por la ÚNICA ruta (`applyReward` → PackEngine/Minter/economía). Puro.
 */
import type { PassTrack, Reward, SeasonDef, Track } from "./types";

/** Recompensa de un nivel concreto en un track (o null si no hay). */
export function rewardAt(track: Track, level: number): Reward | null {
  return track[level] ?? null;
}

/** Niveles con recompensa hasta `level` (incluido) que aún no están reclamados. */
export function claimableLevels(track: Track, level: number, claimed: number[]): number[] {
  const set = new Set(claimed);
  const out: number[] = [];
  for (let l = 1; l <= level; l++) if (track[l] && !set.has(l)) out.push(l);
  return out;
}

/** ¿El nivel es reclamable (existe recompensa, alcanzado y no reclamado)? */
export function isClaimable(track: Track, level: number, reached: number, claimed: number[]): boolean {
  return !!track[level] && level >= 1 && level <= reached && !claimed.includes(level);
}

/**
 * El carril pedido. Una temporada puede no definir el competitivo; entonces devuelve un
 * track vacío en lugar de `undefined`, para que quien lo recorra no tenga que
 * comprobarlo en cada uso.
 */
export function trackOf(season: SeasonDef, track: PassTrack): Track {
  if (track === "premium") return season.premium;
  if (track === "competitive") return season.competitive ?? {};
  return season.free;
}
