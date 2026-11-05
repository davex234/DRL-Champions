/**
 * FASE 45 · LA MÁQUINA DE ESTADOS DE LA PARTIDA — comportamiento, invariantes y fuzzers.
 *
 * Incluye los tres fuzzers del encargo:
 *   · estado de partida (≥ 100.000 secuencias): ni turnos dobles, ni recompensa doble, ni resultado antes de tiempo;
 *   · estado visual (≥ 50.000): las señales de la arena siempre son válidas y nunca dejan la mesa sin salida;
 *   · audio (≥ 20.000): un solo contexto de música, y el sonido del turno sale del veredicto del servidor.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canConfirm, canSelect, INITIAL_SESSION, isEnded, matchSessionReducer, serverFacts, sessionInvariants,
  type MatchEvent, type MatchSession,
} from "./matchSession";
import { arenaSignals, turnImpact } from "./experience";
import { qaSimulate, qaSnapshot, qaView } from "./qaSimulation";
import { INITIAL_MUSIC, musicPlan, musicReducer, type MusicEvent } from "@/lib/audio/music";
import type { DuelMatchView } from "./types";

const run = (events: MatchEvent[], s: MatchSession = INITIAL_SESSION) => events.reduce(matchSessionReducer, s);
const facts = (resolved: number, terminal = false) => ({ resolved, terminal });
const started = () => run([{ type: "start" }, { type: "introDone" }]);

/* ───────────── recorrido normal ───────────── */

test("SESIÓN 01 · arranca preparando, sin selección y sin jugadas", () => {
  assert.deepEqual(INITIAL_SESSION, { state: "PREPARING", selectedUid: null, selectedStat: null, resolved: 0, submitted: 0, terminal: false });
});

test("SESIÓN 02 · empezar lleva a la intro y la intro a la mesa", () => {
  assert.equal(run([{ type: "start" }]).state, "INTRO");
  assert.equal(started().state, "TURN_READY");
});

test("SESIÓN 03 · elegir carta pasa a SELECTING y guarda el uid", () => {
  const s = run([{ type: "select", uid: "c1" }], started());
  assert.equal(s.state, "SELECTING");
  assert.equal(s.selectedUid, "c1");
});

test("SESIÓN 04 · atacando no se puede confirmar sin estadística", () => {
  const s = run([{ type: "select", uid: "c1" }], started());
  assert.equal(canConfirm(s, true), false);
  assert.equal(canConfirm(run([{ type: "stat", stat: "stronghold" }], s), true), true);
});

test("SESIÓN 05 · defendiendo basta la carta (el eje lo impone el servidor)", () => {
  const s = run([{ type: "select", uid: "c1" }], started());
  assert.equal(canConfirm(s, false), true);
});

test("SESIÓN 06 · confirmar envía UNA jugada y cierra la mesa", () => {
  const s = run([{ type: "select", uid: "c1" }, { type: "confirm" }], started());
  assert.equal(s.state, "SUBMITTING");
  assert.equal(s.submitted, 1);
  assert.equal(canSelect(s), false);
});

test("SESIÓN 07 · doble clic no envía dos jugadas", () => {
  const s = run([{ type: "select", uid: "c1" }, { type: "confirm" }, { type: "confirm" }, { type: "confirm" }], started());
  assert.equal(s.submitted, 1);
});

test("SESIÓN 08 · triple Enter durante el envío tampoco", () => {
  const s = run([{ type: "select", uid: "c1" }, { type: "confirm" }, { type: "select", uid: "c2" }, { type: "confirm" }], started());
  assert.equal(s.submitted, 1);
  assert.equal(s.selectedUid, "c1");
});

test("SESIÓN 09 · la respuesta del servidor con un turno nuevo abre la revelación", () => {
  const s = run([{ type: "select", uid: "c1" }, { type: "confirm" }, { type: "serverTurn", facts: facts(1) }], started());
  assert.equal(s.state, "RESOLVING");
  assert.equal(s.resolved, 1);
});

test("SESIÓN 10 · al cerrar la revelación vuelve la mesa si la partida sigue", () => {
  const s = run([{ type: "select", uid: "c1" }, { type: "confirm" }, { type: "serverTurn", facts: facts(1) }, { type: "revealDone" }], started());
  assert.equal(s.state, "TURN_READY");
  assert.equal(s.selectedUid, null);
});

test("SESIÓN 11 · si el servidor cierra la partida, la revelación lleva al golpe final", () => {
  const s = run([{ type: "select", uid: "c1" }, { type: "confirm" }, { type: "serverTurn", facts: facts(10, true) }, { type: "revealDone" }], started());
  assert.equal(s.state, "MATCH_COMPLETE");
});

test("SESIÓN 12 · el golpe final lleva al resultado y solo desde ahí se juega otra", () => {
  const end = run([{ type: "select", uid: "c1" }, { type: "confirm" }, { type: "serverTurn", facts: facts(10, true) }, { type: "revealDone" }, { type: "completeDone" }], started());
  assert.equal(end.state, "RESULT");
  assert.deepEqual(run([{ type: "playAgain" }], end), INITIAL_SESSION);
  assert.equal(run([{ type: "playAgain" }], started()).state, "TURN_READY", "sin resultado no se reinicia");
});

test("SESIÓN 13 · una jugada rechazada devuelve el control sin contarla", () => {
  const s = run([{ type: "select", uid: "c1" }, { type: "confirm" }, { type: "rejected" }], started());
  assert.equal(s.state, "SELECTING");
  assert.equal(s.submitted, 0);
});

test("SESIÓN 14 · el servidor manda: sin turno nuevo se vuelve a la mesa", () => {
  const s = run([{ type: "select", uid: "c1" }, { type: "confirm" }, { type: "serverTurn", facts: facts(0) }], started());
  assert.equal(s.state, "TURN_READY");
  assert.equal(s.submitted, 0);
});

test("SESIÓN 15 · refrescar en mitad de la partida recoloca en la mesa, sin selección", () => {
  const s = run([{ type: "select", uid: "c1" }, { type: "resume", facts: facts(4) }], started());
  assert.equal(s.state, "TURN_READY");
  assert.equal(s.resolved, 4);
  assert.equal(s.selectedUid, null);
});

test("SESIÓN 16 · refrescar con la partida ya terminada lleva al final, nunca a la mesa", () => {
  const s = run([{ type: "resume", facts: facts(10, true) }], started());
  assert.equal(s.state, "MATCH_COMPLETE");
  assert.equal(canSelect(s), false);
});

test("SESIÓN 17 · refrescar en el resultado se queda en el resultado", () => {
  const end = run([{ type: "serverTurn", facts: facts(10, true) }, { type: "revealDone" }, { type: "completeDone" }], started());
  assert.equal(run([{ type: "resume", facts: facts(10, true) }], end).state, "RESULT");
});

test("SESIÓN 18 · reconectar es lo mismo que refrescar: el servidor recoloca", () => {
  const s = run([{ type: "disconnect" }, { type: "reconnect", facts: facts(6) }], started());
  assert.equal(s.state, "TURN_READY");
  assert.equal(s.resolved, 6);
});

test("SESIÓN 19 · perder la red durante un envío no cancela la jugada en vuelo", () => {
  const s = run([{ type: "select", uid: "c1" }, { type: "confirm" }, { type: "disconnect" }], started());
  assert.equal(s.state, "SUBMITTING");
  assert.equal(s.submitted, 1);
});

test("SESIÓN 20 · perder la red eligiendo suelta la selección pero no la partida", () => {
  const s = run([{ type: "select", uid: "c1" }, { type: "disconnect" }], started());
  assert.equal(s.state, "TURN_READY");
  assert.equal(s.selectedUid, null);
});

test("SESIÓN 21 · no se puede confirmar sin carta", () => {
  assert.equal(canConfirm(started(), false), false);
  assert.equal(run([{ type: "confirm" }], started()).submitted, 0);
});

test("SESIÓN 22 · con la partida terminada no se puede elegir ni confirmar", () => {
  const s = run([{ type: "resume", facts: facts(10, true) }], started());
  assert.equal(canSelect(s), false);
  assert.equal(canConfirm({ ...s, state: "SELECTING", selectedUid: "c1" }, false), false);
});

test("SESIÓN 23 · isEnded solo en el golpe final y en el resultado", () => {
  assert.equal(isEnded({ ...INITIAL_SESSION, state: "MATCH_COMPLETE" }), true);
  assert.equal(isEnded({ ...INITIAL_SESSION, state: "RESULT" }), true);
  for (const st of ["PREPARING", "INTRO", "TURN_READY", "SELECTING", "SUBMITTING", "RESOLVING", "TURN_COMPLETE"] as const) {
    assert.equal(isEnded({ ...INITIAL_SESSION, state: st }), false, st);
  }
});

test("SESIÓN 24 · `serverFacts` sale de la vista tal cual (sin contar nada)", () => {
  const v = qaView(qaSimulate(qaSnapshot(0, "a", "A"), qaSnapshot(1, "b", "B"), 3, "A", 5));
  assert.deepEqual(serverFacts(v), { resolved: v.history.length, terminal: v.status !== "IN_PROGRESS" });
});

test("SESIÓN 25 · sucesos fuera de sitio no cambian nada", () => {
  const s = started();
  for (const e of [{ type: "introDone" }, { type: "revealDone" }, { type: "completeDone" }, { type: "rejected" }] as MatchEvent[]) {
    assert.deepEqual(matchSessionReducer(s, e), s, e.type);
  }
});

test("SESIÓN 26 · los invariantes detectan un resultado sin partida terminada", () => {
  assert.ok(sessionInvariants({ ...INITIAL_SESSION, state: "RESULT" }, 10).length > 0);
  assert.equal(sessionInvariants({ ...INITIAL_SESSION, state: "RESULT", terminal: true, resolved: 10 }, 10).length, 0);
});

test("SESIÓN 27 · los invariantes detectan jugadas enviadas de más", () => {
  assert.ok(sessionInvariants({ ...INITIAL_SESSION, submitted: 3, resolved: 1 }, 10).length > 0);
});

test("SESIÓN 28 · los invariantes detectan más turnos que la partida", () => {
  assert.ok(sessionInvariants({ ...INITIAL_SESSION, resolved: 11 }, 10).length > 0);
});

/* ───────────── impacto del turno y señales de la arena ───────────── */

test("IMPACTO 01 · el turno ganado por A es tu victoria y suena distinto al desenlace", () => {
  assert.deepEqual(turnImpact("A"), { result: "win", sound: "turn.win" });
});
test("IMPACTO 02 · el turno de B es derrota de turno", () => {
  assert.deepEqual(turnImpact("B"), { result: "loss", sound: "turn.loss" });
});
test("IMPACTO 03 · el empate tiene sonido propio (0 puntos, y se oye)", () => {
  assert.deepEqual(turnImpact("TIE"), { result: "tie", sound: "turn.tie" });
});

const viewAt = (turns: number, first: "A" | "B" = "A", seed = 7) => qaView(qaSimulate(qaSnapshot(0, "a", "QA A"), qaSnapshot(1, "b", "QA B"), turns, first, seed));

test("SEÑALES 01 · atacando, el escenario enciende tu lado", () => {
  const v = viewAt(0, "A");
  assert.equal(arenaSignals(v).attacker, "you");
});
test("SEÑALES 02 · defendiendo, el lado del rival", () => {
  assert.equal(arenaSignals(viewAt(0, "B")).attacker, "rival");
});
test("SEÑALES 03 · terminada la partida no hay bando encendido", () => {
  const v = viewAt(10, "A", 3);
  assert.equal(arenaSignals(v).attacker, "none");
  assert.equal(arenaSignals(v).finalTurn, false);
});
test("SEÑALES 04 · el último turno se marca solo en el turno 10 en juego", () => {
  assert.equal(arenaSignals(viewAt(9, "A")).finalTurn, true);
  assert.equal(arenaSignals(viewAt(4, "A")).finalTurn, false);
});
test("SEÑALES 05 · el turno enseñado nunca pasa del total ni baja de 1", () => {
  for (const n of [0, 3, 9, 10]) {
    const s = arenaSignals(viewAt(n, "A", 11));
    assert.ok(s.turn >= 1 && s.turn <= 10, String(s.turn));
  }
});

/* ───────────── FUZZ 1 · estado de partida (100.000 secuencias) ───────────── */

test("FUZZ ESTADO · 100.000 sucesos al azar: sin turnos dobles, sin resultado antes de tiempo, sin bloqueos", () => {
  let seed = 45_000;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  let s = INITIAL_SESSION;
  let resolved = 0;
  let terminal = false;
  let steps = 0;
  const bad: string[] = [];
  let submittedTotal = 0;
  let resolvedTotal = 0;

  for (let i = 0; i < 100_000; i++) {
    const r = rnd();
    let e: MatchEvent;
    if (r < 0.06) e = { type: "start" };
    else if (r < 0.12) e = { type: "introDone" };
    else if (r < 0.28) e = { type: "select", uid: `c${Math.floor(rnd() * 10)}` };
    else if (r < 0.38) e = { type: "stat", stat: ["stronghold", "gamesense", "entryfrag"][Math.floor(rnd() * 3)] };
    else if (r < 0.54) e = { type: "confirm" };
    else if (r < 0.70) {
      // El servidor contesta: o avanza un turno o repite el estado. Nunca retrocede.
      const advance = rnd() < 0.7 && resolved < 10 && !terminal;
      if (advance) resolved += 1;
      if (resolved >= 10) terminal = true;
      e = { type: "serverTurn", facts: { resolved, terminal } };
    }
    else if (r < 0.74) e = { type: "rejected" };
    else if (r < 0.82) e = { type: "revealDone" };
    else if (r < 0.86) e = { type: "completeDone" };
    else if (r < 0.90) e = { type: "resume", facts: { resolved, terminal } };
    else if (r < 0.93) e = { type: "disconnect" };
    else if (r < 0.96) e = { type: "reconnect", facts: { resolved, terminal } };
    else {
      e = { type: "playAgain" };
      if (s.state === "RESULT") { resolved = 0; terminal = false; }
    }

    const before = s;
    s = matchSessionReducer(s, e);
    steps++;
    if (e.type === "confirm" && s.submitted > before.submitted) submittedTotal++;
    if (e.type === "serverTurn" && s.resolved > before.resolved) resolvedTotal++;

    const errs = sessionInvariants(s, 10);
    if (errs.length) bad.push(`${i}:${e.type}:${errs.join(",")}`);
    // Nunca se puede confirmar desde un estado cerrado.
    if ((s.state === "SUBMITTING" || s.state === "RESOLVING") && canConfirm(s, false)) bad.push(`${i}: confirmable con jugada en vuelo`);
    // La mesa nunca queda muda: o se puede elegir, o hay algo en marcha, o la partida acabó.
    const alive = canSelect(s) || s.state === "SUBMITTING" || s.state === "RESOLVING" || s.state === "INTRO" || s.state === "PREPARING" || isEnded(s) || s.state === "TURN_COMPLETE";
    if (!alive) bad.push(`${i}: mesa sin salida en ${s.state}`);
  }
  assert.equal(bad.length, 0, bad.slice(0, 5).join(" | "));
  assert.equal(steps, 100_000);
  assert.ok(submittedTotal > 100 && resolvedTotal > 100, `el fuzz recorrió poco: ${submittedTotal}/${resolvedTotal}`);
});

/* ───────────── FUZZ 2 · estado visual (50.000) ───────────── */

test("FUZZ VISUAL · 50.000 combinaciones de vista: señales válidas, sin arena en blanco ni bandos imposibles", () => {
  let seed = 4_500;
  const rnd = () => { seed = (seed * 22695477 + 1) >>> 0; return seed / 4294967296; };
  const bases: DuelMatchView[] = [viewAt(0, "A"), viewAt(0, "B"), viewAt(3, "A", 7), viewAt(5, "B", 9), viewAt(9, "A", 7), viewAt(10, "A", 3)];
  const bad: string[] = [];
  for (let i = 0; i < 50_000; i++) {
    const base = bases[Math.floor(rnd() * bases.length)];
    // Se retuerce la vista como lo haría una respuesta rara del servidor (turno fuera de rango, estado cerrado…).
    const view: DuelMatchView = {
      ...base,
      turn: Math.floor(rnd() * 14) - 1,
      /* Un estado TERMINAL real del dominio; "FINISHED" no existe en `MatchStatus`. */
      status: rnd() < 0.2 ? "COMPLETED" : base.status,
      youAreAttacker: rnd() < 0.5,
    };
    const s = arenaSignals(view);
    if (!["you", "rival", "none"].includes(s.attacker)) bad.push(`${i}: bando ${s.attacker}`);
    if (s.turn < 1 || s.turn > view.totalTurns) bad.push(`${i}: turno ${s.turn}`);
    if (view.status !== "IN_PROGRESS" && (s.attacker !== "none" || s.finalTurn)) bad.push(`${i}: partida cerrada con escenario vivo`);
    if (s.finalTurn && view.turn < view.totalTurns) bad.push(`${i}: último turno falso`);
    // El impacto siempre existe para un veredicto válido y nunca inventa otro.
    const impact = turnImpact(rnd() < 0.34 ? "A" : rnd() < 0.5 ? "B" : "TIE");
    if (!["win", "loss", "tie"].includes(impact.result)) bad.push(`${i}: impacto ${impact.result}`);
  }
  assert.equal(bad.length, 0, bad.slice(0, 5).join(" | "));
});

/* ───────────── FUZZ 3 · audio de la partida (20.000) ───────────── */

test("FUZZ AUDIO · 20.000 sucesos entre vestíbulo, partida y resultado: una sola música y el sonido del turno correcto", () => {
  let seed = 2_000;
  const rnd = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 4294967296; };
  let m = INITIAL_MUSIC;
  const contexts = ["LOBBY", "MATCH", "RESULT"] as const;
  const bad: string[] = [];
  for (let i = 0; i < 20_000; i++) {
    const r = rnd();
    const e: MusicEvent = r < 0.08 ? { type: "unlock" }
      : r < 0.4 ? { type: "route", context: contexts[Math.floor(rnd() * contexts.length)] }
        : r < 0.5 ? { type: "override", context: rnd() < 0.5 ? null : "RESULT" }
          : r < 0.62 ? { type: "duck", on: rnd() < 0.5 }
            : r < 0.74 ? { type: "visibility", hidden: rnd() < 0.35 }
              : { type: "volume", value: rnd() };
    m = musicReducer(m, e);
    const plan = musicPlan(m);
    if (plan.context && !contexts.includes(plan.context as (typeof contexts)[number])) bad.push(`${i}: contexto ${plan.context}`);
    if (plan.gain < 0 || plan.gain > 1) bad.push(`${i}: ganancia ${plan.gain}`);
    if (m.hidden && plan.gain !== 0) bad.push(`${i}: pestaña oculta con sonido`);
    if (!m.unlocked && plan.context !== null) bad.push(`${i}: música antes del gesto`);
    // El sonido del turno SIEMPRE sale del veredicto del servidor, nunca del estado de la música.
    const outcome = rnd() < 0.34 ? "A" : rnd() < 0.5 ? "B" : "TIE";
    const expected = outcome === "A" ? "turn.win" : outcome === "B" ? "turn.loss" : "turn.tie";
    if (turnImpact(outcome).sound !== expected) bad.push(`${i}: sonido de turno`);
  }
  assert.equal(bad.length, 0, bad.slice(0, 5).join(" | "));
});
