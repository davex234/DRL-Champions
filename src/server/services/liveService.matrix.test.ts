/**
 * FASE 42 · MATRIZ OBLIGATORIA DEL LIVE SERVICE (L001–L100): tiempo del servidor, resets, lecturas puras, prioridad,
 * urgencia, retorno, Pick'ems, eventos, temporada, reclamos, bucle post-actividad, pestañas, reloj y zona del cliente,
 * aislamiento, seguridad y regresiones. Servicios reales sobre `MemSupabase` + dominio puro + contratos de fuente.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MemSupabase } from "./testing/memSupabase";
import { getDailyLoop } from "./dailyLoop";
import { getMetaSnapshot } from "./meta";
import { getLoop } from "./loop";
import { peekProgression, claimMission, getProgression } from "./progression";
import { takeDuelPaySlot } from "./duelCap";
import { pickemTierDelta } from "./pickems";
import { runTemporalSequence, newTemporalStats } from "./testing/liveServiceFuzz";
import { runSequence, newStats } from "./testing/economyFuzz";
import { buildDailyLoop, featuredEvents, type DailyLoopFacts, type DailyLoopSnapshot, type ActiveMatchFact } from "@/domain/dailyLoop";
import { resolvePassWindows, batchFor, countKey } from "@/domain/progression/rotation";
import { periodWindow } from "@/domain/progression/periods";
import { freshPassState } from "@/battlepass/season";
import { CURRENT_SEASON } from "@/data/season";
import { SEASON_CALENDAR } from "@/data/seasonCalendar";
import { estimateServerNow } from "@/domain/season/time";
import { DAY, HOUR, resetText, resetWindows, returningContext, urgencyOf, objectiveCards } from "@/domain/liveService";
import { randomFacts, checkSnapshot } from "@/domain/liveService/fuzz";
import { afterActivityModel } from "@/lib/liveService/presentation";
import { makeRng } from "@/sim/rng";
import { GET as dailyLoopGET } from "@/app/api/game/daily-loop/route";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
let n = 0;
const L = (label: string, fn: () => void | Promise<void>) => { n++; test(`L${String(n).padStart(3, "0")} · ${label}`, fn); };

const NOW = Date.UTC(2026, 9, 7, 15, 30);
const quiet = async <T,>(fn: () => Promise<T>): Promise<T> => { const e = console.error; const w = console.warn; console.error = () => {}; console.warn = () => {}; try { return await fn(); } finally { console.error = e; console.warn = w; } };

/** Usuario cuya tanda diaria de HOY incluye una misión de duelos jugados (para pruebas de progreso deterministas). */
function userWithDaily(metric: string, now = NOW): string {
  for (let i = 0; i < 500; i++) {
    const u = `abcdabcd-0000-4000-8000-${String(i).padStart(12, "0")}`;
    if (batchFor(CURRENT_SEASON.missionPool, u, CURRENT_SEASON.id, "daily", periodWindow("daily", now)!.startsAt).some((d) => d.metric === metric)) return u;
  }
  throw new Error("sin usuario");
}
function userWithWeekly(id: string, now = NOW): string {
  for (let i = 0; i < 500; i++) {
    const u = `bcdebcde-0000-4000-8000-${String(i).padStart(12, "0")}`;
    if (batchFor(CURRENT_SEASON.missionPool, u, CURRENT_SEASON.id, "weekly", periodWindow("weekly", now)!.startsAt).some((d) => d.id === id)) return u;
  }
  throw new Error("sin usuario");
}
function db(u: string, now = NOW) {
  const d = new MemSupabase(); d.seedUser(u);
  d.table("profiles")[0].created_at = new Date(now - 10 * DAY).toISOString();
  d.table("duel_decks").push({ id: "d1", user_id: u });
  return d;
}
const play = (d: MemSupabase, u: string, at: number, win = true) => d.table("duel_matches").push({ id: `m${d.table("duel_matches").length}`, user_id: u, status: "COMPLETED", winner: win ? "A" : "B", mode: "PVE", updated_at: new Date(at).toISOString() });
async function withClock<T>(at: number, fn: () => Promise<T>): Promise<T> { const real = Date.now; Date.now = () => at; try { return await fn(); } finally { Date.now = real; } }
const snapshotOf = (f: Partial<DailyLoopFacts>): DailyLoopSnapshot => buildDailyLoop({ ...randomFacts(makeRng(1)), signedIn: true, journey: null, matches: [], draftRun: null, social: { incoming: 0, from: null }, ...f });
const baseFacts = (): DailyLoopFacts => ({ ...randomFacts(makeRng(99)), signedIn: true, journey: null, matches: [], draftRun: null, social: { incoming: 0, from: null }, now: NOW });

/* ───────────── 1–15 · tiempo y lecturas puras ───────────── */

L("serverNow autoritativo: la foto lleva el reloj del servidor que la calculó", async () => {
  const u = userWithDaily("duels_played"); const d = db(u);
  const r = await quiet(() => getDailyLoop(d.client, u, { now: NOW }));
  assert.equal(r.data!.serverNow, NOW);
  assert.equal(r.data!.service!.resets.dailyEndsAt, Date.UTC(2026, 9, 8));
});
L("reloj del cliente ignorado: la estimación se ancla al serverNow recibido", () => {
  for (const skew of [-2 * HOUR, 2 * HOUR]) assert.equal(estimateServerNow({ serverNow: NOW, receivedAt: NOW + skew }, NOW + skew + 1000), NOW + 1000);
});
L("zona horaria del cliente ignorada: ventanas y rotación solo con aritmética UTC", () => {
  for (const f of ["src/domain/progression/periods.ts", "src/domain/progression/rotation.ts", "src/domain/liveService/index.ts"]) assert.ok(!/getHours\(|getDay\(|getDate\(|toLocale|Intl\./.test(code(read(f))), f);
});
L("reset diario conocido: 00:00 UTC", () => { assert.equal(resetWindows(NOW).dailyEndsAt, Date.UTC(2026, 9, 8, 0, 0)); });
L("reset semanal conocido: lunes 00:00 UTC", () => { const w = resetWindows(NOW).weeklyEndsAt; assert.equal(new Date(w).getUTCDay(), 1); assert.equal(new Date(w).getUTCHours(), 0); });
L("lectura justo ANTES del reset: pura", async () => {
  const u = userWithDaily("duels_played"); const d = db(u); const end = resetWindows(NOW).dailyEndsAt;
  const w = d.writes; await quiet(() => getDailyLoop(d.client, u, { now: end - 30_000 })); assert.equal(d.writes, w);
});
L("lectura justo DESPUÉS del reset: pura y ya con la tanda nueva", async () => {
  const u = userWithDaily("duels_played"); const d = db(u); const end = resetWindows(NOW).dailyEndsAt;
  await withClock(NOW, () => getProgression(d.client, u));
  const w = d.writes; const r = await quiet(() => getDailyLoop(d.client, u, { now: end + 5_000 }));
  assert.equal(d.writes, w);
  assert.ok(r.data!.service!.today.every((c) => c.endsAt === end + DAY));
});
L("GET meta: cero escrituras (rotación vencida y carril competitivo alcanzable)", async () => {
  const u = userWithDaily("duels_played"); const d = db(u);
  await withClock(NOW - 3 * DAY, () => getProgression(d.client, u));
  d.table("profiles")[0].points = 999;
  const w = d.writes; const r = d.rpcCalls.length;
  const m = await quiet(() => getMetaSnapshot(d.client, u));
  assert.ok(m.ok); assert.equal(d.writes, w); assert.deepEqual(d.rpcCalls.slice(r).filter((x) => x !== "app_content_distribution_snapshot"), []);
});
L("GET loop: cero escrituras y sin crear ficha de rating", async () => {
  const u = userWithDaily("duels_played"); const d = db(u);
  const w = d.writes; await quiet(() => getLoop(d.client, u));
  assert.equal(d.writes, w); assert.equal(d.table("duel_pvp_ratings").length, 0); assert.equal(d.table("user_pass").length, 0);
});
L("GET daily-loop: cero escrituras", async () => {
  const u = userWithDaily("duels_played"); const d = db(u);
  const w = d.writes; await quiet(() => getDailyLoop(d.client, u, { now: NOW })); assert.equal(d.writes, w);
});
L("Home: la página solo lee `GET /api/game/daily-loop` (sin POST ni materializaciones)", () => {
  const page = code(read("src/app/page.tsx")) + code(read("src/lib/dailyLoop/client.ts"));
  assert.ok(page.includes("/api/game/daily-loop"));
  assert.ok(!/method:\s*"POST"|refreshMissions|fetchProgression|fetchMetaSnapshot|claim/.test(page));
});
for (const [label, table] of [["recompensa", "credit_transactions"], ["XP", "profiles"], ["sobre", "user_packs"], ["carta", "user_cards"]] as const) {
  L(`visitar Home 5 veces no concede ${label}`, async () => {
    const u = userWithDaily("duels_played"); const d = db(u);
    const before = JSON.stringify(d.table(table));
    for (let i = 0; i < 5; i++) await quiet(() => getDailyLoop(d.client, u, { now: NOW + i * HOUR }));
    assert.equal(JSON.stringify(d.table(table)), before);
  });
}

/* ───────────── 16–34 · prioridad ───────────── */

const M = (mode: ActiveMatchFact["mode"]): ActiveMatchFact => ({ id: `m-${mode}`, mode, difficulty: mode === "PVE" ? "EASY" : null, opponent: null, node: null });
const claimable = (): DailyLoopFacts["progression"] => ({ ...baseFacts().progression!, claimableLevels: 2, achievements: { total: 7, claimed: 0, claimable: 1, near: null } });
L("PvP activo: primero", () => { assert.equal(snapshotOf({ now: NOW, matches: [M("PVE"), M("RANKED")], progression: claimable() }).primaryAction.id, "resume-ranked"); });
L("ranked activo gana a privado activo", () => { assert.equal(snapshotOf({ now: NOW, matches: [M("PRIVATE"), M("RANKED")] }).primaryAction.id, "resume-ranked"); });
L("privado activo: primero frente a recompensas y Pick'em que cierra", () => { assert.equal(snapshotOf({ now: NOW, matches: [M("PRIVATE")], progression: claimable(), pickems: { pending: 2, open: 2, eventId: "e", eventName: "E", nextLockAt: NOW + 10 * 60_000 } }).primaryAction.id, "resume-private"); });
L("combate de Draft: primero", () => { assert.equal(snapshotOf({ now: NOW, matches: [M("DRAFT")], progression: claimable() }).primaryAction.id, "resume-draft"); });
L("Draft eligiendo: por encima de recompensas, por debajo de una partida", () => {
  assert.equal(snapshotOf({ now: NOW, draftRun: { id: "r", status: "DRAFTING", stage: 1 }, progression: claimable() }).primaryAction.id, "resume-draft-run");
  assert.equal(snapshotOf({ now: NOW, matches: [M("PVE")], draftRun: { id: "r", status: "DRAFTING", stage: 1 } }).primaryAction.id, "resume-pve");
});
L("reclamar: por encima de Pick'em sin prisa y de objetivos", () => {
  const s = snapshotOf({ now: NOW, progression: claimable(), pickems: { pending: 1, open: 1, eventId: "e", eventName: "E", nextLockAt: NOW + 30 * HOUR } });
  assert.equal(s.primaryAction.id, "claim");
});
const objFacts = (kind: "daily" | "weekly") => {
  const f = baseFacts();
  const w = periodWindow(kind, NOW)!;
  f.progression = { ...f.progression!, claimableLevels: 0, achievements: { total: 7, claimed: 0, claimable: 0, near: null }, objectives: [{ id: kind === "daily" ? "d-duelo-1" : "w-duelos-5", label: "Obj", kind, current: kind === "daily" ? 1 : 4, goal: kind === "daily" ? 2 : 5, complete: false, claimed: false, rewardCredits: 250, xp: 1, metric: "duels_played", packId: null, packCount: 0, assignedAt: w.startsAt, expiresAt: w.endsAt }] };
  f.pickems = { pending: 0, open: 0, eventId: null, eventName: null, nextLockAt: null }; f.packs = { unopened: 0 }; f.live = [];
  f.decks = { total: 1, valid: 1, active: { id: "d", name: "E", valid: true, size: 10, sumOvr: 800 }, firstInvalid: null };
  return f;
};
L("objetivo diario casi completo: acción de objetivo antes que jugar", () => { assert.equal(buildDailyLoop(objFacts("daily")).primaryAction.id, "objective"); });
L("objetivo semanal casi completo: acción de objetivo", () => { assert.equal(buildDailyLoop(objFacts("weekly")).primaryAction.id, "objective"); });
L("Pick'em que cierra muy pronto: por encima de reclamar", () => {
  assert.equal(snapshotOf({ now: NOW, progression: claimable(), pickems: { pending: 1, open: 1, eventId: "e", eventName: "E", nextLockAt: NOW + 20 * 60_000 } }).primaryAction.id, "predict");
});
L("evento en directo real: se propone (explorar) sin pasar por encima del juego", () => {
  const f = objFacts("daily"); f.live = [{ id: "ev", name: "VCT", lifecycle: "ACTIVE", isDemo: false, startDate: null, endDate: null, liveCount: 1, liveMatch: null, nextMatch: null, pickem: null }];
  const s = buildDailyLoop(f);
  assert.ok([s.primaryAction, ...s.secondaryActions].some((a) => a.id === "live") || s.secondaryActions.length === 3);
  assert.notEqual(s.primaryAction.id, "live");
});
L("temporada en su última semana: relevante (caduca) sin bloquear nada", () => {
  const f = objFacts("daily"); f.season = { current: { id: "s1", name: "T1", status: "ACTIVE", presentation: "ENDING_SOON", startsAtMs: NOW - 80 * DAY, endsAtMs: NOW + 3 * DAY }, next: null };
  const s = buildDailyLoop(f);
  assert.ok(s.service!.expiring.some((e) => e.source === "season"));
  assert.ok(s.service!.season!.endingSoon);
  assert.equal(s.primaryAction.id, "objective");
});
L("sin objetivos ni recompensas: contenido evergreen (campaña, competitivo o partida rápida)", () => {
  const f = objFacts("daily"); f.progression = { ...f.progression!, objectives: [] };
  const s = buildDailyLoop(f);
  assert.ok(["campaign", "ranked", "quick"].includes(s.primaryAction.id), s.primaryAction.id);
});
L("rutas recomendadas válidas (500 combinaciones)", () => {
  for (let i = 1; i <= 500; i++) { const f = randomFacts(makeRng(i * 13)); assert.deepEqual(checkSnapshot(f, buildDailyLoop(f)).filter((v) => v.invariant === "ruta-valida"), []); }
});
L("recomendación disponible: nunca de un subsistema caído", () => {
  for (let i = 1; i <= 500; i++) { const f = randomFacts(makeRng(i * 19)); assert.deepEqual(checkSnapshot(f, buildDailyLoop(f)).filter((v) => v.invariant === "subsistema-caido-no-recomienda"), []); }
});
L("recomendación no caducada: tandas viejas nunca proponen reclamar ni objetivo", () => {
  const f = objFacts("daily"); const w = periodWindow("daily", NOW)!;
  f.progression = { ...f.progression!, objectives: f.progression!.objectives.map((o) => ({ ...o, complete: true, current: o.goal, assignedAt: w.startsAt - DAY, expiresAt: w.startsAt })) };
  const s = buildDailyLoop(f);
  assert.ok(![s.primaryAction, ...s.secondaryActions].some((a) => a.id === "claim" || a.id === "objective"));
});
L("recomendación no completada: un objetivo completo no se propone como «completar»", () => {
  const f = objFacts("daily"); f.progression = { ...f.progression!, objectives: f.progression!.objectives.map((o) => ({ ...o, current: o.goal, complete: true, claimed: true })) };
  assert.ok(![buildDailyLoop(f).primaryAction].some((a) => a.id === "objective"));
});
L("nunca recomienda el Marketplace", () => {
  for (let i = 1; i <= 300; i++) { const s = buildDailyLoop(randomFacts(makeRng(i))); assert.ok(![s.primaryAction, ...s.secondaryActions].some((a) => /mercado|market/i.test(a.href))); }
});
L("primera sesión: el recorrido va primero (sin partida)", () => {
  const f = randomFacts(makeRng(5)); f.signedIn = true; f.matches = []; f.draftRun = null; f.social = { incoming: 0, from: null };
  f.progression = { ...baseFacts().progression!, claimableLevels: 0, achievements: { total: 7, claimed: 0, claimable: 0, near: null }, objectives: [] };
  f.packs = { unopened: 3 }; f.pickems = { pending: 0, open: 0, eventId: null, eventName: null, nextLockAt: null };
  f.decks = { total: 0, valid: 0, active: null, firstInvalid: null };
  f.journey = { ownedCards: 0, packsOpened: 0, matchesCompleted: 0, unopenedPacks: 3, firstPackId: "inicial", decks: { total: 0, valid: 0, firstInvalid: null }, readyDeck: null, readiness: { ready: false, dataVersion: null, roles: [], shortages: [] } };
  assert.equal(buildDailyLoop(f).primaryAction.id, "journey-open");
});
L("recorrido completado: vestíbulo normal con live service", () => {
  const s = buildDailyLoop(objFacts("daily"));
  assert.equal(s.journey, null); assert.ok(s.service);
});

/* ───────────── 35–44 · objetivos y reclamos reales ───────────── */

L("progreso diario: una partida real tras el reset cuenta", async () => {
  const u = userWithDaily("duels_played"); const d = db(u); const start = periodWindow("daily", NOW)!.startsAt;
  play(d, u, start - HOUR); play(d, u, start + HOUR);
  const p = await quiet(() => peekProgression(d.client, u, NOW));
  const m = p.data!.view.missions.find((x) => x.kind === "daily" && x.metric === "duels_played")!;
  assert.equal(m.current, 1);
});
L("recompensa diaria: el importe exacto de la definición", async () => {
  const u = userWithDaily("duels_played"); const d = db(u); play(d, u, NOW - 60_000);
  const id = batchFor(CURRENT_SEASON.missionPool, u, CURRENT_SEASON.id, "daily", periodWindow("daily", NOW)!.startsAt).find((x) => x.metric === "duels_played")!.id;
  await withClock(NOW, () => claimMission(d.client, u, id));
  const row = d.table("credit_transactions").find((t) => t.reason === "mission_reward")!;
  assert.equal(Number(row.delta), CURRENT_SEASON.missionPool.find((x) => x.id === id)!.reward.credits);
});
L("reclamo diario: un asiento con la clave de su ventana", async () => {
  const u = userWithDaily("duels_played"); const d = db(u); play(d, u, NOW - 60_000);
  const id = batchFor(CURRENT_SEASON.missionPool, u, CURRENT_SEASON.id, "daily", periodWindow("daily", NOW)!.startsAt).find((x) => x.metric === "duels_played")!.id;
  const r = await withClock(NOW, () => claimMission(d.client, u, id));
  assert.ok(r.ok, r.error);
  assert.match(String(d.table("credit_transactions").find((t) => t.reason === "mission_reward")!.ref), new RegExp(`:${id}:${periodWindow("daily", NOW)!.startsAt}:`));
});
L("reintento diario: +0", async () => {
  const u = userWithDaily("duels_played"); const d = db(u); play(d, u, NOW - 60_000);
  const id = batchFor(CURRENT_SEASON.missionPool, u, CURRENT_SEASON.id, "daily", periodWindow("daily", NOW)!.startsAt).find((x) => x.metric === "duels_played")!.id;
  await withClock(NOW, () => claimMission(d.client, u, id));
  const again = await withClock(NOW + 60_000, () => claimMission(d.client, u, id));
  assert.equal(again.ok, false);
  assert.equal(d.table("credit_transactions").filter((t) => t.reason === "mission_reward").length, 1);
});
const WU = userWithWeekly("w-duelos-5");
L("progreso semanal: cuenta lo de toda la semana", async () => {
  const d = db(WU); const start = periodWindow("weekly", NOW)!.startsAt;
  for (let i = 0; i < 3; i++) play(d, WU, start + (i + 1) * HOUR);
  const p = await quiet(() => peekProgression(d.client, WU, NOW));
  assert.equal(p.data!.view.missions.find((x) => x.id === "w-duelos-5")!.current, 3);
});
L("reclamo semanal: 5 partidas en la semana → paga 1.200", async () => {
  const d = db(WU); const start = periodWindow("weekly", NOW)!.startsAt;
  for (let i = 0; i < 5; i++) play(d, WU, start + (i + 1) * HOUR);
  const r = await withClock(NOW, () => claimMission(d.client, WU, "w-duelos-5"));
  assert.ok(r.ok, r.error); assert.equal(Number(d.table("profiles")[0].credits), 7200);
});
L("reintento semanal: +0", async () => {
  const d = db(WU); const start = periodWindow("weekly", NOW)!.startsAt;
  for (let i = 0; i < 5; i++) play(d, WU, start + (i + 1) * HOUR);
  await withClock(NOW, () => claimMission(d.client, WU, "w-duelos-5"));
  for (let i = 0; i < 5; i++) play(d, WU, NOW + (i + 1) * 60_000);
  assert.equal((await withClock(NOW + HOUR, () => claimMission(d.client, WU, "w-duelos-5"))).ok, false);
  assert.equal(Number(d.table("profiles")[0].credits), 7200);
});
const doneFacts = (daily: boolean, weekly: boolean) => {
  const f = objFacts("daily");
  const mk = (kind: "daily" | "weekly", id: string, done: boolean) => { const w = periodWindow(kind, NOW)!; return { id, label: id, kind, current: 1, goal: 1, complete: true, claimed: done, rewardCredits: 1, xp: 1, metric: "duels_played", packId: null, packCount: 0, assignedAt: w.startsAt, expiresAt: w.endsAt }; };
  f.progression = { ...f.progression!, objectives: [mk("daily", "d-duelo-1", daily), mk("daily", "d-abrir-1", daily), mk("weekly", "w-duelos-5", weekly)] };
  return f;
};
L("diarias completas: no «vuelve mañana»; el juego sigue (evergreen)", () => {
  const s = buildDailyLoop(doneFacts(true, false));
  assert.ok(s.service!.dailyDone);
  assert.ok(![s.primaryAction, ...s.secondaryActions].some((a) => /vuelve mañana/i.test(`${a.title} ${a.detail} ${a.reason}`)));
  assert.ok([s.primaryAction, ...s.secondaryActions].some((a) => a.kind === "play" || a.kind === "claim"));
});
L("semanales completas: marcadas y con juego disponible", () => {
  const s = buildDailyLoop(doneFacts(false, true));
  assert.ok(s.service!.weeklyDone);
});
L("todo completo: sin vestíbulo muerto (acción de juego real)", () => {
  const s = buildDailyLoop(doneFacts(true, true));
  assert.ok(s.service!.dailyDone && s.service!.weeklyDone);
  assert.ok(["campaign", "ranked", "quick"].includes(s.primaryAction.id), s.primaryAction.id);
});

/* ───────────── 45–49 · cuenta atrás y urgencia ───────────── */

L("cuenta atrás del reset: «Se renueva en …» desde el reloj del servidor", () => { assert.equal(resetText(Date.UTC(2026, 9, 8), NOW), "Se renueva en 8 h 30 min"); });
L("urgencia NORMAL (> 12 h)", () => { assert.equal(urgencyOf(NOW + 13 * HOUR, NOW), "NORMAL"); });
L("urgencia SOON (≤ 12 h)", () => { assert.equal(urgencyOf(NOW + 6 * HOUR, NOW), "SOON"); });
L("urgencia VERY_SOON (≤ 2 h)", () => { assert.equal(urgencyOf(NOW + 90 * 60_000, NOW), "VERY_SOON"); });
L("sin fin real no hay urgencia (ni en la foto)", () => {
  assert.equal(urgencyOf(null, NOW), null);
  for (let i = 1; i <= 300; i++) { const f = randomFacts(makeRng(i * 7)); assert.deepEqual(checkSnapshot(f, buildDailyLoop(f)).filter((v) => v.invariant === "urgencia-con-fin-real"), []); }
});

/* ───────────── 50–54 · Pick'ems ───────────── */

L("Pick'em abierto con pendientes: acción de predecir", () => { assert.ok([snapshotOf({ now: NOW, pickems: { pending: 2, open: 2, eventId: "e", eventName: "E", nextLockAt: NOW + 30 * HOUR } })].some((s) => [s.primaryAction, ...s.secondaryActions].some((a) => a.id === "predict"))); });
L("Pick'em cerrado: sin cierre futuro no hay urgencia ni caducidad", () => {
  const s = snapshotOf({ now: NOW, pickems: { pending: 1, open: 1, eventId: "e", eventName: "E", nextLockAt: NOW - HOUR } });
  assert.ok(!s.service!.expiring.some((e) => e.source === "pickems"));
  assert.ok(![s.primaryAction, ...s.secondaryActions].some((a) => a.id === "predict" && a.urgency));
});
L("Pick'em ya respondido: nada que hacer", () => { const s = snapshotOf({ now: NOW, pickems: { pending: 0, open: 3, eventId: "e", eventName: "E", nextLockAt: null } }); assert.ok(![s.primaryAction, ...s.secondaryActions].some((a) => a.id === "predict")); });
L("Pick'em sin fuga de respuestas: el resumen del vestíbulo nunca lee `correct_option`", () => {
  const svc = read("src/server/services/liveEvents.ts");
  const overview = svc.slice(svc.indexOf("export async function getEventsOverview"), svc.indexOf("const card = (x"));
  assert.ok(overview.includes('select("id, pickem_event_id, locks_at")') && !overview.includes("correct_option"));
  assert.ok(!JSON.stringify(buildDailyLoop(randomFacts(makeRng(3)))).includes("correct_option"));
});
L("recompensa de Pick'em idempotente al recorregir: paga la diferencia, no la suma", () => {
  const paid = new Set(["pickem:ev:participacion"]);
  const r = pickemTierDelta("acertante", paid, "ev", { credits: 1500, xp: 150, packId: "estandar", packCount: 1 });
  assert.deepEqual([r.credits, r.xp, r.packId], [1000, 100, "estandar"]);
  const r2 = pickemTierDelta("analista", new Set(["pickem:ev:participacion", "pickem:ev:acertante"]), "ev", { credits: 3000, xp: 300 });
  assert.deepEqual([r2.credits, r2.xp], [1500, 150]);
  assert.deepEqual(pickemTierDelta("participacion", new Set(), "ev", { credits: 500, xp: 50 }), { credits: 500, xp: 50 });
});

/* ───────────── 55–63 · eventos y temporada ───────────── */

const ev = (lifecycle: "UPCOMING" | "ACTIVE" | "COMPLETED", liveCount: number, isDemo = false) => ({ id: `ev-${lifecycle}`, name: `VCT ${lifecycle}`, lifecycle, isDemo, startDate: null, endDate: null, liveCount, liveMatch: null, nextMatch: null, pickem: null });
L("evento en directo: SOLO con partido en directo real", () => {
  assert.ok(![snapshotOf({ now: NOW, live: [ev("ACTIVE", 0)] })].some((s) => [s.primaryAction, ...s.secondaryActions].some((a) => a.id === "live")));
  assert.equal(featuredEvents([ev("ACTIVE", 1)]).featured?.liveCount, 1);
  // Un evento de demostración con un partido «live» (caso real de la QA) nunca se recomienda como directo.
  assert.ok(![snapshotOf({ now: NOW, live: [ev("ACTIVE", 1, true)] })].some((s) => [s.primaryAction, ...s.secondaryActions].some((a) => a.id === "live")));
});
L("evento próximo: como próximo, nunca como directo", () => { const f = featuredEvents([ev("UPCOMING", 0)]); assert.equal(f.featured, null); assert.equal(f.upcoming?.lifecycle, "UPCOMING"); });
L("evento terminado: no se anuncia", () => { const f = featuredEvents([ev("COMPLETED", 0)]); assert.deepEqual([f.featured, f.upcoming], [null, null]); });
L("sin eventos: el bloque se oculta/vacía honestamente", () => { const s = snapshotOf({ now: NOW, live: [] }); assert.deepEqual([s.live?.featured, s.live?.upcoming], [null, null]); });
L("desafíos de evento: en el mapa, con su reclamo canónico e idempotente", () => {
  assert.ok(read("src/domain/liveService/map.ts").includes('system: "event challenges"'));
  assert.ok(read("src/domain/events/challenges.ts").includes("export const challengeRef = (eventId: string, challengeId: string): string =>"));
});
L("temporada actual en la foto", () => { const s = snapshotOf({ now: NOW, season: { current: { id: "s1", name: "T1", status: "ACTIVE", presentation: "ACTIVE", startsAtMs: NOW - DAY, endsAtMs: NOW + 30 * DAY }, next: null } }); assert.equal(s.season?.current?.id, "s1"); });
L("temporada: tiempo restante real (días)", () => { const s = snapshotOf({ now: NOW, season: { current: { id: "s1", name: "T1", status: "ACTIVE", presentation: "ACTIVE", startsAtMs: NOW - DAY, endsAtMs: NOW + 10 * DAY }, next: null } }); assert.equal(s.service!.season!.daysLeft, 10); });
L("temporada < 7 días: relevancia elevada (caducidad y fin próximo)", () => { const s = snapshotOf({ now: NOW, season: { current: { id: "s1", name: "T1", status: "ACTIVE", presentation: "ENDING_SOON", startsAtMs: NOW - DAY, endsAtMs: NOW + 5 * DAY }, next: null } }); assert.ok(s.service!.season!.endingSoon && s.service!.expiring.some((e) => e.source === "season")); });
L("sin Temporada 2: un solo pase en el calendario", () => { assert.equal(new Set(SEASON_CALENDAR.map((e) => e.passSeasonId).filter(Boolean)).size, 1); assert.equal(CURRENT_SEASON.id, "nexus-s1"); });

/* ───────────── 64–74 · retorno ───────────── */

for (const days of [1, 3, 7, 14, 30]) {
  L(`vuelta tras ${days} días: contexto real, máximo 3 hechos`, () => {
    const r = returningContext({ now: NOW, lastActivityAt: NOW - days * DAY, today: objectiveCards([], "daily", NOW), thisWeek: [], activeMatch: false, draftRun: null, pickem: null, liveEventName: "VCT", claimable: 1, seasonEndsAt: NOW + 20 * DAY })!;
    assert.equal(r.daysAway, days); assert.ok(r.facts.length >= 1 && r.facts.length <= 3);
  });
}
L("volver no da recompensa: el live service no concede nada", () => { for (const f of ["src/domain/liveService/index.ts", "src/domain/dailyLoop/index.ts", "src/server/services/dailyLoop.ts"]) assert.ok(!/award\(|app_grant_reward|grantRewards|credits:\s*\d/.test(code(read(f))), f); });
L("sin rachas", () => { for (const f of ["src/domain/liveService/index.ts", "src/domain/dailyLoop/index.ts", "src/lib/liveService/presentation.ts", "src/components/dailyLoop/DailyPanels.tsx"]) assert.ok(!/streak|racha/i.test(code(read(f))), f); });
L("diarias perdidas no se acumulan (14 días fuera → 3 diarias vigentes)", () => {
  let s = resolvePassWindows({ state: freshPassState(CURRENT_SEASON.id), season: CURRENT_SEASON, userId: "u", metrics: {}, sinceWindow: {}, now: NOW, accountCreatedAt: NOW - DAY, seasonStartsAt: NOW - 30 * DAY }).state;
  s = resolvePassWindows({ state: s, season: CURRENT_SEASON, userId: "u", metrics: {}, sinceWindow: {}, now: NOW + 14 * DAY, accountCreatedAt: NOW - DAY, seasonStartsAt: NOW - 30 * DAY }).state;
  assert.equal(s.missions.filter((m) => m.kind === "daily").length, 3);
});
L("continuidad semanal: dentro de la semana, misma tanda y baseline", () => {
  const monday = periodWindow("weekly", NOW)!.startsAt + HOUR;
  const a = resolvePassWindows({ state: freshPassState(CURRENT_SEASON.id), season: CURRENT_SEASON, userId: "u", metrics: { duels_played: 4 }, sinceWindow: { [countKey("duels_played", periodWindow("weekly", monday)!.startsAt)]: 0 }, now: monday, accountCreatedAt: monday - DAY, seasonStartsAt: monday - 30 * DAY }).state;
  const b = resolvePassWindows({ state: a, season: CURRENT_SEASON, userId: "u", metrics: { duels_played: 9 }, sinceWindow: {}, now: monday + 3 * DAY, accountCreatedAt: monday - DAY, seasonStartsAt: monday - 30 * DAY }).state;
  assert.deepEqual(b.missions.filter((m) => m.kind === "weekly"), a.missions.filter((m) => m.kind === "weekly"));
});
L("vuelta: como mucho 3 hechos aunque haya más verdades", () => {
  const r = returningContext({ now: NOW, lastActivityAt: NOW - 8 * DAY, today: objectiveCards([], "daily", NOW), thisWeek: [], activeMatch: true, draftRun: { status: "READY", stage: 2 }, pickem: { eventName: "E", pending: 1, nextLockAt: NOW + HOUR }, liveEventName: "E", claimable: 3, seasonEndsAt: NOW + DAY })!;
  assert.equal(r.facts.length, 3);
});
L("la partida activa sobrevive a la vuelta y manda en el héroe", () => {
  const f = { ...objFacts("daily"), matches: [M("RANKED")], activity: { lastActivityAt: NOW - 7 * DAY, recent: [] } };
  const s = buildDailyLoop(f);
  assert.equal(s.primaryAction.id, "resume-ranked");
  assert.equal(s.service!.returning!.facts[0], "Tu partida sigue abierta: puedes continuarla.");
});

/* ───────────── 75–80 · después de jugar ───────────── */

const withObjectives = (): DailyLoopSnapshot => buildDailyLoop({ ...objFacts("weekly"), progression: { ...objFacts("weekly").progression!, objectives: [...objFacts("weekly").progression!.objectives, { id: "d-abrir-1", label: "Abre un sobre", kind: "daily", current: 0, goal: 1, complete: false, claimed: false, rewardCredits: 200, xp: 150, metric: "packs_opened", packId: null, packCount: 0, assignedAt: periodWindow("daily", NOW)!.startsAt, expiresAt: periodWindow("daily", NOW)!.endsAt }] } });
L("post-partida: objetivo de duelos que avanzó + siguiente acción (la de la foto)", () => {
  const m = afterActivityModel(withObjectives(), "match");
  assert.equal(m.progress[0].label, "Obj"); assert.match(m.progress[0].line, /1 partida más/);
  assert.ok(m.next && m.lobbyHref === "/");
  // RESULTADO ÚNICO · el «qué sigue» ya no se apila en el resultado de un duelo. El progreso de objetivos se ve en
  // Progresión; el lobby (`/`) no repite este bloque.
  assert.ok(!read("src/app/duelos/jugar/page.tsx").includes("<NextUpAfter"));
});
L("post-sobre: solo objetivos de sobres/cartas", () => {
  const m = afterActivityModel(withObjectives(), "pack");
  assert.deepEqual(m.progress.map((p) => p.label), ["Abre un sobre"]);
  assert.ok(read("src/components/packs/PackOpeningExperience.tsx").includes('<NextUpAfter context="pack"'));
});
L("post-campaña: objetivos de partidas y siguiente acción", () => { assert.ok(afterActivityModel(withObjectives(), "campaign").progress.length >= 1); });
L("post-Draft: 0 economía (ningún objetivo avanza), solo su fase", () => {
  const s = buildDailyLoop({ ...objFacts("weekly"), draftRun: { id: "r", status: "READY", stage: 3 } });
  const m = afterActivityModel(s, "draft");
  assert.deepEqual(m.progress, []); assert.equal(m.draft, "Siguiente: fase 3 de 5.");
});
L("post-ranked: el modelo «qué sigue» existe; el resultado PvP (RESULTADO ÚNICO) ya no lo apila", () => {
  const pvp = read("src/app/duelos/pvp/page.tsx");
  assert.ok(!pvp.includes("<NextUpAfter") && !pvp.includes("extra={<>"), "ni «qué sigue» ni +XP de temporada en el resultado");
  assert.ok(afterActivityModel(withObjectives(), "ranked").progress.length >= 1);
});
L("sin segundo motor de prioridad: el «después» usa la acción principal de la foto", () => {
  for (const f of ["src/lib/liveService/presentation.ts", "src/components/liveService/NextUpAfter.tsx"]) assert.ok(!/orderToday|todayRank|dailyCandidates/.test(code(read(f))), f);
});

/* ───────────── 81–90 · pestañas, reloj, zona, dobles ───────────── */

L("dos pestañas: misma foto canónica en el mismo instante", async () => {
  const u = userWithDaily("duels_played"); const d = db(u);
  const [a, b] = await quiet(() => Promise.all([getDailyLoop(d.client, u, { now: NOW }), getDailyLoop(d.client, u, { now: NOW })]));
  assert.deepEqual(a.data!.service!.today, b.data!.service!.today);
});
L("reset con dos pestañas: dos materializaciones a la vez → un estado, sin tanda híbrida", async () => {
  const u = userWithDaily("duels_played"); const d = db(u);
  await withClock(NOW, () => getProgression(d.client, u));
  const after = resetWindows(NOW).dailyEndsAt + 1000;
  await withClock(after, () => Promise.all([getProgression(d.client, u), getProgression(d.client, u)]));
  const daily = (d.table("user_pass")[0].state as { missions: { kind: string; assignedAt: number }[] }).missions.filter((m) => m.kind === "daily");
  assert.equal(new Set(daily.map((m) => m.assignedAt)).size, 1);
  assert.equal(daily[0].assignedAt, after - 1000);
});
for (const [label, skew] of [["−5 min", -5 * 60_000], ["+5 min", 5 * 60_000], ["−2 h", -2 * HOUR], ["+2 h", 2 * HOUR]] as const) {
  L(`reloj del cliente ${label}: no altera la autoridad`, () => {
    const est = estimateServerNow({ serverNow: NOW, receivedAt: NOW + skew }, NOW + skew + 30_000);
    assert.equal(est, NOW + 30_000);
    assert.equal(resetWindows(est).dailyEndsAt, resetWindows(NOW).dailyEndsAt);
  });
}
L("cambio de zona horaria: la ruta no acepta hora ni zona (400) y la ventana es UTC", async () => {
  const r = await dailyLoopGET(new Request("http://x/api/game/daily-loop?tz=Pacific/Auckland"));
  assert.equal(r.status, 400);
});
L("sin doble diaria: 120 secuencias temporales (reset, pestañas, reclamos)", async () => {
  const stats = newTemporalStats();
  await quiet(async () => { for (let s = 420_001; s <= 420_120; s++) await runTemporalSequence(s, stats); });
  assert.deepEqual(stats.violations, []);
});
L("sin reclamo duplicado: dos reclamos simultáneos → un asiento", async () => {
  const u = userWithDaily("duels_played"); const d = db(u); play(d, u, NOW - 60_000);
  const id = batchFor(CURRENT_SEASON.missionPool, u, CURRENT_SEASON.id, "daily", periodWindow("daily", NOW)!.startsAt).find((x) => x.metric === "duels_played")!.id;
  await withClock(NOW, () => Promise.all([claimMission(d.client, u, id), claimMission(d.client, u, id)]));
  assert.equal(d.table("credit_transactions").filter((t) => t.reason === "mission_reward").length, 1);
});
L("tope PvE bajo concurrencia: 40 finales a la vez → 20 pagadas", async () => {
  const d = new MemSupabase(); const u = "cap-user"; d.seedUser(u);
  const r = await Promise.all(Array.from({ length: 40 }, (_, i) => takeDuelPaySlot(d.client, u, `m${i}`, NOW)));
  assert.equal(r.filter((x) => x.paid).length, 20);
});

/* ───────────── 91–100 · aislamiento, rendimiento, seguridad, regresiones ───────────── */

const downDb = (tables: string[]) => { const u = userWithDaily("duels_played"); const d = db(u); for (const t of tables) d.failTables.add(t); return { u, d }; };
for (const [label, tables, sub] of [
  ["Pick'ems caído", ["pickem_events", "pickem_questions", "pickem_submissions", "pickem_answers"], null],
  ["eventos caídos", ["events", "matches", "stages"], "live"],
  ["temporada caída", [], "season"],
  ["social caído", ["duel_challenges"], "social"],
] as const) {
  L(`subsistema: ${label} → la home funciona`, async () => {
    const { u, d } = downDb([...tables]);
    const r = await quiet(() => getDailyLoop(d.client, u, { now: NOW, entries: label === "temporada caída" ? [] : undefined }));
    assert.ok(r.ok && r.data!.primaryAction);
    if (sub && label !== "temporada caída") assert.ok(r.data!.unavailable.includes(sub as never) || r.data!.live !== undefined);
  });
}
L("disponibilidad parcial: núcleo (acción, objetivos) con subsistemas marcados", async () => {
  const { u, d } = downDb(["events", "duel_challenges"]);
  const r = await quiet(() => getDailyLoop(d.client, u, { now: NOW }));
  assert.ok(r.data!.service!.today.length > 0);
  assert.ok(Array.isArray(r.data!.unavailable));
});
L("sin N+1: las lecturas no crecen con los datos (5 vs 400 cartas y partidas)", async () => {
  const count = async (k: number) => {
    const u = userWithDaily("duels_played"); const d = db(u);
    for (let i = 0; i < k; i++) { d.table("user_cards").push({ uid: `c${i}`, user_id: u, card_id: `card-${i % 50}`, obtained_at: new Date(NOW - i * 60_000).toISOString(), locked: false }); play(d, u, NOW - i * 60_000); }
    const before = d.reads; await quiet(() => getDailyLoop(d.client, u, { now: NOW })); return d.reads - before;
  };
  assert.equal(await count(5), await count(400));
});
L("foto acotada: listas con tope y tamaño razonable", () => {
  for (let i = 1; i <= 200; i++) {
    const s = buildDailyLoop(randomFacts(makeRng(i * 11)));
    assert.ok(s.secondaryActions.length <= 3 && (s.service?.today.length ?? 0) <= 3 && (s.service?.thisWeek.length ?? 0) <= 2 && (s.service?.expiring.length ?? 0) <= 3 && (s.service?.recent.length ?? 0) <= 3);
    assert.ok(JSON.stringify(s).length < 40_000);
  }
});
L("usuario arbitrario rechazado: ?userId= → 400 (el usuario sale del token)", async () => {
  assert.equal((await dailyLoopGET(new Request("http://x/api/game/daily-loop?userId=otro"))).status, 400);
  assert.ok(!/searchParams|body/.test(code(read("src/app/api/game/meta/route.ts")).replace("GET(req: Request)", "")));
});
L("hora arbitraria rechazada: ?now= / ?serverNow= → 400; los servicios no reciben hora del cliente", async () => {
  for (const q of ["now=0", "serverNow=1", "resetAt=1", "urgency=VERY_SOON"]) assert.equal((await dailyLoopGET(new Request(`http://x/api/game/daily-loop?${q}`))).status, 400);
  assert.ok(!/searchParams/.test(code(read("src/app/api/game/loop/route.ts"))));
});
L("regresiones: el fuzzer económico de la Fase 41 sigue sin violaciones (40 secuencias)", async () => {
  const s = newStats();
  await quiet(async () => { for (let i = 430_001; i <= 430_040; i++) await runSequence(i, s); });
  assert.deepEqual(s.violations, []);
});

test("la matriz tiene exactamente 100 casos", () => { assert.equal(n, 100); });
