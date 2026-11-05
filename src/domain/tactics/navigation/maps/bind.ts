/**
 * FASE 51.2 · Grafo de navegación de BIND — GENERADO por `scripts/_fase51-2-navgen.ts`
 * sobre `public/maps/bind.png` (1254 × 1254). No editar a mano: cambiar los
 * anclajes (`navigation/anchors.ts`) y regenerar. Nodos = zonas del simulador; aristas = su grafo de
 * corredores (`ADJ`) recorrido sobre el suelo real del asset; waypoints = rodeos de pared.
 */
import type { MapNavigationGraph } from "../types";

export const BIND_NAV: MapNavigationGraph = {
  mapId: "bind",
  asset: { width: 1254, height: 1254 },
  nodes: [
    { id: "atk_spawn", zone: "atk_spawn", x: 0.4705, y: 0.799 },
    { id: "a_main", zone: "a_main", x: 0.6683, y: 0.5343 },
    { id: "a_main_choke", zone: "a_main_choke", x: 0.6587, y: 0.4099 },
    { id: "tree", zone: "tree", x: 0.8405, y: 0.5215 },
    { id: "tree_choke", zone: "tree_choke", x: 0.7799, y: 0.4195 },
    { id: "mid", zone: "mid", x: 0.4896, y: 0.5821 },
    { id: "site", zone: "site", x: 0.6715, y: 0.3493 },
    { id: "plant", zone: "plant", x: 0.6491, y: 0.3589 },
    { id: "generator", zone: "generator", x: 0.6396, y: 0.4067 },
    { id: "ct", zone: "ct", x: 0.5534, y: 0.3174 },
    { id: "heaven", zone: "heaven", x: 0.6715, y: 0.26 },
    { id: "def_spawn", zone: "def_spawn", x: 0.5375, y: 0.1228 },
  ],
  edges: [
    { from: "a_main_choke", to: "mid", cost: 0.3564, halfWidth: 0.0000, waypoints: [[0.5917, 0.4322], [0.5821, 0.5183], [0.512, 0.5311]] },
    { from: "a_main_choke", to: "site", cost: 0.0777, halfWidth: 0.0048, waypoints: [] },
    { from: "a_main", to: "a_main_choke", cost: 0.2899, halfWidth: 0.0000, waypoints: [[0.5981, 0.5183], [0.5917, 0.429]] },
    { from: "a_main", to: "atk_spawn", cost: 0.5943, halfWidth: 0.0000, waypoints: [[0.5183, 0.5247], [0.4673, 0.5981], [0.429, 0.614], [0.4545, 0.7799]] },
    { from: "atk_spawn", to: "mid", cost: 0.3254, halfWidth: 0.0000, waypoints: [[0.4418, 0.7352], [0.4354, 0.6045]] },
    { from: "atk_spawn", to: "tree", cost: 0.7603, halfWidth: 0.0000, waypoints: [[0.563, 0.8915], [0.681, 0.7831], [0.7289, 0.6332]] },
    { from: "ct", to: "def_spawn", cost: 0.4101, halfWidth: 0.0000, waypoints: [[0.6045, 0.327], [0.614, 0.3238], [0.6172, 0.311], [0.6396, 0.3046], [0.6332, 0.2887], [0.5853, 0.26], [0.5821, 0.2121], [0.5439, 0.1802]] },
    { from: "ct", to: "generator", cost: 0.1704, halfWidth: 0.0000, waypoints: [[0.5566, 0.3557]] },
    { from: "ct", to: "site", cost: 0.2152, halfWidth: 0.0000, waypoints: [[0.5566, 0.3557], [0.63, 0.3844]] },
    { from: "def_spawn", to: "heaven", cost: 0.3053, halfWidth: 0.0000, waypoints: [[0.5502, 0.1898], [0.5885, 0.2217], [0.5949, 0.2695]] },
    { from: "generator", to: "mid", cost: 0.3339, halfWidth: 0.0000, waypoints: [[0.5917, 0.4354], [0.5821, 0.5183], [0.512, 0.5311]] },
    { from: "generator", to: "site", cost: 0.0823, halfWidth: 0.0048, waypoints: [] },
    { from: "heaven", to: "site", cost: 0.1376, halfWidth: 0.0000, waypoints: [[0.697, 0.3333], [0.681, 0.3493]] },
    { from: "plant", to: "site", cost: 0.0306, halfWidth: 0.0048, waypoints: [] },
    { from: "site", to: "tree_choke", cost: 0.1708, halfWidth: 0.0000, waypoints: [[0.7448, 0.3907], [0.7608, 0.4195]] },
    { from: "tree", to: "tree_choke", cost: 0.1628, halfWidth: 0.0000, waypoints: [[0.8182, 0.4992], [0.799, 0.4226]] },
  ],
};
