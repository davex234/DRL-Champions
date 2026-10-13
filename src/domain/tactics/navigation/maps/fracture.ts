/**
 * FASE 51.2 · Grafo de navegación de FRACTURE — GENERADO por `scripts/_fase51-2-navgen.ts`
 * sobre `public/maps/fracture.png` (1268 × 1240). No editar a mano: cambiar los
 * anclajes (`navigation/anchors.ts`) y regenerar. Nodos = zonas del simulador; aristas = su grafo de
 * corredores (`ADJ`) recorrido sobre el suelo real del asset; waypoints = rodeos de pared.
 */
import type { MapNavigationGraph } from "../types";

export const FRACTURE_NAV: MapNavigationGraph = {
  mapId: "fracture",
  asset: { width: 1268, height: 1240 },
  nodes: [
    { id: "atk_spawn", zone: "atk_spawn", x: 0.4211, y: 0.879 },
    { id: "a_main", zone: "a_main", x: 0.7808, y: 0.7339 },
    { id: "a_main_choke", zone: "a_main_choke", x: 0.8785, y: 0.621 },
    { id: "tree", zone: "tree", x: 0.8785, y: 0.7403 },
    { id: "tree_choke", zone: "tree_choke", x: 0.9006, y: 0.621 },
    { id: "mid", zone: "mid", x: 0.6136, y: 0.5339 },
    { id: "site", zone: "site", x: 0.8943, y: 0.5016 },
    { id: "plant", zone: "plant", x: 0.8912, y: 0.5113 },
    { id: "generator", zone: "generator", x: 0.7492, y: 0.5597 },
    { id: "ct", zone: "ct", x: 0.6293, y: 0.45 },
    { id: "heaven", zone: "heaven", x: 0.9101, y: 0.4403 },
    { id: "def_spawn", zone: "def_spawn", x: 0.5505, y: 0.1016 },
  ],
  edges: [
    { from: "a_main_choke", to: "mid", cost: 0.5511, halfWidth: 0.0000, waypoints: [[0.8407, 0.5371], [0.7019, 0.4919], [0.6735, 0.4468], [0.5978, 0.4661]] },
    { from: "a_main_choke", to: "site", cost: 0.1494, halfWidth: 0.0081, waypoints: [] },
    { from: "a_main", to: "a_main_choke", cost: 0.3154, halfWidth: 0.0000, waypoints: [[0.7965, 0.7823], [0.8628, 0.7468]] },
    { from: "a_main", to: "atk_spawn", cost: 0.6016, halfWidth: 0.0000, waypoints: [[0.6483, 0.8403], [0.6293, 0.9113], [0.4369, 0.85]] },
    { from: "atk_spawn", to: "mid", cost: 1.4010, halfWidth: 0.0000, waypoints: [[0.4464, 0.8468], [0.6325, 0.9081], [0.6893, 0.7952], [0.847, 0.7661], [0.8817, 0.5823], [0.8281, 0.5371], [0.6987, 0.4887], [0.6735, 0.4468], [0.5978, 0.4661]] },
    { from: "atk_spawn", to: "tree", cost: 0.7112, halfWidth: 0.0000, waypoints: [[0.4464, 0.8468], [0.6325, 0.9081], [0.6861, 0.7984], [0.8565, 0.7629]] },
    { from: "ct", to: "def_spawn", cost: 2.7223, halfWidth: 0.0000, waypoints: [[0.6956, 0.4661], [0.724, 0.5081], [0.8659, 0.5597], [0.8754, 0.6758], [0.8375, 0.7758], [0.6672, 0.8177], [0.6262, 0.9113], [0.4085, 0.8435], [0.3013, 0.8435], [0.1309, 0.721], [0.1435, 0.6145], [0.1972, 0.521], [0.2319, 0.4081], [0.2508, 0.3371], [0.3233, 0.2565], [0.3454, 0.1274], [0.4779, 0.1048]] },
    { from: "ct", to: "generator", cost: 0.2209, halfWidth: 0.0000, waypoints: [[0.6956, 0.4661]] },
    { from: "ct", to: "site", cost: 0.3658, halfWidth: 0.0000, waypoints: [[0.6956, 0.4661], [0.724, 0.5081]] },
    { from: "def_spawn", to: "heaven", cost: 2.5347, halfWidth: 0.0000, waypoints: [[0.3486, 0.1242], [0.2918, 0.3016], [0.2319, 0.3661], [0.2066, 0.4984], [0.1278, 0.6597], [0.1656, 0.7597], [0.3612, 0.8597], [0.5095, 0.8597], [0.6199, 0.9113], [0.6483, 0.8823], [0.6893, 0.7952], [0.847, 0.7661], [0.9069, 0.4758], [0.9132, 0.4726], [0.9132, 0.4435]] },
    { from: "generator", to: "mid", cost: 0.3568, halfWidth: 0.0000, waypoints: [[0.6767, 0.4468], [0.5978, 0.4661]] },
    { from: "generator", to: "site", cost: 0.1976, halfWidth: 0.0113, waypoints: [] },
    { from: "heaven", to: "site", cost: 0.0874, halfWidth: 0.0000, waypoints: [[0.9164, 0.4694], [0.9038, 0.479]] },
    { from: "plant", to: "site", cost: 0.0127, halfWidth: 0.0113, waypoints: [] },
    { from: "site", to: "tree_choke", cost: 0.1483, halfWidth: 0.0016, waypoints: [] },
    { from: "tree", to: "tree_choke", cost: 0.1506, halfWidth: 0.0000, waypoints: [] },
  ],
};
