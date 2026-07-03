/**
 * SPATIAL SIMULATION ENGINE — Consultas de alto nivel (las usa la táctica).
 *
 * Aquí "todo surge del Spatial Engine": dónde aguantar (holds con cobertura sobre una
 * aproximación), qué crossfire montar, por qué carril atacar (mínima exposición), a
 * dónde rotar y qué parejas pueden tradear. La táctica deja de hardcodear posiciones.
 */
import type { SpatialMap, SpatialOverlay } from "./types";
import { dangerAt, leastExposedRoute, sightOf } from "./control";

/** Zonas desde las que se BATE `target` con buena cobertura (ordenadas). */
export function holdsCovering(
  sm: SpatialMap, target: string, opts: { exclude?: string[]; limit?: number; minSight?: number } = {},
): { zone: string; score: number }[] {
  const exclude = new Set([target, ...(opts.exclude ?? [])]);
  const minSight = opts.minSight ?? 0.3;
  const out: { zone: string; score: number }[] = [];
  for (let i = 0; i < sm.ids.length; i++) {
    const z = sm.ids[i];
    if (exclude.has(z)) continue;
    if ((sm.desc.zones[i].tags ?? []).some((t) => t.startsWith("spawn"))) continue;
    const s = sightOf(sm, z, target);
    if (s < minSight) continue;
    out.push({ zone: z, score: s * (0.55 + 0.45 * sm.cover[i]) });
  }
  out.sort((a, b) => b.score - a.score);
  return opts.limit ? out.slice(0, opts.limit) : out;
}

/** Crossfire precomputado que bate `target` (par de zonas desde ángulos distintos). */
export function crossfireFor(sm: SpatialMap, target: string): [string, string] | null {
  return sm.crossfires[target]?.[0] ?? null;
}

/** El choke MÁS amenazado: por dónde está entrando el ataque (presencia + visión). */
export function mostThreatenedChoke(
  sm: SpatialMap, chokes: string[], enemyZones: string[], ov?: SpatialOverlay,
): { choke: string; pressure: number } {
  let best = { choke: chokes[0] ?? sm.chokes[0], pressure: -1 };
  for (const c of chokes) {
    let p = enemyZones.includes(c) ? 2 : 0;
    for (const e of enemyZones) p += sightOf(sm, e, c, ov);
    if (p > best.pressure) best = { choke: c, pressure: p };
  }
  return best;
}

/** Carril de ataque de MENOR exposición hacia el sitio, a través de cada choke. */
export function attackLaneByExposure(
  sm: SpatialMap, from: string, site: string, lanes: { lane: string; choke: string }[],
  enemyZones: string[], ov?: SpatialOverlay,
): { lane: string; route: string[]; exposure: number } {
  let best = { lane: lanes[0]?.lane ?? "main", route: [from, site], exposure: Infinity };
  for (const { lane, choke } of lanes) {
    const r1 = leastExposedRoute(sm, from, choke, enemyZones, ov);
    const r2 = leastExposedRoute(sm, choke, site, enemyZones, ov);
    const route = [...r1.route, ...r2.route.slice(1)];
    const exposure = r1.exposure + r2.exposure;
    if (exposure < best.exposure) best = { lane, route, exposure };
  }
  return best;
}

/** A dónde rotar para responder a un contacto: el mejor hold que bate el contacto. */
export function rotationTarget(
  sm: SpatialMap, contactZone: string, ourZones: string[], exclude: string[] = [],
): string {
  const holds = holdsCovering(sm, contactZone, { exclude, limit: 5 });
  // Prefiere el hold más cercano a alguien nuestro (rotación corta) con buen score.
  let best = holds[0]?.zone ?? contactZone;
  let bestVal = -Infinity;
  for (const h of holds) {
    const near = Math.min(...ourZones.map((o) => sm.dist[sm.index[o]][sm.index[h.zone]]), Infinity);
    const val = h.score * 100 - near * 0.05;
    if (val > bestVal) { bestVal = val; best = h.zone; }
  }
  return best;
}

/** Parejas de zonas nuestras listas para tradear (cercanas y con visión a un punto común). */
export function tradePairs(sm: SpatialMap, ourZones: string[], maxDist = 240): [string, string][] {
  const pairs: [string, string][] = [];
  for (let i = 0; i < ourZones.length; i++) {
    for (let j = i + 1; j < ourZones.length; j++) {
      const a = ourZones[i], b = ourZones[j];
      if (sm.dist[sm.index[a]][sm.index[b]] > maxDist) continue;
      // Comparten visión a alguna tercera zona (mismo ángulo de combate).
      const shared = sm.ids.some((z) => z !== a && z !== b && sightOf(sm, a, z) >= 0.4 && sightOf(sm, b, z) >= 0.4);
      if (shared) pairs.push([a, b]);
    }
  }
  return pairs;
}

export { dangerAt };
