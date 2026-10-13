import test from "node:test";
import assert from "node:assert/strict";
import {
  PRESTIGE_TIERS, PRESTIGE_TOTAL, prestigeId, parsePrestige, prestigeTier,
  prestigeOffers, fullBadgeOf, highestTierOf, burnedOn, prestigeRef,
} from "./prestige";
import { masterySets, allMasteryRewards } from "./mastery";
import { cosmetic } from "@/domain/cosmetics/catalog";

/** Ritmo medido del perfil que se satura (`economy:simulate`, escenario de saturación). */
const SATURATED_PER_DAY = 1995;

const badges = () => masterySets().map(fullBadgeOf).filter((x): x is string => !!x);

test("los escalones van de menor a mayor precio y sin repetir", () => {
  const prices = PRESTIGE_TIERS.map((t) => t.price);
  assert.deepEqual(prices, [...prices].sort((a, b) => a - b));
  assert.equal(new Set(PRESTIGE_TIERS.map((t) => t.id)).size, PRESTIGE_TIERS.length);
  assert.deepEqual(PRESTIGE_TIERS.map((t) => t.rank), [1, 2, 3]);
});

test("EL PRESTIGIO ES UN SUMIDERO: cuesta creditos y no devuelve NADA", () => {
  /*
   * La razón de ser de esta capa. La Fase 13 dejó el endgame abierto porque la maestría
   * daba objetivos pero no gasto; si el prestigio devolviera algo —créditos, XP, sobres,
   * cartas— dejaría de ser un sumidero y volvería a ser parte del problema.
   *
   * Un escalón es un precio y un color. Nada más.
   */
  for (const t of PRESTIGE_TIERS) {
    assert.ok(t.price > 0, `${t.id} no cuesta nada`);
    assert.equal(Object.keys(t).sort().join(","), "color,id,label,price,rank",
      `${t.id} tiene campos que no deberia: ${Object.keys(t).join(", ")}`);
  }
});

test("los precios estan calibrados contra el jugador que SE SATURA", () => {
  /*
   * Medido en la Fase 14: el único perfil que se satura acumula 1.995 créditos al día.
   * Los precios se eligieron contra esa cifra, así que la prueba la vuelve a comprobar: si
   * alguien los toca sin volver a medir, esto dice cuánto se ha desviado.
   *
   * Llevar UN conjunto a élite tiene que costar del orden de una temporada de acumulación
   * (167.582 créditos), no de una tarde ni de un año.
   */
  const days = PRESTIGE_TOTAL / SATURATED_PER_DAY;
  assert.ok(days > 40 && days < 120,
    `llevar un conjunto a elite cuesta ${days.toFixed(0)} dias del perfil saturado`);

  // Y el primer escalón tiene que ser alcanzable en menos de dos semanas: si el primer paso
  // costara un mes, nadie empezaría.
  const first = PRESTIGE_TIERS[0].price / SATURATED_PER_DAY;
  assert.ok(first < 14, `el primer escalon cuesta ${first.toFixed(1)} dias`);
});

test("el sumidero tiene mas capacidad que el grifo, y por mucho", () => {
  /*
   * Un sumidero que se agota deja de serlo. Con las insignias que existen hoy, la capacidad
   * total tiene que dar para años del perfil que más acumula — porque el jugador elige a
   * qué conjuntos dedicar créditos, no los compra todos.
   */
  const capacity = badges().length * PRESTIGE_TOTAL;
  const years = capacity / SATURATED_PER_DAY / 365;
  assert.ok(years > 5, `capacidad de solo ${years.toFixed(1)} anos`);
});

test("solo se prestigia la insignia de PLENO, nunca la de a medias", () => {
  /*
   * Si se pudiera prestigiar un conjunto a medio hacer, los créditos sustituirían al
   * trabajo de coleccionar. La regla es la contraria: lo reconocen.
   */
  for (const set of masterySets()) {
    const base = fullBadgeOf(set);
    assert.ok(base, `${set.id} sin insignia de pleno`);
    assert.ok(!base!.endsWith("-medio"), `${set.id} prestigia la de a medias: ${base}`);
    const full = set.tiers.find((t) => t.at === 1)!;
    assert.ok((full.reward.cosmetics ?? []).includes(base!));
  }
});

test("un id mejorado se descompone en su base y su escalon", () => {
  const base = badges()[0];
  for (const t of PRESTIGE_TIERS) {
    const id = prestigeId(base, t.id);
    const parsed = parsePrestige(id);
    assert.ok(parsed, `no se pudo descomponer ${id}`);
    assert.equal(parsed!.baseId, base);
    assert.equal(parsed!.tier.id, t.id);
  }
  // Una insignia base no está mejorada, y decirlo es lo que evita cobrarla dos veces.
  assert.equal(parsePrestige(base), null);
  assert.equal(parsePrestige("insignia"), null);
});

test("todo id mejorado se puede pintar, y con el color de su escalon", () => {
  // 231 ids derivados (77 insignias × 3 escalones) y ninguno escrito a mano.
  for (const base of badges()) {
    for (const t of PRESTIGE_TIERS) {
      const def = cosmetic(prestigeId(base, t.id));
      assert.ok(def, `sin definicion: ${base}:${t.id}`);
      assert.equal(def!.family, "insignia");
      assert.equal(def!.color, t.color, `${base}:${t.id} no lleva el color de su escalon`);
      assert.ok(def!.label.includes(t.label), `${def!.label} no dice el escalon`);
    }
  }
});

test("sin la insignia base no se ofrece NINGUN escalon", () => {
  assert.deepEqual(prestigeOffers(new Set()), []);
  assert.deepEqual(prestigeOffers(new Set(["marco:neon", "titulo:analista"])), []);
});

test("se ofrece UN escalon por conjunto, y es el siguiente", () => {
  const base = badges()[0];
  const owned = new Set([base]);

  let offers = prestigeOffers(owned);
  assert.equal(offers.length, 1);
  assert.equal(offers[0].tier.id, "plata");
  assert.equal(offers[0].requires, base, "el primer escalon exige la insignia base");

  owned.add(prestigeId(base, "plata"));
  offers = prestigeOffers(owned);
  assert.equal(offers[0].tier.id, "oro");
  assert.equal(offers[0].requires, prestigeId(base, "plata"), "el segundo exige el primero");

  owned.add(prestigeId(base, "oro"));
  assert.equal(prestigeOffers(owned)[0].tier.id, "elite");

  // Con élite ya comprado, ese conjunto sale de la lista: no hay nada más que venderle.
  owned.add(prestigeId(base, "elite"));
  assert.equal(prestigeOffers(owned).length, 0);
});

test("no se puede saltar un escalon", () => {
  /*
   * Comprar élite sin pasar por plata y oro costaría 100.000 en vez de 155.000. Es la clase
   * de atajo que convierte un sumidero calibrado en uno que recauda un tercio menos.
   */
  const base = badges()[0];
  const offers = prestigeOffers(new Set([base]));
  assert.equal(offers.length, 1, "se ofrece mas de un escalon a la vez");
  assert.notEqual(offers[0].tier.id, "elite");
});

test("el escalon mas alto conseguido es el que manda", () => {
  const base = badges()[0];
  assert.equal(highestTierOf(base, new Set([base])), null);
  assert.equal(highestTierOf(base, new Set([base, prestigeId(base, "plata")]))!.id, "plata");
  assert.equal(
    highestTierOf(base, new Set([base, prestigeId(base, "plata"), prestigeId(base, "oro")]))!.id,
    "oro",
  );
});

test("lo quemado se cuenta sumando lo comprado, no un contador aparte", () => {
  const [a, b] = badges();
  const owned = new Set([a, b, prestigeId(a, "plata"), prestigeId(a, "oro"), prestigeId(b, "plata")]);
  assert.equal(burnedOn(owned), 15_000 + 40_000 + 15_000);
  // Las insignias base no cuentan: son gratis.
  assert.equal(burnedOn(new Set([a, b])), 0);
});

test("la clave de idempotencia identifica jugador, insignia Y escalon", () => {
  const [a, b] = badges();
  const U = "user-1";
  assert.notEqual(prestigeRef(U, a, "plata"), prestigeRef(U, a, "oro"));
  assert.notEqual(prestigeRef(U, a, "plata"), prestigeRef(U, b, "plata"));
  // Fase 41 · dos jugadores distintos NUNCA comparten clave (economy_ops.ref es global).
  assert.notEqual(prestigeRef("user-1", a, "plata"), prestigeRef("user-2", a, "plata"));
  const all = badges().flatMap((x) => PRESTIGE_TIERS.map((t) => prestigeRef(U, x, t.id)));
  assert.equal(new Set(all).size, all.length, "hay claves repetidas");
});

test("un escalon inventado no existe", () => {
  assert.equal(prestigeTier("diamante"), null);
  assert.equal(prestigeTier(""), null);
  assert.ok(prestigeTier("oro"));
});

test("la maestria SIGUE sin repartir creditos despues de anadir el prestigio", () => {
  // El prestigio cobra; la maestría no puede haber empezado a pagar por el camino.
  for (const r of allMasteryRewards()) {
    assert.equal(r.credits ?? 0, 0);
    assert.equal(r.xp ?? 0, 0);
  }
});
