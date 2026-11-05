/**
 * VLR · EL CUADRO DE LA PÁGINA DEL EVENTO (Fase 24.4) — pruebas con FUENTE REAL.
 *
 * Los fixtures de `./fixtures/` son la región de brackets de páginas reales de vlr.gg,
 * descargadas el 2026-09-13 y recortadas sin modificar (REAL SOURCE). Lo que se prueba es la
 * gramática: qué afirma el parser y, sobre todo, qué NO afirma.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseEventBrackets, deriveBracketStructure, parseBracketStructure } from "./brackets";

const fx = (name: string) => readFileSync(new URL(`./fixtures/${name}.html`, import.meta.url), "utf8");
const CHAMPIONS_2026 = fx("vlr-2766-champions-2026-groups");
const PACIFIC_2025 = fx("vlr-2500-pacific-stage-2-2025");
const AMERICAS_2024 = fx("vlr-2004-americas-stage-1-2024");
const CHAMPIONS_2025 = fx("vlr-2283-champions-2025");

/* ─────────────── PARSE ─────────────── */

test("REAL · Champions 2026 (sin jugar): 4 grupos × (alto + bajo), columnas Opening → Winner's → Qualified y Elimination → Decider → Qualified", () => {
  const conts = parseEventBrackets(CHAMPIONS_2026);
  assert.equal(conts.length, 8);
  assert.deepEqual(conts.slice(0, 2).map((c) => [c.group, c.side, c.columns.map((col) => col.label + (col.qualified ? "*" : ""))]), [
    ["Group A", "upper", ["Opening", "Winner's", "Qualified*"]],
    ["Group A", "lower", ["Elimination", "Decider", "Qualified*"]],
  ]);
  const opening = conts[0].columns[0];
  assert.equal(opening.items.length, 2);
  assert.deepEqual(opening.items[0].teams.map((t) => t.name), ["100 Thieves", "T1"]);
  assert.equal(opening.items[0].teams[0].score, undefined, "sin jugar: sin marcador");
  assert.equal(opening.items[0].line, "down"); assert.equal(opening.items[1].line, "up");
  const winners = conts[0].columns[1].items[0];
  assert.equal(winners.matchId, "753446", "un partido TBD sigue teniendo id");
  assert.deepEqual(winners.teams.map((t) => t.name), ["", ""], "TBD vs TBD: nombres vacíos, no inventados");
  assert.equal(winners.line, "straight");
});

test("REAL · Pacific Stage 2 2025 (compacto, con byes): filas de espaciado ignoradas, ganadores y marcadores leídos", () => {
  const conts = parseEventBrackets(PACIFIC_2025);
  assert.equal(conts.length, 2);
  const ur1 = conts[0].columns[0];
  assert.equal(ur1.label, "Upper Round 1");
  assert.equal(ur1.items.filter((i) => !i.empty).length, 2);
  const talon = ur1.items.find((i) => !i.empty)!;
  assert.deepEqual(talon.teams.map((t) => [t.name, t.score, t.winner]), [["TALON", 2, true], ["Nongshim RedForce", 0, false]]);
});

/* ─────────────── GRAMÁTICA → ARISTAS ─────────────── */

test("REAL · parejas (down, up) → huecos 1 y 2; uno a uno → sin hueco; 0 desconocidas y 0 conflictos en cuatro eventos", () => {
  for (const [name, html] of [["Champions 2025", CHAMPIONS_2025], ["Pacific 2025", PACIFIC_2025], ["Americas 2024", AMERICAS_2024], ["Champions 2026", CHAMPIONS_2026]] as const) {
    const s = parseBracketStructure(html);
    assert.ok(s.present, name);
    assert.equal(s.unknown.length, 0, `${name}: ${s.unknown.join(" | ")}`);
    assert.equal(s.conflicts.length, 0, `${name}: ${s.conflicts.join(" | ")}`);
    for (const e of s.edges) assert.equal(e.confidence, "CONFIRMED"), assert.equal(e.evidence, "SOURCE_STRUCTURED_HTML");
  }
  const champ = parseBracketStructure(CHAMPIONS_2025);
  // Upper Quarterfinals (4) → Upper Semifinals (2): dos parejas con hueco.
  assert.deepEqual(champ.edges.slice(0, 4).map((e) => [e.fromMatchId, e.toMatchId, e.toSlot]), [
    ["542264", "542268", 1], ["542265", "542268", 2], ["542266", "542269", 1], ["542267", "542269", 2],
  ]);
  // Lower Round 1 (2) → Lower Round 2 (2): uno a uno, SIN hueco (el otro hueco lo ocupa quien cae del alto).
  const lr1 = champ.edges.filter((e) => e.fromMatchId === "542273" || e.fromMatchId === "542274");
  assert.deepEqual(lr1.map((e) => [e.toMatchId, e.toSlot]), [["542276", undefined], ["542277", undefined]]);
  assert.equal(champ.edges.length, 11);
});

test("REAL · las aristas coinciden con los resultados reales del torneo (los ganadores ocupan el hueco anunciado)", () => {
  const conts = parseEventBrackets(CHAMPIONS_2025);
  const s = deriveBracketStructure(conts);
  const items = new Map(conts.flatMap((c) => c.columns).flatMap((col) => col.items).filter((i) => i.matchId).map((i) => [i.matchId!, i]));
  for (const e of s.edges) {
    if (!e.toMatchId) continue;
    const w = items.get(e.fromMatchId)!.teams.find((t) => t.winner)?.name;
    const dest = items.get(e.toMatchId)!;
    if (!w) continue;
    assert.ok(dest.teams.some((t) => t.name === w), `${w} juega ${e.toMatchId}`);
    if (e.toSlot) assert.equal(dest.teams[e.toSlot - 1].name, w, `${w} en el hueco ${e.toSlot} de ${e.toMatchId}`);
  }
});

test("REAL · lo que la página NO dice no se afirma: ni perdedores al cuadro bajo, ni Final Baja → Gran Final, ni reset", () => {
  const s = parseBracketStructure(CHAMPIONS_2025);
  assert.ok(s.edges.every((e) => e.source === "WINNER"), "solo ganadores");
  const lowerFinal = "542279", grandFinal = "542271";
  assert.ok(!s.edges.some((e) => e.fromMatchId === lowerFinal), "Lower Final → Grand Final está en otro contenedor: no se afirma");
  assert.ok(!s.edges.some((e) => e.toMatchId === grandFinal && e.fromMatchId !== "542270"), "solo Upper Final → GF si la página lo marca");
  assert.ok(!s.edges.some((e) => e.qualificationKey), "un playoff sin columna Qualified no tiene clasificación");
});

test("REAL · Champions 2026: clasificación antes de jugarse (Winner's → Qualified, Decider → Qualified), una por grupo y rama", () => {
  const s = parseBracketStructure(CHAMPIONS_2026);
  const quals = s.edges.filter((e) => e.qualificationKey);
  assert.equal(quals.length, 8);
  assert.deepEqual(quals.slice(0, 2).map((e) => [e.fromMatchId, e.qualificationKey, e.qualificationLabel]), [
    ["753446", "qualified:groupa:winners", "Qualified"], ["753448", "qualified:groupa:decider", "Qualified"],
  ]);
  // Opening → Winner's con huecos aunque no se haya jugado nada: es ESTRUCTURA, no resultado.
  assert.deepEqual(s.edges.filter((e) => e.toMatchId === "753446").map((e) => [e.fromMatchId, e.toSlot]), [["753444", 1], ["753445", 2]]);
  assert.equal(s.edges.length, 20);
});

/* ─────────────── SEGURIDAD ─────────────── */

test("SEGURO · sin markup de brackets → present=false, sin aristas, sin lanzar", () => {
  const s = parseBracketStructure("<html><body><h1>Un evento sin cuadro</h1></body></html>");
  assert.equal(s.present, false); assert.equal(s.edges.length, 0);
  assert.deepEqual(parseBracketStructure(""), { containers: [], edges: [], unknown: [], conflicts: [], present: false });
});

test("SEGURO · markup cambiado (sin líneas, sin hrefs) → cero aristas, nunca aristas falsas", () => {
  const sinLineas = CHAMPIONS_2025.replace(/bracket-item-line[^"]*/g, "bracket-item-nope");
  const a = parseBracketStructure(sinLineas);
  assert.ok(a.present); assert.equal(a.edges.length, 0);
  const sinHref = CHAMPIONS_2025.replace(/href="\/\d+\//g, 'href="/x/');
  const b = parseBracketStructure(sinHref);
  assert.equal(b.edges.length, 0);
});

test("SEGURO · alimentadores que no encajan (3 para 1) → transición desconocida, sin aristas", () => {
  const s = deriveBracketStructure([{ group: "X", side: "upper", columns: [
    { label: "R1", qualified: false, items: [1, 2, 3].map((i) => ({ matchId: `m${i}`, teams: [], line: "up" as const, empty: false })) },
    { label: "R2", qualified: false, items: [{ matchId: "m9", teams: [], empty: false }] },
  ] }]);
  assert.equal(s.edges.length, 0);
  assert.equal(s.unknown.length, 1);
});

test("SEGURO · una pareja cuyo ganador no juega el destino anunciado → conflicto, transición descartada", () => {
  const t = (name: string, winner = false) => ({ name, winner, loser: !winner && !!name });
  const s = deriveBracketStructure([{ group: "X", side: "upper", columns: [
    { label: "SF", qualified: false, items: [
      { matchId: "a", teams: [t("A", true), t("B")], line: "down", empty: false },
      { matchId: "b", teams: [t("C", true), t("D")], line: "up", empty: false },
    ] },
    { label: "F", qualified: false, items: [{ matchId: "f", teams: [t("A"), t("Z")], empty: false }] },
  ] }]);
  assert.equal(s.edges.length, 0);
  assert.equal(s.conflicts.length, 1);
  assert.match(s.conflicts[0], /«C»/);
});

test("SEGURO · autoarista y doble destino del mismo ganador se rechazan", () => {
  const s = deriveBracketStructure([{ group: "X", side: "upper", columns: [
    { label: "A", qualified: false, items: [{ matchId: "m1", teams: [], line: "up", empty: false }] },
    { label: "B", qualified: false, items: [{ matchId: "m1", teams: [], empty: false }] },
  ] }]);
  assert.equal(s.edges.length, 0);
  assert.ok(s.conflicts.some((c) => /autoarista/.test(c)));
});
