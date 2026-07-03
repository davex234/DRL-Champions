/**
 * SPATIAL SIMULATION ENGINE — Control del mapa, peligro, rutas e información.
 *
 * A partir de QUÉ zonas ocupa cada bando y de la malla de visión precomputada, deriva:
 * control por zona (espacio ganado/perdido), zonas peligrosas (batidas por el enemigo),
 * espacio libre, rutas de mínima exposición e información (qué enemigos se conocen por
 * visión/ruido). Todo respeta una superposición de utilidad opcional (smokes, etc.).
 */
import type { ControlState, Occupancy, Side, SpatialMap, SpatialOverlay } from "./types";

const other = (s: Side): Side => (s === "ATK" ? "DEF" : "ATK");
const key = (a: string, b: string) => `${a}|${b}`;

/** Visión efectiva a→b respetando smokes de la superposición. */
export function sightOf(sm: SpatialMap, a: string, b: string, ov?: SpatialOverlay): number {
  if (ov && (ov.blockedSight.has(key(a, b)) || ov.blockedSight.has(key(b, a)))) return 0;
  return sm.sight[sm.index[a]][sm.index[b]];
}

export const occupancy = (atk: string[], def: string[]): Occupancy => ({ ATK: atk, DEF: def });

/** Control del mapa: dueño por zona, espacio, peligro y zonas libres. */
export function computeControl(sm: SpatialMap, occ: Occupancy, ov?: SpatialOverlay): ControlState {
  const score: ControlState["score"] = {};
  const owner: ControlState["owner"] = {};
  const space: Record<Side, number> = { ATK: 0, DEF: 0 };
  const danger: Record<Side, string[]> = { ATK: [], DEF: [] };
  const setA = new Set(occ.ATK), setD = new Set(occ.DEF);

  for (const z of sm.ids) {
    let a = setA.has(z) ? 2 : 0;
    let d = setD.has(z) ? 2 : 0;
    for (const o of occ.ATK) a += sightOf(sm, o, z, ov);
    for (const o of occ.DEF) d += sightOf(sm, o, z, ov);
    score[z] = { ATK: a, DEF: d };
    owner[z] = a > d + 0.6 ? "ATK" : d > a + 0.6 ? "DEF" : null;
    if (owner[z]) space[owner[z] as Side]++;
    // Peligro: batida por visión enemiga (desde zonas que el enemigo ocupa).
    const dangerFor = (side: Side, enemyZones: string[]) => {
      let mx = 0;
      for (const e of enemyZones) mx = Math.max(mx, sightOf(sm, e, z, ov));
      if (mx >= 0.5) danger[side].push(z);
    };
    dangerFor("ATK", occ.DEF);
    dangerFor("DEF", occ.ATK);
  }

  const open = sm.ids.filter((z, i) => owner[z] === null
    && !(sm.desc.zones[i].tags ?? []).some((t) => t.startsWith("spawn")));

  return { owner, score, space, danger, open };
}

/** Peligro de una zona para quien la cruza (máxima visión enemiga sobre ella). */
export function dangerAt(sm: SpatialMap, zone: string, enemyZones: string[], ov?: SpatialOverlay): number {
  let mx = 0;
  for (const e of enemyZones) mx = Math.max(mx, sightOf(sm, e, zone, ov));
  if (ov && ov.deniedZones.has(zone)) mx = Math.max(mx, 1); // molly = denegada
  return mx;
}

/** Exposición total de una ruta (suma del peligro de sus zonas). */
export function routeExposure(sm: SpatialMap, route: string[], enemyZones: string[], ov?: SpatialOverlay): number {
  return route.reduce((acc, z) => acc + dangerAt(sm, z, enemyZones, ov), 0);
}

/** Hasta K rutas simples de `from` a `to` (BFS + DFS acotado). */
export function candidateRoutes(sm: SpatialMap, from: string, to: string, k = 8): string[][] {
  const shortest = bfsPath(sm, from, to);
  if (shortest.length === 0) return [];
  const maxLen = shortest.length + 2;
  const out: string[][] = [];
  const seen = new Set<string>();
  const dfs = (cur: string, path: string[], visited: Set<string>) => {
    if (out.length >= k || path.length > maxLen) return;
    if (cur === to) {
      const sig = path.join(">");
      if (!seen.has(sig)) { seen.add(sig); out.push([...path]); }
      return;
    }
    for (const nb of sm.adj[cur]) {
      if (visited.has(nb)) continue;
      visited.add(nb); path.push(nb);
      dfs(nb, path, visited);
      path.pop(); visited.delete(nb);
    }
  };
  dfs(from, [from], new Set([from]));
  return out.length ? out : [shortest];
}

/** Ruta de MÍNIMA exposición dado dónde está el enemigo. */
export function leastExposedRoute(
  sm: SpatialMap, from: string, to: string, enemyZones: string[], ov?: SpatialOverlay,
): { route: string[]; exposure: number } {
  const cands = candidateRoutes(sm, from, to);
  let best = { route: cands[0] ?? [from, to], exposure: Infinity };
  for (const r of cands) {
    const e = routeExposure(sm, r, enemyZones, ov) + r.length * 0.01; // desempate por longitud
    if (e < best.exposure) best = { route: r, exposure: e };
  }
  return best;
}

/** Información: qué zonas enemigas se CONOCEN (visión desde las nuestras, ruido o recon). */
export function knownEnemyZones(
  sm: SpatialMap, ourZones: string[], enemyZones: string[], soundZones: string[] = [], ov?: SpatialOverlay,
): string[] {
  const sound = new Set(soundZones);
  return enemyZones.filter((e) => {
    if (sound.has(e)) return true;
    if (ov && ov.revealedZones.has(e)) return true;
    return ourZones.some((o) => sightOf(sm, o, e, ov) >= 0.4);
  });
}

function bfsPath(sm: SpatialMap, from: string, to: string): string[] {
  if (from === to) return [from];
  const prev: Record<string, string | null> = { [from]: null };
  const q = [from];
  while (q.length) {
    const cur = q.shift()!;
    for (const nb of sm.adj[cur]) {
      if (nb in prev) continue;
      prev[nb] = cur;
      if (nb === to) {
        const path = [to]; let p: string | null = cur;
        while (p) { path.unshift(p); p = prev[p]; }
        return path;
      }
      q.push(nb);
    }
  }
  return [];
}

export { other };
