/**
 * FASE 51.3 · TACTICAL COACH — JUGAR ES INMEDIATO.
 *
 *   JUGAR → elige composición → JUGAR PARTIDA → (revelación del mapa) → partido.
 *
 * Lo único que hace falta es una composición jugable. La plantilla, las estrategias y el plan son
 * preparación opcional. El mapa lo pone la composición y siempre es uno de los doce del catálogo.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  isPlayableComposition, playableCompositions, quickPlayHref, pickMapForNewComposition,
  homeSquadSource, isDifficulty, DEFAULT_DIFFICULTY,
  quickPlayScreen, compositionsErrorText, autoCompositionName,
} from "./quickPlay";
import { validateComposition, type Composition } from "./composition";
import { TACTICAL_AGENTS } from "./roster";
import { AGENTS } from "@/agents/catalog";
import { matchMaps, isMatchMapId, requireMatchMap, InvalidMatchMapError } from "./matchMap";
import { NAV_GRAPHS } from "./navigation/maps";
import { validateNavGraph } from "./navigation/validation";
import { buildDefaultHomeRoster, buildRivalRoster } from "@/lib/match/roster";
import { makeMatchConfig, simulateMatch, matchWinner } from "@/match";
import { ZONES } from "@/sim";
import { validarPartido } from "@/server/services/coachMatches";
import { GET as compositionsGET } from "@/app/api/game/compositions/route";

const ROOT = process.cwd();
const code = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const JUGAR = code("src", "app", "entrenador", "jugar", "page.tsx");
const PARTIDO = code("src", "app", "entrenador", "partido", "page.tsx");
const HUB = code("src", "app", "entrenador", "page.tsx");
const QUICK = code("src", "components", "tactics", "QuickComposer.tsx");
const COMPS_PAGE = code("src", "app", "entrenador", "composiciones", "page.tsx");
const BUILDER = code("src", "components", "tactics", "CompositionBuilder.tsx");

const CINCO = TACTICAL_AGENTS.slice(0, 5).map((a) => a.id);
const MAPAS = matchMaps().map((m) => m.id);
const comp = (over: Partial<Composition> = {}): Composition => ({
  id: "c1", name: "Default", mapId: MAPAS[0], agentIds: CINCO, notes: "", primary: false, updatedAt: "2026-09-01T00:00:00Z", ...over,
});
const ZONE_IDS = Object.keys(ZONES);
const hrefParams = (h: string) => new URL(h, "http://x").searchParams;

/** Una partida como la lanza `/entrenador/partido` (mismo camino, sin UI). */
function partida(c: Composition, teamValid: boolean, dif = DEFAULT_DIFFICULTY) {
  const h = quickPlayHref(c, dif);
  assert.ok(h, "composición jugable → enlace");
  const q = hrefParams(h);
  const mapa = requireMatchMap(q.get("map"));
  assert.equal(homeSquadSource(teamValid), teamValid ? "team" : "default");
  const seed = 12345;
  const { roster: home, playerIds } = buildDefaultHomeRoster(seed ^ 0x5bd1e995);
  const away = buildRivalRoster((seed ^ 0x9e3779b9) >>> 0, playerIds, dif);
  const config = makeMatchConfig({
    seed, rosters: { home, away },
    homeSetup: { side: "ATK", approach: "default", tempo: "mid", aggression: "balanced" },
    teamNames: { home: "Equipo NEXUS", away: "Rival" }, mapId: mapa.id, coach: { mode: "ai" }, useEconomyTactics: true,
  });
  return { config, end: simulateMatch(config) };
}

/* ═══════════ COMPOSICIÓN → JUGAR ═══════════ */

/* ═══════════ FASE 51.3.1 · NI EDITOR NI ESTADOS CONFUNDIDOS ═══════════ */

test("F5131 A1 · con Supabase inalcanzable la ruta falla CERRADO: 401, nunca una lista vacía", async () => {
  const prev = {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    anon: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  /* El fallo REAL de F51.3: el túnel a Supabase caído. Aquí, un puerto que rechaza la conexión. */
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:1";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-qa-f5131";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-qa-f5131";
  try {
    const res = await compositionsGET(new Request("http://localhost/api/game/compositions", {
      headers: { authorization: "Bearer token-qa-f5131" },
    }));
    const body = (await res.json()) as { error?: string; compositions?: unknown[] };
    assert.equal(res.status, 401, "sin poder verificar la sesión, 401");
    assert.equal(body.error, "No autenticado");
    assert.equal(body.compositions, undefined, "NO devuelve [] — eso se leería como «no tienes ninguna»");
    /* Y así lo presenta la pantalla: error con reintento, no «crea tu primera». */
    assert.equal(quickPlayScreen({ loading: false, error: true, playable: 0 }), "error");
    assert.match(compositionsErrorText(401), /sesión/i);
  } finally {
    process.env.NEXT_PUBLIC_SUPABASE_URL = prev.url;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = prev.anon;
    process.env.SUPABASE_SERVICE_ROLE_KEY = prev.key;
  }
});

test("F5131 A2 · cargando ≠ vacío ≠ error, y cada uno enseña lo suyo", () => {
  assert.equal(quickPlayScreen({ loading: true, error: false, playable: 0 }), "loading");
  assert.equal(quickPlayScreen({ loading: true, error: true, playable: 0 }), "error", "el error manda sobre el spinner");
  assert.equal(quickPlayScreen({ loading: false, error: true, playable: 3 }), "error");
  assert.equal(quickPlayScreen({ loading: false, error: false, playable: 0 }), "create");
  assert.equal(quickPlayScreen({ loading: false, error: false, playable: 2 }), "choose");
  assert.notEqual(compositionsErrorText(401), compositionsErrorText(500));
  assert.ok(!/crea tu primera/i.test(compositionsErrorText(401) + compositionsErrorText(500)));
  for (const id of ["play-loading", "play-error", "play-retry"]) assert.match(JUGAR, new RegExp(`data-testid="${id}"`), id);
  /* El editor NO puede quedar debajo del error: los estados son excluyentes. */
  assert.match(JUGAR, /pantalla === "create" && \(/);
  assert.match(JUGAR, /setComps\(null\);/, "un fallo no deja una lista vacía en memoria");
});

test("F5131 A3 · JUGAR no es un editor: sin mapa, sin nombre, sin buscador ni filtros", () => {
  assert.ok(!/<CompositionBuilder/.test(JUGAR), "el editor avanzado no aparece en JUGAR");
  assert.ok(!/play-create-map|<select/.test(JUGAR), "sin selector de mapa");
  assert.ok(!/composition-name|<input/.test(JUGAR), "sin campo de nombre");
  assert.ok(!/roster-search|Buscar agente/.test(JUGAR + QUICK), "sin buscador en quick play");
  assert.ok(!/searchAgents\(|AGENT_CLASS_LABEL\[c\]/.test(QUICK), "sin filtros por clase en quick play");
  assert.match(JUGAR, /autoCompositionName\(/, "el nombre lo pone el sistema");
  /* Y la herramienta completa sigue entera donde toca. */
  assert.match(COMPS_PAGE, /<CompositionBuilder/);
  assert.match(BUILDER, /data-testid="roster-search"/);
});

test("F5131 A4 · el creador rápido: 29 agentes, barra compacta y un solo botón", () => {
  assert.equal(TACTICAL_AGENTS.length, 29);
  assert.match(QUICK, /TACTICAL_AGENTS\.map/, "los 29 salen del catálogo real");
  for (const id of ["quick-composer", "quick-picked", "quick-count", "quick-save-play", "quick-roster"]) {
    assert.match(QUICK, new RegExp(`data-testid="${id}"`), id);
  }
  assert.match(QUICK, /grid-cols-2 gap-1\.5 sm:grid-cols-3/, "dos columnas en móvil: se toca bien a 390");
  assert.match(QUICK, /min-h-\[56px\]/, "objetivo táctil holgado");
  assert.ok(!/Notas|notes=/.test(QUICK), "sin notas");
});

test("F5131 A5 · nombre automático: no se escribe nada y no se repite", () => {
  assert.equal(autoCompositionName([]), "Composición rápida");
  assert.equal(autoCompositionName(["Composición rápida"]), "Composición rápida 2");
  assert.equal(autoCompositionName(["composición rápida", "COMPOSICIÓN RÁPIDA 2"]), "Composición rápida 3");
  assert.equal(autoCompositionName(["Otra"]), "Composición rápida");
  for (const n of [autoCompositionName([]), autoCompositionName(["Composición rápida"])]) {
    assert.deepEqual(validateComposition(comp({ name: n })), [], "el nombre automático es válido para el servidor");
  }
});

test("F5131 A6 · ni plantilla, ni estrategias, ni plan, ni dificultad en el camino principal", () => {
  assert.ok(!/TeamCardStrip|useTeamStore|validateTeam|lantilla/.test(JUGAR), "la plantilla no aparece en JUGAR");
  assert.ok(!/homeSquadSource/.test(JUGAR), "ni siquiera se menciona con qué equipo se juega");
  assert.ok(!/strats|Estrategia|matchPlan/i.test(JUGAR), "sin estrategias ni plan");
  /* La dificultad existe, pero plegada y con su valor de siempre. */
  assert.match(JUGAR, /data-testid="play-options"/);
  assert.match(JUGAR, /useState<Difficulty>\(DEFAULT_DIFFICULTY\)/);
  /* Y el partido sigue resolviendo el equipo solo. */
  assert.match(PARTIDO, /buildDefaultHomeRoster\(/);
});

test("F513 Q1 · composición → jugar directamente: un enlace con su mapa, auto y la dificultad por defecto", () => {
  const h = quickPlayHref(comp({ id: "abc", mapId: "bind" }))!;
  const q = hrefParams(h);
  assert.ok(h.startsWith("/entrenador/partido?"));
  assert.equal(q.get("map"), "bind");
  assert.equal(q.get("comp"), "abc");
  assert.equal(q.get("auto"), "1", "sin pre-partido: revelación y a jugar");
  assert.equal(q.get("dif"), "normal");
  assert.equal(DEFAULT_DIFFICULTY, "normal", "el default existente de MatchSetup");
  assert.match(JUGAR, /quickPlayHref\(/);
  assert.match(JUGAR, /data-testid="play-start"/);
});

test("F513 Q2 · sin plantilla se puede jugar: equipo por defecto con cinco jugadores reales", () => {
  const { roster, playerIds, missing } = buildDefaultHomeRoster(7);
  assert.equal(roster.length, 5);
  assert.equal(playerIds.size, 5, "cinco jugadores distintos");
  assert.deepEqual(missing, []);
  assert.equal(homeSquadSource(false), "default");
  assert.ok(!/if \(!active \|\| !ready/.test(PARTIDO), "play() ya no exige plantilla");
  assert.match(PARTIDO, /buildDefaultHomeRoster\(/);
  assert.ok(!/TeamGate/.test(PARTIDO), "no hay pantalla que bloquee por falta de equipo");
});

test("F513 Q3 · plantilla incompleta NO bloquea: se juega con el equipo por defecto", () => {
  assert.equal(homeSquadSource(false), "default");
  assert.match(PARTIDO, /const conEquipo = ready && active != null;/, "solo una plantilla VÁLIDA se usa");
  assert.match(PARTIDO, /if \(conEquipo\) markUsed\(active\.id\)/, "el equipo por defecto no marca nada como usado");
  const { end } = partida(comp(), false);
  assert.ok(end.winner, "la partida termina con ganador");
});

test("F513 Q4 · sin estrategia ni plan se puede jugar: JUGAR y el lanzador no los piden", () => {
  assert.ok(!/fetchStrats|useStrat|matchPlan|MatchPlan|strats/i.test(JUGAR), "JUGAR no lee estrategias ni plan");
  assert.ok(!/paso=|play-steps/.test(JUGAR), "sin asistente de pasos");
  const { end } = partida(comp(), false);
  assert.ok(end.history.length >= 13, "partido completo con el plan automático del motor");
});

test("F513 Q5 · el mapa se resuelve solo y SIEMPRE es uno de los 12 canónicos", () => {
  assert.equal(MAPAS.length, 12);
  for (const id of MAPAS) {
    const q = hrefParams(quickPlayHref(comp({ mapId: id }))!);
    assert.equal(q.get("map"), id, "el mapa es el de la composición");
    assert.ok(isMatchMapId(q.get("map")));
  }
  for (const r of [0, 0.0001, 0.25, 0.5, 0.75, 0.9999, 0.99999999, 1, -1, 2]) {
    assert.ok(MAPAS.includes(pickMapForNewComposition(r)), `r=${r}`);
  }
  const vistos = new Set(Array.from({ length: 12 }, (_, i) => pickMapForNewComposition((i + 0.5) / 12)));
  assert.equal(vistos.size, 12, "el sorteo alcanza los doce mapas");
  assert.match(JUGAR, /mapId: pickMapForNewComposition\(Math\.random\(\)\)/, "el mapa lo pone el sistema al guardar");
  assert.ok(!/"Ascent"|"ascent"/.test(JUGAR), "ningún mapa escrito a mano");
});

test("F513 Q6 · composición compatible → partida real en su mapa, registrable por el servidor", () => {
  for (const mapId of [MAPAS[0], MAPAS[5], MAPAS[11]]) {
    const { config, end } = partida(comp({ mapId }), false);
    assert.equal(config.mapId, mapId);
    assert.ok(end.winner === "home" || end.winner === "away");
    assert.equal(matchWinner(end.score, config.win), end.winner);
    const reg = validarPartido({
      seed: 1, teamName: "Equipo NEXUS", rivalName: "Rival", difficulty: "normal", mapId, mapSite: "A", startSide: "ATK",
      scoreHome: end.score.home, scoreAway: end.score.away, rounds: end.history.length, durationSeconds: 60, mvp: null,
    });
    assert.equal(reg.ok, true, mapId);
  }
});

test("F513 Q7 · 0 composiciones → crear aquí → «Guardar y jugar» lanza la partida", () => {
  assert.deepEqual(playableCompositions([]), []);
  assert.match(JUGAR, /<QuickComposer onPlay=\{\(ids\) => void guardarYJugar\(ids\)\}/, "creador rápido propio, no el editor avanzado");
  assert.match(QUICK, /data-testid="quick-save-play"/);
  assert.match(QUICK, /Guardar y jugar/);
  assert.match(JUGAR, /const href = quickPlayHref\(guardada, difficulty\);\s*if \(href\) router\.push\(href\)/);
  assert.ok(!/router\.push\("\/entrenador"\)/.test(JUGAR), "nunca de vuelta al hub");
  const nueva = comp({ id: "nueva", mapId: pickMapForNewComposition(0.42) });
  assert.ok(quickPlayHref(nueva), "la recién guardada se juega");
});

test("F513 Q8 · composición inválida rechazada: incompleta, legado, agente o mapa desconocido", () => {
  assert.equal(quickPlayHref(comp({ agentIds: CINCO.slice(0, 4) })), null, "4 agentes");
  assert.equal(quickPlayHref(comp({ agentIds: [] })), null, "vacía");
  const legado = AGENTS.find((a) => !TACTICAL_AGENTS.some((t) => t.id === a.id));
  if (legado) assert.equal(quickPlayHref(comp({ agentIds: [legado.id, ...CINCO.slice(0, 4)] })), null, "agente del modelo anterior");
  assert.ok(validateComposition(comp({ agentIds: ["no-existe", ...CINCO.slice(0, 4)] })).some((i) => i.code === "UNKNOWN_AGENT"));
  assert.ok(validateComposition(comp({ agentIds: [CINCO[0], CINCO[0], ...CINCO.slice(1, 4)] })).some((i) => i.code === "DUPLICATE_AGENT"));
  const lista = [comp({ id: "ok" }), comp({ id: "corta", agentIds: CINCO.slice(0, 2) }), comp({ id: "mapa", mapId: "generic-map" })];
  assert.deepEqual(playableCompositions(lista).map((c) => c.id), ["ok"], "solo las jugables se ofrecen para jugar");
  assert.equal(isPlayableComposition(lista[1]), false);
});

test("F513 Q9 · mapa inválido rechazado: ni enlace ni partida, y la página lo dice", () => {
  for (const malo of ["generic-map", "Ascent", "", "__proto__", "../ascent"]) {
    assert.equal(quickPlayHref(comp({ mapId: malo })), null, malo);
    assert.throws(() => requireMatchMap(malo), InvalidMatchMapError);
  }
  assert.equal(quickPlayHref(comp(), "imposible" as never), null, "dificultad desconocida");
  assert.equal(isDifficulty("hard"), true);
  assert.equal(isDifficulty("x"), false);
  assert.match(PARTIDO, /isMatchMapId\(mapParam\)/);
  assert.match(PARTIDO, /data-testid="match-invalid-map"/);
  assert.match(PARTIDO, /isDifficulty\(difParam\) \? difParam : DEFAULT_DIFFICULTY/, "?dif= desconocido → default");
});

test("F513 Q10 · orden de la lista: principal primero y después la más reciente", () => {
  const l = [
    comp({ id: "vieja", updatedAt: "2026-01-01" }),
    comp({ id: "nueva", updatedAt: "2026-09-01" }),
    comp({ id: "principal", primary: true, updatedAt: "2025-01-01" }),
  ];
  assert.deepEqual(playableCompositions(l).map((c) => c.id), ["principal", "nueva", "vieja"]);
});

test("F513 Q11 · la revelación del mapa: PARTIDA ENCONTRADA, imagen real, automática y con movimiento reducido", () => {
  assert.match(PARTIDO, /data-testid="map-reveal"/);
  assert.match(PARTIDO, /Partida encontrada/);
  assert.match(PARTIDO, /<MapThumb map=\{mapa\} full \/>/);
  assert.match(PARTIDO, /prefers-reduced-motion: reduce/);
  assert.match(PARTIDO, /MAP_REVEAL_MS = \{ normal: 1600, reduced: 500 \}/);
  assert.match(PARTIDO, /play\(drawSide\(\), difInicial, false\)/, "arranca solo, lado sorteado, sin intro");
  assert.match(PARTIDO, /if \(autoRef\.current \|\| !mapaElegido\) return;/, "una sola vez por visita");
});

test("F513 Q12 · JUGAR sigue siendo la acción dominante del hub", () => {
  assert.match(HUB, /href="\/entrenador\/jugar" className="nx-play-cta" data-testid="hub-play"/);
  assert.match(HUB, /Elige composición y juega/);
});

test("F513 N1 · NavigationGraph intacto: los doce grafos siguen válidos", () => {
  assert.equal(Object.keys(NAV_GRAPHS).length, 12);
  for (const id of MAPAS) {
    const g = NAV_GRAPHS[id as keyof typeof NAV_GRAPHS];
    assert.ok(g, id);
    assert.deepEqual(validateNavGraph(g, ZONE_IDS), [], id);
  }
});

test("F513 E1 · motor intacto: 13 rondas para ganar, determinista, y el rival no cambia", () => {
  const a = partida(comp(), false).end;
  const b = partida(comp(), false).end;
  assert.deepEqual(a.score, b.score, "misma semilla, mismo partido");
  assert.ok(Math.max(a.score.home, a.score.away) >= 13);
  const r1 = buildRivalRoster(99, new Set(), "normal").map((p) => p.name);
  const r2 = buildRivalRoster(99, new Set(), "normal").map((p) => p.name);
  assert.deepEqual(r1, r2, "el generador del rival sigue siendo determinista");
});
