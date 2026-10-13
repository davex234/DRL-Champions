/**
 * PICK'EMS · EL MODO COMPLETO (Fase 24.2) — pruebas de presentación y de contrato.
 *
 * Renderizado estático (sin red, sin navegador) de las piezas nuevas —héroe, tablero,
 * pregunta, resultados, recompensas, selector— y comprobaciones de CONTRATO sobre el
 * código fuente: que nada del cliente calcule puntos, que el guardado sea uno a la vez, que
 * las opciones sean solo las del servidor, que no exista un botón de reclamar.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { PickQuestion } from "./PickQuestion";
import { PickemBoard } from "./PickemBoard";
import { PickemResults } from "./PickemResults";
import { PickemRewards, tierStatuses } from "./PickemRewards";
import { PickemHero } from "./PickemHero";
import { EventSwitcher } from "./EventSwitcher";
import { LeaderboardTable } from "./TournamentLeaderboard";
import type { PickemQuestion, TournamentRankingRow, LedgerRow } from "@/lib/game/client";
import type { MyAnswer } from "@/domain/pickems/progress";

const html = (n: React.ReactElement): string => renderToStaticMarkup(n);
const src = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const NOW = Date.parse("2026-03-01T12:00:00Z");
const future = (h: number) => new Date(NOW + h * 3600_000).toISOString();
const past = (h: number) => new Date(NOW - h * 3600_000).toISOString();

const q = (over: Partial<PickemQuestion> = {}): PickemQuestion => ({
  id: "q1", pickem_event_id: "e1", kind: "match_winner", match_id: "m1", prompt: "¿Quién gana Fnatic vs NRG?",
  options: [{ key: "a", label: "Fnatic" }, { key: "b", label: "NRG" }],
  points: 25, locks_at: future(2), order_idx: 0, locked: false, correct_option: null, ...over,
});
const champion = (): PickemQuestion => q({
  id: "champ", kind: "champion", match_id: null, prompt: "¿Quién será campeón?", points: 50, order_idx: -1,
  options: [
    { key: "fnatic", label: "Fnatic" }, { key: "nrg", label: "NRG" },
    { key: "team-heretics", label: "Team Heretics" }, { key: "team-liquid", label: "Team Liquid" },
  ],
});
const advance = (): PickemQuestion => q({
  id: "adv", kind: "advance", match_id: null, prompt: "¿Quién avanza del Grupo A?", points: 30,
  options: [{ key: "fnatic", label: "Fnatic" }, { key: "nrg", label: "NRG" }],
});
const ans = (option: string, isCorrect: boolean | null = null, pointsAward: number | null = null): MyAnswer =>
  ({ option, isCorrect, pointsAward });
const noop = () => undefined;

const render = (question: PickemQuestion, mine?: MyAnswer, extra: Partial<Parameters<typeof PickQuestion>[0]> = {}) =>
  html(<PickQuestion q={question} mine={mine} now={NOW} saving={false} disabled={false} onPick={noop} {...extra} />);

/* ─────────────── TIPOS DE PREDICCIÓN ─────────────── */

test("MATCH_WINNER · sigue funcionando: dos bandos con VS, opciones del servidor, puntos del servidor", () => {
  const out = render(q());
  assert.match(out, /Fnatic/); assert.match(out, /NRG/); assert.match(out, />vs</);
  assert.match(out, /\+25/, "puntos potenciales = q.points");
  assert.match(out, /Pendiente/);
});

test("CHAMPION · se representa como destacada, con todos los participantes y sus puntos propios", () => {
  const out = render(champion(), undefined, { featured: true });
  assert.match(out, /Quién será campeón/);
  assert.match(out, /Campeón/, "etiqueta del tipo");
  for (const o of champion().options) assert.match(out, new RegExp(o.label));
  assert.match(out, /\+50/, "los puntos son los de la pregunta, no una constante");
  assert.ok(!/>vs</.test(out), "con más de dos opciones no hay VS: es una rejilla");
});

test("ADVANCE · se representa con su etiqueta y sus opciones del servidor", () => {
  const out = render(advance());
  assert.match(out, /Clasificación/);
  assert.match(out, /Quién avanza del Grupo A/);
  assert.match(out, /\+30/);
});

test("OPCIONES · solo se pintan las del servidor: ninguna opción inventada", () => {
  const out = render(q({ prompt: "¿Quién gana?", options: [{ key: "x", label: "Equipo X" }, { key: "y", label: "Equipo Y" }] }));
  const botones = out.match(/<button/g)?.length ?? 0;
  assert.equal(botones, 2, "un botón por opción del servidor");
  assert.ok(!/Fnatic|NRG/.test(out), "no aparece nada que no venga en `options`");
});

/* ─────────────── ESTADOS ─────────────── */

test("ESTADOS · pendiente, elegido, bloqueada, sin predicción, acertada, fallada — con TEXTO", () => {
  assert.match(render(q()), /Pendiente/);
  const elegido = render(q(), ans("a"));
  assert.match(elegido, /Elegido/); assert.match(elegido, /Tu elección/); assert.match(elegido, /aria-pressed="true"/);
  const bloqueada = render(q({ locked: true, locks_at: past(1) }), ans("a"));
  assert.match(bloqueada, /Bloqueada/); assert.match(bloqueada, /pendiente del resultado/);
  const sinPred = render(q({ locked: true, locks_at: past(1) }));
  assert.match(sinPred, /Sin predicción/); assert.match(sinPred, /Cerrada/);
  const acertada = render(q({ locked: true, locks_at: past(1), correct_option: "a" }), ans("a", true, 25));
  assert.match(acertada, /Acertada/); assert.match(acertada, /\+25/); assert.match(acertada, /Sumaste 25 puntos/);
  const fallada = render(q({ locked: true, locks_at: past(1), correct_option: "a" }), ans("b", false, 0));
  assert.match(fallada, /Fallada/); assert.match(fallada, /\+0/); assert.match(fallada, /Resultado/);
});

test("ESTADOS · no dependen solo del color: llevan marca dibujada (svg) e insignia con palabra", () => {
  const acertada = render(q({ locked: true, locks_at: past(1), correct_option: "a" }), ans("a", true, 25));
  assert.match(acertada, /<svg/, "marca dibujada");
  assert.match(acertada, /data-state="acertada"/);
  const fallada = render(q({ locked: true, locks_at: past(1), correct_option: "a" }), ans("b", false, 0));
  assert.match(fallada, /data-state="fallada"/);
  assert.match(fallada, /M3 3l6 6/, "la cruz de fallo está dibujada, no es solo rojo");
});

test("PUNTOS OBTENIDOS · salen de `points_award` del corrector; sin él se marcan pendientes", () => {
  const conCorrector = render(q({ locked: true, locks_at: past(1), correct_option: "a", points: 25 }), ans("a", true, 40));
  assert.match(conCorrector, /\+40/, "lo que el corrector concedió, aunque difiera de q.points");
  const sinCorrector = render(q({ locked: true, locks_at: past(1), correct_option: "a" }), ans("a"));
  assert.match(sinCorrector, /pendiente de sumar/);
});

test("LOCK · cerrada por el servidor o por el reloj: los botones se deshabilitan", () => {
  const porServidor = render(q({ locked: true, locks_at: future(1) }));
  assert.ok(!/<button[^>]*(?<!disabled=""[^>]*)>/.test(porServidor) || /disabled=""/.test(porServidor));
  assert.equal((porServidor.match(/disabled=""/g) ?? []).length, 2);
  const porReloj = render(q({ locked: false, locks_at: past(0.01) }));
  assert.equal((porReloj.match(/disabled=""/g) ?? []).length, 2, "al llegar a cero se apaga en cliente");
  const abierta = render(q());
  assert.equal((abierta.match(/disabled=""/g) ?? []).length, 0);
});

test("SOLO LECTURA (historial) · no se puede elegir aunque siga abierta", () => {
  const out = render(q(), ans("a"), { readOnly: true });
  assert.equal((out.match(/disabled=""/g) ?? []).length, 2);
  assert.match(out, /Tu elección: <b[^>]*>Fnatic/);
});

test("FEEDBACK · Guardando… / Predicción guardada / Error al guardar, en una región aria-live", () => {
  const base = { questionId: "q1" } as const;
  const saving = render(q(), ans("a"), { saving: true, feedback: { ...base, kind: "saving", message: "Guardando…" } });
  assert.match(saving, /aria-live="polite"/); assert.match(saving, /Guardando…/);
  const saved = render(q(), ans("a"), { feedback: { ...base, kind: "saved", message: "Predicción guardada" } });
  assert.match(saved, /Predicción guardada/); assert.match(saved, /nx-pick-pop/, "microinteracción al confirmar");
  const err = render(q(), ans("a"), { feedback: { ...base, kind: "error", message: "Error al guardar · red" } });
  assert.match(err, /Error al guardar/);
});

/* ─────────────── HÉROE, PROGRESO, POSICIÓN ─────────────── */

const ranking = (n: number, me?: number): TournamentRankingRow[] => Array.from({ length: n }, (_, i) => ({
  user_id: me === i ? "me" : `u${i}`, username: me === i ? "Yo" : `P${i}`, avatar: "🦊",
  points: 1000 - i * 10, correct: 12, total: 15,
}));

test("HÉROE · progreso respondidas/total y porcentaje, sin hardcodear", () => {
  const qs = [q({ id: "a" }), q({ id: "b" }), q({ id: "c" }), q({ id: "d", locked: true, locks_at: past(1) })];
  const out = html(<PickemHero name="VCT EMEA" phase="activo" questions={qs} answers={{ a: ans("a"), b: ans("b") }}
    score={null} ranking={[]} userId="me" now={NOW} />);
  assert.match(out, /2 \/ 4/); assert.match(out, /50% completado/);
  assert.match(out, /1 pendientes|1 pendiente/); assert.match(out, /1 cerradas sin responder/);
  assert.match(out, /aria-valuenow="50"/);
});

test("HÉROE · mi posición viene del orden del servidor; sin puntuación, «Sin clasificar», nunca #0", () => {
  const con = html(<PickemHero name="X" phase="activo" questions={[q()]} answers={{}}
    score={{ points: 1240, correct: 12, total: 15 }} ranking={ranking(30, 23)} userId="me" now={NOW} />);
  assert.match(con, /#24/); assert.match(con, /1\.240/); assert.match(con, />12</);
  const sin = html(<PickemHero name="X" phase="activo" questions={[q()]} answers={{}} score={null} ranking={[]} userId="me" now={NOW} />);
  assert.match(sin, /Sin clasificar/); assert.ok(!/#0/.test(sin));
});

test("HÉROE · el CTA de pendientes y la cuenta atrás del siguiente cierre", () => {
  const out = html(<PickemHero name="X" phase="activo" questions={[q({ id: "a" }), q({ id: "b" })]} answers={{}}
    score={null} ranking={[]} userId="me" now={NOW} onGoPending={noop} />);
  assert.match(out, /2 predicciones pendientes/);
  assert.match(out, /Siguiente cierre/);
});

/* ─────────────── TABLERO ─────────────── */

test("TABLERO · destacada, pendientes, tus elecciones, en juego; ninguna pregunta se pierde", () => {
  const qs = [champion(), q({ id: "p" }), q({ id: "e" }), q({ id: "j", locked: true, locks_at: past(1) }), q({ id: "r", locked: true, locks_at: past(2), correct_option: "a" })];
  const out = html(<PickemBoard questions={qs} answers={{ e: ans("a"), j: ans("a"), r: ans("a", true, 25) }} now={NOW}
    saving={null} feedback={null} canPick onPick={noop} />);
  assert.match(out, /Predicción destacada/); assert.match(out, /Pendientes/); assert.match(out, /Tus elecciones/);
  assert.match(out, /En juego/); assert.match(out, /Corregidas/);
  assert.equal((out.match(/data-kind=/g) ?? []).length, qs.length);
  assert.match(out, /id="pickems-pendientes"/, "ancla para llevar al jugador a lo pendiente");
});

/* ─────────────── RESULTADOS ─────────────── */

test("RESULTADOS · tu predicción, el resultado y ACERTADA +N / FALLADA +0, leídos del corrector", () => {
  const qs = [
    q({ id: "r1", locked: true, locks_at: past(2), correct_option: "a", prompt: "Fnatic vs Heretics" }),
    q({ id: "r2", locked: true, locks_at: past(3), correct_option: "a", prompt: "G2 vs NRG" }),
  ];
  const out = html(<PickemResults questions={qs} answers={{ r1: ans("a", true, 25), r2: ans("b", false, 0) }} />);
  assert.match(out, /Tu predicción:/); assert.match(out, /Resultado:/);
  assert.match(out, /Acertada/); assert.match(out, /\+25/);
  assert.match(out, /Fallada/); assert.match(out, /\+0/);
  assert.match(out, /data-state="acertada"/); assert.match(out, /data-state="fallada"/);
});

/* ─────────────── RECOMPENSAS ─────────────── */

const ledger = (tier: string): LedgerRow => ({
  id: "t1", delta: 1500, reason: `pickem_reward:${tier}`, ref: `pickem:e1:${tier}`, balance_after: 9000, created_at: past(1),
});

test("RECOMPENSAS · CONSEGUIDA solo con el asiento real; alcanzada sin asiento; pendiente con lo que falta", () => {
  const rows = tierStatuses({ points: 55, correct: 3, total: 4 }, ledger("acertante"));
  assert.deepEqual(rows.map((r) => [r.tier.id, r.status]), [
    ["participacion", "conseguida"], ["acertante", "conseguida"], ["analista", "alcanzada"], ["oraculo", "pendiente"],
  ]);
  assert.equal(rows[3].missing, 35);
  const sin = tierStatuses(null, null);
  assert.ok(sin.every((r) => r.status === "pendiente"));
});

test("RECOMPENSAS · la UI las deriva de REWARD_TIERS y no tiene botón de reclamar", () => {
  const out = html(<PickemRewards score={{ points: 55, correct: 3, total: 4 }} reward={ledger("acertante")} />);
  assert.match(out, /Conseguida/); assert.match(out, /Alcanzada/); assert.match(out, /Te faltan 35 puntos/);
  assert.ok(!/<button|<a /.test(out), "no hay botón ni enlace de reclamar: no existe segundo flujo de reclamación");
  assert.match(out, /No hay nada que reclamar/);
  const SRC = src("./PickemRewards.tsx");
  assert.match(SRC, /REWARD_TIERS/, "lee la misma tabla que paga el servidor");
  assert.ok(!/fetch\(|\/api\//.test(SRC), "no llama a ningún endpoint: no concede nada");
});

/* ─────────────── SELECTOR ─────────────── */

test("SELECTOR · activos / próximos / finalizados, solo con torneos reales y accesible por teclado", () => {
  const out = html(<EventSwitcher selected="b" onSelect={noop} events={[
    { id: "a", name: "VCT EMEA", phase: "activo" }, { id: "b", name: "Masters", phase: "proximo" }, { id: "c", name: "Champions", phase: "finalizado", isDemo: true },
  ]} />);
  assert.match(out, /Activos/); assert.match(out, /Próximos/); assert.match(out, /Finalizados/);
  assert.match(out, /VCT EMEA/); assert.match(out, /Masters/); assert.match(out, /Champions/);
  assert.equal((out.match(/<button/g) ?? []).length, 3);
  assert.match(out, /aria-pressed="true"/);
  assert.match(out, /Viendo/);
});

/* ─────────────── CLASIFICACIÓN (24.1 sigue igual) ─────────────── */

test("CLASIFICACIÓN · top 10, mi fila fuera del top sin duplicar, y sin duplicar si ya estoy dentro", () => {
  const fuera = html(<LeaderboardTable rows={ranking(25, 20)} currentUserId="me" />);
  assert.equal((fuera.match(/<li/g) ?? []).length, 12, "10 + separador + la mía");
  assert.match(fuera, /#?21|>21</);
  const dentro = html(<LeaderboardTable rows={ranking(25, 4)} currentUserId="me" />);
  assert.equal((dentro.match(/<li/g) ?? []).length, 10, "ya estoy en el top: no se repite");
  assert.equal((dentro.match(/tú/g) ?? []).length, 1);
});

test("PRIVACIDAD · ni el héroe ni los resultados ni la clasificación exponen user_id o correo", () => {
  const hero = html(<PickemHero name="X" phase="activo" questions={[q()]} answers={{}} score={{ points: 1, correct: 0, total: 1 }} ranking={ranking(3, 1)} userId="me" now={NOW} />);
  assert.ok(!/user_id|@|u0|u2/.test(hero));
  const lb = html(<LeaderboardTable rows={ranking(3)} currentUserId="x" />);
  assert.ok(!/user_id|email/.test(lb));
});

/* ─────────────── ACCESIBILIDAD / MOTION ─────────────── */

test("TECLADO · las opciones son <button> nativos con aria-pressed y foco visible", () => {
  const out = render(q(), ans("a"));
  assert.match(out, /<button type="button"/);
  assert.match(out, /focus-visible:ring-2/);
  assert.match(out, /aria-pressed="true"/); assert.match(out, /aria-pressed="false"/);
});

test("REDUCED MOTION · las transiciones llevan motion-reduce y las animaciones caen bajo la regla global", () => {
  const out = html(<PickemHero name="X" phase="activo" questions={[q()]} answers={{}} score={null} ranking={[]} userId="me" now={NOW} />);
  assert.match(out, /motion-reduce:transition-none/);
  const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /nx-pick-pop/); assert.match(css, /nx-hit-glow/);
});

/* ─────────────── CONTRATOS DE FUENTE ─────────────── */

test("SERVER-AUTHORITY · ningún componente calcula puntos: leen q.points / points_award / pickem_scores", () => {
  for (const f of ["./PickQuestion.tsx", "./PickemResults.tsx", "./PickemHero.tsx", "./PickemBoard.tsx", "./PickemRewards.tsx"]) {
    const s = src(f);
    assert.ok(!/points\s*\+=|\.reduce\(\s*\(\s*\w+\s*,\s*\w+\s*\)\s*=>\s*\w+\s*\+\s*\w+\.points/.test(s), `${f} no acumula puntos`);
    assert.ok(!/=== q\.correct_option \? q\.points/.test(s), `${f} no puntúa comparando en cliente`);
  }
});

test("GUARDADO · un envío a la vez, solo opciones del servidor, optimista con confirmación, recarga si el servidor dice cerrada", () => {
  const hook = readFileSync(new URL("../../lib/usePickem.ts", import.meta.url), "utf8");
  assert.match(hook, /if \(savingRef\.current\) return;/, "doble submit bloqueado");
  assert.match(hook, /q\.options\.some\(\(o\) => o\.key === option\)/, "opción fuera de las del servidor: ni se intenta");
  assert.match(hook, /submitPick\(q\.id, option\)/, "escribe por /api/pickems");
  assert.match(hook, /kind: "saved", message: (?:t|tr|i18nT)\("Predicción guardada"\)/, "solo tras confirmar el servidor");
  assert.match(hook, /\/cerrad\/i\.test\(msg\)/, "si el servidor responde cerrada, se recarga");
  assert.ok(!/localStorage/.test(hook), "la caché no es localStorage ni fuente de verdad");
});

test("REFRESH · lo que se pinta tras recargar sale de pickem_answers, no de almacenamiento local", () => {
  const client = readFileSync(new URL("../../lib/game/client.ts", import.meta.url), "utf8");
  assert.match(client, /from\("pickem_answers"\)[\s\S]*?is_correct, points_award/, "lee lo que escribió el corrector");
  assert.ok(!/localStorage/.test(client));
});
