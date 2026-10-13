import type { Agent } from "@/domain/esports/types";
import { VALORANT_ROSTER } from "@/domain/tactics/valorantRoster";

/**
 * Catálogo de agentes de Valorant del dominio esports: espejo de `public.agents`.
 *
 * F60 · YA NO ES UNA LISTA A MANO. Se DERIVA de la instantánea generada del catálogo real (`valorantRoster.ts`,
 * regenerada desde `public.agents` con `npm run agents:snapshot`). Añadir un agente es darlo de alta en /admin/agents:
 * ni este fichero ni el importador se tocan.
 */
export const AGENTS: Agent[] = VALORANT_ROSTER.map(({ id, name, role }) => ({ id, name, role }));

export const AGENTS_BY_ID: Record<string, Agent> = Object.fromEntries(
  AGENTS.map((a) => [a.id, a]),
);

export function getAgent(id: string): Agent | undefined {
  return AGENTS_BY_ID[id];
}
