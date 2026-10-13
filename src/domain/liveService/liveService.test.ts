/**
 * FASE 42 · LIVE SERVICE (dominio puro): urgencia real, resets, objetivos de hoy/semana, caducidades, vuelta y progreso
 * reciente. Y la integración en `buildDailyLoop` (una sola prioridad, razón corta).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { MetaObjective } from "@/domain/progression/meta";
import { todayRank, EXPIRING_RANK } from "@/domain/progression/meta";
import { buildDailyLoop, dailyCandidates, reasonFor, type DailyLoopFacts } from "@/domain/dailyLoop";
import { makeRng } from "@/sim/rng";
import {
  DAY, HOUR, URGENCY_WINDOWS, allDone, expiringItems, ledgerRecent, objectiveCards, recentProgress, remainingText, resetText,
  resetWindows, resetsBetween, returningContext, rewardText, urgencyOf,
} from "./index";
import { LIVE_SERVICE_MAP } from "./map";
import { randomFacts, checkSnapshot, returnState, RETURN_HORIZONS } from "./fuzz";

const NOW = Date.UTC(2026, 9, 7, 15, 30);
const obj = (o: Partial<MetaObjective>): MetaObjective => ({ id: "d-duelo-1", label: "Juega un duelo", kind: "daily", current: 0, goal: 1, complete: false, claimed: false, rewardCredits: 250, xp: 200, metric: "duels_played", packId: null, packCount: 0, assignedAt: Date.UTC(2026, 9, 7), expiresAt: Date.UTC(2026, 9, 8), ...o });
const routes = { pickems: "/pickems", claims: "/logros", objective: () => "/jugar", season: "/temporada" };

/* urgencia */
test("urgencia: sin fin real → null (nunca urgencia inventada)", () => {
  assert.equal(urgencyOf(null, NOW), null);
  assert.equal(urgencyOf(undefined, NOW), null);
  assert.equal(urgencyOf(NaN, NOW), null);
  assert.equal(urgencyOf(NOW - 1, NOW), null);
  assert.equal(urgencyOf(NOW, NOW), null);
});
test("urgencia: VERY_SOON ≤ 2 h, SOON ≤ 12 h, NORMAL después (límites incluidos)", () => {
  assert.equal(urgencyOf(NOW + 1, NOW), "VERY_SOON");
  assert.equal(urgencyOf(NOW + URGENCY_WINDOWS.VERY_SOON, NOW), "VERY_SOON");
  assert.equal(urgencyOf(NOW + URGENCY_WINDOWS.VERY_SOON + 1, NOW), "SOON");
  assert.equal(urgencyOf(NOW + URGENCY_WINDOWS.SOON, NOW), "SOON");
  assert.equal(urgencyOf(NOW + URGENCY_WINDOWS.SOON + 1, NOW), "NORMAL");
});
test("tiempo restante legible: min, h min, d h", () => {
  assert.equal(remainingText(NOW + 30_000, NOW), "1 min");
  assert.equal(remainingText(NOW + 45 * 60_000, NOW), "45 min");
  assert.equal(remainingText(NOW + 2 * HOUR + 14 * 60_000, NOW), "2 h 14 min");
  assert.equal(remainingText(NOW + 3 * DAY + 4 * HOUR, NOW), "3 d 4 h");
  assert.equal(remainingText(NOW + 2 * DAY, NOW), "2 d");
  assert.equal(remainingText(NOW - 1, NOW), null);
  assert.equal(resetText(NOW + 6 * HOUR, NOW), "Se renueva en 6 h 00 min");
});

/* resets */
test("resets: diario 00:00 UTC y semanal lunes 00:00 UTC, siempre en el futuro", () => {
  const r = resetWindows(NOW);
  assert.equal(r.dailyEndsAt, Date.UTC(2026, 9, 8));
  assert.equal(new Date(r.weeklyEndsAt).getUTCDay(), 1);
  assert.ok(r.dailyEndsAt > NOW && r.weeklyEndsAt > NOW && r.dailyStartsAt <= NOW && r.weeklyStartsAt <= NOW);
});
test("resets cruzados entre dos instantes", () => {
  assert.equal(resetsBetween("daily", NOW, NOW + HOUR), 0);
  assert.equal(resetsBetween("daily", NOW, NOW + DAY), 1);
  assert.equal(resetsBetween("daily", NOW, NOW + 7 * DAY), 7);
  assert.equal(resetsBetween("weekly", NOW, NOW + 14 * DAY), 2);
  assert.equal(resetsBetween("daily", NOW, NOW - DAY), 0);
});

/* objetivos */
test("tarjetas de hoy: solo diarias vivas, estado real y recompensa de la definición", () => {
  const cards = objectiveCards([obj({}), obj({ id: "w-duelos-5", kind: "weekly" }), obj({ id: "old", expiresAt: NOW - 1 }), obj({ id: "d-abrir-1", complete: true, current: 1 }), obj({ id: "d-duelo-win", claimed: true, complete: true, current: 1 })], "daily", NOW);
  assert.deepEqual(cards.map((c) => [c.id, c.status]), [["d-abrir-1", "CLAIMABLE"], ["d-duelo-1", "IN_PROGRESS"], ["d-duelo-win", "CLAIMED"]]);
  assert.equal(cards[1].reward, "250 créditos · 200 XP del pase");
});
test("semana separada de hoy (no se mezclan)", () => {
  const list = [obj({}), obj({ id: "w-duelos-5", kind: "weekly", goal: 5 })];
  assert.deepEqual(objectiveCards(list, "weekly", NOW).map((c) => c.id), ["w-duelos-5"]);
  assert.deepEqual(objectiveCards(list, "daily", NOW).map((c) => c.id), ["d-duelo-1"]);
});
test("recompensa con sobre y sin créditos", () => {
  assert.equal(rewardText({ rewardCredits: 0, xp: 2500, packId: "estandar", packCount: 2 }, () => "Sobre Estándar"), "2 × Sobre Estándar · 2500 XP del pase");
  assert.equal(rewardText({ rewardCredits: 0, xp: 0, packId: null, packCount: 0 }), "Sin recompensa");
});
test("allDone: todas cobradas; vacía NO cuenta como hecha", () => {
  assert.equal(allDone([]), false);
  assert.equal(allDone(objectiveCards([obj({ claimed: true, complete: true, current: 1 })], "daily", NOW)), true);
  assert.equal(allDone(objectiveCards([obj({ complete: true, current: 1 })], "daily", NOW)), false);
});

/* caducidades */
test("caducidades: Pick'em con cierre real; sin cierre no aparece", () => {
  const withLock = expiringItems({ now: NOW, pickem: { eventName: "VCT", pending: 2, nextLockAt: NOW + HOUR }, today: [], thisWeek: [], seasonEndsAt: null, routes });
  assert.equal(withLock[0].source, "pickems"); assert.equal(withLock[0].urgency, "VERY_SOON");
  assert.deepEqual(expiringItems({ now: NOW, pickem: { eventName: "VCT", pending: 2, nextLockAt: null }, today: [], thisWeek: [], seasonEndsAt: null, routes }), []);
  assert.deepEqual(expiringItems({ now: NOW, pickem: { eventName: "VCT", pending: 0, nextLockAt: NOW + HOUR }, today: [], thisWeek: [], seasonEndsAt: null, routes }), []);
});
test("caducidades: recompensa cobrable antes del reset; objetivo en progreso solo si muy pronto y con avance", () => {
  const today = objectiveCards([obj({ id: "d-abrir-1", complete: true, current: 1 }), obj({ id: "d-duelo-1", goal: 2, current: 1 })], "daily", Date.UTC(2026, 9, 7, 23));
  const items = expiringItems({ now: Date.UTC(2026, 9, 7, 23), pickem: null, today, thisWeek: [], seasonEndsAt: null, routes });
  assert.deepEqual(items.map((i) => i.source).sort(), ["claim", "objective"]);
  const early = expiringItems({ now: NOW - 10 * HOUR, pickem: null, today: objectiveCards([obj({ id: "d-duelo-1", goal: 2, current: 1 })], "daily", NOW - 10 * HOUR), thisWeek: [], seasonEndsAt: null, routes });
  assert.deepEqual(early, []);
});
test("caducidades: temporada solo en su última semana; máximo 3 y ordenadas", () => {
  assert.equal(expiringItems({ now: NOW, pickem: null, today: [], thisWeek: [], seasonEndsAt: NOW + 8 * DAY, routes }).length, 0);
  assert.equal(expiringItems({ now: NOW, pickem: null, today: [], thisWeek: [], seasonEndsAt: NOW + 6 * DAY, routes })[0].source, "season");
  const many = expiringItems({ now: NOW, pickem: { eventName: null, pending: 1, nextLockAt: NOW + 3 * HOUR }, today: objectiveCards([obj({ id: "a", complete: true, current: 1 }), obj({ id: "b", complete: true, current: 1 })], "daily", NOW), thisWeek: objectiveCards([obj({ id: "c", kind: "weekly", complete: true, current: 1, expiresAt: NOW + 3 * DAY })], "weekly", NOW), seasonEndsAt: NOW + 5 * DAY, routes });
  assert.equal(many.length, 3);
  for (let i = 1; i < many.length; i++) assert.ok(many[i].endsAt >= many[i - 1].endsAt);
});

/* vuelta */
const ret = (o: Partial<Parameters<typeof returningContext>[0]> = {}) => returningContext({ now: NOW, lastActivityAt: NOW - 3 * DAY, today: objectiveCards([obj({})], "daily", NOW), thisWeek: [], activeMatch: false, draftRun: null, pickem: null, liveEventName: null, claimable: 0, seasonEndsAt: null, ...o });
test("vuelta: nada antes de 1 día; sin actividad conocida, nada", () => {
  assert.equal(ret({ lastActivityAt: NOW - 23 * HOUR }), null);
  assert.equal(ret({ lastActivityAt: null }), null);
  assert.ok(ret({ lastActivityAt: NOW - DAY }));
});
for (const days of [1, 3, 7, 14, 30]) {
  test(`vuelta tras ${days} d: días fuera, resets reales, ≤ 3 hechos verdaderos, sin castigo`, () => {
    const r = ret({ lastActivityAt: NOW - days * DAY, activeMatch: true, claimable: 2, draftRun: { status: "READY", stage: 2 }, pickem: { eventName: "VCT", pending: 1, nextLockAt: NOW + 3 * HOUR }, seasonEndsAt: NOW + 10 * DAY })!;
    assert.equal(r.daysAway, days);
    assert.equal(r.dailyResets, days);
    assert.ok(r.facts.length <= 3 && r.facts.length > 0);
    assert.ok(r.facts.every((f) => !/racha|perdido|recompensa por volver|streak/i.test(f)));
    assert.equal(r.facts[0], "Tu partida sigue abierta: puedes continuarla.");
  });
}
test("vuelta en la misma semana: el semanal en curso sigue activo (continuidad)", () => {
  const monday = Date.UTC(2026, 9, 5, 10);
  const r = returningContext({ now: monday + 2 * DAY, lastActivityAt: monday, today: [], thisWeek: objectiveCards([obj({ id: "w-duelos-5", kind: "weekly", goal: 5, current: 3, expiresAt: Date.UTC(2026, 9, 12) })], "weekly", monday + 2 * DAY), activeMatch: false, draftRun: null, pickem: null, liveEventName: null, claimable: 0, seasonEndsAt: null })!;
  assert.ok(r.facts.some((f) => f.includes("sigue activo (3 / 5)")));
});
test("vuelta tras varias semanas: objetivos nuevos, sin listar lo caducado", () => {
  const r = ret({ lastActivityAt: NOW - 14 * DAY, thisWeek: objectiveCards([obj({ id: "w-duelos-5", kind: "weekly", goal: 5, expiresAt: NOW + 3 * DAY })], "weekly", NOW) })!;
  assert.ok(r.facts.includes("Hay objetivos diarios nuevos."));
  assert.ok(r.facts.includes("Hay objetivos semanales nuevos."));
  assert.ok(r.weeklyResets >= 2);
});

/* progreso reciente */
test("progreso reciente: solo motivos reales del libro mayor, con importe; lo demás no cuenta", () => {
  const at = "2026-10-07T10:00:00.000Z";
  assert.equal(ledgerRecent({ reason: "duel_win", delta: 120, created_at: at }, 0)!.label, "Victoria en partida rápida (+120 créditos)");
  assert.match(ledgerRecent({ reason: "duel_capped_win", delta: 0, created_at: at }, 0)!.label, /tope diario/);
  assert.equal(ledgerRecent({ reason: "starter_grant", delta: 6000, created_at: at }, 0), null);
  assert.equal(ledgerRecent({ reason: "qa_fund", delta: 1, created_at: at }, 0), null);
  assert.equal(ledgerRecent({ reason: "duel_win", delta: 120, created_at: "no-date" }, 0), null);
  assert.equal(ledgerRecent({ reason: "buy_pack:estandar", delta: -750, created_at: at }, 0, () => "Sobre Estándar")!.label, "Conseguiste un Sobre Estándar");
});
test("progreso reciente: acotado a 3 y del más nuevo al más viejo", () => {
  const r = recentProgress([{ id: "a", label: "a", at: 1 }, { id: "b", label: "b", at: 3 }, { id: "c", label: "c", at: 2 }, { id: "d", label: "d", at: 4 }]);
  assert.deepEqual(r.map((x) => x.id), ["d", "b", "c"]);
});

/* prioridad única + razón */
const base = (): DailyLoopFacts => randomFacts(makeRng(424242));
test("prioridad: Pick'em que cierra muy pronto sube a 1,5 (encima de reclamar, debajo de retomar)", () => {
  assert.equal(todayRank({ kind: "predict", urgency: "VERY_SOON" }), EXPIRING_RANK);
  assert.equal(todayRank({ kind: "predict", urgency: "SOON" }), 3);
  assert.equal(todayRank({ kind: "claim", urgency: "VERY_SOON" }), EXPIRING_RANK);
  assert.equal(todayRank({ kind: "resume", urgency: "VERY_SOON" }), 0);
  assert.equal(todayRank({ kind: "play", urgency: "VERY_SOON" }), 7, "jugar no tiene plazo propio");
  assert.equal(todayRank({ kind: "run" }), 0.7);
});
test("run de Draft fuera de combate: acción propia, detrás de una partida abierta", () => {
  const f = { ...base(), signedIn: true, journey: null, matches: [{ id: "m", mode: "PVE" as const, difficulty: "EASY" as const, opponent: null, node: null }], draftRun: { id: "r", status: "READY" as const, stage: 3 } };
  const s = buildDailyLoop(f);
  assert.equal(s.primaryAction.id, "resume-pve");
  assert.ok(s.secondaryActions.some((a) => a.id === "resume-draft-run"));
  const noMatch = buildDailyLoop({ ...f, matches: [] });
  assert.equal(noMatch.primaryAction.id, "resume-draft-run");
  assert.equal(noMatch.primaryAction.reason, "Tu run de Draft Gauntlet sigue en curso.");
});
test("toda acción lleva razón corta y verdadera", () => {
  for (let i = 0; i < 200; i++) {
    const f = randomFacts(makeRng(i + 1));
    for (const a of dailyCandidates(f)) assert.ok(reasonFor(a, f).length > 5, a.id);
  }
});
test("mapa live service: los 12+ sistemas pedidos, con todos los campos", () => {
  for (const s of ["daily missions", "weekly missions", "Season", "Battle Pass", "live events", "Pick'ems", "event challenges", "campaign", "Draft active run", "PvP active match", "private challenge", "packs", "achievements"]) assert.ok(LIVE_SERVICE_MAP.some((x) => x.system === s), s);
  for (const x of LIVE_SERVICE_MAP) for (const k of ["scope", "startsAt", "endsAt", "resetAt", "sourceOfTruth", "authority", "read", "mutation"] as const) assert.ok(String(x[k]).length > 0, `${x.system}.${k}`);
});
test("fuzz de prioridad (2.000 combinaciones): 0 violaciones", () => {
  let n = 0;
  for (let i = 1; i <= 2000; i++) { const f = randomFacts(makeRng(i * 31)); n += checkSnapshot(f, buildDailyLoop(f)).length; }
  assert.equal(n, 0);
});
test("simulación de retorno (1.400 estados, 7 horizontes): 0 violaciones", () => {
  let n = 0;
  for (let i = 1; i <= 1400; i++) n += returnState(makeRng(i * 17), `t${i}`, RETURN_HORIZONS[i % 7]).violations.length;
  assert.equal(n, 0);
});
