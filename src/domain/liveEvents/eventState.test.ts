/**
 * LIVE EVENTS 1.0 · DOMINIO PURO (Fase 30). Estado del evento (1–12), integridad de datos (13–20),
 * acciones, frescura, colección, récords y actividad. Sin base de datos, sin reloj implícito.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveEventState, rankEvents, groupEvents, syncFreshness, FRESHNESS_NOTICE, STALE_AFTER_MS, FAILING_AFTER, collectionProgress, eventActions,
  eventActivity, teamRecords, winnerSideOf, mapLabel, isLiveMatch, isFinishedMatch, matchStatusLabel, isPlaceholderTeam, NEXT_MATCH_GRACE_MS,
  type EventLike, type MatchLike,
} from "./eventState";
import { catalogPlayerIdFor, rosterBridgeSize } from "./playerCards";

const NOW = Date.UTC(2026, 8, 14, 18, 0);
const H = 3600_000, D = 24 * H;
const iso = (t: number) => new Date(t).toISOString();

const ev = (over: Partial<EventLike> = {}): EventLike => ({ id: "e1", name: "QA Invitational", status: null, startDate: iso(NOW - 2 * D), endDate: iso(NOW + 2 * D), region: null, type: null, source: "vlr", ...over });
const m = (id: string, status: string, at: number | null, over: Partial<MatchLike> = {}): MatchLike => ({
  id, status, startTime: at === null ? null : iso(at), teamA: "Aurora", teamB: "Basalto", teamAId: "ta", teamBId: "tb", scoreA: null, scoreB: null, winnerTeamId: null, round: null, matchOrder: 1, stageId: null, ...over,
});

/* ───────────── estado (1–12) ───────────── */

test("1 · upcoming: partidos programados en el futuro y evento sin empezar", () => {
  const s = deriveEventState({ event: ev({ startDate: iso(NOW + D) }), matches: [m("a", "upcoming", NOW + D), m("b", "upcoming", NOW + 2 * D)], now: NOW });
  assert.equal(s.lifecycle, "UPCOMING");
  assert.equal(s.liveMatches.length, 0);
  assert.equal(s.nextMatch?.id, "a");
  assert.equal(s.completedMatches, 0);
});

test("2 · active: basta un partido terminado o uno que ya debería haber empezado", () => {
  assert.equal(deriveEventState({ event: ev(), matches: [m("a", "finished", NOW - H, { winnerTeamId: "ta" }), m("b", "upcoming", NOW + H)], now: NOW }).lifecycle, "ACTIVE");
  assert.equal(deriveEventState({ event: ev({ startDate: iso(NOW + D) }), matches: [m("a", "upcoming", NOW - H)], now: NOW }).lifecycle, "ACTIVE", "programado con hora pasada = en curso, pero NO en directo");
});

test("3 · completed: todos terminados y evento cerrado (o fecha de fin pasada)", () => {
  const done = [m("a", "finished", NOW - 3 * D, { winnerTeamId: "ta" }), m("b", "finished", NOW - 2 * D, { winnerTeamId: "tb" })];
  assert.equal(deriveEventState({ event: ev({ status: "finished" }), matches: done, now: NOW }).lifecycle, "COMPLETED");
  assert.equal(deriveEventState({ event: ev({ endDate: iso(NOW - D) }), matches: done, now: NOW }).lifecycle, "COMPLETED");
  assert.equal(deriveEventState({ event: ev({ endDate: iso(NOW + D), status: "ongoing" }), matches: done, now: NOW }).lifecycle, "ACTIVE", "todo jugado pero el evento sigue abierto: puede faltar una fase por publicar");
});

test("4 · varios eventos en curso a la vez: el principal es el que tiene partido en directo; después el que empezó antes", () => {
  const a = { event: ev({ id: "a", startDate: iso(NOW - D) }), state: deriveEventState({ event: ev({ id: "a" }), matches: [m("x", "finished", NOW - H, { winnerTeamId: "ta" }), m("y", "upcoming", NOW + H)], now: NOW }) };
  const b = { event: ev({ id: "b", startDate: iso(NOW - 3 * D) }), state: deriveEventState({ event: ev({ id: "b" }), matches: [m("z", "live", NOW - H)], now: NOW }) };
  const c = { event: ev({ id: "c", startDate: iso(NOW + 5 * D) }), state: deriveEventState({ event: ev({ id: "c", startDate: iso(NOW + 5 * D) }), matches: [], now: NOW }) };
  const ranked = rankEvents([a, b, c], NOW);
  assert.deepEqual(ranked.map((x) => x.event.id), ["b", "a", "c"]);
  const g = groupEvents([a, b, c], NOW);
  assert.equal(g.active.length, 2);
  assert.equal(g.upcoming.length, 1);
});

test("5 · sin partidos: el evento se clasifica por su fila (status/fechas), nunca se inventa un partido", () => {
  const s = deriveEventState({ event: ev({ status: "upcoming", startDate: iso(NOW + D) }), matches: [], now: NOW });
  assert.equal(s.lifecycle, "UPCOMING");
  assert.equal(s.nextMatch, null);
  assert.equal(s.totalMatches, 0);
  assert.equal(s.progressPct, 0);
  assert.equal(deriveEventState({ event: ev({ status: "finished" }), matches: [], now: NOW }).lifecycle, "COMPLETED");
});

test("6 · próximo partido: el programado más cercano por hora; sin hora, por orden; los muy pasados sin actualizar no cuentan", () => {
  const s = deriveEventState({ event: ev(), matches: [m("late", "upcoming", NOW + 3 * H), m("soon", "upcoming", NOW + H), m("stale", "upcoming", NOW - NEXT_MATCH_GRACE_MS - H), m("nodate", "upcoming", null, { matchOrder: 9 })], now: NOW });
  assert.equal(s.nextMatch?.id, "soon");
  assert.deepEqual(s.nextMatches.map((x) => x.id), ["soon", "late", "nodate"]);
});

test("7 · partido en directo SOLO por status; una hora pasada no lo convierte en directo", () => {
  assert.equal(isLiveMatch({ status: "live" }), true);
  assert.equal(isLiveMatch({ status: "ongoing" }), true);
  assert.equal(isLiveMatch({ status: "upcoming" }), false);
  const s = deriveEventState({ event: ev(), matches: [m("a", "upcoming", NOW - 2 * H)], now: NOW });
  assert.equal(s.liveMatches.length, 0);
  assert.equal(matchStatusLabel({ status: "upcoming" }), "PROGRAMADO");
  assert.equal(matchStatusLabel({ status: "live" }), "EN CURSO");
  assert.equal(matchStatusLabel({ status: "finished" }), "FINALIZADO");
});

test("8 · varios partidos en directo: se devuelven todos, no un singleton", () => {
  const s = deriveEventState({ event: ev(), matches: [m("a", "live", NOW - H), m("b", "live", NOW - H / 2), m("c", "upcoming", NOW + H)], now: NOW });
  assert.deepEqual(s.liveMatches.map((x) => x.id), ["a", "b"]);
  assert.equal(s.lifecycle, "ACTIVE");
});

test("9 · recuento de completados: solo finished/completed", () => {
  const s = deriveEventState({ event: ev(), matches: [m("a", "finished", NOW - D), m("b", "completed", NOW - D), m("c", "live", NOW), m("d", "upcoming", NOW + D)], now: NOW });
  assert.equal(s.completedMatches, 2);
  assert.equal(s.totalMatches, 4);
});

test("10 · progreso = completados / publicados, redondeado; 0 sin partidos", () => {
  const s = deriveEventState({ event: ev(), matches: [m("a", "finished", NOW - D), m("b", "upcoming", NOW + D), m("c", "upcoming", NOW + 2 * D)], now: NOW });
  assert.equal(s.progressPct, 33);
});

test("11 · fase actual: la del partido en directo; si no, la del siguiente; si no, la del último jugado", () => {
  const stages = [{ id: "g", name: "Grupos", kind: "group", orderIdx: 0 }, { id: "p", name: "Playoffs", kind: "playoff", orderIdx: 1 }];
  const live = deriveEventState({ event: ev(), matches: [m("a", "finished", NOW - D, { stageId: "g" }), m("b", "live", NOW, { stageId: "p" })], stages, now: NOW });
  assert.equal(live.currentStage?.name, "Playoffs");
  const next = deriveEventState({ event: ev(), matches: [m("a", "finished", NOW - D, { stageId: "g" }), m("b", "upcoming", NOW + D, { stageId: "p" })], stages, now: NOW });
  assert.equal(next.currentStage?.name, "Playoffs");
  const done = deriveEventState({ event: ev({ status: "finished" }), matches: [m("a", "finished", NOW - D, { stageId: "g" })], stages, now: NOW });
  assert.equal(done.currentStage?.name, "Grupos");
});

test("12 · el reloj es un argumento (el del servidor): el mismo dato cambia de estado solo con `now`", () => {
  const matches = [m("a", "upcoming", NOW + H)];
  assert.equal(deriveEventState({ event: ev({ startDate: iso(NOW + H) }), matches, now: NOW }).lifecycle, "UPCOMING");
  assert.equal(deriveEventState({ event: ev({ startDate: iso(NOW + H) }), matches, now: NOW + 2 * H }).lifecycle, "ACTIVE");
});

/* ───────────── integridad (13–20) ───────────── */

test("13 · no se inventa ningún partido: la salida solo contiene ids de entrada", () => {
  const s = deriveEventState({ event: ev(), matches: [m("a", "live", NOW), m("b", "upcoming", NOW + H)], now: NOW });
  const ids = new Set(["a", "b"]);
  for (const x of [...s.liveMatches, ...s.nextMatches, ...s.recentResults]) assert.ok(ids.has(x.id));
});

test("14 · no se inventa ningún equipo: participantes = ids reales de los partidos, sin placeholders", () => {
  const s = deriveEventState({ event: ev(), matches: [m("a", "upcoming", NOW + H, { teamAId: "vlr-t-1", teamBId: "vlr-t-tbd" }), m("b", "upcoming", NOW + H, { teamAId: null, teamBId: "vlr-t-2" })], now: NOW });
  assert.deepEqual(s.participantIds, ["vlr-t-1", "vlr-t-2"]);
  assert.equal(isPlaceholderTeam("TBD"), true);
  assert.equal(isPlaceholderTeam("Aurora"), false);
});

test("15 · no se inventa ningún jugador: sin costura VLR→catálogo no hay carta", () => {
  assert.ok(rosterBridgeSize() > 300, "la costura conoce el roster VCT 2026");
  assert.equal(catalogPlayerIdFor({ id: "no-such-vlr-id", nick: "nadie-inventado-xyz" }), null);
  assert.equal(catalogPlayerIdFor({ id: "9801", nick: "f0rsakeN" }), "f0rsaken");
  assert.equal(catalogPlayerIdFor({ id: "zzz", nick: "F0RSAKEN" }), "f0rsaken", "por nick normalizado si no hay id");
});

test("16 · ganador SOLO por winner_team_id (o nombre legado); nunca por marcador", () => {
  assert.equal(winnerSideOf({ winnerTeamId: null, teamAId: "ta", teamBId: "tb" }), null);
  assert.equal(winnerSideOf({ winnerTeamId: "tb", teamAId: "ta", teamBId: "tb" }), "b");
  assert.equal(winnerSideOf({ winnerTeamId: "tx", teamAId: "ta", teamBId: "tb" }), null, "un ganador que no es ninguno de los dos no se adivina");
  assert.equal(winnerSideOf({ winnerTeamId: null, teamAId: null, teamBId: null }, "Aurora", { a: "Aurora", b: "Basalto" }), "a");
  const finished = m("a", "finished", NOW - H, { scoreA: 2, scoreB: 0 });
  assert.equal(winnerSideOf(finished), null, "2–0 sin winner_team_id sigue sin ganador confirmado");
});

test("17 · TBD sigue siendo TBD", () => {
  assert.equal(mapLabel(null), "TBD");
  assert.equal(mapLabel(""), "TBD");
  assert.equal(mapLabel("   "), "TBD");
  assert.equal(mapLabel("Ascent"), "Ascent");
});

test("18 · récord por equipo: solo partidos terminados con ganador escrito", () => {
  const r = teamRecords([m("a", "finished", NOW - D, { winnerTeamId: "ta" }), m("b", "finished", NOW - D, { winnerTeamId: null, scoreA: 2, scoreB: 1 }), m("c", "live", NOW, { winnerTeamId: "ta" })]);
  assert.deepEqual(r.get("ta"), { wins: 1, losses: 0, played: 1 });
  assert.deepEqual(r.get("tb"), { wins: 0, losses: 1, played: 1 });
});

test("19 · actividad = hechos reales: terminados con ganador, en directo, predicciones corregidas; ordenada por hora real", () => {
  const items = eventActivity({ matches: [m("a", "finished", NOW - 2 * H, { winnerTeamId: "tb", scoreA: 1, scoreB: 2 }), m("b", "live", NOW - H), m("c", "upcoming", NOW + H), m("d", "finished", NOW - 3 * H)], resolvedPicks: [{ matchId: "a", correct: true, at: iso(NOW - H / 2) }, { matchId: "c", correct: null, at: null }] });
  assert.deepEqual(items.map((i) => i.kind), ["PICK_RESOLVED", "MATCH_LIVE", "MATCH_FINISHED", "MATCH_FINISHED"]);
  assert.equal(items[2].title, "Ganó Basalto");
  assert.equal(items[3].title, "Partido terminado", "sin ganador escrito no se nombra ganador");
  assert.ok(!items.some((i) => /\bc\b/.test(i.id) && i.kind === "PICK_RESOLVED"), "una predicción sin corregir no es actividad");
});

test("20 · finished/completed y live/ongoing son sinónimos de lectura", () => {
  assert.equal(isFinishedMatch({ status: "completed" }), true);
  assert.equal(isFinishedMatch({ status: "final" }), true);
  assert.equal(isFinishedMatch({ status: "live" }), false);
});

/* ───────────── colección, acciones, frescura ───────────── */

test("colección: denominador = cartas reales únicas; numerador = poseídas; sin cartas = 0/0", () => {
  assert.deepEqual(collectionProgress(["c1", "c2", "c2", "c3"], ["c2", "c9"]), { total: 3, owned: 1, pct: 33 });
  assert.deepEqual(collectionProgress([], ["c1"]), { total: 0, owned: 0, pct: 0 });
});

test("acciones: prioridad pura del brief y solo acciones reales", () => {
  const live = m("l", "live", NOW);
  const acts = eventActions({ eventId: "e1", pickem: { pending: 2, nextLockAt: iso(NOW + H) }, objectives: { claimable: 1, pending: 2 }, liveMatches: [live], nextMatch: null, collection: { total: 10, owned: 4, pct: 40 }, packs: [{ id: "team-aur", name: "Sobre Aurora" }], now: NOW, max: 10 });
  assert.deepEqual(acts.map((a) => a.kind), ["pickem", "objective", "live", "collection", "pack", "play"]);
  assert.equal(acts[0].urgent, true, "cierra en menos de 6 h");
  assert.equal(acts[0].href, "/torneos/e1#pickems");
  assert.equal(acts[2].href, "/torneos/e1/partido/l");
  const none = eventActions({ eventId: "e1", pickem: null, objectives: { claimable: 0, pending: 0 }, liveMatches: [], nextMatch: null, collection: null, packs: [], now: NOW });
  assert.deepEqual(none.map((a) => a.kind), ["play"]);
  const next = eventActions({ eventId: "e1", pickem: { pending: 0, nextLockAt: null }, objectives: { claimable: 0, pending: 1 }, liveMatches: [], nextMatch: m("n", "upcoming", NOW + H), collection: { total: 5, owned: 5, pct: 100 }, packs: [], now: NOW });
  assert.deepEqual(next.map((a) => a.kind), ["objective", "next", "play"], "colección completa no pide nada; sin pendientes no hay pick'em");
});

test("frescura: umbrales derivados del ritmo del worker; terminado nunca caduca; fallos seguidos = FAILING; sin dato = UNKNOWN", () => {
  const base = { lastAttemptAt: iso(NOW - 60_000), consecutiveFailures: 0, now: NOW };
  assert.equal(syncFreshness({ ...base, lastSuccessAt: iso(NOW - 5 * 60_000), lifecycle: "ACTIVE", hasLive: true }), "FRESH");
  assert.equal(syncFreshness({ ...base, lastSuccessAt: iso(NOW - 16 * 60_000), lifecycle: "ACTIVE", hasLive: true }), "STALE");
  assert.equal(syncFreshness({ ...base, lastSuccessAt: iso(NOW - 16 * 60_000), lifecycle: "ACTIVE", hasLive: false }), "FRESH", "sin partido en directo el margen es 30 min");
  assert.equal(syncFreshness({ ...base, lastSuccessAt: iso(NOW - STALE_AFTER_MS.ACTIVE - 1), lifecycle: "ACTIVE", hasLive: false }), "STALE");
  assert.equal(syncFreshness({ ...base, lastSuccessAt: iso(NOW - 30 * D), lifecycle: "COMPLETED", hasLive: false }), "FRESH");
  assert.equal(syncFreshness({ ...base, lastSuccessAt: iso(NOW - 60_000), lifecycle: "ACTIVE", hasLive: false, consecutiveFailures: FAILING_AFTER }), "FAILING");
  assert.equal(syncFreshness({ ...base, lastSuccessAt: null, lifecycle: "UPCOMING", hasLive: false }), "UNKNOWN");
  assert.equal(FRESHNESS_NOTICE.FRESH, null);
  assert.equal(FRESHNESS_NOTICE.STALE, "Los datos del evento pueden tardar en actualizarse.");
  assert.ok(!/worker|lease|vps/i.test(FRESHNESS_NOTICE.FAILING ?? ""));
});
