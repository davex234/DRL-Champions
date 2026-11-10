/**
 * PICK'EMS · CUADRO DE ELIMINATORIAS (Fase 24.3) — pruebas de presentación y de contrato.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { BracketMatchCard } from "./BracketMatch";
import { BracketRound } from "./BracketRound";
import { BracketStageTabs } from "./BracketStageTabs";
import { BracketPickemView } from "./BracketPickemView";
import { buildBracketModel, type BracketMatchInput, type StageLike } from "@/domain/pickems/bracket";
import type { PickemQuestion } from "@/lib/game/client";
import type { AnswerMap } from "@/domain/pickems/progress";

const html = (n: React.ReactElement): string => renderToStaticMarkup(n);
const src = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const NOW = Date.parse("2026-03-10T12:00:00Z");
const at = (h: number) => new Date(NOW + h * 3600_000).toISOString();
const PLAYOFF: StageLike[] = [{ id: "st-po", name: "Playoffs", kind: "playoff", order_idx: 1 }];
const mm = (id: string, over: Partial<BracketMatchInput> = {}): BracketMatchInput => ({
  id, stage_id: "st-po", team_a: null, team_b: null, start_time: at(24), status: "upcoming",
  score_a: null, score_b: null, round: null, match_order: null, ...over,
});
const fixture = (): BracketMatchInput[] => [
  mm("qf1", { team_a: "Team Heretics", team_b: "Karmine Corp", round: "Quarterfinal", match_order: 1, status: "finished", score_a: 2, score_b: 0, winner_team: "Team Heretics", start_time: at(-72) }),
  mm("qf2", { team_a: "Fnatic", team_b: "Team Liquid", round: "Quarterfinal", match_order: 2, status: "finished", score_a: 1, score_b: 2, winner_team: "Team Liquid", start_time: at(-48) }),
  mm("qf3", { team_a: "NRG", team_b: "Sentinels", round: "Quarterfinal", match_order: 3, status: "live", score_a: 1, score_b: 1, start_time: at(-1) }),
  mm("qf4", { team_a: "Gen.G", team_b: "DRX", round: "Quarterfinal", match_order: 4, start_time: at(24) }),
  mm("sf1", { team_a: "Team Heretics", team_b: "Team Liquid", round: "Semifinal", match_order: 5, start_time: at(72) }),
  mm("sf2", { round: "Semifinal", match_order: 6, start_time: at(96) }),
  mm("f", { round: "Final", match_order: 7, start_time: at(144) }),
];
const pq = (id: string, matchId: string | null, over: Partial<PickemQuestion> = {}): PickemQuestion => ({
  id, pickem_event_id: "e1", kind: "match_winner", match_id: matchId, prompt: "¿Quién gana?", points: 15,
  locks_at: at(24), order_idx: 0, locked: false, correct_option: null,
  options: [{ key: "a", label: "A" }, { key: "b", label: "B" }], ...over,
});
const questions = (): PickemQuestion[] => [
  pq("q1", "qf1", { locked: true, locks_at: at(-72), correct_option: "a" }),
  pq("q2", "qf2", { locked: true, locks_at: at(-48), correct_option: "b" }),
  pq("q3", "qf3", { locked: true, locks_at: at(-1) }),
  pq("q4", "qf4"),
  pq("q5", "sf1", { points: 20 }),
  pq("q6", "sf2"),
  pq("champ", null, { kind: "champion", prompt: "¿Quién será campeón?", points: 50, options: [{ key: "th", label: "Team Heretics" }, { key: "fnc", label: "Fnatic" }, { key: "tl", label: "Team Liquid" }, { key: "nrg", label: "NRG" }] }),
];
const answers = (): AnswerMap => ({
  q1: { option: "a", isCorrect: true, pointsAward: 15 },
  q2: { option: "a", isCorrect: false, pointsAward: 0 },
  q5: { option: "b", isCorrect: null, pointsAward: null },
});
const model = () => buildBracketModel({ stages: PLAYOFF, matches: fixture(), questions: questions(), answers: answers(), now: NOW });
const noop = () => undefined;
const card = (id: string, extra: Partial<Parameters<typeof BracketMatchCard>[0]> = {}) =>
  html(<BracketMatchCard m={model().matches[id]} roundLabel="Cuartos" onPick={noop} {...extra} />);

/* ─────────────── 7-8 · DATOS Y MARCADOR REALES ─────────────── */

test("MARCADOR · el resultado real se pinta tal cual y el ganador se resalta (barra + texto)", () => {
  const out = card("qf1");
  assert.match(out, /Team Heretics/); assert.match(out, /Karmine Corp/);
  assert.match(out, /aria-label="2"/); assert.match(out, /aria-label="0"/);
  assert.match(out, /bg-ok/, "el filo del ganador");
  assert.match(out, />Final</);
  const SRC = src("./BracketMatch.tsx");
  assert.ok(!/score_a\s*>\s*score_b|scoreA\s*>\s*scoreB/.test(SRC), "el ganador no se deduce del marcador en el cliente");
});

test("EN JUEGO · se destaca con insignia; un partido futuro muestra hora y fecha", () => {
  assert.match(card("qf3"), /En juego/);
  assert.match(card("qf4", { m: { ...model().matches.qf4, questionId: null, lockState: "none" } }), /\d{2}:\d{2} · \d+ /);
});

/* ─────────────── 9-10 · TBD ─────────────── */

test("TBD · «Por definir» en los dos huecos, sin botones y sin predicción posible", () => {
  const out = card("sf2");
  assert.equal((out.match(/Por definir/g) ?? []).length >= 2, true);
  assert.ok(!/<button/.test(out), "no se puede elegir");
  assert.match(out, /sin predicción hasta que haya equipos/);
});

/* ─────────────── 11-17 · ESTADOS ─────────────── */

test("ABIERTO · las dos filas son <button> con aria-label «Seleccionar X como ganador frente a Y» y +pts del servidor", () => {
  const out = card("sf1");
  assert.equal((out.match(/<button/g) ?? []).length, 2);
  assert.match(out, /aria-label="Seleccionar Team Heretics como ganador frente a Team Liquid"/);
  assert.match(out, /aria-label="Seleccionar Team Liquid como ganador frente a Team Heretics"/);
  assert.match(out, /\+20 pts/, "los puntos son los de la pregunta");
});

test("SELECTED · la fila elegida lleva aria-pressed y «Tu pick»", () => {
  const out = card("sf1");
  assert.match(out, /aria-pressed="true"/); assert.match(out, /aria-pressed="false"/);
  assert.match(out, /Tu pick: <b[^>]*>Team Liquid/);
});

test("LOCKED · elección visible, sin botones", () => {
  const out = card("qf3");
  assert.ok(!/<button/.test(out));
  assert.match(out, /Sin predicción · Cerrada|Bloqueada/);
});

test("CORRECT / INCORRECT / NO PICK · con texto y marca dibujada, y puntos del corrector", () => {
  const hit = card("qf1");
  assert.match(hit, /Acertada · \+15 pts/); assert.match(hit, /data-state="acertada"/); assert.match(hit, /M2 6\.4/);
  const miss = card("qf2");
  assert.match(miss, /Fallada · \+0 pts/); assert.match(miss, /data-state="fallada"/); assert.match(miss, /M3 3l6 6/);
  const none = card("qf3");
  assert.match(none, /Sin predicción/);
});

test("READONLY (historial) · sin botones aunque la pregunta esté abierta; la selección sigue visible", () => {
  const out = card("sf1", { readOnly: true });
  assert.ok(!/<button/.test(out));
  assert.match(out, /Tu pick: <b[^>]*>Team Liquid/);
  assert.match(out, /aria-current="true"/);
});

/* ─────────────── 12 · LA SELECCIÓN LLAMA A LA API EXISTENTE ─────────────── */

test("PICK · la caja llama a onPick(match, opción del servidor); la vista lo traduce al pick del hook (misma API)", () => {
  const view = src("./BracketPickemView.tsx");
  assert.match(view, /const q = m\.questionId \? qById\.get\(m\.questionId\) : null;\s*if \(q\) onPick\(q, option\);/);
  const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!/fetch\(|postJson\(|submitPick\(/.test(code(view)) && !/fetch\(|postJson\(|submitPick\(/.test(code(src("./BracketMatch.tsx"))), "ninguna llamada propia: todo pasa por usePickem → /api/pickems");
  const matchSrc = src("./BracketMatch.tsx");
  assert.match(matchSrc, /onClick=\{\(\) => option && onPick\?\.\(m, option\)\}/, "solo la clave de opción del servidor");
});

/* ─────────────── 19-22 · CONECTORES ─────────────── */

test("CONECTORES · solo dibujan aristas del modelo; sin aristas no hay SVG; son decorativos", () => {
  const SRC = src("./BracketConnector.tsx");
  assert.match(SRC, /if \(lines\.length === 0\) return null;/);
  assert.match(SRC, /aria-hidden/);
  assert.match(SRC, /for \(const e of edges\)/, "una línea por arista verificada, nunca por partido");
  assert.match(SRC, /strokeDasharray=\{l\.source === "LOSER"/, "perdedor en discontinua");
  assert.ok(!/canvas/i.test(SRC));
});

/* ─────────────── 23-27 · LAYOUT, SCROLL, MÓVIL, TECLADO, LECTOR ─────────────── */

test("DESKTOP · rondas en columnas dentro de un área desplazable propia, con fundidos y navegación por rondas", () => {
  const SRC = src("./TournamentBracket.tsx");
  assert.match(SRC, /overflow-x-auto/);
  assert.match(SRC, /data-bracket-mode="desktop"/);
  assert.match(SRC, /bg-gradient-to-r from-base-900/);
  assert.match(SRC, /root\.scrollTo\(\{ left: el\.offsetLeft/);
  assert.match(SRC, /Cuadro bajo/, "doble eliminación: fila inferior");
});

test("MÓVIL · selector de ronda + tarjetas verticales, sin duplicar el cuadro en el DOM", () => {
  const SRC = src("./TournamentBracket.tsx");
  assert.match(SRC, /useIsNarrow\(\)/);
  assert.match(SRC, /narrow \? \(/);
  assert.match(SRC, /data-bracket-mode="mobile"/);
  assert.ok(!/hidden md:block|md:hidden/.test(SRC), "una sola versión montada, no dos escondidas con CSS");
});

test("TECLADO · filas, navegación de rondas y pestañas de fase son <button> nativos con foco visible", () => {
  const round = html(<BracketRound column={{ round: model().rounds[1], matches: [model().matches.sf1] }} saving={null} feedback={null} onPick={noop} />);
  assert.match(round, /<button type="button"/); assert.match(round, /nx-focus/);
  const tabs = html(<BracketStageTabs stages={[{ id: "a", name: "Grupos", kind: "group", bracket: false, roundIds: [] }, { id: "b", name: "Playoffs", kind: "playoff", bracket: true, roundIds: [] }]} selected="b" onSelect={noop} />);
  assert.equal((tabs.match(/<button/g) ?? []).length, 2); assert.match(tabs, /aria-pressed="true"/);
  assert.match(src("./TournamentBracket.tsx"), /aria-pressed=\{on\}/);
});

test("LECTOR DE PANTALLA · section + h3 por ronda, article por partido con etiqueta legible", () => {
  const round = html(<BracketRound column={{ round: model().rounds[0], matches: [model().matches.qf1, model().matches.qf2] }} saving={null} feedback={null} />);
  assert.match(round, /<section id="bracket-[^"]+" aria-label="Quarterfinal"/);
  assert.match(round, /<h3/);
  assert.match(round, /<article[^>]*aria-label="Quarterfinal: Team Heretics contra Karmine Corp"/);
  assert.match(round, /4 partidos|2 partidos/);
});

test("REDUCED MOTION · la entrada del cuadro y el pulso de selección son animaciones CSS bajo la regla global", () => {
  const css = readFileSync(new URL("../../../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /nx-bracket-enter/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(src("./BracketMatch.tsx"), /motion-reduce:transition-none/);
});

/* ─────────────── 29 · SIN N+1 ─────────────── */

test("SIN N+1 · partidos y fases vienen en el lote de usePickem (una lectura cada uno), no por caja ni por logo", () => {
  const hook = readFileSync(new URL("../../../lib/usePickem.ts", import.meta.url), "utf8");
  assert.match(hook, /fetchMatches\(event\.event_id\)/);
  assert.match(hook, /fetchStages\(event\.event_id\)/);
  for (const f of ["./BracketMatch.tsx", "./BracketRound.tsx", "./TournamentBracket.tsx", "./BracketConnector.tsx"]) {
    assert.ok(!/fetch|from\("/.test(src(f)), `${f} no lee nada por su cuenta`);
  }
  assert.ok(!/setInterval/.test(src("./BracketMatch.tsx")), "la cuenta atrás usa el reloj compartido");
});

/* ─────────────── 30-33 · VISTA, CAMPEÓN, HISTORIAL ─────────────── */

test("VISTA · el campeón convive con el cuadro (misma pregunta), y la liga sigue por su vista", () => {
  const out = html(<BracketPickemView model={model()} questions={questions()} answers={answers()} now={NOW} saving={null} feedback={null} canPick onPick={noop} />);
  assert.match(out, /data-view="bracket"/);
  assert.match(out, /Quién será campeón/);
  assert.equal((out.match(/data-kind="champion"/g) ?? []).length, 1, "no se duplica la pregunta de campeón");
  assert.match(out, /data-match-id="qf1"/);
  const page = readFileSync(new URL("../../../app/pickems/page.tsx", import.meta.url), "utf8");
  assert.match(page, /useBracket && model \? \(/);
  assert.match(page, /data-view="league"/, "la liga mantiene el tablero de 24.2");
  assert.match(page, /isBracketFormat\(model\.format\) && model\.reliable/);
});

test("HISTORIAL · el detalle enseña el cuadro en solo lectura", () => {
  const page = readFileSync(new URL("../../../app/pickems/historial/[id]/page.tsx", import.meta.url), "utf8");
  assert.match(page, /<BracketPickemView[\s\S]*?readOnly[\s\S]*?showResolved/);
  const out = html(<BracketPickemView model={model()} questions={questions()} answers={answers()} now={NOW} saving={null} feedback={null} canPick={false} readOnly showResolved onPick={noop} />);
  assert.ok(!/Seleccionar /.test(out), "sin botones de selección");
  assert.match(out, /Acertada · \+15 pts/); assert.match(out, /Fallada · \+0 pts/);
});

test("PROGRESO 24.2 · el pick del cuadro es una respuesta más: el progreso lo cuenta el mismo dominio", () => {
  const hero = readFileSync(new URL("../PickemHero.tsx", import.meta.url), "utf8");
  assert.match(hero, /progressOf\(questions, answers, now\)/, "no hay un progreso aparte para el cuadro");
});

test("SAVING · una caja sin pregunta nunca dice «Guardando…» aunque no haya envío en curso (null === null)", () => {
  const out = html(<BracketRound column={{ round: model().rounds[2], matches: [model().matches.f] }} saving={null} feedback={null} onPick={noop} />);
  assert.ok(!/Guardando/.test(out));
});

test("MÓVIL · con el reparto estrecho forzado se monta el selector de ronda y una sola ronda, sin la versión de escritorio", () => {
  const out = html(<BracketPickemView model={model()} questions={questions()} answers={answers()} now={NOW} saving={null} feedback={null} canPick onPick={noop} bracketMode="mobile" />);
  assert.match(out, /data-bracket-mode="mobile"/);
  assert.ok(!/data-bracket-mode="desktop"/.test(out));
  assert.equal((out.match(/<section id="bracket-/g) ?? []).length, 1, "una sola ronda montada a la vez");
  const desk = html(<BracketPickemView model={model()} questions={questions()} answers={answers()} now={NOW} saving={null} feedback={null} canPick onPick={noop} bracketMode="desktop" />);
  assert.equal((desk.match(/<section id="bracket-/g) ?? []).length, 3, "en escritorio, todas las columnas");
});
