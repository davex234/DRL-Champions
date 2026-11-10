/**
 * FASE 37 · COLLECTION ROOM — definición ≠ instancia, progreso, duplicados, mejor carta, seriales, sets, variantes,
 * disponibilidad en sobres y sobre → colección. Puro. Catálogo REAL cuando la afirmación va sobre el contenido real.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CARDS, getCard, getPlayer } from "@/data/catalog";
import { CARD_MANIFEST } from "@/data/cardCatalog";
import { PACKS } from "@/data/packs";
import { CardRegistry } from "@/collection";
import { getVariant } from "@/domain/cards/variants";
import { bucketForRank, type PackDef } from "@/domain/packs/types";
import type { CardDef, Player } from "@/domain/cards/types";
import {
  buildCollectionSnapshot, completionPct, isNearComplete, NEAR_MIN_TOTAL, serialPrestige, formatSerial, sortInstances,
  playerVariants, packsThatCanContain, bestOpenedCardId, isValidCardId, cardHref, compareHref, teamKeyOf, cardTeamKeyOf, EDITION_ORDER, rarityOf,
  type CollectionPersonalFacts, type OwnedInstanceFact,
} from "./room";

const none: CollectionPersonalFacts = { instances: [], favorites: [], showcaseUids: [], decks: [] };
const inst = (cardId: string, uid: string, serial: number | null = null): OwnedInstanceFact => ({ uid, cardId, serial, mintedVersion: 1 });
const snap = (p: Partial<CollectionPersonalFacts> = {}) => buildCollectionSnapshot(CARDS, getPlayer, { ...none, ...p });
const A = CARDS[0]; const B = CARDS[1]; const C = CARDS[2];

/*
 * SERIALES SIN CARTAS SERIALIZADAS EN EL CATÁLOGO. El catálogo diseñado (2026-09-21) no tiene ediciones con
 * tirada limitada (no se decidió ninguna), pero la lógica de seriales sigue existiendo. Para probarla se usan
 * definiciones LOCALES de jugadores reales en una variante serializada (`prime`); no entran en el catálogo.
 */
const SERIAL_A: CardDef = { ...A, id: `${A.playerId}__prime`, variantId: "prime" };
const SERIAL_B: CardDef = { ...B, id: `${B.playerId}__prime`, variantId: "prime" };
const snapSer = (p: Partial<CollectionPersonalFacts> = {}) =>
  buildCollectionSnapshot([...CARDS, SERIAL_A, SERIAL_B], getPlayer, { ...none, ...p });

/* ───────────── catálogo real ───────────── */

test("CATÁLOGO · una definición por carta del manifiesto (Cartas\), ids únicos y con formato canónico", () => {
  assert.equal(CARDS.length, CARD_MANIFEST.length);
  assert.equal(new Set(CARDS.map((c) => c.id)).size, CARDS.length);
  assert.ok(CARDS.every((c) => isValidCardId(c.id)));
});

test("CATÁLOGO · toda carta tiene jugador real, stats de combate y una de las 5 rarezas del motor", () => {
  const rarities = new Set(CARDS.map(rarityOf));
  assert.deepEqual([...rarities].sort(), ["common", "epic", "legendary", "rare", "uncommon"]);
  assert.ok(CARDS.every((c) => !!getPlayer(c.playerId) && !!c.combat));
});

test("CATÁLOGO · el total NO está escrito a mano: sale de las definiciones que se le pasan", () => {
  assert.equal(snap().catalogTotal, CARDS.length);
  assert.equal(buildCollectionSnapshot(CARDS.slice(0, 10), getPlayer, none).catalogTotal, 10);
});

/* ───────────── progreso y copias ───────────── */

test("PROGRESO · 0 poseídas: 0 / 772, 0 %", () => {
  const s = snap();
  assert.deepEqual([s.uniqueOwned, s.totalCopies, s.duplicates, s.completionPct], [0, 0, 0, 0]);
  assert.equal(s.best, null);
});

test("PROGRESO · 1 poseída: 1 / total y el porcentaje redondeado HACIA ABAJO", () => {
  const s = snap({ instances: [inst(A.id, "u1")] });
  assert.equal(s.uniqueOwned, 1);
  const exacto = (100 * 1) / CARDS.length;
  assert.equal(s.completionPct, Math.floor(exacto * 10) / 10);
  assert.ok(s.completionPct <= exacto, "nunca redondea hacia arriba");
});

test("PROGRESO · 7 copias de la misma carta siguen siendo 1 / 772; duplicadas = 6", () => {
  const s = snap({ instances: Array.from({ length: 7 }, (_, i) => inst(A.id, `u${i}`)) });
  assert.equal(s.uniqueOwned, 1);
  assert.equal(s.totalCopies, 7);
  assert.equal(s.duplicates, 6);
  assert.equal(s.byCard.get(A.id)!.count, 7);
});

test("PROGRESO · todas poseídas = 100 %", () => {
  const s = buildCollectionSnapshot(CARDS.slice(0, 5), getPlayer, { ...none, instances: CARDS.slice(0, 5).map((c, i) => inst(c.id, `u${i}`)) });
  assert.equal(s.completionPct, 100);
});

test("PROGRESO · nunca «100,0 %» sin estar completo", () => {
  assert.equal(completionPct(999, 1000), 99.9);
  assert.equal(completionPct(771, 772), 99.8);
  assert.equal(completionPct(5, 0), 0);
  assert.equal(completionPct(12, 10), 100);
});

test("HISTÓRICAS · copias cuyo card_id ya no está en el catálogo se cuentan aparte, nunca en el álbum", () => {
  const s = snap({ instances: [inst("retirado__gold", "x1"), inst(A.id, "u1")] });
  assert.equal(s.unknownInstances, 1);
  assert.equal(s.uniqueOwned, 1);
  assert.equal(s.totalCopies, 1);
});

/* ───────────── mejor carta y seriales ───────────── */

test("MAYOR OVR · criterio: OVR ↓ → rareza ↓ → serial ↑ → id", () => {
  const top = [...CARDS].sort((a, b) => b.ovr - a.ovr || getVariant(b.variantId).rank - getVariant(a.variantId).rank)[0];
  const s = snap({ instances: [inst(A.id, "u1"), inst(top.id, "u2", 40)] });
  assert.equal(s.best!.cardId, top.id);
  assert.equal(s.highestOvr, top.ovr);
});

test("MAYOR OVR · a igualdad total, gana el serial más bajo y se cita ESA copia", () => {
  const serialized = SERIAL_A;
  assert.ok(getVariant(serialized.variantId).serialized);
  const s = snapSer({ instances: [inst(serialized.id, "hi", 90), inst(serialized.id, "lo", 3)] });
  assert.deepEqual(s.best, { cardId: serialized.id, uid: "lo", serial: 3 });
});

test("SERIALES · #1 contado, serial más bajo real, copias sin serial fuera", () => {
  const sa = [SERIAL_A, SERIAL_B];
  const s = snapSer({ instances: [inst(sa[0].id, "a", 1), inst(sa[1].id, "b", 7), inst(A.id, "c", null)] });
  assert.equal(s.serials.owned, 2);
  assert.equal(s.serials.number1, 1);
  assert.deepEqual(s.serials.lowest, { cardId: sa[0].id, uid: "a", serial: 1 });
});

test("SERIAL · prestigio visual: #1, Top 10, Top 100 y nada más", () => {
  assert.deepEqual(serialPrestige(1), { tier: "NUMBER_ONE", label: "#1" });
  assert.equal(serialPrestige(10)!.label, "Top 10");
  assert.equal(serialPrestige(11)!.label, "Top 100");
  assert.equal(serialPrestige(100)!.label, "Top 100");
  assert.equal(serialPrestige(101), null);
  assert.equal(serialPrestige(null), null);
  assert.equal(serialPrestige(0), null);
  assert.equal(serialPrestige(2.5), null);
});

test("SERIAL · formato canónico #N/tope; sin serial, nada", () => {
  assert.equal(formatSerial(42, 500), "#42/500");
  assert.equal(formatSerial(42, null), "#42");
  assert.equal(formatSerial(null, 500), null);
});

test("SERIAL · el prestigio no toca la definición: OVR y stats iguales con cualquier serial", () => {
  const serialized = SERIAL_A;
  const s1 = snapSer({ instances: [inst(serialized.id, "a", 1)] });
  const s2 = snapSer({ instances: [inst(serialized.id, "b", 250)] });
  assert.equal(s1.highestOvr, s2.highestOvr);
  // La definición serializada comparte trío con la carta real del jugador: el serial no lo toca.
  assert.deepEqual(serialized.combat, getCard(A.id)!.combat);
});

test("COPIAS · orden canónico: serial ascendente, sin serial al final, después uid", () => {
  const list = sortInstances([{ uid: "z", serial: null }, { uid: "b", serial: 9 }, { uid: "a", serial: null }, { uid: "c", serial: 2 }]);
  assert.deepEqual(list.map((x) => x.uid), ["c", "b", "a", "z"]);
});

/* ───────────── favoritos, vitrina y equipos ───────────── */

test("FAVORITOS · solo definiciones del catálogo; null = no disponible (no se inventan)", () => {
  const s = snap({ favorites: [A.id, "no__existe", B.id] });
  assert.deepEqual(s.favorites, [A.id, B.id].sort());
  assert.equal(s.favoritesAvailable, true);
  assert.equal(snap({ favorites: null }).favoritesAvailable, false);
});

test("FAVORITOS · marcan la fila poseída; una favorita no poseída no inventa copia", () => {
  const s = snap({ instances: [inst(A.id, "u1")], favorites: [A.id, B.id] });
  assert.equal(s.byCard.get(A.id)!.favorite, true);
  assert.equal(s.byCard.has(B.id), false);
});

test("VITRINA · se marca la copia exacta que está en la vitrina", () => {
  const s = snap({ instances: [inst(A.id, "u1"), inst(A.id, "u2")], showcaseUids: ["u2"] });
  assert.deepEqual(s.byCard.get(A.id)!.showcaseUids, ["u2"]);
});

test("EQUIPOS · usada en N equipos distintos y en el activo, sin contar dos veces el mismo", () => {
  const s = snap({
    instances: [inst(A.id, "u1"), inst(A.id, "u2"), inst(B.id, "u3")],
    decks: [{ id: "d1", name: "Uno", active: true, cardUids: ["u1", "u2"] }, { id: "d2", name: "Dos", active: false, cardUids: ["u2", "u3"] }],
  });
  assert.deepEqual(s.byCard.get(A.id)!.deckIds, ["d1", "d2"]);
  assert.equal(s.byCard.get(A.id)!.inActiveDeck, true);
  assert.equal(s.byCard.get(B.id)!.inActiveDeck, false);
});

test("AISLAMIENTO · vitrina o equipos no disponibles → marcados como tales, el álbum sigue", () => {
  const s = snap({ instances: [inst(A.id, "u1")], showcaseUids: null, decks: null });
  assert.equal(s.showcaseAvailable, false);
  assert.equal(s.decksAvailable, false);
  assert.equal(s.uniqueOwned, 1);
});

/* ───────────── sets ───────────── */

test("SETS · rareza: los 5 buckets reales suman el catálogo", () => {
  const s = snap();
  assert.equal(s.sets.rarity.reduce((n, x) => n + x.total, 0), CARDS.length);
  assert.deepEqual(s.sets.rarity.map((x) => x.key), ["legendary", "epic", "rare", "uncommon", "common"]);
});

test("SETS · rol: cinco roles reales, Flex incluido", () => {
  assert.deepEqual(snap().sets.role.map((x) => x.key), ["Duelista", "Iniciador", "Controlador", "Centinela", "Flex"]);
});

test("SETS · región: las cuatro regiones reales suman el catálogo", () => {
  const s = snap();
  assert.deepEqual(s.sets.region.map((x) => x.key), ["EMEA", "Americas", "Pacific", "China"]);
  assert.equal(s.sets.region.reduce((n, x) => n + x.total, 0), CARDS.length);
});

test("SETS · equipo: la identidad verificada une alias («Fnatic» y «FNC»), el resto queda tal cual", () => {
  assert.equal(teamKeyOf("FNC").key, teamKeyOf("Fnatic").key);
  assert.equal(teamKeyOf("Fnatic").key, "fnatic");
  assert.ok(teamKeyOf("Equipo Inventado QA").key.startsWith("raw:"));
  const s = snap();
  assert.equal(s.sets.team.reduce((n, x) => n + x.total, 0), CARDS.length);
  assert.equal(s.sets.team.filter((x) => x.key === "fnatic").length, 1);
});

test("SETS · edición: las 7 ediciones reales del catálogo, sin etiquetas fantasma", () => {
  // Catálogo diseñado (2026-09-21): la edición es la variante. Exactamente las de las cartas que hay, en orden
  // de rareza, con su etiqueta; ni un grupo antiguo (regional, MVP, ganadores…).
  const reales = [...new Set(CARDS.map((c) => c.variantId))].sort();
  assert.deepEqual(reales, ["base", "champions-s", "future-star", "masters-l", "masters-sdc", "moments", "record-breaker"]);
  assert.deepEqual([...EDITION_ORDER].sort(), reales);
  assert.deepEqual(EDITION_ORDER, ["moments", "record-breaker", "champions-s", "future-star", "masters-l", "masters-sdc", "base"]);
  const sets = snap().sets.edition;
  assert.deepEqual(sets.map((x) => x.key), EDITION_ORDER, "los sets siguen el orden de rareza");
  for (const s of sets) {
    assert.equal(s.label, getVariant(s.key as never).label);
    assert.equal(s.total, CARDS.filter((c) => c.variantId === s.key).length);
  }
});

test("SETS · progreso parcial y completo reales sobre un equipo", () => {
  const key = cardTeamKeyOf(A, getPlayer(A.playerId)).key;
  const teamCards = CARDS.filter((c) => cardTeamKeyOf(c, getPlayer(c.playerId)).key === key);
  const partial = snap({ instances: [inst(teamCards[0].id, "u1")] }).sets.team.find((s) => s.key === key)!;
  assert.equal(partial.owned, 1);
  assert.equal(partial.complete, false);
  const full = snap({ instances: teamCards.map((c, i) => inst(c.id, `u${i}`)) }).sets.team.find((s) => s.key === key)!;
  assert.equal(full.complete, true);
  assert.equal(full.missing, 0);
});

test("CASI COMPLETO · ≥ 70 %, < 100 % y set de al menos 5", () => {
  assert.equal(NEAR_MIN_TOTAL, 5);
  assert.equal(isNearComplete(7, 10), true);
  assert.equal(isNearComplete(6, 10), false);
  assert.equal(isNearComplete(10, 10), false);
  assert.equal(isNearComplete(3, 4), false, "un set de 4 no es «casi completo» aunque vaya al 75 %");
  assert.equal(isNearComplete(1, 1), false);
  assert.equal(isNearComplete(0, 0), false);
});

test("CASI COMPLETO · se listan los reales, ordenados por % y por lo que falta", () => {
  const key = cardTeamKeyOf(A, getPlayer(A.playerId)).key;
  const teamCards = CARDS.filter((c) => cardTeamKeyOf(c, getPlayer(c.playerId)).key === key);
  const need = Math.ceil(teamCards.length * 0.7);
  const s = snap({ instances: teamCards.slice(0, need).map((c, i) => inst(c.id, `u${i}`)) });
  if (teamCards.length >= 5 && need < teamCards.length) assert.ok(s.nearComplete.some((x) => x.id === `team:${key}`));
  for (let i = 1; i < s.nearComplete.length; i++) assert.ok(s.nearComplete[i - 1].pct >= s.nearComplete[i].pct);
});

/* ───────────── variantes ───────────── */

test("VARIANTES · todas las definiciones de un jugador, de más común a más rara, con cuáles tienes", () => {
  const pid = A.playerId;
  const all = CARDS.filter((c) => c.playerId === pid);
  const s = snap({ instances: [inst(all[0].id, "u1"), inst(all[0].id, "u2")] });
  const v = playerVariants(CARDS, pid, s);
  assert.equal(v.total, all.length);
  assert.equal(v.owned, 1);
  assert.equal(v.rows.find((r) => r.cardId === all[0].id)!.count, 2);
  for (let i = 1; i < v.rows.length; i++) assert.ok(v.rows[i - 1].rank <= v.rows[i].rank);
});

test("VARIANTES · sin sesión no hay «tienes»", () => {
  const v = playerVariants(CARDS, A.playerId, null);
  assert.ok(v.rows.every((r) => !r.owned && r.count === 0));
  assert.equal(v.owned, 0);
});

/* ───────────── disponibilidad ───────────── */

const reg = new CardRegistry();
const pack = (o: Partial<PackDef>): PackDef => ({ ...PACKS.find((p) => p.lifecycle === "ACTIVE")!, ...o } as PackDef);

test("SOBRES · solo sobres ACTIVOS a la venta y con la MISMA elegibilidad del motor", () => {
  const list = packsThatCanContain(reg, PACKS, A);
  assert.ok(list.length > 0);
  for (const a of list) {
    const p = PACKS.find((x) => x.id === a.packId)!;
    assert.equal((p.lifecycle ?? "ACTIVE") !== "DRAFT" && !p.retired, true, a.packId);
  }
});

test("SOBRES · DRAFT y RETIRED no se ofrecen nunca", () => {
  const draft = pack({ id: "qa-draft", name: "QA Draft", lifecycle: "DRAFT", pool: [A.id] });
  const retired = pack({ id: "qa-retired", name: "QA Retired", lifecycle: "RETIRED", pool: [A.id] });
  assert.deepEqual(packsThatCanContain(reg, [draft, retired], A), []);
});

test("SOBRES · un pool que no incluye la carta no la ofrece", () => {
  const only = pack({ id: "qa-only", name: "QA Only", lifecycle: "ACTIVE", pool: [B.id] });
  assert.deepEqual(packsThatCanContain(reg, [only], A), []);
  assert.deepEqual(packsThatCanContain(reg, [only], B).map((x) => x.packId), ["qa-only"]);
});

/* ───────────── sobre → colección y rutas ───────────── */

test("SOBRE → COLECCIÓN · lleva a la carta de variante más rara del botín (después OVR)", () => {
  const legendary = CARDS.find((c) => bucketForRank(getVariant(c.variantId).rank) === "legendary")!;
  assert.equal(bestOpenedCardId([{ cardId: A.id }, { cardId: legendary.id }, { cardId: C.id }], getCard), legendary.id);
  assert.equal(bestOpenedCardId([], getCard), null);
  assert.equal(bestOpenedCardId([{ cardId: "../../etc" }], getCard), null);
});

test("RUTAS · id validado: rechaza traversal, mayúsculas, espacios, vacíos y longitudes absurdas", () => {
  for (const bad of ["../x__y", "Benjy__silver", "benjy silver", "", "benjy__", "__silver", `${"a".repeat(65)}__gold`, "benjy__silver/../..", 42, null]) {
    assert.equal(isValidCardId(bad), false, String(bad));
  }
  assert.equal(isValidCardId("benjy__emea-winner"), true);
});

test("RUTAS · enlaces estables y codificados", () => {
  assert.equal(cardHref("benjy__silver"), "/coleccion/carta/benjy__silver");
  assert.equal(compareHref("a__gold", "b__silver"), "/coleccion/comparar?a=a__gold&b=b__silver");
  assert.equal(compareHref("a__gold"), "/coleccion/comparar?a=a__gold");
});

test("RENDIMIENTO · la foto del catálogo completo con miles de copias se calcula en milisegundos", () => {
  const many = Array.from({ length: 5000 }, (_, i) => inst(CARDS[i % CARDS.length].id, `u${i}`, null));
  const t0 = Date.now();
  const s = buildCollectionSnapshot(CARDS, getPlayer, { ...none, instances: many });
  assert.ok(Date.now() - t0 < 500, `${Date.now() - t0} ms`);
  assert.equal(s.uniqueOwned, CARDS.length);
  assert.equal(s.completionPct, 100);
});

void ({} as Player | CardDef);
