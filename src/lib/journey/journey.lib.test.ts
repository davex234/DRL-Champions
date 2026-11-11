/**
 * FASE 40 · PLAYER JOURNEY — PRESENTACIÓN, ARENA Y PRIMER EQUIPO (puros).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDailyLoop, type DailyLoopFacts, type LiveEventFact } from "@/domain/dailyLoop";
import { buildPlayerJourney, type JourneyFacts } from "@/domain/journey";
import { CARDS, getPlayer } from "@/data/catalog";
import { discoveryItems, homeJourneyMode, isJourneyAction, roleChips, STEP_STATE_LABEL, WELCOME_PILLARS, welcomeCards } from "./presentation";
import { initialDifficulty, isFirstMatchContext, showFirstSessionComplete } from "./arena";
import { AUTO_ACTIVATED_NOTICE, isFirstTeamContext, shouldAutoActivate } from "./deck";
import { journeyPreferenceKey } from "./preference";

const NOW = Date.parse("2026-09-20T12:00:00.000Z");
const roles = (have: number) => (["Duelista", "Controlador", "Iniciador", "Centinela", "Flex"] as const).map((role) => ({ role, have, need: 2 }));
const jf = (o: Partial<JourneyFacts> = {}): JourneyFacts => ({
  ownedCards: 0, packsOpened: 0, matchesCompleted: 0, unopenedPacks: 4, firstPackId: "inicial", decks: { total: 0, valid: 0, firstInvalid: null }, readyDeck: null,
  readiness: { ready: false, dataVersion: null, roles: roles(0), shortages: roles(0) }, ...o,
});
function facts(o: Partial<DailyLoopFacts> = {}): DailyLoopFacts {
  return {
    now: NOW, signedIn: true, catalogSize: 772, matches: [], social: { incoming: 0, from: null },
    progression: {
      account: { level: 1, xp: 0, xpIntoLevel: 0, xpForNext: 100, progress: 0 }, pass: null, claimableLevels: 0, objectives: [],
      achievements: { total: 10, claimed: 0, claimable: 0, near: null }, rotationPending: false,
      metrics: { ownedCards: 0, distinctCards: 0, packsOpened: 0, duelsPlayed: 0 },
    },
    pickems: { pending: 0, open: 0, eventId: null, eventName: null }, packs: { unopened: 4 },
    decks: { total: 0, valid: 0, active: null, firstInvalid: null },
    campaign: { completed: 0, total: 15, complete: false, next: { nodeId: "c1-n1", name: "N1", team: "LOUD", chapterOrder: 1 } },
    competitive: { rating: null, gamesPlayed: 0, wins: 0, losses: 0, draws: 0, provisional: true, position: null, rankedTotal: 10, recent: [] },
    live: [], season: { current: null, next: null }, journey: jf(), ...o,
  };
}
const ev = (e: Partial<LiveEventFact> & { id: string }): LiveEventFact => ({ name: `Evento ${e.id}`, lifecycle: "ACTIVE", isDemo: false, startDate: null, endDate: null, liveCount: 0, liveMatch: null, nextMatch: null, pickem: null, ...e });

test("JL01 · Mission Control solo cuando la acción principal es del recorrido y no se ha elegido explorar", () => {
  const snap = buildDailyLoop(facts());
  assert.equal(homeJourneyMode(snap, { dismissed: false }), "mission");
  assert.equal(homeJourneyMode(snap, { dismissed: true }), "strip", "explorar por libre: tira discreta, el paso sigue");
});

test("JL02 · partida a medias: el recorrido baja a la tira (nunca tapa CONTINUAR PARTIDA)", () => {
  const snap = buildDailyLoop(facts({ matches: [{ id: "m", mode: "PVE", difficulty: "EASY", opponent: null, node: null }] }));
  assert.equal(snap.primaryAction.id, "resume-pve");
  assert.equal(homeJourneyMode(snap, { dismissed: false }), "strip");
});

test("JL03 · Draft en combate: CONTINUAR gana y el recorrido no se pinta como héroe", () => {
  const snap = buildDailyLoop(facts({ matches: [{ id: "run", mode: "DRAFT", difficulty: null, opponent: null, node: null }] }));
  assert.equal(snap.primaryAction.id, "resume-draft");
  assert.equal(homeJourneyMode(snap, { dismissed: false }), "strip");
});

test("JL04 · tras la primera partida: «descubrir»; con más partidas o anónimo: nada", () => {
  const done = buildDailyLoop(facts({ journey: jf({ ownedCards: 20, decks: { total: 1, valid: 1, firstInvalid: null }, matchesCompleted: 1 }), decks: { total: 1, valid: 1, active: null, firstInvalid: null } }));
  assert.equal(homeJourneyMode(done, { dismissed: false }), "discovery");
  assert.equal(homeJourneyMode(done, { dismissed: true }), "discovery", "explorar no oculta el cierre");
  const vet = buildDailyLoop(facts({ journey: jf({ ownedCards: 20, matchesCompleted: 9 }) }));
  assert.equal(homeJourneyMode(vet, { dismissed: false }), "none");
  assert.equal(homeJourneyMode(buildDailyLoop({ ...facts(), signedIn: false }), { dismissed: false }), "none");
});

test("JL05 · «explorar por mi cuenta» es presentación: la foto (prioridad, pasos) es idéntica con o sin él", () => {
  const a = buildDailyLoop(facts());
  const b = buildDailyLoop(facts());
  assert.deepEqual(a, b);
  assert.equal(a.primaryAction.id, "journey-open", "la prioridad del servidor no depende de la preferencia");
  assert.ok(journeyPreferenceKey("aaaaaaaa-0000-4000-8000-000000000001").startsWith("journey-explore-"));
  assert.equal(journeyPreferenceKey("../../etc/passwd'\"<>").includes("/"), false, "clave saneada");
});

test("JL06 · durante la primera sesión no se proponen ranked, campaña ni partida rápida genérica (PvE primero, sin bloquear nada)", () => {
  const f = facts({ journey: jf({ ownedCards: 30, packsOpened: 4, unopenedPacks: 0, firstPackId: null, decks: { total: 1, valid: 1, firstInvalid: null } }), packs: { unopened: 0 }, decks: { total: 1, valid: 1, active: { id: "d", name: "E", valid: true, size: 10, sumOvr: 700 }, firstInvalid: null } });
  const s = buildDailyLoop(f);
  const ids = [s.primaryAction, ...s.secondaryActions].map((a) => a.id);
  assert.equal(ids[0], "journey-play");
  assert.ok(!ids.includes("ranked") && !ids.includes("campaign") && !ids.includes("quick"));
  // Nada se bloquea: el hub de modos sigue siendo una ruta real (no hay lock nuevo en el dominio).
  assert.ok(!JSON.stringify(s).includes("locked"));
});

test("JL07 · al completarla, el vestíbulo vuelve a proponer campaña / ranked / partida rápida como siempre", () => {
  const f = facts({ journey: jf({ ownedCards: 30, decks: { total: 1, valid: 1, firstInvalid: null }, matchesCompleted: 1 }), decks: { total: 1, valid: 1, active: { id: "d", name: "E", valid: true, size: 10, sumOvr: 700 }, firstInvalid: null }, packs: { unopened: 0 } });
  const ids = [buildDailyLoop(f).primaryAction, ...buildDailyLoop(f).secondaryActions].map((a) => a.id);
  assert.ok(ids.includes("campaign"));
  assert.ok(!ids.some(isJourneyAction));
});

test("JL08 · estado de cada paso en TEXTO (Hecho · Ahora · Después), no solo color", () => {
  const j = buildPlayerJourney(jf({ ownedCards: 5, packsOpened: 1 }));
  assert.deepEqual(j.steps.map(STEP_STATE_LABEL), ["Hecho", "Ahora", "Después", "Después"]);
});

test("JL09 · bienvenida: tres pilares cortos y tres cartas REALES del catálogo de roles distintos, deterministas", () => {
  assert.deepEqual(WELCOME_PILLARS.map((p) => p.verb), ["Colecciona", "Construye", "Compite"]);
  assert.ok(WELCOME_PILLARS.every((p) => p.line.length < 60));
  const a = welcomeCards(CARDS, getPlayer);
  const b = welcomeCards([...CARDS].reverse(), getPlayer);
  assert.equal(a.length, 3);
  assert.deepEqual(a.map((c) => c.id), b.map((c) => c.id));
  assert.equal(new Set(a.map((c) => c.role ?? getPlayer(c.playerId)!.role)).size, 3);
  assert.ok(a.every((c) => CARDS.includes(c) && !!c.combat));
});

test("JL10 · chips de roles con denominador (Flex 0/2) y marca de completo", () => {
  const j = buildPlayerJourney(jf({ ownedCards: 5, readiness: { ready: false, dataVersion: "V", roles: [{ role: "Duelista", have: 2, need: 2 }, { role: "Controlador", have: 1, need: 2 }, { role: "Iniciador", have: 0, need: 2 }, { role: "Centinela", have: 0, need: 2 }, { role: "Flex", have: 0, need: 2 }], shortages: [] } }));
  const chips = roleChips(j);
  assert.equal(chips.length, 5);
  assert.deepEqual(chips[0], { role: "Duelista", label: "Duelista 2/2", complete: true });
  assert.equal(chips[4].label, "Flex 0/2");
});

test("JL11 · destinos: cinco reales; el directo SOLO con un partido en directo de verdad (sin «live» inventado)", () => {
  const base = buildDailyLoop(facts());
  assert.equal(discoveryItems(base).length, 5);
  const upcoming = buildDailyLoop(facts({ live: [ev({ id: "u", lifecycle: "UPCOMING" }), ev({ id: "a", lifecycle: "ACTIVE", liveCount: 0 })] }));
  assert.equal(discoveryItems(upcoming).length, 5);
  const live = buildDailyLoop(facts({ live: [ev({ id: "l", lifecycle: "ACTIVE", liveCount: 2 })] }));
  const items = discoveryItems(live);
  assert.equal(items.length, 6);
  assert.equal(items[5].href, "/torneos/l");
  const demo = buildDailyLoop(facts({ live: [ev({ id: "demo", lifecycle: "ACTIVE", liveCount: 3, isDemo: true })] }));
  assert.equal(discoveryItems(demo).length, 5, "un evento de demostración no se anuncia como directo (medido en real)");
});

test("JL12 · arena: ?dificultad=EASY solo preselecciona; valores raros → NORMAL de siempre", () => {
  assert.equal(initialDifficulty("EASY"), "EASY");
  assert.equal(initialDifficulty("HARD"), "HARD");
  assert.equal(initialDifficulty(null), "NORMAL");
  assert.equal(initialDifficulty("easy"), "NORMAL");
  assert.equal(initialDifficulty("TUTORIAL"), "NORMAL", "no existe un bot tutorial");
  assert.equal(isFirstMatchContext("1"), true);
  assert.equal(isFirstMatchContext("true"), false);
});

test("JL13 · «Primera sesión completada» en el resultado SOLO si el servidor lo dice (no por la URL)", () => {
  assert.equal(showFirstSessionComplete(null), false);
  assert.equal(showFirstSessionComplete({ isComplete: false, justCompleted: false }), false);
  assert.equal(showFirstSessionComplete({ isComplete: true, justCompleted: false }), false);
  assert.equal(showFirstSessionComplete({ isComplete: true, justCompleted: true }), true);
});

test("JL15 · RESULTADO ÚNICO: el resultado ya no relee el vestíbulo; la guía se invalida para que el vestíbulo la relea", () => {
  const src = require("node:fs").readFileSync(require("node:path").join(process.cwd(), "src/app/duelos/jugar/page.tsx"), "utf8") as string;
  assert.ok(!src.includes("fetchDailyLoop") && !src.includes("showFirstSessionComplete"), "el resultado no apila «Primera sesión completada»");
  assert.ok(src.includes("invalidateOnboarding();"), "la partida terminada mueve la guía; las demás pantallas releen al volver");
});

test("JL14 · primer equipo: se activa solo si es el PRIMER legal y no hay activo; nunca un guardado inválido", () => {
  assert.equal(shouldAutoActivate({ savedValid: true, activeSupported: true, activeDeckId: null, otherValidDecks: 0 }), true);
  assert.equal(shouldAutoActivate({ savedValid: false, activeSupported: true, activeDeckId: null, otherValidDecks: 0 }), false);
  assert.equal(shouldAutoActivate({ savedValid: true, activeSupported: true, activeDeckId: "x", otherValidDecks: 0 }), false);
  assert.equal(shouldAutoActivate({ savedValid: true, activeSupported: true, activeDeckId: null, otherValidDecks: 1 }), false);
  assert.equal(shouldAutoActivate({ savedValid: true, activeSupported: false, activeDeckId: null, otherValidDecks: 0 }), false);
  assert.match(AUTO_ACTIVATED_NOTICE, /activado/, "la activación automática se dice en pantalla");
  assert.equal(isFirstTeamContext([]), true);
  assert.equal(isFirstTeamContext([{ valid: false }]), true);
  assert.equal(isFirstTeamContext([{ valid: false }, { valid: true }]), false);
});
