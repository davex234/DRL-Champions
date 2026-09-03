/**
 * MAPAS Y ESTRATEGIAS (Fase 9I).
 *
 * Dos cosas se comprueban aquí, y las dos importan por motivos distintos:
 *
 *   · Que los mapas son datos BIEN FORMADOS. Un polígono con dos vértices o un mapa sin
 *     bases no se ve raro: se ve vacío, y encontrar por qué en una pizarra cuesta mucho
 *     más que aquí.
 *   · Que `sanitizeStrat` es una FRONTERA de verdad. Es lo que corre en el servidor con lo
 *     que manda el cliente, así que se prueba con basura a propósito.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DUEL_ROLES } from "@/domain/cardgame";
import {
  TACTICAL_MAPS, getTacticalMap, zoneAt, zoneCenter, zoneContains,
  emptyStrat, sanitizeStrat, validateStrat, moveMarker, setMarkerTarget,
  addMarker, removeMarker, addStep, removeStep,
  MAX_MARKERS, MAX_STEPS, TEAM_SIZE,
} from "./index";

// ───────────────────────────── Mapas ─────────────────────────────

test("hay mapas y cada uno tiene identificador único", () => {
  assert.ok(TACTICAL_MAPS.length >= 4, "se esperaban al menos cuatro mapas");
  const ids = TACTICAL_MAPS.map((m) => m.id);
  assert.equal(new Set(ids).size, ids.length, "hay identificadores repetidos");
});

test("cada mapa tiene las dos bases y al menos un sitio", () => {
  for (const m of TACTICAL_MAPS) {
    const spawns = m.zones.filter((z) => z.kind === "spawn");
    assert.equal(spawns.length, 2, `${m.id}: se esperaban dos bases y hay ${spawns.length}`);
    assert.ok(
      spawns.some((z) => z.id.startsWith("atk")) && spawns.some((z) => z.id.startsWith("def")),
      `${m.id}: las bases deben distinguir ataque y defensa por su id`,
    );
    const sites = m.zones.filter((z) => z.kind === "site");
    assert.equal(sites.length, m.sites, `${m.id}: declara ${m.sites} sitios y define ${sites.length}`);
  }
});

test("todos los polígonos son válidos y caben en la rejilla 0..100", () => {
  for (const m of TACTICAL_MAPS) {
    for (const z of m.zones) {
      assert.ok(z.polygon.length >= 3, `${m.id}/${z.id}: un polígono necesita 3 vértices`);
      for (const [x, y] of z.polygon) {
        assert.ok(x >= 0 && x <= 100, `${m.id}/${z.id}: x fuera de rango (${x})`);
        assert.ok(y >= 0 && y <= 100, `${m.id}/${z.id}: y fuera de rango (${y})`);
      }
    }
  }
});

test("las zonas de un mapa no repiten identificador ni se quedan sin etiqueta", () => {
  for (const m of TACTICAL_MAPS) {
    const ids = m.zones.map((z) => z.id);
    assert.equal(new Set(ids).size, ids.length, `${m.id}: zonas con id repetido`);
    for (const z of m.zones) {
      assert.ok(z.label.trim().length > 0, `${m.id}/${z.id}: zona sin etiqueta`);
    }
  }
});

test("el centroide de una zona cae dentro de ella (mapas convexos incluidos)", () => {
  for (const m of TACTICAL_MAPS) {
    for (const z of m.zones) {
      // Solo se exige en polígonos convexos; los pasillos en diagonal de Meridiano no lo son.
      if (z.polygon.length !== 4) continue;
      const c = zoneCenter(z);
      assert.ok(zoneContains(z, c.x, c.y), `${m.id}/${z.id}: el centroide se sale de la zona`);
    }
  }
});

test("zoneAt encuentra la zona de un punto y devuelve null en terreno sin nombre", () => {
  const terminal = getTacticalMap("terminal")!;
  const siteA = terminal.zones.find((z) => z.id === "site-a")!;
  const c = zoneCenter(siteA);
  assert.equal(zoneAt(terminal, c.x, c.y)?.id, "site-a");
  // Una esquina del tablero que ningún polígono cubre.
  assert.equal(zoneAt(terminal, 0.5, 99.5), null);
});

test("cuando dos zonas se solapan gana la más específica (el cuello, no el pasillo)", () => {
  const terminal = getTacticalMap("terminal")!;
  // (30, 42) cae en Calle A y también en Boca A, que se declara después.
  const z = zoneAt(terminal, 30, 42);
  assert.equal(z?.id, "choke-a", `ganó «${z?.id}»`);
});

// ───────────────────────────── Estrategias ─────────────────────────────

test("una estrategia vacía nace jugable: cinco roles distintos y un paso", () => {
  const s = emptyStrat("x", "terminal", "attack");
  const players = s.markers.filter((m) => m.kind === "player");
  assert.equal(players.length, TEAM_SIZE);
  assert.deepEqual(players.map((p) => p.role).sort(), [...DUEL_ROLES].sort());
  assert.equal(s.steps.length, 1);
  assert.equal(validateStrat(s).ok, true, JSON.stringify(validateStrat(s).issues));
});

test("los jugadores empiezan en su base y no en el centro del mapa", () => {
  const atk = emptyStrat("a", "terminal", "attack");
  const def = emptyStrat("d", "terminal", "defense");
  const yAtk = atk.markers.filter((m) => m.kind === "player").map((m) => m.y);
  const yDef = def.markers.filter((m) => m.kind === "player").map((m) => m.y);
  assert.ok(Math.min(...yAtk) > 80, `el ataque no sale de su base: ${yAtk}`);
  assert.ok(Math.max(...yDef) < 20, `la defensa no sale de su base: ${yDef}`);
});

test("mover un marcador no muta la estrategia original y acota al tablero", () => {
  const s = emptyStrat("x", "terminal", "attack");
  const id = s.markers[0].id;
  const moved = moveMarker(s, id, 250, -40);
  assert.notEqual(moved, s, "debería devolver una estrategia nueva");
  assert.equal(s.markers[0].x, emptyStrat("x", "terminal", "attack").markers[0].x, "la original cambió");
  assert.equal(moved.markers[0].x, 100);
  assert.equal(moved.markers[0].y, 0);
});

test("el destino de un movimiento se pone y se quita", () => {
  const s = emptyStrat("x", "terminal", "attack");
  const id = s.markers[0].id;
  const withTo = setMarkerTarget(s, id, { x: 20, y: 30 });
  assert.deepEqual(withTo.markers[0].to, { x: 20, y: 30 });
  assert.equal(setMarkerTarget(withTo, id, null).markers[0].to, undefined);
});

test("un jugador no se puede borrar; una utilidad sí", () => {
  const s = emptyStrat("x", "terminal", "attack");
  const playerId = s.markers[0].id;
  assert.equal(removeMarker(s, playerId).markers.length, s.markers.length, "se borró un jugador");

  const withUtil = addMarker(s, { kind: "utility", x: 50, y: 50, label: "Humo", step: 0 });
  assert.equal(withUtil.markers.length, s.markers.length + 1);
  const utilId = withUtil.markers[withUtil.markers.length - 1].id;
  assert.equal(removeMarker(withUtil, utilId).markers.length, s.markers.length);
});

test("los pasos se ordenan por su momento y la apertura no se borra", () => {
  let s = emptyStrat("x", "terminal", "attack");
  s = addStep(s, "Ejecución", 40);
  s = addStep(s, "Contacto", 15);
  assert.deepEqual(s.steps.map((p) => p.at), [0, 15, 40]);
  assert.equal(removeStep(s, s.steps[0].id).steps.length, 3, "se borró la apertura");
  assert.equal(removeStep(s, s.steps[1].id).steps.length, 2);
});

test("los topes existen y se respetan", () => {
  let s = emptyStrat("x", "terminal", "attack");
  for (let i = 0; i < MAX_MARKERS + 10; i++) {
    s = addMarker(s, { kind: "note", x: 50, y: 50, label: `n${i}`, step: 0 });
  }
  assert.equal(s.markers.length, MAX_MARKERS);

  let t = emptyStrat("y", "terminal", "attack");
  for (let i = 0; i < MAX_STEPS + 5; i++) t = addStep(t, `p${i}`, i + 1);
  assert.equal(t.steps.length, MAX_STEPS);
});

// ───────────────────────────── La frontera del servidor ─────────────────────────────

test("sanitizeStrat rechaza lo que no es una estrategia", () => {
  for (const basura of [null, undefined, 42, "hola", [], {}, { mapId: "no-existe" }]) {
    assert.equal(sanitizeStrat(basura, "id"), null, `aceptó ${JSON.stringify(basura)}`);
  }
});

test("sanitizeStrat acota coordenadas, longitudes y cantidades", () => {
  const s = sanitizeStrat({
    id: "x".repeat(500),
    name: "  ",
    mapId: "terminal",
    side: "lo-que-sea",
    notes: "n".repeat(5000),
    steps: Array.from({ length: 50 }, (_, i) => ({ id: `s${i}`, at: -10, label: "L".repeat(200), notes: "" })),
    markers: Array.from({ length: 200 }, (_, i) => ({
      id: `m${i}`, kind: "loquesea", x: "999", y: 1e9, label: "L".repeat(200), step: 99,
    })),
  }, "fallback")!;

  assert.ok(s, "debería aceptarse tras el saneado");
  assert.equal(s.side, "attack", "un bando desconocido cae al ataque");
  assert.equal(s.name, "Estrategia", "un nombre en blanco recibe uno por defecto");
  assert.ok(s.id.length <= 64);
  assert.ok(s.notes.length <= 1000);
  assert.ok(s.steps.length <= MAX_STEPS);
  assert.ok(s.markers.length <= MAX_MARKERS);
  for (const m of s.markers) {
    assert.ok(m.x >= 0 && m.x <= 100, `x sin acotar: ${m.x}`);
    assert.ok(m.y >= 0 && m.y <= 100, `y sin acotar: ${m.y}`);
    assert.ok(m.label.length <= 40);
    assert.ok(m.step >= 0 && m.step < s.steps.length, `paso fuera de rango: ${m.step}`);
    assert.equal(m.kind, "note", "un tipo desconocido cae a nota");
  }
  for (const p of s.steps) {
    assert.ok(p.at >= 0, `momento negativo: ${p.at}`);
    assert.ok(p.label.length <= 60);
  }
});

test("sanitizeStrat conserva una estrategia legítima tal cual", () => {
  const original = emptyStrat("real", "orbita", "defense", "Retén doble");
  const round = sanitizeStrat(JSON.parse(JSON.stringify(original)), "otro")!;
  assert.equal(round.id, "real");
  assert.equal(round.name, "Retén doble");
  assert.equal(round.mapId, "orbita");
  assert.equal(round.side, "defense");
  assert.equal(round.markers.length, original.markers.length);
  assert.deepEqual(
    round.markers.filter((m) => m.kind === "player").map((m) => m.role).sort(),
    [...DUEL_ROLES].sort(),
    "los roles no sobreviven al saneado",
  );
});

test("validateStrat detecta equipo incompleto, rol repetido y mapa inexistente", () => {
  const base = emptyStrat("x", "terminal", "attack");

  const sinUno = { ...base, markers: base.markers.slice(1) };
  assert.ok(validateStrat(sinUno).issues.some((i) => i.code === "TEAM_SIZE"));

  const repetido = {
    ...base,
    markers: base.markers.map((m, i) => (i === 0 ? { ...m, role: base.markers[1].role } : m)),
  };
  assert.ok(validateStrat(repetido).issues.some((i) => i.code === "ROLE_DUPLICATE"));

  assert.ok(validateStrat({ ...base, mapId: "atlantida" }).issues.some((i) => i.code === "MAP_UNKNOWN"));
  assert.ok(validateStrat({ ...base, steps: [] }).issues.some((i) => i.code === "NO_STEPS"));
});
