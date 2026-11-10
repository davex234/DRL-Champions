/**
 * FASE 51.2 · PATHFINDING sobre el grafo táctico — Dijkstra determinista.
 *
 * Dijkstra y no A*: cada grafo tiene una docena de nodos; la heurística no ahorra nada medible y
 * Dijkstra es más fácil de razonar y de probar. Empates resueltos por id de nodo → mismo mapa, mismo
 * origen y mismo destino dan SIEMPRE el mismo camino.
 *
 * Sin ruta → `{ ok: false, reason: "NO_ROUTE" }`. Nunca una recta de reserva.
 */
import type { MapNavigationGraph, NavEdge, NavPathResult, NavPoint } from "./types";

interface Index {
  pos: Map<string, NavPoint>;
  out: Map<string, { to: string; cost: number; points: NavPoint[] }[]>;
}

const INDEX = new WeakMap<MapNavigationGraph, Index>();
const CACHE = new WeakMap<MapNavigationGraph, Map<string, NavPathResult>>();

function index(g: MapNavigationGraph): Index {
  const hit = INDEX.get(g);
  if (hit) return hit;
  const pos = new Map<string, NavPoint>(g.nodes.map((n) => [n.id, [n.x, n.y] as NavPoint]));
  const out = new Map<string, { to: string; cost: number; points: NavPoint[] }[]>();
  const add = (from: string, to: string, cost: number, points: NavPoint[]) => {
    if (!out.has(from)) out.set(from, []);
    out.get(from)!.push({ to, cost, points });
  };
  for (const e of g.edges) {
    const a = pos.get(e.from), b = pos.get(e.to);
    if (!a || !b) continue;
    add(e.from, e.to, e.cost, [a, ...e.waypoints, b]);
    if (!e.oneWay) add(e.to, e.from, e.cost, [b, ...[...e.waypoints].reverse(), a]);
  }
  for (const list of out.values()) list.sort((x, y) => x.to.localeCompare(y.to));
  const idx = { pos, out };
  INDEX.set(g, idx);
  return idx;
}

/** La trayectoria completa de una arista en el sentido pedido (extremos incluidos), o null si no existe. */
export function edgePolyline(g: MapNavigationGraph, from: string, to: string): NavPoint[] | null {
  return index(g).out.get(from)?.find((e) => e.to === to)?.points ?? null;
}

export function findPath(g: MapNavigationGraph, from: string, to: string): NavPathResult {
  const { pos, out } = index(g);
  if (!pos.has(from) || !pos.has(to)) return { ok: false, reason: "UNKNOWN_NODE" };
  const key = `${from}>${to}`;
  let cache = CACHE.get(g);
  if (!cache) { cache = new Map(); CACHE.set(g, cache); }
  const cached = cache.get(key);
  if (cached) return cached;

  const dist = new Map<string, number>([[from, 0]]);
  const prev = new Map<string, string>();
  const done = new Set<string>();
  while (true) {
    let cur: string | null = null;
    for (const [id, d] of dist) {
      if (done.has(id)) continue;
      if (cur === null || d < dist.get(cur)! || (d === dist.get(cur)! && id < cur)) cur = id;
    }
    if (cur === null || cur === to) break;
    done.add(cur);
    for (const e of out.get(cur) ?? []) {
      const nd = dist.get(cur)! + e.cost;
      const old = dist.get(e.to);
      if (old === undefined || nd < old - 1e-12) { dist.set(e.to, nd); prev.set(e.to, cur); }
    }
  }

  let result: NavPathResult;
  if (!dist.has(to)) {
    result = { ok: false, reason: "NO_ROUTE" };
  } else {
    const nodes = [to];
    while (nodes[0] !== from) nodes.unshift(prev.get(nodes[0])!);
    const points: NavPoint[] = [pos.get(from)!];
    for (let i = 1; i < nodes.length; i++) points.push(...edgePolyline(g, nodes[i - 1], nodes[i])!.slice(1));
    result = { ok: true, nodes, points, cost: dist.get(to)! };
  }
  cache.set(key, result);
  return result;
}

/** Longitudes acumuladas de una polilínea (en unidades normalizadas, con la proporción del asset). */
export function cumulative(points: readonly NavPoint[], aspect: number): number[] {
  const acc = [0];
  for (let i = 1; i < points.length; i++) {
    acc.push(acc[i - 1] + Math.hypot((points[i][0] - points[i - 1][0]) * aspect, points[i][1] - points[i - 1][1]));
  }
  return acc;
}

/** El punto a una fracción `t` (0..1) de la LONGITUD de la polilínea, y la dirección del tramo. */
export function pointAlong(points: readonly NavPoint[], t: number, aspect = 1): { p: NavPoint; dir: NavPoint } {
  const acc = cumulative(points, aspect);
  const total = acc[acc.length - 1];
  if (points.length === 1 || total === 0) return { p: points[0], dir: [1, 0] };
  const target = Math.max(0, Math.min(1, t)) * total;
  let i = 1;
  while (i < acc.length - 1 && acc[i] < target) i++;
  const seg = acc[i] - acc[i - 1] || 1;
  const u = (target - acc[i - 1]) / seg;
  const a = points[i - 1], b = points[i];
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  return { p: [a[0] + dx * u, a[1] + dy * u], dir: [dx / len, dy / len] };
}

export type { NavEdge };
