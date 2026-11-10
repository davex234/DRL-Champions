/**
 * BRAIN ENGINE — generación de OPCIONES (átomos de acción, no un árbol).
 *
 * Cada tick el jugador enumera las acciones POSIBLES dadas su situación y sus creencias.
 * El evaluador las puntúa después. Aquí solo se proponen (con su zona/enemigo objetivo).
 */
import { nearestZone, type ZoneId } from "../sim/map/ascentA";
import { canSee } from "../sim/perception";
import { dist } from "../sim/geometry";
import type { RoundState, SimPlayer, Side } from "../sim/types";
import type { Beliefs } from "./beliefs";
import type { Option } from "./types";

const objectiveZone = (s: RoundState): ZoneId => (s.spike.planted ? "plant" : "site");
const backZone = (side: Side): ZoneId => (side === "ATK" ? "a_main" : "site");
const saveZone = (side: Side): ZoneId => (side === "ATK" ? "atk_spawn" : "def_spawn");
const flankZone = (side: Side): ZoneId => (side === "ATK" ? "tree_choke" : "heaven");

const LANE_CHOKE: Record<string, ZoneId> = { main: "a_main_choke", tree: "tree_choke", mid: "generator" };

function rotateTarget(s: RoundState, p: SimPlayer, b: Beliefs): ZoneId {
  if (p.side === "DEF") return b.stackLane ? LANE_CHOKE[b.stackLane] ?? "site" : "site";
  // ATK: evita el carril que crees stackeado (busca el otro).
  if (b.stackLane === "main") return "tree_choke";
  if (b.stackLane === "tree") return "a_main_choke";
  return "mid";
}

/** Enemigo objetivo para combatir: visible primero, si no el más fiable recordado. */
function targetEnemy(s: RoundState, p: SimPlayer, b: Beliefs): string | undefined {
  for (const e of s.players) if (e.side !== p.side && e.alive && canSee(p, e)) return e.id;
  if (b.nearest && b.nearest.conf > 0.4 && b.nearest.dist < 360) return b.nearest.id;
  return undefined;
}

/** ¿Hay un compañero en apuros cerca (en combate o caído reciente)? */
export function allyInTrouble(s: RoundState, p: SimPlayer): SimPlayer | null {
  let best: SimPlayer | null = null, bd = 320;
  for (const a of s.players) {
    if (a.side !== p.side || !a.alive || a.id === p.id) continue;
    const fighting = a.targetEnemyId != null;
    const d = dist(p.pos, a.pos);
    if (fighting && d < bd) { bd = d; best = a; }
  }
  return best;
}

export function generateOptions(s: RoundState, p: SimPlayer, b: Beliefs): Option[] {
  const opts: Option[] = [];
  const myZone = nearestZone(p.pos);

  // Combate (si hay a quién).
  const foe = targetEnemy(s, p, b);
  if (foe) opts.push({ kind: "fight", enemyId: foe });

  // Posicionamiento básico (siempre posibles).
  opts.push({ kind: "hold", zone: myZone });
  opts.push({ kind: "wait", zone: myZone });
  opts.push({ kind: "fall_back", zone: backZone(p.side) });
  opts.push({ kind: "save", zone: saveZone(p.side) });

  // Avanzar / objetivo.
  opts.push({ kind: "push", zone: objectiveZone(s) });
  opts.push({ kind: "rotate", zone: rotateTarget(s, p, b) });
  opts.push({ kind: "flank", zone: flankZone(p.side) });

  // Trade / cobertura.
  if (b.nearest && b.nearest.conf > 0.3) opts.push({ kind: "seek_trade", enemyId: b.nearest.id, point: b.nearest.pos });
  const mate = allyInTrouble(s, p);
  if (mate) opts.push({ kind: "cover_ally", zone: nearestZone(mate.pos), point: { ...mate.pos } });

  // Post-plant.
  if (s.spike.planted && p.side === "ATK") opts.push({ kind: "play_postplant", zone: "plant" });

  return opts;
}
