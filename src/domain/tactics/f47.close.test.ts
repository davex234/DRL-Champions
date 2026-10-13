/**
 * FASE 47 · CIERRE — lo que protege el producto VISIBLE.
 *
 * El informe anterior decía «la cañería está puesta; falta el grifo». Estas pruebas fijan el grifo:
 * que las pantallas existan, que usen el dominio real y que la concurrencia no pierda trabajo.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { AGENTS } from "@/agents/catalog";
import { COMPOSITION_SIZE } from "./composition";

const ROOT = process.cwd();
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

const BUILDER = read("src", "components", "tactics", "CompositionBuilder.tsx");
const COMPS_PAGE = read("src", "app", "entrenador", "composiciones", "page.tsx");
const PLAN_PAGE = read("src", "app", "entrenador", "plan", "page.tsx");
const STRATS_API = read("src", "app", "api", "game", "strats", "route.ts");
const CLIENT = read("src", "lib", "tactics", "client.ts");

/* ═══════════ LAS PANTALLAS EXISTEN ═══════════ */

test("F47C · existen las dos pantallas que faltaban", () => {
  assert.ok(existsSync(join(ROOT, "src/app/entrenador/composiciones/page.tsx")), "gestor de composiciones");
  assert.ok(existsSync(join(ROOT, "src/app/entrenador/plan/page.tsx")), "plan táctico de partida");
});

test("F47C · el constructor NO es un formulario: cinco huecos y un roster con identidad", () => {
  assert.match(code(BUILDER), /data-testid="composition-slots"/);
  assert.match(code(BUILDER), /data-testid="agent-roster"/);
  /*
   * La regla que protege: **un agente se elige por su imagen, no leyendo una lista de nombres**.
   * F59: esa imagen es ya el ARTE REAL del agente (`personajes/` → manifiesto), por los componentes
   * canónicos de `components/agents/AgentArt`: cuerpo entero en los huecos, cara en el roster. El
   * retrato de la Fase 48 (`tactics/AgentPortrait`, agentes propios) sigue fuera del entrenador.
   */
  assert.match(code(BUILDER), /from "@\/components\/agents\/AgentArt"/, "arte de agente por el sistema canónico");
  assert.match(code(BUILDER), /<AgentFullBody agentId=\{agente\.id\}/, "huecos: cuerpo entero");
  assert.match(code(BUILDER), /<AgentPortrait agentId=\{a\.id\}/, "roster: cara");
  assert.ok(!/from "\.\/AgentPortrait"/.test(code(BUILDER)), "el entrenador no usa el retrato de F48");
  // Nada de desplegables nativos para elegir agente.
  assert.ok(!/<select/i.test(code(BUILDER)), "sin <select>");
  // Los huecos salen del dominio, no de un 5 escrito a mano: por eso se busca la constante.
  assert.match(code(BUILDER), /Array\.from\(\{ length: COMPOSITION_SIZE \}/, "cinco huecos, del dominio");
  assert.equal(COMPOSITION_SIZE, 5);
});

test("F47C · el constructor usa el dominio REAL para avisar, no reglas propias", () => {
  for (const f of ["validateComposition", "isComplete", "classBreakdown", "COMPOSITION_SIZE"]) {
    assert.ok(code(BUILDER).includes(f), `usa ${f} del dominio`);
  }
  // No se reimplementa la regla de duplicados en la interfaz.
  assert.ok(!/DUPLICATE_AGENT/.test(code(BUILDER)), "el motivo lo da el dominio/servidor");
});

test("F47C · el gestor permite el ciclo completo por mapa", () => {
  const c = code(COMPS_PAGE);
  assert.match(c, /data-testid="new-composition"/, "crear");
  assert.match(c, /data-testid="map-selector"/, "elegir mapa");
  for (const fn of ["saveComposition", "deleteComposition", "fetchCompositions"]) {
    assert.ok(c.includes(fn), `usa ${fn}`);
  }
  assert.match(c, /\(copia\)/, "duplicar dentro del mismo mapa");
  // Confirmación EN LA PÁGINA: el producto prohíbe los diálogos nativos del navegador.
  assert.match(c, /data-testid={`confirm-\$\{c\.id\}`}/, "borrar pide confirmación en la fila");
  assert.ok(!/window\.confirm|window\.alert/.test(c), "sin diálogos nativos");
});

/* ═══════════ EL PLAN DE PARTIDA ═══════════ */

test("F47C · el plan ofrece SOLO jugadas y composiciones del mapa de la partida", () => {
  const c = code(PLAN_PAGE);
  assert.match(c, /strats\.filter\(\(s\) => match && s\.mapId === match\.mapId\)/, "jugadas del mapa");
  assert.match(c, /comps\.filter\(\(c\) => match && c\.mapId === match\.mapId\)/, "composiciones del mapa");
});

test("F47C · el filtro del cliente NO sustituye a la validación del servidor", () => {
  const api = code(read("src", "app", "api", "game", "match-strats", "route.ts"));
  assert.match(api, /mapaPartida && mapaPartida !== mapaJugada/, "el servidor sigue comparando mapas");
  assert.match(api, /409/, "y sigue rechazando con 409");
});

test("F47C · desde el plan se puede ABRIR y PRESENTAR cada jugada", () => {
  const c = code(PLAN_PAGE);
  assert.match(c, /data-testid={`present-\$\{s\.id\}`}/, "botón de presentar");
  assert.match(c, /<TacticalTheater/, "presenta con el teatro que ya existía");
  assert.match(c, /entrenador\/strats\?abrir=/, "y se puede abrir en la pizarra");
});

test("F47C · la incompatibilidad de composición se DICE, no se esconde", () => {
  assert.match(code(PLAN_PAGE), /data-testid="comp-incompatible"/);
});

test("F47C · el plan sólo enseña datos reales de la partida", () => {
  const c = code(PLAN_PAGE);
  // Cada dato va condicionado a existir: nada de guiones inventados.
  for (const campo of ["rivalName", "teamName", "scoreHome", "finishedAt"]) {
    assert.ok(c.includes(campo), `${campo} sale de la partida`);
  }
  assert.ok(!/"—"|'—'/.test(c), "no se rellenan huecos con guiones");
});

/* ═══════════ CONCURRENCIA ═══════════ */

test("F47C · guardar con versión vieja NO pisa el trabajo de otra pestaña", () => {
  const api = code(STRATS_API);
  assert.match(api, /baseVersion/, "el guardado acepta la versión que leyó el editor");
  assert.match(api, /\.eq\("updated_at", baseVersion\)/, "el UPDATE sólo muerde en esa versión");
  assert.match(api, /VERSION_CONFLICT/, "y responde con un código propio");
  assert.match(api, /status: 409/, "409, no un error genérico");
  // Y distingue «no existe» de «ha cambiado»: confundirlos asusta sin motivo.
  assert.match(api, /Esa estrategia no existe/);
  // FASE 51 · el texto es el del encargo: «Esta jugada ha cambiado en otra sesión.»
  assert.match(api, /ha cambiado en otra sesión/);
});

test("F47C · el conflicto devuelve la versión ACTUAL, para poder recargar sin adivinar", () => {
  const api = code(STRATS_API);
  assert.match(api, /currentVersion: fila\.updated_at/);
});

test("F47C · NO existe un «forzar guardado» en esta fase", () => {
  /*
   * Se busca un botón/acción de sobrescritura, NO la palabra «force»: `export const dynamic =
   * "force-dynamic"` es configuración de Next y no tiene nada que ver. Una aserción que se
   * tropieza con eso no protege nada y encima da un fallo que despista.
   */
  for (const [nombre, src] of [["api", STRATS_API], ["cliente", CLIENT], ["plan", PLAN_PAGE]] as const) {
    const c = code(src);
    assert.ok(!/forzar guardado|forceOverwrite|force:\s*true|overwrite/i.test(c), `${nombre} no ofrece sobrescribir a la fuerza`);
  }
});

test("F47C · el guardado versionado existe en el cliente y viaja con baseVersion", () => {
  assert.match(code(CLIENT), /saveStratVersioned/);
  assert.match(code(CLIENT), /baseVersion/);
});

/* ═══════════ NO SE ROMPE LO QUE YA HABÍA ═══════════ */

test("F47C · el cliente conserva TODO lo que ya exportaba", () => {
  for (const fn of ["fetchStrats", "saveStrat", "deleteStrat", "duplicateStrat", "StratError", "StratRow"]) {
    assert.ok(code(CLIENT).includes(fn), `sigue existiendo ${fn}`);
  }
});

test("F47C · los agentes salen del CATÁLOGO, nunca escritos a mano en las pantallas", () => {
  /*
   * Antes esta prueba prohibía nombres de Riot porque el roster era propio. Tras la corrección
   * de catálogo el roster ES el real, así que lo que se protege es lo que siempre importó: que
   * ninguna pantalla escriba un agente a mano. Todos salen de `domain/tactics/roster.ts`.
   */
  const aMano = ["jett", "sova", "omen", "killjoy", "sage", "reyna", "phoenix", "cypher", "veil", "haze"];
  const fuentes = [BUILDER, COMPS_PAGE, PLAN_PAGE].map(code).join("\n").toLowerCase();
  for (const p of aMano) {
    assert.ok(!new RegExp(`["'\`]${p}["'\`]`).test(fuentes), `«${p}» escrito a mano en una pantalla`);
  }
  assert.match(code(BUILDER), /searchAgents/, "el roster del constructor sale del catálogo real");
  // Y los diez del modelo anterior siguen teniendo emblema, para las fichas antiguas.
  const emblema = read("src", "components", "tactics", "AgentEmblem.tsx");
  for (const a of AGENTS) assert.ok(emblema.includes(`case "${a.id}"`), `${a.id} conserva su emblema`);
});

test("F47C · F47 no añade migraciones tras la 0054; la cabeza es 0058 (F58: 0055; F59.1: 0056; F60: 0057; PRE-F70: 0058)", () => {
  const { readdirSync } = require("node:fs") as typeof import("node:fs");
  const migs = readdirSync(join(ROOT, "supabase/migrations")).filter((f) => /^\d{4}_/.test(f)).sort();
  // F73 añade 0059 (crafteo y misiones) y 0060 (desguace atómico, última copia): AUTORIZADAS y APLICADAS el 2026-09-30.
  assert.equal(migs[migs.length - 1], "0075_team_collections.sql"); // COLECCIONES POR EQUIPO · 0075 (primeras compleciones e insignias regionales; aditiva: sin ella el servidor solo deja de guardarlas) es la última; antes F87.2 · 0073 (launch guard de Pick'ems: elegibilidad y puerta de tiempo) es la última; antes F87.1 · 0072, F87 · 0071 (Pick'ems 2.0: cuadros de predicción, cierre por partido, liquidación y reclamos; aditiva) es la última; antes F86.2 · 0070 (feedback de la Closed Alpha + embudo derivado) es la última; antes F86 · 0069 (torneos de jugadores) es la última del repositorio (cabeza = 0069; 0068 tag público de cuenta; 0067 gestión de admins, F85 añadió 0066, F84 añadió 0065, F83 0064, ops/release). F82 añadió 0062 y F89 0063.
});
