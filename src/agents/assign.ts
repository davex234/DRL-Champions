/**
 * AGENT ENGINE — Asignación agente ↔ jugador.
 *
 * No hay (aún) pantalla de "pick" de agente, así que cada jugador recibe el agente que
 * mejor encaja con su ROL y su ADN, garantizando VARIEDAD (una composición real, no 5
 * duelistas). Determinista. Maestría del kit según el ADN (utilityLean/disciplina).
 * Solo LEE Role/Identity (tipos); no toca el motor.
 */
import type { Role } from "../sim/attributes";
import type { Identity } from "../sim/identity/traits";
import type { Capability, CapabilityProfile } from "./capabilities";
import { AGENTS } from "./catalog";
import type { AgentClass, AgentDef, AgentInstance } from "./types";

/** Clases preferidas por rol del motor (orden de preferencia). */
const ROLE_CLASSES: Record<Role, AgentClass[]> = {
  entry: ["duelist", "initiator", "flex"],
  igl: ["controller", "initiator", "flex"],
  anchor: ["sentinel", "controller", "flex"],
  lurk: ["flex", "duelist", "initiator"],
  support: ["initiator", "controller", "sentinel"],
};

/** Afinidad ADN → capacidades (qué capacidades "quiere" jugar esta personalidad). */
function identityAffinity(id: Identity): CapabilityProfile {
  const u = (t: number) => (t - 50) / 50; // -1..1
  const aff: Record<Capability, number> = {
    entry: u(id.entryDrive) + u(id.aggression) * 0.5,
    pressure: u(id.aggression) * 0.8,
    space: u(id.aggression) * 0.4 + u(id.entryDrive) * 0.4,
    trading: u(id.tradeInstinct) + u(id.communication) * 0.4,
    lurk: u(id.lurkTendency),
    rotation: u(id.adaptability) * 0.6 + u(id.lurkTendency) * 0.3,
    information: u(id.communication) * 0.7 + u(id.tacticalIQ) * 0.4,
    initiation: u(id.utilityLean) * 0.5 + u(id.communication) * 0.4,
    utility: u(id.utilityLean),
    control: u(id.utilityLean) * 0.5 + u(id.discipline) * 0.4,
    anchor: u(id.discipline) * 0.7 + u(id.patience) * 0.5,
    postplant: u(id.discipline) * 0.5 + u(id.patience) * 0.4,
    survival: u(id.composure) * 0.5 + u(id.clutchFactor) * 0.5,
    retake: u(id.clutchFactor) * 0.5 + u(id.adaptability) * 0.4,
    fake: u(id.creativity) * 0.7 + u(id.adaptability) * 0.3,
  };
  return aff as CapabilityProfile;
}

/** Cuánto encaja un agente con un ADN (producto de afinidad·capacidades, normalizado). */
function fitScore(agent: AgentDef, aff: CapabilityProfile): number {
  let dot = 0;
  for (const k of Object.keys(aff) as Capability[]) dot += aff[k] * (agent.capabilities[k] / 100);
  return dot;
}

/** Maestría del kit: cuánto rinde la utilidad del agente en manos de este jugador. */
export function masteryOf(id: Identity): number {
  const m = 0.85 + ((id.utilityLean - 50) / 100) * 0.35 + ((id.discipline - 50) / 100) * 0.15;
  return Math.max(0.65, Math.min(1.3, m));
}

export interface AssignInput {
  name: string;
  role: Role;
  identity: Identity;
}

/**
 * Asigna un agente a cada jugador con variedad: prioriza la clase del rol y el mejor
 * encaje de ADN, evitando repetir agente mientras haya alternativas. Determinista.
 */
export function buildLineup(players: AssignInput[]): AgentInstance[] {
  const taken = new Set<string>();
  const out: AgentInstance[] = [];

  for (const p of players) {
    const aff = identityAffinity(p.identity);
    const prefs = ROLE_CLASSES[p.role] ?? ["flex"];
    const rank = (a: AgentDef): number => {
      const classBonus = prefs.includes(a.class) ? (prefs.length - prefs.indexOf(a.class)) * 0.6 : 0;
      const freshBonus = taken.has(a.id) ? -2 : 0; // penaliza repetir
      // desempate estable por id (hash simple) para determinismo
      const tie = (a.id.charCodeAt(0) % 7) * 0.001;
      return fitScore(a, aff) + classBonus + freshBonus + tie;
    };
    const best = [...AGENTS].sort((a, b) => rank(b) - rank(a))[0];
    taken.add(best.id);
    out.push({ agent: best, player: p.name, mastery: masteryOf(p.identity) });
  }
  return out;
}
