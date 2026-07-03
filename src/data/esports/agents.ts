import type { Agent } from "@/domain/esports/types";

/**
 * Catálogo de agentes de Valorant. Espejo TS del seed de `0003_competitive.sql`
 * (tabla `agents`). Permite resolver rol/nombre en cliente sin consultar la BD.
 */
export const AGENTS: Agent[] = [
  { id: "jett", name: "Jett", role: "duelist" },
  { id: "raze", name: "Raze", role: "duelist" },
  { id: "phoenix", name: "Phoenix", role: "duelist" },
  { id: "reyna", name: "Reyna", role: "duelist" },
  { id: "yoru", name: "Yoru", role: "duelist" },
  { id: "neon", name: "Neon", role: "duelist" },
  { id: "iso", name: "Iso", role: "duelist" },
  { id: "waylay", name: "Waylay", role: "duelist" },
  { id: "sova", name: "Sova", role: "initiator" },
  { id: "breach", name: "Breach", role: "initiator" },
  { id: "skye", name: "Skye", role: "initiator" },
  { id: "kayo", name: "KAY/O", role: "initiator" },
  { id: "fade", name: "Fade", role: "initiator" },
  { id: "gekko", name: "Gekko", role: "initiator" },
  { id: "tejo", name: "Tejo", role: "initiator" },
  { id: "killjoy", name: "Killjoy", role: "sentinel" },
  { id: "cypher", name: "Cypher", role: "sentinel" },
  { id: "sage", name: "Sage", role: "sentinel" },
  { id: "chamber", name: "Chamber", role: "sentinel" },
  { id: "deadlock", name: "Deadlock", role: "sentinel" },
  { id: "vyse", name: "Vyse", role: "sentinel" },
  { id: "brimstone", name: "Brimstone", role: "controller" },
  { id: "omen", name: "Omen", role: "controller" },
  { id: "viper", name: "Viper", role: "controller" },
  { id: "astra", name: "Astra", role: "controller" },
  { id: "harbor", name: "Harbor", role: "controller" },
  { id: "clove", name: "Clove", role: "controller" },
];

export const AGENTS_BY_ID: Record<string, Agent> = Object.fromEntries(
  AGENTS.map((a) => [a.id, a]),
);

export function getAgent(id: string): Agent | undefined {
  return AGENTS_BY_ID[id];
}
