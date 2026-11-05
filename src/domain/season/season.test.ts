/**
 * FASE 34 · TEMPORADAS — dominio puro: ciclo de vida (1–10), tiempo (11–18), fuente canónica (19–24),
 * resumen (57–64), acciones (89–91) y cuenta atrás accesible (92).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  resolveCalendar, validateCalendar, statusAt, presentationAt, parseInstant, findResolved, SEASON_KEY,
  ENDING_SOON_MS, FINAL_DAY_MS, type SeasonCalendarEntry,
} from "./calendar";
import { countdown, formatCountdown, countdownSentence, estimateServerNow, clockOffset, crossedZero, tickMs, formatSeasonDate, elapsedFraction } from "./time";
import { buildSeasonRecap, rankedRecap, type SeasonRecapFacts } from "./recap";
import { seasonActions, seasonActionCandidates, SEASON_ACTIONS_MAX, type SeasonActionFacts } from "./actions";
import { SEASON_CALENDAR } from "@/data/seasonCalendar";
import { CURRENT_SEASON } from "@/data/season";

const H = 3600_000; const D = 24 * H;
const S = (o: Partial<SeasonCalendarEntry> & { id: string; startsAt: string; endsAt: string }): SeasonCalendarEntry => ({
  slug: o.id, number: Number(o.id.replace(/\D/g, "")) || 1, name: o.id, displayName: o.id, passSeasonId: null, themeKey: "x", ...o,
});
const s1 = S({ id: "s1", number: 1, startsAt: "2026-09-07T00:00:00Z", endsAt: "2026-11-30T00:00:00Z" });
const s2 = S({ id: "s2", number: 2, startsAt: "2026-12-14T00:00:00Z", endsAt: "2027-03-08T00:00:00Z" });
const start = Date.parse(s1.startsAt); const end = Date.parse(s1.endsAt);
const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

/* ───────────── 1–10 · ciclo de vida ───────────── */

test("1 · UPCOMING antes de startsAt", () => { assert.equal(statusAt(start, end, start - 1), "UPCOMING"); });
test("2 · ACTIVE justo en startsAt (inclusivo)", () => { assert.equal(statusAt(start, end, start), "ACTIVE"); });
test("3 · ACTIVE durante la ventana", () => { assert.equal(statusAt(start, end, start + 30 * D), "ACTIVE"); });
test("4 · ENDED justo en endsAt (exclusivo)", () => { assert.equal(statusAt(start, end, end), "ENDED"); assert.equal(statusAt(start, end, end - 1), "ACTIVE"); });

test("5 · ENDING_SOON con <= 7 días exactos; FINAL_DAY con < 24 h (derivación visual)", () => {
  assert.equal(ENDING_SOON_MS, 7 * D); assert.equal(FINAL_DAY_MS, D);
  assert.equal(presentationAt(start, end, end - 7 * D - 1), "ACTIVE");
  assert.equal(presentationAt(start, end, end - 7 * D), "ENDING_SOON");
  assert.equal(presentationAt(start, end, end - D), "ENDING_SOON");
  assert.equal(presentationAt(start, end, end - D + 1), "FINAL_DAY");
  assert.equal(presentationAt(start, end, end - 60_000), "FINAL_DAY");
});

test("6 · hueco entre temporadas: OFF_SEASON sin temporada actual y sin extender la anterior", () => {
  const r = resolveCalendar([s1, s2], end + D);
  assert.ok(r.ok);
  assert.equal(r.phase, "OFF_SEASON");
  assert.equal(r.current, null);
  assert.equal(r.previous?.id, "s1");
  assert.equal(r.previous?.status, "ENDED");
});

test("7 · próxima temporada conocida y desconocida", () => {
  const a = resolveCalendar([s1, s2], start + D); assert.ok(a.ok);
  assert.equal(a.current?.id, "s1"); assert.equal(a.next?.id, "s2");
  const b = resolveCalendar([s1], start + D); assert.ok(b.ok);
  assert.equal(b.next, null, "no se inventa Temporada 2");
  const pre = resolveCalendar([s1], start - D); assert.ok(pre.ok);
  assert.equal(pre.phase, "PRE_SEASON"); assert.equal(pre.next?.id, "s1");
  const none = resolveCalendar([], start); assert.ok(none.ok); assert.equal(none.phase, "NO_SEASONS");
});

test("8 · solapes detectados y NO arreglados en silencio", () => {
  const overlap = S({ id: "s9", number: 9, startsAt: "2026-11-01T00:00:00Z", endsAt: "2026-12-31T00:00:00Z" });
  assert.deepEqual(validateCalendar([s1, overlap]).map((i) => i.code), ["OVERLAP"]);
  const r = resolveCalendar([s1, overlap], start + D);
  assert.equal(r.ok, false);
  // Contiguas (fin de una = inicio de la otra) NO solapan.
  const next = S({ id: "s3", number: 3, startsAt: s1.endsAt, endsAt: "2027-01-01T00:00:00Z" });
  assert.deepEqual(validateCalendar([s1, next]), []);
});

test("9 · rango inválido (startsAt >= endsAt), fechas sin zona y duplicados", () => {
  assert.deepEqual(validateCalendar([S({ id: "x1", startsAt: "2026-10-01T00:00:00Z", endsAt: "2026-10-01T00:00:00Z" })]).map((i) => i.code), ["INVALID_RANGE"]);
  assert.deepEqual(validateCalendar([S({ id: "x2", startsAt: "2026-10-01", endsAt: "2026-12-01" })]).map((i) => i.code), ["BAD_DATE"], "fecha sin hora ni zona: ambigua");
  assert.equal(parseInstant("2026-10-01T10:00:00"), null, "sin zona");
  assert.ok(validateCalendar([s1, { ...s1 }]).some((i) => i.code === "DUPLICATE_ID"));
});

test("10 · derivación determinista: mismo reloj → misma resolución", () => {
  const now = start + 12.5 * D;
  assert.deepEqual(resolveCalendar([s2, s1], now), resolveCalendar([s1, s2], now));
});

/* ───────────── 11–18 · tiempo ───────────── */

test("11 · serverNow es la autoridad: la estimación parte de él y solo suma lo transcurrido en local", () => {
  const clock = { serverNow: start + 10 * D, receivedAt: 5_000 };
  assert.equal(estimateServerNow(clock, 5_000), start + 10 * D);
  assert.equal(estimateServerNow(clock, 65_000), start + 10 * D + 60_000);
});

test("12 · reloj del cliente ADELANTADO no adelanta la temporada", () => {
  const serverNow = end - 2 * H;
  const clientAhead = serverNow + 3 * D;              // el dispositivo cree que ya terminó
  const clock = { serverNow, receivedAt: clientAhead };
  const est = estimateServerNow(clock, clientAhead + 1000);
  assert.equal(statusAt(start, end, est), "ACTIVE");
  assert.equal(clockOffset(serverNow, clientAhead), -3 * D);
});

test("13 · reloj del cliente RETRASADO (o que retrocede) no alarga ni resta", () => {
  const serverNow = end - 2 * H;
  const clock = { serverNow, receivedAt: 1_000_000 };
  assert.equal(estimateServerNow(clock, 900_000), serverNow, "si el reloj local retrocede, no se resta");
});

test("14 · cálculo de la cuenta atrás", () => {
  const c = countdown(end, end - (3 * D + 4 * H + 5 * 60_000 + 6_000));
  assert.deepEqual([c.days, c.hours, c.minutes, c.seconds, c.expired, c.underDay], [3, 4, 5, 6, false, false]);
  assert.equal(formatCountdown(c).primary, "3 DÍAS · 04 HORAS");
});

test("15 · < 24 h se formatea HH:MM:SS y repinta cada segundo", () => {
  const c = countdown(end, end - (5 * H + 7 * 60_000 + 9_000));
  assert.deepEqual(formatCountdown(c), { primary: "05:07:09", mode: "CLOCK" });
  assert.equal(tickMs(c), 1000);
  assert.equal(tickMs(countdown(end, end - 3 * D)), 30_000);
});

test("16 · llegar a 0 pide refresco (una vez) y no decide nada", () => {
  assert.equal(crossedZero(1000, 0), true);
  assert.equal(crossedZero(0, 0), false);
  assert.equal(countdown(end, end + 5000).expired, true);
  const client = read("src/lib/season/client.ts");
  assert.ok(client.includes("crossedZero(prev.current, c.totalMs)") && client.includes("onZero?.()"));
  assert.ok(!/claim|grant|reset|POST/.test(client.replace(/\/\*[\s\S]*?\*\//g, "")), "el cliente no concede ni resetea");
});

test("17 · fechas absolutas presentadas en la zona del usuario", () => {
  assert.match(formatSeasonDate(end, "Europe/Madrid"), /30 de noviembre de 2026.*1:00|30 de noviembre de 2026, 1:00/);
  assert.match(formatSeasonDate(end, "America/New_York"), /29 de noviembre de 2026/);
});

test("18 · el dominio de temporada no usa Date.now() como autoridad", () => {
  for (const f of ["calendar.ts", "time.ts", "recap.ts", "actions.ts"]) {
    const src = read(`src/domain/season/${f}`).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.ok(!/Date\.now\(|new Date\(\)/.test(src), f);
  }
  assert.equal(elapsedFraction(start, end, start + (end - start) / 2), 0.5);
});

/* ───────────── 19–24 · fuente canónica ───────────── */

test("19–21 · UNA fuente: el calendario tiene nexus-s1 una sola vez, válido, sin Temporada 2 inventada", () => {
  assert.deepEqual(validateCalendar(SEASON_CALENDAR), []);
  assert.equal(SEASON_CALENDAR.filter((s) => s.id === "nexus-s1").length, 1);
  assert.equal(SEASON_CALENDAR.filter((s) => s.number === 1).length, 1);
  assert.equal(SEASON_CALENDAR.length, 1, "no hay temporadas inventadas (ni pretemporada, ni Season 2)");
});

test("22 · relación con el pase preservada: id y passSeasonId = CURRENT_SEASON.id; duración = durationDays", () => {
  const s = SEASON_CALENDAR[0];
  assert.equal(s.id, CURRENT_SEASON.id); assert.equal(s.passSeasonId, CURRENT_SEASON.id);
  assert.equal((Date.parse(s.endsAt) - Date.parse(s.startsAt)) / D, CURRENT_SEASON.durationDays);
  assert.ok(s.startsAt.endsWith("Z") && s.endsAt.endsWith("Z"));
});

test("23 · no hay un segundo CURRENT_SEASON: el legado local se llama LEGACY_LOCAL_SEASON", () => {
  assert.ok(!/export const CURRENT_SEASON/.test(read("src/data/seasons.ts")));
  assert.ok(read("src/data/seasons.ts").includes("export const LEGACY_LOCAL_SEASON"));
  assert.ok(!/CURRENT_SEASON/.test(read("src/store/useBattlePassStore.ts")));
});

test("24 · un pase guardado de nexus-s1 sigue resolviéndose: el id del contenido no cambia", () => {
  assert.equal(CURRENT_SEASON.id, "nexus-s1");
  const res = resolveCalendar(SEASON_CALENDAR, start + D);
  assert.ok(res.ok);
  assert.equal(findResolved(res.seasons, "nexus-s1")?.passSeasonId, "nexus-s1");
  assert.ok(SEASON_KEY.test("temporada-1") && !SEASON_KEY.test("../x") && !SEASON_KEY.test("S1") && !SEASON_KEY.test(""));
});

/* ───────────── 57–64 · resumen ───────────── */

const facts = (o: Partial<SeasonRecapFacts> = {}): SeasonRecapFacts => ({
  season: { id: "s1", name: "Temporada 1", startsAtMs: start, endsAtMs: end, status: "ENDED" },
  pass: { level: 17, maxLevel: 30, xp: 17_400, missionsCompleted: 23, claimedFree: 17, claimedCompetitive: 2, source: "LIVE" },
  ratingEvents: [
    { createdAt: start - D, result: "WIN", oldRating: 990, newRating: 1000 },           // antes: fuera
    { createdAt: start + D, result: "WIN", oldRating: 1000, newRating: 1040 },
    { createdAt: start + 2 * D, result: "LOSS", oldRating: 1040, newRating: 1010 },
    { createdAt: start + 3 * D, result: "DRAW", oldRating: 1010, newRating: 1010 },
    { createdAt: end, result: "WIN", oldRating: 1010, newRating: 1030 },                // en endsAt: fuera
  ],
  achievementClaims: [start - 1, start + 5 * D, end + 1],
  pickemScores: [{ scoredAt: start + 4 * D, points: 70, correct: 7, total: 10 }],
  cardsObtainedInWindow: null,
  ...o,
});

test("57 · temporada en curso: resumen «hasta ahora», nunca «completada»", () => {
  const r = buildSeasonRecap(facts({ season: { id: "s1", name: "Temporada 1", startsAtMs: start, endsAtMs: end, status: "ACTIVE" } }));
  assert.equal(r.kind, "SO_FAR"); assert.match(r.title, /hasta ahora/); assert.doesNotMatch(r.title, /completada/);
  assert.equal(buildSeasonRecap(facts({ season: { ...facts().season, status: "UPCOMING" } })).kind, "NONE");
});

test("58 · temporada terminada: resumen final con hechos de la ventana [inicio, final)", () => {
  const r = buildSeasonRecap(facts());
  assert.equal(r.kind, "FINAL"); assert.equal(r.title, "Temporada 1 completada");
  assert.deepEqual(r.ranked, { games: 3, wins: 1, losses: 1, draws: 1, startRating: 1000, finalRating: 1010, highestRating: 1040 });
  assert.equal(r.achievementsClaimed, 1);
  assert.deepEqual(r.pickems, { scored: 1, points: 70, correct: 7 });
  assert.equal(r.minimal, false);
});

test("59 · resumen mínimo: sin actividad no se rellena con cifras vistosas", () => {
  const r = buildSeasonRecap(facts({ pass: null, ratingEvents: [], achievementClaims: [], pickemScores: [] }));
  assert.equal(r.minimal, true);
  assert.equal(r.ranked?.games, 0); assert.equal(r.ranked?.finalRating, null);
});

test("60–62 · sin horas jugadas, carta favorita, MVP ni percentil en el modelo", () => {
  const keys = JSON.stringify(Object.keys(buildSeasonRecap(facts())));
  assert.doesNotMatch(keys + read("src/domain/season/recap.ts").replace(/\/\*[\s\S]*?\*\//g, ""), /hours|playtime|favorite|favourite|mvp|percentile|streak/i);
});

test("63 · rating final solo si hay asientos en la ventana", () => {
  assert.deepEqual(rankedRecap([], start, end), { games: 0, wins: 0, losses: 0, draws: 0, startRating: null, finalRating: null, highestRating: null });
  assert.equal(buildSeasonRecap(facts({ ratingEvents: null })).ranked, null, "sin lectura de rating: se omite");
});

test("64 · cartas conseguidas solo si la métrica es fiable (null → se omite)", () => {
  assert.equal(buildSeasonRecap(facts()).cardsObtained, null);
  assert.equal(buildSeasonRecap(facts({ cardsObtainedInWindow: 12 })).cardsObtained, 12);
});

/* ───────────── 89–91 · acciones ───────────── */

const af = (o: Partial<SeasonActionFacts> = {}): SeasonActionFacts => ({
  activeDuel: false, claimable: { levels: 0, missions: 0, achievements: 0 }, pendingPicks: 0, unopenedPacks: 0,
  hasValidDeck: true, objectives: [], rankedGames: 0, liveEvent: null, ...o,
});

test("89 · prioridad = la de la home: partida > reclamar > Pick'em > sobres > jugar > evento", () => {
  const list = seasonActions(af({
    activeDuel: true, claimable: { levels: 2, missions: 1, achievements: 0 }, pendingPicks: 3, unopenedPacks: 2,
    liveEvent: { id: "ev", name: "Evento" },
  }));
  assert.deepEqual(list.map((a) => a.kind), ["resume", "claim", "predict", "open", "play"]);
});

test("90 · máximo 5 acciones y sin hechos → ninguna", () => {
  const many = seasonActions(af({ activeDuel: true, claimable: { levels: 1, missions: 1, achievements: 1 }, pendingPicks: 1, unopenedPacks: 1, liveEvent: { id: "e", name: "E" } }));
  assert.ok(many.length <= SEASON_ACTIONS_MAX);
  assert.deepEqual(seasonActions(af({ hasValidDeck: null })), []);
  assert.equal(seasonActionCandidates(af({ hasValidDeck: false }))[0].kind, "build");
});

test("91 · no hay un segundo NextUp: se ordena con todayActions, sin prioridades propias", () => {
  const src = read("src/domain/season/actions.ts").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(src.includes("todayActions({"));
  assert.ok(!/RANK|priority:\s*\d|sort\(/.test(src), "ni tabla de rango ni orden propio");
});

test("92 · cuenta atrás accesible: frase sin segundos (no se anuncia cada tic)", () => {
  assert.equal(countdownSentence(countdown(end, end - (2 * D + 3 * H)), "Termina en"), "Termina en 2 días y 3 horas");
  assert.equal(countdownSentence(countdown(end, end - (3 * H + 5 * 60_000 + 30_000)), "Termina en"), "Termina en 3 horas y 5 minutos");
  assert.doesNotMatch(countdownSentence(countdown(end, end - 42_000), "Comienza en"), /segundo/);
});
