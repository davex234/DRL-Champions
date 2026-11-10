/**
 * FASE 51.2 · Grafo de navegación de ABYSS — GENERADO por `scripts/_fase51-2-navgen.ts`
 * sobre `public/maps/abyss.png` (1300 × 1210). No editar a mano: cambiar los
 * anclajes (`navigation/anchors.ts`) y regenerar. Nodos = zonas del simulador; aristas = su grafo de
 * corredores (`ADJ`) recorrido sobre el suelo real del asset; waypoints = rodeos de pared.
 */
import type { MapNavigationGraph } from "../types";

export const ABYSS_NAV: MapNavigationGraph = {
  mapId: "abyss",
  asset: { width: 1300, height: 1210 },
  nodes: [
    { id: "atk_spawn", zone: "atk_spawn", x: 0.42, y: 0.8612 },
    { id: "a_main", zone: "a_main", x: 0.7615, y: 0.6231 },
    { id: "a_main_choke", zone: "a_main_choke", x: 0.8108, y: 0.5405 },
    { id: "tree", zone: "tree", x: 0.8969, y: 0.5901 },
    { id: "tree_choke", zone: "tree_choke", x: 0.8908, y: 0.4942 },
    { id: "mid", zone: "mid", x: 0.58, y: 0.5901 },
    { id: "site", zone: "site", x: 0.8415, y: 0.3818 },
    { id: "plant", zone: "plant", x: 0.82, y: 0.3719 },
    { id: "generator", zone: "generator", x: 0.7154, y: 0.4942 },
    { id: "ct", zone: "ct", x: 0.6292, y: 0.3289 },
    { id: "heaven", zone: "heaven", x: 0.8385, y: 0.2793 },
    { id: "def_spawn", zone: "def_spawn", x: 0.54, y: 0.081 },
  ],
  edges: [
    { from: "a_main_choke", to: "mid", cost: 0.6845, halfWidth: 0.0000, waypoints: [[0.7954, 0.6099], [0.7215, 0.643], [0.6785, 0.7521], [0.5677, 0.7521], [0.5677, 0.676], [0.5923, 0.6231]] },
    { from: "a_main_choke", to: "site", cost: 0.2951, halfWidth: 0.0000, waypoints: [[0.7677, 0.3917], [0.8262, 0.3686]] },
    { from: "a_main", to: "a_main_choke", cost: 0.1371, halfWidth: 0.0000, waypoints: [[0.8138, 0.5868]] },
    { from: "a_main", to: "atk_spawn", cost: 0.6730, halfWidth: 0.0000, waypoints: [[0.7185, 0.6463], [0.6815, 0.7488], [0.5646, 0.8248], [0.4815, 0.924], [0.42, 0.9074]] },
    { from: "atk_spawn", to: "mid", cost: 0.5786, halfWidth: 0.0000, waypoints: [[0.4354, 0.924], [0.5062, 0.9074], [0.5923, 0.6099]] },
    { from: "atk_spawn", to: "tree", cost: 0.8547, halfWidth: 0.0000, waypoints: [[0.4354, 0.924], [0.5062, 0.9074], [0.6015, 0.7917], [0.6908, 0.7388], [0.7431, 0.6198]] },
    { from: "ct", to: "def_spawn", cost: 0.3881, halfWidth: 0.0000, waypoints: [[0.6538, 0.2727], [0.6385, 0.1372], [0.5646, 0.1074]] },
    { from: "ct", to: "generator", cost: 0.3224, halfWidth: 0.0000, waypoints: [[0.7062, 0.3124]] },
    { from: "ct", to: "site", cost: 0.4088, halfWidth: 0.0000, waypoints: [[0.7492, 0.2595], [0.8262, 0.276]] },
    { from: "def_spawn", to: "heaven", cost: 0.5260, halfWidth: 0.0000, waypoints: [[0.6508, 0.1537], [0.6631, 0.2562], [0.8323, 0.2727]] },
    { from: "generator", to: "mid", cost: 0.4969, halfWidth: 0.0000, waypoints: [[0.6692, 0.4248], [0.62, 0.4281], [0.5831, 0.4777], [0.5308, 0.4843], [0.5338, 0.5868]] },
    { from: "generator", to: "site", cost: 0.5430, halfWidth: 0.0000, waypoints: [[0.7246, 0.2628], [0.8231, 0.2727]] },
    { from: "heaven", to: "site", cost: 0.1241, halfWidth: 0.0017, waypoints: [] },
    { from: "plant", to: "site", cost: 0.0304, halfWidth: 0.0017, waypoints: [] },
    { from: "site", to: "tree_choke", cost: 0.1794, halfWidth: 0.0000, waypoints: [[0.8723, 0.3851], [0.8938, 0.4281]] },
    { from: "tree", to: "tree_choke", cost: 0.2157, halfWidth: 0.0000, waypoints: [[0.8354, 0.5802], [0.8477, 0.5273]] },
  ],
};
