/**
 * DEL SOBRE AL MAZO (Fase 25) — pruebas 37–44 del brief sobre el planificador puro.
 * Las cartas salen del catálogo REAL (roles y variantes reales); solo la propiedad es sintética.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { CARDS, getPlayer } from "@/data/catalog";
import { DUEL_COMPOSITION, DUEL_DECK_SIZE, DUEL_ROLES } from "./types";
import { validateDuelDeck, createDuelDeck, ALLOW_SAME_PLAYER_TWICE } from "./deck";
import type { DuelDeckResolver, DuelDeckCard } from "./types";
import { planDeckInsert, compareCards, type DeckCardLike } from "./deckInsert";

/** Carta poseída sintética a partir de una definición real (QA SYNTHETIC: solo el uid es inventado). */
function like(def: (typeof CARDS)[number], uid: string): DeckCardLike {
  const p = getPlayer(def.playerId)!;
  return { uid, cardId: def.id, playerId: def.playerId, nick: p.nick, role: def.role ?? p.role, variantId: def.variantId, ovr: def.ovr, combat: def.combat!, serial: null };
}
const withCombat = CARDS.filter((c) => !!c.combat && !!getPlayer(c.playerId));
const byRole = (role: string, n: number, skipPlayers = new Set<string>()) =>
  withCombat.filter((c) => (c.role ?? getPlayer(c.playerId)!.role) === role && !skipPlayers.has(c.playerId))
    .reduce<(typeof CARDS)[number][]>((acc, c) => (acc.length < n && !acc.some((a) => a.playerId === c.playerId) ? [...acc, c] : acc), []);

test("37 · hueco libre de su rol → free, y el resultado es el mazo + la carta", () => {
  const [a] = byRole("Duelista", 1);
  const [b] = byRole("Controlador", 1);
  const deck = { cards: [like(a, "u-a")] };
  const plan = planDeckInsert(deck, like(b, "u-b"));
  assert.equal(plan.kind, "free");
  assert.deepEqual(plan.apply(), ["u-a", "u-b"]);
});

test("39 · rol lleno (2) → replace SOLO entre cartas de ese rol, con comparación", () => {
  const dus = byRole("Duelista", 3);
  const deck = { cards: [like(dus[0], "u-1"), like(dus[1], "u-2"), like(byRole("Centinela", 1)[0], "u-s")] };
  const plan = planDeckInsert(deck, like(dus[2], "u-3"));
  assert.equal(plan.kind, "replace");
  assert.deepEqual(plan.options.map((o) => o.current.uid).sort(), ["u-1", "u-2"]);
  assert.equal(plan.apply(), null, "sin elegir a quién, no hay resultado");
  assert.equal(plan.apply("u-s"), null, "no se puede sustituir una carta de otro rol");
  assert.deepEqual(plan.apply("u-1"), ["u-3", "u-2", "u-s"]);
  for (const o of plan.options) {
    assert.deepEqual(o.compare.map((r) => r.label), ["OVR", "SH", "GS", "EF", "Rareza"]);
    assert.equal(o.up + o.down <= 5, true);
  }
});

test("41 · el mismo jugador ya está en el mazo → upgrade: solo puede sustituir su propia carta", () => {
  assert.equal(ALLOW_SAME_PLAYER_TWICE, false, "la regla canónica no se toca");
  const pid = withCombat.find((c) => withCombat.filter((x) => x.playerId === c.playerId).length >= 2)!.playerId;
  const dup = withCombat.filter((c) => c.playerId === pid);
  assert.ok(dup.length >= 2, "el jugador tiene al menos dos variantes en el catálogo");
  const deck = { cards: [like(dup[0], "u-old"), like(byRole("Controlador", 1)[0], "u-c")] };
  const plan = planDeckInsert(deck, like(dup[1], "u-new"));
  assert.equal(plan.kind, "upgrade");
  assert.equal(plan.options.length, 1);
  assert.equal(plan.options[0].current.uid, "u-old");
  assert.equal(plan.apply("u-c"), null);
  assert.deepEqual(plan.apply("u-old"), ["u-new", "u-c"]);
});

test("42 · mazo de 10 completo → replace (nunca se añade una undécima)", () => {
  const skip = new Set<string>();
  const cards: DeckCardLike[] = [];
  for (const role of DUEL_ROLES) {
    for (const c of byRole(role, DUEL_COMPOSITION[role], skip)) { cards.push(like(c, `u-${cards.length}`)); skip.add(c.playerId); }
  }
  assert.equal(cards.length, DUEL_DECK_SIZE);
  const extra = withCombat.find((c) => !skip.has(c.playerId))!;
  const plan = planDeckInsert({ cards }, like(extra, "u-x"));
  assert.equal(plan.kind, "replace");
  assert.ok(plan.apply("u-x") === null);
  const applied = plan.apply(plan.options[0].current.uid)!;
  assert.equal(applied.length, DUEL_DECK_SIZE);
  assert.ok(applied.includes("u-x"));
});

test("43 · lo que produce el planificador pasa la validación canónica (validateDuelDeck)", () => {
  const skip = new Set<string>();
  const cards: DeckCardLike[] = [];
  for (const role of DUEL_ROLES) {
    for (const c of byRole(role, DUEL_COMPOSITION[role], skip)) { cards.push(like(c, `u-${cards.length}`)); skip.add(c.playerId); }
  }
  const candidate = like(withCombat.find((c) => !skip.has(c.playerId) && (c.role ?? getPlayer(c.playerId)!.role) === "Duelista")!, "u-new");
  const plan = planDeckInsert({ cards }, candidate);
  const uids = plan.apply(plan.options[0].current.uid)!;
  const all = [...cards, candidate];
  const resolve: DuelDeckResolver = (uid) => {
    const c = all.find((x) => x.uid === uid);
    if (!c) return { ok: false, uid, reason: "CARD_NOT_OWNED" };
    const p = getPlayer(c.playerId)!;
    const card: DuelDeckCard = { uid: c.uid, cardId: c.cardId, playerId: c.playerId, playerName: p.nick, team: p.team, region: p.region, role: c.role, variantId: c.variantId, combat: c.combat, ovr: c.ovr, statBoost: 0, dataVersion: "v", serial: null };
    return { ok: true, card };
  };
  const deck = createDuelDeck({ id: "d", name: "QA", cards: uids, now: 1 });
  const v = validateDuelDeck(deck, resolve);
  assert.equal(v.valid, true, JSON.stringify(v.errors));
});

test("38 · una carta que ya está en el mazo (misma instancia) → blocked", () => {
  const [a] = byRole("Duelista", 1);
  const plan = planDeckInsert({ cards: [like(a, "u-a")] }, like(a, "u-a"));
  assert.equal(plan.kind, "blocked");
  assert.equal(plan.apply(), null);
});

test("40 · la comparación solo trae cifras que existen: OVR, SH/GS/EF y rareza, sin porcentajes inventados", () => {
  const [a, b] = byRole("Iniciador", 2);
  const rows = compareCards(like(a, "1"), like(b, "2"));
  assert.deepEqual(rows.map((r) => r.key), ["ovr", "stronghold", "gamesense", "entryfrag", "rank"]);
  for (const r of rows) assert.equal(r.delta, r.next - r.current);
});
