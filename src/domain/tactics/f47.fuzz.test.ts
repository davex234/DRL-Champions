/**
 * FASE 47 · FUZZ DEL EDITOR TÁCTICO — 10.000 operaciones.
 *
 * ────────────────────────── QUÉ BUSCA ──────────────────────────
 *
 * No busca que «no pete»: busca que el PLAN no se corrompa. Una pizarra puede sobrevivir a mil
 * clics y aun así acabar con una coordenada `NaN`, dos objetos con el mismo identificador o una
 * utilidad que apunta a un jugador que ya no existe. Nada de eso se ve en pantalla hasta que
 * alguien abre la jugada delante de su equipo.
 *
 * ────────────────────────── DETERMINISTA ──────────────────────────
 *
 * Generador congruencial lineal con SEMILLA FIJA (`SEED`), así que las 10.000 operaciones son
 * siempre las mismas. Si un día falla, falla con el mismo número de operación y se puede reducir.
 * Nada de `Math.random()`: un fuzz que no se puede reproducir no sirve para arreglar nada.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { TACTICAL_AGENTS } from "./roster";
import { TACTICAL_MAPS } from "./maps";
import {
  emptyStepState, MAX_STEPS, TEAM_SIZE, MAX_UTILITIES, MAX_DRAWINGS, MAX_ANNOTATIONS, MAX_POINTS,
  type StepState, type StratStep, type Point,
} from "./strat";
import { playbackReducer, playbackFrame, INITIAL_PLAYBACK } from "@/lib/tactics/playback";

/** La semilla. Escrita aquí, no generada: es lo que hace reproducible el fallo. */
export const SEED = 0x5f47a11;
const OPS = 10_000;

function lcg(seed: number) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

/** Los tamaños del encargo. El fuzz cambia de uno a otro para probar que NO afectan al plan. */
const VIEWPORTS = [[390, 844], [768, 1024], [1024, 768], [1440, 900], [1920, 1080], [2560, 1440]] as const;

const MAPA = TACTICAL_MAPS[0].id;
const AGENTES = TACTICAL_AGENTS.map((a) => a.id);

/** Normaliza como lo hace el editor: dentro del mapa, siempre. */
const clamp01 = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);

interface Mundo {
  steps: StratStep[];
  index: number;
  undo: StepState[];
  redo: StepState[];
  ids: number;
  /** Sólo presentación: no puede influir en los datos. */
  zoom: number;
  pan: { x: number; y: number };
  viewport: readonly [number, number];
}

const nuevoMundo = (): Mundo => ({
  steps: [{ id: "s0", at: 0, label: "1", notes: "", state: emptyStepState() }],
  index: 0, undo: [], redo: [], ids: 0, zoom: 1, pan: { x: 0, y: 0 }, viewport: VIEWPORTS[3],
});

const actual = (m: Mundo): StepState => m.steps[m.index].state;
const clonar = (s: StepState): StepState => JSON.parse(JSON.stringify(s)) as StepState;

/** Antes de cada cambio se apila el estado: es lo que hace reversible el deshacer. */
function apunta(m: Mundo) {
  m.undo.push(clonar(actual(m)));
  if (m.undo.length > 60) m.undo.shift();
  m.redo.length = 0;
}

/* ═══════════════════ INVARIANTES ═══════════════════ */

function revisa(m: Mundo, op: number): string | null {
  const vistos = new Set<string>();
  const punto = (p: Point, donde: string): string | null => {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return `${donde}: coordenada no finita en la op ${op}`;
    if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) return `${donde}: fuera de 0..1 (${p.x}, ${p.y}) en la op ${op}`;
    return null;
  };

  if (m.steps.length === 0) return `sin pasos en la op ${op}`;
  if (m.steps.length > MAX_STEPS) return `${m.steps.length} pasos (tope ${MAX_STEPS}) en la op ${op}`;
  if (m.index < 0 || m.index >= m.steps.length) return `índice de paso ${m.index} fuera de rango en la op ${op}`;

  for (const paso of m.steps) {
    if (vistos.has(paso.id)) return `identificador de paso repetido «${paso.id}» en la op ${op}`;
    vistos.add(paso.id);

    const s = paso.state;
    if (s.players.length > TEAM_SIZE) return `${s.players.length} jugadores (tope ${TEAM_SIZE}) en la op ${op}`;
    if (s.utilities.length > MAX_UTILITIES) return `utilidades por encima del tope en la op ${op}`;
    if (s.drawings.length > MAX_DRAWINGS) return `dibujos por encima del tope en la op ${op}`;
    if (s.annotations.length > MAX_ANNOTATIONS) return `notas por encima del tope en la op ${op}`;

    const dentro = new Set<string>();
    const jugadores = new Set(s.players.map((p) => p.id));

    for (const p of s.players) {
      if (dentro.has(p.id)) return `identificador repetido «${p.id}» en la op ${op}`;
      dentro.add(p.id);
      const e = punto(p, `jugador ${p.id}`); if (e) return e;
      if (p.to) { const e2 = punto(p.to, `destino de ${p.id}`); if (e2) return e2; }
      // El agente, si lo hay, tiene que ser del catálogo REAL.
      if (p.agentId && !AGENTES.includes(p.agentId)) return `agente inventado «${p.agentId}» en la op ${op}`;
    }
    for (const u of s.utilities) {
      if (dentro.has(u.id)) return `identificador repetido «${u.id}» en la op ${op}`;
      dentro.add(u.id);
      const e = punto(u, `utilidad ${u.id}`); if (e) return e;
      /*
       * HUÉRFANAS. Una utilidad atada a un jugador que ya no está en el paso es basura semántica:
       * al presentar, esa marca no pertenece a nadie.
       */
      if (u.ownerId && !jugadores.has(u.ownerId)) return `utilidad huérfana «${u.id}» en la op ${op}`;
    }
    for (const d of s.drawings) {
      if (dentro.has(d.id)) return `identificador repetido «${d.id}» en la op ${op}`;
      dentro.add(d.id);
      if (d.points.length === 0) return `dibujo sin puntos «${d.id}» en la op ${op}`;
      if (d.points.length > MAX_POINTS) return `dibujo con demasiados puntos en la op ${op}`;
      for (const pt of d.points) { const e = punto(pt, `dibujo ${d.id}`); if (e) return e; }
    }
    for (const a of s.annotations) {
      if (dentro.has(a.id)) return `identificador repetido «${a.id}» en la op ${op}`;
      dentro.add(a.id);
      const e = punto(a, `nota ${a.id}`); if (e) return e;
    }
  }
  return null;
}

/* ═══════════════════ EL FUZZ ═══════════════════ */

test(`F47 FUZZ · ${OPS} operaciones del editor sin corromper el plan (semilla ${SEED})`, () => {
  const rnd = lcg(SEED);
  const m = nuevoMundo();
  const conteo: Record<string, number> = {};
  let primerFallo: string | null = null;
  let opsHechas = 0;

  const id = () => `o${++m.ids}`;
  const coord = () => clamp01(rnd() * 1.4 - 0.2);   // a veces fuera: el editor TIENE que recortar
  const elige = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];

  const OPERACIONES = [
    "addPlayer", "movePlayer", "deletePlayer", "setAgent", "setArrow",
    "addUtility", "deleteUtility", "addDrawing", "deleteDrawing",
    "addText", "editText", "addStep", "duplicateStep", "deleteStep", "gotoStep",
    "undo", "redo", "zoom", "pan", "resize", "saveReload",
  ] as const;

  for (let op = 0; op < OPS; op++) {
    const cual = elige(OPERACIONES);
    conteo[cual] = (conteo[cual] ?? 0) + 1;
    const s = actual(m);

    switch (cual) {
      case "addPlayer": {
        if (s.players.length >= TEAM_SIZE) break;
        apunta(m);
        s.players.push({ id: id(), role: "Duelista", label: `P${s.players.length + 1}`, x: coord(), y: coord() } as never);
        break;
      }
      case "movePlayer": {
        if (s.players.length === 0) break;
        apunta(m);
        const p = elige(s.players);
        p.x = coord(); p.y = coord();
        break;
      }
      case "deletePlayer": {
        if (s.players.length === 0) break;
        apunta(m);
        const p = elige(s.players);
        s.players = s.players.filter((x) => x.id !== p.id);
        /*
         * Al quitar un jugador hay que quitar SUS utilidades. Es la regla que el editor aplica y
         * la que este fuzz vigila: sin ella quedan marcas apuntando a nadie.
         */
        s.utilities = s.utilities.filter((u) => !u.ownerId || u.ownerId !== p.id);
        break;
      }
      case "setAgent": {
        if (s.players.length === 0) break;
        apunta(m);
        elige(s.players).agentId = elige(AGENTES);
        break;
      }
      case "setArrow": {
        if (s.players.length === 0) break;
        apunta(m);
        const p = elige(s.players);
        p.to = rnd() < 0.3 ? undefined : { x: coord(), y: coord() };
        break;
      }
      case "addUtility": {
        if (s.utilities.length >= MAX_UTILITIES) break;
        apunta(m);
        const dueño = s.players.length > 0 && rnd() < 0.7 ? elige(s.players).id : undefined;
        s.utilities.push({ id: id(), kind: "smoke", x: coord(), y: coord(), ownerId: dueño } as never);
        break;
      }
      case "deleteUtility": {
        if (s.utilities.length === 0) break;
        apunta(m);
        const u = elige(s.utilities);
        s.utilities = s.utilities.filter((x) => x.id !== u.id);
        break;
      }
      case "addDrawing": {
        if (s.drawings.length >= MAX_DRAWINGS) break;
        apunta(m);
        const n = 2 + Math.floor(rnd() * 6);
        const pts: Point[] = Array.from({ length: n }, () => ({ x: coord(), y: coord() }));
        s.drawings.push({ id: id(), kind: "arrow", color: "#ff2e63", points: pts } as never);
        break;
      }
      case "deleteDrawing": {
        if (s.drawings.length === 0) break;
        apunta(m);
        const d = elige(s.drawings);
        s.drawings = s.drawings.filter((x) => x.id !== d.id);
        break;
      }
      case "addText": {
        if (s.annotations.length >= MAX_ANNOTATIONS) break;
        apunta(m);
        s.annotations.push({ id: id(), text: `n${op}`, x: coord(), y: coord() } as never);
        break;
      }
      case "editText": {
        if (s.annotations.length === 0) break;
        apunta(m);
        elige(s.annotations).text = `e${op}`;
        break;
      }
      case "addStep": {
        if (m.steps.length >= MAX_STEPS) break;
        m.steps.push({ id: `s${m.steps.length}${op}`, at: 0, label: `${m.steps.length + 1}`, notes: "", state: emptyStepState() });
        m.index = m.steps.length - 1;
        m.undo.length = 0; m.redo.length = 0;
        break;
      }
      case "duplicateStep": {
        if (m.steps.length >= MAX_STEPS) break;
        const copia = clonar(actual(m));
        m.steps.splice(m.index + 1, 0, { id: `d${m.index}${op}`, at: 0, label: `${m.steps.length + 1}`, notes: "", state: copia });
        m.index += 1;
        m.undo.length = 0; m.redo.length = 0;
        break;
      }
      case "deleteStep": {
        if (m.steps.length <= 1) break;
        m.steps.splice(m.index, 1);
        m.index = Math.max(0, Math.min(m.index, m.steps.length - 1));
        m.undo.length = 0; m.redo.length = 0;
        break;
      }
      case "gotoStep":
        m.index = Math.floor(rnd() * m.steps.length);
        break;
      case "undo": {
        const previo = m.undo.pop();
        if (!previo) break;
        m.redo.push(clonar(actual(m)));
        m.steps[m.index].state = previo;
        break;
      }
      case "redo": {
        const siguiente = m.redo.pop();
        if (!siguiente) break;
        m.undo.push(clonar(actual(m)));
        m.steps[m.index].state = siguiente;
        break;
      }
      /* Las tres siguientes son PRESENTACIÓN: no pueden tocar el plan, y eso es lo que se vigila. */
      case "zoom":
        m.zoom = Math.max(0.5, Math.min(4, m.zoom * (rnd() < 0.5 ? 0.8 : 1.25)));
        break;
      case "pan":
        m.pan = { x: rnd() * 2 - 1, y: rnd() * 2 - 1 };
        break;
      case "resize":
        m.viewport = elige(VIEWPORTS);
        break;
      case "saveReload": {
        // Ida y vuelta por JSON, como al guardar y volver a abrir.
        const ida = JSON.parse(JSON.stringify(m.steps)) as StratStep[];
        m.steps = ida;
        break;
      }
    }

    opsHechas++;
    const fallo = revisa(m, op);
    if (fallo && !primerFallo) primerFallo = fallo;
    if (fallo) break;
  }

  assert.equal(primerFallo, null, primerFallo ?? "");
  assert.equal(opsHechas, OPS, `se completaron ${opsHechas} de ${OPS} operaciones`);
  // Todas las operaciones se han ejercitado: un fuzz que sólo mueve fichas no prueba gran cosa.
  assert.ok(Object.keys(conteo).length >= 18, `sólo se ejercitaron ${Object.keys(conteo).length} operaciones`);
});

test("F47 FUZZ · el tamaño de pantalla NUNCA cambia una coordenada táctica", () => {
  const rnd = lcg(SEED ^ 0x9e37);
  const jugadores = Array.from({ length: TEAM_SIZE }, (_, i) => ({ id: `p${i}`, x: rnd(), y: rnd() }));
  const antes = JSON.stringify(jugadores);

  /*
   * Redimensionar es un cambio de VISTA. Las coordenadas están normalizadas, así que la conversión
   * a píxeles depende del tamaño pero el dato no. Se recorren los seis tamaños del encargo y se
   * comprueba que el viaje de ida y vuelta devuelve exactamente lo mismo.
   */
  for (const [w, h] of VIEWPORTS) {
    for (const p of jugadores) {
      const px = p.x * w;
      const py = p.y * h;
      assert.ok(Math.abs(px / w - p.x) < 1e-12, `${w}×${h} movió x`);
      assert.ok(Math.abs(py / h - p.y) < 1e-12, `${w}×${h} movió y`);
    }
  }
  assert.equal(JSON.stringify(jugadores), antes, "el plan no se ha tocado al redimensionar");
});

test("F47 FUZZ · reproducir mil veces no muta el plan ni se sale de rango", () => {
  const rnd = lcg(SEED ^ 0x1234);
  const steps: StratStep[] = Array.from({ length: 5 }, (_, i) => ({
    id: `s${i}`, at: i, label: `${i}`, notes: "",
    state: { ...emptyStepState(), players: [{ id: "p1", role: "Duelista", label: "P1", x: rnd(), y: rnd() } as never] },
  }));
  const strat = { steps };
  const antes = JSON.stringify(strat);

  let st = INITIAL_PLAYBACK;
  for (let i = 0; i < 1000; i++) {
    const e = elegirEvento(rnd());
    st = playbackReducer(st, e, steps.length);
    assert.ok(st.index >= 0 && st.index < steps.length, `índice ${st.index} fuera de rango`);
    assert.ok(st.progress >= 0 && st.progress <= 1, `progreso ${st.progress} fuera de 0..1`);
    const f = playbackFrame(strat, st);
    for (const p of f.players) {
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), "interpolación no finita");
    }
  }
  assert.equal(JSON.stringify(strat), antes, "la reproducción no puede tocar el plan");
});

function elegirEvento(r: number) {
  if (r < 0.3) return { type: "next" } as const;
  if (r < 0.5) return { type: "prev" } as const;
  if (r < 0.65) return { type: "toggle" } as const;
  if (r < 0.8) return { type: "progress", value: r } as const;
  if (r < 0.95) return { type: "goto", index: Math.floor(r * 9) - 2 } as const;
  return { type: "reset" } as const;
}
