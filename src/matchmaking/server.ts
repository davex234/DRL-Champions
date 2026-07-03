/**
 * SERVER SELECTION — elige el servidor (Online Fase 2/7).
 *
 * Local / dedicado / LAN / offline / cloud, por MODO y REGIÓN (nodo más cercano, menos cargado).
 * Preparado para escalado. NO crea otro servidor: describe nodos para el Online Core. PURO.
 */
import type { Region } from "@/domain/cards/types";
import type { QueueMode, ServerNode, ServerKind } from "./types";
import { REGIONS, regionPing } from "./region";

/** Registro de nodos por defecto (uno dedicado por región + local/lan/offline). */
export function defaultNodes(): ServerNode[] {
  const dedicated: ServerNode[] = REGIONS.map((r) => ({ id: `ded-${r}`, kind: "dedicated" as const, region: r, load: 0, capacity: 100 }));
  return [
    { id: "local", kind: "local", region: "EMEA", load: 0, capacity: 1 },
    ...dedicated,
    { id: "lan", kind: "lan", region: "EMEA", load: 0, capacity: 10 },
    { id: "offline", kind: "offline", region: "EMEA", load: 0, capacity: 1 },
  ];
}

/** Tipo de servidor preferido por modo. */
export function kindForMode(mode: QueueMode): ServerKind {
  switch (mode) {
    case "offline_local": case "practice": case "ai_match": return "offline";
    case "lan": return "lan";
    case "dedicated": case "competitive": case "casual": case "custom": return "dedicated";
  }
}

/** Selecciona el mejor nodo: por tipo del modo → región más cercana → menos cargado. */
export function selectServer(mode: QueueMode, region: Region, nodes: ServerNode[]): ServerNode {
  const kind = kindForMode(mode);
  let pool = nodes.filter((n) => n.kind === kind && n.load < n.capacity);
  if (pool.length === 0) pool = nodes.filter((n) => n.load < n.capacity);
  if (pool.length === 0) pool = nodes;
  return [...pool].sort((a, b) =>
    (regionPing(region, a.region) - regionPing(region, b.region)) ||
    (a.load / a.capacity - b.load / b.capacity) ||
    (a.id < b.id ? -1 : 1),
  )[0];
}
