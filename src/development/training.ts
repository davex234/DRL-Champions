/**
 * ENTRENAMIENTO — sesiones REALES decididas por el entrenador.
 *
 * Cada sesión MEJORA unas cosas y EMPEORA otras (foco = coste de oportunidad) y, salvo
 * el descanso, suma fatiga. La intensidad escala ganancia y fatiga. Sobre-entrenar
 * (fatiga alta) reduce ganancia y dispara el burnout. Las ganancias respetan potencial/
 * edad (gainFactor); el descanso recupera condición a costa de un poco de "óxido". PURO.
 */
import type { TraitKey, Attributes } from "@/sim";
import type { DevState, InnateProfile, TrainingSession, DevTransition, SkillId } from "./types";
import { SKILL_IDS } from "./types";
import { clamp, clamp100, ageGrowthFactor } from "./innate";
import { progress, diffChanges } from "./evolve";

const INTENSITY: Record<TrainingSession["intensity"], { mult: number; fatigue: number }> = {
  light: { mult: 0.6, fatigue: 3 },
  normal: { mult: 1.0, fatigue: 6 },
  hard: { mult: 1.6, fatigue: 11 },
};

const TRAIT_CAP = 30, ATTR_CAP = 25;
const addTrait = (s: DevState, k: TraitKey, amt: number) => { s.traitDelta[k] = clamp((s.traitDelta[k] ?? 0) + amt, -TRAIT_CAP, TRAIT_CAP); };
const addAttr = (s: DevState, k: keyof Attributes, amt: number) => { s.attrDelta[k] = clamp(s.attrDelta[k] + amt, -ATTR_CAP, ATTR_CAP); };
const addSkill = (s: DevState, k: SkillId, amt: number) => { s.skill[k] = clamp100(s.skill[k] + amt); };

function gain(s: DevState, innate: InnateProfile, mult: number): number {
  const headroom = clamp((innate.potential - progress(s)) / 30, 0, 1);
  const ageF = Math.max(0.2, ageGrowthFactor(s.age, innate));
  const overtrain = s.condition.fatigue > 75 ? 0.4 : 1;          // cansado entrena peor
  const workF = 0.7 + innate.workEthic / 220;
  return mult * headroom * ageF * overtrain * workF;
}

/**
 * Ejecuta una sesión de entrenamiento. Devuelve estado nuevo + transición. `season`
 * etiqueta la transición.
 */
export function train(prev: DevState, innate: InnateProfile, session: TrainingSession, season: number): { state: DevState; transition: DevTransition } {
  const s: DevState = structuredClone(prev);
  const pre = { traits: { ...s.traitDelta }, attrs: { ...s.attrDelta }, skill: { ...s.skill } };
  const { mult, fatigue } = INTENSITY[session.intensity];
  const g = gain(s, innate, mult);
  const c = s.condition;

  switch (session.id) {
    case "aim":
      addAttr(s, "aim", 0.9 * g); addAttr(s, "gameSense", 0.1 * g);
      addTrait(s, "communication", -0.15 * mult); // foco mecánico, menos juego de equipo
      break;
    case "utility":
      addAttr(s, "utility", 0.8 * g); addSkill(s, "support", 0.9 * g); addTrait(s, "utilityLean", 0.4 * g);
      addTrait(s, "aggression", -0.1 * mult);
      break;
    case "retake":
      addSkill(s, "retake", 1.1 * g); addSkill(s, "postplant", 0.4 * g); addTrait(s, "tacticalIQ", 0.3 * g);
      addTrait(s, "entryDrive", -0.1 * mult);
      break;
    case "execute":
      addSkill(s, "entry", 0.9 * g); addSkill(s, "postplant", 0.6 * g); addTrait(s, "entryDrive", 0.3 * g); addTrait(s, "aggression", 0.2 * g);
      addTrait(s, "patience", -0.15 * mult);
      break;
    case "mental":
      addTrait(s, "composure", 0.6 * g); addTrait(s, "resilience", 0.4 * g);
      c.confidence = clamp100(c.confidence + 3 * mult); c.morale = clamp100(c.morale + 3 * mult); c.stress = clamp100(c.stress - 6 * mult);
      break;
    case "teamplay":
      addTrait(s, "tradeInstinct", 0.5 * g); addSkill(s, "trade", 0.7 * g); addTrait(s, "communication", 0.4 * g);
      addTrait(s, "ego", -0.2 * mult); // jugar para el equipo baja el ego
      break;
    case "communication":
      addTrait(s, "communication", 0.7 * g); addTrait(s, "leadershipDrive", 0.4 * g); addSkill(s, "igl", 0.6 * g);
      break;
    case "review":
      addTrait(s, "tacticalIQ", 0.6 * g); addAttr(s, "gameSense", 0.5 * g); addTrait(s, "adaptability", 0.4 * g); addSkill(s, "economy", 0.5 * g);
      c.motivation = clamp100(c.motivation + 2 * mult);
      break;
    case "rest":
      c.fatigue = clamp100(c.fatigue - 22 * mult); c.burnout = clamp100(c.burnout - 10 * mult);
      c.stress = clamp100(c.stress - 12 * mult); c.motivation = clamp100(c.motivation + 5 * mult);
      addAttr(s, "aim", -0.1 * mult); // un poco de óxido mecánico por no jugar
      break;
  }

  if (session.id !== "rest") {
    c.fatigue = clamp100(c.fatigue + fatigue * (1 - innate.durability / 300));
    if (c.fatigue > 80 && c.motivation < 45) c.burnout = clamp100(c.burnout + 4);
    c.form = clamp100(c.form + 1.5 * mult); // entrenar bien sube la forma
  }
  s.peak = Math.max(s.peak, progress(s));
  s.history.push({ season, kind: "training", text: `Sesión ${session.id} (${session.intensity})` });
  if (s.history.length > 200) s.history = s.history.slice(-200);

  const before = { rating: progress(prev), age: prev.age, condition: { ...prev.condition } };
  return { state: s, transition: { playerId: s.playerId, name: undefined, cause: "training", season, before, after: { rating: progress(s), age: s.age, condition: { ...s.condition } }, changes: diffChanges(pre, s) } };
}
