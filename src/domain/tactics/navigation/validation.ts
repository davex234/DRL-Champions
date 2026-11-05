/**
 * FASE 51.2 · VALIDACIÓN estructural de un grafo de navegación (puro, sin imagen).
 * La validación GEOMÉTRICA —nodos y trayectorias sobre suelo real— está en los tests, que leen el PNG.
 */
import type { MapNavigationGraph } from "./types";
import { findPath } from "./pathfinding";

export interface NavIssue { code: string; detail: string }

const inUnit = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;

export function validateNavGraph(g: MapNavigationGraph, requiredNodes: readonly string[]): NavIssue[] {
  const issues: NavIssue[] = [];
  const ids = new Set<string>();
  for (const n of g.nodes ?? []) {
    if (typeof n.id !== "string" || !n.id) issues.push({ code: "NODE_ID", detail: String(n.id) });
    else if (ids.has(n.id)) issues.push({ code: "DUPLICATE_NODE", detail: n.id });
    ids.add(n.id);
    if (!inUnit(n.x) || !inUnit(n.y)) issues.push({ code: "NODE_COORD", detail: n.id });
  }
  for (const r of requiredNodes) if (!ids.has(r)) issues.push({ code: "MISSING_NODE", detail: r });
  const seen = new Set<string>();
  for (const e of g.edges ?? []) {
    const tag = `${e.from}→${e.to}`;
    if (!ids.has(e.from) || !ids.has(e.to)) issues.push({ code: "EDGE_ENDPOINT", detail: tag });
    if (e.from === e.to) issues.push({ code: "SELF_EDGE", detail: tag });
    if (!(typeof e.cost === "number" && Number.isFinite(e.cost) && e.cost > 0)) issues.push({ code: "EDGE_COST", detail: tag });
    if (!Array.isArray(e.waypoints) || e.waypoints.some((w) => !Array.isArray(w) || w.length !== 2 || !inUnit(w[0]) || !inUnit(w[1]))) {
      issues.push({ code: "WAYPOINT", detail: tag });
    }
    const k = [e.from, e.to].sort().join("|");
    if (seen.has(k)) issues.push({ code: "DUPLICATE_EDGE", detail: tag });
    seen.add(k);
  }
  /* Conectividad: todos los nodos alcanzables desde el primero requerido (ningún nodo huérfano). */
  if (!issues.length && requiredNodes.length) {
    for (const n of g.nodes) {
      const r = findPath(g, requiredNodes[0], n.id);
      if (!r.ok) issues.push({ code: "UNREACHABLE", detail: n.id });
    }
  }
  return issues;
}
