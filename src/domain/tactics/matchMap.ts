/**
 * EL MAPA DEL PARTIDO — la puerta de entrada del sistema espacial del Tactical Coach.
 *
 * ────────────────────────── DOS CAPAS, SEPARADAS ──────────────────────────
 *
 *   · MODELO DE SIMULACIÓN (`src/sim/map/ascentA.ts`): campo abstracto 1000 × 700, doce zonas y su
 *     grafo de corredores (`ADJ`). El motor decide ahí A DÓNDE va cada jugador y por qué zonas. NO se
 *     toca: cambiarlo cambiaría quién gana las rondas.
 *   · NAVEGACIÓN REAL (FASE 51.2, `navigation/`): un grafo por mapa cuyos nodos son esas zonas
 *     colocadas sobre el suelo del asset y cuyas aristas son trayectorias VÁLIDAS (con waypoints que
 *     rodean paredes), derivadas de los píxeles del PNG por `scripts/_fase51-2-navgen.ts`.
 *
 * ────────────────────────── EL ADAPTADOR ──────────────────────────
 *
 *   posición abstracta → tramo del modelo (u → v, fracción t) → trayectoria real de esa arista → punto
 *
 * El motor mueve a sus jugadores de zona en zona; cada tramo abstracto tiene su trayectoria real, así
 * que la ficha avanza por el pasillo, no por la recta. La 51.1 proyectaba con una transformación afín
 * por tramos: la imagen era real, el movimiento atravesaba paredes. Ya no existe.
 *
 * La RUTA PREVISTA (lo que se dibuja): la secuencia de zonas la decide el motor (`route`), el grafo
 * la convierte en geometría; si un tramo no tuviera trayectoria se busca con `findPath`, y si tampoco
 * hay camino → NO_ROUTE y no se dibuja nada. Nunca una recta de reserva.
 *
 * Coordenadas: NORMALIZADAS 0..1 sobre el asset. `requireMatchMap` solo acepta ids del catálogo.
 */
import { ZONES, ADJ, route, nearestZone, type ZoneId } from "@/sim/map/ascentA";
import { availableMaps, getTacticalMap, type TacticalMap } from "./maps";
import { NAV_GRAPHS } from "./navigation/maps";
import { findPath, edgePolyline, pointAlong, cumulative } from "./navigation/pathfinding";
import type { MapNavigationGraph, NavPathResult, NavPoint } from "./navigation/types";
import { ns } from "@/i18n/runtime";

const tr = ns("tactics");

export type Pt = { x: number; y: number };

/** Los mapas con los que se puede jugar un partido: el catálogo canónico, y solo él. */
export function matchMaps(): readonly TacticalMap[] {
  return availableMaps();
}

export function isMatchMapId(id: unknown): id is string {
  return typeof id === "string" && matchMaps().some((m) => m.id === id) && Object.prototype.hasOwnProperty.call(NAV_GRAPHS, id);
}

export class InvalidMatchMapError extends Error {
  constructor(readonly mapId: unknown) {
    super(tr("Ese mapa no existe en el catálogo del Tactical Coach."));
    this.name = "InvalidMatchMapError";
  }
}

/** El mapa canónico de un partido. Id desconocido → lanza. Nunca un mapa genérico. */
export function requireMatchMap(id: unknown): TacticalMap {
  if (!isMatchMapId(id)) throw new InvalidMatchMapError(id);
  return getTacticalMap(id) as TacticalMap;
}

/** El grafo de navegación de un mapa del catálogo. */
export function navGraph(mapId: unknown): MapNavigationGraph {
  if (!isMatchMapId(mapId)) throw new InvalidMatchMapError(mapId);
  return NAV_GRAPHS[mapId];
}

/** Ruta más corta válida entre dos nodos del mapa (Dijkstra determinista). Sin ruta → NO_ROUTE. */
export function getNavPath(mapId: string, from: string, to: string): NavPathResult {
  if (!isMatchMapId(mapId)) return { ok: false, reason: "UNKNOWN_MAP" };
  return findPath(NAV_GRAPHS[mapId], from, to);
}

/* ─────────────────────────── Adaptador simulación → mapa ─────────────────────────── */

/** Las aristas del modelo del simulador, una vez cada una (orden estable). */
export const SIM_EDGES: readonly [ZoneId, ZoneId][] = (() => {
  const set = new Map<string, [ZoneId, ZoneId]>();
  for (const a of Object.keys(ADJ) as ZoneId[]) for (const b of ADJ[a]) {
    const p: [ZoneId, ZoneId] = a < b ? [a, b] : [b, a];
    set.set(p.join("|"), p);
  }
  return [...set.values()].sort((x, y) => x.join().localeCompare(y.join()));
})();

const aspectOf = (g: MapNavigationGraph) => g.asset.width / g.asset.height;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** El tramo del modelo en el que está una posición abstracta: arista `u → v`, fracción `t` y lado. */
export function simSegment(p: Pt): { u: ZoneId; v: ZoneId; t: number; side: number } {
  let best = { u: SIM_EDGES[0][0], v: SIM_EDGES[0][1], t: 0, side: 0, d: Infinity };
  for (const [u, v] of SIM_EDGES) {
    const a = ZONES[u], b = ZONES[v];
    const dx = b.x - a.x, dy = b.y - a.y;
    const l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
    const d = Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
    if (d < best.d - 1e-9) best = { u, v, t, side: (dx * (p.y - a.y) - dy * (p.x - a.x)) / Math.sqrt(l2), d };
  }
  return { u: best.u, v: best.v, t: best.t, side: best.side };
}

/** Desviación lateral máxima dentro del pasillo (normalizada): separa fichas sin sacarlas del suelo. */
export const LATERAL_MAX = 0.004;

/**
 * Posición abstracta → punto del mapa real (0..1), SOBRE la trayectoria válida de su tramo.
 * La fracción recorrida del tramo abstracto es la fracción recorrida de la trayectoria real.
 */
export function projectSimPoint(mapId: string, p: Pt): Pt {
  const g = navGraph(mapId);
  const seg = simSegment(p);
  const poly = edgePolyline(g, seg.u, seg.v);
  if (!poly) {
    // Grafo sin esa arista (no pasa con los doce generados): el nodo más cercano, nunca una recta.
    const n = g.nodes.find((x) => x.id === (seg.t < 0.5 ? seg.u : seg.v))!;
    return { x: n.x, y: n.y };
  }
  const { p: q, dir } = pointAlong(poly, seg.t, aspectOf(g));
  /* Separación lateral acotada por la holgura MEDIDA de la arista: nunca saca la ficha del suelo. */
  const edge = g.edges.find((e) => (e.from === seg.u && e.to === seg.v) || (e.from === seg.v && e.to === seg.u));
  const lim = Math.min(LATERAL_MAX, edge?.halfWidth ?? 0);
  const off = Math.max(-lim, Math.min(lim, seg.side * 0.00012));
  return { x: clamp01(q[0] - dir[1] * off), y: clamp01(q[1] + dir[0] * off) };
}

export type PlannedRoute =
  | { ok: true; points: NavPoint[]; zones: ZoneId[] }
  | { ok: false; reason: "ARRIVED" | "NO_ROUTE" };

/**
 * La RUTA PREVISTA de un jugador: desde su punto actual, por el resto de su tramo y luego por las
 * zonas que el motor le hará recorrer hasta `target`, con la geometría real de cada arista.
 */
export function plannedRoute(
  mapId: string, pos: Pt, target: ZoneId,
  /** Dónde está la FICHA (su tramo y progreso, del `NavTracker`); si no se da, el tramo de `pos`. */
  from?: { u: ZoneId; v: ZoneId; t: number } | null,
): PlannedRoute {
  const g = navGraph(mapId);
  const here = nearestZone(pos);
  if (here === target && Math.hypot(pos.x - ZONES[target].x, pos.y - ZONES[target].y) <= 14) return { ok: false, reason: "ARRIVED" };
  const seg = from ?? simSegment(pos);
  const r0 = route(here, target);
  const siguiente = r0[0] === here ? r0[1] ?? target : r0[0];
  const fromPoly = from ? edgePolyline(g, from.u, from.v) : null;
  const start = fromPoly ? (() => { const q = pointAlong(fromPoly, from!.t, aspectOf(g)).p; return { x: q[0], y: q[1] }; })() : projectSimPoint(mapId, pos);
  const points: NavPoint[] = [[start.x, start.y]];

  /* 1 · el resto del tramo actual, hacia el extremo por el que sigue el camino. */
  const hacia: ZoneId = seg.u === siguiente || seg.v === siguiente ? siguiente
    : seg.u === here || seg.v === here ? here : (seg.t < 0.5 ? seg.u : seg.v);
  const poly = edgePolyline(g, seg.u, seg.v);
  if (poly) {
    const acc = cumulative(poly, aspectOf(g));
    const at = seg.t * acc[acc.length - 1];
    if (hacia === seg.v) { for (let i = 1; i < poly.length; i++) if (acc[i] > at) points.push(poly[i]); }
    else { for (let i = poly.length - 2; i >= 0; i--) if (acc[i] < at) points.push(poly[i]); }
  }

  /* 2 · las zonas que decide el motor, con la trayectoria real de cada arista. */
  const zones: ZoneId[] = [hacia];
  let cur: ZoneId = hacia;
  for (const z of hacia === target ? [] : route(hacia, target)) {
    if (z === cur) continue;
    let tramo: NavPoint[] | null = edgePolyline(g, cur, z);
    if (!tramo) { const r = findPath(g, cur, z); tramo = r.ok ? [...r.points] : null; }
    if (!tramo) return { ok: false, reason: "NO_ROUTE" };
    points.push(...tramo.slice(1));
    zones.push(z);
    cur = z;
  }
  return { ok: true, points, zones };
}

/** Punto de un nodo táctico (0..1). */
export function nodePoint(mapId: string, zone: ZoneId): Pt {
  const n = navGraph(mapId).nodes.find((x) => x.id === zone)!;
  return { x: n.x, y: n.y };
}

/** Coordenadas normalizadas → píxeles del asset (las del `viewBox` del mapa). */
export const toMapPixels = (m: TacticalMap, p: Pt): Pt => ({ x: p.x * m.width, y: p.y * m.height });

/**
 * El encuadre del partido, en píxeles del asset: la caja de los nodos y de sus trayectorias con
 * margen, recortada al asset. Sin deformar (lo ajusta `preserveAspectRatio`).
 */
export function matchViewBox(m: TacticalMap, margin = 0.06): { x: number; y: number; w: number; h: number } {
  const g = navGraph(m.id);
  const xs: number[] = [], ys: number[] = [];
  for (const n of g.nodes) { xs.push(n.x); ys.push(n.y); }
  for (const e of g.edges) for (const w of e.waypoints) { xs.push(w[0]); ys.push(w[1]); }
  const x0 = Math.max(0, Math.min(...xs) - margin), x1 = Math.min(1, Math.max(...xs) + margin);
  const y0 = Math.max(0, Math.min(...ys) - margin), y1 = Math.min(1, Math.max(...ys) + margin);
  return { x: x0 * m.width, y: y0 * m.height, w: (x1 - x0) * m.width, h: (y1 - y0) * m.height };
}

/**
 * Cómo se DICE cada zona del modelo en pantalla. Los identificadores internos («tree»,
 * «generator»…) son del modelo abstracto y no nombran ningún sitio de los doce mapas reales: la
 * interfaz habla de la función de la zona, que sí vale en cualquiera.
 */
export const ZONE_LABEL: Record<ZoneId, string> = {
  atk_spawn: "spawn atacante", a_main: "entrada principal", a_main_choke: "boca de la entrada",
  tree: "flanco", tree_choke: "boca del flanco", mid: "mid", site: "sitio", plant: "zona de plant",
  generator: "conexión", ct: "CT", heaven: "heaven", def_spawn: "spawn defensor",
};

export type { ZoneId };
