/**
 * INYECCIÓN DEL DESARROLLO — el ÚNICO punto donde el progreso llega al partido.
 *
 * Toma un `RosterEntry` (identidad/atributos derivados de la carta) y le SUMA los deltas
 * de desarrollo + el reflejo de las habilidades aprendidas + el efecto de la condición
 * persistente (fatiga/forma) + la química del quinteto. El sim entero (Brain/Combat/
 * Tactical/Abilities/Mental) consume el resultado SIN cambios: solo cambian los números
 * de entrada. PURO.
 */
import type { RosterEntry, Identity, TraitKey, Attributes } from "@/sim";
import { TRAIT_KEYS } from "@/sim";
import type { DevState } from "./types";

const clampTrait = (n: number) => Math.max(0, Math.min(100, n));
const clamp99 = (n: number) => Math.max(1, Math.min(99, Math.round(n)));

/** Reflejo de habilidades aprendidas (0..100, 50 base) en rasgos del ADN que el sim lee. */
function skillTraitNudges(s: DevState): Partial<Record<TraitKey, number>> {
  const d = (k: keyof DevState["skill"]) => (s.skill[k] - 50) * 0.3; // 0.3 por punto sobre la base
  return {
    clutchFactor: d("clutch"),
    leadershipDrive: d("igl"),
    entryDrive: d("entry"),
    tradeInstinct: d("trade"),
    utilityLean: d("support"),
    lurkTendency: d("lurk"),
    tacticalIQ: d("retake") * 0.5 + d("postplant") * 0.3,
    discipline: d("economy") * 0.5,
  };
}

/** Efecto de la CONDICIÓN persistente sobre el ADN/atributos de la próxima partida. */
function conditionNudges(s: DevState): { traits: Partial<Record<TraitKey, number>>; aim: number } {
  const c = s.condition;
  const formU = (c.form - 50) / 50;        // -1..1
  const fatigueU = c.fatigue / 100;         // 0..1
  const confU = (c.confidence - 50) / 50;   // -1..1
  return {
    traits: {
      consistency: formU * 6 - fatigueU * 6,
      composure: -fatigueU * 5 - (c.stress / 100) * 4,
      selfBelief: confU * 6,
      aggression: formU * 3,
    },
    aim: -fatigueU * 3 + formU * 1.5,         // cansado apunta peor; en forma, algo mejor
  };
}

/**
 * Aplica el desarrollo a un RosterEntry. `chemistry` (0..100, 50 neutral) modula el
 * juego de equipo del quinteto. Devuelve un RosterEntry NUEVO (no muta el original).
 */
export function applyDevelopment(entry: RosterEntry, state: DevState, opts: { chemistry?: number } = {}): RosterEntry {
  const baseId = entry.identity ?? ({} as Identity);
  const skillN = skillTraitNudges(state);
  const condN = conditionNudges(state);
  const chem = opts.chemistry ?? 50;
  const chemU = (chem - 50) / 50; // -1..1

  const identity = {} as Identity;
  for (const k of TRAIT_KEYS) {
    let v = baseId[k] ?? 50;
    v += state.traitDelta[k] ?? 0;
    v += skillN[k] ?? 0;
    v += condN.traits[k] ?? 0;
    if (k === "communication" || k === "tradeInstinct") v += chemU * 6; // química → juego conjunto
    identity[k] = clampTrait(v);
  }

  const a = entry.attrs;
  const attrs: Attributes = {
    aim: clamp99(a.aim + state.attrDelta.aim + condN.aim),
    gameSense: clamp99(a.gameSense + state.attrDelta.gameSense),
    utility: clamp99(a.utility + state.attrDelta.utility),
    leadership: clamp99(a.leadership + state.attrDelta.leadership),
  };

  return { ...entry, identity, attrs };
}
