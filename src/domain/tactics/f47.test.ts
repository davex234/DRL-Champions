/**
 * FASE 47 · LO QUE PROTEGE LA PIZARRA TÁCTICA.
 *
 * Tests útiles, no relleno: se prueba lo que puede CORROMPER una jugada —coordenadas, identidad de
 * agente, mapa cruzado, orden de pasos— y lo que el encargo marca como invariante.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  validateComposition, sanitizeComposition, compositionImpact, classBreakdown, isComplete,
  COMPOSITION_SIZE,
} from "./composition";
import { TACTICAL_MAPS } from "./maps";
import { AGENTS } from "@/agents/catalog";
import { TACTICAL_AGENTS } from "./roster";
import {
  playbackReducer, playbackFrame, INITIAL_PLAYBACK, easeInOut, STEP_TRANSITION_MS,
} from "@/lib/tactics/playback";
import { canGoNativeFullscreen } from "@/lib/tactics/fullscreen";
import type { Strat, StratStep, PlayerToken } from "./strat";

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

const MAPA = TACTICAL_MAPS[0].id;
/* Agentes del roster REAL del juego (corrección de catálogo posterior a F48). */
const [A1, A2, A3, A4, A5, A6] = TACTICAL_AGENTS.map((a) => a.id);

/* ═══════════════ COMPOSICIONES ═══════════════ */

test("F47 · una composición válida son cinco agentes REALES de un mapa REAL", () => {
  const issues = validateComposition({ name: "Principal", mapId: MAPA, agentIds: [A1, A2, A3, A4, A5], notes: "" });
  assert.deepEqual(issues, []);
});

test("F47 · no se puede repetir un agente en la misma composición", () => {
  const issues = validateComposition({ name: "x", mapId: MAPA, agentIds: [A1, A1, A2, A3, A4], notes: "" });
  assert.ok(issues.some((i) => i.code === "DUPLICATE_AGENT"), "el duplicado se detecta");
});

test("F47 · un agente o un mapa que no existen se rechazan", () => {
  const a = validateComposition({ name: "x", mapId: MAPA, agentIds: ["notanagent"], notes: "" });
  assert.ok(a.some((i) => i.code === "UNKNOWN_AGENT"), "«notanagent» no existe");
  const m = validateComposition({ name: "x", mapId: "no-existe", agentIds: [A1], notes: "" });
  assert.ok(m.some((i) => i.code === "UNKNOWN_MAP"));
});

test("F47 · una composición a medias es VÁLIDA, pero no está completa", () => {
  const parcial = { name: "en curso", mapId: MAPA, agentIds: [A1, A2], notes: "" };
  assert.deepEqual(validateComposition(parcial), [], "se puede guardar a medias");
  assert.equal(isComplete(parcial), false);
  assert.equal(isComplete({ agentIds: [A1, A2, A3, A4, A5] }), true);
});

test("F47 · el saneado quita repetidos y basura, y nunca pasa de cinco", () => {
  const c = sanitizeComposition({
    name: "  Comp  ", mapId: MAPA,
    agentIds: [A1, A1, "notanagent", A2, A3, A4, A5, A6],
    notes: "n",
  });
  assert.equal(c.name, "Comp");
  assert.equal(c.agentIds.length, COMPOSITION_SIZE);
  assert.equal(new Set(c.agentIds).size, c.agentIds.length, "sin repetidos");
  assert.ok(!c.agentIds.includes("notanagent"), "sin agentes inventados");
});

test("F47 · NO se bloquea una composición por meta: cinco de la misma clase es legal", () => {
  const mismaClase = TACTICAL_AGENTS.filter((a) => a.role === TACTICAL_AGENTS[0].role).map((a) => a.id);
  const issues = validateComposition({ name: "x", mapId: MAPA, agentIds: mismaClase.slice(0, 2), notes: "" });
  assert.deepEqual(issues, [], "el criterio es del entrenador, no del sistema");
  const reparto = classBreakdown([A1, A2]);
  assert.equal(Object.values(reparto).reduce((a, b) => a + b, 0), 2, "el reparto se informa, no se impone");
});

/* ═══════════════ CAMBIAR LA COMPOSICIÓN NO PUEDE CORROMPER LA JUGADA ═══════════════ */

test("F47 · cambiar un agente AVISA en vez de convertir su utilidad en otra", () => {
  // La jugada usaba A1 y A2. La composición nueva se lleva A1 por delante.
  const impacto = compositionImpact([A1, A2], [A2, A3, A4]);
  assert.equal(impacto.safe, false);
  assert.deepEqual(impacto.removed, [A1], "se dice QUÉ se queda huérfano");
});

test("F47 · si la composición nueva conserva a todos, no hay nada que avisar", () => {
  assert.deepEqual(compositionImpact([A1, A2], [A1, A2, A3]), { removed: [], safe: true });
});

/* ═══════════════ REPRODUCCIÓN ═══════════════ */

const jugador = (id: string, x: number, y: number): PlayerToken =>
  ({ id, role: "Duelista", label: id, x, y } as PlayerToken);

const paso = (id: string, players: PlayerToken[]): StratStep => ({
  id, at: 0, label: id, notes: "",
  state: { players, utilities: [], drawings: [], annotations: [] },
});

const STRAT = {
  steps: [
    paso("s1", [jugador("p1", 0, 0), jugador("p2", 0.5, 0.5)]),
    paso("s2", [jugador("p1", 1, 1), jugador("p2", 0.5, 0.5)]),
    paso("s3", [jugador("p1", 0.2, 0.8)]),
  ],
} as Pick<Strat, "steps">;

test("F47 · la reproducción nunca se sale del rango de pasos", () => {
  let s = INITIAL_PLAYBACK;
  for (let i = 0; i < 20; i++) s = playbackReducer(s, { type: "next" }, 3);
  assert.equal(s.index, 2, "no pasa del último");
  for (let i = 0; i < 20; i++) s = playbackReducer(s, { type: "prev" }, 3);
  assert.equal(s.index, 0, "ni baja del primero");
});

test("F47 · llegar al final PARA la reproducción (no vuelve al principio solo)", () => {
  let s = { index: 2, playing: true, progress: 1 };
  s = playbackReducer(s, { type: "next" }, 3);
  assert.equal(s.playing, false, "un bucle sorprendería a quien está explicando");
  assert.equal(s.index, 2);
});

test("F47 · dar a reproducir desde el final vuelve a empezar", () => {
  const s = playbackReducer({ index: 2, playing: false, progress: 1 }, { type: "play" }, 3);
  assert.deepEqual(s, { index: 0, playing: true, progress: 0 });
});

test("F47 · las fichas se INTERPOLAN entre pasos, y a mitad están a mitad de camino", () => {
  const f = playbackFrame(STRAT, { index: 1, playing: false, progress: 0.5 });
  const p1 = f.players.find((p) => p.id === "p1")!;
  // easeInOut(0.5) === 0.5 exacto, así que a mitad de transición está en el punto medio.
  assert.equal(easeInOut(0.5), 0.5);
  assert.ok(Math.abs(p1.x - 0.5) < 1e-9 && Math.abs(p1.y - 0.5) < 1e-9, "va de (0,0) a (1,1)");
});

test("F47 · emparejar por ID, no por posición: una ficha nueva NO viaja desde la nada", () => {
  // En s3 sólo queda p1; p2 desapareció. p1 debe interpolar desde su sitio en s2, no desde el de p2.
  const f = playbackFrame(STRAT, { index: 2, playing: false, progress: 0 });
  const p1 = f.players.find((p) => p.id === "p1")!;
  assert.ok(Math.abs(p1.x - 1) < 1e-9, "arranca donde estaba en el paso anterior");
});

test("F47 · la reproducción NO muta el plan guardado", () => {
  const antes = JSON.stringify(STRAT);
  playbackFrame(STRAT, { index: 1, playing: true, progress: 0.3 });
  playbackFrame(STRAT, { index: 2, playing: true, progress: 0.9 });
  assert.equal(JSON.stringify(STRAT), antes, "presentar una jugada no puede estropearla");
});

test("F47 · la transición dura lo que pide el encargo (300–700 ms)", () => {
  assert.ok(STEP_TRANSITION_MS >= 300 && STEP_TRANSITION_MS <= 700, `${STEP_TRANSITION_MS} ms`);
});

/* ═══════════════ PANTALLA COMPLETA ═══════════════ */

test("F47 · sin Fullscreen API se cae al modo FOCUS, no se rompe", () => {
  const falso = { fullscreenEnabled: false } as unknown as Document;
  assert.equal(canGoNativeFullscreen(falso), false, "se detecta y quien llama usa el respaldo");
});

/* ═══════════════ COORDENADAS Y AUTORIDAD ═══════════════ */

test("F47 · NO se persisten coordenadas absolutas en el modelo táctico", () => {
  const strat = code(read("src", "domain", "tactics", "strat.ts"));
  assert.ok(!/left:\s*\d+px|top:\s*\d+px/.test(strat), "nada de píxeles en los datos");
  // El contrato: x/y son números normalizados del propio modelo.
  assert.match(strat, /export interface Point \{\s*x: number;\s*y: number;/);
});

test("F47 · el servidor valida el mapa cruzado: una jugada de un mapa no entra en otra partida", () => {
  const ruta = code(read("src", "app", "api", "game", "match-strats", "route.ts"));
  assert.match(ruta, /mapaPartida && mapaPartida !== mapaJugada/, "se compara mapa de partida y de jugada");
  assert.match(ruta, /status: 409|, 409\)/, "y se rechaza");
  // La autoridad sale del Bearer, nunca del cuerpo.
  assert.ok(!/body\.userId/.test(ruta), "el usuario no viaja en el cuerpo");
  assert.match(ruta, /getSession\(req\)/);
});

test("F47 · las composiciones se validan en el SERVIDOR, no sólo escondiendo botones", () => {
  const ruta = code(read("src", "app", "api", "game", "compositions", "route.ts"));
  assert.match(ruta, /validateComposition\(/, "usa el dominio puro");
  assert.match(ruta, /sanitizeComposition\(/);
  assert.ok(!/body\.userId/.test(ruta), "el usuario sale del Bearer");
  assert.match(ruta, /eq\("user_id", userId\)/, "segunda red además de RLS");
});

test("F47 · la migración no destruye nada de lo que ya existía", () => {
  const sql = read("supabase", "migrations", "0054_tactical_compositions.sql");
  for (const prohibido of ["drop table", "delete from", "truncate"]) {
    assert.ok(!new RegExp(prohibido, "i").test(sql), `la migración no hace «${prohibido}»`);
  }
  assert.match(sql, /add column if not exists composition_id/, "la columna nueva es opcional");
  assert.match(sql, /on delete set null/, "borrar una composición no se lleva las jugadas");
});

test("F47 · los agentes tienen identidad VISUAL, no una letra dentro de un círculo", () => {
  const emblema = read("src", "components", "tactics", "AgentEmblem.tsx");
  // Los diez del modelo anterior conservan su sigilo (fichas antiguas); los reales, su código.
  for (const a of AGENTS) assert.ok(emblema.includes(`case "${a.id}"`), `${a.id} tiene emblema propio`);
  assert.match(emblema, /<Code code=\{agent\.code\}/, "los agentes reales se pintan con su código");
  const board = code(read("src", "components", "tactics", "StrategyBoard.tsx"));
  assert.match(board, /agentId \? \(/, "la ficha usa el emblema cuando hay agente");
  assert.match(board, /AgentEmblemGlyph/);
});
