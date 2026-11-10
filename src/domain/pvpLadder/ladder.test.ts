/**
 * LADDER PvP · DOMINIO (Fase 28) — tests 1–10 (escalera), 11–20 (historial), 21–29 (estadísticas),
 * 30–33 (post-partida). Puro: sin base de datos; la fórmula de rating no se toca ni se reproduce.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  compareLadder, sortLadder, positionOf, rankedAbove, percentile, aroundWindow, dedupeAround, LIMITS, clampLimit,
  outcomeFor, letterOf, countsForRecord, recentForm, streak, winrate, headToHead, ratingSeries, highestRating, seriesSummary,
  cardPerformance, positionDelta, positionChangeLabel, competitiveHint, isRanked, PLACEMENT_GAMES, INITIAL_RATING,
  type LadderRow, type MatchFacts,
} from "./ladder";

const row = (userId: string, rating: number, updatedAt = 1000, gamesPlayed = 5): LadderRow =>
  ({ userId, rating, gamesPlayed, wins: 0, losses: 0, draws: 0, updatedAt });

/* ─────────────── escalera ─────────────── */

test("1 · rating descendente manda", () => {
  const s = sortLadder([row("a", 1000), row("b", 1200), row("c", 1100)]);
  assert.deepEqual(s.map((r) => r.userId), ["b", "c", "a"]);
});

test("2 · empate estable y documentado: mismo rating → quien lo alcanzó antes → id ascendente", () => {
  const s = sortLadder([row("z", 1100, 500), row("a", 1100, 900), row("m", 1100, 500)]);
  assert.deepEqual(s.map((r) => r.userId), ["m", "z", "a"]);
  assert.equal(compareLadder(row("x", 1100, 1), row("x", 1100, 1)), 0, "determinista");
});

test("3 · la posición propia es 1-based y coincide con «cuántos van delante» + 1", () => {
  const rows = [row("a", 1000, 10), row("b", 1300), row("c", 1000, 5), row("me", 1000, 7)];
  const s = sortLadder(rows);
  assert.equal(positionOf(s, "me"), 3);
  assert.equal(rankedAbove(rows, row("me", 1000, 7)) + 1, 3);
});

test("4 · sin partidas no hay posición: nunca #0", () => {
  const s = sortLadder([row("a", 1000, 1, 0), row("b", 1000, 1, 3)]);
  assert.equal(positionOf(s, "a"), null);
  assert.equal(isRanked({ gamesPlayed: 0 }), false);
  assert.notEqual(positionOf(s, "b"), 0);
});

test("5 · top N acotado por límites", () => {
  assert.equal(clampLimit(undefined, LIMITS.top, LIMITS.topMax), 25);
  assert.equal(clampLimit(500, LIMITS.top, LIMITS.topMax), 50);
  assert.equal(clampLimit(0, LIMITS.top, LIMITS.topMax), 1);
  assert.equal(clampLimit(35, LIMITS.history, LIMITS.historyMax), 20);
});

test("6 · la ventana «alrededor de mí» son 3 arriba y 3 abajo, recortada en los bordes", () => {
  assert.deepEqual(aroundWindow(124, 500), { from: 120, to: 127 });
  assert.deepEqual(aroundWindow(1, 500), { from: 0, to: 4 });
  assert.deepEqual(aroundWindow(500, 500), { from: 496, to: 500 });
});

test("7 · quien ya está en el top no se repite en «alrededor»", () => {
  const top = [{ userId: "a" }, { userId: "b" }];
  assert.deepEqual(dedupeAround(top, [{ userId: "b" }, { userId: "c" }, { userId: "me" }]).map((r) => r.userId), ["c", "me"]);
});

test("8 · población pequeña: sin percentil; con población suficiente, Top N %", () => {
  assert.equal(percentile(1, 5), null);
  assert.equal(percentile(2, 20), 10);
  assert.equal(percentile(1, 100), 1);
  assert.equal(percentile(null, 100), null);
  assert.equal(percentile(200, 100), null);
});

test("9 · un solo jugador: es el #1 de 1, sin percentil", () => {
  const s = sortLadder([row("solo", 1000)]);
  assert.equal(positionOf(s, "solo"), 1);
  assert.equal(percentile(1, 1), null);
});

/* ─────────────── historial ─────────────── */

const facts = (over: Partial<MatchFacts> = {}): MatchFacts =>
  ({ status: "COMPLETED", winner: "A", closedReason: null, closedBy: null, playerAId: "me", playerBId: "rival", ...over });

test("11+12+13 · victoria, derrota y empate desde el bando del espectador", () => {
  assert.equal(outcomeFor(facts(), "me"), "WIN");
  assert.equal(outcomeFor(facts(), "rival"), "LOSS");
  assert.equal(outcomeFor(facts({ status: "DRAW", winner: null }), "me"), "DRAW");
  assert.equal(outcomeFor(facts({ winner: "B" }), "me"), "LOSS");
});

test("14+15 · abandono y tiempo agotado nombran lo que pasó; en curso no cuenta", () => {
  assert.equal(outcomeFor(facts({ status: "IN_PROGRESS", winner: null, closedReason: "ABANDONED", closedBy: "me" }), "me"), "ABANDON_LOSS");
  assert.equal(outcomeFor(facts({ status: "IN_PROGRESS", winner: null, closedReason: "ABANDONED", closedBy: "rival" }), "me"), "ABANDON_WIN");
  assert.equal(outcomeFor(facts({ status: "IN_PROGRESS", winner: null, closedReason: "EXPIRED", closedBy: "me" }), "me"), "TIMEOUT_LOSS");
  assert.equal(outcomeFor(facts({ status: "IN_PROGRESS", winner: null }), "me"), "IN_PROGRESS");
  assert.equal(countsForRecord("IN_PROGRESS"), false);
  assert.equal(countsForRecord("UNRESOLVED"), false);
  assert.equal(letterOf("TIMEOUT_WIN"), "W");
  assert.equal(outcomeFor(facts(), "nadie"), "UNRESOLVED", "un tercero no tiene desenlace");
});

test("16 · la evolución de rating sale de los asientos (old → new), del más antiguo al más reciente", () => {
  const s = ratingSeries([
    { matchId: "m2", createdAt: 200, newRating: 1018, delta: 18, result: "WIN" },
    { matchId: "m1", createdAt: 100, newRating: 1000, delta: -12, result: "LOSS" },
  ]);
  assert.deepEqual(s.map((p) => [p.matchId, p.rating, p.delta]), [["m1", 1000, -12], ["m2", 1018, 18]]);
  assert.match(seriesSummary(s), /2 partidas: de 1012 a 1018 \(\+6\), mínimo 1000, máximo 1018/);
  assert.equal(seriesSummary([]), "Sin partidas liquidadas todavía.");
});

/* ─────────────── estadísticas ─────────────── */

test("25 · winrate = victorias / partidas terminadas; sin partidas no hay winrate", () => {
  assert.equal(winrate(7, 3, 0), 70);
  assert.equal(winrate(1, 1, 1), 33);
  assert.equal(winrate(0, 0, 0), null);
});

test("26+27 · forma reciente y racha derivadas del historial real, más reciente primero", () => {
  const form = recentForm(["WIN", "WIN", "IN_PROGRESS", "LOSS", "DRAW", "TIMEOUT_WIN"], 10);
  assert.deepEqual(form, ["W", "W", "L", "D", "W"]);
  assert.deepEqual(streak(form), { kind: "W", n: 2 });
  assert.deepEqual(streak(["L", "L", "L", "W"]), { kind: "L", n: 3 });
  assert.equal(streak([]), null);
});

test("28 · cara a cara: solo partidas entre los dos, desde mi perspectiva", () => {
  const ms: MatchFacts[] = [
    facts(), facts({ playerAId: "rival", playerBId: "me" }), facts({ status: "DRAW", winner: null }),
    facts({ playerBId: "otro" }), facts({ status: "IN_PROGRESS", winner: null }),
  ];
  assert.deepEqual(headToHead(ms, "me", "rival"), { wins: 1, losses: 1, draws: 1 });
});

test("29 · rating máximo solo del libro completo; sin asientos no se inventa", () => {
  assert.equal(highestRating([]), null);
  assert.equal(highestRating([980, 1040, 1012]), 1040);
  assert.equal(highestRating([900]), INITIAL_RATING, "nunca por debajo del inicial real");
});

test("cartas · más usada y con más turnos ganados, solo de mis partidas", () => {
  const p = cardPerformance([
    { uid: "u1", cardId: "aspas", nick: "aspas", won: true }, { uid: "u1", cardId: "aspas", nick: "aspas", won: false },
    { uid: "u2", cardId: "trent", nick: "trent", won: true }, { uid: "u2", cardId: "trent", nick: "trent", won: true },
    { uid: "u3", cardId: "neon", nick: "neon", won: false }, { uid: "u3", cardId: "neon", nick: "neon", won: false }, { uid: "u3", cardId: "neon", nick: "neon", won: false },
  ]);
  assert.equal(p.mostUsed?.cardId, "neon");
  assert.equal(p.mostWinning?.cardId, "trent");
  assert.deepEqual(cardPerformance([]), { mostUsed: null, mostWinning: null, all: [] });
});

/* ─────────────── post-partida ─────────────── */

test("31+32+33 · el cambio de puestos solo con dos fotos; la posición actual siempre", () => {
  assert.equal(positionDelta(182, 169), 13);
  assert.equal(positionChangeLabel(182, 169), "Subes 13 puestos");
  assert.equal(positionChangeLabel(10, 11), "Bajas 1 puesto");
  assert.equal(positionChangeLabel(5, 5), "Mantienes tu puesto");
  assert.equal(positionChangeLabel(null, 12), null);
  assert.equal(positionDelta(12, null), null);
});

test("home · la frase solo dice lo derivable; provisional cuenta partidas reales", () => {
  assert.equal(competitiveHint({ position: null, total: 0, provisional: true, gamesPlayed: 0, pointsToAbove: null }), null);
  assert.equal(competitiveHint({ position: 40, total: 80, provisional: true, gamesPlayed: 4, pointsToAbove: 3 }), `Provisional: 4 de ${PLACEMENT_GAMES} partidas para clasificarte`);
  assert.equal(competitiveHint({ position: 124, total: 500, provisional: false, gamesPlayed: 20, pointsToAbove: 9 }), "Estás #124 · te faltan 9 puntos para pasar al siguiente");
  assert.equal(competitiveHint({ position: 1, total: 500, provisional: false, gamesPlayed: 20, pointsToAbove: null }), "Estás #1 de 500");
});
