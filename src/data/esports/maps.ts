import type { GameMap } from "@/domain/esports/types";

/**
 * Mapas de Valorant. Espejo TS del seed de `0003_competitive.sql` (tabla
 * `maps`). `activePool` es aproximado y se ajusta por acto.
 */
export const MAPS: GameMap[] = [
  { id: "ascent", name: "Ascent", activePool: true },
  { id: "bind", name: "Bind", activePool: true },
  { id: "haven", name: "Haven", activePool: true },
  { id: "split", name: "Split", activePool: true },
  { id: "lotus", name: "Lotus", activePool: true },
  { id: "sunset", name: "Sunset", activePool: true },
  { id: "abyss", name: "Abyss", activePool: true },
  { id: "corrode", name: "Corrode", activePool: true },
  { id: "breeze", name: "Breeze", activePool: false },
  { id: "fracture", name: "Fracture", activePool: false },
  { id: "pearl", name: "Pearl", activePool: false },
  { id: "icebox", name: "Icebox", activePool: false },
];

export const MAPS_BY_ID: Record<string, GameMap> = Object.fromEntries(
  MAPS.map((m) => [m.id, m]),
);

export function getMap(id: string): GameMap | undefined {
  return MAPS_BY_ID[id];
}

export const ACTIVE_MAP_POOL = MAPS.filter((m) => m.activePool);
