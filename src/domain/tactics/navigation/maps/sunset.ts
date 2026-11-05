/**
 * FASE 51.2 · Grafo de navegación de SUNSET — GENERADO por `scripts/_fase51-2-navgen.ts`
 * sobre `public/maps/sunset.png` (1236 × 1272). No editar a mano: cambiar los
 * anclajes (`navigation/anchors.ts`) y regenerar. Nodos = zonas del simulador; aristas = su grafo de
 * corredores (`ADJ`) recorrido sobre el suelo real del asset; waypoints = rodeos de pared.
 */
import type { MapNavigationGraph } from "../types";

export const SUNSET_NAV: MapNavigationGraph = {
  mapId: "sunset",
  asset: { width: 1236, height: 1272 },
  nodes: [
    { id: "atk_spawn", zone: "atk_spawn", x: 0.4579, y: 0.8789 },
    { id: "a_main", zone: "a_main", x: 0.7816, y: 0.5802 },
    { id: "a_main_choke", zone: "a_main_choke", x: 0.7913, y: 0.4796 },
    { id: "tree", zone: "tree", x: 0.9207, y: 0.5016 },
    { id: "tree_choke", zone: "tree_choke", x: 0.9207, y: 0.4198 },
    { id: "mid", zone: "mid", x: 0.5809, y: 0.5079 },
    { id: "site", zone: "site", x: 0.801, y: 0.3695 },
    { id: "plant", zone: "plant", x: 0.7816, y: 0.3789 },
    { id: "generator", zone: "generator", x: 0.7265, y: 0.4858 },
    { id: "ct", zone: "ct", x: 0.6262, y: 0.294 },
    { id: "heaven", zone: "heaven", x: 0.801, y: 0.2594 },
    { id: "def_spawn", zone: "def_spawn", x: 0.5388, y: 0.0991 },
  ],
  edges: [
    { from: "a_main_choke", to: "mid", cost: 0.4807, halfWidth: 0.0000, waypoints: [[0.7524, 0.6116], [0.5647, 0.555]] },
    { from: "a_main_choke", to: "site", cost: 0.3460, halfWidth: 0.0000, waypoints: [[0.6877, 0.4796], [0.6974, 0.423]] },
    { from: "a_main", to: "a_main_choke", cost: 0.1285, halfWidth: 0.0146, waypoints: [] },
    { from: "a_main", to: "atk_spawn", cost: 0.6068, halfWidth: 0.0000, waypoints: [[0.6748, 0.6525], [0.6424, 0.8066]] },
    { from: "atk_spawn", to: "mid", cost: 0.7156, halfWidth: 0.0000, waypoints: [[0.6521, 0.7972], [0.6489, 0.5739], [0.5647, 0.555]] },
    { from: "atk_spawn", to: "tree", cost: 0.8758, halfWidth: 0.0000, waypoints: [[0.6521, 0.7972], [0.6942, 0.6305], [0.7848, 0.5833], [0.8172, 0.4796]] },
    { from: "ct", to: "def_spawn", cost: 0.2842, halfWidth: 0.0000, waypoints: [[0.5809, 0.1242]] },
    { from: "ct", to: "generator", cost: 0.8075, halfWidth: 0.0000, waypoints: [[0.6133, 0.2123], [0.7783, 0.184], [0.8139, 0.3318], [0.6812, 0.4575], [0.7136, 0.489]] },
    { from: "ct", to: "site", cost: 0.5608, halfWidth: 0.0000, waypoints: [[0.6133, 0.2123], [0.7783, 0.184], [0.8172, 0.3506]] },
    { from: "def_spawn", to: "heaven", cost: 0.4268, halfWidth: 0.0000, waypoints: [[0.6618, 0.1808], [0.7848, 0.1903]] },
    { from: "generator", to: "mid", cost: 0.4956, halfWidth: 0.0000, waypoints: [[0.7751, 0.5393], [0.7492, 0.6148], [0.5647, 0.555]] },
    { from: "generator", to: "site", cost: 0.2666, halfWidth: 0.0000, waypoints: [[0.6812, 0.4733], [0.7298, 0.3978]] },
    { from: "heaven", to: "site", cost: 0.1446, halfWidth: 0.0000, waypoints: [[0.8107, 0.3569]] },
    { from: "plant", to: "site", cost: 0.0268, halfWidth: 0.0113, waypoints: [] },
    { from: "site", to: "tree_choke", cost: 0.2712, halfWidth: 0.0000, waypoints: [[0.8883, 0.316], [0.9142, 0.3475]] },
    { from: "tree", to: "tree_choke", cost: 0.1040, halfWidth: 0.0146, waypoints: [] },
  ],
};
