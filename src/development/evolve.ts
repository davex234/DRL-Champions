/**
 * EVOLUCIÓN EMERGENTE — cómo un jugador APRENDE y EMPEORA tras un partido.
 *
 * No hay XP ni scripts: las señales reales (clutches, primeras muertes, calls, uso de
 * utilidad, trades, impacto, MVP) empujan DELTAS al ADN/atributos/habilidades. Las
 * GANANCIAS se limitan por potencial, edad, fatiga, ética de trabajo y forma; las
 * REGRESIONES no (siempre se puede declinar). PURO: clona y devuelve un estado nuevo.
 *
 *   "Muchos clutches → sangre fría · Muere primero → pierde confianza ·
 *    Buenos calls → liderazgo · Nunca usa utilidad → pierde disciplina táctica ·
 *    Grandes retakes → aprende retakes."
 */
import type { TraitKey, Attributes } from "@/sim";
import type { DevState, InnateProfile, ExperienceSignals, DevTransition, DevSnapshot, SkillId } from "./types";
import { SKILL_IDS } from "./types";
import { clamp, clamp100, ageGrowthFactor } from "./innate";

const TRAIT_CAP = 30;   // |delta acumulado| máximo al ADN
const ATTR_CAP = 25;    // |delta acumulado| máximo a los atributos

/** Índice de progreso global (0..100) — para techo de potencial y declive. */
export function progress(state: DevState): number {
  const a = (state.attrDelta.aim + state.attrDelta.gameSense + state.attrDelta.utility + state.attrDelta.leadership) / 4;
  const sk = SKILL_IDS.reduce((s, k) => s + state.skill[k], 0) / SKILL_IDS.length - 50;
  return clamp(50 + a + sk * 0.5, 0, 100);
}

function gainFactor(state: DevState, innate: InnateProfile): number {
  const headroom = clamp((innate.potential - progress(state)) / 30, 0, 1); // cerca del techo → no crece
  const ageF = Math.max(0, ageGrowthFactor(state.age, innate));
  const fatigueF = 1 - state.condition.fatigue / 200;
  const workF = 0.6 + innate.workEthic / 250;
  const formF = 0.8 + state.condition.form / 250;
  return innate.growthRate * ageF * fatigueF * workF * formF * headroom;
}

// — mutadores con tope —
const addTrait = (s: DevState, k: TraitKey, amt: number) => {
  s.traitDelta[k] = clamp((s.traitDelta[k] ?? 0) + amt, -TRAIT_CAP, TRAIT_CAP);
};
const addAttr = (s: DevState, k: keyof Attributes, amt: number) => {
  s.attrDelta[k] = clamp(s.attrDelta[k] + amt, -ATTR_CAP, ATTR_CAP);
};
const addSkill = (s: DevState, k: SkillId, amt: number) => { s.skill[k] = clamp100(s.skill[k] + amt); };

const topTrait = (s: DevState): { key: TraitKey; delta: number } | undefined => {
  let best: { key: TraitKey; delta: number } | undefined;
  for (const [k, v] of Object.entries(s.traitDelta) as [TraitKey, number][]) {
    if (!best || Math.abs(v) > Math.abs(best.delta)) best = { key: k, delta: v };
  }
  return best;
};
const snapshot = (s: DevState): DevSnapshot => ({ rating: progress(s), age: s.age, condition: { ...s.condition }, topTrait: topTrait(s) });

/**
 * Evoluciona el jugador tras un partido. Devuelve el estado NUEVO + la transición
 * (para narrativa/broadcast). `season` solo etiqueta la transición.
 */
export function evolveAfterMatch(prev: DevState, innate: InnateProfile, sig: ExperienceSignals, season: number): { state: DevState; transition: DevTransition } {
  const s: DevState = structuredClone(prev);
  const before = snapshot(s);
  const pre = { traits: { ...s.traitDelta }, attrs: { ...s.attrDelta }, skill: { ...s.skill } };
  const g = gainFactor(s, innate);
  const rounds = Math.max(1, sig.rounds);
  const fdRate = sig.firstDeaths / rounds;
  const utilRate = sig.utilityCasts / rounds;
  const impactPR = sig.impactScore / rounds;

  // 1) Clutch → sangre fría + skill de clutch.
  if (sig.clutchWins > 0 || sig.clutches > 0) {
    addTrait(s, "composure", (sig.clutchWins * 0.8 + sig.clutches * 0.2) * g);
    addTrait(s, "clutchFactor", sig.clutchWins * 0.6 * g);
    addSkill(s, "clutch", (sig.clutchWins * 1.4 + sig.clutches * 0.4) * g);
  }
  // 2) Muere primero a menudo → pierde confianza (regresión, no limitada por techo).
  if (sig.firstDeaths >= 2 || fdRate > 0.14) {
    addTrait(s, "selfBelief", -sig.firstDeaths * 0.5);
    s.condition.confidence = clamp100(s.condition.confidence - sig.firstDeaths * 1.0);
    if (fdRate > 0.25) addTrait(s, "entryDrive", -0.6); // entradas suicidas castigan el ímpetu
  }
  // 3) Buenos calls (IGL con rondas decisivas) → liderazgo + comunicación + skill IGL.
  if (sig.role === "igl") {
    addTrait(s, "leadershipDrive", (sig.roundsDecisive * 0.4 + 0.3) * g);
    addTrait(s, "communication", 0.3 * g);
    addSkill(s, "igl", (sig.roundsDecisive * 0.5 + 0.5) * g);
    addTrait(s, "tacticalIQ", 0.2 * g);
  }
  // 4) Utilidad: nunca la usa → pierde disciplina táctica; la usa mucho → la domina.
  if (rounds >= 8 && utilRate < 0.1) {
    addTrait(s, "discipline", -0.7);
    addTrait(s, "utilityLean", -0.5);
  } else if (utilRate > 0.4) {
    addTrait(s, "utilityLean", 0.4 * g);
    addSkill(s, "support", 0.5 * g);
    addTrait(s, "discipline", 0.2 * g);
  }
  // 5) Retakes / post-plant (decisivo en rol defensivo/soporte) → aprende esas situaciones.
  if (sig.roundsDecisive > 0) {
    if (sig.role === "anchor" || sig.role === "support" || sig.role === "lurk") addSkill(s, "retake", (sig.roundsDecisive * 0.4 + sig.clutchWins * 0.3) * g);
    if (sig.role === "entry" || sig.role === "support") addSkill(s, "postplant", sig.roundsDecisive * 0.3 * g);
  }
  // 6) Entrada (rol entry) → entryDrive + skill entry según primeras sangres.
  if (sig.role === "entry") {
    addSkill(s, "entry", (sig.firstBloods * 0.6 + 0.3) * g);
    addTrait(s, "entryDrive", sig.firstBloods * 0.3 * g);
    addTrait(s, "aggression", sig.firstBloods * 0.15 * g);
  }
  // 7) Trades → instinto de trade + skill de trade.
  if (sig.tradeKills > 0) {
    addTrait(s, "tradeInstinct", sig.tradeKills * 0.4 * g);
    addSkill(s, "trade", sig.tradeKills * 0.5 * g);
  }
  // 8) Impacto / MVP → confianza, consistencia, afilar puntería; bajo impacto → bajón.
  if (sig.mvp) { s.condition.confidence = clamp100(s.condition.confidence + 3); addTrait(s, "selfBelief", 0.8 * g); }
  if (impactPR > 6) {
    addTrait(s, "selfBelief", impactPR * 0.06 * g);
    addAttr(s, "aim", impactPR * 0.04 * g);
    addTrait(s, "consistency", 0.25 * g);
  } else if (impactPR < 2 && rounds >= 8) {
    addTrait(s, "selfBelief", -0.4);
    addTrait(s, "consistency", -0.2);
  }
  // 9) Tilt alto → erosiona la sangre fría (regresión).
  if (sig.tiltPeak > 55) addTrait(s, "composure", -0.3);
  // 10) Game sense crece con la experiencia decisiva (también en veteranos).
  addAttr(s, "gameSense", (sig.roundsDecisive * 0.12 + 0.05) * Math.max(0.3, g));
  // 11) Economía: ganar enseña a gestionar rondas.
  if (sig.won) addSkill(s, "economy", 0.3 * g);

  // — Condición persistente —
  const c = s.condition;
  c.fatigue = clamp100(c.fatigue + clamp(rounds * 0.5 * (1 - innate.durability / 250), 1.5, 12));
  c.stress = clamp100(c.stress + clamp(sig.tiltPeak * 0.05 + (sig.won ? -2 : 3), -5, 8));
  c.burnout = clamp100(c.fatigue > 70 && c.motivation < 40 ? c.burnout + 3 : c.burnout - 1);
  const formTarget = clamp(50 + (impactPR * 4 - 18) + (sig.won ? 8 : -8) + (sig.mvp ? 12 : 0), 0, 100);
  c.form = clamp100(c.form + (formTarget - c.form) * 0.4);
  const confTarget = clamp(50 + impactPR * 3 - sig.firstDeaths * 2 + (sig.mvp ? 10 : 0), 0, 100);
  c.confidence = clamp100(c.confidence + (confTarget - c.confidence) * 0.3);
  c.motivation = clamp100(c.motivation + (sig.mvp ? 5 : sig.won ? 2 : -3));
  c.morale = clamp100(c.morale + (sig.won ? 4 : -4));

  s.matchesPlayed++;
  s.peak = Math.max(s.peak, progress(s));
  s.history.push({ season, kind: "match", text: matchLine(sig), data: { kills: sig.kills, deaths: sig.deaths, won: sig.won, mvp: sig.mvp } });
  if (s.history.length > 200) s.history = s.history.slice(-200);

  const changes = diffChanges(pre, s);
  return { state: s, transition: { playerId: s.playerId, name: sig.name, cause: "match", season, before, after: snapshot(s), changes } };
}

/** Cambios reales aplicados en esta llamada (post − pre), filtrando lo despreciable. */
export function diffChanges(
  pre: { traits: Partial<Record<TraitKey, number>>; attrs: Record<keyof Attributes, number>; skill: Record<SkillId, number> },
  s: DevState,
): DevTransition["changes"] {
  const traits: Partial<Record<TraitKey, number>> = {};
  for (const [k, v] of Object.entries(s.traitDelta) as [TraitKey, number][]) {
    const d = v - (pre.traits[k] ?? 0);
    if (Math.abs(d) >= 0.05) traits[k] = Math.round(d * 100) / 100;
  }
  const attrs: Partial<Record<keyof Attributes, number>> = {};
  for (const k of ["aim", "gameSense", "utility", "leadership"] as (keyof Attributes)[]) {
    const d = s.attrDelta[k] - pre.attrs[k];
    if (Math.abs(d) >= 0.05) attrs[k] = Math.round(d * 100) / 100;
  }
  const skills: Partial<Record<SkillId, number>> = {};
  for (const k of SKILL_IDS) {
    const d = s.skill[k] - pre.skill[k];
    if (Math.abs(d) >= 0.05) skills[k] = Math.round(d * 100) / 100;
  }
  return { traits, attrs, skills };
}

function matchLine(sig: ExperienceSignals): string {
  const bits: string[] = [`${sig.kills}-${sig.deaths}`];
  if (sig.mvp) bits.push("MVP");
  if (sig.aces > 0) bits.push("ACE");
  if (sig.clutchWins > 0) bits.push(`${sig.clutchWins} clutch`);
  return `${sig.won ? "Victoria" : "Derrota"} · ${bits.join(" · ")}`;
}
