/**
 * F60 · CATÁLOGO VIVO DE AGENTES — lo que sirve `/api/content/agents` y cómo se aplica al juego.
 *
 * Una sola forma de datos para el servidor (cargador con caché) y el cliente (sincronización al arrancar): los
 * agentes PUBLICADOS y RETIRADOS de `public.agents` con su arte resuelto. Los BORRADORES no salen nunca de aquí: sólo
 * existen en el panel. Aplicarlo actualiza en sitio el roster (`applyRuntimeRoster`) y el arte (`applyRuntimeAgentArt`).
 *
 * Puro: sin React, sin red.
 */
import { applyRuntimeRoster, type AbilitySlot, type RuntimeRosterRow, type TacticalRole } from "./roster";
import { applyRuntimeAgentArt, type AgentArtAsset } from "./agentArt";

export interface RuntimeAgent {
  id: string;
  name: string;
  role: TacticalRole;
  code: string;
  abilities: { slot: AbilitySlot; name: string }[];
  lifecycle: "PUBLISHED" | "RETIRED";
  /** Arte subido desde el panel (Storage). `null` ⇒ el del manifiesto F59, si existe. */
  face: AgentArtAsset | null;
  full: AgentArtAsset | null;
}

export interface AgentCatalogPayload {
  /** `content_entity_version.agents`: cambia con cada escritura del panel. */
  version: number;
  agents: RuntimeAgent[];
}

const ROLES: readonly TacticalRole[] = ["duelist", "initiator", "controller", "sentinel"];
const SLOTS: readonly AbilitySlot[] = ["C", "Q", "E", "X"];

/** ¿Es jugable esta fila? (completa: rol válido, código y las cuatro habilidades C/Q/E/X). */
export function isCompleteRuntimeAgent(a: RuntimeAgent): boolean {
  return ROLES.includes(a.role) && /^[A-Z0-9/]{2,4}$/.test(a.code ?? "")
    && Array.isArray(a.abilities) && a.abilities.length === 4
    && a.abilities.every((ab, i) => ab.slot === SLOTS[i] && typeof ab.name === "string" && ab.name.trim().length >= 2);
}

/** Aplica el catálogo al registro del proceso (cliente o servidor). Filas incompletas se descartan. */
export function applyAgentCatalog(payload: AgentCatalogPayload | null | undefined): boolean {
  if (!payload || !Array.isArray(payload.agents)) return false;
  const rows = payload.agents.filter(isCompleteRuntimeAgent);
  const roster: RuntimeRosterRow[] = rows.map((a) => ({
    id: a.id, name: a.name, code: a.code, role: a.role, uuid: "", abilities: a.abilities, lifecycle: a.lifecycle,
  }));
  const changed = applyRuntimeRoster(roster);
  if (roster.some((r) => r.lifecycle === "PUBLISHED")) {
    applyRuntimeAgentArt(rows.map((a) => ({ agentId: a.id, face: a.face, full: a.full })));
  }
  return changed;
}
