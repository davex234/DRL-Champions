/**
 * F72.8 · EL RELOJ DE LAS DECISIONES — lo puro: duración central, identidad de la decisión, jugada automática válida
 * y determinista (ataque con estadística, defensa con la obligada), y el contador derivable del reloj del servidor.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CARDS } from "@/data/catalog";
import { CardRegistry } from "@/collection/registry";
import type { OwnedCard, RoleId } from "@/domain/cards/types";
import {
  createDuelDeck, validateDuelDeck, takeDeckSnapshot, makeDeckResolver, ownershipFromList, DUEL_ROLES, type DuelDeckSnapshot,
} from "@/domain/cardgame";
import { startDuelMatch, confirmTurn, requiredDefenderStat, selectDefenderCard, type DuelMatch } from "@/domain/cardgame/match";
import { actingSide } from "@/domain/cardgame/opponent/controller";
import {
  TURN_DECISION_SECONDS, TURN_DECISION_MS, TIMER_WARN_SECONDS, TIMER_CRITICAL_SECONDS,
  autoDecision, decisionKey, deadlineFor, recordTimeout, timeoutsOf, remainingMs, timerUrgency, formatClock,
} from "./turnClock";

const registry = new CardRegistry();
const NOW = 1_790_000_000_000;

function snap(block: number, id: string): DuelDeckSnapshot {
  const best = new Map<string, (typeof CARDS)[number]>();
  for (const c of CARDS) { const b = best.get(c.playerId); if (!b || c.ovr > b.ovr) best.set(c.playerId, c); }
  const byRole = new Map<RoleId, (typeof CARDS)[number][]>();
  for (const c of best.values()) { const p = registry.player(c.playerId); if (p) byRole.set(c.role ?? p.role, [...(byRole.get(c.role ?? p.role) ?? []), c]); }
  for (const [, arr] of byRole) arr.sort((x, y) => y.ovr - x.ovr || x.id.localeCompare(y.id));
  const picks = DUEL_ROLES.flatMap((r) => (byRole.get(r) ?? []).slice(block * 2, block * 2 + 2));
  const owned: OwnedCard[] = picks.map((c, i) => ({ uid: `${id}-u${i}`, cardId: c.id, obtainedAt: NOW }));
  const deck = createDuelDeck({ id, name: id, cards: owned.map((o) => o.uid), now: NOW });
  const v = validateDuelDeck(deck, makeDeckResolver(registry, ownershipFromList(owned)));
  assert.equal(v.valid, true);
  return takeDeckSnapshot(deck, v, NOW)!;
}
const A = snap(0, "deck-a"), B = snap(1, "deck-b");
const start = (id = "m-clock", first: "A" | "B" = "A"): DuelMatch => {
  const r = startDuelMatch({ id, snapshotA: A, snapshotB: B, firstAttacker: first });
  assert.ok(r.ok);
  return r.match;
};

/** Juega una partida ENTERA solo con jugadas automáticas (los dos bandos «se duermen» siempre). */
function autoplayAll(m: DuelMatch): { match: DuelMatch; decisions: number } {
  let decisions = 0;
  for (let guard = 0; guard < 40 && m.status === "IN_PROGRESS"; guard++) {
    const d = autoDecision(m);
    assert.ok(d, `hay jugada automática en ${m.phase}`);
    decisions++;
    m = d!.match;
    if (m.phase === "READY_TO_CONFIRM") { const c = confirmTurn(m); assert.ok(c.ok); m = c.match; }
  }
  return { match: m, decisions };
}

test("F72.8 T1 · la duración es UNA constante central: 30 s", () => {
  assert.equal(TURN_DECISION_SECONDS, 30);
  assert.equal(TURN_DECISION_MS, 30_000);
  assert.equal(TIMER_WARN_SECONDS, 10);
  assert.equal(TIMER_CRITICAL_SECONDS, 5);
});

test("F72.8 T2 · deadline creado al empezar la decisión; clave por decisión (cambia al atacar y al defender), null al terminar", () => {
  const m = start();
  assert.equal(decisionKey(m), "1:ATTACK:A");
  assert.equal(deadlineFor(m, NOW), NOW + 30_000);
  const a = autoDecision(m)!;
  assert.equal(decisionKey(a.match), "1:DEFENSE:B", "tras atacar, empieza la decisión del defensor: plazo nuevo");
  const done = autoplayAll(m).match;
  assert.notEqual(done.status, "IN_PROGRESS");
  assert.equal(decisionKey(done), null);
  assert.equal(deadlineFor(done, NOW), null, "sin decisión pendiente, sin plazo");
});

test("F72.8 T3 · carta y estadística automáticas VÁLIDAS: una partida entera solo con jugadas automáticas se completa", () => {
  for (const [id, first] of [["m-1", "A"], ["m-2", "B"], ["m-3", "A"], ["m-4", "B"]] as const) {
    const { match, decisions } = autoplayAll(start(id, first));
    assert.ok(["COMPLETED", "DRAW"].includes(match.status), `${id}: termina (${match.status})`);
    assert.equal(match.turns.length, 10);
    assert.equal(decisions, 20, "diez ataques y diez defensas, todas legales");
    assert.equal(new Set(match.usedA).size, 10); assert.equal(new Set(match.usedB).size, 10);
  }
});

test("F72.8 T4 · defensa automática: carta de la mano y la estadística OBLIGADA (no se elige)", () => {
  const m = start();
  const att = autoDecision(m)!;
  assert.equal(att.kind, "ATTACK");
  assert.ok(["stronghold", "gamesense", "entryfrag"].includes(att.stat));
  const def = autoDecision(att.match)!;
  assert.equal(def.kind, "DEFENSE");
  assert.equal(def.side, "B");
  // La obligada se calcula con la carta del defensor ya elegida, igual que en la jugada humana.
  const picked = selectDefenderCard(att.match, def.cardUid);
  assert.ok(picked.ok);
  assert.equal(def.stat, requiredDefenderStat(picked.match));
  assert.ok(B.cards.some((c) => c.uid === def.cardUid));
  assert.equal(def.match.draft.defenderStat, def.stat);
});

test("F72.8 T5 · determinismo: misma decisión vencida ⇒ misma carta y misma estadística; otra partida puede dar otra", () => {
  const m = start("m-det");
  const a1 = autoDecision(m)!, a2 = autoDecision(structuredClone(m))!;
  assert.deepEqual([a1.cardUid, a1.stat], [a2.cardUid, a2.stat]);
  assert.deepEqual(autoDecision(a1.match)!.cardUid, autoDecision(structuredClone(a1.match))!.cardUid);
  const picks = new Set(["x1", "x2", "x3", "x4", "x5", "x6", "x7", "x8"].map((id) => autoDecision(start(id))!.cardUid));
  assert.ok(picks.size > 1, "no es «siempre la primera carta»: depende de la partida");
});

test("F72.8 T6 · la jugada automática es de quien debía decidir; nunca juega por el otro", () => {
  let m = start("m-side", "B");
  for (let i = 0; i < 6 && m.status === "IN_PROGRESS"; i++) {
    const side = actingSide(m);
    const d = autoDecision(m)!;
    assert.equal(d.side, side);
    m = d.match;
    if (m.phase === "READY_TO_CONFIRM") m = (confirmTurn(m) as { match: DuelMatch }).match;
  }
});

test("F72.8 T7 · el registro de decisiones agotadas se acumula y no lleva ni carta ni estadística", () => {
  const m = start();
  const a = autoDecision(m)!;
  const r1 = recordTimeout(a.match, m, { turn: 1, side: "A", kind: "ATTACK" });
  const r2 = recordTimeout(r1, r1, { turn: 1, side: "B", kind: "DEFENSE" });
  assert.deepEqual(timeoutsOf(r2), [{ turn: 1, side: "A", kind: "ATTACK" }, { turn: 1, side: "B", kind: "DEFENSE" }]);
  assert.ok(!JSON.stringify(timeoutsOf(r2)).includes(a.cardUid));
  assert.deepEqual(timeoutsOf(recordTimeout(a.match, r2, null)).length, 2, "una jugada humana conserva el registro");
});

test("F72.8 T8 · contador derivable del reloj del SERVIDOR: un dispositivo adelantado o atrasado no lo cambia", () => {
  const deadline = NOW + 30_000;
  // Respuesta recibida con el reloj del dispositivo a +2 h o −5 min: tras 18 s quedan 12 s igualmente.
  for (const skew of [0, 2 * 3600_000, -300_000]) {
    const receivedAt = NOW + skew;
    assert.equal(remainingMs(deadline, NOW, receivedAt, receivedAt + 18_000), 12_000);
  }
  assert.equal(remainingMs(deadline, NOW, NOW, NOW + 40_000), 0, "nunca negativo");
  assert.equal(remainingMs(null, NOW, NOW, NOW), null);
  assert.equal(formatClock(30_000), "00:30");
  assert.equal(formatClock(29_001), "00:30");
  assert.equal(formatClock(9_000), "00:09");
  assert.equal(formatClock(0), "00:00");
  assert.deepEqual([30_000, 10_500, 10_000, 5_000, 1, 0].map(timerUrgency), ["normal", "normal", "warn", "critical", "critical", "expired"]);
});
