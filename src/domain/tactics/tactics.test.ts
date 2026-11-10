/**
 * MAPAS Y ESTRATEGIAS.
 *
 * Dos cosas se comprueban aquí, y las dos importan por motivos distintos:
 *
 *   · Que el CATÁLOGO de mapas dice la verdad sobre los assets: dimensiones reales,
 *     proporciones distintas y encuadres que caben en su lienzo. Un mapa mal declarado no
 *     se ve raro: se ve estirado, y encontrar por qué en una pizarra cuesta mucho más que
 *     aquí.
 *   · Que `sanitizeStrat` es una FRONTERA de verdad. Es lo que corre en el servidor con lo
 *     que manda el cliente, así que se prueba con basura a propósito.
 *
 * Y una tercera que solo existe desde el formato 2: que **los pasos son independientes**.
 * Si dos pasos compartieran un objeto, mover una ficha en el paso 3 la movería también en
 * el 1 y el editor mentiría sin dar ningún error.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TACTICAL_MAPS, availableMaps, getTacticalMap, aspectRatio, toPixels, toGrid,
  zoneAt, zoneCenter, zoneContains,
  emptyStrat, sanitizeStrat, validateStrat, cloneStrat,
  addStep, removeStep, renameStep, updateStep,
  addPlayer, addUtility, addDrawing, addAnnotation, moveObject, removeObject, setTarget,
  countObjects, emptyStepState, STRAT_VERSION, MAX_STEPS, TEAM_SIZE, MAX_UTILITIES,
  MAX_ANNOTATIONS, MAX_POINTS, MAX_TAGS, DRAW_COLORS,
  type StepState, type Strat,
} from "./index";

// ───────────────────────────── Mapas ─────────────────────────────

test("están los doce mapas del Entrenador y ninguno repite identificador", () => {
  assert.equal(TACTICAL_MAPS.length, 12, `se esperaban 12 mapas y hay ${TACTICAL_MAPS.length}`);
  const ids = TACTICAL_MAPS.map((m) => m.id);
  assert.equal(new Set(ids).size, ids.length, "hay identificadores repetidos");
  assert.equal(availableMaps().length, 12, "los doce deben poder elegirse");
});

test("los cuatro trazados retirados ya no están en el catálogo", () => {
  for (const viejo of ["terminal", "cantera", "orbita", "meridiano"]) {
    assert.equal(getTacticalMap(viejo), undefined, `«${viejo}» sigue en el catálogo`);
  }
});

test("cada mapa apunta a su propio asset, sin rutas escritas a mano", () => {
  for (const m of TACTICAL_MAPS) {
    assert.equal(m.asset, `${m.id}.png`, `${m.id}: el asset no corresponde al id`);
    assert.ok(!m.asset.includes("/"), `${m.id}: el asset no debe llevar ruta, la pone mapImageSrc`);
    assert.ok(m.name.trim().length > 0, `${m.id}: sin nombre visible`);
  }
});

test("cada mapa conserva sus dimensiones REALES y ninguna es cuadrada por defecto", () => {
  for (const m of TACTICAL_MAPS) {
    assert.ok(Number.isInteger(m.width) && m.width > 0, `${m.id}: anchura inválida`);
    assert.ok(Number.isInteger(m.height) && m.height > 0, `${m.id}: altura inválida`);
    const r = aspectRatio(m);
    assert.ok(r > 0.5 && r < 2, `${m.id}: proporción fuera de lo razonable (${r})`);
  }
  /*
   * La prueba que impide volver al `viewBox="0 0 100 100"` universal: si alguien
   * «normalizara» los mapas a un cuadrado, todos tendrían la misma proporción y esto
   * fallaría. Once proporciones distintas de doce (Bind es 1:1) es lo que hay.
   */
  const ratios = new Set(TACTICAL_MAPS.map((m) => aspectRatio(m).toFixed(4)));
  assert.ok(ratios.size >= 10, `se esperaban proporciones distintas y hay ${ratios.size}`);
});

test("el encuadre cae DENTRO del lienzo y no es un recorte del asset", () => {
  for (const m of TACTICAL_MAPS) {
    const f = m.frame;
    assert.ok(f.x >= 0 && f.y >= 0, `${m.id}: el encuadre empieza fuera del lienzo`);
    assert.ok(f.x + f.width <= m.width, `${m.id}: el encuadre se sale por la derecha`);
    assert.ok(f.y + f.height <= m.height, `${m.id}: el encuadre se sale por abajo`);
    // Un encuadre que cubriera menos de la mitad del lienzo sería un recorte, no un encuadre.
    const cobertura = (f.width * f.height) / (m.width * m.height);
    assert.ok(cobertura > 0.5, `${m.id}: el encuadre solo cubre el ${(cobertura * 100).toFixed(0)} %`);
  }
});

test("los sitios declarados son los verificados sobre cada asset", () => {
  const tres = new Set(["haven", "lotus"]);
  for (const m of TACTICAL_MAPS) {
    assert.equal(m.sites, tres.has(m.id) ? 3 : 2, `${m.id}: declara ${m.sites} sitios`);
    assert.ok(m.identity.trim().length > 0, `${m.id}: sin línea de identidad`);
  }
});

test("las zonas son OPCIONALES y no se inventan a partir del PNG", () => {
  for (const m of TACTICAL_MAPS) {
    assert.equal(m.zones, undefined, `${m.id}: trae zonas que nadie ha definido a mano`);
    // Sin zonas, la pregunta «¿qué zona hay aquí?» tiene una respuesta honesta: ninguna.
    assert.equal(zoneAt(m, 50, 50), null, `${m.id}: zoneAt debería devolver null`);
  }
});

test("la rejilla 0..100 y los píxeles del mapa se convierten en los dos sentidos", () => {
  for (const m of TACTICAL_MAPS) {
    const { px, py } = toPixels(m, 25, 75);
    assert.ok(Math.abs(px - m.width * 0.25) < 1e-6, `${m.id}: x mal convertida`);
    assert.ok(Math.abs(py - m.height * 0.75) < 1e-6, `${m.id}: y mal convertida`);
    const back = toGrid(m, px, py);
    assert.ok(Math.abs(back.x - 25) < 1e-6 && Math.abs(back.y - 75) < 1e-6, `${m.id}: ida y vuelta no cuadra`);
  }
});

test("las utilidades de zona siguen siendo correctas sobre un polígono definido a mano", () => {
  const zona = {
    id: "z", label: "Prueba", kind: "site" as const,
    polygon: [[10, 10], [30, 10], [30, 30], [10, 30]] as const,
  };
  const c = zoneCenter(zona);
  assert.deepEqual(c, { x: 20, y: 20 });
  assert.ok(zoneContains(zona, 20, 20));
  assert.ok(!zoneContains(zona, 5, 5));
});

// ───────────────────────────── Estrategias ─────────────────────────────

const primera = (s: Strat): StepState => s.steps[0].state;

test("una estrategia vacía nace jugable: cinco roles distintos y un paso", () => {
  const s = emptyStrat("x", "ascent", "attack");
  assert.equal(s.version, STRAT_VERSION);
  assert.equal(s.steps.length, 1);
  assert.equal(primera(s).players.length, TEAM_SIZE);
  const roles = primera(s).players.map((p) => p.role);
  assert.equal(new Set(roles).size, TEAM_SIZE, "hay roles repetidos");
  assert.ok(validateStrat(s).ok, JSON.stringify(validateStrat(s).issues));
});

test("los dos bandos empiezan en lados opuestos del mapa", () => {
  const atk = emptyStrat("a", "ascent", "attack");
  const def = emptyStrat("d", "ascent", "defense");
  assert.ok(primera(atk).players[0].y > primera(def).players[0].y,
    "el ataque debería nacer más abajo que la defensa");
});

// ── El corazón del formato 2: cada paso guarda SU estado ──

test("añadir un paso lo siembra con el estado del anterior", () => {
  let s = emptyStrat("x", "ascent", "attack");
  s = updateStep(s, 0, (st) => addUtility(st, "smoke", 40, 40));
  s = addStep(s);
  assert.equal(s.steps.length, 2);
  assert.equal(s.steps[1].state.players.length, TEAM_SIZE, "el paso 2 no heredó a los jugadores");
  assert.equal(s.steps[1].state.utilities.length, 1, "el paso 2 no heredó la utilidad");
});

test("mover una ficha en el paso 2 NO la mueve en el paso 1", () => {
  let s = emptyStrat("x", "ascent", "attack");
  s = addStep(s);
  const id = s.steps[1].state.players[0].id;
  const antes = { x: s.steps[0].state.players[0].x, y: s.steps[0].state.players[0].y };
  s = updateStep(s, 1, (st) => moveObject(st, id, 12, 34));

  assert.deepEqual(
    { x: s.steps[1].state.players[0].x, y: s.steps[1].state.players[0].y },
    { x: 12, y: 34 },
    "el paso 2 no se movió",
  );
  assert.deepEqual(
    { x: s.steps[0].state.players[0].x, y: s.steps[0].state.players[0].y },
    antes,
    "mover en el paso 2 arrastró al paso 1: los pasos comparten objetos",
  );
});

test("los pasos no comparten NINGUNA referencia mutable", () => {
  let s = emptyStrat("x", "ascent", "attack");
  s = updateStep(s, 0, (st) => addDrawing(st, "arrow", DRAW_COLORS[0], [{ x: 10, y: 10 }, { x: 20, y: 20 }]));
  s = addStep(s);
  const a = s.steps[0].state;
  const b = s.steps[1].state;
  assert.notEqual(a.players, b.players);
  assert.notEqual(a.players[0], b.players[0]);
  assert.notEqual(a.drawings[0], b.drawings[0]);
  assert.notEqual(a.drawings[0].points, b.drawings[0].points);
  assert.notEqual(a.drawings[0].points[0], b.drawings[0].points[0]);
});

test("clonar una estrategia entera no deja nada compartido con la original", () => {
  let s = emptyStrat("x", "ascent", "attack");
  s = updateStep(s, 0, (st) => addAnnotation(st, "ojo aquí", 50, 50));
  s = addStep(s);
  const copia = cloneStrat(s);
  copia.steps[0].state.players[0].x = 1;
  copia.steps[0].state.annotations[0].text = "cambiado";
  assert.notEqual(s.steps[0].state.players[0].x, 1, "la original se movió con la copia");
  assert.equal(s.steps[0].state.annotations[0].text, "ojo aquí");
  assert.equal(copia.steps.length, s.steps.length);
});

test("el primer paso no se borra; los demás sí", () => {
  let s = emptyStrat("x", "ascent", "attack");
  s = addStep(s);
  s = addStep(s);
  assert.equal(s.steps.length, 3);
  s = removeStep(s, 0);
  assert.equal(s.steps.length, 3, "se borró la apertura");
  s = removeStep(s, 2);
  assert.equal(s.steps.length, 2);
});

test("un paso se renombra sin tocar su estado", () => {
  let s = emptyStrat("x", "ascent", "attack");
  const estado = s.steps[0].state;
  s = renameStep(s, 0, "Ejecución", "entrar por A");
  assert.equal(s.steps[0].label, "Ejecución");
  assert.equal(s.steps[0].notes, "entrar por A");
  assert.equal(s.steps[0].state, estado, "renombrar reconstruyó el estado sin necesidad");
});

// ── Objetos ──

test("se añaden y se quitan jugadores, utilidades, dibujos y anotaciones", () => {
  let st: StepState = emptyStepState();
  st = addPlayer(st, "Duelista", 10, 10);
  st = addUtility(st, "flash", 20, 20);
  st = addDrawing(st, "arrow", DRAW_COLORS[1], [{ x: 0, y: 0 }, { x: 50, y: 50 }]);
  st = addAnnotation(st, "nota", 30, 30);
  assert.equal(countObjects(st), 4);

  st = removeObject(st, st.utilities[0].id);
  assert.equal(st.utilities.length, 0);
  assert.equal(countObjects(st), 3);
});

test("los topes por paso se respetan", () => {
  let st: StepState = emptyStepState();
  for (let i = 0; i < TEAM_SIZE + 3; i++) st = addPlayer(st, "Duelista", 5, 5);
  assert.equal(st.players.length, TEAM_SIZE, "se colaron más de cinco jugadores");
  for (let i = 0; i < MAX_UTILITIES + 5; i++) st = addUtility(st, "smoke", 5, 5);
  assert.equal(st.utilities.length, MAX_UTILITIES);
  for (let i = 0; i < MAX_ANNOTATIONS + 5; i++) st = addAnnotation(st, "n", 5, 5);
  assert.equal(st.annotations.length, MAX_ANNOTATIONS);

  let s = emptyStrat("x", "ascent", "attack");
  for (let i = 0; i < MAX_STEPS + 5; i++) s = addStep(s);
  assert.equal(s.steps.length, MAX_STEPS);
});

test("un dibujo necesita al menos dos puntos y no admite un color inventado", () => {
  let st: StepState = emptyStepState();
  st = addDrawing(st, "line", DRAW_COLORS[0], [{ x: 1, y: 1 }]);
  assert.equal(st.drawings.length, 0, "aceptó un dibujo de un solo punto");

  const sucio = sanitizeStrat({
    mapId: "ascent",
    steps: [{
      state: {
        drawings: [{
          kind: "line", color: "javascript:alert(1)",
          points: [{ x: 1, y: 1 }, { x: 2, y: 2 }],
        }],
      },
    }],
  }, "x")!;
  assert.equal(sucio.steps[0].state.drawings[0].color, DRAW_COLORS[0], "coló un color fuera de la paleta");
});

test("una flecha de movimiento se pone y se quita", () => {
  let s = emptyStrat("x", "ascent", "attack");
  const id = primera(s).players[0].id;
  s = updateStep(s, 0, (st) => setTarget(st, id, { x: 60, y: 60 }));
  assert.deepEqual(s.steps[0].state.players[0].to, { x: 60, y: 60 });
  s = updateStep(s, 0, (st) => setTarget(st, id, null));
  assert.equal(s.steps[0].state.players[0].to, undefined);
});

test("la punta de una flecha se arrastra con el sufijo ::to", () => {
  let s = emptyStrat("x", "ascent", "attack");
  const id = primera(s).players[0].id;
  const x0 = primera(s).players[0].x;
  s = updateStep(s, 0, (st) => setTarget(st, id, { x: 60, y: 60 }));
  s = updateStep(s, 0, (st) => moveObject(st, `${id}::to`, 70, 20));
  assert.deepEqual(s.steps[0].state.players[0].to, { x: 70, y: 20 });
  assert.equal(s.steps[0].state.players[0].x, x0, "arrastrar la punta movió la ficha");
});

// ── La frontera ──

test("sanitizeStrat rechaza lo que no es una estrategia", () => {
  assert.equal(sanitizeStrat(null, "x"), null);
  assert.equal(sanitizeStrat("texto", "x"), null);
  assert.equal(sanitizeStrat({}, "x"), null, "sin mapa no hay estrategia");
  assert.equal(sanitizeStrat({ mapId: "no-existe" }, "x"), null);
});

test("sanitizeStrat acota coordenadas, longitudes y cantidades", () => {
  const s = sanitizeStrat({
    mapId: "ascent",
    side: "lo-que-sea",
    name: "N".repeat(400),
    description: "D".repeat(2000),
    tags: Array.from({ length: 40 }, (_, i) => `etiqueta-larguisima-${i}`),
    notes: "x".repeat(5000),
    steps: Array.from({ length: 60 }, () => ({
      label: "L".repeat(300), at: 99999,
      state: {
        players: Array.from({ length: 30 }, () => ({ role: "Duelista", x: 1e9, y: -1e9 })),
        utilities: Array.from({ length: 200 }, () => ({ kind: "inventada", x: 5, y: 5 })),
        annotations: Array.from({ length: 200 }, () => ({ text: "t".repeat(999), x: 5, y: 5 })),
        drawings: [{
          kind: "loquesea", color: "#zzz",
          points: Array.from({ length: 500 }, () => ({ x: 5, y: 5 })),
        }],
      },
    })),
  }, "fb")!;

  assert.ok(s, "una estrategia exagerada pero con mapa válido debe salir saneada");
  assert.equal(s.side, "attack", "un bando inventado cae a ataque");
  assert.ok(s.name.length <= 60);
  assert.ok(s.description.length <= 600);
  assert.ok(s.tags.length <= MAX_TAGS);
  assert.ok(s.notes.length <= 1000);
  assert.equal(s.steps.length, MAX_STEPS);

  for (const st of s.steps) {
    assert.ok(st.at <= 600);
    assert.ok(st.label.length <= 60);
    assert.equal(st.state.players.length, TEAM_SIZE);
    assert.equal(st.state.utilities.length, MAX_UTILITIES);
    assert.equal(st.state.annotations.length, MAX_ANNOTATIONS);
    assert.ok(st.state.drawings[0].points.length <= MAX_POINTS);
    for (const p of st.state.players) {
      assert.ok(p.x >= 0 && p.x <= 100 && p.y >= 0 && p.y <= 100, "coordenada sin acotar");
    }
    assert.equal(st.state.utilities[0].kind, "marker", "una utilidad inventada cae a marcador");
  }
});

test("sanitizeStrat conserva una estrategia legítima tal cual", () => {
  let original = emptyStrat("real", "haven", "defense", "Retén doble");
  original = updateStep(original, 0, (st) => addUtility(st, "wall", 33, 44));
  original = addStep(original, "Rotación", 20);
  const round = sanitizeStrat(JSON.parse(JSON.stringify(original)), "otro")!;
  assert.equal(round.mapId, "haven");
  assert.equal(round.side, "defense");
  assert.equal(round.name, "Retén doble");
  assert.equal(round.steps.length, 2);
  assert.equal(round.steps[1].label, "Rotación");
  assert.equal(round.steps[0].state.utilities[0].kind, "wall");
  assert.deepEqual(round.steps[0].state.players, original.steps[0].state.players);
});

test("una estrategia del FORMATO 1 se migra sin perder nada", () => {
  const v1 = {
    id: "vieja", name: "Ejecución A", mapId: "ascent", side: "attack", version: 1, notes: "de antes",
    steps: [
      { id: "s0", at: 0, label: "Apertura", notes: "" },
      { id: "s1", at: 20, label: "Entrada", notes: "" },
    ],
    markers: [
      { id: "p0", kind: "player", role: "Duelista", label: "Duelista", x: 40, y: 90, step: 0 },
      { id: "p1", kind: "player", role: "Centinela", label: "Centinela", x: 46, y: 90, step: 0 },
      { id: "m1", kind: "utility", label: "Humo", x: 50, y: 50, step: 1 },
      { id: "n1", kind: "note", label: "cuidado", x: 60, y: 60, step: 1 },
    ],
  };

  const s = sanitizeStrat(v1, "x")!;
  assert.ok(s, "la migración devolvió null");
  assert.equal(s.version, STRAT_VERSION);
  assert.equal(s.steps.length, 2);
  assert.equal(s.steps[0].state.players.length, 2);
  assert.equal(s.steps[0].state.utilities.length, 0, "la utilidad del paso 2 se coló en el 1");
  // Lo que aparecía en el paso 2 sigue existiendo en el paso 2, junto a lo del paso 1.
  assert.equal(s.steps[1].state.players.length, 2);
  assert.equal(s.steps[1].state.utilities.length, 1);
  assert.equal(s.steps[1].state.annotations[0].text, "cuidado");
  assert.ok(validateStrat(s).ok, JSON.stringify(validateStrat(s).issues));
});

test("validateStrat detecta rol repetido, exceso de jugadores y mapa inexistente", () => {
  const s = emptyStrat("x", "ascent", "attack");
  assert.ok(validateStrat(s).ok);

  const roto = { ...s, mapId: "no-existe" };
  assert.ok(validateStrat(roto).issues.some((i) => i.code === "MAP_UNKNOWN"));

  const repes = updateStep(s, 0, (st) => ({
    ...st,
    players: st.players.map((p) => ({ ...p, role: "Duelista" as const })),
  }));
  assert.ok(validateStrat(repes).issues.some((i) => i.code === "ROLE_DUPLICATE"));

  const fuera = updateStep(s, 0, (st) => ({
    ...st,
    players: st.players.map((p, i) => (i === 0 ? { ...p, x: 999 } : p)),
  }));
  assert.ok(validateStrat(fuera).issues.some((i) => i.code === "OUT_OF_BOUNDS"));
});
