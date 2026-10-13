/**
 * AUTO-SYNC · POLÍTICA (Fase 24.6) — pruebas 1–10 del brief + configuración.
 *
 * Todo puro: reloj fijo, sin red, sin base de datos.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_AUTO_SYNC_CONFIG, getEsportsAutoSyncConfig, getSyncTriggerSecret } from "./config";
import { applyBackoff, classifyEvent, getEsportsSyncPolicy, planSyncRun, withJitter, type EventSnapshotForPolicy } from "./policy";

const cfg = DEFAULT_AUTO_SYNC_CONFIG;
const NOW = Date.parse("2026-09-27T15:00:00Z");
const H = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();

const ev = (id: string, matches: EventSnapshotForPolicy["matches"], extra: Partial<EventSnapshotForPolicy> = {}): EventSnapshotForPolicy =>
  ({ id, matches, ...extra });

/* ─────────────── 1–6 · clasificación y prioridad ─────────────── */

test("1 · un evento con partido EN DIRECTO tiene la máxima prioridad y el intervalo más corto", () => {
  const live = ev("live", [{ status: "live", startTime: iso(NOW - H) }, { status: "upcoming", startTime: iso(NOW + H) }]);
  const d = getEsportsSyncPolicy(live, {}, NOW, cfg);
  assert.equal(d.class, "live");
  assert.equal(d.baseIntervalMs, cfg.intervals.live);
  assert.equal(d.priority, 100);
  // Y NUNCA cada 20 segundos: el ritmo hacia la fuente es de minutos.
  assert.ok(cfg.intervals.live >= 60_000, "el intervalo live es ≥ 1 min");
});

test("2 · evento activo sin directo → frecuencia media (menor que live)", () => {
  const active = ev("active", [{ status: "finished", startTime: iso(NOW - 3 * H) }, { status: "upcoming", startTime: iso(NOW + 2 * H) }]);
  const d = getEsportsSyncPolicy(active, {}, NOW, cfg);
  assert.equal(d.class, "active");
  assert.ok(d.baseIntervalMs > cfg.intervals.live);
  assert.ok(d.priority < 100);
});

test("3 · próximo cercano (empieza dentro de la ventana) → frecuencia moderada", () => {
  const soon = ev("soon", [{ status: "upcoming", startTime: iso(NOW + 20 * H) }]);
  const d = getEsportsSyncPolicy(soon, {}, NOW, cfg);
  assert.equal(d.class, "upcoming_soon");
  assert.equal(d.baseIntervalMs, cfg.intervals.upcomingSoon);
});

test("4 · evento lejano → frecuencia baja; sin partidos ni fechas también es «future»", () => {
  const far = ev("far", [{ status: "upcoming", startTime: iso(NOW + 30 * 24 * H) }]);
  assert.equal(classifyEvent(far, NOW, cfg), "future");
  assert.equal(getEsportsSyncPolicy(far, {}, NOW, cfg).baseIntervalMs, cfg.intervals.future);
  assert.equal(classifyEvent(ev("blank", []), NOW, cfg), "future");
  // Sin partidos pero con fecha de inicio cercana: la fecha del evento decide.
  assert.equal(classifyEvent(ev("dated", [], { startDate: iso(NOW + 5 * H) }), NOW, cfg), "upcoming_soon");
});

test("5 · terminado hace poco → algunos rechecks (recently_finished)", () => {
  const recent = ev("recent", [{ status: "finished", startTime: iso(NOW - 10 * H) }], { endDate: iso(NOW - 6 * H) });
  const d = getEsportsSyncPolicy(recent, {}, NOW, cfg);
  assert.equal(d.class, "recently_finished");
  assert.equal(d.baseIntervalMs, cfg.intervals.recentlyFinished);
  assert.ok(d.eligible);
});

test("6 · archivado (terminado hace más de la ventana) → NO se sondea", () => {
  const old = ev("champions-2024", [{ status: "finished", startTime: iso(NOW - 400 * 24 * H) }], { endDate: iso(NOW - 399 * 24 * H) });
  const d = getEsportsSyncPolicy(old, {}, NOW, cfg);
  assert.equal(d.class, "archived");
  assert.equal(d.eligible, false);
  assert.equal(d.nextDueAt, null);
  const plan = planSyncRun([old], {}, NOW, cfg);
  assert.equal(plan.due.length, 0);
});

/* ─────────────── 7–8 · backoff ─────────────── */

test("7 · tras fallos consecutivos el intervalo crece (exponencial con tope)", () => {
  assert.equal(applyBackoff(cfg.intervals.live, 0, cfg), cfg.intervals.live);
  assert.equal(applyBackoff(cfg.intervals.live, 1, cfg), cfg.intervals.live * 2);
  assert.equal(applyBackoff(cfg.intervals.live, 3, cfg), cfg.intervals.live * 8);
  assert.equal(applyBackoff(cfg.intervals.live, 40, cfg), cfg.backoff.maxMs, "tope");
  const live = ev("live", [{ status: "live" }]);
  const fresh = getEsportsSyncPolicy(live, { lastAttemptAt: NOW - 3 * 60_000, consecutiveFailures: 0 }, NOW, cfg, () => 0.5);
  const failing = getEsportsSyncPolicy(live, { lastAttemptAt: NOW - 3 * 60_000, consecutiveFailures: 2 }, NOW, cfg, () => 0.5);
  assert.equal(fresh.due, true, "3 min después de un intento sano toca (intervalo 2 min)");
  assert.equal(failing.due, false, "con 2 fallos el intervalo es 8 min: aún no toca");
  assert.match(failing.reason, /backoff/);
});

test("8 · un éxito resetea el backoff (0 fallos → intervalo base)", () => {
  const live = ev("live", [{ status: "live" }]);
  const afterSuccess = getEsportsSyncPolicy(live, { lastAttemptAt: NOW - 2 * 60_000, lastSuccessAt: NOW - 2 * 60_000, consecutiveFailures: 0 }, NOW, cfg, () => 0.5);
  assert.equal(afterSuccess.intervalMs, cfg.intervals.live);
  assert.equal(afterSuccess.due, true);
});

/* ─────────────── 9 · el frontend no pinta nada ─────────────── */

test("9 · la política no depende de nada del frontend: mismos datos, misma decisión, sin campos de visibilidad", () => {
  const e = ev("x", [{ status: "live" }]);
  const a = getEsportsSyncPolicy(e, {}, NOW, cfg);
  const b = getEsportsSyncPolicy({ ...e, ...( { hidden: true, visible: false, tabOpen: false } as object) } as EventSnapshotForPolicy, {}, NOW, cfg);
  assert.deepEqual(a, b);
  assert.equal(a.due, true, "nunca sincronizado → toca ya, haya o no alguien mirando");
});

/* ─────────────── 10 · kill switch y configuración ─────────────── */

test("10 · kill switch: sin ESPORTS_AUTO_SYNC_ENABLED=true la automatización está OFF", () => {
  assert.equal(getEsportsAutoSyncConfig({}).enabled, false);
  assert.equal(getEsportsAutoSyncConfig({ ESPORTS_AUTO_SYNC_ENABLED: "false" }).enabled, false);
  assert.equal(getEsportsAutoSyncConfig({ ESPORTS_AUTO_SYNC_ENABLED: "0" }).enabled, false);
  assert.equal(getEsportsAutoSyncConfig({ ESPORTS_AUTO_SYNC_ENABLED: "true" }).enabled, true);
  assert.equal(DEFAULT_AUTO_SYNC_CONFIG.enabled, false, "el default en código también es OFF");
});

test("config · los intervalos se leen del entorno en segundos y tienen suelo (nunca martillear la fuente)", () => {
  const c = getEsportsAutoSyncConfig({ ESPORTS_AUTO_SYNC_INTERVAL_LIVE_S: "5", ESPORTS_AUTO_SYNC_INTERVAL_ACTIVE_S: "900", ESPORTS_AUTO_SYNC_MAX_CONCURRENCY: "99" });
  assert.equal(c.intervals.live, 30_000, "suelo de 30 s aunque se pida 5");
  assert.equal(c.intervals.active, 900_000);
  assert.equal(c.maxConcurrency, 4, "techo de concurrencia");
  assert.equal(getEsportsAutoSyncConfig({ ESPORTS_AUTO_SYNC_INTERVAL_LIVE_S: "abc" }).intervals.live, cfg.intervals.live, "basura → default");
});

test("config · el secreto del trigger reutiliza SYNC_SECRET, exige longitud mínima y nunca es NEXT_PUBLIC", () => {
  assert.equal(getSyncTriggerSecret({}), null);
  assert.equal(getSyncTriggerSecret({ SYNC_SECRET: "corto" }), null);
  assert.equal(getSyncTriggerSecret({ SYNC_SECRET: "un-secreto-suficientemente-largo" }), "un-secreto-suficientemente-largo");
  assert.equal(getSyncTriggerSecret({ ESPORTS_SYNC_SECRET: "otro-secreto-suficientemente-largo", SYNC_SECRET: "un-secreto-suficientemente-largo" }), "otro-secreto-suficientemente-largo");
  assert.equal(getSyncTriggerSecret({ NEXT_PUBLIC_SYNC_SECRET: "publico-no-vale-nunca-jamas" }), null);
});

test("jitter · determinista con rng inyectado y acotado a ±ratio", () => {
  assert.equal(withJitter(100_000, cfg, () => 0.5), 100_000);
  assert.equal(withJitter(100_000, cfg, () => 1), 110_000);
  assert.equal(withJitter(100_000, cfg, () => 0), 90_000);
});

test("plan · los directos van antes que los activos y estos antes que los próximos", () => {
  const events = [
    ev("soon", [{ status: "upcoming", startTime: iso(NOW + H) }]),
    ev("live", [{ status: "live" }]),
    ev("active", [{ status: "finished" }, { status: "upcoming", startTime: iso(NOW + H) }]),
  ];
  const plan = planSyncRun(events, {}, NOW, cfg);
  assert.deepEqual(plan.due.map((d) => d.eventId), ["live", "active", "soon"]);
  assert.equal(plan.nextDueAt, NOW);
});
