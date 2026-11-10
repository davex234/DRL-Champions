/**
 * TACTICAL INTELLIGENCE ENGINE — Asignación (concepto → posiciones).
 *
 * Aquí los CONCEPTOS se convierten en objetivos por jugador (targetZone + intent).
 * Es el único punto que toca a los SimPlayer. La defensa además detecta el carril de
 * CONTACTO y rota hacia él (comportamiento humano que castiga al ataque estático y
 * premia las fintas/splits del ataque inteligente).
 */
import { dist } from "../sim/geometry";
import { ZONES, nearestZone, type ZoneId } from "../sim/map/ascentA";
import type { RoundState, SimPlayer, Side } from "../sim/types";
import type { Role } from "../sim/attributes";
import { topByTrait } from "../sim/identity/modifiers";
import type { ConceptId, Lane, TeamTacticState } from "./types";
import { LANE_STAGE, LANE_CHOKE, laneOfPos, otherAttackLane } from "./map";
import { spatialDefenseZones, spatialRotateZone, spatialPostPlantZones } from "./spatial";

const FAKE_DUR = 32;
const aliveOf = (s: RoundState, side: Side) => s.players.filter((p) => p.side === side && p.alive);

const DEF_SPREAD: Record<Role, ZoneId> = {
  entry: "a_main_choke", support: "generator", igl: "ct", lurk: "heaven", anchor: "site",
};

// — primitivas de movimiento —
const stageAt = (p: SimPlayer, lane: Lane) => { p.targetZone = LANE_STAGE[lane]; p.intent = "move"; };
const holdAtChoke = (p: SimPlayer, lane: Lane) => { p.targetZone = LANE_CHOKE[lane]; p.intent = "hold"; };
const holdZone = (p: SimPlayer, z: ZoneId) => { p.targetZone = z; p.intent = "hold"; };
const retreat = (p: SimPlayer) => { p.targetZone = "atk_spawn"; p.intent = "fallback"; };

/**
 * Avanza por un carril hasta el sitio sin oscilar: mientras no haya llegado al choke
 * (zona discreta), apunta al choke; una vez en el choke o más allá, apunta al sitio.
 */
function advance(p: SimPlayer, lane: Lane, intent: SimPlayer["intent"]): void {
  const here = nearestZone(p.pos);
  const past = here === LANE_CHOKE[lane] || here === "site" || here === "plant";
  p.targetZone = past ? "site" : LANE_CHOKE[lane];
  p.intent = intent;
}
const pushLane = (p: SimPlayer, lane: Lane) => advance(p, lane, "push");

const activeConcept = (st: TeamTacticState): ConceptId =>
  st.plan.nodes.find((n) => n.id === st.activeNode)?.concept ?? "default";

/** Carril de contacto del ataque (a dónde están comprometiendo de verdad). */
export function contactLane(s: RoundState): { lane: Lane; count: number; contact: boolean } {
  const tally: Record<Lane, number> = { main: 0, tree: 0, mid: 0 };
  for (const p of aliveOf(s, "ATK")) {
    const lane = laneOfPos(p.pos);
    if (dist(p.pos, ZONES[LANE_CHOKE[lane]]) < 170 || dist(p.pos, ZONES.site) < 170) tally[lane]++;
  }
  let lane: Lane = "main", count = 0;
  for (const l of ["main", "tree", "mid"] as Lane[]) if (tally[l] > count) { count = tally[l]; lane = l; }
  return { lane, count, contact: s.phase === "EXECUTE" && count >= 2 };
}

// ---------------------------------------------------------------------------
// ATAQUE
// ---------------------------------------------------------------------------
export function assignAttack(s: RoundState, side: Side, st: TeamTacticState): void {
  const players = aliveOf(s, side);
  const lurker = topByTrait(s, side, "lurkTendency");
  // Órdenes del entrenador (Coach Command Layer): solo para el lado entrenado.
  const coached = s.coachSide === side;
  if (coached && s.coachFlags.laneFocus) st.lane = s.coachFlags.laneFocus;
  if (coached && s.tick < s.coachFlags.fallbackUntil) { for (const p of players) retreat(p); return; }
  const concept = activeConcept(st);

  if (s.phase === "POSTPLANT") {
    // Tactical Director 2.0: post-plant en CROSSFIRE (no apilados en el spike) si hay espacial.
    if (st.spatial) { const z = spatialPostPlantZones(s, side); for (const p of players) holdZone(p, z[p.id] ?? "plant"); }
    else { players.forEach((p, i) => holdZone(p, i === 0 ? "plant" : i % 2 ? "ct" : "tree")); }
    return;
  }
  if (concept === "save") { for (const p of players) retreat(p); return; }

  if (s.phase === "SETUP") {
    const control = concept === "map_control" || concept === "default" || concept === "play_picks";
    for (const p of players) {
      if (lurker && p.id === lurker.id && p.identity.lurkTendency > 55) { stageAt(p, otherAttackLane(st.lane)); continue; }
      if (control && (p.role === "support" || p.role === "igl")) stageAt(p, "mid");
      else stageAt(p, st.lane);
    }
    return;
  }

  // EXECUTE — según el concepto del nodo activo.
  const since = s.executeTick != null ? s.tick - s.executeTick : 999;
  const manAdvantage = players.length > aliveOf(s, side === "ATK" ? "DEF" : "ATK").length;
  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    const isLurker = lurker != null && p.id === lurker.id && p.identity.lurkTendency > 55;

    if (concept === "fake" && st.fakeLane) {
      if (since < FAKE_DUR) {
        // Finta: 2 cuerpos van al choke de la finta (presión), el resto espera el carril real.
        if (i < 2) holdAtChoke(p, st.fakeLane); else holdAtChoke(p, st.lane);
      } else {
        isLurker ? pushLane(p, otherAttackLane(st.lane)) : pushLane(p, st.lane);
      }
      continue;
    }
    if (concept === "split") {
      const lane: Lane = i % 2 === 0 ? st.lane : otherAttackLane(st.lane);
      pushLane(p, lane);
      continue;
    }
    if (concept === "rehit") { pushLane(p, otherAttackLane(st.lane)); continue; }
    if (concept === "play_picks") {
      // Pasivo: aguanta en el choke buscando un pick; al lograr ventaja numérica, COMPROMETE.
      if (manAdvantage) pushLane(p, st.lane);
      else if (isLurker) pushLane(p, otherAttackLane(st.lane));
      else holdAtChoke(p, st.lane);
      continue;
    }
    // Coach pide PACIENCIA: aguanta el choke buscando pick salvo ventaja numérica.
    if (coached && s.coachFlags.aggressionBias < 0) {
      if (manAdvantage) pushLane(p, st.lane); else holdAtChoke(p, st.lane);
      continue;
    }
    // explode / contact / eco_rush / default(hit) / lurk
    if (isLurker && (concept === "lurk" || concept === "default")) pushLane(p, otherAttackLane(st.lane));
    else pushLane(p, st.lane);
  }
}

// ---------------------------------------------------------------------------
// DEFENSA
// ---------------------------------------------------------------------------
export function assignDefense(s: RoundState, side: Side, st: TeamTacticState): void {
  const players = aliveOf(s, side);
  const coached = s.coachSide === side;
  if (coached && s.coachFlags.laneFocus) st.lane = s.coachFlags.laneFocus;
  const forceRetake = coached && s.coachFlags.forceRetake;

  // Coach: reagrupar/salvar (fallback) tiene prioridad en pre-plant.
  if (coached && !s.spike.planted && s.tick < s.coachFlags.fallbackUntil) {
    for (const p of players) holdZone(p, p.role === "anchor" ? "site" : "ct");
    return;
  }

  // Postplant → retake según estilo (o forzado por el coach).
  if (s.spike.planted) {
    if (st.style === "save" && !forceRetake) { for (const p of players) holdZone(p, p.role === "anchor" ? "site" : "ct"); return; }
    const delay = st.style === "aggressive" ? 0 : 30;
    const ready = forceRetake || s.tick >= (s.spike.plantedTick ?? s.tick) + delay;
    for (const p of players) {
      if (ready) { p.targetZone = "plant"; p.intent = "push"; }
      else holdZone(p, DEF_SPREAD[p.role]);
    }
    return;
  }

  const concept = activeConcept(st);
  const ct = contactLane(s);

  // Coach: ROTAR YA al carril de contacto (independiente del nodo del grafo).
  if (coached && s.coachFlags.forceRotation && ct.count > 0) {
    const rotateZone = st.spatial ? spatialRotateZone(s, side, ct.lane) : null;
    for (const p of players) {
      if (p.role === "anchor") { holdZone(p, "site"); continue; }
      if (rotateZone) { p.targetZone = rotateZone; p.intent = "rotate"; }
      else advance(p, ct.lane, "rotate");
    }
    return;
  }

  // Coach: APILAR (stack) el carril prioritario (precede al reparto espacial).
  if (coached && s.coachFlags.stack) {
    for (const p of players) {
      if (p.role === "anchor") holdZone(p, "site");
      else holdAtChoke(p, st.lane);
    }
    return;
  }

  // Adaptación: si el nodo activo es 'rotate', mueve a los holders (menos el ancla) al contacto.
  if (st.activeNode === "react" && ct.contact) {
    const rotateZone = st.spatial ? spatialRotateZone(s, side, ct.lane) : null;
    for (const p of players) {
      if (p.role === "anchor") { holdZone(p, "site"); continue; }
      if (rotateZone) { p.targetZone = rotateZone; p.intent = "rotate"; }
      else advance(p, ct.lane, "rotate");
    }
    return;
  }

  // ESPACIAL: holds, crossfires y anclaje SURGEN del Spatial Engine (no hardcode).
  if (st.spatial) {
    const zones = spatialDefenseZones(s, side, st);
    for (const p of players) holdZone(p, zones[p.id] ?? DEF_SPREAD[p.role]);
    return;
  }

  // Setup según concepto (reparto clásico por rol). El coach puede forzar info agresiva.
  const coachAggro = coached && s.coachFlags.aggressionBias > 0;
  for (const p of players) {
    if (coachAggro && (p.role === "entry" || p.role === "igl")) { p.targetZone = LANE_CHOKE[st.lane]; p.intent = "push"; continue; }
    if (concept === "stack") {
      if (p.role === "entry" || p.role === "support" || p.role === "igl") holdAtChoke(p, st.lane);
      else holdZone(p, p.role === "anchor" ? "site" : DEF_SPREAD[p.role]);
    } else if (concept === "crossfire") {
      if (p.role === "entry" || p.role === "igl") holdAtChoke(p, st.lane);
      else holdZone(p, DEF_SPREAD[p.role]);
    } else if (concept === "aggro_info") {
      if (p.role === "entry") { p.targetZone = LANE_CHOKE[st.lane]; p.intent = "push"; }
      else holdZone(p, DEF_SPREAD[p.role]);
    } else {
      // spread (default)
      holdZone(p, DEF_SPREAD[p.role]);
    }
  }
}
