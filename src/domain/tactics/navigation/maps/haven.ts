/**
 * FASE 51.2 · Grafo de navegación de HAVEN — GENERADO por `scripts/_fase51-2-navgen.ts`
 * sobre `public/maps/haven.png` (1216 × 1293). No editar a mano: cambiar los
 * anclajes (`navigation/anchors.ts`) y regenerar. Nodos = zonas del simulador; aristas = su grafo de
 * corredores (`ADJ`) recorrido sobre el suelo real del asset; waypoints = rodeos de pared.
 */
import type { MapNavigationGraph } from "../types";

export const HAVEN_NAV: MapNavigationGraph = {
  mapId: "haven",
  asset: { width: 1216, height: 1293 },
  nodes: [
    { id: "atk_spawn", zone: "atk_spawn", x: 0.4194, y: 0.8894 },
    { id: "a_main", zone: "a_main", x: 0.8043, y: 0.5893 },
    { id: "a_main_choke", zone: "a_main_choke", x: 0.8174, y: 0.4811 },
    { id: "tree", zone: "tree", x: 0.9194, y: 0.5491 },
    { id: "tree_choke", zone: "tree_choke", x: 0.9194, y: 0.4439 },
    { id: "mid", zone: "mid", x: 0.6003, y: 0.5491 },
    { id: "site", zone: "site", x: 0.8865, y: 0.3542 },
    { id: "plant", zone: "plant", x: 0.8635, y: 0.3944 },
    { id: "generator", zone: "generator", x: 0.7516, y: 0.4749 },
    { id: "ct", zone: "ct", x: 0.6628, y: 0.348 },
    { id: "heaven", zone: "heaven", x: 0.8799, y: 0.2892 },
    { id: "def_spawn", zone: "def_spawn", x: 0.551, y: 0.1005 },
  ],
  edges: [
    { from: "a_main_choke", to: "mid", cost: 0.3184, halfWidth: 0.0000, waypoints: [[0.6365, 0.4811], [0.6069, 0.5336]] },
    { from: "a_main_choke", to: "site", cost: 0.1979, halfWidth: 0.0000, waypoints: [[0.8339, 0.4285], [0.8898, 0.3821]] },
    { from: "a_main", to: "a_main_choke", cost: 0.3669, halfWidth: 0.0000, waypoints: [[0.8865, 0.5213], [0.8668, 0.4285], [0.8174, 0.4439]] },
    { from: "a_main", to: "atk_spawn", cost: 0.6776, halfWidth: 0.0000, waypoints: [[0.6365, 0.6357], [0.5378, 0.7688], [0.4885, 0.7966], [0.4753, 0.8863]] },
    { from: "atk_spawn", to: "mid", cost: 0.5653, halfWidth: 0.0000, waypoints: [[0.4885, 0.8739], [0.5016, 0.7811], [0.6036, 0.7007]] },
    { from: "atk_spawn", to: "tree", cost: 0.8250, halfWidth: 0.0000, waypoints: [[0.4885, 0.8739], [0.5016, 0.7811], [0.6036, 0.7007], [0.6563, 0.6203], [0.9161, 0.5522]] },
    { from: "ct", to: "def_spawn", cost: 0.3772, halfWidth: 0.0000, waypoints: [[0.6826, 0.3171], [0.6398, 0.1903]] },
    { from: "ct", to: "generator", cost: 0.4394, halfWidth: 0.0000, waypoints: [[0.7122, 0.2862], [0.778, 0.3016], [0.7845, 0.4687]] },
    { from: "ct", to: "site", cost: 0.3347, halfWidth: 0.0000, waypoints: [[0.7122, 0.2862], [0.778, 0.3016], [0.824, 0.3387]] },
    { from: "def_spawn", to: "heaven", cost: 0.4974, halfWidth: 0.0000, waypoints: [[0.7253, 0.215], [0.8372, 0.2367], [0.8569, 0.2892]] },
    { from: "generator", to: "mid", cost: 0.2386, halfWidth: 0.0000, waypoints: [[0.6365, 0.4811], [0.6069, 0.5336]] },
    { from: "generator", to: "site", cost: 0.2444, halfWidth: 0.0000, waypoints: [[0.801, 0.4532], [0.8898, 0.3821]] },
    { from: "heaven", to: "site", cost: 0.5944, halfWidth: 0.0000, waypoints: [[0.8405, 0.2769], [0.8174, 0.2181], [0.6924, 0.2336], [0.7056, 0.2831], [0.778, 0.3016], [0.824, 0.3387]] },
    { from: "plant", to: "site", cost: 0.0731, halfWidth: 0.0000, waypoints: [[0.8865, 0.3882]] },
    { from: "site", to: "tree_choke", cost: 0.1227, halfWidth: 0.0000, waypoints: [] },
    { from: "tree", to: "tree_choke", cost: 0.1533, halfWidth: 0.0000, waypoints: [[0.8931, 0.5058], [0.9161, 0.4439]] },
  ],
};
