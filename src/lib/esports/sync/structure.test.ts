/**
 * SYNC · PERSISTENCIA DE LA ESTRUCTURA DEL CUADRO (Fase 24.4).
 *
 *   fuente (VLR)  →  RawSnapshot.brackets  →  RawMatch.progression  →  fila parcial de `matches`
 *
 * Sin base de datos: el cliente Supabase es de mentira y anota los upserts. Lo que se prueba
 * es la POLÍTICA: solo se escribe lo CONFIRMED, el upsert es parcial (no toca el partido),
 * importar dos veces produce lo mismo y una pasada sin cuadro no borra nada.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseBracketStructure } from "@/importer-vlr/brackets";
import { toRawSnapshot } from "@/importer-vlr/normalize";
import type { VlrMatch } from "@/importer-vlr/types";
import { snapshotToSource } from "./vlrSnapshotSource";
import { progressionRow } from "./mappers";
import { syncTournament } from "./orchestrator";
import type { CompetitiveSource, RawMatch } from "./source";

const REAL_HTML = readFileSync(new URL("../../../importer-vlr/fixtures/vlr-2766-champions-2026-groups.html", import.meta.url), "utf8");

/** Partidos MÍNIMOS (QA SYNTHETIC) con los ids reales de la página de Champions 2026 (grupo A). */
const vlrMatch = (vlrId: string, teamA: string, teamB: string): VlrMatch => ({
  vlrId, urlPath: `/${vlrId}/x`, teamA, teamB, stage: "Group Stage", series: "Opening (A)", dayText: "Sun, September 27, 2026", maps: [],
});
const GROUP_A: VlrMatch[] = [
  vlrMatch("753444", "100 Thieves", "T1"), vlrMatch("753445", "JD Gaming", "FUT Esports"),
  { ...vlrMatch("753446", "TBD", "TBD"), series: "Winner's (A)" },
  { ...vlrMatch("753447", "TBD", "TBD"), series: "Elimination (A)" },
  { ...vlrMatch("753448", "TBD", "TBD"), series: "Decider (A)" },
];

test("REAL SOURCE → snapshot.brackets: nodos con destino, hueco y clasificación, solo CONFIRMED", () => {
  const structure = parseBracketStructure(REAL_HTML);
  const snap = toRawSnapshot({ eventId: "2766", slug: "x" }, { name: "Valorant Champions 2026" }, [], [], GROUP_A, [], structure);
  const brackets = snap.brackets ?? [];
  assert.ok(brackets.length >= 2, "alto y bajo del grupo A");
  const nodes = brackets.flatMap((b) => b.nodes);
  const o1 = nodes.find((n) => n.matchId === "753444")!;
  assert.deepEqual([o1.winnerToNodeId, o1.winnerToSlot, o1.evidence, o1.confidence], ["bn-753446", 1, "SOURCE_STRUCTURED_HTML", "CONFIRMED"]);
  const w = nodes.find((n) => n.matchId === "753446")!;
  assert.equal(w.winnerQualifies, "qualified:groupa:winners");
  assert.equal(brackets[0].kind, "gsl");
  // Los partidos de otros grupos no están en el snapshot: sus nodos no se inventan.
  assert.ok(!nodes.some((n) => n.matchId === "753449"));
});

test("snapshot → RawMatch.progression → fila parcial de matches (sin marcador ni equipos)", () => {
  const structure = parseBracketStructure(REAL_HTML);
  const snap = toRawSnapshot({ eventId: "2766", slug: "x" }, { name: "Valorant Champions 2026" }, [], [], GROUP_A, [], structure);
  const { source } = snapshotToSource(snap, { eventId: "vlr-2766", agents: new Map(), maps: new Map() });
  return source.getMatches("vlr-2766").then((matches) => {
    const o1 = matches.find((m) => m.id === "753444")!;
    assert.deepEqual(o1.progression, {
      winnerTo: { matchId: "753446", slot: 1 }, loserTo: undefined, winnerQualifies: undefined,
      evidence: "SOURCE_STRUCTURED_HTML", confidence: "CONFIRMED", version: "vlr-brackets-1",
    });
    const row = progressionRow(o1, new Date("2026-09-13T00:00:00Z"))!;
    assert.deepEqual(row, {
      id: "753444", winner_to_match_id: "753446", winner_to_slot: 1, loser_to_match_id: null, loser_to_slot: null,
      winner_qualifies: null, winner_qualifies_label: null, progression_evidence: "SOURCE_STRUCTURED_HTML",
      progression_confidence: "CONFIRMED", progression_version: "vlr-brackets-1", progression_synced_at: "2026-09-13T00:00:00.000Z",
    });
    assert.ok(!("score_a" in row) && !("team_a" in row), "parcial: no toca el partido");
    const w = matches.find((m) => m.id === "753446")!;
    assert.equal(progressionRow(w)!.winner_qualifies, "qualified:groupa:winners");
    const e = matches.find((m) => m.id === "753447")!;
    assert.equal(progressionRow(e)!.winner_to_match_id, "753448");
  });
});

test("progressionRow · sin estructura, INFERRED o autoarista → null (no se escribe nada)", () => {
  const base: RawMatch = { id: "m", eventId: "e", teamAId: "a", teamBId: "b" };
  assert.equal(progressionRow(base), null);
  assert.equal(progressionRow({ ...base, progression: { evidence: "SOURCE_STRUCTURED_HTML", confidence: "INFERRED" as unknown as "CONFIRMED", winnerTo: { matchId: "x" } } }), null);
  assert.equal(progressionRow({ ...base, progression: { evidence: "SOURCE_STRUCTURED_HTML", confidence: "CONFIRMED", winnerTo: { matchId: "m" } } }), null);
});

/* ─────────────── IDEMPOTENCIA DEL IMPORTADOR ─────────────── */

function fakeSb() {
  const upserts: { table: string; rows: Record<string, unknown>[] }[] = [];
  const from = (table: string) => ({
    upsert: (rows: Record<string, unknown> | Record<string, unknown>[]) => {
      const list = Array.isArray(rows) ? rows : [rows];
      upserts.push({ table, rows: list });
      const result = { data: list.map((r) => ({ id: r.id ?? r.slug, slug: r.slug, map_order: r.map_order })), error: null };
      return { select: async () => result, then: (res: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(res) };
    },
    insert: async () => ({ error: null }),
    select: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) }),
  });
  return { sb: { from, rpc: async () => ({ data: null, error: null }) } as unknown as SupabaseClient, upserts };
}

const sourceWith = (matches: RawMatch[]): CompetitiveSource => ({
  id: "test", label: "test",
  getCircuits: async () => [], getTournaments: async () => [],
  getTournament: async (id: string) => ({ id, name: "T" }),
  getStages: async () => [{ slug: "playoffs", name: "Playoffs", kind: "playoff", orderIdx: 0 }],
  getTeams: async () => [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }, { id: "d", name: "D" }],
  getMatches: async () => matches,
  getMatchDetail: async () => null,
  getStandings: async () => [],
} as unknown as CompetitiveSource);

const P = { evidence: "SOURCE_STRUCTURED_HTML" as const, confidence: "CONFIRMED" as const };
const withStructure: RawMatch[] = [
  { id: "sf1", eventId: "t", stageSlug: "playoffs", teamAId: "a", teamBId: "b", round: "Semifinal", startTime: "2026-10-01T10:00:00Z", progression: { ...P, winnerTo: { matchId: "f", slot: 1 } } },
  { id: "sf2", eventId: "t", stageSlug: "playoffs", teamAId: "c", teamBId: "d", round: "Semifinal", startTime: "2026-10-01T13:00:00Z", progression: { ...P, winnerTo: { matchId: "f", slot: 2 } } },
  { id: "f", eventId: "t", stageSlug: "playoffs", teamAId: "a", teamBId: "c", round: "Final", startTime: "2026-10-02T10:00:00Z" },
];
const progressionUpserts = (u: { table: string; rows: Record<string, unknown>[] }[]) =>
  u.filter((x) => x.table === "matches" && x.rows.some((r) => "winner_to_match_id" in r));

test("19 · importar el mismo torneo dos veces escribe exactamente la misma estructura (sin duplicar)", async () => {
  const a = fakeSb(), b = fakeSb();
  const r1 = await syncTournament(sourceWith(withStructure), "t", a.sb, { pickems: false });
  const r2 = await syncTournament(sourceWith(withStructure), "t", b.sb, { pickems: false });
  assert.ok(r1.ok && r2.ok, r1.error ?? r2.error);
  const strip = (rows: Record<string, unknown>[]) => rows.map(({ progression_synced_at: _, ...r }) => r);
  const p1 = progressionUpserts(a.upserts), p2 = progressionUpserts(b.upserts);
  assert.equal(p1.length, 1); assert.equal(p2.length, 1);
  assert.deepEqual(strip(p1[0].rows), strip(p2[0].rows));
  assert.deepEqual(strip(p1[0].rows).map((r) => [r.id, r.winner_to_match_id, r.winner_to_slot]), [["sf1", "f", 1], ["sf2", "f", 2]]);
  assert.deepEqual(r1.structure, { confirmed: 2, qualification: 0, unknown: 1 });
});

test("20 · una reimportación SIN cuadro no escribe las columnas de estructura: lo confirmado antes se queda", async () => {
  const { sb, upserts } = fakeSb();
  const sinEstructura = withStructure.map(({ progression: _p, ...m }) => m);
  const r = await syncTournament(sourceWith(sinEstructura), "t", sb, { pickems: false });
  assert.ok(r.ok, r.error);
  assert.equal(progressionUpserts(upserts).length, 0, "ni un upsert de estructura");
  const matchRows = upserts.filter((x) => x.table === "matches").flatMap((x) => x.rows);
  assert.ok(matchRows.every((row) => !("winner_to_match_id" in row)), "el upsert normal de partidos no lleva las columnas: no las pisa con NULL");
  assert.deepEqual(r.structure, { confirmed: 0, qualification: 0, unknown: 3 });
});

test("16 · un destino que no es un partido de este torneo no se escribe (FK y cross-event)", async () => {
  const { sb, upserts } = fakeSb();
  const cruzado: RawMatch[] = [{ ...withStructure[0], progression: { ...P, winnerTo: { matchId: "otro-torneo-final", slot: 1 } } }, withStructure[2]];
  await syncTournament(sourceWith(cruzado), "t", sb, { pickems: false });
  assert.equal(progressionUpserts(upserts).length, 0);
});
