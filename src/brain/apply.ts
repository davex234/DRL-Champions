/**
 * BRAIN ENGINE — APLICAR la decisión.
 *
 * Traduce la opción elegida a intención + movimiento REUTILIZANDO los helpers de
 * ejecución existentes (behaviors) y la identidad (holdSpot/wantsRepeek). No reimplementa
 * movimiento ni combate: solo conecta la decisión del cerebro con el motor de ronda.
 */
import { angleTo, dist } from "../sim/geometry";
import { ZONES } from "../sim/map/ascentA";
import { acquire, holdAt, moveTowardPoint, stepAlongRoute } from "../sim/ai/behaviors";
import { holdSpot, wantsRepeek } from "../sim/identity/modifiers";
import { canSee } from "../sim/perception";
import type { RoundState, SimPlayer } from "../sim/types";
import type { Decision } from "./types";

function faceThreat(s: RoundState, p: SimPlayer): void {
  const known = p.brain ? Object.values(p.brain.memory.enemies).sort((a, b) => b.tick - a.tick)[0] : undefined;
  const t = known ? known.pos : p.side === "ATK" ? ZONES.site : ZONES.a_main_choke;
  p.facing = angleTo(p.pos, t);
}

export function applyDecision(s: RoundState, p: SimPlayer, d: Decision): void {
  const o = d.option;
  switch (o.kind) {
    case "fight": {
      const enemy = s.players.find((q) => q.id === o.enemyId);
      if (enemy && enemy.alive && canSee(p, enemy)) {
        acquire(p, enemy); p.intent = "fight"; // mantiene el ángulo
      } else if (enemy && enemy.alive && o.point && wantsRepeek(p)) {
        moveTowardPoint(p, o.point); p.intent = "push"; p.targetEnemyId = null; // re-asoma a la última posición
      } else {
        p.targetEnemyId = null; p.intent = "hold"; holdAt(p, holdSpot(s, p)); faceThreat(s, p);
      }
      break;
    }
    case "play_postplant": {
      // El Director asigna el ángulo de post-plant (crossfire); el cerebro lo OCUPA y lo afina con
      // su off-angle (holdSpot). En el path clásico targetZone = "plant" (comportamiento intacto).
      p.targetEnemyId = null; p.intent = "hold";
      const z = p.targetZone;
      if (dist(p.pos, ZONES[z]) > 18) stepAlongRoute(p, z); else { holdAt(p, holdSpot(s, p)); faceThreat(s, p); }
      break;
    }
    case "hold":
    case "wait": {
      p.targetEnemyId = null; p.intent = "hold";
      holdAt(p, o.kind === "wait" ? p.pos : holdSpot(s, p)); faceThreat(s, p);
      break;
    }
    case "fall_back":
    case "save": {
      p.targetEnemyId = null; p.intent = "fallback"; if (o.zone) { p.targetZone = o.zone; stepAlongRoute(p, o.zone); }
      break;
    }
    case "push":
    case "rotate":
    case "flank":
    case "cover_ally": {
      p.targetEnemyId = null;
      p.intent = o.kind === "push" ? "push" : o.kind === "rotate" ? "rotate" : "move";
      if (o.zone) { p.targetZone = o.zone; stepAlongRoute(p, o.zone); }
      faceThreat(s, p);
      break;
    }
    case "seek_trade": {
      p.intent = "trade";
      const enemy = s.players.find((q) => q.id === o.enemyId);
      if (enemy && enemy.alive && canSee(p, enemy)) acquire(p, enemy);
      else if (o.point) { moveTowardPoint(p, o.point); p.targetEnemyId = null; }
      break;
    }
  }
}
