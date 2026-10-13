/**
 * FASE 33 · MATCH EXPERIENCE 3.0 — dominio de presentación (tests 1–63 y 65–77 del brief).
 *
 * Las partidas son REALES: motor puro + dos bots sobre cartas del catálogo (`qaSimulation`), proyectadas
 * con las mismas funciones que el servidor. Los casos de desempate de PARTIDA usan resultados
 * sintéticos con la forma exacta de `DuelResultView` (la presentación solo lee sus campos).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TURNS_PER_MATCH, selectAttackerCard, selectAttackerStat, selectDefenderCard } from "@/domain/cardgame/match";
import { projectMatchFor } from "@/domain/cardgame/pvp";
import type { RatingEvent } from "@/domain/cardgame/rating";
import { buildMatchView } from "./matchView";
import { qaSnapshot, qaSimulate, qaView, qaReplay, qaRegistry, qaFindMatch } from "./qaSimulation";
import type { DuelResultView, DuelTurnView } from "./types";
import {
  axisPresentation, buildReplayTimeline, buildTimeline, cardOfTheMatch, decisionSteps, derivePhase, explainTurn,
  lockAction, matchPoint, matchVerdict, planReveals, ratingPresentation, releaseAction, resultActions, rewardPresentation,
  selectableUids, syncBanner, timeoutPresentation, turnDetail, turnHeader, turnResult, matchEndPresentation,
  DECISION_TITLE, MAX_QUEUED_REVEALS, PHASE_LABEL, REPLAY_UNAVAILABLE_TEXT, TURN_HEADLINE, UNKNOWN_TURN_TEXT, UNLOCKED, VERDICT_TITLE,
  type MatchPhase,
} from "./experience";

const mine = qaSnapshot(0, "qa-you", "QA · Equipo");
const rival = qaSnapshot(1, "qa-rival", "QA · Rival");
const attackM = qaSimulate(mine, rival, 0, "A");
const attackV = qaView(attackM);
const defenseV = qaView(qaSimulate(mine, rival, 0, "B"));
const midM = qaSimulate(mine, rival, 4, "A", 7);
const midV = qaView(midM);
const full = qaFindMatch((m) => m.status !== "IN_PROGRESS", 3, 40)!;
const fullV = qaView(full);

const side = (uid: string, stat: DuelTurnView["you"]["stat"], value: number) => ({ uid, nick: uid, team: "T", role: "Duelista" as const, stat, value });
const turn = (n: number, outcome: DuelTurnView["outcome"], you: number, rv: number, o: Partial<DuelTurnView> = {}): DuelTurnView => ({
  number: n, attacker: n % 2 ? "A" : "B", outcome, scoreAfterYou: 0, scoreAfterRival: 0,
  you: side(`y${n}`, "gamesense", you), rival: side(`r${n}`, "gamesense", rv), reason: "", ...o,
});
const result = (o: Partial<DuelResultView>): DuelResultView => ({
  winner: "YOU", isDraw: false, scoreYou: 6, scoreRival: 4, tiedEncounters: 0, decidedBy: "SCORE", reason: "",
  sumOvrYou: null, sumOvrRival: null, statTotalYou: 700, statTotalRival: 690, rulesVersion: "duel-combat-2", award: null, ...o,
});
const deepFreeze = <T,>(o: T): T => { if (o && typeof o === "object") { Object.values(o).forEach(deepFreeze); Object.freeze(o); } return o; };
const unplayedRival = (m: typeof midM) => m.snapshotB.cards.map((c) => c.uid).filter((u) => !m.usedB.includes(u));

/* ───────────── 1–10 · fase de presentación ───────────── */

test("1 · estado de ataque: ATACAS, elegir carta, los tres ejes reales", () => {
  assert.equal(attackV.youAreAttacker, true);
  assert.equal(derivePhase({ view: attackV, mode: "PVE" }), "SELECT_CARD");
  const h = turnHeader(attackV);
  assert.deepEqual([h.label, h.role, h.roleLabel], ["TURNO 1 DE 10", "ATTACK", "ATACAS"]);
  assert.deepEqual(axisPresentation(attackV).options, ["stronghold", "gamesense", "entryfrag"]);
});

test("2 · estado de defensa: DEFIENDES y el eje lo impone el servidor", () => {
  assert.equal(defenseV.youAreAttacker, false);
  assert.equal(turnHeader(defenseV).roleLabel, "DEFIENDES");
  const a = axisPresentation(defenseV);
  assert.equal(a.mode, "IMPOSED");
  assert.equal(a.rivalStat, defenseV.pendingRival!.stat);
  assert.equal(a.yourStat, defenseV.requiredStat);
  assert.deepEqual(a.options, [], "defendiendo no se elige eje");
});

test("3 · carta elegida: atacando pide eje; con eje (o defendiendo) confirmar", () => {
  const uid = attackV.yourHand[0].uid;
  assert.equal(derivePhase({ view: attackV, mode: "PVE", selectedUid: uid }), "SELECT_STAT");
  assert.equal(derivePhase({ view: attackV, mode: "PVE", selectedUid: uid, selectedStat: "gamesense" }), "CONFIRM");
  assert.equal(derivePhase({ view: defenseV, mode: "PVE", selectedUid: defenseV.yourHand[0].uid }), "CONFIRM");
});

test("4 · jugada en vuelo: LOCKED y nada seleccionable", () => {
  const p = derivePhase({ view: attackV, mode: "PVE", selectedUid: attackV.yourHand[0].uid, submitting: true });
  assert.equal(p, "LOCKED");
  assert.deepEqual(selectableUids(attackV, p), []);
});

test("5 · PvP sin tu turno: ESPERANDO AL RIVAL", () => {
  assert.equal(derivePhase({ view: attackV, mode: "PVP", sync: { status: "SYNCED", isYourTurn: false, lifecycle: "IN_TURN" } }), "WAITING_RIVAL");
});

test("6 · revelación en pantalla: REVEAL", () => {
  assert.equal(derivePhase({ view: midV, mode: "PVE", revealing: true }), "REVEAL");
});

test("7 · resolución: titular y motivo del turno real", () => {
  const e = explainTurn(midV.lastTurn);
  assert.ok(e.reason !== "UNKNOWN");
  assert.ok(Object.values(TURN_HEADLINE).includes(e.headline));
});

test("8 · partida terminada: FINISHED (por estado de la vista o por ciclo de vida PvP)", () => {
  assert.equal(derivePhase({ view: fullV, mode: "PVE" }), "FINISHED");
  assert.equal(derivePhase({ view: attackV, mode: "PVP", sync: { status: "TERMINAL", isYourTurn: true, lifecycle: "EXPIRED" } }), "FINISHED");
});

test("9 · la verdad del servidor manda sobre el estado local", () => {
  assert.equal(derivePhase({ view: fullV, mode: "PVE", selectedUid: "x", submitting: true, revealing: true }), "FINISHED");
  assert.equal(derivePhase({ view: attackV, mode: "PVE", selectedUid: "carta-que-ya-no-esta" }), "SELECT_CARD");
  assert.equal(derivePhase({ view: attackV, mode: "PVP", selectedUid: attackV.yourHand[0].uid, sync: { status: "STALE", isYourTurn: true, lifecycle: "IN_TURN" } }), "RESYNC");
  assert.equal(derivePhase({ view: attackV, mode: "PVP", sync: { status: "ERROR", isYourTurn: true, lifecycle: "IN_TURN" } }), "OFFLINE");
});

test("10 · la presentación no muta la partida", () => {
  const v = deepFreeze(structuredClone(midV));
  const before = JSON.stringify(v);
  turnHeader(v); axisPresentation(v); buildTimeline(v); turnDetail(v, 1); explainTurn(v.lastTurn); derivePhase({ view: v, mode: "PVE" });
  const fv = deepFreeze(structuredClone(fullV));
  decisionSteps(fv.result!); cardOfTheMatch(fv.history); buildReplayTimeline(deepFreeze(qaReplay(full)));
  assert.equal(JSON.stringify(v), before);
});

/* ───────────── 11–18 · explicación del turno ───────────── */

test("11 · victoria en el eje", () => {
  const e = explainTurn(turn(3, "A", 82, 79));
  assert.equal(e.reason, "STAT_WIN");
  assert.equal(e.headline, "PUNTO PARA TI");
  assert.equal(e.text, "Tu Gamesense 82 supera a Gamesense 79 del rival.");
});

test("12 · derrota en el eje", () => {
  const e = explainTurn(turn(4, "B", 70, 88));
  assert.equal(e.reason, "STAT_LOSS");
  assert.equal(e.headline, "PUNTO PARA EL RIVAL");
  assert.equal(e.text, "Gamesense 88 del rival supera a tu Gamesense 70.");
});

test("13 · desempate por suma de OVR (partida): turnos empatados, OVR decide y da un punto", () => {
  const s = decisionSteps(result({ decidedBy: "OVR_TIEBREAK", scoreYou: 6, scoreRival: 5, sumOvrYou: 850, sumOvrRival: 840, tiedEncounters: 2 }));
  assert.deepEqual(s.map((x) => [x.key, x.outcome, x.you, x.rival]), [["SCORE", "TIE", 5, 5], ["OVR", "YOU", 850, 840]]);
  assert.match(s[1].note, /da un punto/);
});

test("14 · desempate por total de estadísticas: sin punto adicional", () => {
  const s = decisionSteps(result({ decidedBy: "STAT_MARGIN", winner: "RIVAL", scoreYou: 5, scoreRival: 5, sumOvrYou: 800, sumOvrRival: 800, statTotalYou: 690, statTotalRival: 702 }));
  assert.deepEqual(s.map((x) => [x.key, x.outcome]), [["SCORE", "TIE"], ["OVR", "TIE"], ["STAT_TOTAL", "RIVAL"]]);
  assert.deepEqual([s[0].you, s[0].rival], [5, 5], "sin punto que restar");
  assert.match(s[2].note, /sin punto adicional/);
});

test("15 · empate: en el turno nadie puntúa; en la partida, empate total", () => {
  assert.equal(explainTurn(turn(2, "TIE", 80, 80)).text, "Empate a 80: ningún jugador suma punto.");
  const s = decisionSteps(result({ decidedBy: "NONE", winner: null, isDraw: true, scoreYou: 4, scoreRival: 4, sumOvrYou: 810, sumOvrRival: 810, statTotalYou: 700, statTotalRival: 700 }));
  assert.ok(s.every((x) => x.outcome === "TIE"));
  assert.equal(s[2].note, "Empate total. Ningún jugador suma punto.");
});

test("16 · motivo desconocido: fallback seguro, sin adivinar", () => {
  assert.equal(explainTurn(turn(5, "A", 70, 80)).text, UNKNOWN_TURN_TEXT, "resultado y cifras no cuadran");
  assert.equal(explainTurn(null).reason, "UNKNOWN");
  assert.equal(explainTurn({ ...turn(6, "B", 1, 2), you: undefined as never }).text, UNKNOWN_TURN_TEXT);
  const noOvr = decisionSteps(result({ decidedBy: "OVR_TIEBREAK", scoreYou: 6, scoreRival: 5, sumOvrYou: null, sumOvrRival: null }));
  assert.equal(noOvr[1].you, null);
});

test("17 · el marcador de la explicación es el del servidor", () => {
  const e = explainTurn(turn(7, "A", 90, 60, { scoreAfterYou: 9, scoreAfterRival: 0 }));
  assert.deepEqual([e.scoreYou, e.scoreRival], [9, 0]);
});

test("18 · explicar no altera el marcador ni el turno", () => {
  const t = deepFreeze(turn(8, "B", 50, 60, { scoreAfterYou: 3, scoreAfterRival: 4 }));
  const before = JSON.stringify(t);
  explainTurn(t);
  assert.equal(JSON.stringify(t), before);
});

/* ───────────── 19–26 · información oculta ───────────── */

test("19 · el mazo oculto del rival no está en la vista PvP", () => {
  const v = qaView(midM, "A", "PVP");
  const json = JSON.stringify(v);
  for (const u of unplayedRival(midM)) assert.ok(!json.includes(u), u);
  assert.equal(v.rivalRemaining, 10 - midM.usedB.length);
});

test("20 · la carta del rival que aún no declaró no está", () => {
  const m = qaSimulate(mine, rival, 1, "A", 7, false); // turno 2: ataca B y NO ha declarado
  assert.equal(m.attacker, "B");
  const v = buildMatchView(projectMatchFor(m, "A"), { side: "A", registry: qaRegistry, difficulty: "NORMAL", rivalLabel: "Rival" });
  assert.equal(v.pendingRival, null);
  const json = JSON.stringify(v);
  for (const u of unplayedRival(m)) assert.ok(!json.includes(u), u);
});

test("21 · la acción del rival (su carta de defensa en borrador) no se filtra", () => {
  const start = qaSimulate(mine, rival, 0, "A", 7, false);
  const a = selectAttackerCard(start, start.snapshotA.cards[0].uid); assert.ok(a.ok);
  const b = selectAttackerStat(a.match, "gamesense"); assert.ok(b.ok);
  const defUid = b.match.snapshotB.cards[0].uid;
  const d = selectDefenderCard(b.match, defUid); assert.ok(d.ok);
  const v = buildMatchView(projectMatchFor(d.match, "A"), { side: "A", registry: qaRegistry, difficulty: "NORMAL", rivalLabel: "Rival" });
  assert.ok(!JSON.stringify(v).includes(defUid));
});

test("22 · el eje del rival no aparece hasta que el servidor lo autoriza", () => {
  const m = qaSimulate(mine, rival, 1, "A", 7, false);
  const v = buildMatchView(projectMatchFor(m, "A"), { side: "A", registry: qaRegistry, difficulty: "NORMAL", rivalLabel: "Rival" });
  assert.equal(v.requiredStat, null);
  assert.equal(axisPresentation(v).mode, "WAITING_ATTACK");
});

test("23 · DUEL UX 2.0 · la carta comprometida por el rival NO se expone: solo su eje, ninguna carta sin jugar", () => {
  const m = qaSimulate(mine, rival, 1, "A", 7, true);
  const v = buildMatchView(projectMatchFor(m, "A"), { side: "A", registry: qaRegistry, difficulty: "NORMAL", rivalLabel: "Rival" });
  assert.ok(v.pendingRival);
  // AJUSTE · además del eje, SOLO sus pistas públicas (pista + rol), las mismas de la fila superior.
  assert.deepEqual(Object.keys(v.pendingRival!).sort(), ["committed", "hint", "role", "stat"]);
  if (v.pendingRival!.hint) assert.ok(v.rivalHints.some((h) => h && h.type === v.pendingRival!.hint!.type && h.value === v.pendingRival!.hint!.value), "la pista central está arriba");
  const json = JSON.stringify(v);
  const leaked = unplayedRival(m).filter((u) => json.includes(u));
  assert.deepEqual(leaked, [], "ni la comprometida: va boca abajo hasta que respondas");
});

test("24 · una partida cerrada a medias sigue sin enseñar lo no jugado", () => {
  const partial = qaSimulate(mine, rival, 4, "B", 11, false);
  const json = JSON.stringify(qaView(partial, "A", "PVP"));
  for (const u of unplayedRival(partial)) assert.ok(!json.includes(u), u);
});

test("25 · reconectar no revela el futuro: la primera foto no anima y trae lo mismo", () => {
  assert.deepEqual(planReveals(null, midV.history), { reveal: null, skipped: 0, seen: midV.history.length });
  assert.equal(JSON.stringify(qaView(midM, "A", "PVP")), JSON.stringify(qaView(midM, "A", "PVP")));
  assert.equal(buildTimeline(midV).filter((c) => c.state === "PENDING").every((c) => c.role === null), true);
});

test("26 · la repetición no trae datos no autorizados", () => {
  for (const mode of ["PVE", "PVP", "PVP_PRIVATE"] as const) {
    const r = qaReplay(midM, "A", mode);
    const played = new Set(midM.usedB);
    assert.ok(r.rivalCards.every((c) => played.has(c.uid)), mode);
    assert.ok(!JSON.stringify(r).includes("rng"));
  }
});

/* ───────────── 27–33 · selección y cerrojo ───────────── */

test("27 · carta legal (de tu mano) seleccionable", () => {
  assert.deepEqual(selectableUids(attackV, "SELECT_CARD"), attackV.yourHand.map((c) => c.uid));
});

test("28 · carta ya jugada o fase bloqueada: no seleccionable", () => {
  const sel = selectableUids(midV, "SELECT_CARD");
  for (const c of midV.yourUsed) assert.ok(!sel.includes(c.uid));
  assert.deepEqual(selectableUids(midV, "WAITING_RIVAL"), []);
});

test("29 · la jugada se bloquea al enviarse", () => {
  const r = lockAction(UNLOCKED, "act-1");
  assert.deepEqual(r, { lock: { pending: true, key: "act-1" }, accepted: true });
});

test("30 · doble envío impedido", () => {
  const first = lockAction(UNLOCKED, "act-1").lock;
  const second = lockAction(first, "act-2");
  assert.equal(second.accepted, false);
  assert.equal(second.lock.key, "act-1");
});

test("31 · rechazo del servidor: se desbloquea sin resincronizar", () => {
  assert.deepEqual(releaseAction({ pending: true, key: "a" }, "REJECTED"), { lock: UNLOCKED, resync: false });
});

test("32 · versión obsoleta: se desbloquea y se resincroniza", () => {
  assert.deepEqual(releaseAction({ pending: true, key: "a" }, "STALE"), { lock: UNLOCKED, resync: true });
});

test("33 · la selección se presenta de forma determinista", () => {
  const input = { view: attackV, mode: "PVE" as const, selectedUid: attackV.yourHand[2].uid, selectedStat: "entryfrag" as const };
  assert.equal(derivePhase(input), derivePhase({ ...input }));
});

/* ───────────── 34–41 · marcador y línea de turnos ───────────── */

test("34 · el marcador es el de la autoridad (no se recuenta el historial)", () => {
  const fake = { ...midV, scoreYou: 9, scoreRival: 0 };
  assert.equal(turnHeader(fake).secured, "YOU", "la cabecera usa el marcador de la vista, no el historial");
  const s = decisionSteps(result({ scoreYou: 7, scoreRival: 3 }));
  assert.deepEqual([s[0].you, s[0].rival], [7, 3]);
});

test("35–38 · marcas de ganado, perdido, empate y pendiente (con texto, no solo color)", () => {
  const v = { ...midV, history: [turn(1, "A", 9, 1), turn(2, "B", 1, 9), turn(3, "TIE", 5, 5)], turn: 4, status: "IN_PROGRESS" as const };
  const cells = buildTimeline(v);
  assert.deepEqual(cells.slice(0, 5).map((c) => [c.state, c.glyph]), [["WIN", "●"], ["LOSS", "○"], ["DRAW", "—"], ["CURRENT", "◆"], ["PENDING", "·"]]);
  assert.match(cells[0].label, /ganado/);
  assert.match(cells[4].label, /pendiente/);
});

test("39 · la línea tiene la longitud canónica", () => {
  assert.equal(buildTimeline(midV).length, TURNS_PER_MATCH);
});

test("40 · detalle de un turno anterior", () => {
  const d = turnDetail(midV, 1)!;
  assert.ok(d && d.yourCard && d.rivalCard);
  assert.equal(d.turn.number, 1);
});

test("41 · los turnos futuros no tienen detalle ni rol", () => {
  assert.equal(turnDetail(midV, 9), null);
  const c9 = buildTimeline(midV)[8];
  assert.deepEqual([c9.state, c9.role], ["PENDING", null]);
});

test("punto de partida: solo cuando se deriva de reglas y turnos restantes", () => {
  assert.equal(matchPoint(5, 4, 10, 10).point, "YOU");
  assert.equal(matchPoint(4, 4, 10, 10).point, "BOTH");
  assert.equal(matchPoint(3, 3, 5, 10).point, null);
  assert.equal(matchPoint(7, 1, 9, 10).secured, "YOU");
  assert.equal(turnHeader({ ...midV, turn: 10, status: "IN_PROGRESS" }).finalLabel, "ÚLTIMO TURNO");
});

/* ───────────── 42–50 · resultado ───────────── */

test("42–44 · victoria, derrota y empate", () => {
  assert.equal(VERDICT_TITLE[matchVerdict({ winner: "YOU", isDraw: false })], "VICTORIA");
  assert.equal(VERDICT_TITLE[matchVerdict({ winner: "RIVAL", isDraw: false })], "DERROTA");
  assert.equal(VERDICT_TITLE[matchVerdict({ winner: null, isDraw: true })], "EMPATE");
});

const EVENT: RatingEvent = { matchId: "m", oldRating: 1201, delta: 18, newRating: 1219, opponentRating: 1246, kFactor: 24, result: "WIN", createdAt: 1 };

test("45 · PvE sin rating", () => { assert.equal(ratingPresentation("PVE", EVENT).state, "NOT_APPLICABLE"); });
test("46 · privado sin rating", () => { assert.equal(ratingPresentation("PVP_PRIVATE", EVENT).state, "NOT_APPLICABLE"); });

test("47 · ranked usa el evento real (antes → después, sin restar) y la marca provisional", () => {
  const r = ratingPresentation("PVP", EVENT);
  assert.deepEqual([r.state, r.before, r.after, r.delta, r.deltaLabel, r.provisional], ["READY", 1201, 1219, 18, "+18", false]);
  const p = ratingPresentation("PVP", { ...EVENT, delta: -12, newRating: 1189, kFactor: 40 });
  assert.deepEqual([p.deltaLabel, p.provisional], ["−12", true]);
});

test("48 · recompensa: la del servidor, tal cual", () => {
  const r = rewardPresentation("PVE", { award: { credits: 30, xp: 20, points: 5 } });
  assert.deepEqual([r.state, r.credits, r.xp, r.points], ["GRANTED", 30, 20, 5]);
});

test("49 · sin evento de rating: pendiente, sin inventar número", () => {
  const r = ratingPresentation("PVP", null);
  assert.deepEqual([r.state, r.delta], ["PENDING", null]);
});

test("50 · sin recompensa: no disponible; PvP: no aplica", () => {
  assert.equal(rewardPresentation("PVE", { award: null }).state, "UNAVAILABLE");
  assert.equal(rewardPresentation("PVE", { award: { credits: 0, xp: 0, points: 0 } }).state, "NONE");
  assert.equal(rewardPresentation("PVP", { award: { credits: 99, xp: 99, points: 99 } }).state, "NOT_APPLICABLE");
  // Fase 39 · el draft no da recompensa por diseño: nunca «no disponible» (que sugiere un fallo) ni importes.
  const d = rewardPresentation("DRAFT_GAUNTLET", { award: { credits: 99, xp: 99, points: 99 } });
  assert.deepEqual([d.state, d.credits, d.xp, d.points], ["NOT_APPLICABLE", 0, 0, 0]);
  assert.match(d.note, /Draft Gauntlet no da/);
  assert.equal(rewardPresentation("DRAFT_GAUNTLET", { award: null }).state, "NOT_APPLICABLE");
});

/* ───────────── 51–55 · carta de la partida ───────────── */

test("51 · carta de la partida determinista (mismo resultado con otro orden)", () => {
  const h = fullV.history;
  assert.deepEqual(cardOfTheMatch(h), cardOfTheMatch([...h].reverse()));
});

test("52 · se basa en hechos del turno: margen en el eje enfrentado", () => {
  const c = cardOfTheMatch([turn(1, "A", 80, 70), turn(2, "A", 90, 60), turn(3, "B", 50, 90)])!;
  assert.deepEqual([c.uid, c.margin, c.turn], ["y2", 30, 2]);
  assert.match(c.why, /Ganó el turno 2: Gamesense 90 contra 60 \(\+30\)/);
});

test("53 · desempate estable: valor, turno, uid", () => {
  assert.equal(cardOfTheMatch([turn(1, "A", 70, 60), turn(2, "A", 80, 70)])!.uid, "y2", "mismo margen: mayor valor");
  assert.equal(cardOfTheMatch([turn(4, "A", 80, 70), turn(2, "A", 80, 70)])!.turn, 2, "mismo valor: turno antes");
});

test("54 · sin recompensa económica: solo datos de presentación", () => {
  const c = cardOfTheMatch([turn(1, "A", 80, 70)])!;
  assert.deepEqual(Object.keys(c).sort(), ["margin", "rivalValue", "stat", "turn", "uid", "value", "why"]);
});

test("55 · sin datos suficientes, no hay carta de la partida", () => {
  assert.equal(cardOfTheMatch([turn(1, "B", 60, 80), turn(2, "TIE", 70, 70)]), null);
  assert.equal(cardOfTheMatch([turn(1, "A", 60, 80)]), null, "una victoria incoherente no cuenta");
  assert.equal(cardOfTheMatch([]), null);
});

/* ───────────── 56–63, 65 · repetición ───────────── */

const replayFull = qaReplay(full);

test("56 · la repetición usa los turnos persistidos", () => {
  const t = buildReplayTimeline(replayFull);
  assert.deepEqual(t.frames.map((f) => f.number), replayFull.turns.map((x) => x.number));
  assert.equal(t.availability, "FULL");
});

test("57 · la repetición no vuelve a ejecutar el motor", () => {
  const src = readFileSync(join(process.cwd(), "src/lib/duel/experience.ts"), "utf8");
  assert.ok(!/from "@\/domain\/cardgame\/(match|combat|opponent)"|resolveEncounter|resolveCombat|confirmTurn|advanceBots/.test(src));
});

test("58 · orden de turnos aunque lleguen desordenados", () => {
  const t = buildReplayTimeline({ ...replayFull, turns: [...replayFull.turns].reverse() });
  assert.deepEqual(t.frames.map((f) => f.number), [...replayFull.turns.map((x) => x.number)].sort((a, b) => a - b));
});

test("59 · progresión del marcador = la guardada", () => {
  const t = buildReplayTimeline(replayFull);
  t.frames.forEach((f, i) => assert.deepEqual([f.scoreYou, f.scoreRival], [replayFull.turns[i].scoreAfterYou, replayFull.turns[i].scoreAfterRival]));
});

test("60 · cada fotograma enseña las cifras reales del eje", () => {
  const t = buildReplayTimeline(replayFull);
  t.frames.forEach((f, i) => assert.equal(f.explanation.contested?.you.value, replayFull.turns[i].you.value));
});

test("61 · el desempate de la partida se enseña al final", () => {
  const r = { ...replayFull, result: result({ decidedBy: "OVR_TIEBREAK", scoreYou: 6, scoreRival: 5, sumOvrYou: 850, sumOvrRival: 840 }) };
  assert.deepEqual(buildReplayTimeline(r).decision!.map((s) => s.key), ["SCORE", "OVR"]);
});

test("62 · repetición parcial: se dice", () => {
  const partial = buildReplayTimeline(qaReplay(qaSimulate(mine, rival, 4, "A", 9), "A", "PVP"));
  assert.equal(partial.availability, "PARTIAL");
  assert.match(partial.note ?? "", /terminó en el turno 4/);
});

test("63 · repetición no disponible", () => {
  const t = buildReplayTimeline({ ...replayFull, turns: [] });
  assert.deepEqual([t.availability, t.note], ["UNAVAILABLE", REPLAY_UNAVAILABLE_TEXT]);
  assert.equal(buildReplayTimeline(null).availability, "UNAVAILABLE");
});

test("65 · la repetición PvP no filtra cartas no jugadas", () => {
  const partial = qaSimulate(mine, rival, 4, "A", 9);
  const json = JSON.stringify(qaReplay(partial, "B", "PVP"));
  for (const u of partial.snapshotA.cards.map((c) => c.uid).filter((u) => !partial.usedA.includes(u))) assert.ok(!json.includes(u), u);
});

/* ───────────── 66–73 · reconexión ───────────── */

test("66 · reconectar eligiendo: la vista del servidor vuelve a SELECT_CARD", () => {
  assert.equal(derivePhase({ view: qaView(attackM), mode: "PVE" }), "SELECT_CARD");
});

test("67 · reconectar esperando al rival: WAITING_RIVAL", () => {
  assert.equal(derivePhase({ view: qaView(attackM, "A", "PVP"), mode: "PVP", sync: { status: "SYNCED", isYourTurn: false, lifecycle: "IN_TURN" } }), "WAITING_RIVAL");
});

test("68 · tras resolverse un turno: se revela ese turno", () => {
  const p = planReveals(3, midV.history);
  assert.equal(p.reveal?.number, 4);
  assert.equal(p.skipped, 0);
});

test("69 · tras varios turnos de golpe: solo el último", () => {
  const p = planReveals(1, midV.history);
  assert.deepEqual([p.reveal?.number, p.skipped], [4, 2]);
});

test("70 · reconectar con la partida terminada: FINISHED, sin animaciones", () => {
  assert.equal(derivePhase({ view: fullV, mode: "PVE" }), "FINISHED");
  assert.equal(planReveals(null, fullV.history).reveal, null);
});

test("71 · la cola de revelaciones está acotada", () => {
  assert.equal(MAX_QUEUED_REVEALS, 1);
  assert.equal(planReveals(0, fullV.history).skipped, fullV.history.length - 1);
});

test("72 · sin autoridad de animación: solo cuenta turnos vistos, nada se guarda", () => {
  assert.equal(planReveals(4, midV.history).reveal, null);
  assert.deepEqual(Object.keys(planReveals(0, midV.history)).sort(), ["reveal", "seen", "skipped"]);
});

test("73 · STALE_VERSION: resincronizar, nunca error fatal", () => {
  assert.ok(syncBanner("STALE", "CONFLICT"));
  assert.equal(syncBanner("SYNCED", null), null);
  assert.equal(derivePhase({ view: attackV, mode: "PVP", sync: { status: "STALE", isYourTurn: true, lifecycle: "IN_TURN" } }), "RESYNC");
  assert.equal(timeoutPresentation(null, true).show, false, "sin plazo del servidor no hay reloj");
  assert.match(timeoutPresentation(-1, false).text ?? "", /tiempo del rival se agotó/);
});

/* ───────────── 74–77 · modos ───────────── */

test("74 · PvE: recompensa del servidor, sin rating", () => {
  assert.ok(fullV.result?.award, "la vista PvE trae la recompensa");
  assert.equal(ratingPresentation("PVE", null).state, "NOT_APPLICABLE");
  assert.ok(resultActions("PVE").some((a) => a.label === "Revancha"));
});

test("75 · Ranked: acciones sin revancha y rating real", () => {
  const labels = resultActions("PVP").map((a) => a.label);
  assert.ok(labels.includes("Buscar otro rival") && !labels.includes("Revancha"));
});

test("76 · PvP: el jugador B ve SUS turnos (perspectiva corregida en la proyección)", () => {
  const va = qaView(full, "A", "PVP");
  const vb = qaView(full, "B", "PVP");
  va.history.forEach((ta, i) => {
    const tb = vb.history[i];
    const flip = { WIN: "LOSS", LOSS: "WIN", DRAW: "DRAW" } as const;
    assert.equal(turnResult(tb), flip[turnResult(ta)], `turno ${ta.number}`);
    assert.equal(tb.attacker === "A", ta.attacker !== "A", "atacaste tú ⇔ no atacó A");
    assert.equal(tb.scoreAfterYou, ta.scoreAfterRival);
    assert.equal(tb.you.uid, ta.rival.uid);
  });
  assert.equal(matchVerdict(vb.result!), { WIN: "LOSS", LOSS: "WIN", DRAW: "DRAW" }[matchVerdict(va.result!)]);
  // PvE (bando A) sigue idéntico al motor.
  full.turns.forEach((t, i) => assert.equal(fullV.history[i].outcome, t.outcome));
});

/* ───────────── fase visual y transición final (Fase 33, piezas añadidas al cerrar la fase) ───────────── */

test("fase visual: cada fase tiene rótulo profesional (CARTA BLOQUEADA, ESPERANDO AL RIVAL…)", () => {
  const all: MatchPhase[] = ["RECOVERING", "OFFLINE", "RESYNC", "INTRO", "SELECT_CARD", "SELECT_STAT", "CONFIRM", "LOCKED", "WAITING_RIVAL", "REVEAL", "FINISHED"];
  assert.deepEqual(Object.keys(PHASE_LABEL).sort(), [...all].sort());
  assert.equal(PHASE_LABEL.LOCKED, "CARTA BLOQUEADA");
  assert.equal(PHASE_LABEL.WAITING_RIVAL, "ESPERANDO AL RIVAL");
  assert.equal(PHASE_LABEL.OFFLINE, "SIN CONEXIÓN");
});

test("fase visual: la revelación no pasa por delante de la verdad del servidor (terminada / sin red)", () => {
  assert.equal(derivePhase({ view: attackV, revealing: true, sync: { status: "ERROR", isYourTurn: true, lifecycle: "IN_TURN" } }), "OFFLINE");
  assert.equal(derivePhase({ view: fullV, revealing: true }), "FINISHED");
  assert.equal(derivePhase({ view: attackV, revealing: true, submitting: true }), "REVEAL", "revelando no se pinta como jugada en vuelo");
});

test("final: VICTORIA/DERROTA/EMPATE con el marcador final del resolver y el último turno real", () => {
  const verdict = matchVerdict(fullV.result!);
  const p = matchEndPresentation({ verdict, view: fullV });
  assert.equal(p.title, VERDICT_TITLE[verdict]);
  assert.deepEqual(p.score, { you: fullV.result!.scoreYou, rival: fullV.result!.scoreRival, label: "Marcador final" });
  assert.equal(p.decision, DECISION_TITLE[fullV.result!.decidedBy]);
  assert.equal(p.lastTurn?.number, fullV.lastTurn!.number);
  assert.equal(p.lastTurn?.text, explainTurn(fullV.lastTurn).text);
});

test("final: partida cerrada a medias → marcador AL CIERRE (último turno guardado), sin resultado inventado", () => {
  const partial = qaView(qaSimulate(mine, rival, 4, "A", 9, false), "A", "PVP");
  assert.equal(partial.result, null);
  const p = matchEndPresentation({ verdict: "WIN", view: partial });
  assert.deepEqual(p.score, { you: partial.lastTurn!.scoreAfterYou, rival: partial.lastTurn!.scoreAfterRival, label: "Marcador al cierre" });
  assert.equal(p.decision, null);
});

test("final: sin turnos ni resultado no hay marcador ni último turno; el veredicto entra, no se deduce", () => {
  const p = matchEndPresentation({ verdict: "WIN", view: attackV });
  assert.deepEqual([p.score, p.lastTurn], [null, null]);
  const a = matchEndPresentation({ verdict: "WIN", view: fullV });
  const b = matchEndPresentation({ verdict: "LOSS", view: fullV });
  assert.deepEqual(a.score, b.score, "cambiar el veredicto no toca el marcador");
  const frozen = deepFreeze(structuredClone(fullV));
  matchEndPresentation({ verdict: "DRAW", view: frozen });
});

test("77 · Privado: revancha y social, sin rating", () => {
  const labels = resultActions("PVP_PRIVATE").map((a) => a.label);
  assert.ok(labels.includes("Revancha") && labels.includes("Volver a Social"));
  assert.match(ratingPresentation("PVP_PRIVATE", EVENT).note ?? "", /no mueve el rating/);
});
