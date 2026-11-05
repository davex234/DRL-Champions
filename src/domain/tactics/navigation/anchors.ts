/**
 * FASE 51.2 · ANCLAJES de los nodos tácticos por mapa, normalizados 0..1 sobre el asset.
 *
 * Son la INTENCIÓN (qué punto del mapa representa cada zona del simulador: el sitio A, su heaven, CT,
 * los dos accesos del ataque, mid y los spawns), medida sobre cada imagen en la Fase 51.1. El
 * generador (`scripts/_fase51-2-navgen.ts`) coloca cada nodo en el suelo real más cercano con holgura
 * y traza las rutas; aquí no hay geometría, solo semántica.
 */
import type { ZoneId } from "@/sim/map/ascentA";

export const NAV_ANCHORS: Record<string, Record<ZoneId, readonly [number, number]>> = {
  abyss: { site: [0.84, 0.40], plant: [0.82, 0.41], heaven: [0.84, 0.28], ct: [0.63, 0.35], def_spawn: [0.54, 0.08], generator: [0.72, 0.50], mid: [0.58, 0.55], a_main: [0.76, 0.64], a_main_choke: [0.80, 0.54], tree: [0.90, 0.58], tree_choke: [0.89, 0.48], atk_spawn: [0.42, 0.86] },
  ascent: { site: [0.85, 0.30], plant: [0.83, 0.31], heaven: [0.85, 0.21], ct: [0.63, 0.27], def_spawn: [0.55, 0.10], generator: [0.72, 0.38], mid: [0.57, 0.52], a_main: [0.77, 0.56], a_main_choke: [0.78, 0.44], tree: [0.90, 0.50], tree_choke: [0.89, 0.40], atk_spawn: [0.42, 0.84] },
  bind: { site: [0.67, 0.33], plant: [0.65, 0.34], heaven: [0.67, 0.24], ct: [0.55, 0.30], def_spawn: [0.54, 0.12], generator: [0.64, 0.42], mid: [0.53, 0.62], a_main: [0.67, 0.52], a_main_choke: [0.66, 0.43], tree: [0.85, 0.52], tree_choke: [0.78, 0.42], atk_spawn: [0.42, 0.85] },
  breeze: { site: [0.88, 0.45], plant: [0.86, 0.46], heaven: [0.88, 0.33], ct: [0.63, 0.36], def_spawn: [0.60, 0.08], generator: [0.72, 0.52], mid: [0.60, 0.52], a_main: [0.78, 0.64], a_main_choke: [0.82, 0.56], tree: [0.92, 0.58], tree_choke: [0.91, 0.51], atk_spawn: [0.42, 0.88] },
  corrode: { site: [0.84, 0.38], plant: [0.82, 0.39], heaven: [0.84, 0.27], ct: [0.63, 0.33], def_spawn: [0.54, 0.10], generator: [0.72, 0.48], mid: [0.58, 0.55], a_main: [0.74, 0.62], a_main_choke: [0.78, 0.52], tree: [0.90, 0.52], tree_choke: [0.90, 0.45], atk_spawn: [0.42, 0.88] },
  fracture: { site: [0.91, 0.50], plant: [0.89, 0.51], heaven: [0.91, 0.40], ct: [0.63, 0.45], def_spawn: [0.55, 0.10], generator: [0.75, 0.56], mid: [0.62, 0.55], a_main: [0.80, 0.70], a_main_choke: [0.86, 0.62], tree: [0.88, 0.74], tree_choke: [0.92, 0.62], atk_spawn: [0.42, 0.88] },
  haven: { site: [0.88, 0.37], plant: [0.86, 0.38], heaven: [0.88, 0.27], ct: [0.63, 0.33], def_spawn: [0.55, 0.10], generator: [0.75, 0.47], mid: [0.58, 0.55], a_main: [0.80, 0.58], a_main_choke: [0.82, 0.48], tree: [0.92, 0.55], tree_choke: [0.92, 0.45], atk_spawn: [0.42, 0.88] },
  icebox: { site: [0.82, 0.29], plant: [0.80, 0.30], heaven: [0.82, 0.24], ct: [0.63, 0.30], def_spawn: [0.55, 0.08], generator: [0.72, 0.45], mid: [0.57, 0.55], a_main: [0.78, 0.58], a_main_choke: [0.80, 0.45], tree: [0.90, 0.52], tree_choke: [0.88, 0.42], atk_spawn: [0.42, 0.88] },
  lotus: { site: [0.89, 0.28], plant: [0.87, 0.29], heaven: [0.89, 0.19], ct: [0.63, 0.24], def_spawn: [0.55, 0.08], generator: [0.77, 0.38], mid: [0.58, 0.52], a_main: [0.82, 0.55], a_main_choke: [0.84, 0.44], tree: [0.93, 0.49], tree_choke: [0.93, 0.38], atk_spawn: [0.42, 0.88] },
  pearl: { site: [0.84, 0.31], plant: [0.82, 0.32], heaven: [0.84, 0.20], ct: [0.63, 0.28], def_spawn: [0.58, 0.08], generator: [0.72, 0.42], mid: [0.58, 0.52], a_main: [0.80, 0.60], a_main_choke: [0.82, 0.48], tree: [0.90, 0.56], tree_choke: [0.88, 0.42], atk_spawn: [0.42, 0.88] },
  split: { site: [0.90, 0.31], plant: [0.88, 0.32], heaven: [0.90, 0.22], ct: [0.63, 0.27], def_spawn: [0.54, 0.08], generator: [0.74, 0.42], mid: [0.59, 0.50], a_main: [0.80, 0.62], a_main_choke: [0.84, 0.50], tree: [0.90, 0.59], tree_choke: [0.92, 0.44], atk_spawn: [0.42, 0.88] },
  sunset: { site: [0.80, 0.37], plant: [0.78, 0.38], heaven: [0.80, 0.26], ct: [0.63, 0.33], def_spawn: [0.54, 0.10], generator: [0.72, 0.48], mid: [0.59, 0.52], a_main: [0.78, 0.58], a_main_choke: [0.79, 0.48], tree: [0.92, 0.50], tree_choke: [0.92, 0.42], atk_spawn: [0.42, 0.88] },
};
