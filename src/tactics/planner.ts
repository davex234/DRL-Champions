/**
 * TACTICAL INTELLIGENCE ENGINE — Planner.
 *
 * CONSTRUYE la estrategia de la ronda (un Tactical Graph de datos) a partir de:
 * economía, marcador-implícito, lecturas del rival, identidad del equipo y la orden
 * de CONCEPTO del entrenador. No hay estrategias completas hardcodeadas: se componen
 * de átomos (conceptos) + se enlazan objetivos→acciones→fallbacks→adaptaciones.
 */
import type { Rng } from "../sim/rng";
import type { RoundState, Side } from "../sim";
import type {
  ConceptId, ConceptOrder, Lane, TacticalPlan, TeamSeed, TeamTacticState,
} from "./types";
import { otherAttackLane, toAttackLane } from "./map";
import {
  leastDefendedLane, patternStrength, predictedAttackLane, worstAttackLane, tacticalReads,
} from "./opponent";
import { spatialAttackLane } from "./spatial";
import { ns, td } from "@/i18n/runtime";

const t = ns("tactics");

const TEMPO_TICK: Record<string, number> = { slow: 110, mid: 80, fast: 45 };

const teamAggression = (s: RoundState, side: Side): number => {
  const ps = s.players.filter((p) => p.side === side);
  return ps.reduce((a, p) => a + p.identity.aggression, 0) / Math.max(1, ps.length);
};

const jitter = (rng: Rng, n: number) => Math.round((rng.next() * 2 - 1) * n);

/** Elección ponderada determinista (pesos ≥ 0, sesgo r∈[0,1)). */
function weightedPick<T extends string>(weights: Record<T, number>, r: number): T {
  const keys = Object.keys(weights) as T[];
  const total = keys.reduce((s, k) => s + Math.max(0, weights[k]), 0) || 1;
  let acc = r * total;
  for (const k of keys) { acc -= Math.max(0, weights[k]); if (acc <= 0) return k; }
  return keys[keys.length - 1];
}

// ---- Mapa orden-de-concepto → concepto interno ----
function conceptFromOrder(o: ConceptOrder): ConceptId {
  return o.intent;
}

export function buildAttackState(s: RoundState, side: Side, seed: TeamSeed, rng: Rng): TeamTacticState {
  const m = seed.model;
  const aggr = teamAggression(s, side);
  const least = leastDefendedLane(m);
  const worst = worstAttackLane(m);
  const notes: string[] = [];

  let concept: ConceptId = "default";
  let lane: Lane = least;
  let fakeLane: Lane | null = null;
  let tempo = "mid";

  if (seed.order) {
    concept = conceptFromOrder(seed.order);
    lane = seed.order.lane ?? least;
    tempo = seed.order.tempo ?? tempo;
    notes.push(t("orden del coach: {concept}{v}", { concept, v: seed.order.lane ? " " + seed.order.lane : "" }));
  } else if (seed.economy.buy === "eco") {
    concept = "eco_rush"; lane = least; tempo = "fast";
    notes.push(`eco: rush a ${lane}`);
  } else if (seed.economy.buy === "force") {
    concept = aggr > 60 ? "explode" : "contact"; lane = least; tempo = "fast";
    notes.push(`force buy: ${concept} a ${lane}`);
  } else {
    // Compra completa: la COMPOSICIÓN (Agent Engine) decide el estilo de forma
    // emergente — no hay reglas por agente, solo pesos derivados de las capacidades.
    const r = rng.next();
    const comp = s.composition?.[side];
    if (worst.net >= 2) {
      // Llevamos perdiendo un carril → FINTA y golpea por el otro (rompe el patrón).
      concept = "fake"; lane = otherAttackLane(worst.lane);
      notes.push(t("anti-strat: re-pega por {lane} con finta", { lane }));
    } else if (comp) {
      const rt = comp.ratings;
      const weights = {
        explode: rt.entry * (0.8 + aggr / 100),
        split: (rt.entry + rt.control) / 2,
        play_picks: rt.info * 1.1,
        lurk: comp.avg.lurk + rt.midround * 0.5,
        default: (rt.control + rt.scaling * 0.5) * (1.2 - aggr / 200),
      };
      concept = weightedPick(weights, r);
      lane = concept === "play_picks" ? "mid" : least;
      // El RITMO emerge de la comp: entrada alta → rápido; control alto → lento.
      tempo = rt.entry > rt.control + 8 ? "fast" : rt.control > rt.entry + 8 ? "slow" : "mid";
      notes.push(t("composición {archetype} → {concept} ({tempo})", { archetype: td(comp.archetype), concept, tempo: td(tempo) }));
    } else if (aggr > 64 && r < 0.5) {
      concept = r < 0.25 ? "explode" : "split"; lane = least;
      notes.push(`${concept} agresivo a ${lane}`);
    } else {
      concept = "default"; lane = least;
      notes.push(t("default lento, control de mid → hit {lane}", { lane }));
    }
  }

  // El ataque en grupo solo es transitable por Main/Mid en este slice.
  lane = toAttackLane(lane);
  // Espacial: si está activo, el coach no fija carril y la ruta de menor exposición
  // coincide con un carril infra-defendido (el modelo lo respalda), reorienta el hit.
  if (seed.useSpatial && !seed.order?.lane) {
    const sl = spatialAttackLane(m);
    if (sl !== lane && m.defendLane[sl === "main" ? "main" : "mid"] <= m.defendLane[lane === "main" ? "main" : "mid"]) {
      notes.push(t("espacial: carril de menor exposición → {sl}", { sl }));
      lane = sl;
    }
  }
  fakeLane = concept === "fake" ? otherAttackLane(lane) : null;

  const slowConcept = concept === "default" || concept === "play_picks" || concept === "map_control";
  let commitTick = (TEMPO_TICK[tempo] ?? 80) + jitter(rng, 12);
  if (slowConcept) commitTick += 24;
  commitTick = Math.max(20, commitTick);

  const plan = buildAttackGraph(concept);
  return {
    side, buy: seed.economy.buy, order: seed.order ?? null, concept, plan, activeNode: plan.rootId,
    lane, fakeLane, commitTick, style: "default", adapted: false, spatial: seed.useSpatial ?? false,
    phase: "prepare", reads: tacticalReads(m), notes,
  };
}

export function buildDefenseState(s: RoundState, side: Side, seed: TeamSeed, rng: Rng): TeamTacticState {
  const m = seed.model;
  const aggr = teamAggression(s, side);
  const pat = patternStrength(m);
  const pred = predictedAttackLane(m);
  const notes: string[] = [];

  let concept: ConceptId = "spread";
  let lane: Lane = pred.lane;
  let style = "default";

  if (seed.order) {
    concept = conceptFromOrder(seed.order);
    lane = seed.order.lane ?? lane;
    style = seed.order.style ?? style;
    notes.push(t("orden del coach: {concept}", { concept }));
  } else if (pat.strength >= 0.66) {
    concept = "stack"; lane = pat.lane;
    notes.push(t("anti-strat: stack {lane} (patrón {v}%)", { lane, v: (pat.strength * 100) | 0 }));
  } else if (pred.confidence >= 0.5 && m.rounds >= 3) {
    concept = "stack"; lane = pred.lane;
    notes.push(t("stack {lane} (lo más atacado)", { lane }));
  } else if (s.composition?.[side]) {
    // La COMPOSICIÓN decide la postura defensiva de forma emergente.
    const rt = s.composition[side].ratings;
    const av = s.composition[side].avg;
    const w = {
      aggro_info: rt.entry,
      crossfire: rt.info + av.anchor * 0.5,
      stack: rt.info * 0.8,
      spread: rt.control + rt.scaling * 0.5,
    };
    concept = weightedPick(w, rng.next());
    if (concept === "stack" || concept === "crossfire") lane = pred.lane;
    notes.push(t("composición {archetype} → {concept}", { archetype: td(s.composition[side].archetype), concept }));
  } else if (aggr > 64 && rng.next() < 0.5) {
    concept = "aggro_info";
    notes.push(t("aggro info temprana"));
  } else {
    concept = "spread";
    notes.push(t("spread defensivo"));
  }

  // Estilo de retake: la orden del coach manda; si no, economía + agresividad.
  if (seed.order?.style) style = seed.order.style;
  else if (seed.economy.buy === "eco") style = "save";
  else style = aggr > 58 ? "aggressive" : "default";

  const plan = buildDefenseGraph(concept);
  return {
    side, buy: seed.economy.buy, order: seed.order ?? null, concept, plan, activeNode: plan.rootId,
    lane, fakeLane: null, commitTick: 0, style, adapted: false, spatial: seed.useSpatial ?? false,
    phase: "prepare", reads: tacticalReads(m), notes,
  };
}

// ---- Construcción de los grafos (objetivos→acciones→fallbacks) ----
function buildAttackGraph(concept: ConceptId): TacticalPlan {
  // Conceptos lentos: primero control de mapa, luego golpe.
  if (concept === "default" || concept === "play_picks") {
    return {
      rootId: "control",
      nodes: [
        { id: "control", kind: "objective", concept: "map_control", params: {} },
        { id: "hit", kind: "action", concept: concept === "play_picks" ? "play_picks" : "explode", params: {} },
        { id: "rehit", kind: "fallback", concept: "rehit", params: {} },
        { id: "save", kind: "fallback", concept: "save", params: {} },
      ],
      edges: [
        { from: "control", to: "hit", when: "atCommit" },
        { from: "hit", to: "rehit", when: "contactBad" },
        { from: "rehit", to: "save", when: "contactBad" },
      ],
    };
  }
  // Conceptos directos: a la acción desde el inicio.
  return {
    rootId: "hit",
    nodes: [
      { id: "hit", kind: "action", concept, params: {} },
      { id: "rehit", kind: "fallback", concept: "rehit", params: {} },
      { id: "save", kind: "fallback", concept: "save", params: {} },
    ],
    edges: [
      { from: "hit", to: "rehit", when: "contactBad" },
      { from: "rehit", to: "save", when: "outnumbered" },
    ],
  };
}

function buildDefenseGraph(concept: ConceptId): TacticalPlan {
  return {
    rootId: "setup",
    nodes: [
      { id: "setup", kind: "objective", concept, params: {} },
      { id: "react", kind: "adaptation", concept: "rotate", params: {} },
      { id: "retake", kind: "action", concept: "retake", params: {} },
    ],
    edges: [
      { from: "setup", to: "react", when: "contactDetected" },
      { from: "setup", to: "retake", when: "planted" },
      { from: "react", to: "retake", when: "planted" },
    ],
  };
}
