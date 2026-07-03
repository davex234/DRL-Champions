/**
 * BRAIN ENGINE — DECISIÓN (evaluación continua + duda + cambio de idea).
 *
 * Une todo: creencias → opciones → puntuación → elección. Aplica HISTÉRESIS (no cambia
 * de idea cada tick: cuesta un margen, mayor en jugadores disciplinados/serenos, menor
 * en nerviosos → dudan más) salvo INTERRUPCIONES fuertes (un compañero cae, te ciegan,
 * aparece un enemigo). De ahí salen los cambios de plan naturales. Determinista (rng).
 */
import type { Rng } from "../sim/rng";
import type { RoundState, SimPlayer } from "../sim/types";
import { deriveBeliefs } from "./beliefs";
import { generateOptions } from "./options";
import { buildContext, scoreOption } from "./evaluate";
import type { Decision, ScoredOption } from "./types";

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

function hardInterrupt(s: RoundState, p: SimPlayer): boolean {
  if (p.flashedUntil > s.tick) return true; // me han cegado
  // ¿Cayó un compañero hace poco? (obliga a reevaluar).
  for (let i = s.events.length - 1; i >= 0 && i > s.events.length - 12; i--) {
    const e = s.events[i];
    if (e.type !== "kill" || s.tick - e.tick > 25) continue;
    const victim = s.players.find((q) => q.id === (e.data as { victim?: string }).victim);
    if (victim && victim.side === p.side) return true;
  }
  return false;
}

export function decide(s: RoundState, p: SimPlayer, rng: Rng): Decision {
  const brain = p.brain!;
  const b = deriveBeliefs(s, p);
  const ctx = buildContext(s, p, b);
  const opts = generateOptions(s, p, b);

  // Puntúa + jitter humano (los nerviosos/poco confiados son más ruidosos → dudan).
  const noise = 0.03 + (1 - ctx.confidence) * 0.06 + Math.max(0, -ctx.composure) * 0.05;
  const scored: ScoredOption[] = opts.map((o) => {
    const so = scoreOption(s, p, o, ctx);
    so.score += (rng.next() - 0.5) * noise;
    return so;
  }).sort((a, c) => c.score - a.score);

  let chosen = scored[0];
  const interrupt = hardInterrupt(s, p);

  // Histéresis: mantener la decisión anterior salvo que otra la supere por un margen.
  if (!interrupt && brain.lastAction && chosen.kind !== brain.lastAction) {
    const keep = scored.find((o) => o.kind === brain.lastAction);
    const margin = clamp(0.05 + ctx.disc * 0.05 + ctx.composure * 0.04, 0.01, 0.22);
    if (keep && chosen.score < keep.score + margin) chosen = keep;
  }

  const changed = brain.lastAction !== null && chosen.kind !== brain.lastAction;
  brain.lastAction = chosen.kind;
  brain.lastScore = chosen.score;
  if (changed) brain.changedTick = s.tick;

  // Traza para el Brain Debug.
  const received = (s.comms ?? [])
    .filter((m) => m.side === p.side && m.from !== p.id && m.arriveTick === s.tick)
    .map((m) => m.type);
  const knows = b.enemyKnown.slice(0, 4).map((e) => `enemigo ${Math.round(e.age / 20)}s · ${Math.round(e.conf * 100)}%`);
  const topFactor = chosen.factors[0]?.label ?? "—";
  const topBelief = b.list[0]?.label ?? "—";
  const reason = `${chosen.kind} — ${topFactor}; ${topBelief}`;

  brain.trace = {
    tick: s.tick, chosen: chosen.kind, reason, changed,
    options: scored.slice(0, 6).map((o) => ({ kind: o.kind, score: Math.round(o.score * 100) / 100 })),
    beliefs: b.list.map((h) => ({ label: h.label, prob: Math.round(h.prob * 100) / 100 })),
    knows, received,
  };

  return { option: chosen, changed, reason };
}
