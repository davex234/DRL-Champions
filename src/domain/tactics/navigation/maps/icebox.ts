/**
 * FASE 51.2 · Grafo de navegación de ICEBOX — GENERADO por `scripts/_fase51-2-navgen.ts`
 * sobre `public/maps/icebox.png` (1206 × 1304). No editar a mano: cambiar los
 * anclajes (`navigation/anchors.ts`) y regenerar. Nodos = zonas del simulador; aristas = su grafo de
 * corredores (`ADJ`) recorrido sobre el suelo real del asset; waypoints = rodeos de pared.
 */
import type { MapNavigationGraph } from "../types";

export const ICEBOX_NAV: MapNavigationGraph = {
  mapId: "icebox",
  asset: { width: 1206, height: 1304 },
  nodes: [
    { id: "atk_spawn", zone: "atk_spawn", x: 0.4295, y: 0.7899 },
    { id: "a_main", zone: "a_main", x: 0.7811, y: 0.5997 },
    { id: "a_main_choke", zone: "a_main_choke", x: 0.801, y: 0.4494 },
    { id: "tree", zone: "tree", x: 0.8905, y: 0.5291 },
    { id: "tree_choke", zone: "tree_choke", x: 0.8806, y: 0.4187 },
    { id: "mid", zone: "mid", x: 0.5688, y: 0.5506 },
    { id: "site", zone: "site", x: 0.8275, y: 0.3052 },
    { id: "plant", zone: "plant", x: 0.7877, y: 0.3083 },
    { id: "generator", zone: "generator", x: 0.7313, y: 0.4494 },
    { id: "ct", zone: "ct", x: 0.6285, y: 0.3021 },
    { id: "heaven", zone: "heaven", x: 0.8209, y: 0.2592 },
    { id: "def_spawn", zone: "def_spawn", x: 0.5489, y: 0.0813 },
  ],
  edges: [
    { from: "a_main_choke", to: "mid", cost: 0.5838, halfWidth: 0.0000, waypoints: [[0.7347, 0.4586], [0.665, 0.5506], [0.6816, 0.6028], [0.7048, 0.6212], [0.6816, 0.6488], [0.592, 0.612]] },
    { from: "a_main_choke", to: "site", cost: 0.4886, halfWidth: 0.0000, waypoints: [[0.801, 0.3788], [0.7347, 0.3604], [0.7413, 0.2592], [0.8408, 0.2684], [0.8375, 0.3052]] },
    { from: "a_main", to: "a_main_choke", cost: 0.4171, halfWidth: 0.0000, waypoints: [[0.6683, 0.5905], [0.6816, 0.5077], [0.7579, 0.4494]] },
    { from: "a_main", to: "atk_spawn", cost: 0.5647, halfWidth: 0.0000, waypoints: [[0.7247, 0.6212], [0.6484, 0.6549], [0.5854, 0.6672], [0.5589, 0.7837]] },
    { from: "atk_spawn", to: "mid", cost: 0.4617, halfWidth: 0.0000, waypoints: [[0.5721, 0.7715]] },
    { from: "atk_spawn", to: "tree", cost: 0.9620, halfWidth: 0.0000, waypoints: [[0.5721, 0.7715], [0.602, 0.6518], [0.7081, 0.6365], [0.7612, 0.6028], [0.864, 0.5905], [0.8541, 0.5752], [0.7678, 0.569], [0.7678, 0.5567]] },
    { from: "ct", to: "def_spawn", cost: 0.3035, halfWidth: 0.0083, waypoints: [] },
    { from: "ct", to: "generator", cost: 0.4617, halfWidth: 0.0000, waypoints: [[0.7148, 0.2807], [0.7512, 0.3727], [0.8043, 0.3819], [0.801, 0.4402]] },
    { from: "ct", to: "site", cost: 0.3258, halfWidth: 0.0000, waypoints: [[0.7745, 0.2592], [0.8408, 0.2684], [0.8375, 0.3052]] },
    { from: "def_spawn", to: "heaven", cost: 0.5268, halfWidth: 0.0000, waypoints: [[0.6385, 0.296], [0.7778, 0.2592]] },
    { from: "generator", to: "mid", cost: 0.5103, halfWidth: 0.0000, waypoints: [[0.665, 0.5537], [0.6816, 0.6028], [0.7048, 0.6212], [0.6816, 0.6488], [0.592, 0.612]] },
    { from: "generator", to: "site", cost: 0.5621, halfWidth: 0.0000, waypoints: [[0.8043, 0.4371], [0.801, 0.3788], [0.7347, 0.3604], [0.7413, 0.2592], [0.8408, 0.2684], [0.8375, 0.3052]] },
    { from: "heaven", to: "site", cost: 0.0890, halfWidth: 0.0000, waypoints: [[0.8441, 0.2715], [0.8375, 0.3052]] },
    { from: "plant", to: "site", cost: 0.3035, halfWidth: 0.0000, waypoints: [[0.7313, 0.3021], [0.7446, 0.2592], [0.8408, 0.2684], [0.8375, 0.3052]] },
    { from: "site", to: "tree_choke", cost: 1.4339, halfWidth: 0.0000, waypoints: [[0.8408, 0.3021], [0.8375, 0.2653], [0.7313, 0.2684], [0.7479, 0.3727], [0.8043, 0.3819], [0.801, 0.4402], [0.728, 0.4647], [0.665, 0.5506], [0.6816, 0.6028], [0.864, 0.5905], [0.8541, 0.5752], [0.7678, 0.569], [0.7678, 0.5567], [0.8806, 0.5322], [0.8939, 0.4985], [0.8872, 0.4248]] },
    { from: "tree", to: "tree_choke", cost: 0.1473, halfWidth: 0.0000, waypoints: [[0.8872, 0.4248]] },
  ],
};
