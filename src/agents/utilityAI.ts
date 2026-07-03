/**
 * AGENT ENGINE — IA de UTILIDAD (sin scripts).
 *
 * Decide QUÉ utilidad usar, CUÁNDO y CON QUÉ OBJETIVO a partir de las capacidades del
 * agente, el lado, el concepto de ronda y el ADN del jugador (un creativo la gasta
 * pronto y de forma rara; un disciplinado la guarda para el momento exacto). Devuelve
 * intenciones ABSTRACTAS (lenguaje del Spatial Engine), no habilidades concretas.
 */
import type { Side } from "../sim/types";
import type { Identity } from "../sim/identity/traits";
import type { UtilityKind } from "../spatial/types";
import type { AgentInstance, UtilityObjective } from "./types";

export type UtilityPhase = "setup" | "execute" | "postplant" | "retake" | "save";

export interface UtilityIntent {
  player: string;
  agentId: string;
  kind: UtilityKind;
  objective: UtilityObjective;
  when: UtilityPhase;
  /** Por qué (significado para narrativa/broadcast, no UI). */
  reason: string;
}

export interface UtilityPlan {
  side: Side;
  intents: UtilityIntent[];
  /** Cargas guardadas a propósito (disciplina). */
  saved: number;
}

const OBJ_REASON: Record<UtilityObjective, string> = {
  space: "crear espacio", info: "sacar información", deny: "negar espacio / parar el rush",
  blind: "cegar la defensa", cover: "cubrir la entrada", stall: "ralentizar y forzar rotación",
};

/** Momento natural de un objetivo según el lado. */
function whenFor(objective: UtilityObjective, side: Side, concept: string): UtilityPhase {
  if (side === "ATK") {
    if (objective === "info") return "setup";
    if (objective === "deny" || objective === "cover") return "postplant";
    return concept === "default" || concept === "play_picks" ? "setup" : "execute";
  }
  // DEF
  if (objective === "info") return "setup";
  if (objective === "blind") return "retake";
  if (objective === "deny" || objective === "space" || objective === "cover") return "setup";
  return "setup";
}

/**
 * Construye el plan de utilidad de un equipo. Emergente: cada agente aporta según su
 * kit + capacidades; el ADN decide cuánta gasta y cuándo, y cuánta GUARDA.
 */
export function planTeamUtility(
  side: Side,
  lineup: AgentInstance[],
  identityByName: Record<string, Identity>,
  concept: string,
  buy: string,
): UtilityPlan {
  const intents: UtilityIntent[] = [];
  let saved = 0;

  for (const inst of lineup) {
    const id = identityByName[inst.player];
    const disc = id ? id.discipline : 50;
    const crea = id ? id.creativity : 50;
    const lean = id ? id.utilityLean : 50;

    // Cuánta de su utilidad usa esta ronda (no toda si es disciplinado; más si es util-lean).
    let uses = inst.agent.utility.charges;
    if (buy === "eco" || buy === "save") uses = Math.max(0, uses - 2); // en eco se guarda
    const usageBias = (lean - 50) / 100 - (disc - 50) / 200; // util-lean gasta, disciplina guarda
    uses = Math.round(uses * (0.6 + Math.max(0, Math.min(0.6, 0.5 + usageBias))));
    uses = Math.max(0, Math.min(inst.agent.utility.charges, uses));
    saved += inst.agent.utility.charges - uses;

    const kinds = inst.agent.utility.kinds;
    const objective = inst.agent.utility.objective;
    for (let i = 0; i < uses; i++) {
      const kind: UtilityKind = kinds[i % kinds.length];
      // El creativo desplaza el timing (usa antes / de forma poco convencional).
      let when = whenFor(objective, side, concept);
      if (crea > 68 && when === "execute" && i === 0) when = "setup";
      intents.push({
        player: inst.player, agentId: inst.agent.id, kind, objective, when,
        reason: OBJ_REASON[objective],
      });
    }
  }

  return { side, intents, saved };
}

/** Cargas que se usan hasta una fase dada (para "utilidad restante" del broadcast). */
export function usedByPhase(plan: UtilityPlan, phase: UtilityPhase): number {
  const ORDER: UtilityPhase[] = ["setup", "execute", "postplant", "retake", "save"];
  const upto = ORDER.indexOf(phase);
  return plan.intents.filter((i) => ORDER.indexOf(i.when) <= upto).length;
}
