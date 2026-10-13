/**
 * FASE 57.4 · BALANCE ECONÓMICO DE LA LÍNEA PRINCIPAL — tests obligatorios A–J del encargo.
 *
 * Precios decididos (auditoría 57.4 + decisión de producto): Bronce 1.000 · Plata 2.500 · Oro 4.000 · Masters 5.000 ·
 * Champions 8.000 · Icon 12.500 (3 cartas, cada una 70 % Prime / 30 % Icon). Las probabilidades de F57.3 no cambian.
 * F80 (2026-10-02, decisión del propietario): Bronce 2.500 · Plata 6.000 · Oro 12.000 · Masters 20.000 · Champions 35.000 ·
 * Icon 60.000. Solo cambian esos seis precios; cartas, probabilidades y sobres especiales, intactos. La escalera ya no
 * mantiene el valor por crédito plano de F57.4: eso lo ACEPTÓ el propietario y los tests I/J lo fijan tal cual.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { CardRegistry } from "@/collection/registry";
import { CARDS } from "@/data/catalog";
import { PACKS, getPack } from "@/data/packs";
import { findStoreProduct, optionFor } from "@/domain/store/resolve";
import { formatCredits } from "@/lib/format";
import { ShopHero } from "@/components/shop/ShopHero";
import { MemSupabase } from "@/server/services/testing/memSupabase";
import { buyPack } from "@/server/services/packs";
import { MAIN_PACK_LINE, mainPackDistribution } from "./packClass";
import { packEconomy, economyOutliers, VALUE_BAND, ICON_FLOOR } from "./packEconomy";

const cards = new CardRegistry().cards;
const price = (id: string) => getPack(id)!.price;

test("A · precios estrictamente crecientes: Bronce < Plata < Oro < Masters < Champions < Icon (y los decididos)", () => {
  const p = MAIN_PACK_LINE.map(price);
  assert.deepEqual(p, [2500, 6000, 12000, 20000, 35000, 60000]); // F80
  for (let i = 1; i < p.length; i++) assert.ok(p[i] > p[i - 1], `${MAIN_PACK_LINE[i]} > ${MAIN_PACK_LINE[i - 1]}`);
});

test("B · el servidor cobra EXACTAMENTE el precio canónico de cada uno de los seis (libro mayor y saldo)", async () => {
  for (const id of MAIN_PACK_LINE) {
    const db = new MemSupabase();
    const U = "aaaaaaaa-0000-4000-8000-000000000574";
    db.seedUser(U, 100_000);   // F80 · Icon cuesta 60.000
    const r = await buyPack(db.client, U, id, `g-${id}`);
    assert.ok(r.ok, `${id}: ${r.ok ? "" : r.error}`);
    const tx = db.table("credit_transactions").filter((t) => t.user_id === U && t.reason === `buy_pack:${id}`);
    assert.equal(tx.length, 1, id);
    assert.equal(Number(tx[0].delta), -price(id), `${id}: asiento`);
    assert.equal(Number(db.table("profiles").find((x) => x.id === U)!.credits), 100_000 - price(id), `${id}: saldo`);
  }
});

test("C · la UI usa el precio canónico: tienda (producto resuelto) y vitrina enseñan pack.price", () => {
  for (const id of MAIN_PACK_LINE) {
    const product = findStoreProduct(`pack:${id}`, Date.now());
    assert.ok(product, `${id} está en la tienda`);
    assert.equal(optionFor(product!, "GAME_CURRENCY")?.price, price(id), `${id}: tienda`);
    const h = renderToStaticMarkup(<ShopHero pack={getPack(id)!} owned={0} credits={0} busy={false} onBuyAndOpen={() => {}} onBuyOnly={() => {}} />);
    assert.ok(h.includes(formatCredits(price(id))), `${id}: vitrina`);
  }
  // Ningún precio antiguo de Icon queda en su vitrina: ni el de F57.4 (12.500) ni el anterior (20.000).
  const iconHero = renderToStaticMarkup(<ShopHero pack={getPack("icon")!} owned={0} credits={0} busy={false} onBuyAndOpen={() => {}} onBuyOnly={() => {}} />);
  for (const old of [12500, 20000]) assert.ok(!iconHero.includes(formatCredits(old)), `icon: ${old}`);
});

test("D · sobres especiales: cartas intactas; precios F57.6 + Pack Opening 3.1 (China y su familia → 9.500, EWC → 8.500)", () => {
  const specials = Object.fromEntries(PACKS.filter((p) => !MAIN_PACK_LINE.includes(p.id)).map((p) => [p.id, [p.price, p.cardCount]]));
  assert.deepEqual(specials, {
    inicial: [0, 5], ewc: [8500, 5], emea: [3500, 5], americas: [3500, 5], pacific: [3500, 5], china: [9500, 5],
    "team-heretics": [3500, 5], "team-fnatic": [3500, 5], "team-navi": [3500, 5], "team-g2": [3500, 5], prime: [10000, 4],
    "team-loud": [3500, 5], "team-blg": [9500, 5], "team-te": [9500, 5], "team-jdg": [9500, 5], "team-liquid": [3500, 5],
    "team-tyl": [9500, 5], "team-karmine": [3500, 5], "team-m8": [3500, 5], "team-fut": [3500, 5], "team-100t": [3500, 5],
    "team-prx": [3500, 5], "team-ns": [3500, 5], "team-ge": [3500, 5], "team-xlg": [9500, 5], "team-lev": [3500, 5],
  });
});

test("E · PACK OPENING 3.0: Prime e Icon por carta (media de las ranuras) estrictamente crecientes en la escalera", () => {
  const prime = MAIN_PACK_LINE.map((id) => mainPackDistribution(id)!.prime);
  const icon = MAIN_PACK_LINE.map((id) => mainPackDistribution(id)!.icon);
  for (let i = 1; i < prime.length; i++) { assert.ok(prime[i] > prime[i - 1], `prime ${prime}`); assert.ok(icon[i] > icon[i - 1], `icon ${icon}`); }
  // Bronce: 4 huecos normales (Base 72 % · Plata 25 % · Oro 3 %) + la destacada → media exacta por carta.
  const b = mainPackDistribution("estandar")!;
  assert.ok(Math.abs(b.base - (4 * 720 + 250) / 50) < 1e-9 && Math.abs(b.prime - 15 / 50) < 1e-9 && Math.abs(b.icon - 5 / 50) < 1e-9, JSON.stringify(b));
});

test("F · Icon: 3 cartas, solo Prime o Icon (dos normales 72/28 y la destacada 50/50)", () => {
  const icon = getPack("icon")!;
  assert.equal(icon.cardCount, 3);
  const d = mainPackDistribution("icon")!;
  assert.equal(d.base + d.plata + d.oro + d.masters + d.champions, 0);
  assert.ok(Math.abs(d.prime - 194 / 3) < 1e-9 && Math.abs(d.icon - 106 / 3) < 1e-9);
});

test("G · el catálogo sigue siendo de 331 cartas", () => {
  assert.equal(CARDS.length, 331);
  assert.equal(cards.length, 331);
});

test("H · EV calculable y coherente para los seis (EV/sobre = EV/carta × cartas; positivo y finito)", () => {
  for (const id of MAIN_PACK_LINE) {
    const e = packEconomy(id, cards);
    assert.ok(Number.isFinite(e.evPerCard) && e.evPerCard > 0, id);
    assert.ok(Math.abs(e.evPerPack - e.evPerCard * getPack(id)!.cardCount) < 1e-6, id);
    assert.equal(e.price, price(id));
  }
});

test(`I · F80: la banda de F57.4 (±${VALUE_BAND * 100} % de la mediana; Icon ≥ ${ICON_FLOOR} × mediana) ya NO se cumple, y es EXACTAMENTE lo aceptado`, () => {
  // PACK OPENING 3.0 (2026-10-07): la línea ya no persigue una banda plana. El valor por crédito SUBE estrictamente de
  // Bronce a Icon (0,50× → 0,83×): ahorrar para un sobre mayor compensa también en valor. La banda F57.4 lo marca (Bronce
  // y Plata por debajo; Icon «sin prima»): se fija el conjunto exacto para que otro cambio vuelva a romper el test.
  const out = economyOutliers(cards);
  assert.deepEqual(out.map((o) => o.split(":")[0]), ["estandar", "premium", "icon"], out.join(" · "));
  const ratios = MAIN_PACK_LINE.map((id) => packEconomy(id, cards).ratio);
  for (let i = 1; i < ratios.length; i++) assert.ok(ratios[i] > ratios[i - 1], ratios.map((r) => r.toFixed(3)).join(" < "));
  // (Las comprobaciones con precios F57.4/anteriores se retiraron: medían la distribución F57.3, ya sustituida.)
});

test("J · coste esperado de top tier: P(≥1) = 1 − (1 − p)^n, no n·p", () => {
  // Pack Opening 3.0 · con ranuras, P(≥1) = 1 − (1 − p_normal)^(n − 1) · (1 − p_destacada).
  const b = packEconomy("estandar", cards);
  assert.ok(Math.abs(b.topTier.icon.pAtLeastOne - 0.005) < 1e-12, "Bronce: Icon solo en la destacada (0,5 %)");
  assert.ok(Math.abs(b.topTier.icon.expectedCost - price("estandar") / 0.005) < 1e-6);
  const i = packEconomy("icon", cards);
  assert.ok(Math.abs(i.topTier.prime.pAtLeastOne - (1 - 0.28 * 0.28 * 0.5)) < 1e-12);
  assert.ok(Math.abs(i.topTier.icon.pAtLeastOne - (1 - 0.72 * 0.72 * 0.5)) < 1e-12);
  assert.equal(i.topTier.primeOrIcon.pAtLeastOne, 1);
  // El coste por Prime y por Icon BAJA estrictamente al subir de sobre: el camino más barato hacia la élite es Icon.
  for (const k of ["prime", "icon"] as const) {
    const cost = MAIN_PACK_LINE.map((id) => packEconomy(id, cards).topTier[k].costPerCard);
    for (let j = 1; j < cost.length; j++) assert.ok(cost[j] < cost[j - 1], `${k}: ${cost.map(Math.round).join(" > ")}`);
  }
});
