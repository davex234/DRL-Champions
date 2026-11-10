import test from "node:test";
import assert from "node:assert/strict";
import { buildTeamCollection, teamTotals, sortTeamCards, type TeamCardCell } from "./teamCollection";
import { CARDS, getPlayer } from "@/data/catalog";
import { getVariant } from "@/domain/cards/variants";
import type { OwnedCard } from "@/domain/cards/types";
import { canonicalCardTeam } from "@/data/teamIdentities";

const own = (cardId: string, over: Partial<OwnedCard> = {}): OwnedCard => ({
  uid: `u-${cardId}-${over.serial ?? 0}`, cardId, obtainedAt: 1, ...over,
});

// Cartas reales de Team Heretics del catálogo (los denominadores salen del catálogo, no se inventan). El equipo
// es el de la CARTA (el impreso, canónico): TH y «Team Heretics» son el mismo equipo.
const teamKey = (c: (typeof CARDS)[number]) => canonicalCardTeam(c, getPlayer(c.playerId)).key;
const hereticsCards = CARDS.filter((c) => teamKey(c) === "team-heretics");

test("teamTotals usa el catálogo real y coincide con el conteo por equipo canónico de la carta", () => {
  const totals = teamTotals();
  assert.equal(totals.get("team-heretics"), hereticsCards.length, "total de Heretics = catálogo");
  assert.equal(hereticsCards.length, 11, "las 11 cartas con TH impreso (los dos alias de Player.team juntos)");
  // Suma de todos los totales = todas las cartas con equipo.
  const sum = [...totals.values()].reduce((s, n) => s + n, 0);
  const withTeam = CARDS.filter((c) => getPlayer(c.playerId)?.team).length;
  assert.equal(sum, withTeam);
});

test("solo aparecen equipos de los que el usuario posee cartas (colección real)", () => {
  const owned = [own(hereticsCards[0].id), own(hereticsCards[1].id)];
  const coll = buildTeamCollection(owned);
  const th = coll.find((e) => e.team === "team-heretics");
  assert.ok(th, "Team Heretics aparece");
  assert.equal(th!.ownedDistinct, 2);
  assert.equal(th!.total, hereticsCards.length);
  assert.ok(th!.progress > 0 && th!.progress <= 1);
  // Ningún otro equipo (no se poseen sus cartas).
  assert.equal(coll.length, 1, "solo el equipo con cartas");
});

test("Team Heretics funciona como cualquier equipo (sin caso especial)", () => {
  // El mismo código para otro equipo produce la misma forma de resultado.
  const g2 = CARDS.filter((c) => teamKey(c) === "g2");
  const coll = buildTeamCollection([own(hereticsCards[0].id), own(g2[0].id)]);
  const th = coll.find((e) => e.team === "team-heretics")!;
  const gg = coll.find((e) => e.team === "g2")!;
  for (const e of [th, gg]) {
    assert.equal(typeof e.displayName, "string");
    assert.equal(e.ownedDistinct, 1);
    assert.equal(e.cards.length, 1);
  }
  // Team Heretics muestra su etiqueta canónica de teamIdentities.
  assert.equal(th.displayName, "Team Heretics");
  assert.equal(th.tag, "TH");
});

test("duplicados: count>1 es fiable; serial y valor salen del ejemplar real (no se inventan)", () => {
  const card = hereticsCards.find((c) => getVariant(c.variantId).serialized) ?? hereticsCards[0];
  const owned = [own(card.id, { serial: 7, obtainedAt: 10 }), own(card.id, { serial: 3, obtainedAt: 20 })];
  const coll = buildTeamCollection(owned);
  const cell = coll[0].cards.find((c) => c.cardId === card.id)!;
  assert.equal(cell.count, 2, "duplicada");
  assert.equal(cell.serial, 3, "la serie más baja poseída, real");
  assert.equal(cell.obtainedAt, 20, "obtención más reciente entre copias");
  assert.ok(cell.value > 0, "valor del dominio, no recalculado a mano");
});

test("estado vacío: sin cartas, sin equipos; includeEmpty devuelve todos", () => {
  assert.deepEqual(buildTeamCollection([]), []);
  const all = buildTeamCollection([], { includeEmpty: true });
  assert.ok(all.length > 10, "con includeEmpty aparecen todos los equipos del catálogo");
  assert.ok(all.every((e) => e.ownedDistinct === 0));
});

test("no se generan cartas: toda casilla referencia una carta del catálogo poseída", () => {
  const owned = hereticsCards.slice(0, 3).map((c) => own(c.id));
  const coll = buildTeamCollection(owned);
  const ownedIds = new Set(owned.map((o) => o.cardId));
  for (const cell of coll[0].cards) {
    assert.ok(CARDS.some((c) => c.id === cell.cardId), "la carta existe en el catálogo");
    assert.ok(ownedIds.has(cell.cardId), "y el usuario la posee");
  }
  // Nunca más casillas que cartas distintas poseídas del equipo.
  assert.ok(coll[0].cards.length <= ownedIds.size);
});

test("ordenación por rareza/ovr/valor/reciente/jugador sobre datos existentes", () => {
  // Team Heretics tiene 4 cartas en el catálogo diseñado; la ordenación se mide con 5 cartas reales de G2.
  const g2 = CARDS.filter((c) => getPlayer(c.playerId)?.team === "G2").slice(0, 5);
  assert.equal(g2.length, 5);
  const cards = g2.map((def, i): TeamCardCell => ({
    cardId: def.id, def, uid: `u-${i}`, count: 1, serial: undefined, value: (i + 1) * 100,
    bucket: "common", obtainedAt: i,
  }));
  assert.deepEqual(sortTeamCards(cards, "valor").map((c) => c.value), [500, 400, 300, 200, 100]);
  assert.deepEqual(sortTeamCards(cards, "reciente").map((c) => c.obtainedAt), [4, 3, 2, 1, 0]);
  const byOvr = sortTeamCards(cards, "ovr");
  for (let i = 1; i < byOvr.length; i++) assert.ok(byOvr[i - 1].def.ovr >= byOvr[i].def.ovr);
  const byRank = sortTeamCards(cards, "rareza");
  for (let i = 1; i < byRank.length; i++) {
    assert.ok(getVariant(byRank[i - 1].def.variantId).rank >= getVariant(byRank[i].def.variantId).rank);
  }
});
