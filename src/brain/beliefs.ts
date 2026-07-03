/**
 * BRAIN ENGINE — HIPÓTESIS.
 *
 * A partir de la MEMORIA (imperfecta) el jugador deduce qué CREE que ocurre: por dónde
 * stackean, si han rotado, si esperan, si guardan. Son PROBABILIDADES, no hechos —
 * pueden estar equivocadas (de ahí los errores humanos). Solo lee memoria + estado público.
 */
import type { RoundState, SimPlayer } from "../sim/types";
import { memoryTau, recallEnemies } from "./memory";
import type { Hypothesis } from "./types";

export interface Beliefs {
  list: Hypothesis[];
  enemyKnown: { id: string; pos: { x: number; y: number }; conf: number; age: number }[];
  nearest: { id: string; pos: { x: number; y: number }; conf: number; dist: number } | null;
  stackLane: "main" | "tree" | "mid" | null;
  stackProb: number;
  rotated: number;
  waiting: number;
  saving: number;
  planted: boolean;
}

const d2 = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

export function deriveBeliefs(s: RoundState, p: SimPlayer): Beliefs {
  const mem = p.brain!.memory;
  const tau = memoryTau(p.identity);
  const enemyKnown = recallEnemies(mem, s.tick, tau);

  // Más cercano conocido (objetivo natural de atención).
  let nearest: Beliefs["nearest"] = null;
  for (const e of enemyKnown) {
    const dd = d2(p.pos, e.pos);
    if (!nearest || dd < nearest.dist) nearest = { id: e.id, pos: e.pos, conf: e.conf, dist: dd };
  }

  // Stack: dónde se ha visto más al rival (APRENDIZAJE dentro de la ronda).
  const ls = mem.laneSeen;
  const total = ls.main + ls.tree + ls.mid;
  let stackLane: Beliefs["stackLane"] = null, stackProb = 0;
  if (total >= 3) {
    const e = Object.entries(ls).sort((a, b) => b[1] - a[1])[0];
    stackLane = e[0] as Beliefs["stackLane"];
    stackProb = e[1] / total;
  }

  // Rotado: fracción de enemigos cuya última pista es vieja.
  const old = enemyKnown.filter((e) => e.age > 150).length;
  const rotated = enemyKnown.length ? old / enemyKnown.length : 0;

  // Esperan: pocos contactos frescos siendo nosotros ataque (la DEF aguanta).
  const fresh = enemyKnown.filter((e) => e.age < 80).length;
  const waiting = p.side === "ATK" ? Math.max(0, 1 - fresh / 2) : Math.max(0, 1 - fresh / 3);

  // Guardan/eco: dedución pobre desde la utilidad enemiga vista (si no han gastado, quizá eco).
  const sawEnemyUtil = mem.utilSeen.length > 0;
  const saving = !sawEnemyUtil && s.tick > 300 ? 0.4 : 0.12;

  const list: Hypothesis[] = [];
  if (stackProb >= 0.45 && stackLane) list.push({ id: "stack", label: `Creo que stackean ${stackLane}`, prob: stackProb });
  if (rotated >= 0.4) list.push({ id: "rotated", label: "Creo que han rotado", prob: rotated });
  if (waiting >= 0.5) list.push({ id: "waiting", label: "Creo que esperan", prob: waiting });
  if (saving >= 0.35) list.push({ id: "saving", label: "Creo que guardan", prob: saving });
  if (list.length === 0) list.push({ id: "unsure", label: "No tengo claro qué hacen", prob: 0.5 });

  return { list, enemyKnown, nearest, stackLane, stackProb, rotated, waiting, saving, planted: s.spike.planted };
}
