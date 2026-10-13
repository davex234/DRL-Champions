/**
 * FASE 42 · LIVE SERVICE — PRESENTACIÓN, RENDER Y TOPE PvE.
 *
 * Modelos puros (chips de plazo, secciones hoy/semana, vuelta, «qué sigue»), héroe con razón y plazo real, render
 * del vestíbulo (vuelta, objetivos, caducidades) y de «Qué sigue», frontera de refresco del cliente, textos de
 * progreso reciente y cupos atómicos del tope PvE (`takeDuelPaySlot`).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { DailyLobby } from "@/components/dailyLoop/DailyLobby";
import { NextUpAfter } from "./NextUpAfter";
import { buildDailyLoop, type DailyLoopFacts, type DailyLoopSnapshot } from "@/domain/dailyLoop";
import type { MetaObjective } from "@/domain/progression/meta";
import { periodWindow } from "@/domain/progression/periods";
import { DAY, HOUR, allDone, expiringItems, ledgerRecent, objectiveCards, recentProgress, remainingText, resetsBetween, returningContext, rewardText } from "@/domain/liveService";
import { LIVE_SERVICE_MAP } from "@/domain/liveService/map";
import { afterActivityModel, deadlineChip, objectiveRows, objectiveSections, returningModel } from "@/lib/liveService/presentation";
import { heroModel } from "@/lib/dailyLoop/presentation";
import { nextBoundary, REFRESH_INTERVAL_MS } from "@/lib/dailyLoop/client";
import { MemSupabase } from "@/server/services/testing/memSupabase";
import { capMatchRef, capSlotRef, takeDuelPaySlot, utcDayKey } from "@/server/services/duelCap";
import { DAILY_DUEL_AWARD_CAP } from "@/domain/progression/duelRewards";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const NOW = Date.UTC(2026, 9, 7, 15, 30);
const dw = periodWindow("daily", NOW)!; const ww = periodWindow("weekly", NOW)!;

const obj = (o: Partial<MetaObjective> & { id: string }): MetaObjective => ({
  label: `Objetivo ${o.id}`, kind: "daily", current: 0, goal: 3, complete: false, claimed: false, rewardCredits: 250, xp: 200,
  metric: "duels_played", packId: null, packCount: 0, assignedAt: dw.startsAt, expiresAt: dw.endsAt, ...o,
});
function facts(o: Partial<DailyLoopFacts> = {}): DailyLoopFacts {
  return {
    now: NOW, signedIn: true, catalogSize: 772, matches: [], draftRun: null, social: { incoming: 0, from: null }, journey: null,
    progression: {
      account: { level: 7, xp: 2400, xpIntoLevel: 120, xpForNext: 600, progress: 0.2 },
      pass: { level: 3, maxLevel: 50, xp: 3400, xpIntoLevel: 400, xpForNext: 1000, progress: 0.4, nextReward: { level: 4, track: "free", label: "300 créditos" } },
      claimableLevels: 0,
      objectives: [
        obj({ id: "d-duelo-1", current: 1 }), obj({ id: "d-abrir-1", metric: "packs_opened", goal: 1 }), obj({ id: "d-win", metric: "duels_won", goal: 2, current: 2, complete: true }),
        obj({ id: "w-duelos-5", kind: "weekly", goal: 5, current: 3, assignedAt: ww.startsAt, expiresAt: ww.endsAt }),
        obj({ id: "w-sobres", kind: "weekly", metric: "packs_opened", goal: 5, current: 5, complete: true, claimed: true, assignedAt: ww.startsAt, expiresAt: ww.endsAt }),
      ],
      achievements: { total: 12, claimed: 2, claimable: 0, near: null }, rotationPending: false,
      metrics: { ownedCards: 25, distinctCards: 22, packsOpened: 5, duelsPlayed: 3 },
    },
    pickems: { pending: 0, open: 0, eventId: null, eventName: null, nextLockAt: null }, packs: { unopened: 0 },
    decks: { total: 1, valid: 1, active: { id: "d", name: "Equipo 2", valid: true, size: 10, sumOvr: 813 }, firstInvalid: null },
    campaign: { completed: 1, total: 15, complete: false, next: { nodeId: "c1-n2", name: "Segundo asalto", team: "LOUD", chapterOrder: 1 } },
    competitive: { rating: null, gamesPlayed: 0, wins: 0, losses: 0, draws: 0, provisional: true, position: null, rankedTotal: 40, recent: [] },
    live: [],
    season: { current: { id: "nexus-s1", name: "Temporada 1", status: "ACTIVE", presentation: "ACTIVE", startsAtMs: NOW - 10 * DAY, endsAtMs: NOW + 50 * DAY }, next: null },
    ...o,
  } as DailyLoopFacts;
}
const snap = (o: Partial<DailyLoopFacts> = {}): DailyLoopSnapshot => buildDailyLoop(facts(o));
const lobby = (s: DailyLoopSnapshot) => renderToStaticMarkup(<DailyLobby snap={s} now={s.serverNow} />);
const ROUTES = { claims: "/logros", objective: (m: string) => (m.startsWith("packs") ? "/sobres" : "/duelos") };

/* ───────── dominio: textos y objetivos ───────── */

test("remainingText: días, horas y minutos (y null si ya terminó)", () => {
  assert.equal(remainingText(NOW + 3 * DAY + 4 * HOUR, NOW), "3 d 4 h");
  assert.equal(remainingText(NOW + 2 * DAY, NOW), "2 d");
  assert.equal(remainingText(NOW + 2 * HOUR + 5 * 60_000, NOW), "2 h 05 min");
  assert.equal(remainingText(NOW + 20_000, NOW), "1 min");
  assert.equal(remainingText(NOW, NOW), null);
});
test("resetsBetween cuenta límites UTC cruzados (diario y semanal)", () => {
  assert.equal(resetsBetween("daily", NOW, NOW + HOUR), 0);
  assert.equal(resetsBetween("daily", NOW, NOW + 3 * DAY), 3);
  assert.equal(resetsBetween("weekly", NOW, NOW + 14 * DAY), 2);
  assert.equal(resetsBetween("daily", NOW, NOW - DAY), 0);
});
test("rewardText copia la definición (créditos, sobre, XP) y no inventa", () => {
  assert.equal(rewardText({ rewardCredits: 250, xp: 200, packId: null, packCount: 0 }), "250 créditos · 200 XP del pase");
  assert.equal(rewardText({ rewardCredits: 0, xp: 0, packId: "estandar", packCount: 2 }, () => "Sobre Estándar"), "2 × Sobre Estándar");
  assert.equal(rewardText({ rewardCredits: 0, xp: 0, packId: null, packCount: 0 }), "Sin recompensa");
});
test("objectiveCards: reclamables primero, cobrados al final, caducadas fuera", () => {
  const list = [obj({ id: "a", current: 1 }), obj({ id: "b", claimed: true, complete: true, current: 3 }), obj({ id: "c", complete: true, current: 3 }), obj({ id: "old", complete: true, current: 3, assignedAt: dw.startsAt - DAY, expiresAt: dw.startsAt })];
  assert.deepEqual(objectiveCards(list, "daily", NOW).map((c) => `${c.id}:${c.status}`), ["c:CLAIMABLE", "a:IN_PROGRESS", "b:CLAIMED"]);
});
test("objectiveCards acota el progreso a la meta", () => {
  assert.equal(objectiveCards([obj({ id: "x", current: 99, complete: true })], "daily", NOW)[0].progressLabel, "3 / 3");
});
test("allDone: tanda vacía no está hecha; todo cobrado sí", () => {
  assert.equal(allDone([]), false);
  assert.equal(allDone(objectiveCards([obj({ id: "a", claimed: true, complete: true, current: 3 })], "daily", NOW)), true);
});
test("expiringItems: solo fines reales, ordenados y como mucho 3", () => {
  const today = objectiveCards([obj({ id: "c", complete: true, current: 3 })], "daily", NOW);
  const items = expiringItems({ now: NOW, pickem: { eventName: "Masters", pending: 2, nextLockAt: NOW + HOUR }, today, thisWeek: [], seasonEndsAt: NOW + 3 * DAY, routes: { pickems: "/pickems", claims: "/logros", objective: () => "/duelos", season: "/temporada" } });
  assert.deepEqual(items.map((i) => i.source), ["pickems", "claim", "season"]);
  assert.ok(items.every((i) => i.endsAt > NOW));
  assert.deepEqual(expiringItems({ now: NOW, pickem: { eventName: null, pending: 2, nextLockAt: null }, today: [], thisWeek: [], seasonEndsAt: NOW + 30 * DAY, routes: { pickems: "", claims: "", objective: () => "", season: "" } }), []);
});
test("expiringItems: un objetivo en progreso solo cuenta si queda muy poco Y ya hay progreso", () => {
  const late = dw.endsAt - HOUR;
  const mk = (current: number) => objectiveCards([obj({ id: "p", current })], "daily", late);
  const r = { pickems: "", claims: "", objective: () => "/duelos", season: "" };
  assert.equal(expiringItems({ now: late, pickem: null, today: mk(1), thisWeek: [], seasonEndsAt: null, routes: r }).length, 1);
  assert.equal(expiringItems({ now: late, pickem: null, today: mk(0), thisWeek: [], seasonEndsAt: null, routes: r }).length, 0);
  assert.equal(expiringItems({ now: NOW, pickem: null, today: objectiveCards([obj({ id: "p", current: 1 })], "daily", NOW), thisWeek: [], seasonEndsAt: null, routes: r }).length, 0);
});
test("returningContext: < 1 día o sin actividad conocida → nada", () => {
  const base = { now: NOW, today: [], thisWeek: [], activeMatch: false, draftRun: null, pickem: null, liveEventName: null, claimable: 0, seasonEndsAt: null };
  assert.equal(returningContext({ ...base, lastActivityAt: NOW - 20 * HOUR }), null);
  assert.equal(returningContext({ ...base, lastActivityAt: null }), null);
});
test("returningContext: la semanal a medias sigue viva si no cambió la semana", () => {
  const thisWeek = objectiveCards([obj({ id: "w", kind: "weekly", goal: 5, current: 2, assignedAt: ww.startsAt, expiresAt: ww.endsAt })], "weekly", NOW);
  const r = returningContext({ now: NOW, lastActivityAt: ww.startsAt + HOUR, today: [], thisWeek, activeMatch: false, draftRun: null, pickem: null, liveEventName: null, claimable: 0, seasonEndsAt: null })!;
  assert.equal(r.weeklyResets, 0);
  assert.match(r.facts[0], /sigue activo \(2 \/ 5\)/);
});
test("returningContext: nunca habla de lo perdido ni de rachas", () => {
  const today = objectiveCards([obj({ id: "a" })], "daily", NOW);
  const r = returningContext({ now: NOW, lastActivityAt: NOW - 30 * DAY, today, thisWeek: [], activeMatch: false, draftRun: null, pickem: null, liveEventName: null, claimable: 0, seasonEndsAt: NOW + DAY })!;
  assert.ok(!/perdi|racha|castig|te has ido/i.test(r.facts.join(" ")));
  assert.equal(r.daysAway, 30);
});
test("ledgerRecent: motivos reales → frases; desconocidos y fechas inválidas fuera", () => {
  const at = new Date(NOW).toISOString();
  assert.equal(ledgerRecent({ reason: "duel_win", delta: 120, created_at: at }, 0)!.label, "Victoria en partida rápida (+120 créditos)");
  assert.equal(ledgerRecent({ reason: "buy_pack:estandar", delta: -500, created_at: at }, 1, () => "Sobre Estándar")!.label, "Conseguiste un Sobre Estándar");
  assert.equal(ledgerRecent({ reason: "admin_adjust", delta: 1, created_at: at }, 2), null);
  assert.equal(ledgerRecent({ reason: "duel_win", delta: 1, created_at: "nope" }, 3), null);
});
test("recentProgress: del más nuevo al más viejo, máximo 3", () => {
  const f = [1, 5, 3, 4, 2].map((n) => ({ id: `f${n}`, label: `F${n}`, at: n }));
  assert.deepEqual(recentProgress(f).map((x) => x.id), ["f5", "f4", "f3"]);
});
test("mapa del live service: 15 sistemas con todos los campos y autoridad servidor", () => {
  assert.equal(LIVE_SERVICE_MAP.length, 15);
  for (const s of LIVE_SERVICE_MAP) for (const k of ["system", "scope", "sourceOfTruth", "authority", "actionable", "claimable", "expiring", "recurring", "economic"]) assert.ok(k in s, `${s.system}.${k}`);
  assert.ok(LIVE_SERVICE_MAP.every((s) => !/client/i.test(String((s as { authority: string }).authority)) || /render/i.test(String((s as { authority: string }).authority))));
});

/* ───────── presentación ───────── */

test("deadlineChip: texto + nivel + aria; sin fin real no hay chip", () => {
  assert.deepEqual(deadlineChip(NOW + HOUR, NOW), { label: "Cierra en 1 h 00 min", urgency: "VERY_SOON", aria: "Cierra en 1 h 00 min · Muy pronto" });
  assert.equal(deadlineChip(null, NOW), null);
  assert.equal(deadlineChip(NOW - 1, NOW), null);
});
test("objectiveRows: reclamable → Logros; en progreso → la pantalla del objetivo", () => {
  const rows = objectiveRows(objectiveCards([obj({ id: "c", complete: true, current: 3 }), obj({ id: "p", metric: "packs_opened", current: 1 })], "daily", NOW), ROUTES);
  assert.deepEqual(rows.map((r) => [r.statusLabel, r.href]), [["Reclamar", "/logros"], ["En progreso", "/sobres"]]);
  assert.ok(rows.every((r) => r.pct >= 0 && r.pct <= 100));
});
test("objectiveSections: hoy y semana separados con su propio reset", () => {
  const s = objectiveSections(snap(), NOW, ROUTES)!;
  assert.deepEqual(s.map((x) => x.kicker), ["Hoy", "Esta semana"]);
  assert.match(s[0].reset, /^Se renueva en 8 h 30 min$/);
  assert.match(s[1].reset, /^Se renueva en \d d/);
});
test("objectiveSections: sin servicio → null (se usa el panel anterior)", () => { assert.equal(objectiveSections({ ...snap(), service: null }, NOW, ROUTES), null); });
test("returningModel: título fijo, subtítulo con días, ≤ 3 hechos", () => {
  const s = snap({ activity: { lastActivityAt: NOW - 4 * DAY, recent: [] } } as Partial<DailyLoopFacts>);
  const m = returningModel(s)!;
  assert.equal(m.title, "De vuelta en NEXUS");
  assert.equal(m.subtitle, "Tu última actividad fue hace 4 días.");
  assert.ok(m.facts.length <= 3);
});
test("returningModel: jugador activo → nada", () => { assert.equal(returningModel(snap({ activity: { lastActivityAt: NOW - HOUR, recent: [] } } as Partial<DailyLoopFacts>)), null); });
test("afterActivityModel: sin sesión o sin foto → solo «Volver al lobby»", () => {
  assert.deepEqual(afterActivityModel(null, "match"), { progress: [], next: null, draft: null, lobbyHref: "/" });
  assert.equal(afterActivityModel({ ...snap(), signedIn: false }, "pack").next, null);
});
test("afterActivityModel: reclamable primero y como mucho 2 objetivos", () => {
  const m = afterActivityModel(snap(), "match");
  assert.ok(m.progress.length <= 2);
  assert.equal(m.progress[0].claimable, true);
  assert.equal(m.progress[0].line, "Completado · recógelo en Logros");
});
test("afterActivityModel: cobrados nunca reaparecen", () => {
  assert.ok(!afterActivityModel(snap(), "pack").progress.some((p) => p.id === "w-sobres"));
});
test("afterActivityModel: si la siguiente acción es la pantalla actual, no se repite", () => {
  const s = snap();
  assert.equal(afterActivityModel(s, "match", s.primaryAction.href).next, null);
  assert.ok(afterActivityModel(s, "match", "/otra").next);
});
test("afterActivityModel: plural correcto en la línea de progreso", () => {
  const m = afterActivityModel(snap(), "ranked");
  assert.ok(m.progress.some((p) => /^2 partidas más/.test(p.line)) || m.progress.some((p) => /^1 partida más/.test(p.line)));
});

/* ───────── héroe ───────── */

test("héroe: razón «por qué esto» presente en la acción principal", () => { assert.ok(heroModel(snap()).reason); });
test("héroe: plazo solo SOON/VERY_SOON y con fin real", () => {
  const s = snap({ pickems: { pending: 2, open: 2, eventId: "e", eventName: "Masters", nextLockAt: NOW + 40 * 60_000 } });
  const h = heroModel(s, { now: NOW });
  assert.equal(s.primaryAction.id, "predict");
  assert.deepEqual(h.deadline, { label: "Cierra en 40 min", urgency: "VERY_SOON" });
  // Reclamable que se renueva a las 00:00 UTC (8 h 30 min): plazo REAL «pronto».
  assert.deepEqual(heroModel(snap(), { now: NOW }).deadline, { label: "Se renueva en 8 h 30 min", urgency: "SOON" });
  // Sin fin real (jugar): nunca plazo.
  const p = facts().progression!;
  const bare = snap({ progression: { ...p, objectives: [] } });
  assert.equal(heroModel(bare, { now: NOW }).deadline, null);
});
test("héroe: el plazo se recalcula con el reloj estimado del servidor, no con Date.now", () => {
  const p = facts().progression!;
  const s = snap({ progression: { ...p, objectives: [] }, pickems: { pending: 2, open: 2, eventId: "e", eventName: "M", nextLockAt: NOW + 3 * HOUR } });
  assert.equal(s.primaryAction.id, "predict");
  assert.equal(heroModel(s, { now: NOW })!.deadline!.urgency, "SOON");
  assert.equal(heroModel(s, { now: NOW + 2 * HOUR })!.deadline!.urgency, "VERY_SOON");
});

/* ───────── cliente ───────── */

test("refresco del cliente: intervalo entre 30 y 60 s", () => { assert.ok(REFRESH_INTERVAL_MS >= 30_000 && REFRESH_INTERVAL_MS <= 60_000); });
test("nextBoundary: el próximo reset o caducidad real posterior al serverNow", () => {
  const s = snap();
  assert.equal(nextBoundary(s), dw.endsAt);
  const p = snap({ pickems: { pending: 1, open: 1, eventId: "e", eventName: "M", nextLockAt: NOW + HOUR } });
  assert.equal(nextBoundary(p), NOW + HOUR);
  assert.equal(nextBoundary(null), null);
});
test("cliente: refresco al volver a la pestaña y sin hora del cliente en la petición", () => {
  const c = read("src/lib/dailyLoop/client.ts");
  assert.ok(/visibilitychange/.test(c));
  assert.ok(!/daily-loop\?/.test(c));
});

/* ───────── render del vestíbulo ───────── */

test("render: objetivos de hoy y de la semana en bloques separados con reset", () => {
  const h = lobby(snap());
  for (const id of ["daily-today-daily", "daily-today-weekly", "daily-today-daily-reset", "daily-today-weekly-reset"]) assert.ok(h.includes(`data-testid="${id}"`), id);
});
test("render: un reclamable enlaza a Logros (reclamo canónico) y no hay «Reclamar todo»", () => {
  const h = lobby(snap());
  assert.ok(h.includes('data-status="CLAIMABLE"'));
  assert.ok(!/reclamar todo|claim all/i.test(h));
});
test("render: banner de vuelta con título y ≤ 3 hechos", () => {
  const h = lobby(snap({ activity: { lastActivityAt: NOW - 7 * DAY, recent: [] } } as Partial<DailyLoopFacts>));
  assert.ok(h.includes('data-testid="daily-returning"') && h.includes("De vuelta en NEXUS"));
  const count = Number(/data-testid="daily-returning"[\s\S]*?data-count="(\d)"/.exec(h)![1]);
  assert.ok(count >= 1 && count <= 3);
});
test("render: jugador activo sin banner de vuelta", () => {
  assert.ok(!lobby(snap({ activity: { lastActivityAt: NOW - HOUR, recent: [] } } as Partial<DailyLoopFacts>)).includes("daily-returning"));
});
test("render: caducidades con texto (no solo color) y nivel en data-urgency", () => {
  const h = lobby(snap({ pickems: { pending: 1, open: 1, eventId: "e", eventName: "Masters", nextLockAt: NOW + 5 * HOUR } }));
  assert.ok(h.includes('data-testid="daily-expiring"'));
  assert.ok(/data-urgency="SOON"/.test(h));
  assert.ok(h.includes("Cierra en 5 h 00 min"));
});
test("render: héroe con razón y chip de plazo accesible", () => {
  const h = lobby(snap({ pickems: { pending: 1, open: 1, eventId: "e", eventName: "Masters", nextLockAt: NOW + 30 * 60_000 } }));
  assert.ok(h.includes('data-testid="daily-hero-reason"'));
  assert.ok(h.includes('data-testid="daily-hero-deadline"'));
});
test("render: diarias completas → mensaje de juego que sigue, sin «vuelve mañana»", () => {
  const p = facts().progression!;
  const s = snap({ progression: { ...p, objectives: p.objectives.map((o) => (o.kind === "daily" ? { ...o, current: o.goal, complete: true, claimed: true } : o)) } });
  const h = lobby(s);
  assert.ok(h.includes('data-testid="daily-today-daily-done"'));
  assert.ok(!/vuelve mañana/i.test(h));
});
test("render: sin «urgente» ni cuenta atrás con temporada lejana y sin Pick'em", () => {
  const h = lobby(snap());
  assert.ok(!h.includes('data-urgency="VERY_SOON"'));
});
test("render: filas de objetivo ≥ 44 px (min-h-[56px]) y enlaces caducidad ≥ 44 px", () => {
  const h = lobby(snap({ pickems: { pending: 1, open: 1, eventId: "e", eventName: "M", nextLockAt: NOW + HOUR } }));
  assert.ok(h.includes("min-h-[56px]") && h.includes("min-h-[44px]"));
});
test("render: progreso reciente en la temporada si hay hechos", () => {
  const h = lobby(snap({ activity: { lastActivityAt: NOW - HOUR, recent: [{ id: "r1", label: "Victoria en partida rápida (+120 créditos)", at: NOW - HOUR }] } } as Partial<DailyLoopFacts>));
  assert.ok(h.includes('data-testid="daily-recent"') && h.includes("Victoria en partida rápida"));
});

/* ───────── render de «Qué sigue» ───────── */

test("NextUpAfter: sin sesión no pinta nada", () => { assert.equal(renderToStaticMarkup(<NextUpAfter context="match" snap={null} />), ""); });
test("NextUpAfter: progreso, CTA del servidor, razón y «Volver al lobby»", () => {
  const s = snap();
  const h = renderToStaticMarkup(<NextUpAfter context="match" snap={s} />);
  for (const id of ["next-up-after", "next-up-progress", "next-up-cta", "next-up-reason", "next-up-lobby"]) assert.ok(h.includes(`data-testid="${id}"`), id);
  assert.ok(h.includes("Volver al lobby") && h.includes(`href="${s.primaryAction.href}"`));
});
test("NextUpAfter Draft: fase de la run, sin objetivos económicos", () => {
  const h = renderToStaticMarkup(<NextUpAfter context="draft" snap={snap({ draftRun: { id: "r", status: "READY", stage: 2 } })} />);
  assert.ok(h.includes('data-testid="next-up-draft"'));
  assert.ok(!h.includes('data-testid="next-up-progress"'));
});
test("NextUpAfter: lobby siempre enlazado aunque la acción sea la pantalla actual", () => {
  const s = snap();
  const h = renderToStaticMarkup(<NextUpAfter context="pack" snap={s} currentPath={s.primaryAction.href} />);
  assert.ok(!h.includes('data-testid="next-up-cta"') && h.includes('data-testid="next-up-lobby"'));
});

/* ───────── tope PvE atómico ───────── */

test("duelCap: claves por día UTC y por partida", () => {
  assert.equal(utcDayKey(Date.UTC(2026, 9, 7, 23, 59)), "2026-10-07");
  assert.equal(capSlotRef("u", "2026-10-07", 3), "duelcap:u:2026-10-07:3");
  assert.equal(capMatchRef("m1"), "duelcap:m:m1");
});
test("duelCap: 20 cupos secuenciales pagan y el 21 no", async () => {
  const d = new MemSupabase(); d.seedUser("u");
  const r = [];
  for (let i = 0; i < DAILY_DUEL_AWARD_CAP + 1; i++) r.push(await takeDuelPaySlot(d.client, "u", `m${i}`, NOW));
  assert.deepEqual(r.slice(0, DAILY_DUEL_AWARD_CAP).map((x) => x.slot), Array.from({ length: DAILY_DUEL_AWARD_CAP }, (_, i) => i + 1));
  assert.equal(r[DAILY_DUEL_AWARD_CAP].paid, false);
});
test("duelCap: reintentar la liquidación de la misma partida reutiliza su cupo", async () => {
  const d = new MemSupabase(); d.seedUser("u");
  const a = await takeDuelPaySlot(d.client, "u", "m1", NOW);
  const b = await takeDuelPaySlot(d.client, "u", "m1", NOW);
  assert.deepEqual([a.slot, b.slot, b.reused], [1, 1, true]);
  assert.equal(d.table("economy_ops").filter((o) => String(o.ref).startsWith("duelcap:u:")).length, 1);
});
test("duelCap: una partida topada sigue topada al reintentar", async () => {
  const d = new MemSupabase(); d.seedUser("u");
  for (let i = 0; i < DAILY_DUEL_AWARD_CAP; i++) await takeDuelPaySlot(d.client, "u", `m${i}`, NOW);
  await takeDuelPaySlot(d.client, "u", "late", NOW);
  const again = await takeDuelPaySlot(d.client, "u", "late", NOW + DAY);
  assert.deepEqual([again.paid, again.reused], [false, true]);
});
test("duelCap: el día siguiente (UTC) vuelve a tener cupos", async () => {
  const d = new MemSupabase(); d.seedUser("u");
  for (let i = 0; i < DAILY_DUEL_AWARD_CAP; i++) await takeDuelPaySlot(d.client, "u", `m${i}`, NOW);
  assert.equal((await takeDuelPaySlot(d.client, "u", "next", NOW + DAY)).paid, true);
});
test("duelCap: cupos por usuario (otro usuario no consume los tuyos)", async () => {
  const d = new MemSupabase(); d.seedUser("u"); d.seedUser("v");
  for (let i = 0; i < DAILY_DUEL_AWARD_CAP; i++) await takeDuelPaySlot(d.client, "u", `m${i}`, NOW);
  assert.equal((await takeDuelPaySlot(d.client, "v", "vm", NOW)).slot, 1);
});
test("duelCap: arranca después de lo ya pagado hoy en el libro mayor (días previos a la fase)", async () => {
  const d = new MemSupabase(); d.seedUser("u");
  for (let i = 0; i < 18; i++) d.table("credit_transactions").push({ id: `t${i}`, user_id: "u", delta: 60, reason: "duel_win", created_at: new Date(NOW - 60_000).toISOString() });
  const a = await takeDuelPaySlot(d.client, "u", "m1", NOW);
  assert.equal(a.slot, 19);
});
test("duelCap: la liquidación de duelos usa el cupo (no el recuento previo)", () => {
  const s = read("src/server/services/duels.ts");
  assert.ok(s.includes("takeDuelPaySlot(sb, userId, matchId, Date.now())"));
});

/* ───────── QA real (2026-09-16): copy y «Termina pronto» ───────── */

test("«Termina pronto» excluye lo que cierra con holgura (Pick'em a 7 días, caso real)", () => {
  const r = { pickems: "/pickems", claims: "/logros", objective: () => "/duelos", season: "/temporada" };
  assert.deepEqual(expiringItems({ now: NOW, pickem: { eventName: "Valorant Champions 2026", pending: 17, nextLockAt: NOW + 7 * DAY + 10 * HOUR }, today: [], thisWeek: [], seasonEndsAt: NOW + 74 * DAY, routes: r }), []);
  assert.equal(expiringItems({ now: NOW, pickem: { eventName: "M", pending: 1, nextLockAt: NOW + 11 * HOUR }, today: [], thisWeek: [], seasonEndsAt: null, routes: r })[0].urgency, "SOON");
});
test("la razón «por qué esto» nunca repite el detalle de la acción (2.000 combinaciones)", async () => {
  const { randomFacts } = await import("@/domain/liveService/fuzz");
  const { makeRng } = await import("@/sim/rng");
  for (let i = 1; i <= 2000; i++) {
    const s = buildDailyLoop(randomFacts(makeRng(i * 101)));
    for (const a of [s.primaryAction, ...s.secondaryActions]) assert.notEqual(a.reason, a.detail, `${a.id}: ${a.reason}`);
  }
});
test("reclamar sin plazo: la razón no repite «ya te las has ganado» del detalle", () => {
  const p = facts().progression!;
  const s = snap({ progression: { ...p, objectives: [], claimableLevels: 2 } });
  assert.equal(s.primaryAction.id, "claim");
  assert.equal(s.primaryAction.reason, "Ya está ganado: un toque y es tuyo.");
});
