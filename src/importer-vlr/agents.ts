/**
 * REGISTRO DE AGENTES — slug de imagen de VLR ("/img/vlr/game/agents/kayo.png") → nombre canónico.
 *
 * Solo mapeo de datos (cero lógica de juego). Un agente desconocido NO es un estado imposible:
 * se capitaliza el slug (VLR añade agentes nuevos antes de que este registro se actualice).
 */
import { VALORANT_ROSTER } from "../domain/tactics/valorantRoster";

/*
 * F60 · Derivado de la instantánea del catálogo real (`valorantRoster.ts` ← `public.agents`): el id del roster ES el
 * slug de VLR («kayo» → «KAY/O»). Un agente nuevo del panel entra aquí al regenerar la instantánea; y aunque no
 * estuviera, el sync resuelve contra la tabla `agents` por nombre normalizado.
 */
const AGENT_BY_SLUG: Record<string, string> = Object.fromEntries(VALORANT_ROSTER.map((r) => [r.id, r.name]));

/** Nombre canónico desde un slug ("kayo" → "KAY/O"; desconocido → capitalizado). */
export function agentName(slug: string): string {
  const key = slug.toLowerCase().trim();
  return AGENT_BY_SLUG[key] ?? (key ? key[0].toUpperCase() + key.slice(1) : key);
}

/** Extrae el nombre de agente desde el `src` de una imagen de VLR. `undefined` si no es de agente. */
export function agentFromSrc(src: string): string | undefined {
  const m = /\/agents\/([a-z0-9-]+)\.(?:png|webp)/i.exec(src);
  return m ? agentName(m[1]) : undefined;
}
