/**
 * FASE 55 · COMPETITIVO 4.0 — dominio puro del ranked (`ranked.ts`).
 * Escalera como rango, colocación, ascenso/descenso por puestos, puerta de juego, carril del pase,
 * récord de temporada desde el libro y paginación acotada.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  ladderStanding, positionLabel, rankedMovement, movementLabel, rankedGate, deckIssues, editDeckHref, rankedPlayHref,
  rewardsLane, seasonRecord, ladderPage, matchupEdge, LADDER_PAGE, LADDER_PAGE_MAX, PLACEMENT_GAMES, RANKED_RIVAL_KIND,
  type StandingEntry, type ReadinessDeck, type SeasonRatingEvent,
} from "./ranked";

const row = (position: number, rating: number, isSelf = false): StandingEntry => ({ position, rating, username: isSelf ? "yo" : `p${position}`, isSelf });

/* ─────────────── escalera: rango anterior → actual → siguiente ─────────────── */

test("R1 · sin partidas: SIN CLASIFICAR, sin vecinos ni progreso, colocación 0/10", () => {
  const s = ladderStanding({ rating: 1000, gamesPlayed: 0, position: null, rankedTotal: 40, pointsToAbove: null }, []);
  assert.equal(s.state, "UNRANKED");
  assert.equal(s.above, null); assert.equal(s.below, null); assert.equal(s.progress, null);
  assert.deepEqual(s.placement, { played: 0, total: PLACEMENT_GAMES, remaining: 10 });
  assert.equal(positionLabel(s.position), "Sin clasificar");
});

test("R2 · en colocación (1..9 partidas) es PLACEMENT aunque ya tenga puesto; a 10 pasa a RANKED", () => {
  assert.equal(ladderStanding({ rating: 1040, gamesPlayed: 4, position: 7, rankedTotal: 20, pointsToAbove: 3 }, []).state, "PLACEMENT");
  assert.equal(ladderStanding({ rating: 1040, gamesPlayed: 9, position: 7, rankedTotal: 20, pointsToAbove: 3 }, []).state, "PLACEMENT");
  assert.equal(ladderStanding({ rating: 1040, gamesPlayed: 10, position: 7, rankedTotal: 20, pointsToAbove: 3 }, []).state, "RANKED");
  assert.equal(ladderStanding({ rating: 1040, gamesPlayed: 57, position: 7, rankedTotal: 20, pointsToAbove: 3 }, []).placement.played, 10, "la colocación se satura en 10");
});

test("R3 · vecinos reales de la ventana: de delante con el hueco del servidor, de detrás con la ventaja", () => {
  const rows = [row(4, 1060), row(5, 1041), row(6, 1030, true), row(7, 1012)];
  const s = ladderStanding({ rating: 1030, gamesPlayed: 22, position: 6, rankedTotal: 50, pointsToAbove: 12 }, rows);
  assert.deepEqual(s.above, { position: 5, rating: 1041, username: "p5", gap: 12 });
  assert.deepEqual(s.below, { position: 7, rating: 1012, username: "p7", lead: 18 });
  // (1030 − 1012) / (1041 + 1 − 1012) = 18 / 30
  assert.equal(s.progress, 18 / 30);
});

test("R4 · #1: sin «siguiente rango», isFirst; último: sin «anterior»; vecino ausente NO se inventa", () => {
  const first = ladderStanding({ rating: 1300, gamesPlayed: 30, position: 1, rankedTotal: 9, pointsToAbove: null }, [row(1, 1300, true), row(2, 1200)]);
  assert.equal(first.isFirst, true); assert.equal(first.above, null); assert.equal(first.below?.position, 2); assert.equal(first.progress, null);
  const last = ladderStanding({ rating: 980, gamesPlayed: 12, position: 9, rankedTotal: 9, pointsToAbove: 4 }, [row(8, 983), row(9, 980, true)]);
  assert.equal(last.below, null); assert.equal(last.above?.gap, 4);
  const hole = ladderStanding({ rating: 1100, gamesPlayed: 12, position: 40, rankedTotal: 90, pointsToAbove: null }, [row(1, 1500)]);
  assert.equal(hole.above, null); assert.equal(hole.below, null, "sin la fila, no hay vecino");
});

test("R5 · empate de rating con el de detrás: progreso 0 (no negativo) y ventaja 0", () => {
  const s = ladderStanding({ rating: 1187, gamesPlayed: 20, position: 6, rankedTotal: 50, pointsToAbove: 1 }, [row(5, 1187), row(7, 1187)]);
  assert.equal(s.below?.lead, 0); assert.equal(s.progress, 0);
});

test("R6 · nunca «#0»", () => {
  assert.equal(positionLabel(0), "Sin clasificar");
  assert.equal(positionLabel(-3), "Sin clasificar");
  assert.equal(positionLabel(12), "#12");
});

/* ─────────────── ascenso / descenso / entrada / colocación ─────────────── */

test("M1 · ascenso: ganar puestos es PROMOTION con ceremonia; descenso: DEMOTION se dice", () => {
  const up = rankedMovement({ rating: 1201, position: 14, gamesPlayed: 20 }, { rating: 1219, position: 11, gamesPlayed: 21 });
  assert.deepEqual([up.kind, up.from, up.to, up.positions, up.ceremony], ["PROMOTION", 14, 11, 3, "PROMOTION"]);
  assert.equal(movementLabel(up), "Subes 3 puestos");
  const down = rankedMovement({ rating: 1219, position: 11, gamesPlayed: 21 }, { rating: 1205, position: 12, gamesPlayed: 22 });
  assert.deepEqual([down.kind, down.positions, down.ceremony], ["DEMOTION", -1, "DEMOTION"]);
  assert.equal(movementLabel(down), "Bajas 1 puesto");
});

test("M2 · mismo puesto: HOLD sin ceremonia", () => {
  const m = rankedMovement({ rating: 1000, position: 3, gamesPlayed: 30 }, { rating: 1000, position: 3, gamesPlayed: 31 });
  assert.equal(m.kind, "HOLD"); assert.equal(m.ceremony, null); assert.equal(movementLabel(m), "Mantienes tu puesto");
});

test("M3 · primera partida: de «Sin clasificar» a #N es ENTERED", () => {
  const m = rankedMovement({ rating: 1000, position: null, gamesPlayed: 0 }, { rating: 1020, position: 17, gamesPlayed: 1 });
  assert.equal(m.kind, "ENTERED"); assert.equal(m.ceremony, "ENTERED"); assert.equal(m.to, 17);
});

test("M4 · la partida 10 cierra la colocación: ceremonia PLACED aunque baje o se mantenga", () => {
  const m = rankedMovement({ rating: 1080, position: 9, gamesPlayed: 9 }, { rating: 1066, position: 10, gamesPlayed: 10 });
  assert.equal(m.placementDone, true); assert.equal(m.kind, "DEMOTION"); assert.equal(m.ceremony, "PLACED");
  const after = rankedMovement({ rating: 1066, position: 10, gamesPlayed: 10 }, { rating: 1090, position: 8, gamesPlayed: 11 });
  assert.equal(after.placementDone, false, "solo la partida que la cierra");
});

test("M5 · sin foto previa (recarga a mitad) NO se afirma movimiento", () => {
  const m = rankedMovement(null, { rating: 1100, position: 5, gamesPlayed: 12 });
  assert.equal(m.kind, "UNKNOWN"); assert.equal(m.positions, null); assert.equal(m.ceremony, null); assert.equal(movementLabel(m), null);
});

/* ─────────────── puerta de juego y mazo ─────────────── */

const deck = (id: string, valid: boolean, errors: string[] = []): ReadinessDeck => ({ id, name: `Mazo ${id}`, valid, errors: errors.map((message) => ({ message })), cards: [] });

test("G1 · sin cuenta: SIGN_IN; con partida viva: RESUME (antes que el mazo)", () => {
  assert.equal(rankedGate({ signedIn: false, decks: [deck("a", true)], activeDeckId: "a" }).kind, "SIGN_IN");
  assert.deepEqual(rankedGate({ signedIn: true, decks: [], activeDeckId: null, activeMatchId: "m1" }), { kind: "RESUME", matchId: "m1" });
});

test("G2 · elección de mazo: elegido legal → activo legal → primer legal", () => {
  const ds = [deck("a", true), deck("b", true), deck("c", false, ["x"])];
  assert.equal((rankedGate({ signedIn: true, decks: ds, activeDeckId: "b", chosenId: "a" }) as { deck: ReadinessDeck }).deck.id, "a");
  assert.equal((rankedGate({ signedIn: true, decks: ds, activeDeckId: "b" }) as { deck: ReadinessDeck }).deck.id, "b");
  assert.equal((rankedGate({ signedIn: true, decks: ds, activeDeckId: "c", chosenId: "c" }) as { deck: ReadinessDeck }).deck.id, "a", "un elegido ilegal no se propone");
});

test("G3 · sin mazos: NO_DECKS; todos ilegales: explica el activo con los mensajes del validador", () => {
  assert.equal(rankedGate({ signedIn: true, decks: [], activeDeckId: null }).kind, "NO_DECKS");
  const g = rankedGate({ signedIn: true, decks: [deck("a", false, ["Te faltan 2"]), deck("b", false, ["Necesitas 2 cartas de Duelista; ahora tienes 1.", "Necesitas 2 cartas de Duelista; ahora tienes 1."])], activeDeckId: "b" });
  assert.equal(g.kind, "INVALID_DECK");
  if (g.kind === "INVALID_DECK") { assert.equal(g.deck.id, "b"); assert.deepEqual(g.issues, ["Necesitas 2 cartas de Duelista; ahora tienes 1."], "sin duplicados"); }
});

test("G4 · un mazo ilegal sin mensajes igual se explica; máximo 4 frases", () => {
  assert.equal(deckIssues(deck("a", false)).length, 1);
  assert.equal(deckIssues(deck("a", false, ["1", "2", "3", "4", "5", "6"])).length, 4);
});

test("G5 · enlaces: editar ESE mazo y jugar con ese mazo (sin rating ni rival en la URL)", () => {
  assert.equal(editDeckHref("abc"), "/duelos/mazos?deck=abc");
  assert.equal(editDeckHref(null), "/duelos/mazos?nuevo=1");
  const href = rankedPlayHref("00000000-0000-4000-8000-000000000001");
  assert.equal(href, "/duelos/pvp?buscar=00000000-0000-4000-8000-000000000001");
  assert.ok(!/rating|rival|opponent|winner|delta/i.test(href));
});

/* ─────────────── carril del pase ─────────────── */

test("L1 · carril competitivo: 78 / 400 → faltan 322 (el requisito llega por parámetro, no hardcodeado)", () => {
  const l = rewardsLane({ unlocked: false, points: 78, minPoints: 400 });
  assert.equal(l.remaining, 322); assert.equal(l.progress, 78 / 400); assert.equal(l.unlocked, false);
  assert.equal(rewardsLane({ unlocked: false, points: 78, minPoints: 250 }).remaining, 172);
  assert.deepEqual([rewardsLane({ unlocked: true, points: 430, minPoints: 400 }).remaining, rewardsLane({ unlocked: true, points: 430, minPoints: 400 }).progress], [0, 1]);
});

/* ─────────────── temporada desde el libro ─────────────── */

const ev = (at: number, result: SeasonRatingEvent["result"], oldRating: number, delta: number): SeasonRatingEvent => ({ createdAt: at, result, oldRating, delta, newRating: oldRating + delta });

test("S1 · récord de la temporada: solo asientos dentro de [inicio, fin), neto, mejor y de dónde partió", () => {
  const win = { startsAtMs: 1000, endsAtMs: 2000 };
  const events = [ev(900, "WIN", 990, 10), ev(1000, "WIN", 1000, 20), ev(1500, "LOSS", 1020, -15), ev(1600, "DRAW", 1005, 0), ev(2000, "WIN", 1005, 30)];
  const r = seasonRecord(events, win);
  assert.deepEqual([r.matches, r.wins, r.losses, r.draws, r.net, r.best, r.start], [3, 1, 1, 1, 5, 1020, 1000]);
  assert.equal(r.winrate, 33);
});

test("S2 · sin partidas en la temporada: ceros y nulos, nunca NaN", () => {
  const r = seasonRecord([], { startsAtMs: 0, endsAtMs: 10 });
  assert.deepEqual([r.matches, r.winrate, r.best, r.start, r.net], [0, null, null, null, 0]);
});

/* ─────────────── clasificación paginada ─────────────── */

test("P1 · página acotada: tamaño por defecto 25, máximo 50, offset alineado y nunca fuera del total", () => {
  assert.equal(ladderPage(undefined, 500).size, LADDER_PAGE);
  assert.equal(ladderPage(0, 500, 9999).size, LADDER_PAGE_MAX);
  assert.equal(ladderPage(-10, 500).offset, 0);
  assert.equal(ladderPage(37, 500).offset, 25, "se alinea a la página");
  assert.equal(ladderPage(10_000, 60).offset, 50, "más allá del total → última página");
  assert.equal(ladderPage("abc", 60).offset, 0);
  const p = ladderPage(25, 60);
  assert.deepEqual([p.hasPrev, p.hasNext], [true, true]);
  assert.equal(p.pageOf(124), 100); assert.equal(p.pageOf(1), 0);
  assert.equal(ladderPage(0, 0).hasNext, false);
});

/* ─────────────── rival ─────────────── */

test("V1 · rival humano siempre; ventaja contada desde tu lado", () => {
  assert.equal(RANKED_RIVAL_KIND, "HUMAN");
  const you = { username: "yo", avatar: "🎮", rating: 1200, gamesPlayed: 20, position: 30 };
  assert.equal(matchupEdge(you, { ...you, username: "r", rating: 1234 }).label, "Rival +34 de rating");
  assert.equal(matchupEdge(you, { ...you, username: "r", rating: 1188 }).label, "Tú +12 de rating");
  assert.equal(matchupEdge(you, { ...you, username: "r" }).label, "Mismo rating");
});
