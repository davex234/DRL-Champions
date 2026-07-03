/**
 * BRAIN ENGINE — MEMORIA (imperfecta y con degradación natural).
 *
 * La confianza de cada recuerdo cae con el tiempo (≈90% a 3s, 60% a 8s, 20% a 20s, 0
 * a 40s), modulada por la lectura de juego del jugador (mejor gameSense/tacticalIQ =
 * recuerda mejor). De aquí emergen los ERRORES HUMANOS: actuar sobre info caduca.
 */
import type { Identity } from "../sim/identity/traits";
import type { BrainMemory, EnemyMemo } from "./types";

export function createMemory(): BrainMemory {
  return {
    enemies: {}, utilSeen: [], lastSound: null, spike: null,
    danger: {}, clear: {}, laneSeen: { main: 0, tree: 0, mid: 0 }, fakeSeen: 0,
  };
}

/** Constante de tiempo (ticks) de la memoria según el ADN (mejor lectura → recuerda más). */
export function memoryTau(id: Identity): number {
  return 230 + (id.tacticalIQ - 50) * 1.2; // mejor IQ táctico ⇒ memoria más duradera
}

/** Confianza actual de un recuerdo (exponencial, modulada por la base y la fuente). */
export function confidence(baseConf: number, ageTicks: number, tau: number): number {
  if (ageTicks <= 0) return baseConf;
  return baseConf * Math.exp(-ageTicks / Math.max(60, tau));
}

/** Recuerda un enemigo si la nueva pista es mejor (más fresca o más fiable). */
export function rememberEnemy(mem: BrainMemory, id: string, memo: EnemyMemo): void {
  const prev = mem.enemies[id];
  if (!prev || memo.tick >= prev.tick) mem.enemies[id] = memo;
}

/** Enemigos recordados con confianza > umbral (lista de trabajo del cerebro). */
export function recallEnemies(
  mem: BrainMemory, tick: number, tau: number, min = 0.06,
): { id: string; pos: { x: number; y: number }; conf: number; age: number }[] {
  const out: { id: string; pos: { x: number; y: number }; conf: number; age: number }[] = [];
  for (const [id, m] of Object.entries(mem.enemies)) {
    const age = tick - m.tick;
    const conf = confidence(m.baseConf, age, tau);
    if (conf >= min) out.push({ id, pos: m.pos, conf, age });
  }
  return out.sort((a, b) => b.conf - a.conf);
}

/** Poda recuerdos ya olvidados (mantiene la memoria pequeña y barata de clonar). */
export function pruneMemory(mem: BrainMemory, tick: number, tau: number): void {
  for (const id of Object.keys(mem.enemies)) {
    if (confidence(mem.enemies[id].baseConf, tick - mem.enemies[id].tick, tau) < 0.05) delete mem.enemies[id];
  }
  mem.utilSeen = mem.utilSeen.filter((u) => tick - u.tick < 240).slice(-6);
  for (const rec of [mem.danger, mem.clear]) {
    for (const z of Object.keys(rec) as (keyof typeof rec)[]) {
      const m = rec[z]; if (m && tick - m.tick > 200) delete rec[z];
    }
  }
  if (mem.lastSound && tick - mem.lastSound.tick > 80) mem.lastSound = null;
  if (mem.spike && tick - mem.spike.tick > 400) mem.spike = null;
}
