/**
 * AGENT ENGINE — Análisis de COMPOSICIÓN (emergente, sin reglas por agente).
 *
 * Agrega los perfiles de capacidad de los 5 agentes en un retrato del equipo: ratings
 * (execute/control/info/retake/postplant/entry/scaling), arquetipo de estilo,
 * fortalezas/debilidades/sinergias/riesgos. Todo se deriva de las CAPACIDADES — añadir
 * un agente nuevo cambia los análisis sin tocar esta lógica. Lo consumen Tactical,
 * Coach, Preparation, Broadcast y Narrative.
 */
import { CAPABILITIES, CAPABILITY_LABEL, type Capability, type CapabilityProfile } from "./capabilities";
import type { Identity } from "../sim/identity/traits";
import type { AgentClass, AgentInstance } from "./types";
import { CLASS_LABEL } from "./types";
import { ns } from "@/i18n/runtime";

const tr = ns("agents");

export interface CompositionRatings {
  execute: number; control: number; info: number; retake: number;
  postplant: number; entry: number; midround: number; scaling: number;
}

export interface CompositionProfile {
  agents: { player: string; agentId: string; name: string; class: AgentClass }[];
  classCounts: Record<AgentClass, number>;
  avg: CapabilityProfile;
  peak: CapabilityProfile;
  coverage: Record<Capability, number>;
  ratings: CompositionRatings;
  archetype: string;
  archetypeLabel: string;
  playstyle: string[];
  strengths: string[];
  weaknesses: string[];
  synergies: string[];
  risks: string[];
  /** Utilidad total del equipo (cargas abstractas). */
  utilityCharges: number;
}

const round = (n: number) => Math.round(n);

/** Mezcla de capacidades: 60% media del equipo + 40% mejor especialista. */
function blend(avg: CapabilityProfile, peak: CapabilityProfile, caps: Capability[]): number {
  const a = caps.reduce((s, c) => s + avg[c], 0) / caps.length;
  const p = caps.reduce((s, c) => s + peak[c], 0) / caps.length;
  return round(0.6 * a + 0.4 * p);
}

/**
 * Analiza la composición de un equipo. `identityByName` (opcional) modula lo REALIZADO
 * (un equipo agresivo materializa más entrada/presión; uno disciplinado, más control).
 */
export function analyzeComposition(
  lineup: AgentInstance[],
  identityByName?: Record<string, Identity>,
): CompositionProfile {
  const n = Math.max(1, lineup.length);
  const avg = {} as CapabilityProfile;
  const peak = {} as CapabilityProfile;
  const coverage = {} as Record<Capability, number>;
  for (const c of CAPABILITIES) { avg[c] = 0; peak[c] = 0; coverage[c] = 0; }

  for (const inst of lineup) {
    const id = identityByName?.[inst.player];
    const aggr = id ? (id.aggression - 50) / 100 : 0;        // -0.5..0.5
    const disc = id ? (id.discipline - 50) / 100 : 0;
    for (const c of CAPABILITIES) {
      let v = inst.agent.capabilities[c];
      // Maestría del kit eleva las capacidades "de utilidad".
      if (c === "utility" || c === "initiation" || c === "control" || c === "information") v *= inst.mastery;
      // El ADN materializa el estilo: agresivos exprimen entrada/presión; disciplinados, control/anclaje.
      if (c === "entry" || c === "pressure" || c === "space") v *= 1 + aggr * 0.3;
      if (c === "control" || c === "anchor" || c === "postplant") v *= 1 + disc * 0.25;
      v = Math.max(0, Math.min(100, v));
      avg[c] += v;
      peak[c] = Math.max(peak[c], v);
      if (v >= 55) coverage[c] += 1;
    }
  }
  for (const c of CAPABILITIES) avg[c] = avg[c] / n;

  const ratings: CompositionRatings = {
    execute: blend(avg, peak, ["entry", "initiation", "space", "utility"]),
    control: blend(avg, peak, ["control", "space", "utility"]),
    info: blend(avg, peak, ["information", "initiation"]),
    retake: blend(avg, peak, ["retake", "rotation", "utility", "survival"]),
    postplant: blend(avg, peak, ["postplant", "control", "anchor", "utility"]),
    entry: blend(avg, peak, ["entry", "pressure", "trading", "space"]),
    midround: blend(avg, peak, ["information", "rotation", "lurk", "fake"]),
    scaling: blend(avg, peak, ["control", "survival", "information", "utility"]),
  };

  const classCounts = { controller: 0, initiator: 0, duelist: 0, sentinel: 0, flex: 0 } as Record<AgentClass, number>;
  for (const inst of lineup) classCounts[inst.agent.class]++;

  const { archetype, archetypeLabel, playstyle } = classifyStyle(ratings, classCounts);
  const strengths = topCaps(avg, true);
  const weaknesses = topCaps(avg, false);
  const synergies = detectSynergies(ratings, classCounts, coverage);
  const risks = detectRisks(ratings, classCounts);
  const utilityCharges = lineup.reduce((s, i) => s + i.agent.utility.charges, 0);

  return {
    agents: lineup.map((i) => ({ player: i.player, agentId: i.agent.id, name: i.agent.name, class: i.agent.class })),
    classCounts, avg, peak, coverage, ratings,
    archetype, archetypeLabel, playstyle, strengths, weaknesses, synergies, risks, utilityCharges,
  };
}

// ---- Estilo / arquetipo (lo que hace decir "juegan como…") ----
function classifyStyle(r: CompositionRatings, cc: Record<AgentClass, number>): { archetype: string; archetypeLabel: string; playstyle: string[] } {
  const scores: Record<string, number> = {
    control: r.control * 1.1 + r.scaling - r.entry * 0.4,
    aggressive: r.entry * 1.2 + r.execute * 0.5 - r.control * 0.4,
    info: r.info * 1.3 + r.midround * 0.5,
    postplant: r.postplant * 1.2 + cc.sentinel * 8,
    flexible: r.midround * 1.1 + cc.flex * 10,
  };
  const archetype = Object.keys(scores).reduce((a, b) => (scores[b] > scores[a] ? b : a), "control");
  const LABEL: Record<string, string> = {
    control: tr("Composición de control"), aggressive: tr("Composición agresiva"),
    info: tr("Composición de información"), postplant: tr("Composición de post-plant"), flexible: tr("Composición flexible"),
  };
  const tags: string[] = [];
  if (r.control >= 60) tags.push(tr("vive del control"));
  if (r.entry >= 65) tags.push(tr("busca duelos de apertura"));
  if (r.info >= 62) tags.push(tr("juega por picks e info"));
  if (r.postplant >= 62) tags.push(tr("abusa del post-plant"));
  if (r.retake >= 62) tags.push(tr("fuerte en retake"));
  if (r.scaling >= 62) tags.push(tr("escala a rondas largas"));
  if (tags.length === 0) tags.push("equilibrada");
  return { archetype, archetypeLabel: LABEL[archetype], playstyle: tags };
}

function topCaps(avg: CapabilityProfile, high: boolean): string[] {
  const arr = CAPABILITIES.map((c) => [c, avg[c]] as [Capability, number]).sort((a, b) => (high ? b[1] - a[1] : a[1] - b[1]));
  return arr.slice(0, 3).filter(([, v]) => (high ? v >= 55 : v <= 35)).map(([c]) => CAPABILITY_LABEL[c]);
}

function detectSynergies(r: CompositionRatings, cc: Record<AgentClass, number>, cov: Record<Capability, number>): string[] {
  const out: string[] = [];
  if (cov.information >= 1 && cov.entry >= 1) out.push(tr("Info + entrada: entradas con información."));
  if (cc.initiator >= 2) out.push(tr("Doble iniciador: dominio de la fase media y picks."));
  if (r.control >= 60 && r.postplant >= 60) out.push(tr("Control + post-plant: cierres de plante muy sólidos."));
  if (cc.controller >= 1 && cc.duelist >= 1 && cov.utility >= 2) out.push(tr("Humos + entrada: ejecuciones limpias."));
  if (cc.sentinel >= 1 && r.info >= 55) out.push(tr("Centinela + info: defensa que no se rompe a la primera."));
  if (cov.lurk >= 1 && r.control >= 55) out.push(tr("Control + lurk: el flanco castiga las rotaciones."));
  return out;
}

function detectRisks(r: CompositionRatings, cc: Record<AgentClass, number>): string[] {
  const out: string[] = [];
  if (r.retake < 40) out.push(tr("Retake flojo: si plantan, cuesta recuperar."));
  if (r.info < 42) out.push(tr("Poca información: jugarás a ciegas en la fase media."));
  if (r.control < 42) out.push(tr("Poco control de mapa: difícil ejecutar contra defensas firmes."));
  if (r.entry >= 70 && r.control < 45) out.push(tr("Demasiada entrada y poco control: ejecuciones a lo loco."));
  if (cc.sentinel === 0) out.push(tr("Sin centinela: el post-plant y el anclaje sufren."));
  if (cc.controller === 0) out.push(tr("Sin controlador: ejecuciones expuestas, sin humos."));
  return out;
}

// ---- Comparación entre composiciones (para el coach) ----
export interface CompositionMatchup {
  recommendations: string[];
  edge: number; // -100..100 a favor nuestro (estimación de macro)
}

export function compareCompositions(ours: CompositionProfile, theirs: CompositionProfile): CompositionMatchup {
  const o = ours.ratings, t = theirs.ratings;
  const rec: string[] = [];
  if (o.scaling > t.scaling + 8) rec.push(tr("Nuestra composición escala mejor: alarga las rondas."));
  if (t.retake < 40) rec.push(tr("Ellos no tienen retake: prioriza plantar y jugar el post-plant."));
  if (t.control < 42) rec.push(tr("Les falta control: presiona el mapa, no podrán ejecutar limpio."));
  if (o.entry > 70 && o.control < 45) rec.push(tr("Tenemos demasiada entrada: añade control o caeréis al primer duelo."));
  if (o.info < 42) rec.push(tr("Nos falta información: juega más lento y saca info antes de comprometer."));
  if (o.control < 42) rec.push(tr("No tenemos control del mapa: evita defaults largos."));
  if (o.info > t.info + 10) rec.push(tr("Dominamos la información: castiga sus defaults con picks."));
  if (o.entry > t.retake + 12) rec.push(tr("Nuestra entrada supera su retake: ejecuciones rápidas."));
  if (rec.length === 0) rec.push(tr("Composiciones parejas: ganará la mejor ejecución."));

  const edge = Math.max(-100, Math.min(100, Math.round(
    (o.execute - t.retake) * 0.3 + (o.control - t.control) * 0.25 +
    (o.info - t.info) * 0.2 + (o.scaling - t.scaling) * 0.25,
  )));
  return { recommendations: rec, edge };
}
