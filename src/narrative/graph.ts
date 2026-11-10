/**
 * MATCH NARRATIVE ENGINE — Nodos derivados + Story Graph.
 *
 * Primero DERIVA nodos que el sim no marca (cambios de momentum/confianza/economía/
 * táctica, rachas, remontada/colapso, dominio, desapariciones, rivalidad, inflexión,
 * fin). Después construye un GRAFO causal: enlaza los eventos por reglas sobre
 * (ronda, tipo, a quién benefician). Un enlace SOLO existe si ambos extremos
 * existieron de verdad → la cadena causal EMERGE, no se inventa.
 */
import type {
  NarrativeEvent, NarrativeEventType, StoryEdge, StoryGraph, TeamId, EdgeRelation,
} from "./types";
import type { RoundRecord } from "./memory";
import { initEconomy, stepEconomy } from "./memory";
import { BASE_IMPORTANCE } from "./importance";
import type { PlayerArc } from "./types";

const opp = (t: TeamId): TeamId => (t === "A" ? "B" : "A");

function dnode(
  type: NarrativeEventType, round: number, favors: TeamId | null,
  importance: number, data: Record<string, unknown>,
  participants: NarrativeEvent["participants"] = [], tags: string[] = [],
): NarrativeEvent {
  return {
    id: `d:${type}:${favors ?? "-"}:${round}`, round, tick: 0, timeSec: 0, type,
    importance: Math.round(Math.max(0, Math.min(100, importance))),
    impact: Math.round(Math.max(0, Math.min(100, importance))),
    favors, participants, data, tags,
  };
}

export function deriveNodes(
  records: RoundRecord[],
  momentum: { shifts: { round: number; from: TeamId | null; to: TeamId; magnitude: number; cause: string | null }[] },
  inflection: { round: number; magnitude: number } | null,
  arcs: PlayerArc[],
  score: Record<TeamId, number>,
  winner: TeamId | null,
): NarrativeEvent[] {
  const nodes: NarrativeEvent[] = [];
  const total = records.length;
  const late = (r: number) => 0.85 + 0.4 * (r / Math.max(1, total));

  // momentum_shift
  for (const sh of momentum.shifts) {
    nodes.push(dnode("momentum_shift", sh.round, sh.to,
      BASE_IMPORTANCE.momentum_shift * late(sh.round) * (0.7 + sh.magnitude / 120),
      { magnitude: sh.magnitude, from: sh.from, cause: sh.cause }));
  }

  // confidence_shift (salto de confianza media de equipo entre rondas)
  for (let i = 1; i < records.length; i++) {
    for (const t of ["A", "B"] as const) {
      const d = records[i].teamConfidence[t] - records[i - 1].teamConfidence[t];
      if (d >= 8) {
        nodes.push(dnode("confidence_shift", records[i].round, t,
          BASE_IMPORTANCE.confidence_shift + d, { delta: Math.round(d) }));
      }
    }
  }

  // economía estimada → eco_win + economy_shift
  const eco = initEconomy();
  for (const r of records) {
    const { ecoWin, changed } = stepEconomy(eco, r.winner);
    if (ecoWin) {
      nodes.push(dnode("eco_win", r.round, r.winner, BASE_IMPORTANCE.eco_win * late(r.round),
        { bucketBefore: "eco/force" }, [], ["upset"]));
    }
    for (const t of changed) {
      nodes.push(dnode("economy_shift", r.round, t, BASE_IMPORTANCE.economy_shift,
        { bucket: eco.bucket[t] }));
    }
  }

  // tactical_shift (cambio de approach/tempo respecto a la ronda anterior)
  for (let i = 1; i < records.length; i++) {
    for (const t of ["A", "B"] as const) {
      const prev = records[i - 1].plans[t];
      const cur = records[i].plans[t];
      if (prev.approach !== cur.approach || prev.tempo !== cur.tempo) {
        nodes.push(dnode("tactical_shift", records[i].round, t,
          BASE_IMPORTANCE.tactical_shift + (records[i].hadTimeout === t ? 10 : 0),
          { from: prev, to: cur, afterTimeout: records[i].hadTimeout === t }));
      }
    }
  }

  // streaks (≥3 rondas seguidas)
  let cur: TeamId | null = null, len = 0;
  for (const r of records) {
    if (r.winner === cur) len++; else { cur = r.winner; len = 1; }
    if (len === 3 || (len > 3 && len % 2 === 0)) {
      nodes.push(dnode("streak", r.round, cur!, BASE_IMPORTANCE.streak + (len - 3) * 5, { length: len }));
    }
  }

  // inflexión + remontada/colapso
  if (inflection && winner) {
    nodes.push(dnode("inflection", inflection.round, winner,
      BASE_IMPORTANCE.inflection, { magnitude: inflection.magnitude }, [], ["turning_point"]));
    const loser = opp(winner);
    const before = records.filter((r) => r.round < inflection.round);
    const winnerWasBehind = before.length && before[before.length - 1].scoreAfter[winner] < before[before.length - 1].scoreAfter[loser];
    if (winnerWasBehind) {
      nodes.push(dnode("comeback_started", inflection.round, winner, BASE_IMPORTANCE.comeback_started, { from: inflection.round }, [], ["comeback"]));
      nodes.push(dnode("collapse_started", inflection.round, loser, BASE_IMPORTANCE.collapse_started, { from: inflection.round }, [], ["collapse"]));
    }
  }

  // dominio (control sostenido ≥4 de un tramo de 5 rondas)
  for (let i = 4; i < records.length; i++) {
    const window = records.slice(i - 4, i + 1);
    for (const t of ["A", "B"] as const) {
      const wins = window.filter((r) => r.winner === t).length;
      if (wins >= 4) {
        nodes.push(dnode("dominance", records[i].round, t, BASE_IMPORTANCE.dominance, { window: 5, wins }));
        break;
      }
    }
  }

  // desapariciones
  for (const a of arcs) {
    if (a.states.includes("disappeared")) {
      const round = Math.max(1, Math.round(total * 0.7));
      nodes.push(dnode("disappearance", round, opp(a.team), BASE_IMPORTANCE.disappearance,
        { name: a.name }, [{ name: a.name, team: a.team, role: a.role, as: "subject" }], ["disappeared"]));
    }
  }

  // rivalidad dominante del partido
  const riv = topRivalry(arcs);
  if (riv) {
    nodes.push(dnode("rivalry", total, null, BASE_IMPORTANCE.rivalry,
      { a: riv.a, b: riv.b, record: riv.record },
      [{ name: riv.a, team: riv.teamA, as: "subject" }, { name: riv.b, team: opp(riv.teamA), as: "opponent" }]));
  }

  // fin del partido
  if (winner) {
    nodes.push(dnode("match_end", total, winner, BASE_IMPORTANCE.match_end,
      { score: { ...score } }, [], ["finale"]));
  }
  return nodes;
}

function topRivalry(arcs: PlayerArc[]): { a: string; b: string; teamA: TeamId; record: [number, number] } | null {
  let best: { a: string; b: string; teamA: TeamId; record: [number, number]; duels: number } | null = null;
  for (const arc of arcs) {
    for (const r of arc.rivalries) {
      const duels = r.record[0] + r.record[1];
      if (!best || duels > best.duels) best = { a: arc.name, b: r.vs, teamA: arc.team, record: r.record, duels };
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// CONSTRUCCIÓN DEL GRAFO CAUSAL
// ---------------------------------------------------------------------------

const SIGNIFICANT: Set<NarrativeEventType> = new Set([
  "ace", "clutch", "multikill", "retake", "eco_win", "first_blood",
  "timeout", "tactical_shift", "momentum_shift", "confidence_shift", "economy_shift",
  "streak", "comeback_started", "collapse_started", "dominance", "disappearance",
  "rivalry", "inflection", "match_end",
]);

export function buildGraph(allEvents: NarrativeEvent[], winner: TeamId | null): StoryGraph {
  const nodes = allEvents.filter((e) => SIGNIFICANT.has(e.type) || e.importance >= 45);
  const edges: StoryEdge[] = [];
  const seen = new Set<string>();
  const add = (from: NarrativeEvent, to: NarrativeEvent, relation: EdgeRelation) => {
    if (from.id === to.id) return;
    const key = `${from.id}->${to.id}:${relation}`;
    if (seen.has(key)) return;
    seen.add(key);
    const gap = Math.max(0, to.round - from.round);
    const weight = Math.max(0, Math.min(1, 0.3 + from.importance / 200 + 0.3 / (1 + gap)));
    edges.push({ from: from.id, to: to.id, relation, weight: Math.round(weight * 100) / 100 });
  };
  const inWin = (e: NarrativeEvent, lo: number, hi: number) => e.round >= lo && e.round <= hi;
  const of = (types: NarrativeEventType[], favors?: TeamId | null) =>
    nodes.filter((e) => types.includes(e.type) && (favors === undefined || e.favors === favors));

  for (const e of nodes) {
    const T = e.favors;
    // 1. golpe (ace/clutch/multikill/retake/eco_win) → confidence_shift del mismo equipo
    if (T && ["ace", "clutch", "multikill", "retake", "eco_win"].includes(e.type)) {
      for (const c of of(["confidence_shift"], T)) if (inWin(c, e.round, e.round + 1)) add(e, c, "caused");
      // 3. y → timeout del rival
      for (const to of of(["timeout"], opp(T))) if (inWin(to, e.round, e.round + 1)) add(e, to, "triggered");
    }
    // 2. confidence_shift → momentum_shift mismo equipo
    if (T && e.type === "confidence_shift") {
      for (const m of of(["momentum_shift"], T)) if (inWin(m, e.round, e.round + 2)) add(e, m, "led_to");
    }
    // 4. timeout → tactical_shift del mismo equipo
    if (T && e.type === "timeout") {
      for (const ts of of(["tactical_shift"], T)) if (inWin(ts, e.round, e.round + 2)) add(e, ts, "led_to");
    }
    // 5. tactical_shift → momentum_shift mismo equipo (respuesta / vuelta)
    if (T && e.type === "tactical_shift") {
      for (const m of of(["momentum_shift"], T)) if (inWin(m, e.round, e.round + 3)) {
        const reversed = m.data.from && m.data.from === opp(T);
        add(e, m, reversed ? "reversed" : "enabled");
      }
    }
    // 6. momentum_shift → streak mismo equipo
    if (T && e.type === "momentum_shift") {
      for (const sk of of(["streak"], T)) if (inWin(sk, e.round, e.round + 3)) add(e, sk, "reinforced");
    }
    // 7. inflexión → remontada/colapso y → fin
    if (e.type === "inflection") {
      for (const cb of of(["comeback_started", "collapse_started"])) if (inWin(cb, e.round - 1, e.round + 1)) add(e, cb, "caused");
      for (const me of of(["match_end"])) add(e, me, "led_to");
    }
    // 8. remontada/dominio/racha → fin (si culmina en victoria del mismo equipo)
    if (T && winner === T && ["comeback_started", "dominance", "streak"].includes(e.type)) {
      for (const me of of(["match_end"], winner)) add(e, me, "culminated_in");
    }
    // 9. contribución débil de golpes grandes al desenlace
    if (T && winner === T && e.importance >= 60 && e.type !== "match_end") {
      for (const me of of(["match_end"], winner)) add(e, me, "contributed_to");
    }
  }

  return { nodes, edges };
}
