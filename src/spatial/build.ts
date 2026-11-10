/**
 * SPATIAL SIMULATION ENGINE — Construcción del mapa espacial.
 *
 * Precomputa, UNA vez por mapa, todo lo que un profesional "sabe" del mapa sin pensar:
 * qué ve cada zona (líneas de visión por muestreo), distancias y rumbos, cobertura,
 * cuellos de botella (betweenness) y CROSSFIRES (pares de ángulos que baten una
 * aproximación desde direcciones distintas). Puro y determinista.
 */
import { angleTo, dist, lineClear, type Vec2 } from "../sim/geometry";
import type { MapDescriptor, SpatialMap } from "./types";

const DEFAULT_RADIUS = 34;
const COVER_R = 120;
const SAMPLE_DIRS: Vec2[] = [
  { x: 0, y: 0 }, { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 },
];

const bearingDiff = (a: number, b: number): number => {
  let d = Math.abs(a - b);
  if (d > Math.PI) d = 2 * Math.PI - d;
  return d;
};

export interface BuildOpts {
  maxRange?: number;
  /** Umbrales de crossfire. */
  crossSightMin?: number;
  crossAngleMin?: number;
}

export function buildSpatialMap(desc: MapDescriptor, opts: BuildOpts = {}): SpatialMap {
  const maxRange = opts.maxRange ?? 470;
  const crossSightMin = opts.crossSightMin ?? 0.45;
  const crossAngleMin = opts.crossAngleMin ?? 0.6; // ~34°
  const n = desc.zones.length;
  const ids = desc.zones.map((z) => z.id);
  const index: Record<string, number> = {};
  ids.forEach((id, i) => (index[id] = i));

  const samples = desc.zones.map((z) => {
    const r = (z.radius ?? DEFAULT_RADIUS) * 0.7;
    return SAMPLE_DIRS.map((d) => ({ x: z.pos.x + d.x * r, y: z.pos.y + d.y * r }));
  });

  // — Visión, distancia, rumbo —
  const sight: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  const distM: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  const bearing: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let a = 0; a < n; a++) {
    for (let b = 0; b < n; b++) {
      const ca = desc.zones[a].pos, cb = desc.zones[b].pos;
      distM[a][b] = dist(ca, cb);
      bearing[a][b] = angleTo(ca, cb);
      if (a === b) { sight[a][b] = 1; continue; }
      if (distM[a][b] - 2 * DEFAULT_RADIUS > maxRange) { sight[a][b] = 0; continue; }
      let clear = 0, total = 0;
      for (const pa of samples[a]) for (const pb of samples[b]) {
        if (dist(pa, pb) > maxRange) continue;
        total++;
        if (lineClear(pa, pb, desc.walls)) clear++;
      }
      sight[a][b] = total > 0 ? clear / total : 0;
    }
  }

  // — Cobertura (muros cercanos) —
  const cover = desc.zones.map((z) => {
    let near = 0;
    for (const w of desc.walls) {
      const mid = { x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 };
      if (dist(mid, z.pos) < COVER_R) near++;
    }
    return Math.min(1, near / 6);
  });

  // — Adyacencia —
  const adj: Record<string, string[]> = {};
  for (const id of ids) adj[id] = [];
  for (const [u, v] of desc.links) {
    if (!adj[u].includes(v)) adj[u].push(v);
    if (!adj[v].includes(u)) adj[v].push(u);
  }

  // — Cuellos de botella (betweenness) —
  const between = new Array(n).fill(0);
  for (let s = 0; s < n; s++) {
    for (let t = s + 1; t < n; t++) {
      const path = bfs(ids[s], ids[t], adj, index);
      for (let k = 1; k < path.length - 1; k++) between[path[k]]++;
    }
  }
  const maxBet = Math.max(1, ...between);
  const chokes = ids.filter((id, i) =>
    (desc.zones[i].tags ?? []).includes("choke") || between[i] >= maxBet * 0.5);

  // — Crossfires por zona de aproximación —
  const crossfires: Record<string, [string, string][]> = {};
  for (let x = 0; x < n; x++) {
    const cands: { pair: [string, string]; score: number }[] = [];
    for (let a = 0; a < n; a++) {
      if (a === x || sight[a][x] < crossSightMin || cover[a] < 0.15) continue;
      for (let b = a + 1; b < n; b++) {
        if (b === x || sight[b][x] < crossSightMin || cover[b] < 0.15) continue;
        const ang = bearingDiff(bearing[a][x], bearing[b][x]);
        if (ang < crossAngleMin) continue;
        if (sight[a][b] > 0.65) continue; // que no se expongan demasiado entre sí
        cands.push({ pair: [ids[a], ids[b]], score: sight[a][x] + sight[b][x] + ang });
      }
    }
    cands.sort((p, q) => q.score - p.score);
    crossfires[ids[x]] = cands.slice(0, 3).map((c) => c.pair);
  }

  return { desc, ids, index, sight, dist: distM, bearing, cover, chokes, crossfires, adj, maxRange };
}

/** BFS de zonas (devuelve índices, incluye extremos). */
function bfs(from: string, to: string, adj: Record<string, string[]>, index: Record<string, number>): number[] {
  if (from === to) return [index[from]];
  const prev: Record<string, string | null> = { [from]: null };
  const q = [from];
  while (q.length) {
    const cur = q.shift()!;
    for (const nb of adj[cur]) {
      if (nb in prev) continue;
      prev[nb] = cur;
      if (nb === to) {
        const path: string[] = [to];
        let p: string | null = cur;
        while (p) { path.unshift(p); p = prev[p]; }
        return path.map((id) => index[id]);
      }
      q.push(nb);
    }
  }
  return [index[from], index[to]];
}
