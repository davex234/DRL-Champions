/**
 * PICK'EMS · CUADRO CON ESTRUCTURA CONFIRMADA (Fase 24.4) — presentación y contrato.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { QualifiedNode } from "./QualifiedNode";
import { BracketPickemView } from "./BracketPickemView";
import { buildBracketModel, type BracketMatchInput, type StageLike } from "@/domain/pickems/bracket";
import type { PickemQuestion } from "@/lib/game/client";

const html = (n: React.ReactElement): string => renderToStaticMarkup(n);
const src = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const NOW = Date.parse("2026-03-10T12:00:00Z");
const at = (h: number) => new Date(NOW + h * 3600_000).toISOString();
const GROUP: StageLike[] = [{ id: "st-g", name: "Group A", kind: "group", order_idx: 0 }];
const C = { progression_evidence: "SOURCE_STRUCTURED_HTML", progression_confidence: "CONFIRMED" } as const;
const mm = (id: string, over: Partial<BracketMatchInput> = {}): BracketMatchInput => ({
  id, stage_id: "st-g", team_a: null, team_b: null, start_time: at(24), status: "upcoming",
  score_a: null, score_b: null, round: null, match_order: null, ...over,
});
const gsl = (): BracketMatchInput[] => [
  mm("o1", { team_a: "100 Thieves", team_b: "T1", round: "Opening (A)", match_order: 1, start_time: at(1), ...C, winner_to_match_id: "w", winner_to_slot: 1 }),
  mm("o2", { team_a: "JD Gaming", team_b: "FUT Esports", round: "Opening (A)", match_order: 2, start_time: at(2), ...C, winner_to_match_id: "w", winner_to_slot: 2 }),
  mm("w", { round: "Winner's (A)", start_time: at(10), ...C, winner_qualifies: "qualified:groupa:winners", winner_qualifies_label: "Qualified" }),
  mm("e", { round: "Elimination (A)", start_time: at(11), ...C, winner_to_match_id: "d" }),
  mm("d", { round: "Decider (A)", start_time: at(20), ...C, winner_qualifies: "qualified:groupa:decider", winner_qualifies_label: "Qualified" }),
];
const q = (id: string, matchId: string): PickemQuestion => ({
  id, pickem_event_id: "e1", kind: "match_winner", match_id: matchId, prompt: "¿Quién gana?", points: 10, locks_at: at(1),
  order_idx: 0, locked: false, correct_option: null, options: [{ key: "a", label: "A" }, { key: "b", label: "B" }],
});
const noop = () => undefined;

test("45-46 · las líneas existen ANTES del resultado, hacia un destino TBD", () => {
  const model = buildBracketModel({ stages: GROUP, matches: gsl(), questions: [q("q1", "o1")], answers: {}, now: NOW });
  assert.ok(model.edges.some((e) => e.from === "o1" && e.to === "w" && e.slot === "a"));
  assert.equal(model.matches.w.teamA, null, "destino TBD");
  const out = html(<BracketPickemView model={model} questions={[q("q1", "o1")]} answers={{}} now={NOW} saving={null} feedback={null} canPick onPick={noop} bracketMode="desktop" />);
  assert.match(out, /data-structural="5"/, "cinco aristas estructurales: dos huecos, eliminación → decisivo y dos clasificaciones");
});

test("47-48 · Clasificado · Por definir antes; con el equipo real después", () => {
  const antes = buildBracketModel({ stages: GROUP, matches: gsl(), questions: [], answers: {}, now: NOW });
  const node = antes.qualificationNodes.find((n) => n.key === "qualified:groupa:winners")!;
  const tbd = html(<QualifiedNode node={node} />);
  assert.match(tbd, /Por definir/); assert.match(tbd, /data-qualified="tbd"/); assert.match(tbd, /data-match-id="qual:qualified:groupa:winners"/);
  assert.match(tbd, /aria-label="Qualified: Por definir"/);

  const jugado = gsl().map((m) => m.id === "w" ? { ...m, team_a: "100 Thieves", team_b: "FUT Esports", status: "finished", score_a: 2, score_b: 0, winner_team: "100 Thieves" } : m);
  const despues = buildBracketModel({ stages: GROUP, matches: jugado, questions: [], answers: {}, now: NOW });
  const real = html(<QualifiedNode node={despues.qualificationNodes.find((n) => n.key === "qualified:groupa:winners")!} />);
  assert.match(real, /100 Thieves/); assert.match(real, /data-qualified="team"/);
  assert.ok(!/Por definir/.test(real));
});

test("49-51 · el conector distingue estructura y resultado, ganador y perdedor, y dibuja hacia el cuadro bajo", () => {
  const SRC = src("./BracketConnector.tsx");
  assert.match(SRC, /data-kind=\{l\.kind\}/);
  assert.match(SRC, /opacity=\{l\.kind === "STRUCTURAL" \? 0\.75 : 1\}/, "estructura sin resultado: la misma línea, más tenue");
  assert.match(SRC, /strokeDasharray=\{l\.source === "LOSER"/);
  assert.match(SRC, /b\.top > a\.bottom/, "perdedor que cae al cuadro bajo");
  assert.match(SRC, /b\.height \* 0\.5/, "sin hueco conocido entra por el centro: no se inventa hueco");
});

test("52-53 · la columna «Clasificados» se monta en escritorio y la caja del clasificado también en móvil", () => {
  const model = buildBracketModel({ stages: GROUP, matches: gsl(), questions: [], answers: {}, now: NOW });
  const desk = html(<BracketPickemView model={model} questions={[]} answers={{}} now={NOW} saving={null} feedback={null} canPick onPick={noop} bracketMode="desktop" />);
  assert.match(desk, /aria-label="Clasificados"/);
  assert.equal((desk.match(/data-qualified=/g) ?? []).length, 2);
  const mob = html(<BracketPickemView model={model} questions={[]} answers={{}} now={NOW} saving={null} feedback={null} canPick onPick={noop} bracketMode="mobile" />);
  assert.match(mob, /data-bracket-mode="mobile"/);
});

test("55-56 · accesibilidad y movimiento: la caja del clasificado es un article etiquetado; sin animación propia", () => {
  const SRC = src("./QualifiedNode.tsx");
  assert.match(SRC, /<article/); assert.match(SRC, /aria-label=/);
  assert.ok(!/animation|@keyframes/.test(SRC));
});

test("44 · historial: el cuadro con estructura se enseña en solo lectura con clasificados", () => {
  const model = buildBracketModel({ stages: GROUP, matches: gsl(), questions: [q("q1", "o1")], answers: { q1: { option: "a", isCorrect: null, pointsAward: null } }, now: NOW });
  const out = html(<BracketPickemView model={model} questions={[q("q1", "o1")]} answers={{ q1: { option: "a", isCorrect: null, pointsAward: null } }} now={NOW} saving={null} feedback={null} canPick={false} readOnly showResolved onPick={noop} bracketMode="desktop" />);
  assert.ok(!/Seleccionar /.test(out));
  assert.match(out, /Clasificados/);
  assert.match(out, /Tu pick: <b[^>]*>100 Thieves/);
});

test("34 · seguridad: el cliente no escribe estructura — las columnas 0045 solo las lee", () => {
  const client = readFileSync(new URL("../../../lib/game/client.ts", import.meta.url), "utf8");
  assert.match(client, /winner_to_match_id, winner_to_slot, loser_to_match_id, loser_to_slot, winner_qualifies/);
  assert.ok(!/update\(\{[^}]*winner_to_match_id|insert\(\{[^}]*winner_to_match_id/.test(client));
  const sql = readFileSync(new URL("../../../../supabase/migrations/0045_match_progression.sql", import.meta.url), "utf8");
  assert.match(sql, /check \(progression_confidence is null or progression_confidence in \('CONFIRMED'\)\)/, "INFERRED no se persiste");
  assert.match(sql, /matches_no_self_progression/);
  assert.match(sql, /matches_winner_slot_uniq/);
});
