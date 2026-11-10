/**
 * AGENT ABILITY ENGINE — Habilidades de un agente (DERIVADAS de su kit, no escritas a mano).
 *
 * Cada agente del catálogo (Agent Engine) tiene una clase + un kit abstracto (kinds). Aquí esos
 * `kinds` se convierten en ABILITIES con nombre, cooldown y efecto, eligiendo del catálogo la
 * habilidad con sabor de su clase. ESCALABLE: el agente nº100 no toca nada — sus abilities salen
 * de su clase+kit. PURO y determinista.
 */
import type { AgentDef } from "../agents/types";
import { abilityFor } from "./catalog";
import type { Ability } from "./types";

/** Habilidades de un agente (una por mecánica de su kit, deduplicadas). */
export function abilitiesFor(agent: AgentDef): Ability[] {
  const seen = new Set<string>();
  const out: Ability[] = [];
  for (const kind of agent.utility.kinds) {
    const ab = abilityFor(agent.class, kind);
    if (!seen.has(ab.id)) { seen.add(ab.id); out.push(ab); }
  }
  return out;
}

/** Mapa rápido id-de-agente → sus abilities (memoizable por el llamador si hace falta). */
export function abilityIdsFor(agent: AgentDef): string[] {
  return abilitiesFor(agent).map((a) => a.id);
}
