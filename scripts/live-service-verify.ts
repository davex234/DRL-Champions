/**
 * FASE 42 · VERIFICADOR DEL LIVE SERVICE — `npm run live-service:verify` (todo) o por sección:
 *
 *   live-service-time:verify         reloj del servidor, resets UTC diario/semanal, sesgo de reloj, zona horaria, resets
 *                                    con la home abierta y dos pestañas (rotación pura + materialización única)
 *   live-service-priority:verify     recuperación crítica primero, Draft eligiendo bajo partida, urgencia solo con fin
 *                                    real, fuzzer 100k presente y a 0, detección de mutaciones
 *   live-service-security:verify     GET meta/loop/daily-loop sin escrituras, ruta sin parámetros, sin hora ni usuario del
 *                                    cliente, Pick'em sin fuga ni reimpresión, tope PvE atómico, sin «Reclamar todo»,
 *                                    sin login reward / racha / moneda nueva, sin Marketplace
 *   live-service-returning:verify    vuelta 1/3/7/14/30 d sin recompensa, ≤ 3 hechos, sin diarias acumuladas, simulación
 *   live-service-performance:verify  lecturas constantes (sin N+1), foto acotada, refresco 30–60 s, visibilidad
 *
 * Sin BD real (la QA real contra el VPS es `_fase42-real-qa`).
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { MemSupabase } from "../src/server/services/testing/memSupabase";
import { getDailyLoop } from "../src/server/services/dailyLoop";
import { getMetaSnapshot } from "../src/server/services/meta";
import { getLoop } from "../src/server/services/loop";
import { claimMission, getProgression, peekProgression } from "../src/server/services/progression";
import { takeDuelPaySlot } from "../src/server/services/duelCap";
import { pickemTierDelta } from "../src/server/services/pickems";
import { runTemporalSequence, newTemporalStats } from "../src/server/services/testing/liveServiceFuzz";
import { buildDailyLoop } from "../src/domain/dailyLoop";
import { batchFor } from "../src/domain/progression/rotation";
import { periodWindow } from "../src/domain/progression/periods";
import { CURRENT_SEASON } from "../src/data/season";
import { estimateServerNow } from "../src/domain/season/time";
import { DAY, HOUR, resetWindows, returningContext, urgencyOf, objectiveCards } from "../src/domain/liveService";
import { randomFacts, checkSnapshot, returnState, RETURN_HORIZONS } from "../src/domain/liveService/fuzz";
import { LIVE_SERVICE_MAP } from "../src/domain/liveService/map";
import { REFRESH_INTERVAL_MS } from "../src/lib/dailyLoop/client";
import { makeRng } from "../src/sim/rng";
import { GLOBAL_MARKET_ENABLED } from "../src/config/features";

const section = process.argv[2] ?? "all";
const want = (s: string) => section === "all" || section === s;
let ok = 0; let ko = 0;
const check = (label: string, cond: boolean, detail = "") => { if (cond) ok++; else ko++; console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`); };
const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const json = (rel: string) => (existsSync(join(ROOT, rel)) ? JSON.parse(read(rel)) : null);
const quiet = async <T,>(fn: () => Promise<T>) => { const e = console.error; const w = console.warn; console.error = () => {}; console.warn = () => {}; try { return await fn(); } finally { console.error = e; console.warn = w; } };
async function withClock<T>(at: number, fn: () => Promise<T>): Promise<T> { const real = Date.now; Date.now = () => at; try { return await fn(); } finally { Date.now = real; } }

const NOW = Date.UTC(2026, 9, 7, 15, 30);
function userWith(metric: string): string {
  for (let i = 0; i < 500; i++) {
    const u = `f42f42f4-0000-4000-8000-${String(i).padStart(12, "0")}`;
    if (batchFor(CURRENT_SEASON.missionPool, u, CURRENT_SEASON.id, "daily", periodWindow("daily", NOW)!.startsAt).some((d) => d.metric === metric)) return u;
  }
  throw new Error("sin usuario");
}
function db(u: string) {
  const d = new MemSupabase(); d.seedUser(u);
  d.table("profiles")[0].created_at = new Date(NOW - 10 * DAY).toISOString();
  return d;
}
const play = (d: MemSupabase, u: string, at: number) => d.table("duel_matches").push({ id: `m${d.table("duel_matches").length}`, user_id: u, status: "COMPLETED", winner: "A", mode: "PVE", updated_at: new Date(at).toISOString() });

async function main() {
  console.log(`FASE 42 · live service · sección ${section}`);
  const U = userWith("duels_played");

  if (want("time")) {
    console.log("\n· TIEMPO Y RESETS");
    const r = await quiet(() => getDailyLoop(db(U).client, U, { now: NOW }));
    check("la foto lleva serverNow del servidor", r.data?.serverNow === NOW);
    const w = resetWindows(NOW);
    check("reset diario 00:00 UTC", w.dailyEndsAt === Date.UTC(2026, 9, 8));
    check("reset semanal lunes 00:00 UTC", new Date(w.weeklyEndsAt).getUTCDay() === 1 && new Date(w.weeklyEndsAt).getUTCHours() === 0);
    check("sin API de zona local en ventanas/rotación/live service", ["src/domain/progression/periods.ts", "src/domain/progression/rotation.ts", "src/domain/liveService/index.ts"].every((f) => !/getHours\(|getDay\(|getDate\(|toLocale|Intl\./.test(code(read(f)))));
    check("sesgo de reloj −5 min/+5 min/−2 h/+2 h: la estimación sigue anclada al servidor", [-5 * 60_000, 5 * 60_000, -2 * HOUR, 2 * HOUR].every((s) => estimateServerNow({ serverNow: NOW, receivedAt: NOW + s }, NOW + s + 1000) === NOW + 1000));
    const d = db(U);
    await withClock(NOW, () => getProgression(d.client, U));
    const writes = d.writes;
    await quiet(() => getDailyLoop(d.client, U, { now: w.dailyEndsAt + 1000 }));
    check("reset con la home abierta: leer tras el reset no escribe", d.writes === writes);
    await withClock(w.dailyEndsAt + 1000, () => Promise.all([getProgression(d.client, U), getProgression(d.client, U)]));
    const daily = (d.table("user_pass")[0].state as { missions: { kind: string; assignedAt: number }[] }).missions.filter((m) => m.kind === "daily");
    check("reset con dos pestañas: una tanda (sin híbrido)", daily.length === 3 && new Set(daily.map((m) => m.assignedAt)).size === 1);
    const stats = newTemporalStats();
    await quiet(async () => { for (let s = 900_001; s <= 900_060; s++) await runTemporalSequence(s, stats); });
    check("60 secuencias temporales en vivo sin violaciones", stats.violations.length === 0, `${stats.resetsCrossed} resets · ${stats.claimsPaid} cobros`);
    const tf = json("docs/product/qa/fase42/temporal-fuzz.json");
    check("temporal-fuzz.json: ≥ 100.000 secuencias y 0 violaciones", !!tf && tf.sequences >= 100_000 && tf.violations === 0, tf ? `${tf.sequences} secuencias · ${tf.actions} acciones` : "falta");
  }

  if (want("priority")) {
    console.log("\n· PRIORIDAD");
    const base = { ...randomFacts(makeRng(3)), signedIn: true, journey: null, draftRun: null, social: { incoming: 0, from: null }, now: NOW };
    const claimFacts = { ...base.progression!, claimableLevels: 2 };
    const m = (mode: "RANKED" | "PRIVATE" | "DRAFT" | "PVE") => ({ id: mode, mode, difficulty: null, opponent: null, node: null });
    check("ranked activo primero", buildDailyLoop({ ...base, progression: claimFacts, matches: [m("PVE"), m("RANKED")] }).primaryAction.id === "resume-ranked");
    check("privado activo primero", buildDailyLoop({ ...base, progression: claimFacts, matches: [m("PRIVATE")] }).primaryAction.id === "resume-private");
    check("combate de Draft primero", buildDailyLoop({ ...base, progression: claimFacts, matches: [m("DRAFT")] }).primaryAction.id === "resume-draft");
    check("Draft eligiendo: bajo una partida activa", buildDailyLoop({ ...base, matches: [m("PVE")], draftRun: { id: "r", status: "DRAFTING", stage: 1 } }).primaryAction.id === "resume-pve");
    check("urgencia solo con fin real", urgencyOf(null, NOW) === null && urgencyOf(NOW - 1, NOW) === null && urgencyOf(NOW + HOUR, NOW) === "VERY_SOON");
    let bad = 0;
    for (let i = 1; i <= 2000; i++) { const f = randomFacts(makeRng(i * 31)); bad += checkSnapshot(f, buildDailyLoop(f)).length; }
    check("2.000 combinaciones en vivo sin violaciones", bad === 0);
    const pf = json("docs/product/qa/fase42/priority-fuzz.json");
    check("priority-fuzz.json: ≥ 100.000 combinaciones y 0 violaciones", !!pf && pf.combinations >= 100_000 && pf.violations === 0 && !pf.mutate, pf ? `${pf.combinations}` : "falta");
    for (const mut of ["active-match-lost", "fake-urgency"]) {
      const mf = json(`docs/product/qa/fase42/priority-fuzz-mutation-${mut}.json`);
      check(`el fuzzer DETECTA la mutación «${mut}»`, !!mf && mf.violations > 0, mf ? `${mf.violations} violaciones` : "falta");
    }
    check("un solo motor de prioridad (orderToday) — sin copias", ["src/lib/liveService/presentation.ts", "src/components/liveService/NextUpAfter.tsx", "src/domain/liveService/index.ts"].every((f) => !/orderToday|todayRank|RANK\s*[:=]/.test(code(read(f)))));
  }

  if (want("security")) {
    console.log("\n· SEGURIDAD");
    const d = db(U);
    await withClock(NOW - 3 * DAY, () => getProgression(d.client, U));
    const w0 = d.writes;
    await quiet(() => getMetaSnapshot(d.client, U));
    await quiet(() => getLoop(d.client, U));
    for (let i = 0; i < 5; i++) await quiet(() => getDailyLoop(d.client, U, { now: NOW + i * HOUR }));
    check("GET meta + loop + 5× daily-loop con rotación vencida: 0 escrituras", d.writes === w0, `${d.writes - w0}`);
    const route = code(read("src/app/api/game/daily-loop/route.ts"));
    check("daily-loop: cualquier parámetro → 400 (sin usuario ni hora del cliente)", /keys\(\)\]\.length > 0/.test(route) && /400/.test(route));
    check("meta/loop: sin searchParams ni cuerpo", ["src/app/api/game/meta/route.ts", "src/app/api/game/loop/route.ts"].every((f) => !/searchParams|req\.json\(/.test(code(read(f)))));
    check("Pick'em recorregido paga solo la diferencia", (() => { const r = pickemTierDelta("acertante", new Set(["pickem:e:participacion"]), "e", { credits: 1500, xp: 150 }); return r.credits === 1000 && r.xp === 100; })());
    const le = read("src/server/services/liveEvents.ts");
    check("resumen de Pick'em del vestíbulo sin correct_option", !le.slice(le.indexOf("export async function getEventsOverview"), le.indexOf("const card = (x")).includes("correct_option"));
    const cap = new MemSupabase(); cap.seedUser("cap");
    const paid = (await Promise.all(Array.from({ length: 40 }, (_, i) => takeDuelPaySlot(cap.client, "cap", `m${i}`, NOW)))).filter((x) => x.paid).length;
    check("tope PvE: 40 liquidaciones simultáneas → 20 pagadas", paid === 20, `${paid}`);
    const dc = db(U); play(dc, U, NOW - 60_000);
    const id = batchFor(CURRENT_SEASON.missionPool, U, CURRENT_SEASON.id, "daily", periodWindow("daily", NOW)!.startsAt).find((x) => x.metric === "duels_played")!.id;
    await withClock(NOW, () => Promise.all([claimMission(dc.client, U, id), claimMission(dc.client, U, id), claimMission(dc.client, U, id)]));
    check("misión diaria: 3 reclamos simultáneos → 1 asiento", dc.table("credit_transactions").filter((t) => t.reason === "mission_reward").length === 1);
    const UI = ["src/components/dailyLoop/DailyLobby.tsx", "src/components/dailyLoop/DailyPanels.tsx", "src/components/dailyLoop/DailyHero.tsx", "src/components/liveService/NextUpAfter.tsx", "src/lib/liveService/presentation.ts", "src/domain/liveService/index.ts"].map((f) => code(read(f))).join("\n");
    check("sin «Reclamar todo»", !/reclamar todo|claim ?all/i.test(UI));
    check("sin login reward, racha, energía ni moneda nueva", !/streak|racha|login ?reward|energ[íi]a|stamina|gems?\b|premium/i.test(UI));
    check("sin notificaciones push ni email", !/Notification\.requestPermission|pushManager|sendEmail/.test(UI));
    check("Marketplace cerrado", GLOBAL_MARKET_ENABLED === false);
    check("sin migración nueva en la Fase 42 (última 0053)", !readdirSync(join(ROOT, "supabase/migrations")).some((f) => /^005[4-9]|^00[6-9]\d/.test(f)));
    check("mapa del live service: autoridad servidor en los 15 sistemas", LIVE_SERVICE_MAP.length === 15 && LIVE_SERVICE_MAP.every((s) => /server|servidor|worker|db|bd/i.test(String(s.authority))));
  }

  if (want("returning")) {
    console.log("\n· VUELTA");
    for (const days of [1, 3, 7, 14, 30]) {
      const r = returningContext({ now: NOW, lastActivityAt: NOW - days * DAY, today: objectiveCards([], "daily", NOW), thisWeek: [], activeMatch: false, draftRun: null, pickem: null, liveEventName: null, claimable: 0, seasonEndsAt: NOW + 20 * DAY });
      check(`vuelta tras ${days} d: contexto con ≤ 3 hechos`, !!r && r.daysAway === days && r.facts.length >= 1 && r.facts.length <= 3);
    }
    check("< 1 día: sin banner", returningContext({ now: NOW, lastActivityAt: NOW - 12 * HOUR, today: [], thisWeek: [], activeMatch: false, draftRun: null, pickem: null, liveEventName: null, claimable: 0, seasonEndsAt: null }) === null);
    let bad = 0; let factsMax = 0;
    for (let i = 1; i <= 3000; i++) { const s = returnState(makeRng(i * 7919), `v-${i}`, RETURN_HORIZONS[i % RETURN_HORIZONS.length]); bad += s.violations.length; factsMax = Math.max(factsMax, s.snap.service?.returning?.facts.length ?? 0); }
    check("3.000 estados de vuelta en vivo sin violaciones", bad === 0 && factsMax <= 3);
    const rs = json("docs/product/qa/fase42/return-state-simulation.json");
    check("return-state-simulation.json: ≥ 100.000 estados, 7 horizontes, 0 violaciones", !!rs && rs.states >= 100_000 && rs.horizons.length === 7 && rs.violations === 0);
    const d = db(U);
    await withClock(NOW, () => getProgression(d.client, U));
    await withClock(NOW + 14 * DAY, () => getProgression(d.client, U));
    const st = d.table("user_pass")[0].state as { missions: { kind: string }[] };
    check("14 días fuera: 3 diarias (no se acumulan)", st.missions.filter((m) => m.kind === "daily").length === 3);
    const before = d.table("credit_transactions").length;
    await quiet(() => getDailyLoop(d.client, U, { now: NOW + 30 * DAY }));
    check("volver no concede nada (0 asientos)", d.table("credit_transactions").length === before);
    check("vestíbulo sin update/upsert/insert (last_seen_at solo se lee)", !/\.(update|upsert|insert)\(/.test(code(read("src/server/services/dailyLoop.ts"))));
  }

  if (want("performance")) {
    console.log("\n· RENDIMIENTO");
    const reads = async (k: number) => {
      const d = db(U);
      for (let i = 0; i < k; i++) { d.table("user_cards").push({ uid: `c${i}`, user_id: U, card_id: `card-${i % 60}`, obtained_at: new Date(NOW - i * 60_000).toISOString(), locked: false }); play(d, U, NOW - i * 60_000); }
      const b = d.reads; await quiet(() => getDailyLoop(d.client, U, { now: NOW })); return d.reads - b;
    };
    const [a, b] = [await reads(5), await reads(500)];
    check("lecturas constantes con 5 vs 500 filas (sin N+1)", a === b, `${a} vs ${b}`);
    const p = await quiet(() => peekProgression(db(U).client, U, NOW));
    check("peekProgression devuelve vista sin escribir", !!p.data);
    let maxBytes = 0; let bounded = true;
    for (let i = 1; i <= 1000; i++) {
      const s = buildDailyLoop(randomFacts(makeRng(i * 17)));
      maxBytes = Math.max(maxBytes, JSON.stringify(s).length);
      bounded &&= s.secondaryActions.length <= 3 && (s.service?.expiring.length ?? 0) <= 3 && (s.service?.recent.length ?? 0) <= 3 && (s.service?.today.length ?? 0) <= 3 && (s.service?.thisWeek.length ?? 0) <= 2;
    }
    check("foto acotada (listas con tope)", bounded);
    check("foto < 40 KB", maxBytes < 40_000, `${maxBytes} B`);
    check("refresco entre 30 y 60 s", REFRESH_INTERVAL_MS >= 30_000 && REFRESH_INTERVAL_MS <= 60_000, `${REFRESH_INTERVAL_MS} ms`);
    const client = read("src/lib/dailyLoop/client.ts");
    check("refresco al volver a la pestaña y en la frontera del reset", /visibilitychange/.test(client) && /nextBoundary/.test(client));
    const svc = code(read("src/server/services/dailyLoop.ts"));
    check("subsistemas aislados (guard por bloque)", (svc.match(/guard\(/g) ?? []).length >= 6);
  }

  console.log(`\n${ok} ✓ · ${ko} ✗`);
  if (ko > 0) process.exitCode = 1;
}
void main();
