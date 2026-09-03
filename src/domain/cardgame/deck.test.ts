/**
 * Tests del sistema de mazos de Duelos (node:test). Ejecutar: `npm test`.
 *
 * Usan cartas REALES del catálogo VCT 2026: si el modelo de la Fase 2 se rompiera, estos tests
 * lo detectarían igual que los suyos propios.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CARDS } from "@/data/catalog";
import { CardRegistry } from "@/collection/registry";
import type { OwnedCard, RoleId } from "@/domain/cards/types";
import { DATA_VERSION } from "@/domain/cards/combat";
import {
  createDuelDeck, addCard, removeCard, replaceCard,
  validateDuelDeck, duelDeckStatus, getEligibleCardsForSlot, rolesNeeded,
  takeDeckSnapshot, deckChecksum, makeDeckResolver, resolveAvailableCards,
  ownershipFromList, explainDeckError, explainAll,
  DUEL_DECK_SIZE, DUEL_ROLES, ALLOW_SAME_PLAYER_TWICE,
  type DuelDeck, type DuelDeckCard,
} from "./index";

const registry = new CardRegistry();
const NOW = 1_700_000_000_000;

/** Elige `n` cartas de roles distintos jugadores, para poder componer mazos legales. */
function cardsOfRole(role: RoleId, n: number, skip = 0): typeof CARDS {
  const seenPlayer = new Set<string>();
  const out: typeof CARDS = [];
  for (const c of CARDS) {
    if (out.length >= n + skip) break;
    const p = registry.player(c.playerId);
    if (!p || p.role !== role || seenPlayer.has(p.id)) continue;
    seenPlayer.add(p.id);
    out.push(c);
  }
  return out.slice(skip);
}

/** Convierte cartas del catálogo en instancias poseídas con uid estable. */
const own = (cards: typeof CARDS): OwnedCard[] =>
  cards.map((c, i) => ({ uid: `u${i}-${c.id}`, cardId: c.id, obtainedAt: NOW }));

/** Mazo legal de 10 cartas: 2 por rol, jugadores distintos. */
function legalSetup() {
  const cards = DUEL_ROLES.flatMap((r) => cardsOfRole(r, 2));
  const owned = own(cards);
  const ownership = ownershipFromList(owned);
  const resolve = makeDeckResolver(registry, ownership);
  const deck = createDuelDeck({ id: "d1", name: "Mazo", cards: owned.map((o) => o.uid), now: NOW });
  return { cards, owned, ownership, resolve, deck };
}

// ───────────────────────────── Tamaño ─────────────────────────────

test("tamaño del mazo: solo 10 cartas puede ser válido", () => {
  // Pool de 11 instancias: las 10 legales más un duelista extra de otro jugador.
  const cards = [...DUEL_ROLES.flatMap((r) => cardsOfRole(r, 2)), ...cardsOfRole("Duelista", 3, 2)];
  const owned = own(cards);
  const resolve = makeDeckResolver(registry, ownershipFromList(owned));

  for (const n of [0, 5, 9, 11]) {
    const deck = createDuelDeck({ id: "d", name: "x", cards: owned.slice(0, n).map((o) => o.uid), now: NOW });
    const v = validateDuelDeck(deck, resolve);
    assert.equal(v.valid, false, `${n} cartas no debería ser válido`);
    assert.ok(v.errors.some((e) => e.code === "DECK_SIZE"), `${n} cartas debe reportar DECK_SIZE`);
    assert.equal(v.errors.find((e) => e.code === "DECK_SIZE")!.actual, n);
  }

  // Y 10 sí lo es.
  const ok = createDuelDeck({ id: "d", name: "x", cards: owned.slice(0, 10).map((o) => o.uid), now: NOW });
  assert.equal(validateDuelDeck(ok, resolve).valid, true);
});

test("un mazo legal de 10 cartas con 2 por rol es válido", () => {
  const { deck, resolve } = legalSetup();
  const v = validateDuelDeck(deck, resolve);
  assert.deepEqual(v.errors, [], explainAll(v).join(" · "));
  assert.equal(v.valid, true);
  assert.equal(v.resolved.length, DUEL_DECK_SIZE);
  assert.equal(duelDeckStatus(deck, v), "READY_FOR_DUEL");
});

test("addCard nunca deja pasar de 10 cartas y es idempotente", () => {
  const { owned } = legalSetup();
  let deck = createDuelDeck({ id: "d", name: "x", now: NOW });
  for (const o of owned) deck = addCard(deck, o.uid, NOW);
  assert.equal(deck.cards.length, DUEL_DECK_SIZE);
  const extra = addCard(deck, "otro-uid", NOW);
  assert.equal(extra.cards.length, DUEL_DECK_SIZE);
  const again = addCard(deck, owned[0].uid, NOW);
  assert.equal(again.cards.length, DUEL_DECK_SIZE);
});

test("removeCard y replaceCard son idempotentes y conservan la posición", () => {
  const { owned } = legalSetup();
  const deck = createDuelDeck({ id: "d", name: "x", cards: owned.map((o) => o.uid), now: NOW });
  assert.equal(removeCard(deck, "no-existe", NOW), deck);
  const removed = removeCard(deck, owned[3].uid, NOW);
  assert.equal(removed.cards.length, 9);
  const replaced = replaceCard(deck, owned[3].uid, "nuevo", NOW);
  assert.equal(replaced.cards.indexOf("nuevo"), 3);
  assert.equal(replaceCard(deck, owned[0].uid, owned[1].uid, NOW), deck); // ya está en el mazo
});

// ───────────────────────────── Composición por rol ─────────────────────────────

test("composiciones incorrectas por rol fallan con ROLE_COUNT", () => {
  const setups: [string, Record<RoleId, number>][] = [
    ["1/2/2/2/2", { Duelista: 1, Controlador: 2, Iniciador: 2, Centinela: 2, Flex: 2 }],
    ["3/2/2/2/1", { Duelista: 3, Controlador: 2, Iniciador: 2, Centinela: 2, Flex: 1 }],
    ["2/3/2/2/1", { Duelista: 2, Controlador: 3, Iniciador: 2, Centinela: 2, Flex: 1 }],
    ["2/2/3/2/1", { Duelista: 2, Controlador: 2, Iniciador: 3, Centinela: 2, Flex: 1 }],
    ["2/2/2/3/1", { Duelista: 2, Controlador: 2, Iniciador: 2, Centinela: 3, Flex: 1 }],
  ];
  for (const [label, comp] of setups) {
    const cards = DUEL_ROLES.flatMap((r) => cardsOfRole(r, comp[r]));
    const owned = own(cards);
    const resolve = makeDeckResolver(registry, ownershipFromList(owned));
    const deck = createDuelDeck({ id: "d", name: label, cards: owned.map((o) => o.uid), now: NOW });
    const v = validateDuelDeck(deck, resolve);
    assert.equal(v.valid, false, `${label} no debería ser válido`);
    assert.ok(v.errors.some((e) => e.code === "ROLE_COUNT"), label);
  }
});

test("2/2/2/2/2 es la única composición aceptada", () => {
  const { deck, resolve } = legalSetup();
  const v = validateDuelDeck(deck, resolve);
  for (const r of DUEL_ROLES) assert.equal(v.roleCounts[r], 2, r);
  assert.equal(v.valid, true);
});

// ───────────────────────────── Duplicados ─────────────────────────────

test("la misma instancia dos veces falla con DUPLICATE_CARD", () => {
  const { owned, resolve } = legalSetup();
  const uids = owned.map((o) => o.uid);
  uids[1] = uids[0];
  const deck = createDuelDeck({ id: "d", name: "x", cards: uids, now: NOW });
  const v = validateDuelDeck(deck, resolve);
  assert.equal(v.valid, false);
  assert.ok(v.errors.some((e) => e.code === "DUPLICATE_CARD"));
});

test("dos variantes del MISMO jugador fallan con DUPLICATE_PLAYER (regla conservadora)", () => {
  assert.equal(ALLOW_SAME_PLAYER_TWICE, false, "la regla por defecto debe ser conservadora");
  // Busca un jugador con dos variantes y rol Duelista.
  const byPlayer = new Map<string, typeof CARDS>();
  for (const c of CARDS) {
    const p = registry.player(c.playerId);
    if (p?.role !== "Duelista") continue;
    byPlayer.set(c.playerId, [...(byPlayer.get(c.playerId) ?? []), c]);
  }
  const twoVariants = [...byPlayer.values()].find((cs) => cs.length >= 2)!;
  assert.ok(twoVariants, "el catálogo debe tener un duelista con dos variantes");

  const rest = DUEL_ROLES.filter((r) => r !== "Duelista").flatMap((r) => cardsOfRole(r, 2));
  const cards = [twoVariants[0], twoVariants[1], ...rest];
  const owned = own(cards);
  const resolve = makeDeckResolver(registry, ownershipFromList(owned));
  const deck = createDuelDeck({ id: "d", name: "x", cards: owned.map((o) => o.uid), now: NOW });
  const v = validateDuelDeck(deck, resolve);
  assert.equal(v.valid, false);
  assert.ok(v.errors.some((e) => e.code === "DUPLICATE_PLAYER"));
});

// ───────────────────────────── Propiedad y existencia ─────────────────────────────

test("una carta que el usuario no posee falla con CARD_NOT_OWNED", () => {
  const { owned, resolve } = legalSetup();
  const uids = owned.map((o) => o.uid);
  uids[0] = "uid-que-no-poseo";
  const deck = createDuelDeck({ id: "d", name: "x", cards: uids, now: NOW });
  const v = validateDuelDeck(deck, resolve);
  assert.ok(v.errors.some((e) => e.code === "CARD_NOT_OWNED"));
});

test("una instancia que apunta a una carta inexistente falla con CARD_NOT_FOUND", () => {
  const { owned } = legalSetup();
  const bad: OwnedCard[] = [...owned];
  bad[0] = { uid: bad[0].uid, cardId: "jugador-fantasma__gold", obtainedAt: NOW };
  const resolve = makeDeckResolver(registry, ownershipFromList(bad));
  const deck = createDuelDeck({ id: "d", name: "x", cards: bad.map((o) => o.uid), now: NOW });
  const v = validateDuelDeck(deck, resolve);
  assert.ok(v.errors.some((e) => e.code === "CARD_NOT_FOUND"));
});

test("una carta sin trío de combate falla con CARD_NO_COMBAT", () => {
  const { cards, owned } = legalSetup();
  const stripped = CARDS.map((c) => (c.id === cards[0].id ? { ...c, combat: undefined } : c));
  const reg = new CardRegistry(stripped, registry.player.bind(registry));
  const resolve = makeDeckResolver(reg, ownershipFromList(owned));
  const deck = createDuelDeck({ id: "d", name: "x", cards: owned.map((o) => o.uid), now: NOW });
  const v = validateDuelDeck(deck, resolve);
  assert.ok(v.errors.some((e) => e.code === "CARD_NO_COMBAT"));
});

// ───────────────────────────── Versión de datos ─────────────────────────────

test("mezclar dataVersion falla con INCOMPATIBLE_DATA_VERSION", () => {
  const { cards, owned } = legalSetup();
  const mixed = CARDS.map((c) => (c.id === cards[0].id ? { ...c, dataVersion: "VCT-2027" } : c));
  const reg = new CardRegistry(mixed, registry.player.bind(registry));
  const resolve = makeDeckResolver(reg, ownershipFromList(owned));
  const deck = createDuelDeck({ id: "d", name: "x", cards: owned.map((o) => o.uid), now: NOW });
  const v = validateDuelDeck(deck, resolve);
  assert.equal(v.valid, false);
  const err = v.errors.find((e) => e.code === "INCOMPATIBLE_DATA_VERSION");
  assert.ok(err);
  assert.deepEqual(err!.versions, ["VCT-2026", "VCT-2027"]);
});

test("todas las cartas del catálogo llevan la versión vigente", () => {
  assert.ok(CARDS.every((c) => c.dataVersion === DATA_VERSION));
});

// ───────────────────────────── Selección ─────────────────────────────

test("getEligibleCardsForSlot no ofrece roles ya completos", () => {
  const { deck, resolve, ownership } = legalSetup();
  const v = validateDuelDeck(deck, resolve);
  const available = resolveAvailableCards(registry, ownership);
  for (const r of DUEL_ROLES) {
    assert.deepEqual(getEligibleCardsForSlot({ available, deck, validation: v }, r), [], r);
  }
  assert.deepEqual(rolesNeeded(v), []);
});

test("getEligibleCardsForSlot ofrece solo el rol que falta, sin repetir jugador", () => {
  const cards = [...cardsOfRole("Duelista", 1), ...DUEL_ROLES.filter((r) => r !== "Duelista").flatMap((r) => cardsOfRole(r, 2))];
  const pool = [...cards, ...cardsOfRole("Duelista", 3, 1)];
  const owned = own(pool);
  const ownership = ownershipFromList(owned);
  const resolve = makeDeckResolver(registry, ownership);
  const deck = createDuelDeck({ id: "d", name: "x", cards: owned.slice(0, cards.length).map((o) => o.uid), now: NOW });
  const v = validateDuelDeck(deck, resolve);
  const available = resolveAvailableCards(registry, ownership);
  const ctx = { available, deck, validation: v };

  assert.deepEqual(rolesNeeded(v), ["Duelista"]);
  const elig = getEligibleCardsForSlot(ctx, "Duelista");
  assert.ok(elig.length > 0);
  assert.ok(elig.every((c) => c.role === "Duelista"));
  const inDeckPlayers = new Set(v.resolved.map((c) => c.playerId));
  assert.ok(elig.every((c) => !inDeckPlayers.has(c.playerId)), "no debe ofrecer jugadores ya presentes");
  assert.deepEqual(getEligibleCardsForSlot(ctx, "Centinela"), [], "un rol completo no ofrece nada");
});

// ───────────────────────────── Snapshot ─────────────────────────────

test("el snapshot lleva todo lo que el combate necesitará", () => {
  const { deck, resolve } = legalSetup();
  const v = validateDuelDeck(deck, resolve);
  const snap = takeDeckSnapshot(deck, v, NOW)!;
  assert.ok(snap);
  assert.equal(snap.cards.length, DUEL_DECK_SIZE);
  assert.equal(snap.dataVersion, DATA_VERSION);
  assert.equal(snap.takenAt, NOW);
  for (const c of snap.cards) {
    assert.ok(c.uid && c.cardId && c.playerId && c.playerName);
    assert.ok(c.role && c.variantId && c.team && c.region);
    assert.equal(typeof c.ovr, "number");
    for (const s of [c.combat.stronghold, c.combat.gamesense, c.combat.entryfrag]) {
      assert.ok(s >= 0 && s <= 99);
    }
  }
});

test("un mazo inválido NUNCA produce snapshot", () => {
  const { owned, resolve } = legalSetup();
  const deck = createDuelDeck({ id: "d", name: "x", cards: owned.slice(0, 8).map((o) => o.uid), now: NOW });
  const v = validateDuelDeck(deck, resolve);
  assert.equal(takeDeckSnapshot(deck, v, NOW), null);
});

// ───────────────────────────── Invariantes ─────────────────────────────

test("INVARIANTE · reordenar las cartas no cambia validez, counts ni snapshot", () => {
  const { owned, resolve } = legalSetup();
  const uids = owned.map((o) => o.uid);
  const a = createDuelDeck({ id: "d", name: "x", cards: uids, now: NOW });
  const b = createDuelDeck({ id: "d", name: "x", cards: [...uids].reverse(), now: NOW });
  const va = validateDuelDeck(a, resolve);
  const vb = validateDuelDeck(b, resolve);
  assert.equal(va.valid, vb.valid);
  assert.deepEqual(va.roleCounts, vb.roleCounts);
  const sa = takeDeckSnapshot(a, va, NOW)!;
  const sb = takeDeckSnapshot(b, vb, NOW)!;
  assert.equal(sa.checksum, sb.checksum);
  assert.deepEqual(sa.cards, sb.cards);
});

test("INVARIANTE · un mazo válido cumple las seis propiedades a la vez", () => {
  const { deck, resolve } = legalSetup();
  const v = validateDuelDeck(deck, resolve);
  assert.equal(v.valid, true);
  assert.equal(deck.cards.length, 10);                                        // 1
  for (const r of DUEL_ROLES) assert.equal(v.roleCounts[r], 2);               // 2
  assert.equal(new Set(deck.cards).size, 10);                                 // 3
  assert.equal(new Set(v.resolved.map((c) => c.playerId)).size, 10);          // 4
  assert.ok(v.resolved.every((c) => !!c.combat));                             // 5
  assert.equal(new Set(v.resolved.map((c) => c.dataVersion)).size, 1);        // 6
});

test("INVARIANTE · añadir una carta inválida nunca produce un mazo válido", () => {
  const { owned, resolve } = legalSetup();
  let deck = createDuelDeck({ id: "d", name: "x", cards: owned.slice(0, 9).map((o) => o.uid), now: NOW });
  deck = addCard(deck, "uid-inexistente", NOW);
  const v = validateDuelDeck(deck, resolve);
  assert.equal(v.valid, false);
  assert.ok(v.errors.some((e) => e.code === "CARD_NOT_OWNED"));
});

test("INVARIANTE · el checksum solo depende del contenido", () => {
  const { deck, resolve } = legalSetup();
  const v = validateDuelDeck(deck, resolve);
  assert.equal(deckChecksum(v.resolved), deckChecksum([...v.resolved].reverse()));
});

// ───────────────────────────── No mezclar modelos ─────────────────────────────

test("el mazo NO expone ninguna de las 6 estadísticas heredadas", () => {
  const { deck, resolve } = legalSetup();
  const v = validateDuelDeck(deck, resolve);
  const snap = takeDeckSnapshot(deck, v, NOW)!;
  const legacy = ["dmg", "scr", "com", "hs", "ast", "clu"];
  const serialized = JSON.stringify(snap);
  const parsed = JSON.parse(serialized) as { cards: Record<string, unknown>[] };
  for (const c of parsed.cards) {
    for (const k of legacy) assert.ok(!(k in c), `el snapshot no debe llevar '${k}'`);
    assert.ok(!("stats" in c), "el snapshot no debe llevar 'stats' heredadas");
  }
});

test("el rol NO influye en combat ni en ovr", () => {
  const { deck, resolve } = legalSetup();
  const v = validateDuelDeck(deck, resolve);
  for (const c of v.resolved) {
    const def = registry.card(c.cardId)!;
    assert.deepEqual(c.combat, def.combat);   // el trío viene tal cual del catálogo
    assert.equal(c.ovr, def.ovr);             // el OVR también
  }
});

// ───────────────────────────── Observabilidad ─────────────────────────────

test("todos los códigos de error tienen una explicación con contexto", () => {
  const cases: Parameters<typeof explainDeckError>[0][] = [
    { code: "DECK_SIZE", expected: 10, actual: 7 },
    { code: "ROLE_COUNT", role: "Duelista", expected: 2, actual: 1 },
    { code: "DUPLICATE_CARD" }, { code: "DUPLICATE_PLAYER" },
    { code: "CARD_NOT_FOUND" }, { code: "CARD_NOT_OWNED" }, { code: "CARD_NO_COMBAT" },
    { code: "INCOMPATIBLE_DATA_VERSION", versions: ["VCT-2026", "VCT-2027"] },
    { code: "INVALID_CARD" },
  ];
  for (const c of cases) {
    const msg = explainDeckError(c);
    assert.ok(msg.length > 10, c.code);
    assert.ok(!/^inv[aá]lid/i.test(msg), `"${msg}" no explica nada`);
  }
  assert.match(explainDeckError({ code: "ROLE_COUNT", role: "Duelista", expected: 2, actual: 1 }), /2.*Duelista.*1/);
});

// ───────────────────────────── Determinismo ─────────────────────────────

test("mismas entradas producen exactamente el mismo resultado", () => {
  const a = legalSetup();
  const b = legalSetup();
  const va = validateDuelDeck(a.deck, a.resolve);
  const vb = validateDuelDeck(b.deck, b.resolve);
  assert.deepEqual(va, vb);
  assert.deepEqual(takeDeckSnapshot(a.deck, va, NOW), takeDeckSnapshot(b.deck, vb, NOW));
});
