/**
 * FASE 51.2 · Grafo de navegación de BREEZE — GENERADO por `scripts/_fase51-2-navgen.ts`
 * sobre `public/maps/breeze.png` (1272 × 1236). No editar a mano: cambiar los
 * anclajes (`navigation/anchors.ts`) y regenerar. Nodos = zonas del simulador; aristas = su grafo de
 * corredores (`ADJ`) recorrido sobre el suelo real del asset; waypoints = rodeos de pared.
 */
import type { MapNavigationGraph } from "../types";

export const BREEZE_NAV: MapNavigationGraph = {
  mapId: "breeze",
  asset: { width: 1272, height: 1236 },
  nodes: [
    { id: "atk_spawn", zone: "atk_spawn", x: 0.4198, y: 0.8786 },
    { id: "a_main", zone: "a_main", x: 0.7814, y: 0.6294 },
    { id: "a_main_choke", zone: "a_main_choke", x: 0.8192, y: 0.5615 },
    { id: "tree", zone: "tree", x: 0.9104, y: 0.568 },
    { id: "tree_choke", zone: "tree_choke", x: 0.9104, y: 0.5097 },
    { id: "mid", zone: "mid", x: 0.5613, y: 0.5194 },
    { id: "site", zone: "site", x: 0.8789, y: 0.4159 },
    { id: "plant", zone: "plant", x: 0.8506, y: 0.445 },
    { id: "generator", zone: "generator", x: 0.7186, y: 0.5194 },
    { id: "ct", zone: "ct", x: 0.6399, y: 0.3479 },
    { id: "heaven", zone: "heaven", x: 0.8664, y: 0.3414 },
    { id: "def_spawn", zone: "def_spawn", x: 0.5991, y: 0.0793 },
  ],
  edges: [
    { from: "a_main_choke", to: "mid", cost: 0.4234, halfWidth: 0.0000, waypoints: [[0.794, 0.5065], [0.6494, 0.4547], [0.5896, 0.4709], [0.5613, 0.5]] },
    { from: "a_main_choke", to: "site", cost: 0.2978, halfWidth: 0.0000, waypoints: [[0.9292, 0.4871], [0.9198, 0.4256]] },
    { from: "a_main", to: "a_main_choke", cost: 0.1721, halfWidth: 0.0000, waypoints: [[0.8538, 0.61], [0.8349, 0.5712]] },
    { from: "a_main", to: "atk_spawn", cost: 0.5780, halfWidth: 0.0000, waypoints: [[0.7217, 0.7168], [0.6053, 0.801], [0.4544, 0.8366]] },
    { from: "atk_spawn", to: "mid", cost: 0.4972, halfWidth: 0.0000, waypoints: [[0.445, 0.6877], [0.5204, 0.5518]] },
    { from: "atk_spawn", to: "tree", cost: 0.7737, halfWidth: 0.0000, waypoints: [[0.4827, 0.8172], [0.6619, 0.7783], [0.7972, 0.6294], [0.8569, 0.61], [0.8852, 0.5647]] },
    { from: "ct", to: "def_spawn", cost: 0.3748, halfWidth: 0.0000, waypoints: [[0.6336, 0.2282], [0.5896, 0.2152]] },
    { from: "ct", to: "generator", cost: 0.2946, halfWidth: 0.0000, waypoints: [[0.6997, 0.3511], [0.7343, 0.4417]] },
    { from: "ct", to: "site", cost: 0.3284, halfWidth: 0.0000, waypoints: [[0.6997, 0.3511], [0.7752, 0.4094]] },
    { from: "def_spawn", to: "heaven", cost: 0.6300, halfWidth: 0.0000, waypoints: [[0.6022, 0.2282], [0.6431, 0.2411], [0.6557, 0.3382], [0.8192, 0.3285]] },
    { from: "generator", to: "mid", cost: 0.2835, halfWidth: 0.0000, waypoints: [[0.6745, 0.4547], [0.5991, 0.4644], [0.5613, 0.5]] },
    { from: "generator", to: "site", cost: 0.2890, halfWidth: 0.0000, waypoints: [[0.7657, 0.4126]] },
    { from: "heaven", to: "site", cost: 0.0934, halfWidth: 0.0016, waypoints: [] },
    { from: "plant", to: "site", cost: 0.0557, halfWidth: 0.0000, waypoints: [[0.8601, 0.4223]] },
    { from: "site", to: "tree_choke", cost: 0.1648, halfWidth: 0.0000, waypoints: [[0.923, 0.4288], [0.9198, 0.5032]] },
    { from: "tree", to: "tree_choke", cost: 0.0721, halfWidth: 0.0049, waypoints: [] },
  ],
};
