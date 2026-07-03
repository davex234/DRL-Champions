/**
 * Mapa del Vertical Slice: Ascent, SOLO zona A (abstracta y reconocible).
 * Coordenadas: x 0..1000, y 0..700. Defensa arriba (y bajo), ataque abajo (y alto).
 * Zonas + adyacencia (pathing por waypoints) + muros (LOS/cobertura) + spawns + plant.
 */
import type { Vec2, Segment } from "../geometry";
import { box, v } from "../geometry";
import type { Role } from "../attributes";

export type ZoneId =
  | "atk_spawn" | "a_main" | "a_main_choke" | "tree" | "tree_choke" | "mid"
  | "site" | "plant" | "generator" | "ct" | "heaven" | "def_spawn";

export const ZONES: Record<ZoneId, Vec2> = {
  atk_spawn: v(500, 650),
  a_main: v(370, 470),
  a_main_choke: v(370, 350),
  tree: v(170, 440),
  tree_choke: v(250, 320),
  mid: v(580, 470),
  site: v(430, 215),
  plant: v(445, 225),
  generator: v(630, 300),
  ct: v(740, 230),
  heaven: v(430, 90),
  def_spawn: v(745, 95),
};

/** Grafo de adyacencia (corredores transitables sin atravesar muros). */
export const ADJ: Record<ZoneId, ZoneId[]> = {
  atk_spawn: ["a_main", "tree", "mid"],
  a_main: ["atk_spawn", "a_main_choke"],
  a_main_choke: ["a_main", "site", "mid"],
  tree: ["atk_spawn", "tree_choke"],
  tree_choke: ["tree", "site"],
  mid: ["atk_spawn", "a_main_choke", "generator"],
  site: ["a_main_choke", "tree_choke", "plant", "generator", "heaven", "ct"],
  plant: ["site"],
  generator: ["site", "ct", "mid"],
  ct: ["site", "generator", "def_spawn"],
  heaven: ["site", "def_spawn"],
  def_spawn: ["ct", "heaven"],
};

/** Muros/cobertura (crean ángulos sin bloquear las líneas de adyacencia). */
export const WALLS: Segment[] = [
  ...box(300, 250, 28, 80), // boca de A Main (ángulo de entrada)
  ...box(300, 360, 28, 70), // pared de Tree
  ...box(540, 250, 90, 50), // cobertura Generator
  ...box(395, 170, 55, 42), // cobertura del plant por defecto
  ...box(648, 255, 26, 95), // pared del corredor CT
];

export const PLANT_ZONE: Vec2 = ZONES.plant;
export const PLANT_RADIUS = 55;

export const FIELD = { w: 1000, h: 700 };

/** Posiciones de hold de la DEFENSA por rol (a quién le toca qué ángulo). */
export const DEFENSE_HOLDS: Record<Role, ZoneId> = {
  anchor: "site",
  support: "generator",
  igl: "ct",
  lurk: "heaven",
  entry: "a_main_choke", // jugador agresivo de info hacia main
};

/** Punto de staging del ATAQUE por rol antes del execute. */
export const ATTACK_STAGING: Record<Role, ZoneId> = {
  entry: "a_main",
  igl: "a_main",
  support: "a_main",
  anchor: "mid",
  lurk: "tree",
};

const ZONE_IDS = Object.keys(ZONES) as ZoneId[];

/** Zona más cercana a una posición. */
export function nearestZone(pos: Vec2): ZoneId {
  let best: ZoneId = "site";
  let bd = Infinity;
  for (const id of ZONE_IDS) {
    const d = (ZONES[id].x - pos.x) ** 2 + (ZONES[id].y - pos.y) ** 2;
    if (d < bd) { bd = d; best = id; }
  }
  return best;
}

/** Ruta de zonas (BFS) desde `from` hasta `to`, incluyendo `to`. */
export function route(from: ZoneId, to: ZoneId): ZoneId[] {
  if (from === to) return [to];
  const prev: Partial<Record<ZoneId, ZoneId>> = {};
  const seen = new Set<ZoneId>([from]);
  const queue: ZoneId[] = [from];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const nb of ADJ[cur]) {
      if (seen.has(nb)) continue;
      seen.add(nb);
      prev[nb] = cur;
      if (nb === to) {
        const path: ZoneId[] = [to];
        let p: ZoneId | undefined = cur;
        while (p && p !== from) { path.unshift(p); p = prev[p]; }
        return path;
      }
      queue.push(nb);
    }
  }
  return [to];
}
