/**
 * Percepción: qué ve cada jugador (LOS + rango) y qué recuerda (lastSeen).
 * Información IMPERFECTA e individual: cada jugador solo sabe lo suyo. El coach,
 * en cambio, lo ve todo (eso lo gestiona la UI, no este módulo).
 */
import { dist, lineClear } from "./geometry";
import { WALLS, nearestZone } from "./map/ascentA";
import type { RoundState, SimPlayer } from "./types";

export const VISION_RANGE = 470;
export const SOUND_RANGE = 150;
const MEMORY_TICKS = 60; // ~3 s recordando una última posición

export const enemies = (s: RoundState, p: SimPlayer): SimPlayer[] =>
  s.players.filter((q) => q.side !== p.side && q.alive);
export const allies = (s: RoundState, p: SimPlayer): SimPlayer[] =>
  s.players.filter((q) => q.side === p.side && q.alive && q.id !== p.id);

/** ¿Tiene `p` línea de visión a `q` dentro de rango? */
export function canSee(p: SimPlayer, q: SimPlayer): boolean {
  if (!q.alive) return false;
  if (dist(p.pos, q.pos) > VISION_RANGE) return false;
  return lineClear(p.pos, q.pos, WALLS);
}

/**
 * Actualiza `lastSeen` de todos (LOS + sonido) y devuelve, por jugador vivo, la
 * lista de ids de enemigos VISIBLES ahora mismo. Muta el estado (ya clonado por el motor).
 */
export function computeVisibility(s: RoundState): Record<string, string[]> {
  const visible: Record<string, string[]> = {};
  // Utility Engine: el overlay corta visión (smoke) y la recon comparte info.
  const ov = s.map?.overlay;
  const reconSides = new Set((s.map?.active ?? []).filter((u) => u.kind === "recon").map((u) => u.side));
  for (const p of s.players) {
    if (!p.alive) { visible[p.id] = []; continue; }
    const seen: string[] = [];
    for (const e of s.players) {
      if (e.side === p.side || !e.alive) continue;
      let known = false;
      if (canSee(p, e)) {
        known = true;
        // Smoke: si la línea entre sus zonas está bloqueada, no hay visión real.
        if (ov && ov.blockedSight.has(`${nearestZone(p.pos)}|${nearestZone(e.pos)}`)) known = false;
      } else if (dist(p.pos, e.pos) < SOUND_RANGE && e.movedThisTick) {
        // Sonido de pasos: revela posición aproximada, pero no cuenta como "visible".
        p.lastSeen[e.id] = { pos: { ...e.pos }, tick: s.tick };
      }
      // Recon: la información compartida revela la posición a quien tiene recon activo.
      if (!known && ov && reconSides.has(p.side) && ov.revealedZones.has(nearestZone(e.pos))) {
        p.lastSeen[e.id] = { pos: { ...e.pos }, tick: s.tick };
      }
      if (known) {
        seen.push(e.id);
        p.lastSeen[e.id] = { pos: { ...e.pos }, tick: s.tick };
      }
    }
    // Olvido de memoria vieja.
    for (const id of Object.keys(p.lastSeen)) {
      if (s.tick - p.lastSeen[id].tick > MEMORY_TICKS) delete p.lastSeen[id];
    }
    visible[p.id] = seen;
  }
  return visible;
}
