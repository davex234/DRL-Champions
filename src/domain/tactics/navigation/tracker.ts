/**
 * FASE 51.2 · NAV TRACKER — el estado de movimiento VISUAL de un jugador durante la ronda.
 *
 * El motor da, cada tick, una posición abstracta. `projectSimPoint` la lleva a la trayectoria real de
 * su tramo; pero cuando esa posición queda entre dos tramos del modelo, el tramo más cercano cambia de
 * golpe y la ficha saltaría de un pasillo a otro (medido: hasta ~390 px en un tick). El tracker lo
 * impide: guarda DÓNDE está la ficha (arista `u → v` y progreso `t`) y, cuando el objetivo cambia de
 * arista, la lleva hasta él POR EL GRAFO (camino más corto a través de los nodos, con la geometría
 * real de cada arista) a una velocidad máxima acotada. Nunca teletransporte, nunca recta.
 *
 * Estado mínimo por jugador: mapa, arista actual, progreso y último tick. Nada se persiste; el motor
 * no se entera. Determinista: mismas posiciones y mismos ticks → mismo recorrido.
 */
import { MOVE_STEP } from "@/sim/ai/behaviors";
import { ZONES, type ZoneId } from "@/sim/map/ascentA";
import { navGraph, simSegment, SIM_EDGES, LATERAL_MAX, type Pt } from "../matchMap";
import { edgePolyline, findPath, cumulative, pointAlong } from "./pathfinding";
import type { MapNavigationGraph, NavPoint } from "./types";

interface EdgeState { u: ZoneId; v: ZoneId; t: number }

const LEN = new WeakMap<MapNavigationGraph, Map<string, number>>();
const aspect = (g: MapNavigationGraph) => g.asset.width / g.asset.height;

/** Longitud (en unidades de alto del asset) de la trayectoria real de una arista. */
function edgeLen(g: MapNavigationGraph, u: string, v: string): number {
  let m = LEN.get(g);
  if (!m) { m = new Map(); LEN.set(g, m); }
  const k = u < v ? `${u}|${v}` : `${v}|${u}`;
  const hit = m.get(k);
  if (hit !== undefined) return hit;
  const poly = edgePolyline(g, u, v);
  const acc = poly ? cumulative(poly, aspect(g)) : [0];
  m.set(k, acc[acc.length - 1]);
  return acc[acc.length - 1];
}

/** Longitud del camino más corto por el grafo entre dos nodos (y sus nodos), o null si no hay. */
function graphRoute(g: MapNavigationGraph, a: string, b: string): { len: number; nodes: string[] } | null {
  if (a === b) return { len: 0, nodes: [a] };
  const r = findPath(g, a, b);
  if (!r.ok) return null;
  let len = 0;
  for (let i = 1; i < r.nodes.length; i++) len += edgeLen(g, r.nodes[i - 1], r.nodes[i]);
  return { len, nodes: [...r.nodes] };
}

/** Velocidad visual máxima por tick de un mapa: 3 × la velocidad media del motor trasladada al asset. */
export function maxStepPerTick(mapId: string): number {
  const g = navGraph(mapId);
  let ratio = 0;
  for (const [u, v] of SIM_EDGES) {
    const sim = Math.hypot(ZONES[u].x - ZONES[v].x, ZONES[u].y - ZONES[v].y) || 1;
    ratio += edgeLen(g, u, v) / sim;
  }
  return 3 * MOVE_STEP * (ratio / SIM_EDGES.length);
}

const canon = (u: ZoneId, v: ZoneId, t: number): EdgeState => (u < v ? { u, v, t } : { u: v, v: u, t: 1 - t });

export class NavTracker {
  private state: EdgeState | null = null;
  private tick = -1;
  private side = 0;
  private readonly g: MapNavigationGraph;
  private readonly step: number;

  constructor(readonly mapId: string, step?: number) {
    this.g = navGraph(mapId);
    this.step = step ?? maxStepPerTick(mapId);
  }

  /** El tramo y progreso actuales de la FICHA (no del motor). */
  segment(): EdgeState | null { return this.state; }

  /** Avanza hasta el tick `tick` persiguiendo la posición abstracta `simPos`. Devuelve el punto visual (0..1). */
  update(simPos: Pt, tick: number): Pt {
    const seg = simSegment(simPos);
    const target = canon(seg.u, seg.v, seg.t);
    if (!this.state || tick < this.tick) {
      this.state = target;                       // primer fotograma o ronda nueva: se coloca, no se mueve
    } else if (tick > this.tick) {
      this.state = this.advance(this.state, target, this.step * Math.min(tick - this.tick, 40));
    }
    this.tick = Math.max(this.tick, tick);
    this.side = this.state.u === target.u && this.state.v === target.v ? (seg.u === target.u ? seg.side : -seg.side) : 0;
    return this.point();
  }

  /** El punto visual del estado actual, con la separación lateral acotada por la holgura medida. */
  point(): Pt {
    const s = this.state!;
    const poly = edgePolyline(this.g, s.u, s.v)!;
    const { p, dir } = pointAlong(poly, s.t, aspect(this.g));
    const edge = this.g.edges.find((e) => (e.from === s.u && e.to === s.v) || (e.from === s.v && e.to === s.u));
    const lim = Math.min(LATERAL_MAX, edge?.halfWidth ?? 0);
    const off = Math.max(-lim, Math.min(lim, this.side * 0.00012));
    return { x: clamp01(p[0] - dir[1] * off), y: clamp01(p[1] + dir[0] * off) };
  }

  /** La trayectoria visual pendiente de la ficha hasta el final de su arista actual (para dibujar). */
  poly(): NavPoint[] | null {
    return this.state ? edgePolyline(this.g, this.state.u, this.state.v) : null;
  }

  private advance(cur: EdgeState, tgt: EdgeState, budget: number): EdgeState {
    const g = this.g;
    const L = edgeLen(g, cur.u, cur.v);
    if (cur.u === tgt.u && cur.v === tgt.v) {
      const d = (tgt.t - cur.t) * L;
      if (Math.abs(d) <= budget || L === 0) return tgt;
      return { ...cur, t: cur.t + (Math.sign(d) * budget) / L };
    }
    /* El camino más corto: salir por un extremo, cruzar el grafo, entrar por un extremo del objetivo. */
    const Lt = edgeLen(g, tgt.u, tgt.v);
    let best: { a: ZoneId; b: ZoneId; nodes: string[]; total: number; d1: number } | null = null;
    for (const a of [cur.u, cur.v]) for (const b of [tgt.u, tgt.v]) {
      const r = graphRoute(g, a, b);
      if (!r) continue;
      const d1 = (a === cur.u ? cur.t : 1 - cur.t) * L;
      const d3 = (b === tgt.u ? tgt.t : 1 - tgt.t) * Lt;
      const total = d1 + r.len + d3;
      if (!best || total < best.total - 1e-12) best = { a, b, nodes: r.nodes, total, d1 };
    }
    if (!best) return cur;                        // sin camino: quieto (nunca recta ni salto)
    if (best.total <= budget) return tgt;
    let rest = budget;
    /* 1 · hasta el extremo `a` de la arista actual. */
    if (rest < best.d1) return { ...cur, t: cur.t + ((best.a === cur.u ? -1 : 1) * rest) / (L || 1) };
    rest -= best.d1;
    /* 2 · por las aristas del camino. */
    for (let i = 1; i < best.nodes.length; i++) {
      const x = best.nodes[i - 1] as ZoneId, y = best.nodes[i] as ZoneId;
      const l = edgeLen(g, x, y);
      if (rest < l) return canon(x, y, rest / (l || 1));
      rest -= l;
    }
    /* 3 · entrar en la arista objetivo desde `b`. */
    const b = best.b;
    return b === tgt.u ? { ...tgt, t: Math.min(tgt.t, rest / (Lt || 1)) } : { ...tgt, t: Math.max(tgt.t, 1 - rest / (Lt || 1)) };
  }
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
