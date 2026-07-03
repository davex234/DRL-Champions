/**
 * REGION ENGINE + LATENCY ENGINE — ping por región y selección de región (Online Fase 2/7).
 *
 * Matriz de ping DETERMINISTA entre regiones + penalización por carga del servidor. Reutiliza
 * el concepto de latencia del Online Core para el juego en vivo; aquí estima el ping de COLA.
 * PURO.
 */
import type { Region } from "@/domain/cards/types";
import type { PlayerProfile, ServerNode } from "./types";

export const REGIONS: Region[] = ["EMEA", "Americas", "Pacific", "China"];

/** Ping base entre regiones (ms). Diagonal ≈ local; cruces = latencia realista y estable. */
const PING: Record<Region, Record<Region, number>> = {
  EMEA: { EMEA: 15, Americas: 90, Pacific: 160, China: 190 },
  Americas: { EMEA: 90, Americas: 20, Pacific: 130, China: 170 },
  Pacific: { EMEA: 160, Americas: 130, Pacific: 18, China: 70 },
  China: { EMEA: 190, Americas: 170, Pacific: 70, China: 12 },
};

export function regionPing(a: Region, b: Region): number { return PING[a][b]; }

/** Ping estimado de un jugador a un servidor: región + penalización por carga. */
export function pingToServer(p: PlayerProfile, node: ServerNode): number {
  const base = regionPing(p.region, node.region);
  const loadPenalty = Math.round((node.load / Math.max(1, node.capacity)) * 20);
  return base + loadPenalty;
}

/** Región común óptima de un conjunto de perfiles (la más frecuente; desempate por menor ping medio). */
export function bestRegionFor(profiles: PlayerProfile[]): Region {
  if (profiles.length === 0) return "EMEA";
  const counts: Record<string, number> = {};
  for (const p of profiles) counts[p.region] = (counts[p.region] ?? 0) + 1;
  let best: Region = profiles[0].region, bestScore = -1;
  for (const r of REGIONS) {
    const count = counts[r] ?? 0;
    const avgPing = profiles.reduce((a, p) => a + regionPing(p.region, r), 0) / profiles.length;
    const score = count * 1000 - avgPing;
    if (score > bestScore) { bestScore = score; best = r; }
  }
  return best;
}

/** Ping estimado entre dos jugadores (a través de la mejor región común). */
export function pairPing(a: PlayerProfile, b: PlayerProfile): number {
  const r = bestRegionFor([a, b]);
  return Math.round((regionPing(a.region, r) + regionPing(b.region, r)) / 2);
}
