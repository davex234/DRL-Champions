/**
 * TACTICAL INTELLIGENCE ENGINE — Abstracción de mapa por CARRILES.
 *
 * Traduce conceptos a la geometría del slice (Ascent zona A) sin que los conceptos
 * conozcan zonas concretas: un carril tiene stage (de dónde sale), choke (por dónde
 * entra) y converge en el sitio. Cambiar de mapa = reescribir solo este archivo.
 */
import { dist, type Vec2 } from "../sim/geometry";
import { ZONES, type ZoneId } from "../sim/map/ascentA";
import type { Lane } from "./types";
import { LANES } from "./types";

/** Punto de staging del carril (dónde se prepara el ataque). */
export const LANE_STAGE: Record<Lane, ZoneId> = { main: "a_main", tree: "tree", mid: "mid" };
/** Choke del carril (puerta de entrada al sitio). */
export const LANE_CHOKE: Record<Lane, ZoneId> = { main: "a_main_choke", tree: "tree_choke", mid: "generator" };
/** Dónde aguanta la defensa para tapar ese carril. */
export const LANE_HOLD: Record<Lane, ZoneId> = { main: "a_main_choke", tree: "tree_choke", mid: "generator" };

export const SITE: ZoneId = "site";
export const PLANT: ZoneId = "plant";
/** Posiciones traseras de la defensa (anclas / juego de tiempos). */
export const BACK_HOLDS: ZoneId[] = ["ct", "heaven"];

/** Clasifica una posición al carril más cercano (por su choke/stage). */
export function laneOfPos(pos: Vec2): Lane {
  let best: Lane = "main";
  let bd = Infinity;
  for (const lane of LANES) {
    const d = Math.min(dist(pos, ZONES[LANE_CHOKE[lane]]), dist(pos, ZONES[LANE_STAGE[lane]]));
    if (d < bd) { bd = d; best = lane; }
  }
  return best;
}

/** Carril "opuesto" para fintas/rehit (evita repetir el mismo). */
export function otherLane(lane: Lane, avoid?: Lane): Lane {
  const opts = LANES.filter((l) => l !== lane && l !== avoid);
  return opts[0] ?? LANES.find((l) => l !== lane) ?? "mid";
}

/**
 * En este slice de un solo sitio, el ATAQUE en grupo solo es transitable por Main y
 * Mid (el carril Tree clipa la celda de A-Main en el grafo de waypoints y oscila; se
 * reserva para el lurk/holds defensivos). La defensa sí lee/aguanta los 3 carriles.
 */
export const ATTACK_LANES: Lane[] = ["main", "mid"];
export const toAttackLane = (l: Lane): Lane => (l === "tree" ? "mid" : l);
export const otherAttackLane = (l: Lane): Lane => (toAttackLane(l) === "main" ? "mid" : "main");
