/**
 * FASE 51.1 · TACTICAL COACH — flujo JUGAR, mapas canónicos en el partido y cartas en la plantilla.
 *
 * Los doce mapas se prueban con sus ids REALES (`availableMaps()`), no con una lista escrita aquí.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { availableMaps, getTacticalMap } from "@/domain/tactics/maps";
import {
  matchMaps, isMatchMapId, requireMatchMap, projectSimPoint,
  InvalidMatchMapError, ZONE_LABEL,
} from "@/domain/tactics/matchMap";
import { NAV_GRAPHS } from "@/domain/tactics/navigation/maps";
import { ZONES, createRound, tick as simTick, type CoachSetup, type ZoneId } from "@/sim";
import { createViewport } from "@/camera";
import { buildRenderFrame } from "@/visualizer";
import { mapImageSrc, mapThumbSrc } from "@/lib/assets";
import { validarPartido } from "@/server/services/coachMatches";
import { resumirPartido } from "@/lib/match/history";
import { makeMatchConfig } from "@/match";
import { COACH_ROOMS, isRoomActive } from "@/components/coach/tc/CoachFrame";
import { MapMatchBoard } from "./MapMatchBoard";

const ROOT = process.cwd();
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const IDS = availableMaps().map((m) => m.id);
const SETUP: CoachSetup = { side: "ATK", approach: "default", tempo: "mid", aggression: "balanced" };
const frameAt = (ticks: number) => {
  let s = createRound(7, SETUP);
  for (let i = 0; i < ticks; i++) s = simTick(s);
  return buildRenderFrame({ state: s, viewport: createViewport() });
};

/* ═══════════ MAPAS: UNA FUENTE CANÓNICA ═══════════ */

test("F511 M1 · los mapas del partido SON el catálogo del Tactical Coach (12, mismos ids)", () => {
  assert.equal(IDS.length, 12);
  assert.deepEqual(matchMaps().map((m) => m.id), IDS);
  // F51.2 · los anclajes afines de la 51.1 los sustituye el grafo de navegación: uno por mapa, solo esos.
  assert.deepEqual(Object.keys(NAV_GRAPHS).sort(), [...IDS].sort(), "un grafo para los doce y solo para ellos");
});

for (const id of IDS) {
  test(`F511 M2 · ${id}: catálogo, asset, miniatura y proyección dentro del asset`, () => {
    const m = requireMatchMap(id);
    assert.equal(m.id, id);
    assert.ok(existsSync(join(ROOT, "public", mapImageSrc(m.asset))), `asset ${m.asset}`);
    assert.ok(existsSync(join(ROOT, "public", mapThumbSrc(m.asset))), `miniatura ${m.asset}`);
    // Cada zona del modelo cae en SU nodo del grafo de navegación (F51.2), y todo punto dentro del asset.
    const g = NAV_GRAPHS[id];
    for (const z of Object.keys(ZONES) as ZoneId[]) {
      const p = projectSimPoint(id, ZONES[z]);
      const n = g.nodes.find((x) => x.id === z)!;
      assert.ok(Math.abs(p.x - n.x) < 0.006 && Math.abs(p.y - n.y) < 0.006, `${id}/${z}`);
    }
    for (let x = 0; x <= 1000; x += 125) for (let y = 0; y <= 700; y += 100) {
      const p = projectSimPoint(id, { x, y });
      assert.ok(p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1 && Number.isFinite(p.x + p.y));
    }
  });

  test(`F511 M3 · ${id}: el partido pinta SU asset y nada del modelo abstracto`, () => {
    const m = getTacticalMap(id)!;
    const h = renderToStaticMarkup(<MapMatchBoard frame={frameAt(40)} mapId={id} />);
    assert.match(h, new RegExp(`href="${mapImageSrc(m.asset).replace(/[.]/g, "\\.")}"`));
    assert.match(h, new RegExp(`data-map-id="${id}"`));
    assert.equal((h.match(/data-entity="player/g) ?? []).length, 10, "los diez jugadores");
    for (const falso of [">generator<", ">a main<", ">tree<", ">SITE<", "#33425a", 'id="grid"', "url(#floor)"]) {
      assert.ok(!h.includes(falso), `${id}: sin ${falso}`);
    }
  });
}

test("F511 M4 · mapId inexistente → error seguro; NUNCA un mapa genérico", () => {
  for (const malo of ["generic-map", "Ascent", "", undefined, null, 42, "__proto__", "constructor", "../ascent"]) {
    assert.equal(isMatchMapId(malo), false, String(malo));
    assert.throws(() => requireMatchMap(malo), InvalidMatchMapError);
  }
  assert.throws(() => renderToStaticMarkup(<MapMatchBoard frame={frameAt(1)} mapId="generic-map" />), InvalidMatchMapError);
  assert.throws(() => projectSimPoint("generic-map", { x: 1, y: 1 }), InvalidMatchMapError);
});

test("F511 M5 · el servidor solo registra partidos en mapas del catálogo", () => {
  const base = { seed: 1, teamName: "A", rivalName: "B", difficulty: "normal", mapSite: "A", startSide: "ATK", scoreHome: 13, scoreAway: 9, rounds: 22, durationSeconds: 60, mvp: null };
  for (const id of IDS) assert.equal(validarPartido({ ...base, mapId: id }).ok, true, id);
  for (const malo of ["generic-map", "Ascent", "mapa-inventado"]) assert.equal(validarPartido({ ...base, mapId: malo }).ok, false, malo);
});

test("F511 M6 · el historial guarda el mapa ELEGIDO; sin él (config antigua), Ascent como antes", () => {
  const rost = { home: [], away: [] } as unknown as Parameters<typeof makeMatchConfig>[0]["rosters"];
  const conMapa = makeMatchConfig({ seed: 5, rosters: rost, homeSetup: SETUP, mapId: "lotus" });
  const sinMapa = makeMatchConfig({ seed: 5, rosters: rost, homeSetup: SETUP });
  assert.equal(conMapa.mapId, "lotus");
  assert.ok(!("mapId" in sinMapa), "la config sin mapa no cambia de forma");
  const fake = (config: typeof conMapa) => ({ config, score: { home: 13, away: 5 }, history: new Array(18).fill(0) }) as never;
  assert.equal(resumirPartido(fake(conMapa), "normal").mapId, "lotus");
  assert.equal(resumirPartido(fake(sinMapa), "normal").mapId, "ascent");
});

test("F511 M7 · las zonas internas del modelo no llegan a la interfaz con su nombre abstracto", () => {
  for (const z of Object.keys(ZONES) as ZoneId[]) assert.ok(ZONE_LABEL[z], z);
  assert.ok(!/tree|generator|a_main/.test(Object.values(ZONE_LABEL).join(" ")));
  assert.match(code(read("src", "components", "coach", "LivePlayerStrip.tsx")), /ZONE_LABEL\[p\.targetZone/);
});

/* ═══════════ DIRIGIR PARTIDO ═══════════ */

const PARTIDO = code(read("src", "app", "entrenador", "partido", "page.tsx"));

test("F511 P1 · Dirigir Partido pinta el mapa canónico, no el backend esquemático", () => {
  assert.ok(!/getRenderer|<Renderer\b|SvgRenderer/.test(PARTIDO), "sin el renderer del mapa inventado");
  assert.match(PARTIDO, /<MapMatchBoard frame=\{frame!\} mapId=\{mapaPartido\.id\} snap=\{snap\} \/>/);
  assert.match(PARTIDO, /mapId: mapaElegido\.id/, "el mapa elegido viaja en la configuración");
  assert.match(PARTIDO, /isMatchMapId\(mapParam\)/, "el ?map= se valida contra el catálogo");
  assert.match(PARTIDO, /data-testid="match-invalid-map"/);
  assert.match(PARTIDO, /data-testid="match-no-map"/);
  assert.ok(!/"Ascent"/.test(PARTIDO), "ningún mapa por defecto escrito a mano");
});

test("F511 P2 · pre-partido: equipo (cartas), mapa, composición (agentes) y rival, separados", () => {
  assert.match(PARTIDO, /data-testid="prematch"/);
  assert.match(PARTIDO, /<TeamCardStrip starters=\{starters\}/);
  assert.match(PARTIDO, /<MapThumb map=\{mapa\} full \/>/);
  // F59 · la composición se presenta con el arte real de los cinco (cuerpo entero; caras en móvil).
  assert.match(PARTIDO, /<AgentLineup agentIds=\{comp\.agentIds\}/);
  assert.match(PARTIDO, /<MatchSetup onPlay=\{onPlay\}/);
  assert.match(PARTIDO, /LivePlayerStrip snap=\{snap\} cards=\{cartasPorNombre\}/, "las fichas vivas llevan su carta");
});

/* ═══════════ FLUJO JUGAR ═══════════ */

const JUGAR = code(read("src", "app", "entrenador", "jugar", "page.tsx"));
const HUB = code(read("src", "app", "entrenador", "page.tsx"));
const COMPS = code(read("src", "app", "entrenador", "composiciones", "page.tsx"));

test("F511 J1 · el hub tiene JUGAR como acción protagonista", () => {
  assert.match(HUB, /href="\/entrenador\/jugar" className="nx-play-cta" data-testid="hub-play"/);
  for (const g of ["Preparación", "Análisis", "Equipo"]) assert.match(HUB, new RegExp(`titulo=(?:"${g}"|\\{(?:t|tr|i18nT)\\("${g}"\\)\\})`));
  const jugar = COACH_ROOMS.find((r) => r.href === "/entrenador/jugar");
  assert.ok(jugar?.primary, "JUGAR destacado en la navegación");
  assert.equal(COACH_ROOMS.filter((r) => r.primary).length, 1, "una sola sala destacada");
  assert.ok(isRoomActive("/entrenador/partido", jugar!), "el partido cuelga de JUGAR");
  for (const r of COACH_ROOMS) assert.ok(r.hint.length > 5, `${r.label} explica para qué sirve`);
});

/*
 * FASE 51.3 reemplaza el asistente equipo -> mapa -> composicion por UNA pantalla; 51.3.1 le quita el
 * editor: se elige composicion (o cinco agentes) y se juega. El pin se actualiza a ese contrato; el
 * detalle vive en `src/domain/tactics/f513.quickplay.test.tsx`.
 */
test("F511 J2 . JUGAR sin callejones (F51.3.1): elegir composicion o cinco agentes, y jugar", () => {
  for (const id of ["play-comp-list", "play-start", "play-new-comp", "play-loading", "play-error", "play-options"]) {
    assert.match(JUGAR, new RegExp(`data-testid="${id}"`), id);
  }
  assert.match(JUGAR, /<QuickComposer /, "el creador rapido de quick play, no el editor avanzado");
  assert.ok(!/<CompositionBuilder/.test(JUGAR), "el editor avanzado vive en COMPOSICIONES");
  assert.match(JUGAR, /quickPlayHref\(/, "la partida se lanza con el enlace validado");
});

test("F511 J3 · al guardar la composición se vuelve al flujo, a un destino FIJO", () => {
  assert.match(COMPS, /params\.get\("volver"\) === "jugar"/);
  assert.match(COMPS, /router\.push\(`\/entrenador\/jugar\?paso=composicion&map=/);
  assert.ok(!/router\.push\(params\.get/.test(COMPS), "no se sigue una URL arbitraria");
});

/* ═══════════ PLANTILLA: CARTAS ═══════════ */

const EDITOR = code(read("src", "components", "coach", "roster", "TeamRosterEditor.tsx"));
const EQUIPOS = code(read("src", "app", "entrenador", "equipos", "page.tsx"));

test("F511 C1 · titulares y colección son CardArt de la carta EXACTA (cardId), sin cajas de texto", () => {
  assert.match(EDITOR, /<CardArt src=\{c\.art\}/);
  assert.match(EDITOR, /data-card-id=\{c\?\.cardId\}/);
  assert.match(EDITOR, /data-card-id=\{c\.cardId\}/);
  assert.match(EDITOR, /setStarters\(team\.id, next\)/, "reemplazo/añadir por el store de siempre");
  assert.ok(!/palette\.primary|variantLabel\}<\/span>\s*<\/div>/.test(EDITOR), "sin las cajas de OVR/edición de antes");
  assert.ok(!/box-shadow|rounded-xl|border-2|ring-2/.test(EDITOR), "la carta sin marco ni caja");
  assert.match(EQUIPOS, /<TeamRosterEditor teamId=\{editing\.id\}/);
  assert.ok(!/palette\.primary/.test(EQUIPOS));
});

test("F511 C2 · las reglas del equipo no cambian: mismo jugador dos veces sigue prohibido", () => {
  assert.match(EDITOR, /jugadoresOcupados\.has\(c\.playerId\)\) return/);
  assert.match(EDITOR, /validateTeam\(team, resolveCardRef\)/);
});
