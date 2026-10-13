/**
 * F87 · FIXTURES AISLADOS DE FORMATO (solo pruebas). Equipos y partidos FICTICIOS (`t-01`…, `m-…`):
 * no representan ningún torneo real y nunca se escriben en una base de datos. Lo real está en
 * `fixtures/vlr-2766-champions-2026.snapshot.json`.
 */
import type { FormatEdge, RealMatchRow, StageRow } from "../format";

export const T = (i: number) => `t-${String(i).padStart(2, "0")}`;
const H = 3600_000;
const BASE = Date.parse("2030-01-01T10:00:00Z");

interface M { id: string; round: string; order: number; hour: number; a?: number; b?: number; wTo?: [string, 1 | 2 | null]; lTo?: [string, 1 | 2 | null]; q?: string; bo?: number }

function rows(stageId: string, ms: M[]): RealMatchRow[] {
  return ms.map((m) => ({
    id: m.id, event_id: "evt-test", stage_id: stageId, round: m.round, match_order: m.order, best_of: m.bo ?? 3,
    status: "upcoming", start_time: new Date(BASE + m.hour * H).toISOString(),
    team_a_id: m.a ? T(m.a) : "vlr-t-tbd", team_b_id: m.b ? T(m.b) : "vlr-t-tbd",
    team_a: m.a ? `Equipo ${m.a}` : "TBD", team_b: m.b ? `Equipo ${m.b}` : "TBD",
    winner_team_id: null, score_a: null, score_b: null,
    winner_to_match_id: m.wTo?.[0] ?? null, winner_to_slot: m.wTo?.[1] ?? null,
    loser_to_match_id: m.lTo?.[0] ?? null, loser_to_slot: m.lTo?.[1] ?? null,
    winner_qualifies: m.q ?? null, winner_qualifies_label: m.q ? "Clasificado" : null,
    progression_confidence: m.wTo || m.lTo || m.q ? "CONFIRMED" : null,
  }));
}

export interface Fixture { stages: StageRow[]; matches: RealMatchRow[]; adminEdges?: Omit<FormatEdge, "origin">[] }

export function se4(): Fixture {
  return {
    stages: [{ id: "st-po", name: "Playoffs", kind: "playoff", order_idx: 0 }],
    matches: rows("st-po", [
      { id: "se4-sf1", round: "Semifinals", order: 1, hour: 0, a: 1, b: 2, wTo: ["se4-f", 1] },
      { id: "se4-sf2", round: "Semifinals", order: 2, hour: 2, a: 3, b: 4, wTo: ["se4-f", 2] },
      { id: "se4-f", round: "Grand Final", order: 3, hour: 24, bo: 5 },
    ]).map((r) => (r.id === "se4-f" ? { ...r, round: "Final" } : r)),
  };
}

export function se8(): Fixture {
  return {
    stages: [{ id: "st-po", name: "Playoffs", kind: "playoff", order_idx: 0 }],
    matches: rows("st-po", [
      { id: "se8-qf1", round: "Quarterfinals", order: 1, hour: 0, a: 1, b: 8, wTo: ["se8-sf1", 1] },
      { id: "se8-qf2", round: "Quarterfinals", order: 2, hour: 2, a: 4, b: 5, wTo: ["se8-sf1", 2] },
      { id: "se8-qf3", round: "Quarterfinals", order: 3, hour: 4, a: 2, b: 7, wTo: ["se8-sf2", 1] },
      { id: "se8-qf4", round: "Quarterfinals", order: 4, hour: 6, a: 3, b: 6, wTo: ["se8-sf2", 2] },
      { id: "se8-sf1", round: "Semifinals", order: 5, hour: 24 },
      { id: "se8-sf2", round: "Semifinals", order: 6, hour: 26 },
      { id: "se8-f", round: "Final", order: 7, hour: 48, bo: 5 },
    ]),
  };
}

/** Doble a 8 con la forma de los Champions: la fuente da los ganadores; los perdedores los da el admin. */
export function de8(withAdmin = true): Fixture {
  const matches = rows("st-po", [
    { id: "de-uqf1", round: "Upper Quarterfinals", order: 1, hour: 0, a: 1, b: 8, wTo: ["de-usf1", 1] },
    { id: "de-uqf2", round: "Upper Quarterfinals", order: 2, hour: 2, a: 4, b: 5, wTo: ["de-usf1", 2] },
    { id: "de-uqf3", round: "Upper Quarterfinals", order: 3, hour: 24, a: 2, b: 7, wTo: ["de-usf2", 1] },
    { id: "de-uqf4", round: "Upper Quarterfinals", order: 4, hour: 26, a: 3, b: 6, wTo: ["de-usf2", 2] },
    { id: "de-lr1a", round: "Lower Round 1", order: 5, hour: 48, wTo: ["de-lr2a", null] },
    { id: "de-lr1b", round: "Lower Round 1", order: 6, hour: 50, wTo: ["de-lr2b", null] },
    { id: "de-usf1", round: "Upper Semifinals", order: 7, hour: 72, wTo: ["de-uf", 1] },
    { id: "de-usf2", round: "Upper Semifinals", order: 8, hour: 74, wTo: ["de-uf", 2] },
    { id: "de-lr2a", round: "Lower Round 2", order: 9, hour: 96, wTo: ["de-lr3", 1] },
    { id: "de-lr2b", round: "Lower Round 2", order: 10, hour: 98, wTo: ["de-lr3", 2] },
    { id: "de-uf", round: "Upper Final", order: 11, hour: 120 },
    { id: "de-lr3", round: "Lower Round 3", order: 12, hour: 122, wTo: ["de-lf", null] },
    { id: "de-lf", round: "Lower Final", order: 13, hour: 144, bo: 5 },
    { id: "de-gf", round: "Grand Final", order: 14, hour: 168, bo: 5 },
  ]);
  return {
    stages: [{ id: "st-po", name: "Playoffs", kind: "playoff", order_idx: 1 }],
    matches,
    adminEdges: withAdmin ? [
      { from: "de-uqf1", to: "de-lr1a", source: "LOSER", slot: 1 },
      { from: "de-uqf2", to: "de-lr1a", source: "LOSER", slot: 2 },
      { from: "de-uqf3", to: "de-lr1b", source: "LOSER", slot: 1 },
      { from: "de-uqf4", to: "de-lr1b", source: "LOSER", slot: 2 },
      { from: "de-usf1", to: "de-lr2b", source: "LOSER", slot: null },
      { from: "de-usf2", to: "de-lr2a", source: "LOSER", slot: null },
    ] : [],
  };
}

/** Un grupo GSL con lo que da la fuente real (Apertura → Ganadores con hueco; Eliminación → Decisivo sin hueco). */
function gslGroup(g: string, teams: number[], hour0: number, stageId = "st-gr"): RealMatchRow[] {
  const p = `gsl-${g.toLowerCase()}`;
  return rows(stageId, [
    { id: `${p}-o1`, round: `Opening (${g})`, order: 1, hour: hour0, a: teams[0], b: teams[1], wTo: [`${p}-w`, 1] },
    { id: `${p}-o2`, round: `Opening (${g})`, order: 2, hour: hour0 + 2, a: teams[2], b: teams[3], wTo: [`${p}-w`, 2] },
    { id: `${p}-w`, round: `Winner's (${g})`, order: 3, hour: hour0 + 24, q: `qualified:group${g.toLowerCase()}:winners` },
    { id: `${p}-e`, round: `Elimination (${g})`, order: 4, hour: hour0 + 48, wTo: [`${p}-d`, null] },
    { id: `${p}-d`, round: `Decider (${g})`, order: 5, hour: hour0 + 72, q: `qualified:group${g.toLowerCase()}:decider` },
  ]);
}

export function gsl1(): Fixture {
  return { stages: [{ id: "st-gr", name: "Group Stage", kind: "group", order_idx: 0 }], matches: gslGroup("A", [1, 2, 3, 4], 0) };
}

/** Dos grupos GSL → playoffs a 4 (dos ámbitos: grupos y playoffs). */
export function gsl2Playoffs(): { groups: Fixture; playoffs: Fixture } {
  return {
    groups: { stages: [{ id: "st-gr", name: "Group Stage", kind: "group", order_idx: 0 }], matches: [...gslGroup("A", [1, 2, 3, 4], 0), ...gslGroup("B", [5, 6, 7, 8], 4)] },
    playoffs: {
      stages: [{ id: "st-po", name: "Playoffs", kind: "playoff", order_idx: 1 }],
      matches: rows("st-po", [
        { id: "gp-sf1", round: "Semifinals", order: 1, hour: 200, wTo: ["gp-f", 1] },
        { id: "gp-sf2", round: "Semifinals", order: 2, hour: 202, wTo: ["gp-f", 2] },
        { id: "gp-f", round: "Final", order: 3, hour: 230, bo: 5 },
      ]),
    },
  };
}

/** Todos contra todos (grupo de 4: 6 partidos) → final a 2. */
export function rrPlayoffs(): { groups: Fixture; playoffs: Fixture } {
  const pairs: [number, number][] = [[1, 2], [3, 4], [1, 3], [2, 4], [1, 4], [2, 3]];
  return {
    groups: {
      stages: [{ id: "st-rr", name: "Group Stage", kind: "group", order_idx: 0 }],
      matches: rows("st-rr", pairs.map(([a, b], i) => ({ id: `rr-${i + 1}`, round: `Group A · Week ${Math.floor(i / 2) + 1}`, order: i + 1, hour: i * 3, a, b }))),
    },
    playoffs: {
      stages: [{ id: "st-po", name: "Playoffs", kind: "playoff", order_idx: 1 }],
      matches: rows("st-po", [{ id: "rr-final", round: "Grand Final", order: 1, hour: 100, bo: 5 }]).map((r) => ({ ...r, round: "Final" })),
    },
  };
}

/** Marca un partido como terminado con ganador (lado a/b). */
export function finish(ms: RealMatchRow[], id: string, side: "a" | "b", score: [number, number] = [2, 1]): RealMatchRow[] {
  return ms.map((m) => (m.id !== id ? m : { ...m, status: "finished", winner_team_id: side === "a" ? m.team_a_id : m.team_b_id, score_a: side === "a" ? score[0] : score[1], score_b: side === "a" ? score[1] : score[0] }));
}

/** Coloca equipos reales en un partido (lo que haría el worker al avanzar el cuadro). */
export function place(ms: RealMatchRow[], id: string, a: string | null, b: string | null): RealMatchRow[] {
  return ms.map((m) => (m.id !== id ? m : { ...m, team_a_id: a ?? "vlr-t-tbd", team_b_id: b ?? "vlr-t-tbd", team_a: a ? `Equipo ${Number(a.slice(2))}` : "TBD", team_b: b ? `Equipo ${Number(b.slice(2))}` : "TBD" }));
}
