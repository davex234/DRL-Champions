/**
 * Cerebro individual (capa REACTIVA): cada jugador decide solo, cada tick, sobre
 * el objetivo que le dio el director. Prioridad: si ve un enemigo, pelea/holdea
 * el ángulo; si no, persigue su objetivo (mover/push/hold/rotar/fallback). El
 * plant/defuse y las condiciones de victoria las cierra el motor.
 *
 * La IDENTIDAD entra aquí: dónde se coloca el hold (agresivo adelanta, paciente
 * repliega, creativo abre off-angle) y si RE-ASOMA a un enemigo recién visto o
 * aguanta. De ahí emergen estilos reconocibles sin tocar atributos.
 */
import { angleTo } from "../geometry";
import { ZONES } from "../map/ascentA";
import { acquire, holdAt, moveTowardPoint, nearestVisibleEnemy, stepAlongRoute } from "./behaviors";
import { holdSpot, wantsRepeek } from "../identity/modifiers";
import type { RoundState, SimPlayer } from "../types";

const REPEEK_MEMORY_TICKS = 45; // sólo persigue una pista fresca (~2.2 s)

export function actPlayer(s: RoundState, p: SimPlayer): void {
  if (!p.alive) return;
  // Brain Engine: si el jugador tiene cerebro activo, ya decidió y actuó en tickBrains.
  if (s.brainEnabled !== false && p.brain) return;
  p.movedThisTick = false;

  // 1. Capa reactiva: enemigo a la vista → fijar y combatir (sin moverse: mantiene ángulo).
  const enemy = nearestVisibleEnemy(s, p);
  if (enemy) {
    acquire(p, enemy);
    p.intent = "fight";
    return;
  }
  p.targetEnemyId = null;

  // 2. Perseguir el objetivo estratégico del director.
  switch (p.intent) {
    case "hold":
    case "fight": {
      // ¿Re-asoma a una última posición conocida? (decisión de personalidad).
      const lead = recentEnemyHint(s, p);
      if (lead && wantsRepeek(p)) {
        moveTowardPoint(p, lead);
        break;
      }
      // Hold AJUSTADO por identidad (adelanta/repliega/off-angle).
      holdAt(p, holdSpot(s, p));
      faceThreat(p);
      break;
    }
    case "plant":
    case "defuse":
      // Llega al punto; el progreso lo gestiona el motor.
      stepAlongRoute(p, p.targetZone);
      break;
    default: // move | push | rotate | fallback
      stepAlongRoute(p, p.targetZone);
      faceThreat(p);
      break;
  }
}

/** Última posición conocida (fresca) de un enemigo, para decidir un re-peek. */
function recentEnemyHint(s: RoundState, p: SimPlayer): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  let bestTick = -1;
  for (const [id, seen] of Object.entries(p.lastSeen)) {
    const isEnemy = s.players.some((q) => q.id === id && q.side !== p.side);
    if (!isEnemy) continue;
    if (s.tick - seen.tick > REPEEK_MEMORY_TICKS) continue;
    if (seen.tick > bestTick) { bestTick = seen.tick; best = seen.pos; }
  }
  return best;
}

/** Orientación por defecto hacia la amenaza probable (para el observer). */
function faceThreat(p: SimPlayer): void {
  if (p.targetEnemyId) return;
  const threat = p.side === "ATK" ? ZONES.site : ZONES.a_main_choke;
  p.facing = angleTo(p.pos, threat);
}
