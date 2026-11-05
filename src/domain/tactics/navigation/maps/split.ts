/**
 * FASE 51.2 · Grafo de navegación de SPLIT — GENERADO por `scripts/_fase51-2-navgen.ts`
 * sobre `public/maps/split.png` (1296 × 1213). No editar a mano: cambiar los
 * anclajes (`navigation/anchors.ts`) y regenerar. Nodos = zonas del simulador; aristas = su grafo de
 * corredores (`ADJ`) recorrido sobre el suelo real del asset; waypoints = rodeos de pared.
 */
import type { MapNavigationGraph } from "../types";

export const SPLIT_NAV: MapNavigationGraph = {
  mapId: "split",
  asset: { width: 1296, height: 1213 },
  nodes: [
    { id: "atk_spawn", zone: "atk_spawn", x: 0.4213, y: 0.8788 },
    { id: "a_main", zone: "a_main", x: 0.8102, y: 0.6216 },
    { id: "a_main_choke", zone: "a_main_choke", x: 0.841, y: 0.5029 },
    { id: "tree", zone: "tree", x: 0.8997, y: 0.6018 },
    { id: "tree_choke", zone: "tree_choke", x: 0.8966, y: 0.4567 },
    { id: "mid", zone: "mid", x: 0.6281, y: 0.4996 },
    { id: "site", zone: "site", x: 0.8904, y: 0.3116 },
    { id: "plant", zone: "plant", x: 0.8812, y: 0.3215 },
    { id: "generator", zone: "generator", x: 0.7392, y: 0.404 },
    { id: "ct", zone: "ct", x: 0.6312, y: 0.2688 },
    { id: "heaven", zone: "heaven", x: 0.8997, y: 0.2094 },
    { id: "def_spawn", zone: "def_spawn", x: 0.5046, y: 0.0808 },
  ],
  edges: [
    { from: "a_main_choke", to: "mid", cost: 0.2759, halfWidth: 0.0016, waypoints: [] },
    { from: "a_main_choke", to: "site", cost: 0.3197, halfWidth: 0.0000, waypoints: [[0.8009, 0.4831], [0.8164, 0.3611]] },
    { from: "a_main", to: "a_main_choke", cost: 0.1847, halfWidth: 0.0000, waypoints: [[0.8503, 0.6051], [0.8503, 0.5128]] },
    { from: "a_main", to: "atk_spawn", cost: 0.7120, halfWidth: 0.0000, waypoints: [[0.838, 0.6249], [0.8287, 0.7073], [0.6744, 0.7601], [0.6034, 0.8129], [0.4522, 0.8524]] },
    { from: "atk_spawn", to: "mid", cost: 1.0952, halfWidth: 0.0000, waypoints: [[0.5725, 0.8129], [0.6466, 0.7898], [0.7361, 0.7238], [0.8287, 0.7073], [0.8627, 0.5359], [0.6929, 0.4996]] },
    { from: "atk_spawn", to: "tree", cost: 0.7302, halfWidth: 0.0000, waypoints: [[0.5725, 0.8129], [0.6466, 0.7898], [0.7176, 0.737], [0.8318, 0.704], [0.8873, 0.6117]] },
    { from: "ct", to: "def_spawn", cost: 0.3354, halfWidth: 0.0000, waypoints: [[0.5941, 0.1797], [0.5077, 0.1665]] },
    { from: "ct", to: "generator", cost: 0.5872, halfWidth: 0.0000, waypoints: [[0.6682, 0.2918], [0.6867, 0.493], [0.7793, 0.4798], [0.7917, 0.4007]] },
    { from: "ct", to: "site", cost: 0.6259, halfWidth: 0.0000, waypoints: [[0.6096, 0.1929], [0.7515, 0.1237], [0.8009, 0.1698], [0.8164, 0.2852]] },
    { from: "def_spawn", to: "heaven", cost: 0.6652, halfWidth: 0.0000, waypoints: [[0.517, 0.1764], [0.6836, 0.1632], [0.7454, 0.1237], [0.8009, 0.1665], [0.8225, 0.1995]] },
    { from: "generator", to: "mid", cost: 0.3640, halfWidth: 0.0000, waypoints: [[0.7948, 0.404], [0.7762, 0.4831]] },
    { from: "generator", to: "site", cost: 0.2257, halfWidth: 0.0000, waypoints: [] },
    { from: "heaven", to: "site", cost: 0.1246, halfWidth: 0.0016, waypoints: [] },
    { from: "plant", to: "site", cost: 0.0169, halfWidth: 0.0115, waypoints: [] },
    { from: "site", to: "tree_choke", cost: 0.6046, halfWidth: 0.0000, waypoints: [[0.8009, 0.3842], [0.8164, 0.4996], [0.8657, 0.5491], [0.8843, 0.5919], [0.8935, 0.5886]] },
    { from: "tree", to: "tree_choke", cost: 0.1761, halfWidth: 0.0000, waypoints: [] },
  ],
};
