/**
 * FASE 51 · TACTICAL COACH 4.0 — dominio: la puerta de las composiciones, el roster activo y el
 * historial de edición de la pizarra (deshacer / rehacer).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateCompositionPayload, sanitizeComposition } from "./composition";
import { TACTICAL_AGENTS, isSelectableAgentId, isKnownAgentId, searchAgents } from "./roster";
import {
  createHistory, commit, undo, redo, canUndo, canRedo, historyShortcut, HISTORY_LIMIT, COALESCE_MS,
} from "./history";

const REALES = ["jett", "omen", "sova", "killjoy", "kayo"];
const LEGADO = ["veil", "haze", "probe", "pulse", "spear", "blitz", "warden", "tripwire", "specter", "echo"];
const base = { name: "__QA__", mapId: "ascent", notes: "" };
const codes = (raw: unknown) => validateCompositionPayload(raw).map((i) => i.code);

/* ═══════════ BUG 1 · COMPOSICIONES ═══════════ */

test("F51 C1 · composición completa de agentes reales → sin rechazos", () => {
  assert.deepEqual(codes({ ...base, agentIds: REALES }), []);
});

test("F51 C2 · incompleta sigue sin ser error (es un estado)", () => {
  assert.deepEqual(codes({ ...base, agentIds: ["jett", "omen"] }), []);
  assert.deepEqual(codes({ ...base }), []);
});

test("F51 C3 · agente inexistente → UNKNOWN_AGENT (antes se descartaba en silencio)", () => {
  assert.deepEqual(codes({ ...base, agentIds: ["jett", "no-existe"] }), ["UNKNOWN_AGENT"]);
});

test("F51 C4 · cada uno de los diez del legado → LEGACY_AGENT", () => {
  for (const id of LEGADO) {
    assert.equal(isKnownAgentId(id), true, `${id} se sigue LEYENDO (jugadas antiguas)`);
    assert.deepEqual(codes({ ...base, agentIds: [id] }), ["LEGACY_AGENT"], id);
  }
  // La composición que la auditoría consiguió guardar: cinco ficticios.
  assert.equal(codes({ ...base, agentIds: ["veil", "haze", "probe", "pulse", "spear"] }).length, 5);
});

test("F51 C5 · repetidos y más de cinco → rechazados (reglas ya existentes)", () => {
  assert.deepEqual(codes({ ...base, agentIds: ["jett", "jett"] }), ["DUPLICATE_AGENT"]);
  assert.ok(codes({ ...base, agentIds: [...REALES, "reyna"] }).includes("TOO_MANY_AGENTS"));
});

test("F51 C6 · payload manipulado → INVALID_PAYLOAD, nunca un 500 ni un guardado a medias", () => {
  for (const raw of [null, "texto", 42, [], { ...base, agentIds: "jett" }, { ...base, agentIds: [1, 2] }, { ...base, name: 7 }, { ...base, agentIds: [{ id: "jett" }] }]) {
    assert.ok(codes(raw).includes("INVALID_PAYLOAD"), JSON.stringify(raw));
  }
});

test("F51 C7 · la limpieza sigue tolerando lo guardado (leer no rompe), pero la API valida antes", () => {
  // Leer una composición antigua no la destruye…
  assert.deepEqual(sanitizeComposition({ ...base, agentIds: ["veil", "jett"] }).agentIds, ["veil", "jett"]);
  // …y la API rechaza guardarla: valida el cuerpo CRUDO antes de limpiar.
  const api = require("node:fs").readFileSync(require("node:path").join(process.cwd(), "src/app/api/game/compositions/route.ts"), "utf8") as string;
  const iVal = api.indexOf("validateCompositionPayload(crudo)");
  const iSan = api.indexOf("sanitizeComposition(entrada)");
  assert.ok(iVal > 0 && iSan > iVal, "la validación del crudo va ANTES de limpiar");
});

/* ═══════════ ROSTER ACTIVO ═══════════ */

test("F51 R1 · 29 agentes reales: 8 duelistas, 7 iniciadores, 7 controladores, 7 centinelas", () => {
  assert.equal(TACTICAL_AGENTS.length, 29);
  const por = (r: string) => TACTICAL_AGENTS.filter((a) => a.role === r).length;
  assert.deepEqual([por("duelist"), por("initiator"), por("controller"), por("sentinel")], [8, 7, 7, 7]);
  for (const a of TACTICAL_AGENTS) assert.equal(isSelectableAgentId(a.id), true, a.id);
});

test("F51 R2 · 0 agentes ficticios seleccionables ni buscables en el entrenador", () => {
  for (const id of LEGADO) assert.equal(isSelectableAgentId(id), false, id);
  const todos = searchAgents("");
  assert.equal(todos.length, 29);
  assert.ok(!todos.some((a) => LEGADO.includes(a.id)));
});

/* ═══════════ UNDO / REDO ═══════════ */

test("F51 H1 · deshacer y rehacer recorren las instantáneas en orden", () => {
  let h = createHistory("a");
  h = commit(h, "b", { now: 0 });
  h = commit(h, "c", { now: 5000 });
  assert.equal(h.present, "c");
  h = undo(h); assert.equal(h.present, "b");
  h = undo(h); assert.equal(h.present, "a");
  assert.equal(canUndo(h), false);
  h = redo(h); assert.equal(h.present, "b");
  h = redo(h); assert.equal(h.present, "c");
  assert.equal(canRedo(h), false);
});

test("F51 H2 · una edición nueva tras deshacer borra el futuro", () => {
  let h = commit(commit(createHistory(1), 2, { now: 0 }), 3, { now: 5000 });
  h = undo(h);
  h = commit(h, 9, { now: 10000 });
  assert.equal(canRedo(h), false);
  assert.deepEqual(h.past, [1, 2]);
});

test("F51 H3 · límite: nunca más de HISTORY_LIMIT entradas hacia atrás", () => {
  let h = createHistory(0);
  for (let i = 1; i <= HISTORY_LIMIT + 40; i++) h = commit(h, i, { now: i * 10_000 });
  assert.equal(h.past.length, HISTORY_LIMIT);
  assert.equal(h.past[0], 40, "se descartan las más antiguas");
});

test("F51 H4 · un arrastre (misma clave, seguido) es UNA entrada; otra clave o una pausa, otra", () => {
  let h = createHistory({ x: 0 });
  for (let i = 1; i <= 50; i++) h = commit(h, { x: i }, { key: "move:p0", now: i * 16 });
  assert.equal(h.past.length, 1, "cincuenta pointermove = un deshacer");
  h = commit(h, { x: 99 }, { key: "move:p1", now: 900 });
  assert.equal(h.past.length, 2);
  h = commit(h, { x: 100 }, { key: "move:p1", now: 900 + COALESCE_MS + 1 });
  assert.equal(h.past.length, 3);
  assert.equal(undo(h).present.x, 99);
});

test("F51 H5 · el mismo objeto no genera entrada; deshacer no toca nada fuera del historial", () => {
  const s = { a: 1 };
  const h = createHistory(s);
  assert.equal(commit(h, s), h);
  assert.equal(undo(h), h);
  assert.equal(redo(h), h);
});

test("F51 H6 · atajos: Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl+Y; nunca dentro de un campo de texto", () => {
  const ev = (o: Partial<Parameters<typeof historyShortcut>[0]>) => historyShortcut({ key: "z", ctrlKey: false, metaKey: false, shiftKey: false, ...o });
  assert.equal(ev({ ctrlKey: true }), "undo");
  assert.equal(ev({ metaKey: true }), "undo");
  assert.equal(ev({ ctrlKey: true, shiftKey: true }), "redo");
  assert.equal(ev({ metaKey: true, shiftKey: true, key: "Z" }), "redo");
  assert.equal(ev({ ctrlKey: true, key: "y" }), "redo");
  assert.equal(ev({}), null, "sin modificador no es un atajo");
  for (const tagName of ["INPUT", "TEXTAREA", "SELECT"]) assert.equal(ev({ ctrlKey: true, target: { tagName } }), null, tagName);
  assert.equal(ev({ ctrlKey: true, target: { tagName: "DIV", isContentEditable: true } }), null);
});
