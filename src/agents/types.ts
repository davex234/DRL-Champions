/**
 * AGENT ENGINE — Tipos.
 *
 * Un `AgentDef` es DATOS puros: clase + perfil de capacidades + kit de utilidad
 * ABSTRACTO (sin habilidades concretas: solo "tipos de efecto" y para qué sirven,
 * reutilizando el lenguaje del Spatial Engine). Añadir un agente = añadir un AgentDef.
 */
import type { CapabilityProfile } from "./capabilities";
import type { UtilityKind } from "../spatial/types";

/** Familia táctica del agente. */
export type AgentClass = "controller" | "initiator" | "duelist" | "sentinel" | "flex";

/** Para qué usa SOBRE TODO su utilidad (objetivo macro, no una habilidad). */
export type UtilityObjective = "space" | "info" | "deny" | "blind" | "cover" | "stall";

/**
 * Kit de utilidad ABSTRACTO. No define habilidades concretas: describe cuánta
 * utilidad tiene, qué TIPOS de efecto puede crear (lenguaje del Spatial Engine) y su
 * objetivo macro. El motor decide cuándo/por qué usarla.
 */
export interface UtilityKit {
  /** Cargas abstractas por ronda. */
  charges: number;
  /** Tipos de efecto que sabe crear (smoke/flash/molly/recon/cover). */
  kinds: UtilityKind[];
  /** Objetivo principal de su utilidad. */
  objective: UtilityObjective;
}

/** Definición de un agente (100% datos). */
export interface AgentDef {
  id: string;
  /** Nombre visible (genérico, NO de Valorant). */
  name: string;
  /** Alias corto para HUD. */
  codename: string;
  class: AgentClass;
  capabilities: CapabilityProfile;
  utility: UtilityKit;
  /** Descriptores legibles para coach/broadcast ("humos", "recon", "trampas"). */
  tags: string[];
}

/** Un agente EN MANOS de un jugador concreto (con su maestría según ADN). */
export interface AgentInstance {
  agent: AgentDef;
  /** Nombre del jugador que lo lleva. */
  player: string;
  /** Maestría del kit según el ADN del jugador (≈0.7..1.3). */
  mastery: number;
}

export const CLASS_LABEL: Record<AgentClass, string> = {
  controller: "Controlador", initiator: "Iniciador", duelist: "Duelista",
  sentinel: "Centinela", flex: "Flex",
};
