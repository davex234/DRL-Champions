/**
 * Tests del poller de sincronización PvP (node:test). Ejecutar: `npm test`.
 *
 * El bucle se prueba SIN navegador y SIN red: reloj, temporizadores, transporte y visibilidad
 * entran inyectados, así que cada test es determinista y no espera ni un milisegundo real.
 * El proyecto no tiene jsdom ni testing-library —los tests de React usan `renderToStaticMarkup`,
 * que no ejecuta efectos—, y por eso lo difícil vive en una clase y no en un hook.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { PvpMatchSnapshot, PvpSyncResponse } from "@/domain/cardgame/pvp";
import type { DuelMatch } from "@/domain/cardgame/match";
import { PvpSyncError, type PvpSyncTransport, type PvpPlayInput } from "./pvpTransport";
import {
  PvpSyncPoller, POLL_MS, BACKOFF_MS, backoffFor, intervalFor, initialSyncState,
  syncLabel, turnRemainingMs, type SyncState,
} from "./pvpPoller";

// ───────────────────────────── utillaje ─────────────────────────────

/** Reloj y temporizadores falsos: el test decide cuándo pasa el tiempo. */
class FakeClock {
  t = 1_000_000;
  private queue: { at: number; id: number; fn: () => void }[] = [];
  private nextId = 1;

  now = (): number => this.t;
  setTimer = (fn: () => void, ms: number): unknown => {
    const id = this.nextId++;
    this.queue.push({ at: this.t + ms, id, fn });
    return id;
  };
  clearTimer = (h: unknown): void => { this.queue = this.queue.filter((e) => e.id !== h); };

  /** ¿Cuánto falta para el próximo disparo? `null` si no hay ninguno armado. */
  pending(): number | null {
    if (this.queue.length === 0) return null;
    return Math.min(...this.queue.map((e) => e.at)) - this.t;
  }
  armed(): number { return this.queue.length; }

  /** Avanza el tiempo y dispara lo que toque. */
  async advance(ms: number): Promise<void> {
    this.t += ms;
    const due = this.queue.filter((e) => e.at <= this.t).sort((a, b) => a.at - b.at);
    this.queue = this.queue.filter((e) => e.at > this.t);
    for (const e of due) { e.fn(); await flush(); }
  }
}

/** Deja correr las microtareas pendientes (las promesas del transporte falso). */
const flush = async (): Promise<void> => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

const MATCH = "11111111-1111-4111-8111-111111111111";

const fakeMatch = (): DuelMatch => ({
  id: MATCH, orchestratorVersion: "duel-turns-2", combatRulesVersion: "duel-combat-2",
  snapshotA: { deckId: "", deckName: "", cards: [], dataVersion: "v", schemaVersion: 1, takenAt: 0, checksum: "c" },
  snapshotB: { deckId: "", deckName: "", cards: [], dataVersion: "v", schemaVersion: 1, takenAt: 0, checksum: "c" },
  status: "IN_PROGRESS", phase: "ATTACKER_CARD", currentTurn: 1, attacker: "A",
  draft: { attackerCardUid: null, attackerStat: null, defenderCardUid: null, defenderStat: null },
  turns: [], usedA: [], usedB: [], scoreA: 0, scoreB: 0, ties: 0, result: null,
});

function snap(version: number, over: Partial<PvpMatchSnapshot> = {}): PvpMatchSnapshot {
  return {
    matchId: MATCH, lifecycle: "IN_TURN", stateVersion: version,
    yourSide: "A", expectedSide: "B", isYourTurn: false,
    match: fakeMatch(), turnStartedAt: 1_000_000, turnDeadlineAt: 1_090_000,
    ...over,
  };
}

const changedRes = (version: number, over: Partial<PvpMatchSnapshot> = {}, serverNow = 1_000_000): PvpSyncResponse =>
  ({ changed: true, stateVersion: version, serverNow, terminal: false, snapshot: snap(version, over) });

const unchangedRes = (version: number, terminal = false, serverNow = 1_000_000): PvpSyncResponse =>
  ({ changed: false, stateVersion: version, serverNow, terminal });

/** Transporte falso programable. Cuenta llamadas y permite respuestas diferidas. */
class FakeTransport implements PvpSyncTransport {
  calls: (number | null)[] = [];
  plays: PvpPlayInput[] = [];
  abandons = 0;
  private script: (() => Promise<PvpSyncResponse>)[] = [];
  private fallback: () => Promise<PvpSyncResponse> = async () => unchangedRes(0);

  queue(...fns: (() => Promise<PvpSyncResponse>)[]): void { this.script.push(...fns); }
  setFallback(fn: () => Promise<PvpSyncResponse>): void { this.fallback = fn; }

  fetchSince(_m: string, since: number | null): Promise<PvpSyncResponse> {
    this.calls.push(since);
    const next = this.script.shift() ?? this.fallback;
    return next();
  }
  play(_m: string, input: PvpPlayInput): Promise<PvpSyncResponse> {
    this.plays.push(input);
    const next = this.script.shift() ?? this.fallback;
    return next();
  }
  abandon(): Promise<PvpSyncResponse> {
    this.abandons++;
    const next = this.script.shift() ?? this.fallback;
    return next();
  }
}

function makePoller(t: FakeTransport, c: FakeClock): PvpSyncPoller {
  return new PvpSyncPoller(MATCH, {
    transport: t, now: c.now, setTimer: c.setTimer, clearTimer: c.clearTimer,
    createAbort: () => new AbortController(),
  });
}

// ───────────────────────────── ritmo (puro) ─────────────────────────────

test("el intervalo depende de si PUEDE cambiar algo, no de si la partida está viva", () => {
  const base = initialSyncState();
  // Sin snapshot todavía: ritmo vivo.
  assert.equal(intervalFor(base, "visible"), POLL_MS.rivalTurn);
  // Turno del rival: es cuando el estado puede cambiar solo ⇒ el sondeo sirve.
  assert.equal(intervalFor({ ...base, snapshot: snap(1, { isYourTurn: false }) }, "visible"), POLL_MS.rivalTurn);
  // Turno propio: no cambiará nada hasta que actuemos ⇒ se afloja.
  assert.equal(intervalFor({ ...base, snapshot: snap(1, { isYourTurn: true }) }, "visible"), POLL_MS.ownTurn);
  // Pestaña oculta: nadie mira.
  assert.equal(intervalFor({ ...base, snapshot: snap(1) }, "hidden"), POLL_MS.hidden);
  // Terminal y error: NUNCA se vuelve a preguntar.
  assert.equal(intervalFor({ ...base, status: "TERMINAL" }, "visible"), null);
  assert.equal(intervalFor({ ...base, status: "ERROR" }, "visible"), null);
  // Los intervalos respetan las bandas pedidas.
  assert.ok(POLL_MS.rivalTurn >= 1000 && POLL_MS.rivalTurn <= 1500);
  assert.ok(POLL_MS.ownTurn >= 2000 && POLL_MS.ownTurn <= 3000);
  assert.ok(POLL_MS.hidden >= 10_000);
});

test("el backoff crece y se aplana en el tope", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 9].map(backoffFor), [1000, 2000, 4000, 8000, 10_000, 10_000]);
  assert.equal(BACKOFF_MS[BACKOFF_MS.length - 1], 10_000);
});

// ───────────────────────────── bucle ─────────────────────────────

test("el polling arranca UNA sola vez aunque se llame a start() varias veces", async () => {
  const t = new FakeTransport(); const c = new FakeClock(); const p = makePoller(t, c);
  t.setFallback(async () => changedRes(1));
  p.start(); p.start(); p.start();
  await flush();
  assert.equal(t.calls.length, 1, "solo una petición inicial");
  assert.equal(c.armed(), 1, "solo un temporizador armado");
  p.dispose();
});

test("la primera petición pide estado COMPLETO (since=null) y las siguientes incrementan", async () => {
  const t = new FakeTransport(); const c = new FakeClock(); const p = makePoller(t, c);
  t.setFallback(async () => changedRes(1));
  p.start(); await flush();
  assert.equal(t.calls[0], null, "sin versión previa se pide todo");
  await c.advance(POLL_MS.rivalTurn);
  assert.equal(t.calls[1], 1, "después se pregunta desde la versión conocida");
  p.dispose();
});

test("NO hay peticiones solapadas: mientras una está en vuelo no se lanza otra", async () => {
  const t = new FakeTransport(); const c = new FakeClock(); const p = makePoller(t, c);
  let resolve!: (r: PvpSyncResponse) => void;
  t.queue(() => new Promise<PvpSyncResponse>((r) => { resolve = r; }));
  p.start(); await flush();
  assert.equal(t.calls.length, 1);

  // Refresco manual y doble clic mientras la primera sigue pendiente.
  p.syncNow(); p.syncNow(); p.syncNow();
  await flush();
  assert.equal(t.calls.length, 1, "el doble clic no lanza más peticiones");

  resolve(changedRes(1));
  await flush();
  assert.equal(t.calls.length, 1);
  p.dispose();
});

test("RACE: una respuesta VIEJA no puede pisar a una nueva", async () => {
  const t = new FakeTransport(); const c = new FakeClock(); const p = makePoller(t, c);
  t.setFallback(async () => changedRes(20));
  p.start(); await flush();
  assert.equal(p.getSnapshot().stateVersion, 20);

  // Llega, tarde, la respuesta de una petición anterior con la versión 19.
  t.queue(async () => changedRes(19));
  await c.advance(POLL_MS.rivalTurn);
  assert.equal(p.getSnapshot().stateVersion, 20, "la 19 NO sobrescribe la 20");
  assert.equal(p.getSnapshot().snapshot?.stateVersion, 20);
  // Y se sigue considerando una sincronización correcta: el servidor respondió.
  assert.equal(p.getSnapshot().status, "SYNCED");
  p.dispose();
});

test("una respuesta SIN cambios no modifica el estado de juego", async () => {
  const t = new FakeTransport(); const c = new FakeClock(); const p = makePoller(t, c);
  t.queue(async () => changedRes(5));
  p.start(); await flush();
  const before = p.getSnapshot().snapshot;

  t.queue(async () => unchangedRes(5));
  await c.advance(POLL_MS.rivalTurn);
  const after = p.getSnapshot();
  assert.equal(after.stateVersion, 5);
  assert.equal(after.snapshot, before, "el snapshot es EL MISMO objeto: no se tocó");
  assert.equal(after.status, "SYNCED");
  p.dispose();
});

test("TERMINAL detiene el polling", async () => {
  const t = new FakeTransport(); const c = new FakeClock(); const p = makePoller(t, c);
  t.queue(async () => ({ changed: true, stateVersion: 9, serverNow: 1_000_000, terminal: true, snapshot: snap(9, { lifecycle: "FINISHED" }) }));
  p.start(); await flush();
  assert.equal(p.getSnapshot().status, "TERMINAL");
  assert.equal(c.armed(), 0, "no queda ningún temporizador armado");

  const n = t.calls.length;
  await c.advance(60_000);
  assert.equal(t.calls.length, n, "no se hace ni una petición más");
  // Y un refresco manual tampoco lo revive.
  p.syncNow(); await flush();
  assert.equal(t.calls.length, n);
  p.dispose();
});

test("TERMINAL también por abandono, conservando el último snapshot", async () => {
  const t = new FakeTransport(); const c = new FakeClock(); const p = makePoller(t, c);
  t.queue(async () => changedRes(3));
  p.start(); await flush();
  t.queue(async () => ({ changed: true, stateVersion: 4, serverNow: 1_000_000, terminal: true, snapshot: snap(4, { lifecycle: "ABANDONED" }) }));
  await c.advance(POLL_MS.rivalTurn);
  assert.equal(p.getSnapshot().status, "TERMINAL");
  assert.equal(p.getSnapshot().snapshot?.lifecycle, "ABANDONED");
  assert.equal(syncLabel(p.getSnapshot()), "Partida terminada");
  p.dispose();
});

test("dispose() detiene el bucle y aborta lo que estuviera en vuelo", async () => {
  const t = new FakeTransport(); const c = new FakeClock(); const p = makePoller(t, c);
  t.setFallback(async () => changedRes(1));
  p.start(); await flush();
  assert.equal(c.armed(), 1);

  p.dispose();
  assert.equal(c.armed(), 0, "temporizador cancelado");
  const n = t.calls.length;
  await c.advance(60_000);
  assert.equal(t.calls.length, n, "no vuelve a pedir nada");
  // Idempotente.
  p.dispose();
});

test("la pestaña oculta afloja el ritmo; volver a verla sincroniza YA", async () => {
  const t = new FakeTransport(); const c = new FakeClock(); const p = makePoller(t, c);
  t.setFallback(async () => changedRes(1));
  p.start(); await flush();
  assert.equal(c.pending(), POLL_MS.rivalTurn);

  p.setVisibility("hidden");
  assert.equal(c.pending(), POLL_MS.hidden, "oculta ⇒ mucho más lento");

  const antes = t.calls.length;
  p.setVisibility("visible");
  await flush();
  assert.equal(t.calls.length, antes + 1, "volver a primer plano sincroniza de inmediato");
  p.dispose();
});

test("un cambio de visibilidad repetido no crea bucles ni peticiones extra", async () => {
  const t = new FakeTransport(); const c = new FakeClock(); const p = makePoller(t, c);
  t.setFallback(async () => changedRes(1));
  p.start(); await flush();
  const antes = t.calls.length;
  p.setVisibility("visible"); p.setVisibility("visible");
  await flush();
  assert.equal(t.calls.length, antes, "ya era visible: no pasa nada");
  assert.equal(c.armed(), 1, "sigue habiendo UN solo temporizador");
  p.dispose();
});

test("fijar la visibilidad ANTES de start() no crea dos bucles (regresión de QA)", async () => {
  /*
   * La QA en navegador del Bloque 7.3 encontró que una pestaña que ya estaba en segundo plano
   * al montar nunca recibía `visibilitychange` —solo notifica CAMBIOS— y el bucle se quedaba
   * con el ritmo de primer plano. El arreglo es leer la visibilidad inicial antes de arrancar;
   * esto comprueba que hacerlo no duplica el bucle.
   */
  const t = new FakeTransport(); const c = new FakeClock(); const p = makePoller(t, c);
  t.setFallback(async () => changedRes(1));
  p.setVisibility("hidden");
  p.start();
  await flush();
  assert.equal(t.calls.length, 1, "una sola petición inicial");
  assert.equal(c.armed(), 1, "UN solo temporizador");
  assert.equal(c.pending(), POLL_MS.hidden, "y con el ritmo de pestaña oculta, no el de primer plano");
  p.dispose();
});

test("un error de red activa el backoff y NO mata la partida", async () => {
  const t = new FakeTransport(); const c = new FakeClock(); const p = makePoller(t, c);
  t.queue(async () => changedRes(7));
  p.start(); await flush();
  assert.equal(p.getSnapshot().status, "SYNCED");

  t.queue(async () => { throw new PvpSyncError("NETWORK", "sin conexión"); });
  await c.advance(POLL_MS.rivalTurn);
  const s = p.getSnapshot();
  assert.equal(s.status, "STALE", "se conserva el estado y se marca desincronizado");
  assert.equal(s.snapshot?.stateVersion, 7, "el último snapshot sigue disponible");
  assert.equal(s.consecutiveFailures, 1);
  assert.equal(c.pending(), BACKOFF_MS[0], "reintento a 1s");
  assert.equal(syncLabel(s), "Reconectando…");
  p.dispose();
});

test("el backoff escala con los fallos y se recupera al volver la red", async () => {
  const t = new FakeTransport(); const c = new FakeClock(); const p = makePoller(t, c);
  t.queue(async () => changedRes(1));
  p.start(); await flush();

  for (const esperado of [BACKOFF_MS[0], BACKOFF_MS[1], BACKOFF_MS[2]]) {
    t.queue(async () => { throw new PvpSyncError("SERVER", "500"); });
    await c.advance(c.pending()!);
    assert.equal(c.pending(), esperado, `tras el fallo toca esperar ${esperado}ms`);
  }
  assert.equal(p.getSnapshot().consecutiveFailures, 3);

  // Vuelve la red: se recupera el ritmo normal y el contador se pone a cero.
  t.queue(async () => changedRes(2));
  await c.advance(c.pending()!);
  assert.equal(p.getSnapshot().consecutiveFailures, 0);
  assert.equal(p.getSnapshot().status, "SYNCED");
  assert.equal(c.pending(), POLL_MS.rivalTurn, "de vuelta al ritmo normal");
  p.dispose();
});

test("un 401 o un 404 NO se reintentan: no se arreglan insistiendo", async () => {
  for (const [kind, status] of [["AUTH", 401], ["NOT_FOUND", 404]] as const) {
    const t = new FakeTransport(); const c = new FakeClock(); const p = makePoller(t, c);
    t.queue(async () => { throw new PvpSyncError(kind, "no", status); });
    p.start(); await flush();
    assert.equal(p.getSnapshot().status, "ERROR", kind);
    assert.equal(c.armed(), 0, `${kind}: no se rearma el bucle`);
    const n = t.calls.length;
    await c.advance(60_000);
    assert.equal(t.calls.length, n, `${kind}: no reintenta`);
    p.dispose();
  }
});

test("un 409 pide estado COMPLETO en el siguiente ciclo, sin contar como caída", async () => {
  const t = new FakeTransport(); const c = new FakeClock(); const p = makePoller(t, c);
  t.queue(async () => changedRes(4));
  p.start(); await flush();

  t.queue(async () => { throw new PvpSyncError("CONFLICT", "stale", 409, "STALE_VERSION"); });
  await c.advance(POLL_MS.rivalTurn);
  assert.equal(p.getSnapshot().status, "STALE");
  assert.equal(p.getSnapshot().consecutiveFailures, 0, "un conflicto no es una caída de red");

  t.queue(async () => changedRes(6));
  await c.advance(c.pending()!);
  assert.equal(t.calls[t.calls.length - 1], null, "se vuelve a pedir el estado completo");
  assert.equal(p.getSnapshot().stateVersion, 6);
  p.dispose();
});

test("una acción adopta el estado de la respuesta SIN esperar al sondeo", async () => {
  const t = new FakeTransport(); const c = new FakeClock(); const p = makePoller(t, c);
  t.queue(async () => changedRes(1, { isYourTurn: true, expectedSide: "A" }));
  p.start(); await flush();
  assert.equal(p.getSnapshot().stateVersion, 1);

  t.queue(async () => changedRes(2, { isYourTurn: false, expectedSide: "B" }));
  const res = await p.play({ actionId: "a", expectedVersion: 1, cardUid: "c", stat: "stronghold" });
  assert.ok(res && res.changed);
  assert.equal(p.getSnapshot().stateVersion, 2, "el estado nuevo llega en la respuesta de la acción");
  assert.equal(t.plays.length, 1);
  p.dispose();
});

test("el desfase de reloj se calcula pero NO decide expiración", async () => {
  const t = new FakeTransport(); const c = new FakeClock(); const p = makePoller(t, c);
  // El servidor va 5 s por delante del cliente.
  t.queue(async () => changedRes(1, {}, c.now() + 5_000));
  p.start(); await flush();
  assert.equal(p.getSnapshot().serverOffset, 5_000);

  // El plazo son 1_090_000 en tiempo de SERVIDOR; con el desfase, al cliente le quedan 85 s.
  const restante = turnRemainingMs(p.getSnapshot(), c.now());
  assert.equal(restante, 1_090_000 - (c.now() + 5_000));
  // Y nunca baja de cero, ni convierte la partida en terminal por sí solo.
  const vencido = turnRemainingMs(p.getSnapshot(), c.now() + 10_000_000);
  assert.equal(vencido, 0);
  assert.notEqual(p.getSnapshot().status, "TERMINAL", "el reloj del cliente NO cierra la partida");
  p.dispose();
});

test("las etiquetas cubren los estados que la pantalla debe poder mostrar", () => {
  const base = initialSyncState();
  const s = (o: Partial<SyncState>): SyncState => ({ ...base, ...o });
  assert.equal(syncLabel(s({ status: "IDLE" })), "Conectando…");
  assert.equal(syncLabel(s({ status: "SYNCING" })), "Conectando…");
  assert.equal(syncLabel(s({ status: "SYNCING", snapshot: snap(1) })), "Sincronizando…");
  assert.equal(syncLabel(s({ status: "SYNCED", snapshot: snap(1, { isYourTurn: true }) })), "Tu turno");
  assert.equal(syncLabel(s({ status: "SYNCED", snapshot: snap(1, { isYourTurn: false }) })), "Turno rival");
  assert.equal(syncLabel(s({ status: "STALE" })), "Reconectando…");
  assert.equal(syncLabel(s({ status: "TERMINAL" })), "Partida terminada");
  assert.equal(syncLabel(s({ status: "ERROR" })), "No se pudo sincronizar");
});
