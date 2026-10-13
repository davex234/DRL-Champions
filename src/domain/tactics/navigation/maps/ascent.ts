/**
 * FASE 51.2 · Grafo de navegación de ASCENT — GENERADO por `scripts/_fase51-2-navgen.ts`
 * sobre `public/maps/ascent.png` (1227 × 1281). No editar a mano: cambiar los
 * anclajes (`navigation/anchors.ts`) y regenerar. Nodos = zonas del simulador; aristas = su grafo de
 * corredores (`ADJ`) recorrido sobre el suelo real del asset; waypoints = rodeos de pared.
 */
import type { MapNavigationGraph } from "../types";

export const ASCENT_NAV: MapNavigationGraph = {
  mapId: "ascent",
  asset: { width: 1227, height: 1281 },
  nodes: [
    { id: "atk_spawn", zone: "atk_spawn", x: 0.4189, y: 0.8415 },
    { id: "a_main", zone: "a_main", x: 0.7514, y: 0.5605 },
    { id: "a_main_choke", zone: "a_main_choke", x: 0.7808, y: 0.4731 },
    { id: "tree", zone: "tree", x: 0.8851, y: 0.4918 },
    { id: "tree_choke", zone: "tree_choke", x: 0.8883, y: 0.4012 },
    { id: "mid", zone: "mid", x: 0.5689, y: 0.5199 },
    { id: "site", zone: "site", x: 0.8492, y: 0.2826 },
    { id: "plant", zone: "plant", x: 0.8362, y: 0.3263 },
    { id: "generator", zone: "generator", x: 0.7188, y: 0.3794 },
    { id: "ct", zone: "ct", x: 0.6341, y: 0.2701 },
    { id: "heaven", zone: "heaven", x: 0.8492, y: 0.2295 },
    { id: "def_spawn", zone: "def_spawn", x: 0.5623, y: 0.1015 },
  ],
  edges: [
    { from: "a_main_choke", to: "mid", cost: 0.5902, halfWidth: 0.0000, waypoints: [[0.7319, 0.5043], [0.696, 0.6479], [0.5754, 0.6604]] },
    { from: "a_main_choke", to: "site", cost: 0.3231, halfWidth: 0.0000, waypoints: [[0.8557, 0.4575], [0.859, 0.292]] },
    { from: "a_main", to: "a_main_choke", cost: 0.1490, halfWidth: 0.0000, waypoints: [[0.7351, 0.4949]] },
    { from: "a_main", to: "atk_spawn", cost: 0.5920, halfWidth: 0.0000, waypoints: [[0.683, 0.6542], [0.6569, 0.6729], [0.6438, 0.7572]] },
    { from: "atk_spawn", to: "mid", cost: 0.6719, halfWidth: 0.0000, waypoints: [[0.6569, 0.7447], [0.6406, 0.676], [0.5689, 0.6542]] },
    { from: "atk_spawn", to: "tree", cost: 0.8586, halfWidth: 0.0000, waypoints: [[0.6569, 0.7447], [0.6699, 0.6542], [0.7188, 0.6261], [0.7416, 0.4887]] },
    { from: "ct", to: "def_spawn", cost: 0.2506, halfWidth: 0.0000, waypoints: [[0.621, 0.1483]] },
    { from: "ct", to: "generator", cost: 0.1964, halfWidth: 0.0000, waypoints: [[0.696, 0.292]] },
    { from: "ct", to: "site", cost: 0.4120, halfWidth: 0.0000, waypoints: [[0.696, 0.292], [0.7221, 0.37], [0.784, 0.3763], [0.8297, 0.3263], [0.8362, 0.292]] },
    { from: "def_spawn", to: "heaven", cost: 0.4369, halfWidth: 0.0000, waypoints: [[0.6275, 0.1421], [0.7514, 0.1577], [0.7742, 0.2295]] },
    { from: "generator", to: "mid", cost: 0.2873, halfWidth: 0.0000, waypoints: [[0.6569, 0.4169], [0.6341, 0.445], [0.5721, 0.4637]] },
    { from: "generator", to: "site", cost: 0.2285, halfWidth: 0.0000, waypoints: [[0.7873, 0.3731], [0.8297, 0.3263], [0.8362, 0.292]] },
    { from: "heaven", to: "site", cost: 0.8662, halfWidth: 0.0000, waypoints: [[0.7612, 0.217], [0.7384, 0.1452], [0.6471, 0.1577], [0.6373, 0.2607], [0.7058, 0.3013], [0.7221, 0.37], [0.784, 0.3763], [0.8297, 0.3263], [0.8362, 0.292]] },
    { from: "plant", to: "site", cost: 0.0674, halfWidth: 0.0000, waypoints: [[0.8297, 0.3044], [0.846, 0.2826]] },
    { from: "site", to: "tree_choke", cost: 0.1594, halfWidth: 0.0000, waypoints: [[0.8753, 0.3544]] },
    { from: "tree", to: "tree_choke", cost: 0.1361, halfWidth: 0.0000, waypoints: [[0.8623, 0.42]] },
  ],
};
