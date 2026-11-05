/**
 * FASE 51.2 · Grafo de navegación de PEARL — GENERADO por `scripts/_fase51-2-navgen.ts`
 * sobre `public/maps/pearl.png` (1306 × 1204). No editar a mano: cambiar los
 * anclajes (`navigation/anchors.ts`) y regenerar. Nodos = zonas del simulador; aristas = su grafo de
 * corredores (`ADJ`) recorrido sobre el suelo real del asset; waypoints = rodeos de pared.
 */
import type { MapNavigationGraph } from "../types";

export const PEARL_NAV: MapNavigationGraph = {
  mapId: "pearl",
  asset: { width: 1306, height: 1204 },
  nodes: [
    { id: "atk_spawn", zone: "atk_spawn", x: 0.4456, y: 0.8522 },
    { id: "a_main", zone: "a_main", x: 0.8009, y: 0.5997 },
    { id: "a_main_choke", zone: "a_main_choke", x: 0.8193, y: 0.4801 },
    { id: "tree", zone: "tree", x: 0.8959, y: 0.5598 },
    { id: "tree_choke", zone: "tree_choke", x: 0.8806, y: 0.4402 },
    { id: "mid", zone: "mid", x: 0.5865, y: 0.5199 },
    { id: "site", zone: "site", x: 0.8285, y: 0.3173 },
    { id: "plant", zone: "plant", x: 0.8193, y: 0.3372 },
    { id: "generator", zone: "generator", x: 0.7029, y: 0.4203 },
    { id: "ct", zone: "ct", x: 0.66, y: 0.3007 },
    { id: "heaven", zone: "heaven", x: 0.8407, y: 0.1977 },
    { id: "def_spawn", zone: "def_spawn", x: 0.5804, y: 0.0814 },
  ],
  edges: [
    { from: "a_main_choke", to: "mid", cost: 0.5687, halfWidth: 0.0000, waypoints: [[0.7856, 0.3472], [0.6937, 0.3605], [0.6662, 0.5033]] },
    { from: "a_main_choke", to: "site", cost: 0.1964, halfWidth: 0.0017, waypoints: [] },
    { from: "a_main", to: "a_main_choke", cost: 0.2626, halfWidth: 0.0000, waypoints: [[0.8897, 0.5399], [0.8683, 0.4967]] },
    { from: "a_main", to: "atk_spawn", cost: 0.6177, halfWidth: 0.0000, waypoints: [[0.755, 0.6196], [0.7152, 0.7625], [0.4579, 0.8588]] },
    { from: "atk_spawn", to: "mid", cost: 0.5543, halfWidth: 0.0000, waypoints: [[0.4119, 0.7591], [0.4395, 0.6329], [0.5712, 0.603]] },
    { from: "atk_spawn", to: "tree", cost: 0.7524, halfWidth: 0.0000, waypoints: [[0.5712, 0.8389], [0.7274, 0.7492], [0.7734, 0.5997]] },
    { from: "ct", to: "def_spawn", cost: 0.5910, halfWidth: 0.0000, waypoints: [[0.758, 0.3372], [0.7856, 0.3073], [0.7734, 0.2508], [0.7029, 0.1545], [0.6325, 0.1312]] },
    { from: "ct", to: "generator", cost: 0.1545, halfWidth: 0.0000, waypoints: [] },
    { from: "ct", to: "site", cost: 0.2337, halfWidth: 0.0000, waypoints: [[0.758, 0.3372], [0.8254, 0.3239]] },
    { from: "def_spawn", to: "heaven", cost: 0.3909, halfWidth: 0.0000, waypoints: [[0.6662, 0.1113], [0.7856, 0.1213]] },
    { from: "generator", to: "mid", cost: 0.2185, halfWidth: 0.0000, waypoints: [[0.6508, 0.5166]] },
    { from: "generator", to: "site", cost: 0.2561, halfWidth: 0.0000, waypoints: [[0.7029, 0.3505], [0.8254, 0.3239]] },
    { from: "heaven", to: "site", cost: 0.1798, halfWidth: 0.0000, waypoints: [[0.8652, 0.2176], [0.8469, 0.3106]] },
    { from: "plant", to: "site", cost: 0.0268, halfWidth: 0.0050, waypoints: [] },
    { from: "site", to: "tree_choke", cost: 0.2529, halfWidth: 0.0000, waypoints: [[0.8315, 0.4668], [0.8714, 0.4502]] },
    { from: "tree", to: "tree_choke", cost: 0.1454, halfWidth: 0.0017, waypoints: [] },
  ],
};
