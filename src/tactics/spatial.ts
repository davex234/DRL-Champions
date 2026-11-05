/**
 * TACTICAL ENGINE × SPATIAL ENGINE — Puente.
 *
 * Aquí la táctica DEJA DE HARDCODEAR posiciones: los holds, los crossfires, el carril
 * de menor exposición y los puntos de rotación SURGEN del Spatial Engine. Si el flag
 * espacial está apagado, la táctica usa su reparto clásico por rol (para comparar).
 */
import type { RoundState, SimPlayer, Side } from "../sim/types";
import type { ZoneId } from "../sim/map/ascentA";
import { nearestZone } from "../sim/map/ascentA";
import {
  ascentSpatial, holdsCovering, rotationTarget,
  attackLaneByExposure, computeControl, occupancy,
} from "../spatial";
import type { Lane, OpponentModel, TeamTacticState } from "./types";
import { LANE_CHOKE, ATTACK_LANES } from "./map";

const SM = ascentSpatial();

const aliveOf = (s: RoundState, side: Side) => s.players.filter((p) => p.side === side && p.alive);

/** Zonas que ocupa un bando ahora mismo (deduplicadas). */
export function occZones(s: RoundState, side: Side): string[] {
  const set = new Set<string>();
  for (const p of aliveOf(s, side)) set.add(nearestZone(p.pos));
  return [...set];
}

/** Espacio controlado por bando (para telemetría/lecturas). */
export function controlSpace(s: RoundState): Record<Side, number> {
  const ctrl = computeControl(SM, occupancy(occZones(s, "ATK"), occZones(s, "DEF")));
  return ctrl.space;
}

// Territorio del ATAQUE: la defensa no debe aguantar ahí pre-contacto (se aísla y
// muere). El resto (chokes incluidos, como frontline) sí es holdable.
const ATTACKER_ZONES = ["atk_spawn", "a_main", "tree"];

const defHoldList = (choke: string, exclude: string[] = []) =>
  holdsCovering(SM, choke, { exclude: [...ATTACKER_ZONES, ...exclude], limit: 6 }).map((h) => h.zone);

const bestHold = (choke: string, exclude: string[]): ZoneId =>
  (defHoldList(choke, exclude)[0] ?? "site") as ZoneId;

/** Crossfire DEFENSIVO sobre un choke: dos holds del lado defensor con ángulos distintos. */
function defensiveCrossfire(choke: string): [ZoneId, ZoneId] | null {
  const hs = defHoldList(choke);
  if (hs.length < 2) return null;
  const a = hs[0];
  const ba = SM.bearing[SM.index[a]][SM.index[choke]];
  for (const b of hs.slice(1)) {
    let d = Math.abs(ba - SM.bearing[SM.index[b]][SM.index[choke]]);
    if (d > Math.PI) d = 2 * Math.PI - d;
    if (d > 0.5) return [a as ZoneId, b as ZoneId];
  }
  return [a as ZoneId, hs[1] as ZoneId];
}

/**
 * Carril de ATAQUE de menor exposición (Main/Mid), dado dónde defiende el rival
 * (según el modelo). Surge de las rutas del Spatial Engine, no de una tabla.
 */
export function spatialAttackLane(model: OpponentModel): Lane {
  // Reconstruye la defensa probable: chokes que el rival aguanta + holds estándar.
  const enemyZones = new Set<string>(["site", "generator", "ct"]);
  for (const lane of ["main", "tree", "mid"] as Lane[]) {
    if (model.defendLane[lane] > 0) enemyZones.add(LANE_CHOKE[lane]);
  }
  const lanes = ATTACK_LANES.map((lane) => ({ lane, choke: LANE_CHOKE[lane] }));
  const best = attackLaneByExposure(SM, "atk_spawn", "site", lanes, [...enemyZones]);
  return best.lane as Lane;
}

/**
 * Posiciones de DEFENSA derivadas del espacio: monta un crossfire sobre el choke
 * amenazado, ancla el sitio y reparte holds que baten las aproximaciones. Devuelve
 * la zona asignada por id de jugador.
 */
export function spatialDefenseZones(s: RoundState, side: Side, st: TeamTacticState): Record<string, ZoneId> {
  const players = aliveOf(s, side);
  const out: Record<string, ZoneId> = {};
  const used: string[] = [];
  const take = (p: SimPlayer, zone: ZoneId) => { out[p.id] = zone; used.push(zone); };

  const primary = LANE_CHOKE[st.lane];           // choke principal a tapar
  const secondary = st.lane === "mid" ? LANE_CHOKE.main : LANE_CHOKE.mid;
  const cf = defensiveCrossfire(primary);        // crossfire DEFENSIVO (lado defensor)

  const anchor = players.find((p) => p.role === "anchor");
  if (anchor) take(anchor, "site");
  const rest = players.filter((p) => p !== anchor);

  const stacking = st.concept === "stack" || st.concept === "crossfire";
  let ci = 0;
  for (const p of rest) {
    if (st.concept === "aggro_info" && p.role === "entry") { take(p, primary as ZoneId); continue; }
    if (stacking && cf && ci < 2) { take(p, cf[ci] as ZoneId); ci++; continue; }
    // Reparto por rol sobre holds espaciales (cubre primario/secundario/flanco).
    if (p.role === "support") take(p, bestHold(secondary, used));
    else if (p.role === "lurk") take(p, bestHold(LANE_CHOKE.tree, used));
    else take(p, bestHold(primary, used)); // entry / igl
  }
  return out;
}

/** A dónde rotar ante un contacto en `contactLane` (mejor hold que lo bate). */
export function spatialRotateZone(s: RoundState, side: Side, contactLane: Lane): ZoneId {
  const choke = LANE_CHOKE[contactLane];
  return rotationTarget(SM, choke, occZones(s, side), ["atk_spawn", "def_spawn"]) as ZoneId;
}

/**
 * POST-PLANT (Tactical Director 2.0): el ataque NO se queda en el spike. Reparte a holds que
 * baten el sitio desde ÁNGULOS DISTINTOS (crossfire sobre el defuser), uno cerca para negar el
 * defuse y el resto a posiciones de bait/trade/flanco. Surge del Spatial Engine (no hardcode).
 */
export function spatialPostPlantZones(s: RoundState, side: Side): Record<string, ZoneId> {
  const players = aliveOf(s, side);
  const out: Record<string, ZoneId> = {};
  // Holds que cubren el sitio (posiciones de post-plant); diversos ángulos = crossfire.
  const spots = holdsCovering(SM, "site", { exclude: ["def_spawn"], limit: 6 }).map((h) => h.zone);
  const ordered = [...new Set([...spots, "plant", "ct", "heaven", "tree"])];
  players.forEach((p, i) => {
    // Un cuerpo ancla el defuse (cerca del spike); el resto reparte ángulos.
    out[p.id] = (i === 0 ? "plant" : ordered[(i) % ordered.length]) as ZoneId;
  });
  return out;
}
