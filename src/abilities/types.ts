/**
 * AGENT ABILITY ENGINE — Tipos.
 *
 * Una `Ability` es DATOS PUROS: DESCRIBE qué consigue (effect) y con qué mecánica del mapa
 * (kind, lenguaje del Spatial/Utility Engine), su coste (charges/cooldown/duration) y su valor.
 * NO contiene lógica: el motor (decide/apply) la interpreta reutilizando Utility/Combat/Perception.
 * Añadir el agente nº100 = añadir datos (clase + kit) → sus abilities salen del catálogo.
 */
import type { AgentClass } from "../agents/types";
import type { UtilityKind } from "../spatial/types";

/** Vocabulario RICO de efectos (lenguaje común; se mapea a EffectType + modificadores). */
export type AbilityEffect =
  | "create_space" | "deny_vision" | "reveal" | "suppress" | "delay" | "slow" | "blind"
  | "concuss" | "block" | "force_rotation" | "pressure" | "protect" | "anchor" | "fake"
  | "decoy" | "control" | "escape" | "entry" | "retake" | "post_plant" | "trade" | "bait";

/** Cómo se resuelve el objetivo de la habilidad sobre el mapa (reutiliza la lectura del engine). */
export type AbilityTarget =
  | "objective_sightline"  // corta el ángulo entre el ancla enemiga y el objetivo (smoke)
  | "objective_zone"       // sobre el sitio/plant (recon/cover/molly)
  | "push_choke"           // sobre el carril por el que presiona el ataque (molly/smoke def)
  | "enemy_anchor"         // sobre la zona enemiga clave (flash/blind)
  | "self_zone"            // sobre la propia zona (cover/anchor)
  | "plant";               // sobre el spike (post-plant)

/** Modificadores de COMBATE/PERCEPCIÓN que aplica la habilidad (nunca mata; solo modula). */
export interface AbilityCombatMod {
  /** Ciega a los enemigos cercanos al objetivo (ticks). Reutiliza `flashedUntil`. */
  blind?: number;
  /** Aturde: ralentiza reacción del enemigo en la zona (0..1). */
  concuss?: number;
  /** Revela: comparte posición enemiga (info/lastSeen). */
  reveal?: boolean;
  /** Supresión: penaliza al enemigo que pelea dentro del efecto (0..1). */
  suppress?: number;
}

/** Definición de una habilidad (100% datos). */
export interface Ability {
  id: string;
  name: string;
  /** Clase a la que pertenece (de qué agente sale). */
  class: AgentClass;
  /** Mecánica del mapa (Spatial/Utility Engine). */
  kind: UtilityKind;
  /** Qué CONSIGUE (efecto rico). */
  effect: AbilityEffect;
  /** Cargas máximas por ronda de ESTA habilidad. */
  charges: number;
  /** Ticks de recuperación entre usos. */
  cooldown: number;
  /** Ticks que dura el efecto en el mapa. */
  duration: number;
  target: AbilityTarget;
  /** Valor/prioridad base (0..1) para la decisión del Brain. */
  priority: number;
  /** Modificadores de combate/percepción. */
  combat?: AbilityCombatMod;
  tags: string[];
}

/** Estado de habilidades de UN jugador en la ronda (cooldowns). Plano y clonable. */
export interface AbilityState {
  /** Tick hasta el que cada habilidad está en recuperación. */
  cooldownUntil: Record<string, number>;
}

export function emptyAbilityState(): AbilityState {
  return { cooldownUntil: {} };
}

/** Una habilidad ELEGIDA por el Brain este tick (decisión → aplicación). */
export interface AbilityChoice {
  ability: Ability;
  zone?: import("../sim/map/ascentA").ZoneId;
  sightline?: [import("../sim/map/ascentA").ZoneId, import("../sim/map/ascentA").ZoneId];
  /** Valor esperado calculado (telemetría). */
  value: number;
  objective: string;
}
