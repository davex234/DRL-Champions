/**
 * EDAD Y TEMPORADA — la carrera avanza y la edad importa.
 *
 * Joven: crece de forma natural. Prime: se estabiliza. Veterano/declive: pierde físico
 * (aim/utility) pero GANA cabeza (gameSense/tacticalIQ/liderazgo) — los veteranos juegan
 * más listos. El parón de temporada recupera condición. Todo gradual y determinista. PURO.
 */
import type { TraitKey, Attributes } from "@/sim";
import type { DevState, InnateProfile, DevTransition, SkillId } from "./types";
import { clamp, clamp100, ageGrowthFactor, ageBand } from "./innate";
import { progress, diffChanges } from "./evolve";

const TRAIT_CAP = 30, ATTR_CAP = 25;
const addTrait = (s: DevState, k: TraitKey, amt: number) => { s.traitDelta[k] = clamp((s.traitDelta[k] ?? 0) + amt, -TRAIT_CAP, TRAIT_CAP); };
const addAttr = (s: DevState, k: keyof Attributes, amt: number) => { s.attrDelta[k] = clamp(s.attrDelta[k] + amt, -ATTR_CAP, ATTR_CAP); };

/**
 * Avanza una temporada para un jugador: cumple años, aplica la curva de edad y recupera
 * condición en el parón. Devuelve estado nuevo + transición (cause "season").
 */
export function advanceSeasonFor(prev: DevState, innate: InnateProfile, season: number): { state: DevState; transition: DevTransition } {
  const s: DevState = structuredClone(prev);
  const pre = { traits: { ...s.traitDelta }, attrs: { ...s.attrDelta }, skill: { ...s.skill } };
  const beforeRating = progress(prev);
  s.age++;
  s.seasonsPlayed++;
  const band = ageBand(s.age, innate);
  const headroom = clamp((innate.potential - progress(s)) / 30, 0, 1);

  if (band === "joven") {
    // Crecimiento natural (madurez) limitado por potencial.
    const g = innate.growthRate * headroom * ageGrowthFactor(s.age, innate);
    addAttr(s, "aim", 1.2 * g); addAttr(s, "gameSense", 1.0 * g);
    addTrait(s, "tacticalIQ", 0.8 * g); addTrait(s, "composure", 0.6 * g); addTrait(s, "consistency", 0.5 * g);
  } else if (band === "prime") {
    const g = 0.5 * headroom;
    addAttr(s, "gameSense", 0.5 * g); addTrait(s, "tacticalIQ", 0.4 * g);
  } else {
    // Veterano / declive: pierde físico, gana cabeza.
    const decl = band === "veterano" ? 0.6 : 1.0 + (s.age - innate.declineAge - 2) * 0.4;
    addAttr(s, "aim", -1.1 * decl);
    addAttr(s, "utility", -0.4 * decl);
    // La experiencia compensa parcialmente: más lectura y liderazgo.
    addAttr(s, "gameSense", 0.5);
    addTrait(s, "tacticalIQ", 0.6); addTrait(s, "leadershipDrive", 0.5); addTrait(s, "discipline", 0.3);
  }

  // Parón de temporada: recupera condición.
  const c = s.condition;
  c.fatigue = clamp100(c.fatigue - 35);
  c.burnout = clamp100(c.burnout - 25);
  c.stress = clamp100(c.stress - 25);
  c.motivation = clamp100(50 + (innate.ambition - 50) * 0.4);
  c.form = clamp100(c.form + (50 - c.form) * 0.5);

  s.peak = Math.max(s.peak, progress(s));
  s.history.push({ season, kind: "season", text: `Temporada ${season} cerrada (${band}, ${s.age} años)`, data: { age: s.age, band } });
  if (s.history.length > 200) s.history = s.history.slice(-200);

  return {
    state: s,
    transition: { playerId: s.playerId, name: undefined, cause: "season", season,
      before: { rating: beforeRating, age: prev.age, condition: { ...prev.condition } },
      after: { rating: progress(s), age: s.age, condition: { ...s.condition } },
      changes: diffChanges(pre, s) },
  };
}

/** Auto-progresión LIGERA de un jugador que NO jugó partidos del usuario (Live Esports). */
export function autoProgress(prev: DevState, innate: InnateProfile, season: number, rngKey: number): { state: DevState; transition: DevTransition } {
  // Simula una temporada propia: un puñado de "partidos" sintéticos según su nivel.
  // Determinista por (id, season): el mundo entero progresa, no solo el usuario.
  const s: DevState = structuredClone(prev);
  const pre = { traits: { ...s.traitDelta }, attrs: { ...s.attrDelta }, skill: { ...s.skill } as Record<SkillId, number> };
  const beforeRating = progress(prev);
  const headroom = clamp((innate.potential - progress(s)) / 30, 0, 1);
  const ageF = ageGrowthFactor(s.age, innate);
  // Rendimiento sintético determinista (-1..1) por la semilla.
  const perf = ((rngKey % 1000) / 1000) * 2 - 1;
  const g = innate.growthRate * headroom * Math.max(0, ageF) * (0.5 + (perf + 1) * 0.5);
  addAttr(s, "gameSense", 0.6 * g);
  addAttr(s, "aim", (ageF > 0 ? 0.5 : -0.6) * (0.5 + Math.abs(perf)));
  addTrait(s, "tacticalIQ", 0.4 * g);
  if (perf > 0.4) { addTrait(s, "selfBelief", 0.4 * g); s.condition.confidence = clamp100(s.condition.confidence + 2); }
  if (perf < -0.4) { addTrait(s, "composure", -0.3); s.condition.confidence = clamp100(s.condition.confidence - 2); }
  s.matchesPlayed += 3;
  s.peak = Math.max(s.peak, progress(s));
  return {
    state: s,
    transition: { playerId: s.playerId, name: undefined, cause: "season", season,
      before: { rating: beforeRating, age: prev.age, condition: { ...prev.condition } },
      after: { rating: progress(s), age: s.age, condition: { ...s.condition } },
      changes: diffChanges(pre, s) },
  };
}
