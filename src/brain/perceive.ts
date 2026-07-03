/**
 * BRAIN ENGINE — PERCEPCIÓN → memoria.
 *
 * Traduce lo que el jugador VE/OYE/recibe (visión, sonido, recon, utilidad enemiga,
 * spike) a recuerdos con confianza, aprende por dónde aparece el rival (laneSeen) y
 * EMITE comunicación a sus compañeros. No conoce la verdad: solo su percepción.
 */
import { dist } from "../sim/geometry";
import { ZONES, nearestZone, type ZoneId } from "../sim/map/ascentA";
import { canSee, VISION_RANGE } from "../sim/perception";
import type { RoundState, SimPlayer } from "../sim/types";
import { rememberEnemy } from "./memory";
import { emitComm } from "./comms";

const LANE_OF: Partial<Record<ZoneId, "main" | "tree" | "mid">> = {
  a_main: "main", a_main_choke: "main", tree: "tree", tree_choke: "tree", mid: "mid", generator: "mid",
};

export function perceive(s: RoundState, p: SimPlayer): void {
  if (!p.brain) return;
  const mem = p.brain.memory;
  const myZone = nearestZone(p.pos);

  // 1) Enemigos: visión directa (conf alta) / recon-sonido (conf media), vía lastSeen.
  for (const e of s.players) {
    if (e.side === p.side || !e.alive) continue;
    const seen = p.lastSeen[e.id];
    const sighted = canSee(p, e);
    if (sighted) {
      rememberEnemy(mem, e.id, { pos: { ...e.pos }, tick: s.tick, baseConf: 1, source: "sight" });
      const lane = LANE_OF[nearestZone(e.pos)];
      if (lane) mem.laneSeen[lane] += 1;
      // Comunica el contacto (no cada tick: al verlo nuevo o periódicamente).
      if (s.tick % 8 === 0) emitComm(s, p, "contact", { enemyId: e.id, pos: { ...e.pos } });
    } else if (seen && seen.tick === s.tick) {
      // Conocido este tick sin LOS = sonido o recon (info de menor calidad).
      rememberEnemy(mem, e.id, { pos: { ...seen.pos }, tick: s.tick, baseConf: 0.55, source: "sound" });
    }
  }

  // 2) Utilidad ENEMIGA percibida (humo/recon/molly) cerca o a la vista.
  if (s.map) {
    for (const u of s.map.active) {
      if (u.side === p.side) continue;
      const z = u.zone ?? u.sightline?.[0];
      if (!z) continue;
      if (dist(p.pos, ZONES[z]) < VISION_RANGE) {
        mem.utilSeen.push({ zone: z, tick: s.tick, conf: 0.9 });
        if (s.tick % 12 === 0) emitComm(s, p, "util_spent", { zone: z });
      }
    }
    if (mem.utilSeen.length > 6) mem.utilSeen = mem.utilSeen.slice(-6);
  }

  // 3) Spike.
  if (s.spike.planted && s.spike.pos && dist(p.pos, s.spike.pos) < VISION_RANGE) {
    mem.spike = { pos: { ...s.spike.pos }, tick: s.tick, conf: 1 };
    if (s.tick % 16 === 0) emitComm(s, p, "spike", { pos: { ...s.spike.pos } });
  }

  // 4) Zona propia limpia (sin enemigos conocidos cerca) → memoria de "limpio".
  const enemyNear = Object.values(mem.enemies).some((m) => s.tick - m.tick < 30 && dist(p.pos, m.pos) < 200);
  if (!enemyNear) mem.clear[myZone] = { zone: myZone, tick: s.tick, conf: 0.8 };
}
