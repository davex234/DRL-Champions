/**
 * FASE 51.2 · TACTICAL NAVIGATION — pruebas sobre los DOCE mapas, contra sus PNG reales.
 *
 * Lo que se demuestra aquí no es «el JSON carga»: se lee cada asset (`public/maps/*.png`), se clasifica
 * cada píxel con el mismo clasificador del generador, y se comprueba que nodos, trayectorias y las
 * posiciones de jugadores de rondas SIMULADAS de verdad caen sobre SUELO — nunca pared ni fondo.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { renderToStaticMarkup } from "react-dom/server";
import { availableMaps } from "@/domain/tactics/maps";
import { NAV_GRAPHS } from "./maps";
import { findPath } from "./pathfinding";
import { validateNavGraph } from "./validation";
import { pixelClassAt, type RawImage } from "./walkability";
import type { MapNavigationGraph, NavPoint } from "./types";
import {
  getNavPath, projectSimPoint, plannedRoute, simSegment, SIM_EDGES, isMatchMapId, navGraph, InvalidMatchMapError,
} from "@/domain/tactics/matchMap";
import { ZONES, createRound, tick as simTick, type CoachSetup, type ZoneId } from "@/sim";
import { createViewport } from "@/camera";
import { buildRenderFrame } from "@/visualizer";
import { simulateMatch } from "@/match/engine";
import { makeMatchConfig } from "@/match/config";
import { DEMO_HOME, DEMO_AWAY } from "@/sim/mapping/demoRoster";
import { MapMatchBoard } from "@/components/coach/MapMatchBoard";
import { WALL_CASES } from "@/app/design-system/fase51-2/wallCases";

const ROOT = process.cwd();
const IDS = availableMaps().map((m) => m.id);
const ZONE_IDS = Object.keys(ZONES) as ZoneId[];
const SETUP: CoachSetup = { side: "ATK", approach: "default", tempo: "mid", aggression: "balanced" };

const IMGS = new Map<string, RawImage>();
async function img(id: string): Promise<RawImage> {
  const hit = IMGS.get(id); if (hit) return hit;
  const m = availableMaps().find((x) => x.id === id)!;
  const { data, info } = await sharp(join(ROOT, "public", "maps", m.asset)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const r = { width: info.width, height: info.height, channels: info.channels, data };
  IMGS.set(id, r);
  return r;
}
const onFloor = (im: RawImage, p: NavPoint) => pixelClassAt(im, p[0] * im.width, p[1] * im.height) === "floor";

/** Muestras cada ~1,5 px a lo largo de una polilínea; devuelve las que NO son suelo. */
function badSamples(im: RawImage, pts: readonly NavPoint[]): NavPoint[] {
  const bad: NavPoint[] = [];
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = [pts[i - 1][0] * im.width, pts[i - 1][1] * im.height];
    const [bx, by] = [pts[i][0] * im.width, pts[i][1] * im.height];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 1.5));
    for (let k = 0; k <= n; k++) {
      const x = ax + ((bx - ax) * k) / n, y = ay + ((by - ay) * k) / n;
      if (pixelClassAt(im, x, y) !== "floor") bad.push([x / im.width, y / im.height]);
    }
  }
  return bad;
}
const polyLen = (im: RawImage, pts: readonly NavPoint[]) => pts.slice(1).reduce((s, p, i) => s + Math.hypot((p[0] - pts[i][0]) * im.width, (p[1] - pts[i][1]) * im.height), 0);

/* ═══════════ LOS DOCE GRAFOS ═══════════ */

test("F512 G0 · un grafo por mapa del catálogo, y solo esos", () => {
  assert.equal(IDS.length, 12);
  assert.deepEqual(Object.keys(NAV_GRAPHS).sort(), [...IDS].sort());
});

for (const id of IDS) {
  test(`F512 G1 · ${id}: grafo válido (ids, coordenadas 0..1, aristas, costes, waypoints, conectividad)`, async () => {
    const g = NAV_GRAPHS[id];
    assert.equal(g.mapId, id);
    const im = await img(id);
    assert.deepEqual([g.asset.width, g.asset.height], [im.width, im.height], "derivado del asset actual");
    assert.deepEqual(validateNavGraph(g, ZONE_IDS), []);
    // Cada arista del modelo del simulador tiene su trayectoria real.
    for (const [u, v] of SIM_EDGES) assert.ok(g.edges.some((e) => (e.from === u && e.to === v) || (e.from === v && e.to === u)), `${id}: ${u}–${v}`);
    // Todas las zonas se alcanzan desde los dos spawns.
    for (const from of ["atk_spawn", "def_spawn"]) for (const to of ZONE_IDS) assert.ok(findPath(g, from, to).ok, `${id}: ${from}→${to}`);
  });

  test(`F512 G2 · ${id}: nodos y TODAS las trayectorias sobre suelo real del PNG (ni pared ni fondo)`, async () => {
    const g = NAV_GRAPHS[id];
    const im = await img(id);
    for (const n of g.nodes) assert.ok(onFloor(im, [n.x, n.y]), `${id}: nodo ${n.id} fuera del suelo`);
    const pos = new Map(g.nodes.map((n) => [n.id, [n.x, n.y] as NavPoint]));
    for (const e of g.edges) {
      const pts = [pos.get(e.from)!, ...e.waypoints, pos.get(e.to)!];
      const bad = badSamples(im, pts);
      assert.equal(bad.length, 0, `${id}: ${e.from}→${e.to} cruza ${bad.length} píxeles no transitables (p. ej. ${bad[0]})`);
      assert.ok(Math.abs(polyLen(im, pts) / 1000 - e.cost) < 0.01, `${id}: coste de ${e.from}→${e.to}`);
    }
  });

  test(`F512 G3 · ${id}: jugadores de rondas SIMULADAS siempre sobre suelo (no atraviesan paredes)`, async () => {
    const im = await img(id);
    let s = createRound(11, SETUP);
    let fuera = 0, total = 0;
    for (let t = 0; t < 900; t++) {
      s = simTick(s);
      if (t % 3) continue;
      for (const p of s.players) {
        const q = projectSimPoint(id, p.pos);
        total++;
        if (!onFloor(im, [q.x, q.y])) fuera++;
      }
    }
    assert.ok(total > 1000);
    assert.equal(fuera, 0, `${id}: ${fuera}/${total} posiciones fuera del suelo`);
  });

  test(`F512 G4 · ${id}: rutas previstas por los waypoints, sobre suelo, y el tablero las pinta`, async () => {
    const im = await img(id);
    let s = createRound(3, SETUP);
    for (let t = 0; t < 60; t++) s = simTick(s);
    let rutas = 0;
    for (const p of s.players) {
      if (!p.alive) continue;
      const r = plannedRoute(id, p.pos, p.targetZone);
      if (!r.ok) continue;
      rutas++;
      assert.equal(badSamples(im, r.points).length, 0, `${id}: ruta de ${p.id} fuera del suelo`);
    }
    assert.ok(rutas > 0, "hay jugadores con ruta");
    const h = renderToStaticMarkup(<MapMatchBoard frame={buildRenderFrame({ state: s, viewport: createViewport() })} mapId={id} snap={s} />);
    const lines = [...h.matchAll(/<polyline[^>]*data-route="[^"]+"[^>]*points="([^"]+)"/g)];
    assert.ok(lines.length > 0, "el tablero dibuja las rutas");
    assert.ok(lines.some((m) => m[1].trim().split(" ").length > 2), "al menos una ruta con waypoints (no una recta)");
  });
}

/* ═══════════ PAREDES: la recta NO es la ruta ═══════════ */

test("F512 W1 · Ascent: nodos cercanos en pantalla con una pared entre ellos → la ruta la rodea", async () => {
  const id = "ascent";
  const g = NAV_GRAPHS[id];
  const im = await img(id);
  // Nodos a menos de 450 px en recta, con una PARED de verdad en medio (≥ 6 muestras, no una letra).
  let mejor: { a: string; b: string; d: number } | null = null;
  for (const a of g.nodes) for (const b of g.nodes) {
    if (a.id >= b.id) continue;
    const recta: NavPoint[] = [[a.x, a.y], [b.x, b.y]];
    const d = polyLen(im, recta);
    if (d < 120 || d > 450 || badSamples(im, recta).length < 6) continue;
    if (!mejor || d < mejor.d) mejor = { a: a.id, b: b.id, d };
  }
  assert.ok(mejor, "existe un par separado por geometría");
  const r = getNavPath(id, mejor!.a, mejor!.b);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.ok(r.points.length > 2, "la ruta tiene puntos intermedios");
  assert.equal(badSamples(im, r.points).length, 0, "la ruta no cruza la pared");
  assert.ok(polyLen(im, r.points) > mejor!.d * 1.15, "la ruta rodea: es más larga que la recta");
  // Y el caso que enseña el arnés visual (el rodeo más claro) cumple lo mismo.
  const [ca, cb] = WALL_CASES.ascent;
  const rc = getNavPath(id, ca, cb);
  assert.ok(rc.ok && rc.points.length > 2 && badSamples(im, rc.points).length === 0);
});

for (const id of IDS) {
  test(`F512 W2 · ${id}: al menos una arista necesita waypoints (la recta entre sus nodos cruza geometría)`, async () => {
    const g = NAV_GRAPHS[id];
    const im = await img(id);
    const pos = new Map(g.nodes.map((n) => [n.id, [n.x, n.y] as NavPoint]));
    const rodeos = g.edges.filter((e) => e.waypoints.length > 0 && badSamples(im, [pos.get(e.from)!, pos.get(e.to)!]).length > 0);
    assert.ok(rodeos.length > 0, `${id}: ninguna arista rodea geometría`);
  });
}

/* ═══════════ PATHFINDING ═══════════ */

test("F512 P1 · determinista: mismo mapa, origen y destino → mismo camino (también con un grafo clonado)", () => {
  for (const id of IDS) {
    const a = getNavPath(id, "atk_spawn", "heaven");
    const b = getNavPath(id, "atk_spawn", "heaven");
    const c = findPath(JSON.parse(JSON.stringify(NAV_GRAPHS[id])) as MapNavigationGraph, "atk_spawn", "heaven");
    assert.deepEqual(a, b);
    assert.deepEqual(a, c);
  }
});

test("F512 P2 · sin ruta → NO_ROUTE (ni recta ni teletransporte); nodo o mapa desconocidos, seguros", () => {
  const g: MapNavigationGraph = {
    mapId: "x", asset: { width: 100, height: 100 },
    nodes: [{ id: "a", x: 0.1, y: 0.1 }, { id: "b", x: 0.2, y: 0.1 }, { id: "isla", x: 0.9, y: 0.9 }],
    edges: [{ from: "a", to: "b", cost: 0.01, waypoints: [] }],
  };
  assert.deepEqual(findPath(g, "a", "isla"), { ok: false, reason: "NO_ROUTE" });
  assert.deepEqual(findPath(g, "a", "nope"), { ok: false, reason: "UNKNOWN_NODE" });
  assert.deepEqual(getNavPath("generic-map", "a", "b"), { ok: false, reason: "UNKNOWN_MAP" });
  assert.ok(findPath(g, "a", "b").ok);
  assert.ok(validateNavGraph(g, ["a"]).some((i) => i.code === "UNREACHABLE" && i.detail === "isla"));
  assert.equal(isMatchMapId("generic-map"), false);
  assert.throws(() => navGraph("generic-map"), InvalidMatchMapError);
});

test("F512 P3 · aristas de un sentido: se respetan", () => {
  const g: MapNavigationGraph = {
    mapId: "x", asset: { width: 100, height: 100 },
    nodes: [{ id: "a", x: 0.1, y: 0.1 }, { id: "b", x: 0.2, y: 0.1 }],
    edges: [{ from: "a", to: "b", cost: 0.01, waypoints: [[0.15, 0.2]], oneWay: true }],
  };
  const r = findPath(g, "a", "b");
  assert.ok(r.ok && r.points.length === 3, "sigue el waypoint");
  assert.deepEqual(findPath(g, "b", "a"), { ok: false, reason: "NO_ROUTE" });
});

test("F512 V1 · un grafo malformado se detecta (ids, coordenadas, aristas, costes, waypoints, nodos exigidos)", () => {
  const malo = {
    mapId: "x", asset: { width: 1, height: 1 },
    nodes: [{ id: "a", x: 0.1, y: 0.1 }, { id: "a", x: 0.2, y: 0.2 }, { id: "c", x: 1.5, y: -1 }],
    edges: [
      { from: "a", to: "a", cost: 1, waypoints: [] },
      { from: "a", to: "zzz", cost: 1, waypoints: [] },
      { from: "a", to: "c", cost: 0, waypoints: [[2, 2]] },
      { from: "c", to: "a", cost: 1, waypoints: [] },
    ],
  } as unknown as MapNavigationGraph;
  const codes = new Set(validateNavGraph(malo, ["a", "site"]).map((i) => i.code));
  for (const c of ["DUPLICATE_NODE", "NODE_COORD", "MISSING_NODE", "SELF_EDGE", "EDGE_ENDPOINT", "EDGE_COST", "WAYPOINT", "DUPLICATE_EDGE"]) {
    assert.ok(codes.has(c), c);
  }
});

/* ═══════════ ADAPTADOR SIMULACIÓN → MAPA ═══════════ */

test("F512 A1 · la posición abstracta se lleva a su tramo y a la trayectoria real de ese tramo", () => {
  for (const id of IDS) {
    const g = NAV_GRAPHS[id];
    for (const z of ZONE_IDS) {
      const n = g.nodes.find((x) => x.id === z)!;
      const p = projectSimPoint(id, ZONES[z]);
      assert.ok(Math.hypot(p.x - n.x, p.y - n.y) < 0.006, `${id}/${z} cae en su nodo`);
    }
    // El punto medio de un tramo abstracto cae SOBRE la polilínea real de esa arista.
    for (const [u, v] of SIM_EDGES) {
      const mid = { x: (ZONES[u].x + ZONES[v].x) / 2, y: (ZONES[u].y + ZONES[v].y) / 2 };
      const seg = simSegment(mid);
      assert.deepEqual([seg.u, seg.v].sort(), [u, v].sort());
    }
  }
});

test("F512 A2 · el motor NO cambia: mismo seed con y sin mapa → mismo partido (marcador, rondas, economía)", () => {
  const base = { seed: 424242, rosters: { home: DEMO_HOME, away: DEMO_AWAY }, homeSetup: SETUP };
  const a = simulateMatch(makeMatchConfig(base));
  const b = simulateMatch(makeMatchConfig({ ...base, mapId: "lotus" }));
  assert.deepEqual(a.score, b.score);
  assert.equal(a.history.length, b.history.length);
  assert.deepEqual(a.history.map((h) => JSON.stringify(h)), b.history.map((h) => JSON.stringify(h)));
});

/* ═══════════ CONTRATOS DEL RENDER ═══════════ */

const BOARD = readFileSync(join(ROOT, "src", "components", "coach", "MapMatchBoard.tsx"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

test("F512 R1 · el tablero no dibuja rectas inicio→destino: rutas del grafo, sin líneas de enfrentamiento", () => {
  assert.match(BOARD, /plannedRoute\(map\.id, p\.pos, p\.targetZone, trackers\.current\.get/);
  assert.match(BOARD, /new NavTracker\(map\.id\)/, "las fichas se mueven con el tracker (por el grafo)");
  assert.match(BOARD, /<polyline/);
  assert.ok(!/e\.kind === "engagement"/.test(BOARD), "sin la recta tirador→objetivo");
  assert.ok(!/ZONES\[|findPath|astar|dijkstra/i.test(BOARD), "el componente no calcula rutas: solo dibuja");
  assert.ok(!/<line[^>]*e\.to\b/.test(BOARD));
});

test("F512 R2 · movimiento reducido: la geometría no depende de la preferencia (mismo camino)", () => {
  assert.ok(!/matchMedia|prefers-reduced-motion|reduced/i.test(BOARD.replace(/movimiento reducido/gi, "")));
});

/* ═══════════ NAV TRACKER: sin saltos, sin rectas ═══════════ */

import { NavTracker, maxStepPerTick } from "./tracker";

for (const id of IDS) {
  test(`F512 T1 · ${id}: la ficha nunca salta (≤ tope por tick) y siempre pisa suelo`, async () => {
    const im = await img(id);
    const cap = maxStepPerTick(id);
    let peor = 0, fuera = 0, n = 0;
    for (const seed of [5, 17]) {
      let s = createRound(seed, SETUP);
      const tr = new Map<string, NavTracker>(); const prev = new Map<string, { x: number; y: number }>();
      for (let t = 0; t < 1200; t++) {
        s = simTick(s);
        for (const p of s.players) {
          if (!p.alive) continue;
          if (!tr.has(p.id)) tr.set(p.id, new NavTracker(id));
          const q = tr.get(p.id)!.update(p.pos, s.tick);
          n++;
          if (!onFloor(im, [q.x, q.y])) fuera++;
          const o = prev.get(p.id);
          // Distancia en unidades de alto del asset (las del tope), con margen para la separación lateral.
          if (o) peor = Math.max(peor, Math.hypot((q.x - o.x) * (im.width / im.height), q.y - o.y));
          prev.set(p.id, q);
        }
      }
    }
    assert.ok(n > 2000);
    assert.equal(fuera, 0, `${id}: ${fuera}/${n} posiciones del tracker fuera del suelo`);
    assert.ok(peor <= cap * 1.02 + 0.01, `${id}: salto ${peor.toFixed(4)} > tope ${cap.toFixed(4)}`);
  });
}

test("F512 T2 · si el motor sigue en el mismo tramo, la ficha coincide con la proyección; determinista; ronda nueva recoloca", () => {
  const id = "ascent";
  const a = new NavTracker(id), b = new NavTracker(id);
  const mid = { x: (ZONES.atk_spawn.x + ZONES.a_main.x) / 2, y: (ZONES.atk_spawn.y + ZONES.a_main.y) / 2 };
  const p0 = a.update(ZONES.atk_spawn, 1);
  assert.deepEqual(p0, b.update(ZONES.atk_spawn, 1));
  for (let t = 2; t < 40; t++) { a.update(mid, t); b.update(mid, t); }
  const pa = a.update(mid, 40), pr = projectSimPoint(id, mid);
  assert.ok(Math.hypot(pa.x - pr.x, pa.y - pr.y) < 1e-6, "alcanza la proyección por su tramo");
  assert.deepEqual(pa, b.update(mid, 40), "determinista");
  // Salto lejano a otro tramo: NO llega de golpe (un tick), sino por el grafo.
  const lejos = a.update(ZONES.heaven, 41);
  const destino = projectSimPoint(id, ZONES.heaven);
  assert.ok(Math.hypot(lejos.x - destino.x, lejos.y - destino.y) > 0.02, "no se teletransporta");
  // Ronda nueva (tick menor): se coloca sin recorrer.
  const nueva = a.update(ZONES.def_spawn, 1);
  const dp = projectSimPoint(id, ZONES.def_spawn);
  assert.ok(Math.hypot(nueva.x - dp.x, nueva.y - dp.y) < 1e-6);
});
