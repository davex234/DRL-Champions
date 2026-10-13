/**
 * FASE 51.2 · Grafo de navegación de LOTUS — GENERADO por `scripts/_fase51-2-navgen.ts`
 * sobre `public/maps/lotus.png` (1323 × 1189). No editar a mano: cambiar los
 * anclajes (`navigation/anchors.ts`) y regenerar. Nodos = zonas del simulador; aristas = su grafo de
 * corredores (`ADJ`) recorrido sobre el suelo real del asset; waypoints = rodeos de pared.
 */
import type { MapNavigationGraph } from "../types";

export const LOTUS_NAV: MapNavigationGraph = {
  mapId: "lotus",
  asset: { width: 1323, height: 1189 },
  nodes: [
    { id: "atk_spawn", zone: "atk_spawn", x: 0.4187, y: 0.8797 },
    { id: "a_main", zone: "a_main", x: 0.8209, y: 0.55 },
    { id: "a_main_choke", zone: "a_main_choke", x: 0.842, y: 0.4256 },
    { id: "tree", zone: "tree", x: 0.9146, y: 0.4794 },
    { id: "tree_choke", zone: "tree_choke", x: 0.9297, y: 0.3785 },
    { id: "mid", zone: "mid", x: 0.579, y: 0.4996 },
    { id: "site", zone: "site", x: 0.8904, y: 0.2843 },
    { id: "plant", zone: "plant", x: 0.8753, y: 0.2843 },
    { id: "generator", zone: "generator", x: 0.7695, y: 0.3785 },
    { id: "ct", zone: "ct", x: 0.6304, y: 0.2372 },
    { id: "heaven", zone: "heaven", x: 0.8904, y: 0.1766 },
    { id: "def_spawn", zone: "def_spawn", x: 0.5488, y: 0.0791 },
  ],
  edges: [
    { from: "a_main_choke", to: "mid", cost: 0.5335, halfWidth: 0.0000, waypoints: [[0.8602, 0.4458], [0.833, 0.5366], [0.6606, 0.439]] },
    { from: "a_main_choke", to: "site", cost: 0.3414, halfWidth: 0.0000, waypoints: [[0.9358, 0.4188], [0.9176, 0.2708]] },
    { from: "a_main", to: "a_main_choke", cost: 0.1770, halfWidth: 0.0000, waypoints: [[0.8602, 0.4861], [0.8511, 0.4256]] },
    { from: "a_main", to: "atk_spawn", cost: 0.6945, halfWidth: 0.0000, waypoints: [[0.6636, 0.7048], [0.6243, 0.8057]] },
    { from: "atk_spawn", to: "mid", cost: 0.7263, halfWidth: 0.0000, waypoints: [[0.4641, 0.8495], [0.4974, 0.6981], [0.4883, 0.5971], [0.4278, 0.5534], [0.4429, 0.4929]] },
    { from: "atk_spawn", to: "tree", cost: 0.8440, halfWidth: 0.0000, waypoints: [[0.6455, 0.7822], [0.6848, 0.6745], [0.9085, 0.4794]] },
    { from: "ct", to: "def_spawn", cost: 0.2168, halfWidth: 0.0118, waypoints: [] },
    { from: "ct", to: "generator", cost: 0.3147, halfWidth: 0.0000, waypoints: [[0.7513, 0.2506]] },
    { from: "ct", to: "site", cost: 0.5184, halfWidth: 0.0000, waypoints: [[0.7513, 0.2506], [0.7695, 0.3448], [0.8209, 0.365], [0.8541, 0.2708]] },
    { from: "def_spawn", to: "heaven", cost: 0.4710, halfWidth: 0.0017, waypoints: [[0.7604, 0.1665]] },
    { from: "generator", to: "mid", cost: 0.3251, halfWidth: 0.0000, waypoints: [[0.7332, 0.4491], [0.6425, 0.4424]] },
    { from: "generator", to: "site", cost: 0.2437, halfWidth: 0.0000, waypoints: [[0.836, 0.3482], [0.8511, 0.2708]] },
    { from: "heaven", to: "site", cost: 0.8431, halfWidth: 0.0000, waypoints: [[0.6727, 0.1699], [0.6546, 0.2136], [0.7574, 0.2574], [0.7664, 0.3415], [0.8178, 0.3684], [0.8541, 0.2708]] },
    { from: "plant", to: "site", cost: 0.0200, halfWidth: 0.0118, waypoints: [] },
    { from: "site", to: "tree_choke", cost: 0.1717, halfWidth: 0.0000, waypoints: [[0.9206, 0.2708]] },
    { from: "tree", to: "tree_choke", cost: 0.1268, halfWidth: 0.0000, waypoints: [[0.9358, 0.3852]] },
  ],
};
