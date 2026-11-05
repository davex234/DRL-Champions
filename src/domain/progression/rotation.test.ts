/**
 * FASE 42 · ROTACIÓN PURA DE MISIONES: determinista, anclada al inicio de la ventana, idempotente y sin escrituras.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { freshPassState } from "@/battlepass/season";
import type { MetricSnapshot, PassState } from "@/battlepass/types";
import { CURRENT_SEASON } from "@/data/season";
import { missionProgress } from "@/battlepass/missions";
import { periodWindow } from "./periods";
import {
  BATCH_SIZE, WINDOW_METRICS, batchFor, countKey, dueKinds, missionViewsOf, newDistinctSince, resolvePassWindows, windowNeeds, windowSeed,
} from "./rotation";

const U = "user-rot-1";
const D = 86_400_000;
const NOW = Date.UTC(2026, 9, 7, 15, 30); // miércoles
const SEASON_START = Date.UTC(2026, 8, 7);
const metrics = (o: MetricSnapshot = {}): MetricSnapshot => ({ duels_played: 10, duels_won: 4, packs_opened: 20, picks_made: 3, distinct_cards: 60, points: 100, decks_saved: 1, region_set: 1, owned_cards: 80, ...o });
const resolve = (state: PassState, now = NOW, m = metrics(), since: Record<string, number> = {}, created: number | null = SEASON_START + D) =>
  resolvePassWindows({ state, season: CURRENT_SEASON, userId: U, metrics: m, sinceWindow: since, now, accountCreatedAt: created, seasonStartsAt: SEASON_START });

test("semilla estable por (usuario, temporada, tipo, ventana) y distinta si cambia cualquiera", () => {
  const a = windowSeed(U, "s1", "daily", 1);
  assert.equal(a, windowSeed(U, "s1", "daily", 1));
  assert.notEqual(a, windowSeed("otro", "s1", "daily", 1));
  assert.notEqual(a, windowSeed(U, "s2", "daily", 1));
  assert.notEqual(a, windowSeed(U, "s1", "weekly", 1));
  assert.notEqual(a, windowSeed(U, "s1", "daily", 2));
  assert.ok(a >= 1 && a < 2147483647);
});

test("la tanda de una ventana es determinista y del tamaño real (3 diarias, 2 semanales, sin repetir)", () => {
  for (const kind of ["daily", "weekly"] as const) {
    const w = periodWindow(kind, NOW)!;
    const b1 = batchFor(CURRENT_SEASON.missionPool, U, CURRENT_SEASON.id, kind, w.startsAt).map((d) => d.id);
    const b2 = batchFor(CURRENT_SEASON.missionPool, U, CURRENT_SEASON.id, kind, w.startsAt).map((d) => d.id);
    assert.deepEqual(b1, b2);
    assert.equal(b1.length, BATCH_SIZE[kind]);
    assert.equal(new Set(b1).size, b1.length);
  }
});

test("usuarios distintos no comparten necesariamente tanda (variedad real, no aleatoria por lectura)", () => {
  // CORE GAME LOOP · sin `picks_made` (Pick'em legacy retirado) la diaria elegible son 3 de 3: abrir, jugar y ganar,
  // la misma para todos. La variedad vive en la semanal (2 de 4).
  const w = periodWindow("weekly", NOW)!;
  const sets = new Set(Array.from({ length: 40 }, (_, i) => batchFor(CURRENT_SEASON.missionPool, `u${i}`, CURRENT_SEASON.id, "weekly", w.startsAt).map((d) => d.id).sort().join()));
  assert.ok(sets.size > 1);
  const d = periodWindow("daily", NOW)!;
  const daily = new Set(Array.from({ length: 40 }, (_, i) => batchFor(CURRENT_SEASON.missionPool, `u${i}`, CURRENT_SEASON.id, "daily", d.startsAt).map((x) => x.id).sort().join()));
  assert.deepEqual([...daily], ["d-abrir-1,d-duelo-1,d-duelo-win"]);
});

test("cuenta sin pase: asigna diarias, semanales y fijas; nada más", () => {
  const r = resolve(freshPassState(CURRENT_SEASON.id));
  assert.ok(r.changed && r.assigned);
  assert.equal(r.state.missions.filter((m) => m.kind === "daily").length, 3);
  assert.equal(r.state.missions.filter((m) => m.kind === "weekly").length, 2);
  assert.equal(r.state.missions.filter((m) => m.kind === "seasonal" || m.kind === "progressive").length, CURRENT_SEASON.missionPool.filter((m) => m.kind === "seasonal" || m.kind === "progressive").length);
});

test("idempotente: resolver el resultado no cambia nada (dos pestañas, relectura)", () => {
  const r = resolve(freshPassState(CURRENT_SEASON.id));
  const again = resolve(r.state);
  assert.equal(again.changed, false);
  assert.deepEqual(again.state, r.state);
});

test("assignedAt = inicio de la ventana (la clave del reclamo es la misma toda la ventana)", () => {
  const r = resolve(freshPassState(CURRENT_SEASON.id));
  for (const m of r.state.missions.filter((x) => x.kind === "daily")) assert.equal(m.assignedAt, periodWindow("daily", NOW)!.startsAt);
  for (const m of r.state.missions.filter((x) => x.kind === "weekly")) assert.equal(m.assignedAt, periodWindow("weekly", NOW)!.startsAt);
});

test("baseline ANCLADA: progreso = eventos desde el inicio de la ventana, lea cuando lea", () => {
  const ws = periodWindow("daily", NOW)!.startsAt;
  const since = Object.fromEntries(WINDOW_METRICS.map((m) => [countKey(m, ws), 2]));
  const r = resolve(freshPassState(CURRENT_SEASON.id), NOW, metrics(), { ...since, ...Object.fromEntries(WINDOW_METRICS.map((m) => [countKey(m, periodWindow("weekly", NOW)!.startsAt), 2])) });
  for (const m of r.state.missions.filter((x) => x.kind === "daily")) assert.equal(missionProgress(m, metrics()), Math.min(m.goal, 2), m.id);
});

test("baseline nunca negativa aunque el recuento supere el valor actual", () => {
  const ws = periodWindow("daily", NOW)!.startsAt;
  const r = resolve(freshPassState(CURRENT_SEASON.id), NOW, metrics({ duels_played: 1 }), { [countKey("duels_played", ws)]: 50 });
  for (const m of r.state.missions) assert.ok(m.baseline >= 0);
});

test("cuenta nueva de la temporada: fijas con baseline 0 (lo hecho desde el alta cuenta)", () => {
  const r = resolve(freshPassState(CURRENT_SEASON.id), NOW, metrics({ decks_saved: 1 }), {}, SEASON_START + 10 * D);
  const s = r.state.missions.find((m) => m.id === "s-mazo")!;
  assert.equal(s.baseline, 0);
  assert.equal(missionProgress(s, metrics({ decks_saved: 1 })), 1);
});

test("cuenta anterior a la temporada sin pase: fijas desde ahora (sin regalar hitos)", () => {
  const r = resolve(freshPassState(CURRENT_SEASON.id), NOW, metrics({ distinct_cards: 400 }), {}, SEASON_START - 30 * D);
  const p = r.state.missions.find((m) => m.id === "p-coleccion-50")!;
  assert.equal(missionProgress(p, metrics({ distinct_cards: 400 })), 0);
});

test("rotación: solo los tipos vencidos; lo fijo no se toca", () => {
  const r0 = resolve(freshPassState(CURRENT_SEASON.id));
  const tomorrow = NOW + D;
  assert.deepEqual(dueKinds(r0.state, tomorrow), ["daily"]);
  const r1 = resolve(r0.state, tomorrow);
  assert.deepEqual(r1.rotated, ["daily"]);
  assert.deepEqual(r1.state.missions.filter((m) => m.kind === "weekly"), r0.state.missions.filter((m) => m.kind === "weekly"));
  assert.deepEqual(r1.state.missions.filter((m) => m.kind === "seasonal"), r0.state.missions.filter((m) => m.kind === "seasonal"));
});

test("lunes: rotan diarias Y semanales", () => {
  const r0 = resolve(freshPassState(CURRENT_SEASON.id));
  const monday = periodWindow("weekly", NOW)!.endsAt + 3_600_000;
  assert.deepEqual(dueKinds(r0.state, monday).sort(), ["daily", "weekly"]);
});

test("diaria caducada: desaparece (no se acumulan 14 días de tandas)", () => {
  const r0 = resolve(freshPassState(CURRENT_SEASON.id));
  let s = r0.state;
  for (let d = 1; d <= 14; d++) s = resolve(s, NOW + d * D).state;
  assert.equal(s.missions.filter((m) => m.kind === "daily").length, 3);
  assert.equal(new Set(s.missions.filter((m) => m.kind === "daily").map((m) => m.assignedAt)).size, 1);
});

test("una cobrada de la tanda vigente sigue cobrada al releer (no reaparece reclamable)", () => {
  const r0 = resolve(freshPassState(CURRENT_SEASON.id));
  const st = { ...r0.state, missions: r0.state.missions.map((m) => (m.kind === "daily" ? { ...m, claimed: true } : m)) };
  const again = resolve(st, NOW + 3_600_000);
  assert.equal(again.changed, false);
  assert.ok(again.state.missions.filter((m) => m.kind === "daily").every((m) => m.claimed));
});

test("carril competitivo: se abre en el estado resuelto al llegar a los puntos (sin escribir aquí)", () => {
  const st = resolve(freshPassState(CURRENT_SEASON.id)).state;
  const r = resolve(st, NOW, metrics({ points: CURRENT_SEASON.competitiveMinPoints ?? 400 }));
  assert.ok(r.unlockedCompetitive && r.state.competitiveUnlocked && r.changed);
});

test("reloj adelantado del servidor no; tanda de una ventana FUTURA no rota hacia atrás", () => {
  const future = resolve(freshPassState(CURRENT_SEASON.id), NOW + 2 * D).state;
  assert.deepEqual(dueKinds(future, NOW), []);
});

test("windowNeeds: solo métricas de las tandas vencidas, acotado", () => {
  const needs = windowNeeds(freshPassState(CURRENT_SEASON.id), CURRENT_SEASON, U, NOW);
  assert.ok(needs.length > 0 && needs.length <= 10);
  const st = resolve(freshPassState(CURRENT_SEASON.id)).state;
  assert.deepEqual(windowNeeds(st, CURRENT_SEASON, U, NOW), []);
});

test("newDistinctSince: cartas cuyo PRIMER ejemplar llegó en la ventana", () => {
  const rows = [{ card_id: "a", obtainedAt: 10 }, { card_id: "a", obtainedAt: 100 }, { card_id: "b", obtainedAt: 100 }, { card_id: "c", obtainedAt: null }];
  assert.equal(newDistinctSince(rows, 50), 2); // b y c (sin fecha = no consta antes)
  assert.equal(newDistinctSince(rows, 5), 3);
});

test("missionViewsOf: misma vista que el servidor (progreso acotado, caducidad de su ventana)", () => {
  const st = resolve(freshPassState(CURRENT_SEASON.id)).state;
  const v = missionViewsOf(st.missions, metrics({ duels_played: 999 }), CURRENT_SEASON.missionPool);
  for (const o of v) {
    assert.ok(o.current <= o.goal);
    if (o.kind === "daily") assert.equal(o.expiresAt, periodWindow("daily", NOW)!.endsAt);
    if (o.kind === "seasonal") assert.equal(o.expiresAt, null);
  }
});

test("la zona horaria del cliente no existe aquí: ventanas UTC puras", () => {
  const late = Date.UTC(2026, 9, 7, 23, 59, 59);
  const early = Date.UTC(2026, 9, 8, 0, 0, 1);
  assert.notEqual(periodWindow("daily", late)!.startsAt, periodWindow("daily", early)!.startsAt);
  assert.equal(periodWindow("daily", early)!.startsAt, Date.UTC(2026, 9, 8));
});
