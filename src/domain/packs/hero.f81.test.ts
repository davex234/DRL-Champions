/**
 * F81 · HERO CARD — selección (mayor OVR), desempate estable por apertura, orden de presentación y casos límite.
 * Cartas del catálogo REAL; uids sintéticos (`f81-…`) como los que persiste el servidor.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CARDS, getCard, getPlayer } from "@/data/catalog";
import type { CardDef } from "@/domain/cards/types";
import { buildRevealPlan, cinematicFor, openingKey, presentationOrder, selectHero, type OpenedInstance, type RevealItem } from "./reveal";

const CAT = { cards: CARDS, getCard, getPlayer };
let n = 0;
const op = (c: CardDef, uid = `f81-${++n}-${Math.random().toString(36).slice(2, 10)}`): OpenedInstance => ({ uid, cardId: c.id, serial: null, mintedVersion: 1 });
const plan = (opened: OpenedInstance[]) => buildRevealPlan(opened, null, CAT);
/** Una carta real con ese OVR exacto (o la más cercana por debajo). */
const withOvr = (ovr: number) => CARDS.filter((c) => c.ovr <= ovr).sort((a, b) => b.ovr - a.ovr)[0];
const distinctOvrs = (k: number) => {
  const seen = new Map<number, CardDef>();
  for (const c of CARDS) if (!seen.has(c.ovr)) seen.set(c.ovr, c);
  return [...seen.values()].sort((a, b) => a.ovr - b.ovr).slice(-k);
};
const tiePair = (() => {
  const by = new Map<number, CardDef[]>();
  for (const c of CARDS) by.set(c.ovr, [...(by.get(c.ovr) ?? []), c]);
  const [ovr, cs] = [...by.entries()].filter(([, v]) => v.length >= 5).sort((a, b) => b[0] - a[0])[0];
  return { ovr, cards: cs };
})();

test("F81 HERO · normal (80 / 85 / 91 / 77 → la de mayor OVR)", () => {
  const cs = [withOvr(80), withOvr(85), withOvr(91), withOvr(77)];
  const max = Math.max(...cs.map((c) => c.ovr));
  const p = plan(cs.map((c) => op(c)));
  assert.ok(p.hero.ok);
  assert.equal(p.hero.ok && p.hero.hero.card.ovr, max);
  assert.equal(p.hero.ok && p.hero.tied.length, cs.filter((c) => c.ovr === max).length);
});

test("F81 HERO · la rareza no decide: OVR más alto gana aunque sea de menor rareza", () => {
  const [low, high] = distinctOvrs(2);
  const p = plan([op(high), op(low)]);
  assert.equal(p.hero.ok && p.hero.hero.cardId, high.id);
});

test("F81 HERO · empate a dos (91 A / 84 / 91 B / 78): EXACTAMENTE una de las empatadas", () => {
  const [a, b] = tiePair.cards;
  const others = CARDS.filter((c) => c.ovr < tiePair.ovr).slice(0, 2);
  const opened = [op(a), op(others[0]), op(b), op(others[1])];
  const p = plan(opened);
  assert.ok(p.hero.ok);
  const heroUid = p.hero.ok ? p.hero.hero.uid : "";
  assert.ok(heroUid === opened[0].uid || heroUid === opened[2].uid, "A XOR B");
  assert.equal(p.hero.ok && p.hero.tied.length, 2);
  assert.equal(p.order.filter((i) => i.uid === heroUid).length, 1, "nunca dos héroes");
  assert.equal(p.order.length, 4, "la otra empatada sigue en el resultado");
});

test("F81 HERO · desempate ESTABLE: 100 re-renders / recuperaciones / órdenes distintos → misma hero", () => {
  const [a, b] = tiePair.cards;
  const opened = [op(a), op(b), op(CARDS.find((c) => c.ovr < tiePair.ovr)!)];
  const first = plan(opened).hero;
  assert.ok(first.ok);
  for (let i = 0; i < 100; i++) {
    const shuffled = [...opened].sort(() => (i % 2 ? 1 : -1) * (Math.random() - 0.5));
    const again = buildRevealPlan(shuffled, i % 3 === 0 ? null : [], CAT).hero; // con y sin foto previa
    assert.equal(again.ok && again.hero.uid, first.ok && first.hero.uid, `iteración ${i}`);
  }
});

test("F81 HERO · el desempate es aleatorio entre aperturas (ninguna posición gana siempre)", () => {
  const [a, b] = tiePair.cards;
  let firstWins = 0;
  const N = 400;
  for (let i = 0; i < N; i++) {
    const opened = [op(a), op(b)];
    const p = plan(opened);
    if (p.hero.ok && p.hero.hero.uid === opened[0].uid) firstWins++;
  }
  assert.ok(firstWins > N * 0.35 && firstWins < N * 0.65, `la primera ganó ${firstWins}/${N}`);
});

test("F81 HERO · todas empatadas (85 A…E): exactamente UNA hero y las cinco siguen en el resultado", () => {
  const five = tiePair.cards.slice(0, 5);
  const opened = five.map((c) => op(c));
  const p = plan(opened);
  assert.ok(p.hero.ok);
  assert.equal(p.hero.ok && p.hero.tied.length, 5);
  assert.equal(new Set(p.order.map((i) => i.uid)).size, 5);
  assert.deepEqual(new Set(p.order.map((i) => i.uid)), new Set(opened.map((o) => o.uid)));
  assert.equal(p.order[0].uid, p.hero.ok && p.hero.hero.uid);
});

test("F81 HERO · duplicado (la misma carta dos veces): una instancia es la hero, la otra sigue y figura duplicada", () => {
  const c = tiePair.cards[0];
  const opened = [op(c), op(c)];
  const p = buildRevealPlan(opened, [], CAT);
  assert.ok(p.hero.ok);
  assert.deepEqual(p.items.map((i) => i.status), ["new", "duplicate"], "nueva/duplicada como siempre");
  assert.equal(p.order.length, 2);
});

test("F81 HERO · una sola carta: esa carta es la hero", () => {
  const c = CARDS[0];
  const p = plan([op(c)]);
  assert.ok(p.hero.ok);
  assert.equal(p.hero.ok && p.hero.hero.cardId, c.id);
  assert.equal(p.order.length, 1);
});

test("F81 HERO · resultado vacío: no hay hero (sin animación falsa)", () => {
  const p = plan([]);
  assert.deepEqual(p.hero, { ok: false, reason: "EMPTY", detail: "la apertura no trae cartas" });
  assert.equal(p.summary.featured, null);
});

test("F81 HERO · OVR inválido: no se inventa, falla con motivo (la corrupción no se oculta)", () => {
  const good = plan([op(CARDS[0]), op(CARDS[1])]).items;
  const corrupt: RevealItem[] = [good[0], { ...good[1], card: { ...good[1].card, ovr: Number.NaN } }];
  const pick = selectHero(corrupt);
  assert.equal(pick.ok, false);
  assert.equal(!pick.ok && pick.reason, "INVALID_OVR");
  assert.match(!pick.ok ? pick.detail : "", new RegExp(good[1].cardId));
  // Todas las cartas del catálogo vivo tienen OVR válido (el invariante que el caso protege).
  assert.ok(CARDS.every((c) => Number.isFinite(c.ovr)));
});

test("F81 HERO · elegir la hero NO toca el resultado: mismas cartas, mismo OVR, mismo orden del servidor", () => {
  const opened = distinctOvrs(5).map((c) => op(c));
  const p = plan(opened);
  const snapshot = JSON.stringify(p.items.map((i) => [i.uid, i.cardId, i.card.ovr, i.index]));
  selectHero(p.items); presentationOrder(p.items, p.hero.ok ? p.hero.hero.uid : null);
  assert.equal(JSON.stringify(p.items.map((i) => [i.uid, i.cardId, i.card.ovr, i.index])), snapshot);
  assert.deepEqual(p.items.map((i) => i.uid), opened.map((o) => o.uid), "plan.items conserva el orden autoritativo");
});

test("F81 ORDEN · hero primero y el resto por OVR descendente (empates en el orden del servidor)", () => {
  const cs = distinctOvrs(4);
  const tie = tiePair.cards.slice(0, 2);
  const opened = [op(cs[0]), op(tie[0]), op(cs[3]), op(tie[1]), op(cs[1])];
  const p = plan(opened);
  assert.ok(p.hero.ok);
  assert.equal(p.order[0].uid, p.hero.ok && p.hero.hero.uid);
  const rest = p.order.slice(1);
  for (let i = 1; i < rest.length; i++) {
    assert.ok(rest[i - 1].card.ovr > rest[i].card.ovr || (rest[i - 1].card.ovr === rest[i].card.ovr && rest[i - 1].index < rest[i].index), `orden ${i}`);
  }
});

test("F81 · la clave de apertura no depende del orden de los uids", () => {
  assert.equal(openingKey(["b", "a", "c"]), openingKey(["c", "b", "a"]));
});

test("F81 · carta persistida fuera del catálogo: sin cinemática, motivo UNRESOLVED (no se oculta un sobre incompleto)", () => {
  const p = buildRevealPlan([op(CARDS[0]), { uid: "f81-x", cardId: "no-existe__en-catalogo", serial: null, mintedVersion: 1 }], [], CAT);
  assert.equal(p.summary.unresolved, 1);
  const c = cinematicFor(p);
  assert.equal(c.ok, false);
  assert.equal(!c.ok && c.reason, "UNRESOLVED");
  assert.equal(cinematicFor(buildRevealPlan([op(CARDS[0])], [], CAT)).ok, true);
  assert.equal(!cinematicFor(buildRevealPlan([], [], CAT)).ok && (cinematicFor(buildRevealPlan([], [], CAT)) as { reason: string }).reason, "EMPTY");
});
