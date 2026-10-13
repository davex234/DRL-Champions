/**
 * FASE 36 · DAILY LOOP — MATRIZ DE PRIORIDAD Y FOTO (puro).
 *
 * Una sola autoridad (`dailyActions` → `orderToday`). Cada estado real del jugador da UNA acción principal
 * determinista; una partida a medias gana siempre; nada caído se recomienda; nada se inventa.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildDailyLoop, dailyActions, dailyCandidates, todayItems, deckState, objectiveRoute, rewardLabel, claimableObjectives,
  featuredEvents, unavailableOf, DAILY_ROUTES, SECONDARY_MAX, TODAY_MAX, FALLBACK_ACTION,
  type DailyLoopFacts, type LiveEventFact,
} from "./index";
import { orderToday, todayActions, todayRank, nearObjective, liveObjective, type MetaObjective, type TodayAction } from "@/domain/progression/meta";
import { seasonActions } from "@/domain/season/actions";
import { CURRENT_SEASON } from "@/data/season";
import type { JourneyFacts } from "@/domain/journey";

const NOW = Date.parse("2026-09-20T12:00:00.000Z");
const H = 3600_000;

const obj = (o: Partial<MetaObjective> & { id: string }): MetaObjective => ({
  label: `Objetivo ${o.id}`, kind: "daily", current: 0, goal: 5, complete: false, claimed: false, rewardCredits: 100, xp: 200,
  metric: "duels_played", packId: null, packCount: 0, assignedAt: NOW - 2 * H, expiresAt: NOW + 10 * H, ...o,
});

const READY_DECK = { id: "d-ready", name: "Equipo 2", valid: true, size: 10, sumOvr: 813 };
const BAD_DECK = { id: "d-bad", name: "A medias", valid: false, size: 7, sumOvr: 540 };

function facts(o: Partial<DailyLoopFacts> = {}): DailyLoopFacts {
  return {
    now: NOW, signedIn: true, catalogSize: 772,
    matches: [],
    social: { incoming: 0, from: null },
    progression: {
      account: { level: 7, xp: 2400, xpIntoLevel: 120, xpForNext: 600, progress: 0.2 },
      pass: { level: 3, maxLevel: 50, xp: 3400, xpIntoLevel: 400, xpForNext: 1000, progress: 0.4, nextReward: { level: 4, track: "free", label: "300 créditos" } },
      claimableLevels: 0,
      objectives: [],
      achievements: { total: 12, claimed: 2, claimable: 0, near: null },
      rotationPending: false,
      metrics: { ownedCards: 25, distinctCards: 22, packsOpened: 5, duelsPlayed: 3 },
    },
    pickems: { pending: 0, open: 0, eventId: null, eventName: null },
    packs: { unopened: 0 },
    decks: { total: 2, valid: 1, active: READY_DECK, firstInvalid: null },
    campaign: { completed: 1, total: 15, complete: false, next: { nodeId: "c1-n2", name: "Segundo asalto", team: "LOUD", chapterOrder: 1 } },
    competitive: { rating: null, gamesPlayed: 0, wins: 0, losses: 0, draws: 0, provisional: true, position: null, rankedTotal: 40, recent: [] },
    live: [],
    season: { current: { id: "nexus-s1", name: "Temporada 1", status: "ACTIVE", presentation: "ACTIVE", startsAtMs: NOW - 10 * 24 * H, endsAtMs: NOW + 50 * 24 * H }, next: null },
    ...o,
  };
}

/** Fase 40 · hechos de la primera sesión (lo que el servicio deriva de progresión, sobres, equipos y catálogo). */
const NOT_READY = { ready: false, dataVersion: "VCT-2026", roles: [{ role: "Duelista" as const, have: 2, need: 2 }, { role: "Controlador" as const, have: 2, need: 2 }, { role: "Iniciador" as const, have: 2, need: 2 }, { role: "Centinela" as const, have: 1, need: 2 }, { role: "Flex" as const, have: 0, need: 2 }], shortages: [{ role: "Centinela" as const, have: 1, need: 2 }, { role: "Flex" as const, have: 0, need: 2 }] };
const jf = (o: Partial<JourneyFacts> = {}): JourneyFacts => ({
  ownedCards: 0, packsOpened: 0, matchesCompleted: 0, unopenedPacks: 4, firstPackId: "inicial",
  decks: { total: 0, valid: 0, firstInvalid: null }, readyDeck: null, readiness: { ...NOT_READY, roles: NOT_READY.roles.map((r) => ({ ...r, have: 0 })), shortages: NOT_READY.roles.map((r) => ({ ...r, have: 0 })) }, ...o,
});
const FRESH_METRICS = { ownedCards: 0, distinctCards: 0, packsOpened: 0, duelsPlayed: 0 };
const NO_DECKS = { total: 0, valid: 0, active: null, firstInvalid: null };

const withProg = (p: Partial<NonNullable<DailyLoopFacts["progression"]>>, o: Partial<DailyLoopFacts> = {}) =>
  facts({ ...o, progression: { ...facts().progression!, ...p } });

const primary = (f: DailyLoopFacts) => dailyActions(f).primary;
const ev = (e: Partial<LiveEventFact> & { id: string }): LiveEventFact => ({
  name: `Evento ${e.id}`, lifecycle: "ACTIVE", isDemo: false, startDate: null, endDate: null, liveCount: 0, liveMatch: null, nextMatch: null, pickem: null, ...e,
});

/* ───────────── primera sesión y equipo ───────────── */

test("MATRIZ · cuenta nueva (Fase 40): el recorrido propone abrir SU primer sobre real, con bienvenida y 4 pasos", () => {
  const f = withProg({ metrics: FRESH_METRICS }, { packs: { unopened: 4 }, decks: NO_DECKS, journey: jf() });
  const a = primary(f);
  assert.equal(a.id, "journey-open");
  assert.equal(a.cta, "Abrir mi primer sobre");
  assert.equal(a.href, "/abrir/inicial");
  assert.equal(a.ftue, true);
  const snap = buildDailyLoop(f);
  assert.ok(snap.journey && snap.journey.welcome);
  assert.deepEqual(snap.journey!.steps.map((s) => s.id), ["open", "collect", "build", "play"]);
  assert.equal(snap.journey!.progress.label, "0/4");
});

test("MATRIZ · cuenta nueva: abrir su primer sobre va por delante de un Pick'em (regla de la Fase 15)", () => {
  const f = withProg({ metrics: FRESH_METRICS }, { packs: { unopened: 4 }, decks: NO_DECKS, journey: jf(), pickems: { pending: 3, open: 3, eventId: "e1", eventName: "Masters" } });
  assert.equal(primary(f).id, "journey-open");
  assert.equal(dailyActions(f).secondary[0]?.id, "predict");
});

test("MATRIZ · cuenta nueva sin sobres ni cartas → conseguir sobres (tienda), nunca un sobre gratis", () => {
  const f = withProg({ metrics: { ownedCards: 0, distinctCards: 0, packsOpened: 0, duelsPlayed: 0 } }, { packs: { unopened: 0 }, decks: { total: 0, valid: 0, active: null, firstInvalid: null } });
  const a = primary(f);
  assert.equal(a.id, "get-cards");
  assert.equal(a.href, "/tienda");
  assert.deepEqual(a.progress, { value: 0, max: 10, label: "0 / 10 cartas" });
});

test("MATRIZ · sin equipo (con cartas) → CREAR EQUIPO", () => {
  const a = primary(facts({ decks: { total: 0, valid: 0, active: null, firstInvalid: null } }));
  assert.equal(a.id, "create-team");
  assert.equal(a.cta, "Crear equipo");
  assert.equal(a.href, DAILY_ROUTES.newDeck);
});

test("MATRIZ · equipo inválido → EDITAR EQUIPO con ese equipo y su recuento real", () => {
  const a = primary(facts({ decks: { total: 1, valid: 0, active: null, firstInvalid: BAD_DECK } }));
  assert.equal(a.id, "edit-team");
  assert.equal(a.cta, "Editar equipo");
  assert.equal(a.href, "/duelos/mazos?deck=d-bad");
  assert.deepEqual(a.progress, { value: 7, max: 10, label: "7 / 10 cartas" });
});

test("MATRIZ · sin equipo válido no se propone jugar (ni campaña, ni ranked, ni rápida)", () => {
  const ids = dailyCandidates(facts({ decks: { total: 1, valid: 0, active: null, firstInvalid: BAD_DECK } })).map((a) => a.id);
  for (const id of ["campaign", "ranked", "quick"]) assert.ok(!ids.includes(id as never), id);
});

test("MATRIZ · menos de diez cartas y sobres pendientes → abrir (no «crear equipo» imposible)", () => {
  const f = withProg({ metrics: { ownedCards: 6, distinctCards: 6, packsOpened: 1, duelsPlayed: 0 } }, { packs: { unopened: 2 }, decks: { total: 0, valid: 0, active: null, firstInvalid: null } });
  const ids = dailyCandidates(f).map((a) => a.id);
  assert.equal(primary(f).id, "open");
  assert.ok(!ids.includes("create-team"));
});

/* ───────────── partidas a medias (P0) ───────────── */

test("MATRIZ · partida PvE a medias → CONTINUAR PARTIDA y sin lanzar otra PvE", () => {
  const f = facts({ matches: [{ id: "m1", mode: "PVE", difficulty: "HARD", opponent: null, node: null }] });
  const { primary: a, secondary } = dailyActions(f);
  assert.equal(a.id, "resume-pve");
  assert.equal(a.cta, "Continuar partida");
  assert.equal(a.href, "/duelos/jugar");
  assert.match(a.title, /Difícil/);
  assert.ok(!dailyCandidates(f).some((x) => x.id === "quick" || x.id === "campaign"));
  assert.ok(!secondary.some((x) => x.kind === "resume"));
});

test("MATRIZ · ranked a medias → CONTINUAR PARTIDA con el rival público y la partida exacta", () => {
  const a = primary(facts({ matches: [{ id: "p-7", mode: "RANKED", difficulty: null, opponent: "Kira", node: null }] }));
  assert.equal(a.id, "resume-ranked");
  assert.equal(a.title, "Contra Kira");
  assert.equal(a.href, "/duelos/pvp?match=p-7");
});

test("MATRIZ · privada a medias → CONTINUAR PARTIDA (no cuenta para rating, se dice)", () => {
  const a = primary(facts({ matches: [{ id: "p-8", mode: "PRIVATE", difficulty: null, opponent: null, node: null }] }));
  assert.equal(a.id, "resume-private");
  assert.match(a.detail, /No cuenta para el rating/);
  assert.equal(a.href, "/duelos/pvp?match=p-8");
});

test("MATRIZ · nodo de campaña a medias → vuelve a la partida del nodo", () => {
  const a = primary(facts({ matches: [{ id: "m2", mode: "CAMPAIGN", difficulty: "EASY", opponent: null, node: { id: "c1-n2", name: "Segundo asalto" } }] }));
  assert.equal(a.id, "resume-campaign");
  assert.equal(a.href, "/duelos/jugar?campaign=c1-n2");
});

test("MATRIZ · con PvP y PvE a medias, manda el PvP (otra persona espera)", () => {
  const a = primary(facts({ matches: [{ id: "m1", mode: "PVE", difficulty: "EASY", opponent: null, node: null }, { id: "p1", mode: "RANKED", difficulty: null, opponent: null, node: null }] }));
  assert.equal(a.id, "resume-ranked");
});

test("P0 · una partida activa gana a TODO lo demás a la vez", () => {
  const f = withProg({
    claimableLevels: 2,
    objectives: [obj({ id: "near", current: 4, goal: 5 })],
    achievements: { total: 12, claimed: 2, claimable: 1, near: null },
    metrics: { ownedCards: 0, distinctCards: 0, packsOpened: 0, duelsPlayed: 0 },
  }, {
    matches: [{ id: "m1", mode: "PVE", difficulty: "NORMAL", opponent: null, node: null }],
    social: { incoming: 2, from: "Ana" },
    pickems: { pending: 4, open: 4, eventId: "e", eventName: "Masters" },
    packs: { unopened: 5 },
    live: [ev({ id: "e", liveCount: 1 })],
  });
  assert.equal(primary(f).kind, "resume");
});

for (const mode of ["RANKED", "PRIVATE", "CAMPAIGN", "PVE"] as const) {
  test(`P0 · partida ${mode} a medias gana a sobres, colección, campaña nueva y evento en directo`, () => {
    const f = facts({ matches: [{ id: "x", mode, difficulty: null, opponent: null, node: mode === "CAMPAIGN" ? { id: "c1-n2", name: "N" } : null }], packs: { unopened: 9 }, live: [ev({ id: "e", liveCount: 2 })] });
    assert.equal(primary(f).kind, "resume");
  });
}

/* ───────────── retos, recompensas, Pick'ems, objetivos ───────────── */

test("MATRIZ · reto recibido → RESPONDER RETO con el nombre público del retador", () => {
  const a = primary(facts({ social: { incoming: 1, from: "Ana" } }));
  assert.equal(a.id, "challenge");
  assert.equal(a.title, "Reto de Ana");
  assert.equal(a.href, "/social?tab=retos");
  const many = primary(facts({ social: { incoming: 3, from: "Ana" } }));
  assert.equal(many.title, "Reto de Ana y 2 retos más");
  assert.equal(many.count, 3);
});

test("MATRIZ · reto recibido gana a recompensas y Pick'ems (prioridad canónica)", () => {
  const f = withProg({ claimableLevels: 1 }, { social: { incoming: 1, from: null }, pickems: { pending: 2, open: 2, eventId: null, eventName: null } });
  assert.equal(primary(f).id, "challenge");
});

test("MATRIZ · logro reclamable → RECLAMAR LOGRO (a Logros, sin reclamar nada)", () => {
  const a = primary(withProg({ achievements: { total: 12, claimed: 2, claimable: 1, near: null } }));
  assert.equal(a.id, "claim");
  assert.equal(a.cta, "Reclamar logro");
  assert.equal(a.href, "/logros");
});

test("MATRIZ · niveles del pase y objetivos reclamables → RECLAMAR con el desglose real", () => {
  const a = primary(withProg({ claimableLevels: 2, objectives: [obj({ id: "done", current: 5, goal: 5, complete: true })] }));
  assert.equal(a.cta, "Reclamar");
  assert.equal(a.title, "2 niveles del pase · 1 objetivo por reclamar");
  assert.equal(a.count, 3);
});

test("RECLAMABLE · un objetivo completo de una ventana CADUCADA no se ofrece (se borraría al rotar)", () => {
  const stale = obj({ id: "old", current: 5, goal: 5, complete: true, expiresAt: NOW - H });
  assert.ok(!dailyCandidates(withProg({ objectives: [stale] })).some((a) => a.id === "claim"));
  assert.equal(claimableObjectives([stale], NOW).length, 0);
  assert.equal(buildDailyLoop(withProg({ objectives: [stale] })).objectives!.claimable, 0);
});

test("RECLAMABLE · uno ya reclamado no cuenta", () => {
  assert.equal(claimableObjectives([obj({ id: "c", complete: true, claimed: true, current: 5 })], NOW).length, 0);
});

test("MATRIZ · Pick'em pendiente → HAZ TU PREDICCIÓN", () => {
  const a = primary(facts({ pickems: { pending: 2, open: 3, eventId: "e1", eventName: "Champions" } }));
  assert.equal(a.id, "predict");
  assert.equal(a.cta, "Haz tu predicción");
  assert.equal(a.href, "/pickems");
  assert.equal(a.eyebrow, "Pick'ems · Champions");
  assert.equal(a.urgent, true);
});

test("PRIORIDAD · recompensa pendiente va antes que Pick'em (RANK canónico de la home)", () => {
  assert.equal(primary(withProg({ claimableLevels: 1 }, { pickems: { pending: 2, open: 2, eventId: null, eventName: null } })).id, "claim");
});

test("MATRIZ · objetivo diario casi completado → COMPLETAR OBJETIVO con 3 / 5 y destino por métrica", () => {
  const a = primary(withProg({ objectives: [obj({ id: "d-duelos", current: 3, goal: 5, metric: "duels_played" })] }));
  assert.equal(a.id, "objective");
  assert.equal(a.cta, "Completar objetivo");
  assert.deepEqual(a.progress, { value: 3, max: 5, label: "3 / 5" });
  assert.equal(a.href, "/jugar");
  assert.match(a.eyebrow, /diario casi completado/i);
  assert.equal(a.detail, "Te faltan 2 para completarlo.");
});

test("CASI COMPLETADO · un objetivo al 20 % no lo es", () => {
  assert.ok(!dailyCandidates(withProg({ objectives: [obj({ id: "a", current: 1, goal: 5 })] })).some((a) => a.id === "objective"));
});

test("CASI COMPLETADO · sin denominador (goal 0) nunca", () => {
  assert.equal(nearObjective([obj({ id: "z", current: 3, goal: 0 })], NOW), null);
});

test("CASI COMPLETADO · de una ventana caducada nunca", () => {
  assert.equal(nearObjective([obj({ id: "x", current: 4, goal: 5, expiresAt: NOW - 1 })], NOW), null);
  assert.ok(nearObjective([obj({ id: "x", current: 4, goal: 5, expiresAt: NOW - 1 })]), "sin reloj, la regla antigua sigue igual");
});

test("CASI COMPLETADO · el más avanzado; a igualdad, el que caduca antes; después por id", () => {
  const list = [obj({ id: "b", current: 3, goal: 4, expiresAt: NOW + 5 * H }), obj({ id: "a", current: 3, goal: 4, expiresAt: NOW + 2 * H }), obj({ id: "c", current: 4, goal: 5 })];
  assert.equal(nearObjective(list, NOW)!.id, "c");
  assert.equal(nearObjective(list.slice(0, 2), NOW)!.id, "a");
});

/* ───────────── sobres, campaña, competitivo ───────────── */

test("MATRIZ · sobres sin abrir (con cartas) → ABRIR 3 SOBRES", () => {
  const a = primary(facts({ packs: { unopened: 3 } }));
  assert.equal(a.id, "open");
  assert.equal(a.title, "Tienes 3 sobres sin abrir");
  assert.equal(a.cta, "Abrir 3 sobres");
  assert.equal(primary(facts({ packs: { unopened: 1 } })).cta, "Abrir sobre");
});

test("MATRIZ · campaña disponible → CONTINUAR ROAD TO CHAMPIONS con nodo, rival y 1 / 15", () => {
  const a = primary(facts());
  assert.equal(a.id, "campaign");
  assert.equal(a.cta, "Continuar Road to Champions");
  assert.equal(a.title, "Segundo asalto · contra LOUD");
  assert.equal(a.href, "/jugar/road-to-champions?node=c1-n2");
  assert.deepEqual(a.progress, { value: 1, max: 15, label: "1 / 15" });
  assert.match(a.eyebrow, /capítulo 1/);
});

test("MATRIZ · campaña sin empezar → EMPEZAR ROAD TO CHAMPIONS", () => {
  assert.equal(primary(facts({ campaign: { completed: 0, total: 15, complete: false, next: { nodeId: "c1-n1", name: "Primer contacto", team: "NAVI", chapterOrder: 1 } } })).cta, "Empezar Road to Champions");
});

test("MATRIZ · campaña completada → no se propone campaña; manda competitivo", () => {
  const f = facts({ campaign: { completed: 15, total: 15, complete: true, next: null } });
  const a = primary(f);
  assert.equal(a.id, "ranked");
  assert.equal(a.title, "Tu primera partida ranked");
  assert.ok(!dailyCandidates(f).some((x) => x.id === "campaign"));
});

test("MATRIZ · ranked provisional → «Provisional · 4 de 10 partidas» con calibración real", () => {
  const a = primary(facts({ campaign: { completed: 15, total: 15, complete: true, next: null }, competitive: { rating: 1040, gamesPlayed: 4, wins: 3, losses: 1, draws: 0, provisional: true, position: null, rankedTotal: 40, recent: ["WIN"] } }));
  assert.equal(a.title, "Provisional · 4 de 10 partidas");
  assert.deepEqual(a.progress, { value: 4, max: 10, label: "4 / 10" });
  assert.equal(a.href, "/duelos/pvp");
});

test("MATRIZ · ranked establecido → posición y rating reales, sin divisiones inventadas", () => {
  const a = primary(facts({ campaign: null, competitive: { rating: 1234, gamesPlayed: 25, wins: 15, losses: 10, draws: 0, provisional: false, position: 3, rankedTotal: 40, recent: [] } }));
  assert.equal(a.title, "#3 de 40 · rating 1234");
  assert.equal(a.progress, null);
  assert.ok(!/oro|plata|bronce|diamante|divisi|tier|rango/i.test(JSON.stringify(a)));
});

test("MATRIZ · sin campaña ni ranked legibles → JUGAR PARTIDA RÁPIDA", () => {
  const a = primary(facts({ campaign: null, competitive: null }));
  assert.equal(a.id, "quick");
  assert.equal(a.cta, "Jugar partida rápida");
});

test("DESEMPATE · dentro de «jugar» el orden de entrada es campaña > competitivo > rápida", () => {
  const plays = dailyCandidates(facts()).filter((a) => a.kind === "play").map((a) => a.id);
  assert.deepEqual(plays, ["campaign", "ranked", "quick"]);
});

/* ───────────── directo y temporada ───────────── */

test("MATRIZ · evento con partido en directo → VER EN DIRECTO como secundaria", () => {
  const f = facts({ live: [ev({ id: "ev1", name: "Masters Toronto", liveCount: 1, liveMatch: { teamA: "FNC", teamB: "G2", scoreA: 1, scoreB: 0 } })] });
  const live = dailyCandidates(f).find((a) => a.id === "live")!;
  assert.equal(live.cta, "Ver en directo");
  assert.equal(live.href, "/torneos/ev1");
  assert.equal(live.detail, "FNC vs G2");
  assert.notEqual(primary(f).id, "live");
});

test("NO FAKE LIVE · evento activo sin partido en juego no genera «en directo»", () => {
  const f = facts({ live: [ev({ id: "ev1", lifecycle: "ACTIVE", liveCount: 0 })] });
  assert.ok(!dailyCandidates(f).some((a) => a.id === "live"));
  assert.ok(!/directo/i.test(JSON.stringify(dailyActions(f))));
});

test("DIRECTO · Fase 42: un evento de demostración NO se recomienda como directo (solo su bloque, con «Demo»)", () => {
  // QA real 2026-09-16: «DRL Masters Madrid 2026» (demo, terminado el 13-09) conservaba un partido `live` y el vestíbulo
  // proponía «Ver en directo». Un directo del vestíbulo tiene que ser real.
  assert.ok(!dailyCandidates(facts({ live: [ev({ id: "d", liveCount: 1, isDemo: true })] })).some((a) => a.id === "live"));
  assert.equal(dailyCandidates(facts({ live: [ev({ id: "d", liveCount: 1, isDemo: true }), ev({ id: "r", liveCount: 1 })] })).find((a) => a.id === "live")!.href.endsWith("/r"), true);
  assert.equal(dailyCandidates(facts({ live: [ev({ id: "r", liveCount: 1 })] })).find((a) => a.id === "live")!.eyebrow, "En directo");
});

test("FTUE · con cartas en el álbum «abre» está hecho aunque el contador packs_opened valga 0 (medido en la BD real)", () => {
  const s = buildDailyLoop(withProg({ metrics: { ownedCards: 25, distinctCards: 25, packsOpened: 0, duelsPlayed: 2 } }, { journey: jf({ ownedCards: 25, matchesCompleted: 2 }) }));
  assert.equal(s.journey, null, "con partidas terminadas la primera sesión está completa y la home es la de siempre");
  const cards = buildDailyLoop(withProg({ metrics: { ownedCards: 25, distinctCards: 25, packsOpened: 0, duelsPlayed: 0 } }, { journey: jf({ ownedCards: 25, unopenedPacks: 0, firstPackId: null, readiness: NOT_READY }) }));
  assert.equal(cards.journey!.steps[0].done, true);
  assert.equal(cards.journey!.currentStep, "collect");
});

test("MATRIZ · sin eventos → ninguna acción de circuito", () => {
  assert.ok(!dailyCandidates(facts({ live: [] })).some((a) => a.kind === "explore"));
});

test("MATRIZ · solo el directo disponible (sin equipo conocido) → el hub de modos primero, el directo después", () => {
  const f = facts({ decks: null, campaign: null, competitive: null, live: [ev({ id: "e", liveCount: 1 })] });
  const { primary: a, secondary } = dailyActions(f);
  assert.equal(a.id, "play-hub");
  assert.equal(a.href, "/jugar");
  assert.equal(secondary[0].id, "live");
});

test("TEMPORADA · activa: la foto trae la actual y NO inventa la siguiente", () => {
  const s = buildDailyLoop(facts());
  assert.equal(s.season!.current!.name, "Temporada 1");
  assert.equal(s.season!.next, null);
  assert.ok(s.season!.pass);
});

test("TEMPORADA · terminada: sin temporada actual ni siguiente, sin pase", () => {
  const f = withProg({ pass: null }, { season: { current: null, next: null } });
  const s = buildDailyLoop(f);
  assert.equal(s.season!.current, null);
  assert.equal(s.season!.pass, null);
});

/* ───────────── aislamiento y anónimo ───────────── */

test("AISLAMIENTO · progresión caída: ni reclamar ni objetivos, y se marca como no disponible", () => {
  const f = facts({ progression: null });
  const ids = dailyCandidates(f).map((a) => a.id);
  assert.ok(!ids.includes("claim") && !ids.includes("objective") && !ids.some((i) => i.startsWith("journey-")));
  const s = buildDailyLoop(f);
  assert.deepEqual(s.unavailable, ["progression"]);
  assert.equal(s.player, null);
  assert.equal(s.journey, null, "sin sus hechos no se adivina el paso");
});

test("AISLAMIENTO · equipos caídos: no se propone crear equipo ni un modo concreto; al hub de modos", () => {
  const f = facts({ decks: null });
  const ids = dailyCandidates(f).map((a) => a.id);
  assert.ok(!ids.includes("create-team") && !ids.includes("edit-team") && !ids.includes("campaign") && !ids.includes("ranked"));
  assert.equal(primary(f).id, "play-hub");
});

test("AISLAMIENTO · Pick'ems / social / partidas caídos no rompen ni recomiendan", () => {
  const f = facts({ pickems: null, social: null, matches: null });
  const ids = dailyCandidates(f).map((a) => a.id);
  assert.ok(!ids.includes("predict") && !ids.includes("challenge") && !ids.some((i) => i.startsWith("resume")));
  assert.deepEqual(unavailableOf(f), ["match", "social", "pickems"]);
});

test("AISLAMIENTO · todo caído con sesión → fallback honesto al hub de modos", () => {
  const f = facts({ matches: null, social: null, progression: null, pickems: null, packs: null, decks: null, campaign: null, competitive: null, live: null, season: null });
  const s = buildDailyLoop(f);
  assert.equal(s.primaryAction.href, "/jugar");
  assert.equal(s.unavailable.length, 10);
  assert.deepEqual(s.today, []);
});

test("FALLBACK · sin ningún candidato la acción es JUGAR → /jugar", () => {
  assert.equal(FALLBACK_ACTION.href, "/jugar");
  assert.equal(orderToday([], 4)[0] ?? FALLBACK_ACTION, FALLBACK_ACTION);
});

test("ANÓNIMO · ENTRAR PARA JUGAR, nada personal, nada marcado como caído", () => {
  const f: DailyLoopFacts = { ...facts(), signedIn: false, matches: null, social: null, progression: null, pickems: null, packs: null, decks: null, campaign: null, competitive: null };
  const s = buildDailyLoop(f);
  assert.equal(s.primaryAction.id, "sign-in");
  assert.equal(s.primaryAction.href, "/cuenta");
  assert.deepEqual(s.today, []);
  assert.equal(s.player, null); assert.equal(s.packs, null); assert.equal(s.deck, null); assert.equal(s.competitive, null); assert.equal(s.social, null);
  assert.deepEqual(s.unavailable, []);
});

test("ANÓNIMO · con partido en directo lo ofrece como secundaria y no calcula Pick'ems personales", () => {
  const f: DailyLoopFacts = { ...facts(), signedIn: false, matches: null, social: null, progression: null, pickems: null, packs: null, decks: null, campaign: null, competitive: null, live: [ev({ id: "e", liveCount: 1, pickem: { open: 3, pending: 3 } })] };
  const s = buildDailyLoop(f);
  assert.equal(s.secondaryActions[0].id, "live");
  assert.equal(s.live!.pickemPending, 0);
});

/* ───────────── propiedades ───────────── */

test("PROPIEDAD · como mucho 3 secundarias y nunca dos del mismo tipo que la principal", () => {
  const f = withProg({ claimableLevels: 1, objectives: [obj({ id: "n", current: 4, goal: 5 })] }, { social: { incoming: 1, from: "A" }, pickems: { pending: 1, open: 1, eventId: null, eventName: null }, packs: { unopened: 2 }, live: [ev({ id: "e", liveCount: 1 })] });
  const { primary: p, secondary } = dailyActions(f);
  assert.ok(secondary.length <= SECONDARY_MAX);
  const kinds = [p, ...secondary].map((a) => a.kind);
  assert.equal(new Set(kinds).size, kinds.length);
});

test("PROPIEDAD · determinista: misma entrada, misma salida; el orden de los objetivos no cambia la decisión", () => {
  const list = [obj({ id: "a", current: 3, goal: 5 }), obj({ id: "b", current: 4, goal: 5 }), obj({ id: "c", current: 1, goal: 5 })];
  const a = buildDailyLoop(withProg({ objectives: list }));
  const b = buildDailyLoop(withProg({ objectives: [...list].reverse() }));
  assert.deepEqual(a.primaryAction, b.primaryAction);
  assert.deepEqual(a.today, b.today);
  assert.deepEqual(buildDailyLoop(facts()), buildDailyLoop(facts()));
});

const MATRIX: [string, DailyLoopFacts][] = [
  ["fresh", withProg({ metrics: { ownedCards: 0, distinctCards: 0, packsOpened: 0, duelsPlayed: 0 } }, { packs: { unopened: 4 }, decks: { total: 0, valid: 0, active: null, firstInvalid: null } })],
  ["no-deck", facts({ decks: { total: 0, valid: 0, active: null, firstInvalid: null } })],
  ["invalid", facts({ decks: { total: 1, valid: 0, active: null, firstInvalid: BAD_DECK } })],
  ["pve", facts({ matches: [{ id: "m", mode: "PVE", difficulty: "EASY", opponent: null, node: null }] })],
  ["ranked-match", facts({ matches: [{ id: "m", mode: "RANKED", difficulty: null, opponent: "X", node: null }] })],
  ["challenge", facts({ social: { incoming: 1, from: "Y" } })],
  ["claim", withProg({ claimableLevels: 1 })],
  ["pickem", facts({ pickems: { pending: 1, open: 1, eventId: null, eventName: null } })],
  ["near", withProg({ objectives: [obj({ id: "n", current: 4, goal: 5 })] })],
  ["packs", facts({ packs: { unopened: 3 } })],
  ["campaign", facts()],
  ["campaign-done", facts({ campaign: { completed: 15, total: 15, complete: true, next: null } })],
  ["live", facts({ live: [ev({ id: "e", liveCount: 1 })] })],
  ["anon", { ...facts(), signedIn: false }],
];

test("RUTAS · toda acción de la matriz lleva a una ruta interna conocida", () => {
  const known = new Set<string>(Object.values(DAILY_ROUTES).map((r) => r.split(/[?#]/)[0]));
  for (const [name, f] of MATRIX) {
    for (const a of dailyCandidates(f)) {
      const base = a.href.split(/[?#]/)[0];
      assert.ok(known.has(base) || base.startsWith("/torneos/"), `${name}: ${a.href}`);
    }
  }
});

test("COPY · ninguna acción promete rachas, bonus de entrada, monedas nuevas ni CTA genéricos", () => {
  const forbidden = /racha|login|bonus|energ[ií]a|stamina|ticket|ruleta|vuelve mañana|temporada 2|ver más|^explorar$|^continuar$/i;
  for (const [name, f] of MATRIX) {
    for (const a of dailyCandidates(f)) {
      assert.ok(!forbidden.test(`${a.eyebrow} ${a.title} ${a.detail}`), `${name}/${a.id}`);
      assert.ok(!forbidden.test(a.cta), `${name}/${a.id} cta`);
    }
  }
});

test("COPY · «directo» solo aparece cuando hay un partido en directo", () => {
  for (const [name, f] of MATRIX) {
    const hasLive = (f.live ?? []).some((e) => e.liveCount > 0);
    const text = JSON.stringify(dailyCandidates(f));
    if (!hasLive) assert.ok(!/directo/i.test(text), name);
  }
});

/* ───────────── HOY ───────────── */

test("HOY · reclamables primero, después el casi completo, luego el resto; como mucho 5", () => {
  const list = [
    obj({ id: "w1", kind: "weekly", current: 1, goal: 10 }),
    obj({ id: "d1", current: 4, goal: 5 }),
    obj({ id: "d2", current: 5, goal: 5, complete: true }),
    obj({ id: "d3", current: 1, goal: 3 }),
  ];
  const items = todayItems(withProg({ objectives: list }, { campaign: null, competitive: null }));
  assert.deepEqual(items.map((i) => i.id), ["objective:d2", "objective:d1", "objective:d3", "objective:w1"]);
  assert.equal(items[0].status, "CLAIMABLE");
  assert.equal(items[0].href, "/logros");
  assert.equal(items[1].status, "NEAR");
  assert.ok(items.length <= TODAY_MAX);
});

test("HOY · excluye reclamados, caducados, temporada/progreso y metas sin denominador", () => {
  const list = [
    obj({ id: "claimed", claimed: true, complete: true, current: 5 }),
    obj({ id: "expired", current: 4, expiresAt: NOW - 1 }),
    obj({ id: "seasonal", kind: "seasonal", current: 2 }),
    obj({ id: "nogoal", goal: 0, current: 1 }),
    obj({ id: "ok", current: 1 }),
  ];
  assert.deepEqual(todayItems(withProg({ objectives: list }, { campaign: null, competitive: null })).map((i) => i.id), ["objective:ok"]);
});

test("HOY · deja sitio a Pick'ems, campaña, calibración y sobres (máx. 3 objetivos si hay extras)", () => {
  const list = ["a", "b", "c", "d", "e"].map((id) => obj({ id, current: 1 }));
  const f = withProg({ objectives: list }, { pickems: { pending: 2, open: 2, eventId: "e", eventName: "Champions" }, packs: { unopened: 1 }, competitive: { rating: 1000, gamesPlayed: 3, wins: 2, losses: 1, draws: 0, provisional: true, position: null, rankedTotal: 9, recent: [] } });
  const items = todayItems(f);
  assert.equal(items.length, TODAY_MAX);
  const kinds = items.map((i) => i.kind);
  assert.ok(kinds.includes("pickem") && kinds.filter((k) => k === "objective").length >= 1);
});

test("HOY · no repite el destino de la acción principal", () => {
  const f = facts({ packs: { unopened: 3 } });
  const p = dailyActions(f).primary;
  assert.equal(p.href, "/inventario");
  assert.ok(!todayItems(f, p).some((i) => i.href === "/inventario"));
});

test("HOY · sin sesión, vacío", () => {
  assert.deepEqual(todayItems({ ...facts(), signedIn: false }), []);
});

/* ───────────── piezas ───────────── */

test("EQUIPO · READY / INVALID / NONE / null", () => {
  assert.equal(deckState({ total: 2, valid: 1, active: READY_DECK, firstInvalid: null }), "READY");
  assert.equal(deckState({ total: 1, valid: 0, active: null, firstInvalid: BAD_DECK }), "INVALID");
  assert.equal(deckState({ total: 0, valid: 0, active: null, firstInvalid: null }), "NONE");
  assert.equal(deckState(null), null);
});

test("FTUE · el recorrido desaparece tras la primera sesión; con equipo y sin partidas, JUEGA", () => {
  assert.equal(buildDailyLoop(facts()).journey, null);
  const deck = { total: 1, valid: 1, firstInvalid: null };
  const s = buildDailyLoop(withProg({ metrics: { ownedCards: 25, distinctCards: 20, packsOpened: 5, duelsPlayed: 0 } }, { journey: jf({ ownedCards: 25, packsOpened: 5, decks: deck }) }));
  assert.deepEqual(s.journey!.steps.map((x) => [x.id, x.done]), [["open", true], ["collect", true], ["build", true], ["play", false]]);
  assert.equal(s.primaryAction.id, "journey-play");
  const first = buildDailyLoop(withProg({ metrics: { ownedCards: 25, distinctCards: 20, packsOpened: 5, duelsPlayed: 1 } }, { journey: jf({ ownedCards: 25, packsOpened: 5, decks: deck, matchesCompleted: 1 }) }));
  assert.ok(first.journey!.isComplete && first.journey!.justCompleted);
  assert.ok(!first.primaryAction.id.startsWith("journey-"), "completa: la home vuelve al Daily Loop normal");
});

test("OBJETIVOS · cada métrica real del pool lleva a una ruta real", () => {
  const metrics = new Set(CURRENT_SEASON.missionPool.map((m) => m.metric));
  const routes = new Set<string>(Object.values(DAILY_ROUTES));
  for (const m of metrics) assert.ok(routes.has(objectiveRoute(m)), `${m} → ${objectiveRoute(m)}`);
  assert.equal(objectiveRoute("duels_won"), "/jugar");
  assert.equal(objectiveRoute("packs_opened"), "/inventario");
  assert.equal(objectiveRoute("picks_made"), "/pickems");
  assert.equal(objectiveRoute("desconocida"), "/misiones"); // IA 2026-10-07 · Temporada → Objetivos
});

test("PASE · la recompensa se describe solo con lo que la definición fija", () => {
  assert.equal(rewardLabel({ credits: 300 }, () => "x"), "300 créditos");
  assert.equal(rewardLabel({ packId: "estandar", packCount: 2 }, (id) => `Sobre ${id}`), "2 × Sobre estandar");
  assert.equal(rewardLabel({ xp: 50, cosmetics: ["t:1"] }, () => "x"), "50 XP de cuenta + un cosmético");
  assert.equal(rewardLabel({}, () => "x"), "Recompensa del pase");
});

test("DIRECTO · destacado = el que tiene partido en juego; si no, el activo; próximo = el primero programado", () => {
  const list = [ev({ id: "a", lifecycle: "ACTIVE" }), ev({ id: "b", lifecycle: "ACTIVE", liveCount: 1 }), ev({ id: "c", lifecycle: "UPCOMING" })];
  assert.equal(featuredEvents(list).featured!.id, "b");
  assert.equal(featuredEvents(list.slice(0, 1)).featured!.id, "a");
  assert.equal(featuredEvents(list).upcoming!.id, "c");
  assert.deepEqual(featuredEvents([]), { featured: null, upcoming: null });
});

test("FOTO · colección, sobres y logros vienen de los hechos, sin cifras inventadas", () => {
  const s = buildDailyLoop(facts({ packs: { unopened: 2 } }));
  assert.deepEqual(s.collection, { owned: 25, distinct: 22, catalog: 772 });
  assert.deepEqual(s.packs, { unopened: 2 });
  assert.equal(s.achievements!.total, 12);
  assert.equal(s.deck!.state, "READY");
  assert.equal(s.deck!.active!.name, "Equipo 2");
});

/* ───────────── la prioridad única (meta) ───────────── */

test("MOTOR ÚNICO · `orderToday` ordena por rango, deja uno por tipo y desempata por orden de entrada", () => {
  const mk = (id: string, kind: TodayAction["kind"], ftue?: boolean): TodayAction => ({ id, kind, label: id, detail: "", href: "/", ftue });
  const out = orderToday([mk("play-1", "play"), mk("open", "open", true), mk("play-2", "play"), mk("resume", "resume"), mk("claim", "claim")], 5);
  assert.deepEqual(out.map((a) => a.id), ["resume", "open", "claim", "play-1"]);
  assert.equal(todayRank({ kind: "open", ftue: true }), 0.5);
  assert.equal(todayRank({ kind: "open" }), 5);
});

test("MOTOR ÚNICO · la temporada y la home antigua conservan su orden (claim antes que predict)", () => {
  const actions = seasonActions({ activeDuel: false, claimable: { levels: 1, missions: 0, achievements: 0 }, pendingPicks: 2, unopenedPacks: 1, hasValidDeck: true, objectives: [], rankedGames: 0, liveEvent: null });
  assert.deepEqual(actions.map((a) => a.kind), ["claim", "predict", "open", "play"]);
  const home = todayActions({ steps: [{ id: "p", kind: "predict", label: "", detail: "", href: "/" }, { id: "c", kind: "claim", label: "", detail: "", href: "/" }], objectives: [] });
  assert.deepEqual(home.map((a) => a.kind), ["claim", "predict"]);
});

test("OBJETIVO VIVO · sin caducidad o con caducidad futura", () => {
  assert.equal(liveObjective({ expiresAt: null }, NOW), true);
  assert.equal(liveObjective({ expiresAt: NOW + 1 }, NOW), true);
  assert.equal(liveObjective({ expiresAt: NOW }, NOW), false);
});
