/**
 * FASE 51.2 · Grafo de navegación de CORRODE — GENERADO por `scripts/_fase51-2-navgen.ts`
 * sobre `public/maps/corrode.png` (1204 × 1306). No editar a mano: cambiar los
 * anclajes (`navigation/anchors.ts`) y regenerar. Nodos = zonas del simulador; aristas = su grafo de
 * corredores (`ADJ`) recorrido sobre el suelo real del asset; waypoints = rodeos de pared.
 */
import type { MapNavigationGraph } from "../types";

export const CORRODE_NAV: MapNavigationGraph = {
  mapId: "corrode",
  asset: { width: 1204, height: 1306 },
  nodes: [
    { id: "atk_spawn", zone: "atk_spawn", x: 0.4203, y: 0.8806 },
    { id: "a_main", zone: "a_main", x: 0.7392, y: 0.608 },
    { id: "a_main_choke", zone: "a_main_choke", x: 0.7924, y: 0.4885 },
    { id: "tree", zone: "tree", x: 0.8854, y: 0.5528 },
    { id: "tree_choke", zone: "tree_choke", x: 0.8987, y: 0.4395 },
    { id: "mid", zone: "mid", x: 0.5797, y: 0.5314 },
    { id: "site", zone: "site", x: 0.8223, y: 0.3721 },
    { id: "plant", zone: "plant", x: 0.8123, y: 0.3905 },
    { id: "generator", zone: "generator", x: 0.7193, y: 0.4671 },
    { id: "ct", zone: "ct", x: 0.5831, y: 0.3017 },
    { id: "heaven", zone: "heaven", x: 0.8389, y: 0.2711 },
    { id: "def_spawn", zone: "def_spawn", x: 0.5399, y: 0.0995 },
  ],
  edges: [
    { from: "a_main_choke", to: "mid", cost: 0.3744, halfWidth: 0.0000, waypoints: [[0.7392, 0.4487], [0.6495, 0.4273], [0.6063, 0.4395], [0.5897, 0.5191]] },
    { from: "a_main_choke", to: "site", cost: 0.2434, halfWidth: 0.0000, waypoints: [[0.7591, 0.3721], [0.7957, 0.3568]] },
    { from: "a_main", to: "a_main_choke", cost: 0.2451, halfWidth: 0.0000, waypoints: [[0.8289, 0.562], [0.8156, 0.4916]] },
    { from: "a_main", to: "atk_spawn", cost: 0.5820, halfWidth: 0.0000, waypoints: [[0.7159, 0.6386], [0.6993, 0.6968], [0.6296, 0.7519], [0.5897, 0.8438], [0.4502, 0.8591]] },
    { from: "atk_spawn", to: "mid", cost: 0.6473, halfWidth: 0.0000, waypoints: [[0.387, 0.7734], [0.4037, 0.6968], [0.4834, 0.6815], [0.5565, 0.5038], [0.5731, 0.5069]] },
    { from: "atk_spawn", to: "tree", cost: 0.7678, halfWidth: 0.0000, waypoints: [[0.5233, 0.8438], [0.6096, 0.8254], [0.6595, 0.7182], [0.7159, 0.6753], [0.7326, 0.608]] },
    { from: "ct", to: "def_spawn", cost: 0.2723, halfWidth: 0.0000, waypoints: [[0.5532, 0.1149]] },
    { from: "ct", to: "generator", cost: 0.8611, halfWidth: 0.0000, waypoints: [[0.5897, 0.2129], [0.7525, 0.1608], [0.8056, 0.2741], [0.8555, 0.3201], [0.8422, 0.3599], [0.7691, 0.3629]] },
    { from: "ct", to: "site", cost: 0.6530, halfWidth: 0.0000, waypoints: [[0.5897, 0.2129], [0.7525, 0.1608], [0.8056, 0.2741], [0.8555, 0.3201], [0.8422, 0.3599]] },
    { from: "def_spawn", to: "heaven", cost: 0.4745, halfWidth: 0.0000, waypoints: [[0.6495, 0.1577], [0.7591, 0.1669], [0.8023, 0.2711]] },
    { from: "generator", to: "mid", cost: 0.2856, halfWidth: 0.0000, waypoints: [[0.6794, 0.4273], [0.6096, 0.4364], [0.5864, 0.5222]] },
    { from: "generator", to: "site", cost: 0.2168, halfWidth: 0.0000, waypoints: [[0.7791, 0.3568]] },
    { from: "heaven", to: "site", cost: 0.1522, halfWidth: 0.0000, waypoints: [[0.8488, 0.3599]] },
    { from: "plant", to: "site", cost: 0.0269, halfWidth: 0.0050, waypoints: [] },
    { from: "site", to: "tree_choke", cost: 0.3117, halfWidth: 0.0000, waypoints: [[0.7757, 0.3568], [0.7757, 0.4364]] },
    { from: "tree", to: "tree_choke", cost: 0.2214, halfWidth: 0.0000, waypoints: [[0.8422, 0.5345], [0.8688, 0.4395]] },
  ],
};
