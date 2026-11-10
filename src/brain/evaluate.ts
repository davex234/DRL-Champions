/**
 * BRAIN ENGINE — EVALUADOR.
 *
 * Puntúa cada opción CONSUMIENDO los motores existentes (Identity, Agent, Mental,
 * Spatial/Utility map, Composition, plan del Coach). No duplica lógica: solo lee. La
 * PERSONALIDAD (Identity) pondera los términos → dos jugadores con la misma info
 * deciden distinto. Devuelve la puntuación + el desglose (para el Brain Debug).
 */
import { nearestZone } from "../sim/map/ascentA";
import { canSee } from "../sim/perception";
import { dist } from "../sim/geometry";
import type { RoundState, SimPlayer } from "../sim/types";
import type { Beliefs } from "./beliefs";
import type { Option, OptionKind, ScoredOption } from "./types";

const u = (t: number) => (t - 50) / 50; // rasgo → -1..1

export interface EvalContext {
  aggr: number; entry: number; patience: number; disc: number; risk: number; crea: number;
  ego: number; trade: number; comm: number; lead: number; lurk: number; composure: number;
  clutch: number; adapt: number; tacIQ: number;
  pressure: number; confidence: number; tilt: number; fatigue: number; momentum: number;
  caps: Record<string, number>;
  myRisk: number; objControl: number;
  visible: boolean; outnumbered: boolean; alone: boolean; mate: boolean;
  losing: boolean; planMatch: (k: OptionKind) => number;
}

export function buildContext(s: RoundState, p: SimPlayer, b: Beliefs): EvalContext {
  const id = p.identity, m = p.mental;
  const caps = (p.agent?.agent.capabilities ?? {}) as Record<string, number>;
  const myZ = s.map?.zones[nearestZone(p.pos)];
  const objZ = s.map?.zones[s.spike.planted ? "plant" : "site"];
  const sideSign = p.side === "ATK" ? 1 : -1;

  const alliesNear = s.players.filter((q) => q.side === p.side && q.alive && q.id !== p.id && dist(q.pos, p.pos) < 300).length;
  const enemiesNear = b.enemyKnown.filter((e) => e.age < 90 && dist(e.pos, p.pos) < 300).length;
  const alliesAlive = s.players.filter((q) => q.side === p.side && q.alive).length;
  const enemiesAlive = s.players.filter((q) => q.side !== p.side && q.alive).length;
  const visible = s.players.some((e) => e.side !== p.side && e.alive && canSee(p, e));
  const mate = s.players.some((a) => a.side === p.side && a.alive && a.id !== p.id && a.targetEnemyId != null && dist(a.pos, p.pos) < 320);

  // El plan del Coach/Director es un INPUT (p.intent): seguirlo da bonus de obediencia.
  const planKindMap: Partial<Record<string, OptionKind>> = {
    hold: "hold", fight: "fight", push: "push", rotate: "rotate", fallback: "fall_back", move: "push", trade: "seek_trade",
  };
  const planned = planKindMap[p.intent];
  const obedience = 0.18 + u(id.discipline) * 0.3 - u(id.ego) * 0.15 - u(id.creativity) * 0.1;
  const planMatch = (k: OptionKind) => (planned === k ? Math.max(0, obedience) : 0);

  return {
    aggr: u(id.aggression), entry: u(id.entryDrive), patience: u(id.patience), disc: u(id.discipline),
    risk: u(id.riskAppetite), crea: u(id.creativity), ego: u(id.ego), trade: u(id.tradeInstinct),
    comm: u(id.communication), lead: u(id.leadershipDrive), lurk: u(id.lurkTendency), composure: u(id.composure),
    clutch: u(id.clutchFactor), adapt: u(id.adaptability), tacIQ: u(id.tacticalIQ),
    pressure: m.pressure / 100, confidence: m.confidence / 100, tilt: m.tilt / 100, fatigue: m.fatigue / 100, momentum: m.momentum / 100,
    caps,
    myRisk: myZ?.risk[p.side] ?? 0,
    objControl: (objZ?.control ?? 0) * sideSign,
    visible, outnumbered: enemiesNear > alliesNear, alone: enemiesNear >= 1 && alliesNear === 0,
    mate, losing: enemiesAlive > alliesAlive,
    planMatch,
  };
}

const cap = (c: EvalContext, k: string) => (c.caps[k] ?? 30) / 100;

export function scoreOption(s: RoundState, p: SimPlayer, opt: Option, c: EvalContext): ScoredOption {
  const factors: { label: string; value: number }[] = [];
  let score = 0;
  const add = (label: string, value: number) => { if (Math.abs(value) > 0.001) { score += value; factors.push({ label, value: Math.round(value * 100) / 100 }); } };
  const planB = c.planMatch(opt.kind);

  switch (opt.kind) {
    case "fight":
      add("base", 0.5);
      add("agresividad", c.aggr * 0.5); add("riesgo", c.risk * 0.4); add("trade", c.trade * 0.2 + cap(c, "trading") * 0.2);
      add("confianza", c.confidence * 0.3); add("momentum", c.momentum * 0.2);
      add("presión", -c.pressure * 0.45); add("tilt", -c.tilt * 0.2); add("fatiga", -c.fatigue * 0.15);
      if (c.visible) add("enemigo a la vista", 0.4);
      if (c.alone && c.outnumbered) add("solo y en inferioridad", -(0.5 - c.risk * 0.3));
      break;
    case "hold":
      add("base", 0.45); add("paciencia", c.patience * 0.5); add("disciplina", c.disc * 0.4); add("anclaje", cap(c, "anchor") * 0.4);
      add("agresividad", -c.aggr * 0.4); add("entrada", -c.entry * 0.3);
      if (p.side === "DEF" && !s.spike.planted) add("defensa pre-plant", 0.2);
      if (s.spike.planted && p.side === "DEF") add("hay que retomar", -0.3);
      break;
    case "wait":
      add("base", 0.3); add("paciencia", c.patience * 0.4); add("creo que esperan", -c.aggr * 0.4);
      add("sin info", c.visible ? -0.2 : 0.1);
      break;
    case "fall_back":
      add("base", 0.22); add("presión", c.pressure * 0.6); add("nervios", -c.composure * 0.4);
      if (c.alone && c.outnumbered) add("retirada táctica", 0.5);
      if (c.myRisk > 0.6) add("zona peligrosa", 0.3); add("agresividad", -c.aggr * 0.4);
      break;
    case "save":
      add("base", 0.08); if (c.losing) add("ronda perdida", 0.4);
      add("supervivencia", c.composure * 0.2 + cap(c, "survival") * 0.3); add("agresividad", -c.aggr * 0.3);
      break;
    case "push":
      add("base", 0.38); add("agresividad", c.aggr * 0.5); add("entrada", c.entry * 0.6 + cap(c, "entry") * 0.3);
      add("ego·confianza", c.ego * c.confidence * 0.3); add("control del objetivo", c.objControl * 0.4); add("momentum", c.momentum * 0.2);
      add("paciencia", -c.patience * 0.4); add("presión", -c.pressure * 0.5); add("riesgo de zona", -c.myRisk * 0.4);
      if (p.side === "ATK" && s.phase === "EXECUTE") add("fase de execute", 0.3);
      // DEF + plantado: "push" ES el retake (urgencia por clutch/agresividad/capacidad).
      if (p.side === "DEF" && s.spike.planted) add("retomar el plante", 0.5 + c.clutch * 0.2 + cap(c, "retake") * 0.4 + c.aggr * 0.15);
      break;
    case "rotate":
      add("base", 0.28); add("IQ táctico", c.tacIQ * 0.4); add("adaptabilidad", c.adapt * 0.4);
      add("creo que han rotado", c.adapt * 0.0); add("rotación", (s.spike.planted ? 0.1 : 0));
      break;
    case "flank":
      add("base", 0.2); add("creatividad", c.crea * 0.5); add("instinto de lurk", c.lurk * 0.6 + cap(c, "lurk") * 0.3);
      add("disciplina", -c.disc * 0.2);
      break;
    case "seek_trade":
      add("base", 0.2); add("instinto de trade", c.trade * 0.6 + cap(c, "trading") * 0.3); add("comunicación", c.comm * 0.3);
      if (c.mate) add("compañero en combate", 0.3);
      break;
    case "cover_ally":
      add("base", 0.18); add("comunicación", c.comm * 0.4); add("liderazgo", c.lead * 0.5);
      if (c.mate) add("apoyar al compañero", 0.4); add("ego", -c.ego * 0.3);
      break;
    case "play_postplant":
      add("base", s.spike.planted && p.side === "ATK" ? 0.6 : 0); add("disciplina", c.disc * 0.3); add("post-plant", cap(c, "postplant") * 0.3);
      add("control del plante", c.objControl * 0.3);
      break;
  }
  if (planB > 0) add("sigue el plan del coach", planB);
  return { ...opt, score: Math.round(score * 1000) / 1000, factors: factors.sort((a, b2) => Math.abs(b2.value) - Math.abs(a.value)).slice(0, 6) };
}
