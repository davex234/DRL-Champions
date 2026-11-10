/**
 * CORE GAMEPLAY 2.0 · AYUDANTES DE PRESENTACIÓN (Fase 26) — `lib/duel/gameplayUx`.
 *
 * Dominio de PANTALLA: traduce lo que el servidor ya decidió. Aquí se comprueba que la traducción
 * es fiel (lee `valid`/`missingByRole`/`outcome`/`decidedBy`, nunca recalcula) y que los textos
 * dicen lo que el brief pide: roles que faltan, nombres reales de las estadísticas, desempate
 * explicado solo cuando ocurre, carta destacada elegida sobre el historial.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  deckReadiness, pickStartableDeck, roundVerdict, lockCopy, decisionCopy, featuredCard, roundTally,
  introDuration, INTRO_MS, introCopy, connectionCopy, mmss,
} from "./gameplayUx";
import type { DuelDeckDTO, DuelTurnView } from "./types";

const ROLES = { Duelista: 0, Controlador: 0, Iniciador: 0, Centinela: 0, Flex: 0 };
const deck = (over: Partial<DuelDeckDTO>): DuelDeckDTO => ({
  id: "d", name: "Mazo", cardUids: [], cards: [], valid: true, status: "READY_FOR_DUEL",
  roleCounts: { ...ROLES }, missingByRole: { ...ROLES }, errors: [], sumOvr: 800, updatedAt: 0, ...over,
} as DuelDeckDTO);

const turn = (outcome: DuelTurnView["outcome"], you: number, rival: number, n = 1): DuelTurnView => ({
  number: n, attacker: "A", outcome, scoreAfterYou: 0, scoreAfterRival: 0, reason: "",
  you: { uid: `y${n}`, nick: "Yo", team: "T", role: "Duelista", stat: "stronghold", value: you },
  rival: { uid: `r${n}`, nick: "Él", team: "R", role: "Flex", stat: "gamesense", value: rival },
});

/* ─────────────── pre-partida ─────────────── */

test("1 · un mazo válido está listo y no lista roles", () => {
  const r = deckReadiness(deck({ valid: true }));
  assert.equal(r.ready, true);
  assert.deepEqual(r.missing, []);
  assert.equal(r.summary, "Listo para jugar");
});

test("2 · un mazo inválido enseña los roles que faltan, en el orden del dominio y en castellano", () => {
  const r = deckReadiness(deck({ valid: false, status: "INCOMPLETE", missingByRole: { ...ROLES, Centinela: 2, Duelista: 1, Flex: 1 } }));
  assert.equal(r.ready, false);
  assert.deepEqual(r.missing.map((m) => m.role), ["Duelista", "Centinela", "Flex"]);
  assert.equal(r.summary, "Faltan 1 Duelista, 2 Centinelas y 1 Flex");
  assert.equal(deckReadiness(deck({ valid: false, missingByRole: { ...ROLES, Iniciador: 1 } })).summary, "Falta 1 Iniciador");
});

test("3 · un mazo inválido sin roles que falten usa el motivo que ya redactó el servidor", () => {
  const r = deckReadiness(deck({ valid: false, errors: [{ code: "DUPLICATE_PLAYER" as never, message: "Hay un jugador repetido" }] }));
  assert.equal(r.ready, false);
  assert.equal(r.summary, "Hay un jugador repetido");
});

test("4 · el mazo con el que se entra: el preferido si es legal, si no el primero legal, si no ninguno", () => {
  const a = deck({ id: "a", valid: false }), b = deck({ id: "b", valid: true }), c = deck({ id: "c", valid: true });
  assert.equal(pickStartableDeck([a, b, c], "c")?.id, "c");
  assert.equal(pickStartableDeck([a, b, c], "a")?.id, "b");
  assert.equal(pickStartableDeck([a], "a"), null);
});

/* ─────────────── turno ─────────────── */

test("5 · el veredicto del turno se lee de `outcome` y nombra las estadísticas por su nombre real", () => {
  const w = roundVerdict(turn("A", 78, 71));
  assert.equal(w.kind, "win");
  assert.equal(w.title, "Ganas el turno");
  assert.equal(w.detail, "Stronghold 78 contra Gamesense 71");
  assert.equal(w.note, null);
  const l = roundVerdict(turn("B", 60, 71));
  assert.equal(l.kind, "loss");
  assert.equal(l.title, "Pierdes el turno");
});

test("6 · el empate de turno es un resultado válido: nadie puntúa y se explica", () => {
  const d = roundVerdict(turn("TIE", 70, 70));
  assert.equal(d.kind, "draw");
  assert.equal(d.title, "Empate");
  assert.match(d.note ?? "", /nadie recibe punto/);
});

test("7 · el cerrojo de la jugada: en vuelo y turno del rival bloquean; el resto es la máquina de estados de siempre", () => {
  assert.deepEqual(lockCopy({ busy: true, waitingRival: false, attacking: true, hasCard: true, hasStat: true }).locked, true);
  assert.equal(lockCopy({ busy: true, waitingRival: false, attacking: true, hasCard: true, hasStat: true }).button, "Resolviendo…");
  const w = lockCopy({ busy: false, waitingRival: true, attacking: false, hasCard: false, hasStat: false });
  assert.equal(w.locked, true);
  assert.equal(w.button, "Esperando al rival…");
  assert.equal(lockCopy({ busy: false, waitingRival: false, attacking: true, hasCard: false, hasStat: false }).button, "Elige una carta");
  assert.equal(lockCopy({ busy: false, waitingRival: false, attacking: true, hasCard: true, hasStat: false }).button, "Elige una estadística");
  assert.equal(lockCopy({ busy: false, waitingRival: false, attacking: true, hasCard: true, hasStat: true }).button, "Declarar y atacar");
  assert.equal(lockCopy({ busy: false, waitingRival: false, attacking: false, hasCard: true, hasStat: false }).button, "Responder");
  assert.equal(lockCopy({ busy: false, waitingRival: false, attacking: false, hasCard: true, hasStat: false }).locked, false);
});

/* ─────────────── final ─────────────── */

const base = { scoreYou: 5, scoreRival: 5, sumOvrYou: 812, sumOvrRival: 798, statTotalYou: 700, statTotalRival: 690, tiedEncounters: 0 };

test("8 · por marcador no hay nada que explicar", () => {
  const d = decisionCopy({ ...base, decidedBy: "SCORE" });
  assert.equal(d.tiebreak, false);
  assert.deepEqual(d.lines, []);
});

test("9 · el desempate por suma de OVR se explica con las cifras del servidor y dice que otorga un punto", () => {
  const d = decisionCopy({ ...base, decidedBy: "OVR_TIEBREAK", scoreYou: 6, tiedEncounters: 2 });
  assert.equal(d.tiebreak, true);
  assert.equal(d.title, "Desempate por suma de OVR");
  assert.match(d.lines.join(" "), /812 contra 798/);
  assert.match(d.lines.join(" "), /otorga un punto/);
  assert.match(d.lines.join(" "), /6–5/);
  assert.match(d.lines.join(" "), /2 turnos empatados/);
});

test("10 · el desempate por estadística total no otorga punto, y el empate total es un resultado", () => {
  const s = decisionCopy({ ...base, decidedBy: "STAT_MARGIN" });
  assert.match(s.lines.join(" "), /700 contra 690/);
  assert.match(s.lines.join(" "), /no otorga punto/);
  const n = decisionCopy({ ...base, decidedBy: "NONE" });
  assert.equal(n.title, "Empate total");
});

test("11 · la carta destacada es la que ganó por más margen; a igualdad, la de mayor valor", () => {
  const h = [turn("A", 80, 70, 1), turn("A", 90, 60, 2), turn("B", 50, 88, 3), turn("A", 85, 60, 4)];
  const f = featuredCard(h)!;
  assert.equal(f.uid, "y2");
  assert.equal(f.turn, 2);
  assert.equal(f.margin, 30);
  assert.match(f.why, /Ganó el turno 2 con Stronghold 90 contra 60/);
});

test("12 · sin turnos ganados, la destacada es la de mayor valor jugado; sin historial no hay destacada", () => {
  const f = featuredCard([turn("B", 60, 90, 1), turn("TIE", 77, 77, 2), turn("B", 70, 71, 3)])!;
  assert.equal(f.uid, "y2");
  assert.equal(f.margin, 0);
  assert.match(f.why, /valor más alto/);
  assert.equal(featuredCard([]), null);
});

test("13 · el recuento de turnos lee `outcome`, no compara valores", () => {
  assert.deepEqual(roundTally([turn("A", 1, 0), turn("B", 0, 1), turn("TIE", 5, 5), turn("A", 9, 2)]), { won: 2, lost: 1, tied: 1 });
});

/* ─────────────── intro y PvP ─────────────── */

test("14 · la intro dura menos con movimiento reducido y dice quién abre", () => {
  assert.equal(introDuration(false), INTRO_MS.full);
  assert.equal(introDuration(true), INTRO_MS.reduced);
  assert.ok(INTRO_MS.reduced < INTRO_MS.full);
  const c = introCopy({ yourDeckName: "Mío", yourSumOvr: 800, rivalSumOvr: 790, youAreAttacker: false, totalTurns: 10 }, "Difícil");
  assert.equal(c.opening, "Abre el rival");
  assert.equal(c.rival, "Difícil");
  assert.match(c.turns, /^10 turnos/);
});

test("15 · la conexión solo habla cuando se está recuperando; el sondeo normal es silencio", () => {
  assert.equal(connectionCopy("SYNCED", true), null);
  assert.equal(connectionCopy("SYNCING", true), null);
  assert.equal(connectionCopy("TERMINAL", true), null);
  assert.equal(connectionCopy("SYNCING", false)?.tone, "info");
  assert.equal(connectionCopy("STALE", true)?.tone, "warn");
  assert.match(connectionCopy("STALE", true)?.text ?? "", /Reconectando/);
  assert.equal(connectionCopy("ERROR", true)?.tone, "bad");
  // F66 · ERROR solo llega con fallos que NO se reintentan (sesión caducada, partida inexistente) y el reloj del turno
  // SÍ corre en el servidor: el texto no puede prometer reintento automático ni que el turno no se pierde.
  assert.match(connectionCopy("ERROR", true)?.text ?? "", /No se pudo recuperar la partida/);
  assert.doesNotMatch(connectionCopy("ERROR", true)?.text ?? "", /reintenta solo|no se pierde/);
});

test("16 · mm:ss solo formatea; nunca decide vencimientos", () => {
  assert.equal(mmss(null), null);
  assert.equal(mmss(90_000), "01:30");
  assert.equal(mmss(-5_000), "00:00");
  assert.equal(mmss(999), "00:01");
});
