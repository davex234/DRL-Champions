/**
 * WALKOUT 0.9 · aplica una celebración al rig (three). Única puerta entre la pose pura (`celebrationPose`) y los huesos:
 * la usan la escena (`stage3d.ts`) y el laboratorio de QA, así que lo que se revisa en capturas es lo que ve el jugador.
 *
 * Orden por fotograma (siempre desde cero: `layers` reescribe TODOS los huesos ligados, así que nada se acumula):
 *   1. pies clavados (`locks`): se evalúa la pose al empezar y al acabar el tramo y la raíz compensa en planta;
 *   2. capas de clips de cuerpo entero (pose base);
 *   3. pie libre por el aire (IK de pierna), si un tramo lo mueve;
 *   4. clips ENMASCARADOS (el brazo / el tronco de una captura), giros de tronco y cabeza;
 *   5. forma de las manos (dedos de datos capturados);
 *   6. IK de precisión del brazo (conserva el plano del codo capturado), al final: mide la pose definitiva.
 * Sin IK por fotograma salvo la de precisión de POINT/SHUSH (dos huesos, analítica: microsegundos).
 */
import type { HumanRig } from "./human3d";
import { CELEBRATIONS, celebrationPose, type CelebrationId, type CelebrationPose } from "@/domain/walkout/celebration";

export interface AppliedCelebration {
  pose: CelebrationPose;
  /** Desplazamiento en planta de la raíz (pies clavados). */
  offset: { x: number; z: number };
  /** Elevación de la raíz (vuelo del salto o apoyo sin hundirse). */
  lift: number;
}

/** La celebración `id` a `t` s de su beat (`idleTime`: reloj del reposo base). */
export function applyCelebrationPose(r: HumanRig, id: CelebrationId, t: number, idleTime: number): AppliedCelebration {
  const at = (k: number) => { const cp = celebrationPose(id, k, idleTime - t + k); r.layers(cp.layers); return cp; };
  let ox = 0, oz = 0;
  let swing: { side: "l" | "r"; dy: number } | null = null;
  for (const lock of CELEBRATIONS[id].locks) {
    if (t <= lock.from) continue;
    at(lock.from); const a = r.foot(lock.side);
    const tEnd = Math.min(t, lock.to);
    at(tEnd); const b = r.foot(lock.side);
    ox += a.x - b.x; oz += a.z - b.z;
    if (t < lock.to) {
      const other = lock.side === "l" ? "r" : "l";
      at(lock.from); const o0 = r.foot(other);
      at(lock.to); const o1 = r.foot(other);
      if (Math.hypot(o1.x - o0.x, o1.z - o0.z) > 0.03) swing = { side: other, dy: Math.sin(Math.PI * Math.min(1, Math.max(0, (t - lock.from) / (lock.to - lock.from)))) ** 0.45 * 0.06 };
    }
  }
  const cp = celebrationPose(id, t, idleTime);
  r.layers(cp.layers);
  // contacto con el suelo: si la mezcla de clips hunde la punta del pie, la raíz sube lo justo. Se aplica SIEMPRE (también
  // al despegar): antes solo con lift = 0 y, al empezar la parábola en 0, la persona caía 7 cm de golpe en el despegue.
  const sink = Math.max(0, 0.012 - Math.min(r.foot("l").y, r.foot("r").y));
  const lift = Math.max(cp.lift, sink);
  if (swing) r.lift(swing.side, swing.dy);
  for (const m of cp.masked) r.masked(m.clip, m.time, m.mask, m.weight);
  for (const b of cp.bends) r.bend(b);
  // la mano antes que la IK: el punto de contacto (falange del índice) depende de los dedos
  for (const h of cp.hands) r.hand(h.side, h.shape, h.weight);
  if (cp.arm) r.reach(cp.arm.side, cp.arm.goal, cp.arm.weight);
  return { pose: cp, offset: { x: ox, z: oz }, lift };
}
