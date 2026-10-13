/**
 * FASE 34 · SERVICIO DE TEMPORADA contra un Supabase EN MEMORIA que registra escrituras.
 * Pase (25–32), objetivos (33–38), competitivo (39–44), eventos/Pick'ems (45–50), colección (51–56),
 * seguridad (65–75) y fin de temporada (76–84). RLS y PostgREST reales: NO EJECUTADO — REQUIERE BD DE PRUEBAS.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { freshPassState } from "@/battlepass";
import { CURRENT_SEASON } from "@/data/season";
import { SEASON_CALENDAR } from "@/data/seasonCalendar";
import type { SeasonCalendarEntry } from "@/domain/season/calendar";
import { FakeSupabase } from "./testing/fakeSupabase";
import { getSeasonHub, getSeasonCalendar, COLLECTION_WINDOW_RELIABLE } from "./season";

const U = "aaaaaaaa-0000-4000-8000-000000000001";
const OTHER = "bbbbbbbb-0000-4000-8000-000000000002";
const D = 86_400_000;
const S1 = SEASON_CALENDAR[0];
const START = Date.parse(S1.startsAt); const END = Date.parse(S1.endsAt);
const ACTIVE_NOW = START + 8 * D + 15.5 * 3600_000;
const iso = (ms: number) => new Date(ms).toISOString();
const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

function seed() {
  const db = new FakeSupabase();
  const state = freshPassState(CURRENT_SEASON.id);
  state.xp = 7_400; state.claimedFree = [1, 2, 3, 4, 5]; state.competitiveUnlocked = false; state.missionsCompleted = 9;
  // Tanda diaria de una ventana ANTERIOR: el hub no debe rotarla.
  state.missions = [
    { id: "d-duelo-1", kind: "daily", metric: "duels_played", goal: 1, baseline: 0, claimed: false, assignedAt: ACTIVE_NOW - 3 * D },
    { id: "w-duelos-5", kind: "weekly", metric: "duels_played", goal: 5, baseline: 0, claimed: false, assignedAt: ACTIVE_NOW - 3600_000 },
    { id: "s-mazo", kind: "seasonal", metric: "decks_saved", goal: 1, baseline: 0, claimed: false, assignedAt: START + D },
  ];
  db.tables = {
    profiles: [{ id: U, xp: 12_345, credits: 6_000, points: 450, packs_opened: 41, region: "EMEA", email: "secret@example.com", is_admin: true, equipped: {} }],
    user_pass: [{ user_id: U, season_id: CURRENT_SEASON.id, state }],
    user_cards: [{ uid: "c1", user_id: U, card_id: "aspas", origin: "pack", obtained_at: iso(START + D) }, { uid: "c2", user_id: U, card_id: "trent", origin: "market", obtained_at: iso(START - 20 * D) }],
    user_achievements: [{ user_id: U, achievement_id: "coleccionista", claimed_at: iso(START + 2 * D) }],
    user_cosmetics: [],
    user_packs: [{ user_id: U, pack_id: "estandar", qty: 2 }],
    duel_matches: [{ id: "m1", user_id: U, mode: "PVE", status: "COMPLETED", winner: "A" }],
    duel_decks: [],
    pickem_answers: [{ id: "pa1", user_id: U, submission_id: "s1", question_id: "q1", option_key: "SECRET_OPTION_X" }],
    duel_pvp_ratings: [{ user_id: U, rating: 1_137, games_played: 6, wins: 4, losses: 2, draws: 0, updated_at: iso(ACTIVE_NOW - D) }, { user_id: OTHER, rating: 1_300, games_played: 20, wins: 12, losses: 8, draws: 0, updated_at: iso(ACTIVE_NOW - D) }],
    duel_pvp_rating_events: [
      { user_id: U, match_id: "p0", created_at: iso(START - 2 * D), result: "WIN", old_rating: 1000, delta: 20, new_rating: 1020 },
      { user_id: U, match_id: "p1", created_at: iso(START + D), result: "WIN", old_rating: 1020, delta: 40, new_rating: 1060 },
      { user_id: U, match_id: "p2", created_at: iso(START + 3 * D), result: "LOSS", old_rating: 1060, delta: -30, new_rating: 1030 },
      { user_id: OTHER, match_id: "p9", created_at: iso(START + 3 * D), result: "WIN", old_rating: 1270, delta: 30, new_rating: 1300 },
    ],
    pickem_scores: [{ user_id: U, pickem_event_id: "pe1", points: 70, correct: 7, total: 10, scored_at: iso(START + 4 * D) }],
    events: [], matches: [], stages: [], pickem_events: [], pickem_questions: [], pickem_submissions: [],
  };
  return db;
}

const hub = async (db: FakeSupabase, userId: string | null, now = ACTIVE_NOW, season?: string) => {
  const r = await getSeasonHub(db.client, userId, { now, season });
  assert.ok(r.ok, r.error); return r.data!;
};
const FORBIDDEN_RPC = /ensure|grant|claim|settle|apply|award|equip|advance|reset|rate/i;
const noSideEffects = (db: FakeSupabase) => {
  assert.deepEqual(db.writes, [], `escrituras: ${db.writes.join(", ")}`);
  assert.deepEqual(db.rpcs.filter((r) => FORBIDDEN_RPC.test(r)), [], `RPC: ${db.rpcs.join(", ")}`);
};

/* ───────────── 25–32 · pase ───────────── */

test("25 · XP de cuenta (profiles.xp) y XP de pase (user_pass) viajan separadas", async () => {
  const s = await hub(seed(), U);
  assert.equal(s.personal!.account.xp, 12_345);
  assert.equal(s.personal!.pass!.xp, 7_400);
  assert.equal(s.personal!.pass!.level, 7);
});

test("26–27 · carriles libre y competitivo: los de CURRENT_SEASON, con su estado", async () => {
  const p = (await hub(seed(), U)).personal!.pass!;
  assert.deepEqual(p.tracks.free.map((l) => l.level), Object.keys(CURRENT_SEASON.free).map(Number));
  assert.deepEqual(p.tracks.competitive.map((l) => [l.level, l.reward]), Object.entries(CURRENT_SEASON.competitive!).map(([k, v]) => [Number(k), v]));
  assert.equal(p.claimable.free, 2, "niveles 6 y 7 alcanzados sin reclamar");
  assert.equal(p.tracks.free.find((l) => l.level === 3)!.claimed, true);
});

test("28 · el carril de aspecto (premium) no se expone ni se redefine en la temporada", async () => {
  assert.ok(!("premium" in (await hub(seed(), U)).personal!.pass!.tracks));
});

test("29–31 · el hub no reclama: los reclamos siguen en progression (claves idempotentes intactas)", () => {
  const svc = read("src/server/services/season.ts").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!/claimPassLevel|claimMission|claimAchievement|grantRewards|awardMany/.test(svc));
  const prog = read("src/server/services/progression.ts");
  assert.ok(prog.includes("`pass:${CURRENT_SEASON.id}:${track}:${level}`") && prog.includes("`mission:${CURRENT_SEASON.id}:${missionId}:${before.assignedAt}:${before.baseline}`"));
});

test("32 · política al terminar: los reclamos pendientes se conservan (no hay corte por fecha)", async () => {
  const prog = read("src/server/services/progression.ts");
  const claim = prog.slice(prog.indexOf("export async function claimPassLevel"), prog.indexOf("export async function claimMission"));
  assert.ok(!/SEASON_CALENDAR|endsAt|resolveCalendar/.test(claim));
  const s = await hub(seed(), U, END + 2 * D, "nexus-s1");
  assert.equal(s.season.status, "ENDED");
  assert.equal(s.personal!.recap.pass!.claimedFree, 5);
});

/* ───────────── 33–38 · objetivos ───────────── */

test("33–35, 37 · objetivos del pase reutilizados; la rotación se RESUELVE al leer (tanda vigente) sin escribir", async () => {
  const db = seed();
  const before = JSON.stringify(db.tables.user_pass);
  const o = (await hub(db, U)).personal!.objectives!;
  // Fase 42 · la tanda diaria vencida se ve ya renovada (3, determinista); la semanal sigue viva; nada se guarda.
  assert.deepEqual([o.daily.total, o.weekly.total, o.seasonal.total], [3, 1, 1]);
  assert.equal(o.rotationPending, true);
  assert.equal(JSON.stringify(db.tables.user_pass), before);
  noSideEffects(db);
});

test("36 · de temporada solo los reales del pool (sin inventar misiones)", async () => {
  const o = (await hub(seed(), U)).personal!.objectives!;
  for (const x of o.list) assert.ok(CURRENT_SEASON.missionPool.some((m) => m.id === x.id), x.id);
});

test("38 · el progreso de objetivos sale de métricas del servidor", async () => {
  const d = (await hub(seed(), U)).personal!.objectives!.list.find((x) => x.id === "w-duelos-5")!;
  assert.deepEqual([d.current, d.complete], [1, false], "1 duelo PvE terminado en duel_matches (semanal viva)");
});

/* ───────────── 39–44 · competitivo ───────────── */

test("39–41 · rating, V/D/E y provisional: los de la ficha persistente, tal cual", async () => {
  const c = (await hub(seed(), U)).personal!.competitive!;
  assert.deepEqual([c.rating, c.wins, c.losses, c.draws, c.gamesPlayed, c.provisional], [1137, 4, 2, 0, 6, true]);
});

test("42–43 · sin reinicio ni rating «de temporada»: la ventana solo cuenta partidas", async () => {
  const db = seed();
  const c = (await hub(db, U)).personal!.competitive!;
  assert.deepEqual([c.inSeason.games, c.inSeason.wins, c.inSeason.losses, c.inSeason.finalRating], [2, 1, 1, 1030]);
  assert.equal(db.tables.duel_pvp_ratings[0].rating, 1137);
  assert.ok(!/seasonRating|season_rating|ratingDeTemporada/.test(read("src/server/services/season.ts")));
});

test("44 · carril competitivo del pase: umbral real, apertura pendiente informada sin persistir", async () => {
  const db = seed();
  const p = (await hub(db, U)).personal!.pass!;
  assert.equal(p.competitiveMinPoints, CURRENT_SEASON.competitiveMinPoints);
  // Fase 42 · la vista es la que corresponde a ahora (carril abierto) y la apertura sigue SIN persistir (pendiente).
  assert.deepEqual([p.competitiveUnlocked, p.competitiveUnlockPending], [true, true]);
  noSideEffects(db);
});

/* ───────────── 45–50 · eventos y Pick'ems ───────────── */

test("45–47 · sin eventos reales no se fabrica ninguno", async () => {
  const s = await hub(seed(), null);
  assert.deepEqual([s.events.live, s.events.upcoming, s.events.inWindow], [[], [], []]);
});

test("48–49 · resumen de Pick'ems seguro: recuentos y puntos, nunca respuestas", async () => {
  const s = await hub(seed(), U);
  assert.deepEqual(s.personal!.pickems!.inSeason, { scored: 1, points: 70, correct: 7 });
  assert.ok(!JSON.stringify(s).includes("SECRET_OPTION_X"));
});

test("50 · un evento no se asigna a la temporada: no hay FK ni campo seasonId en los eventos", () => {
  const svc = read("src/server/services/season.ts");
  assert.ok(svc.includes("no hay FK evento→temporada"));
  assert.ok(!/season_id|seasonId:\s*season/.test(svc.slice(svc.indexOf("export interface SeasonEventLite"), svc.indexOf("export interface SeasonPassView"))));
});

/* ───────────── 51–56 · colección ───────────── */

test("51, 55–56 · colección total separada; «esta temporada» se OMITE porque obtained_at no es fiable", async () => {
  const c = (await hub(seed(), U)).personal!.collection;
  assert.equal(COLLECTION_WINDOW_RELIABLE, false);
  assert.deepEqual([c.distinct, c.owned, c.obtainedInSeason, c.windowReliable], [2, 2, null, false]);
  assert.ok(!/completion|completionScore|seasonCompletion/.test(JSON.stringify(c)));
});

test("52–54 · la ventana (si algún día es fiable) es [inicio, final): dentro sí, antes y después no", async () => {
  const { buildSeasonRecap } = await import("@/domain/season/recap");
  const r = buildSeasonRecap({ season: { id: "s", name: "S", startsAtMs: START, endsAtMs: END, status: "ENDED" }, pass: null, ratingEvents: [], achievementClaims: [START - 1, START, END - 1, END], pickemScores: [], cardsObtainedInWindow: null });
  assert.equal(r.achievementsClaimed, 2);
});

/* ───────────── 65–75 · seguridad ───────────── */

test("65–68 · anónimo: solo lo público (sin pase, reclamos, objetivos ni progreso)", async () => {
  const s = await hub(seed(), null);
  assert.equal(s.personal, null);
  const json = JSON.stringify(s);
  for (const k of ["claimable", "missions", "claimedFree", "xpIntoLevel", "pickems", "12345", "7400"]) assert.ok(!json.includes(k), k);
});

test("69 · el sujeto es el userId que recibe el servicio (del token); datos de otro usuario no se mezclan", async () => {
  const s = await hub(seed(), U);
  assert.equal(s.personal!.competitive!.inSeason.games, 2, "el asiento de OTHER no cuenta");
});

test("70–72 · sin email, sin is_admin, sin créditos en la foto de temporada", async () => {
  const json = JSON.stringify(await hub(seed(), U));
  assert.ok(!json.includes("secret@example.com") && !json.includes("is_admin") && !/"credits":6000/.test(json));
});

test("73 · id de temporada estricto: inválido 400, inexistente 404", async () => {
  const bad = await getSeasonHub(seed().client, U, { now: ACTIVE_NOW, season: "../etc" });
  assert.deepEqual([bad.status, bad.code], [400, "INVALID_SEASON"]);
  const missing = await getSeasonHub(seed().client, U, { now: ACTIVE_NOW, season: "temporada-9" });
  assert.deepEqual([missing.status, missing.code], [404, "SEASON_NOT_FOUND"]);
  assert.equal((await hub(seed(), U, ACTIVE_NOW, "temporada-1")).season.id, "nexus-s1");
});

test("74 · calendario inválido: 500 con código, sin detalles; la ruta lo convierte en 503 genérico", () => {
  const bad: SeasonCalendarEntry[] = [{ ...S1 }, { ...S1, id: "x", slug: "x", number: 2 }];
  const r = getSeasonCalendar(ACTIVE_NOW, bad);
  assert.deepEqual([r.status, r.code, r.error], [500, "INVALID_CALENDAR", "Calendario de temporadas no válido"]);
  const route = read("src/app/api/game/season/route.ts");
  assert.ok(route.includes('if (!r.ok && r.status >= 500) {') && route.includes('"No se pudo leer la temporada"'));
});

test("75 · sin escritura de temporadas desde el cliente: la ruta solo exporta GET", () => {
  const route = read("src/app/api/game/season/route.ts");
  assert.ok(/export async function GET/.test(route) && !/export async function (POST|PUT|PATCH|DELETE)/.test(route));
});

test("lecturas acotadas: sin N+1 (número de lecturas fijo, independiente del volumen)", async () => {
  const small = seed(); await hub(small, U);
  const big = seed();
  for (let i = 0; i < 300; i++) big.tables.duel_pvp_rating_events.push({ user_id: U, match_id: `x${i}`, created_at: iso(START + D + i * 1000), result: "WIN", old_rating: 1000, delta: 1, new_rating: 1001 });
  await hub(big, U);
  assert.equal(big.reads.length, small.reads.length);
  assert.ok(small.reads.length <= 60, `lecturas: ${small.reads.length}`);
});

/* ───────────── 76–84 · fin de temporada ───────────── */

test("76–84 · pasar endsAt no toca nada: ni rating, XP, cartas, créditos, mazos, logros ni pase; ni concede", async () => {
  const db = seed();
  const before = JSON.stringify(db.tables);
  for (const now of [END - 1, END, END + D, END + 60 * D]) {
    const s = await hub(db, U, now, "nexus-s1");
    assert.equal(s.season.status, now < END ? "ACTIVE" : "ENDED");
  }
  await hub(db, null, END + D);
  assert.equal(JSON.stringify(db.tables), before);
  noSideEffects(db);
});

test("resumen al terminar: final, con hechos de la ventana", async () => {
  const r = (await hub(seed(), U, END + D, "nexus-s1")).personal!.recap;
  assert.equal(r.kind, "FINAL");
  assert.deepEqual([r.ranked!.games, r.ranked!.finalRating, r.ranked!.highestRating, r.achievementsClaimed, r.pickems!.points, r.cardsObtained], [2, 1030, 1060, 1, 70, null]);
});
