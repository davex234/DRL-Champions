/**
 * MATCH NARRATIVE ENGINE — Orquestador.
 *
 * `MatchNarrator` ingiere rondas terminadas (solo lectura) y, al finalizar, produce
 * el `NarrativeState` completo: timeline, story graph, momentos clave, héroes,
 * villanos, momentum, forma y resumen. Determinista: misma entrada ⇒ misma historia.
 */
import type { RoundState, Side } from "../sim";
import type {
  KeyMoment, MatchShape, NarrativeEvent, NarrativeState, TeamId, TeamRef,
} from "./types";
import { extractRound, type IngestContext } from "./ingest";
import type { RoundRecord } from "./memory";
import { computeMomentum, findInflection } from "./momentum";
import { classifyShape } from "./shape";
import { buildArcs, type StaticPlayer } from "./arcs";
import { selectStandouts } from "./heroes";
import { deriveNodes, buildGraph } from "./graph";
import { roundLeverage } from "./importance";
import { buildSummary } from "./summary";

export interface MatchMeta {
  teamNames?: Partial<Record<TeamId, string>>;
  target?: number; // rondas para ganar (def 13)
}

export class MatchNarrator {
  private records: RoundRecord[] = [];
  private statics: Record<string, StaticPlayer> = {};
  private nameTeam: Record<string, TeamId> = {};
  private score: Record<TeamId, number> = { A: 0, B: 0 };
  private round = 0;
  private target: number;
  private teamNames: Record<TeamId, string>;
  private refName: string | null = null;
  private refSide: Side | null = null;

  constructor(meta: MatchMeta = {}) {
    this.target = meta.target ?? 13;
    this.teamNames = { A: meta.teamNames?.A ?? "Equipo A", B: meta.teamNames?.B ?? "Equipo B" };
  }

  /** Ingiere una ronda YA terminada (RoundState con winner). No la muta. */
  ingestRound(s: RoundState): void {
    this.round++;
    if (this.round === 1) this.bootstrap(s);

    // Pistola: 1ª ronda o cambio de lado (inicio de mitad) del jugador de referencia.
    const ref = s.players.find((p) => p.name === this.refName);
    const pistol = this.round === 1 || (ref != null && ref.side !== this.refSide);
    if (ref) this.refSide = ref.side;

    const ctx: IngestContext = {
      round: this.round,
      target: this.target,
      totalRoundsGuess: this.target * 2 - 2, // máximo regular aproximado
      scoreBefore: { ...this.score },
      pistol,
      teamOf: (name) => this.nameTeam[name] ?? "A",
    };
    const rec = extractRound(s, ctx);
    this.records.push(rec);
    this.score = { ...rec.scoreAfter };
  }

  /** Construye el estado narrativo final. */
  finalize(): NarrativeState {
    const winner = this.resolveWinner();
    const teams = this.buildTeams();

    const momentum = computeMomentum(this.records);
    const inflection = findInflection(momentum.series, winner);
    const arcs = buildArcs(this.records, this.statics);
    const { heroes, villains } = selectStandouts(arcs, winner);
    const derived = deriveNodes(this.records, momentum, inflection, arcs, this.score, winner);

    // Todos los eventos + impacto recalculado con el leverage de su ronda.
    const total = this.records.length;
    const all: NarrativeEvent[] = [...this.records.flatMap((r) => r.events), ...derived];
    for (const e of all) {
      const rec = this.records[e.round - 1];
      const closeness = rec ? 1 - Math.abs(rec.scoreAfter.A - rec.scoreAfter.B) / Math.max(1, this.target) : 0;
      const inDecisive = e.round >= total - 4 || (inflection != null && Math.abs(e.round - inflection.round) <= 1);
      const lev = roundLeverage({ round: e.round, totalRounds: total, closeness, inDecisiveStretch: inDecisive });
      e.impact = Math.round(Math.max(0, Math.min(100, e.importance * lev)));
    }

    const graph = buildGraph(all, winner);
    const shape = classifyShape(this.records, this.score, winner);
    const keyMoments = this.pickKeyMoments(all);
    const timeline = [...all].sort((a, b) => a.round - b.round || a.tick - b.tick || b.importance - a.importance);

    const summary = buildSummary({
      teams, score: this.score, winner, shape, arcs, heroes, villains,
      keyMoments: keyMoments.map((k) => k.event), derived,
      inflectionRound: inflection?.round ?? null,
    });

    return {
      match: { teams, score: { ...this.score }, winner, rounds: total, shape },
      timeline, graph, keyMoments,
      momentum: { series: momentum.series, shifts: momentum.shifts },
      players: arcs, heroes, villains, summary,
    };
  }

  // ---- internos ----
  private bootstrap(s: RoundState): void {
    const atk = s.players.filter((p) => p.side === "ATK").map((p) => p.name);
    const def = s.players.filter((p) => p.side === "DEF").map((p) => p.name);
    // "A" = el grupo con el nick lexicográficamente menor (determinista).
    const minAtk = atk.slice().sort()[0] ?? "";
    const minDef = def.slice().sort()[0] ?? "";
    const aGroup = minAtk <= minDef ? atk : def;
    for (const p of s.players) {
      const team: TeamId = aGroup.includes(p.name) ? "A" : "B";
      this.nameTeam[p.name] = team;
      this.statics[p.name] = {
        name: p.name, team, role: p.role,
        leadershipDrive: p.identity.leadershipDrive,
        selfBelief: p.identity.selfBelief,
        aggression: p.identity.aggression,
      };
    }
    this.refName = s.players[0].name;
    this.refSide = null;
  }

  private buildTeams(): Record<TeamId, TeamRef> {
    const players: Record<TeamId, string[]> = { A: [], B: [] };
    for (const name of Object.keys(this.statics)) players[this.statics[name].team].push(name);
    return {
      A: { id: "A", name: this.teamNames.A, players: players.A },
      B: { id: "B", name: this.teamNames.B, players: players.B },
    };
  }

  private resolveWinner(): TeamId | null {
    if (this.score.A >= this.target && this.score.A > this.score.B) return "A";
    if (this.score.B >= this.target && this.score.B > this.score.A) return "B";
    if (this.score.A === this.score.B) return null;
    return this.score.A > this.score.B ? "A" : "B";
  }

  private pickKeyMoments(all: NarrativeEvent[]): KeyMoment[] {
    const skip = new Set(["kill", "round_win", "execute_fast", "execute_slow", "plant", "economy_shift", "confidence_shift"]);
    const cand = all.filter((e) => !skip.has(e.type))
      .sort((a, b) => b.impact - a.impact || b.importance - a.importance)
      .slice(0, 8);
    return cand.map((event, i) => ({ event, rank: i + 1, why: whyKey(event) }));
  }
}

function whyKey(e: NarrativeEvent): string {
  switch (e.type) {
    case "ace": return "un ace cambia la ronda por completo";
    case "clutch": return `clutch 1v${e.data.clutchSize} bajo máxima presión`;
    case "inflection": return "la balanza se inclinó aquí";
    case "momentum_shift": return "cambio de control del mapa";
    case "comeback_started": return "arranca la remontada";
    case "collapse_started": return "empieza el colapso";
    case "retake": return "retake que roba la ronda";
    case "eco_win": return "ronda eco que rompe la economía rival";
    case "timeout": return "intervención del coach";
    default: return "momento de alto impacto";
  }
}

/** Conveniencia: construye la narrativa de un partido a partir de sus rondas. */
export function buildMatchNarrative(rounds: RoundState[], meta?: MatchMeta): NarrativeState {
  const n = new MatchNarrator(meta);
  for (const r of rounds) n.ingestRound(r);
  return n.finalize();
}
