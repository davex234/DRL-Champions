/**
 * SPATIAL SIMULATION ENGINE — Adaptador del mapa del slice (Ascent zona A).
 *
 * Construye un `MapDescriptor` a partir de la geometría del sim (ZONES/ADJ/WALLS) y
 * memoiza el `SpatialMap`. El Spatial Engine NO conoce este mapa: solo este archivo lo
 * traduce. Otro mapa = otro adaptador, sin tocar el resto del módulo.
 */
import { ZONES, ADJ, WALLS, FIELD, type ZoneId } from "../sim/map/ascentA";
import type { MapDescriptor, SpatialMap } from "./types";
import { buildSpatialMap } from "./build";

const TAGS: Record<ZoneId, string[]> = {
  atk_spawn: ["spawn:ATK"],
  def_spawn: ["spawn:DEF"],
  a_main: ["connector"],
  a_main_choke: ["choke"],
  tree: ["connector"],
  tree_choke: ["choke"],
  mid: ["mid", "connector"],
  site: ["site"],
  plant: ["site", "plant"],
  generator: ["choke", "connector"],
  ct: ["back", "anchor"],
  heaven: ["back", "anchor"],
};

const RADIUS: Partial<Record<ZoneId, number>> = { site: 50, mid: 48, plant: 40, generator: 42 };

export function ascentDescriptor(): MapDescriptor {
  const ids = Object.keys(ZONES) as ZoneId[];
  const zones = ids.map((id) => ({
    id, pos: ZONES[id], radius: RADIUS[id] ?? 34, tags: TAGS[id] ?? [],
  }));
  const seen = new Set<string>();
  const links: [string, string][] = [];
  for (const u of ids) {
    for (const v of ADJ[u]) {
      const k = u < v ? `${u}|${v}` : `${v}|${u}`;
      if (seen.has(k)) continue;
      seen.add(k);
      links.push([u, v]);
    }
  }
  return { field: { w: FIELD.w, h: FIELD.h }, zones, walls: [...WALLS], links };
}

let _cached: SpatialMap | null = null;
/** SpatialMap del slice (se construye una vez). */
export function ascentSpatial(): SpatialMap {
  if (!_cached) _cached = buildSpatialMap(ascentDescriptor());
  return _cached;
}
