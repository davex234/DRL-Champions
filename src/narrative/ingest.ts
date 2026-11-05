/**
 * MATCH NARRATIVE ENGINE — Ingesta por ronda.
 *
 * Lee un RoundState YA terminado (solo lectura) y extrae los eventos narrativos
 * crudos + la ficha de la ronda. Reconstruye conceptos que el sim no marca como
 * tales (clutch 1vN, multikills, trades, retake) a partir del log de bajas.
 */
import { TPS } from "../sim";
import type { RoundState, SimPlayer, SimEvent, Side } from "../sim";
import type { NarrativeEvent, NarrativeEventType, TeamId, EventParticipant } from "./types";
import { baseImportance, scoreImportance, type ImportanceContext } from "./importance";
import type { PlayerRoundLine, RoundRecord } from "./memory";

const TRADE_WINDOW = 40; // ticks (~2 s)

export interface IngestContext {
  round: number;
  target: number;            // rondas para ganar (13)
  totalRoundsGuess: number;
  scoreBefore: Record<TeamId, number>;
  pistol: boolean;
  teamOf: (name: string) => TeamId;
}

const tempoBase = (t: string): number => (t === "fast" ? 45 : t === "slow" ? 130 : 85);
const otherSide = (s: Side): Side => (s === "ATK" ? "DEF" : "ATK");

export function extractRound(s: RoundState, ctx: IngestContext): RoundRecord {
  const teamOf = ctx.teamOf;
  const sideTeam: Record<Side, TeamId> = {
    ATK: teamOf(s.players.find((p) => p.side === "ATK")!.name),
    DEF: teamOf(s.players.find((p) => p.side === "DEF")!.name),
  };
  const winnerSide = s.winner!;
  const winner = sideTeam[winnerSide];
  const loser = winner === "A" ? "B" : "A";

  // — Fichas por jugador —
  const lines: Record<string, PlayerRoundLine> = {};
  const byId: Record<string, SimPlayer> = {};
  for (const p of s.players) {
    byId[p.id] = p;
    lines[p.name] = {
      name: p.name, team: teamOf(p.name), side: p.side, role: p.role,
      kills: 0, deaths: 0, firstBlood: false, firstDeath: false, multikill: 0, ace: false,
      clutch: 0, clutchWon: false, survived: p.alive, tradeKills: 0, tradedDeath: false,
      confidenceEnd: p.mental.confidence, tilt: p.mental.tilt, momentum: p.mental.momentum,
      pressure: p.mental.pressure, presence: 0,
    };
  }

  const kills = s.events.filter((e) => e.type === "kill");
  const events: NarrativeEvent[] = [];
  let seq = 0;
  const idFor = () => `r${ctx.round}#${seq++}`;
  const scoreAfter: Record<TeamId, number> = { ...ctx.scoreBefore };
  scoreAfter[winner] += 1;

  const closeness = 1 - Math.abs(scoreAfter.A - scoreAfter.B) / Math.max(1, ctx.target);
  const matchPoint = scoreAfter[winner] >= ctx.target;
  const baseCtx = (over: Partial<ImportanceContext> = {}): ImportanceContext => ({
    round: ctx.round, totalRoundsGuess: ctx.totalRoundsGuess, closeness,
    matchPoint, swung: false, ...over,
  });
  const push = (
    type: NarrativeEventType, tick: number, favors: TeamId | null,
    participants: EventParticipant[], data: Record<string, unknown>,
    over: Partial<ImportanceContext> = {}, tags: string[] = [],
  ) => {
    const imp = scoreImportance(baseImportance(type, data), baseCtx(over));
    events.push({
      id: idFor(), round: ctx.round, tick, timeSec: tick / TPS, type,
      importance: imp, impact: imp, favors, participants, data, tags,
    });
  };

  // — Recorrido de bajas: estadísticas, first blood, trades, y conjuntos de vivos —
  const aliveSet: Record<Side, Set<string>> = {
    ATK: new Set(s.players.filter((p) => p.side === "ATK").map((p) => p.id)),
    DEF: new Set(s.players.filter((p) => p.side === "DEF").map((p) => p.id)),
  };
  const soloAt: Partial<Record<Side, { id: string; enemies: number }>> = {};

  for (let i = 0; i < kills.length; i++) {
    const e = kills[i];
    const killer = byId[String(e.data.by)];
    const victim = byId[String(e.data.victim)];
    if (!killer || !victim) continue;
    lines[killer.name].kills++;
    lines[victim.name].deaths++;
    // Trade: la víctima había matado a un compañero del asesino hace poco.
    const avenged = kills.some((k) => k.tick >= e.tick - TRADE_WINDOW && k.tick < e.tick
      && k.data.by === victim.id && byId[String(k.data.victim)]?.side === killer.side);
    if (avenged) {
      lines[killer.name].tradeKills++;
      const fallen = kills.find((k) => k.tick >= e.tick - TRADE_WINDOW && k.tick < e.tick
        && k.data.by === victim.id && byId[String(k.data.victim)]?.side === killer.side);
      if (fallen) { const fn = byId[String(fallen.data.victim)]; if (fn) lines[fn.name].tradedDeath = true; }
      push("trade", e.tick, teamOf(killer.name),
        [pt(killer, "subject", teamOf), pt(victim, "victim", teamOf)],
        { byName: killer.name }, {}, ["refrag"]);
    } else {
      // baja normal (timeline completa).
      push("kill", e.tick, teamOf(killer.name),
        [pt(killer, "subject", teamOf), pt(victim, "victim", teamOf)],
        { held: !!e.data.held });
    }
    // Conjuntos de vivos → detección de clutch.
    aliveSet[victim.side].delete(victim.id);
    for (const side of ["ATK", "DEF"] as const) {
      if (aliveSet[side].size === 1 && aliveSet[otherSide(side)].size >= 1 && !soloAt[side]) {
        soloAt[side] = { id: [...aliveSet[side]][0], enemies: aliveSet[otherSide(side)].size };
      }
    }
  }

  // — First blood —
  const fb = s.events.find((e) => e.type === "firstblood");
  if (fb) {
    const killer = byId[String(fb.data.by)];
    const victim = byId[String(fb.data.victim)];
    if (killer && victim) {
      lines[killer.name].firstBlood = true;
      lines[victim.name].firstDeath = true;
      push("first_blood", fb.tick, teamOf(killer.name),
        [pt(killer, "subject", teamOf), pt(victim, "victim", teamOf)],
        { byName: killer.name, victimName: victim.name }, {}, ["opener"]);
    }
  }

  // — Multikills / aces —
  for (const name of Object.keys(lines)) {
    const k = lines[name].kills;
    if (k >= 2) lines[name].multikill = k;
    if (k >= 5) lines[name].ace = true;
    if (k >= 3) {
      const pl = s.players.find((p) => p.name === name)!;
      const tk = k >= 5 ? "ace" : "multikill";
      push(tk as NarrativeEventType, lastKillTick(kills, pl.id), teamOf(name),
        [pt(pl, "subject", teamOf)], { kills: k, byName: name },
        { swung: k >= 4 }, k >= 5 ? ["highlight", "ace"] : ["highlight"]);
    }
  }

  // — Clutch: alguien se quedó solo y su bando GANÓ —
  for (const side of ["ATK", "DEF"] as const) {
    const solo = soloAt[side];
    if (!solo) continue;
    const pl = byId[solo.id];
    if (!pl) continue;
    if (sideTeam[side] === winner) {
      lines[pl.name].clutch = solo.enemies;
      lines[pl.name].clutchWon = true;
      push("clutch", lastKillTick(kills, pl.id), teamOf(pl.name),
        [pt(pl, "subject", teamOf)], { clutchSize: solo.enemies, byName: pl.name },
        { swung: true }, ["highlight", "clutch", `1v${solo.enemies}`]);
    }
  }

  // — Plant / defuse / retake / postplant —
  const plant = s.events.find((e) => e.type === "plant");
  if (plant) {
    const planter = byId[String(plant.data.by)];
    push("plant", plant.tick, planter ? teamOf(planter.name) : null,
      planter ? [pt(planter, "subject", teamOf)] : [], { byName: plant.data.byName });
  }
  if (s.endReason === "defuse") {
    push("retake", s.tick, winner, defusers(s, teamOf), { reason: "defuse" }, { swung: true }, ["retake"]);
  } else if (s.endReason === "detonation" && plant) {
    push("post_plant_hold", s.tick, winner, [], { reason: "detonation" });
  }

  // — Timing del execute (solo informativo) —
  if (s.executeTick != null) {
    const base = tempoBase(s.plans.ATK.tempo);
    if (s.executeTick <= base * 0.8) push("execute_fast", s.executeTick, sideTeam.ATK, [], { tick: s.executeTick });
    else if (s.executeTick >= base * 1.3) push("execute_slow", s.executeTick, sideTeam.ATK, [], { tick: s.executeTick });
  }

  // — Timeout / intervención del coach —
  const call = s.events.find((e) => e.type === "coachCall");
  let hadTimeout: TeamId | null = null;
  if (call) {
    hadTimeout = sideTeam[s.coachSide];
    push("timeout", call.tick, hadTimeout, [], { id: call.data.id, effective: call.data.effective }, {}, ["intervention"]);
  }

  // — Cierre de ronda —
  const winnerKills = Object.values(lines).filter((l) => l.team === winner).reduce((a, l) => a + l.kills, 0);
  const loserKills = Object.values(lines).filter((l) => l.team === loser).reduce((a, l) => a + l.kills, 0);
  const swungRound = winnerKills < loserKills; // ganó perdiendo los duelos = remontada de ronda
  push("round_win", s.tick, winner, [], { reason: s.endReason, winnerKills, loserKills },
    { swung: swungRound, matchPoint }, swungRound ? ["clutch_round"] : []);

  // — Presencia por jugador —
  for (const l of Object.values(lines)) {
    l.presence = l.kills * 2 + (l.clutchWon ? l.clutch * 1.5 : 0) + (l.firstBlood ? 1 : 0)
      - (l.firstDeath ? 1.5 : 0) + (l.survived ? 0.5 : 0) + l.tradeKills * 0.5;
  }

  const teamConfidence = avgByTeam(s, teamOf, (p) => p.mental.confidence);
  const teamMomentum = avgByTeam(s, teamOf, (p) => p.mental.momentum);

  return {
    round: ctx.round, winner, loser, winnerSide, endReason: s.endReason ?? "unknown",
    scoreAfter, killDiffWinner: winnerKills - loserKills, pistol: ctx.pistol,
    plans: { A: planFor(s, sideTeam, "A"), B: planFor(s, sideTeam, "B") },
    hadTimeout, lines, events, teamConfidence, teamMomentum,
  };
}

// ---- helpers ----
function pt(p: SimPlayer, as: EventParticipant["as"], teamOf: (n: string) => TeamId): EventParticipant {
  return { name: p.name, team: teamOf(p.name), role: p.role, as };
}
function lastKillTick(kills: SimEvent[], byId: string): number {
  let t = 0;
  for (const k of kills) if (k.data.by === byId) t = k.tick;
  return t;
}
function defusers(s: RoundState, teamOf: (n: string) => TeamId): EventParticipant[] {
  const d = s.players.find((p) => p.side === "DEF" && p.alive);
  return d ? [{ name: d.name, team: teamOf(d.name), role: d.role, as: "subject" }] : [];
}
function avgByTeam(s: RoundState, teamOf: (n: string) => TeamId, f: (p: SimPlayer) => number): Record<TeamId, number> {
  const acc: Record<TeamId, { sum: number; n: number }> = { A: { sum: 0, n: 0 }, B: { sum: 0, n: 0 } };
  for (const p of s.players) { const t = teamOf(p.name); acc[t].sum += f(p); acc[t].n++; }
  return { A: acc.A.n ? acc.A.sum / acc.A.n : 0, B: acc.B.n ? acc.B.sum / acc.B.n : 0 };
}
function planFor(s: RoundState, sideTeam: Record<Side, TeamId>, team: TeamId): { approach: string; tempo: string } {
  const side: Side = sideTeam.ATK === team ? "ATK" : "DEF";
  const p = s.plans[side];
  return { approach: p.approach, tempo: p.tempo };
}
