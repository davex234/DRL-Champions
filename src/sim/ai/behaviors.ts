/**
 * Helpers de comportamiento reutilizables por la IA: movimiento por waypoints,
 * selección de objetivo visible, orientación. Puros.
 */
import { angleTo, dist, moveToward, type Vec2 } from "../geometry";
import { ZONES, nearestZone, route, type ZoneId } from "../map/ascentA";
import { peekDelayTicks } from "../attributes";
import { canSee } from "../perception";
import { reactDelta } from "../identity/modifiers";
import type { RoundState, SimPlayer } from "../types";

export const MOVE_STEP = 7; // unidades por tick (~140 u/s a 20 tps)
const ARRIVE = 14;

/** Mueve al jugador un paso hacia `targetZone` siguiendo el grafo de corredores. */
export function stepAlongRoute(p: SimPlayer, targetZone: ZoneId): void {
  const here = nearestZone(p.pos);
  if (here === targetZone && dist(p.pos, ZONES[targetZone]) <= ARRIVE) {
    p.movedThisTick = false;
    return;
  }
  const path = route(here, targetZone);
  const nextZone = path[0] === here ? path[1] ?? targetZone : path[0];
  const before = { ...p.pos };
  p.pos = moveToward(p.pos, ZONES[nextZone], MOVE_STEP);
  p.movedThisTick = dist(before, p.pos) > 0.5;
  if (p.movedThisTick) p.facing = angleTo(before, p.pos);
}

/** Avanza hacia un punto arbitrario (p. ej. re-asomar a una última posición vista). */
export function moveTowardPoint(p: SimPlayer, point: Vec2): void {
  const before = { ...p.pos };
  p.pos = moveToward(p.pos, point, MOVE_STEP);
  p.movedThisTick = dist(before, p.pos) > 0.5;
  if (p.movedThisTick) p.facing = angleTo(before, p.pos);
}

/** Mantiene posición (con micro-ajuste al punto de hold) sin "moverse" tácticamente. */
export function holdAt(p: SimPlayer, holdPos = p.holdPos): void {
  if (dist(p.pos, holdPos) > ARRIVE) {
    const before = { ...p.pos };
    p.pos = moveToward(p.pos, holdPos, MOVE_STEP);
    p.movedThisTick = dist(before, p.pos) > 0.5;
  } else {
    p.movedThisTick = false;
  }
}

/** Enemigo visible más cercano (o null). */
export function nearestVisibleEnemy(s: RoundState, p: SimPlayer): SimPlayer | null {
  let best: SimPlayer | null = null;
  let bd = Infinity;
  for (const e of s.players) {
    if (e.side === p.side || !e.alive) continue;
    if (!canSee(p, e)) continue;
    const d = dist(p.pos, e.pos);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

/** Fija un objetivo nuevo: arranca el reloj de reacción (gameSense). */
export function acquire(p: SimPlayer, enemy: SimPlayer): void {
  if (p.targetEnemyId !== enemy.id) {
    p.targetEnemyId = enemy.id;
    // Quien mantiene el ángulo reacciona casi al instante; quien va moviéndose, tarda más.
    // La cabeza modula la reacción: tilt/presión la frenan, confianza/instinto de trade la sueltan.
    const base = peekDelayTicks(p.attrs.gameSense) + (p.movedThisTick ? 2 : 0);
    p.reactBuffer = Math.max(0, base + reactDelta(p));
  }
  p.facing = angleTo(p.pos, enemy.pos);
}
