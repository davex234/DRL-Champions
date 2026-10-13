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

test("A · precios: Bronce < Plata < Oro < Masters < Champions < ICON Premium (80.000) y el Sobre ICON a 30.000 (2026-10-09)", () => {
  const p = MAIN_PACK_LINE.map(price);
  assert.deepEqual(p, [2500, 6000, 12000, 20000, 35000, 30000, 80000]);
  // La línea va por ESCALÓN, no por precio: el Sobre ICON (1 carta) cuesta menos que Champions (decisión del propietario).
  const ladder = MAIN_PACK_LINE.filter((id) => id !== "icon-single").map(price);
  for (let i = 1; i < ladder.length; i++) assert.ok(ladder[i] > ladder[i - 1]);
});

test("B · el servidor cobra EXACTAMENTE el precio canónico de cada uno de los seis (libro mayor y saldo)", async () => {
  for (const id of MAIN_PACK_LINE) {
    const db = new MemSupabase();
    const U = "aaaaaaaa-0000-4000-8000-000000000574";
    db.seedUser(U, 100_000);   // ICON Premium cuesta 80.000 (2026-10-09)
    const r = await buyPack(db.client, U, id, `g-${id}`, undefined, { expectedPrice: price(id) });
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

test("E · PACK OPENING 3.0 + ICON POR SOBRE: Prime e Icon por carta estrictamente crecientes de Bronce a Champions; ICON = 100 % Icon", () => {
  const five = MAIN_PACK_LINE.filter((id) => id !== "icon" && id !== "icon-single");
  const prime = five.map((id) => mainPackDistribution(id)!.prime);
  const icon = five.map((id) => mainPackDistribution(id)!.icon);
  for (let i = 1; i < prime.length; i++) { assert.ok(prime[i] > prime[i - 1], `prime ${prime}`); assert.ok(icon[i] > icon[i - 1], `icon ${icon}`); }
  // 2026-10-09: los dos sobres ICON solo dan Icon.
  for (const id of ["icon-single", "icon"]) assert.deepEqual([mainPackDistribution(id)!.prime, mainPackDistribution(id)!.icon], [0, 100], id);
  // Bronce: 4 huecos normales (Base 72 % · Plata 25 % · Oro 3 %) + la destacada (Icon 1 %; el resto, 995 ‰ escalado al 99 %).
  const b = mainPackDistribution("estandar")!;
  assert.ok(Math.abs(b.base - (4 * 720 + 990 * 250 / 995) / 50) < 1e-9 && Math.abs(b.prime - (990 * 15 / 995) / 50) < 1e-9 && Math.abs(b.icon - 10 / 50) < 1e-9, JSON.stringify(b));
});

test("F · dos sobres ICON (2026-10-09): `icon-single` 1 carta a 30.000 e `icon` 3 cartas a 80.000, siempre Icon", () => {
  assert.deepEqual([getPack("icon-single")!.cardCount, getPack("icon-single")!.price, getPack("icon")!.cardCount, getPack("icon")!.price], [1, 30000, 3, 80000]);
  for (const id of ["icon-single", "icon"]) {
    const d = mainPackDistribution(id)!;
    assert.equal(d.base + d.plata + d.oro + d.masters + d.champions + d.prime, 0, id);
    assert.equal(d.icon, 100, id);
  }
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
  // PACK OPENING 3.0 (2026-10-07): la línea ya no persigue una banda plana. DOS SOBRES ICON (2026-10-09, precios finales
  // del propietario): el valor por crédito sube estrictamente de Bronce a Champions (0,54× → 0,79×); el Sobre ICON (0,71×)
  // entra en la banda; el ICON Premium a 80.000 (0,796×; a 60.000 era 1,06×) queda POR UN 0,6 % por encima de Champions
  // (0,791×): la regla «sin prima» lo marca por un margen mínimo (a ≥ 80.550 dejaría de marcarlo). Se fija tal cual.
  const out = economyOutliers(cards);
  assert.deepEqual(out.map((o) => o.split(":")[0]), ["estandar", "icon"], out.join(" · "));
  assert.match(out[1], /por encima de todos los demás/);
  const ratios = MAIN_PACK_LINE.filter((id) => id !== "icon" && id !== "icon-single").map((id) => packEconomy(id, cards).ratio);
  for (let i = 1; i < ratios.length; i++) assert.ok(ratios[i] > ratios[i - 1], ratios.map((r) => r.toFixed(3)).join(" < "));
  // (Las comprobaciones con precios F57.4/anteriores se retiraron: medían la distribución F57.3, ya sustituida.)
});

test("J · coste esperado de top tier: P(≥1) = 1 − (1 − p)^n, no n·p", () => {
  // Pack Opening 3.0 · con ranuras, P(≥1) = 1 − (1 − p_normal)^(n − 1) · (1 − p_destacada). Icon por sobre (2026-10-09):
  // la Icon solo vive en la destacada, así que P(≥1 Icon) es EXACTAMENTE la probabilidad configurada por sobre.
  const want = { estandar: 0.01, premium: 0.05, oro: 0.1, masters: 0.15, champions: 0.2, "icon-single": 1, icon: 1 } as Record<string, number>;
  for (const id of MAIN_PACK_LINE) assert.ok(Math.abs(packEconomy(id, cards).topTier.icon.pAtLeastOne - want[id]) < 1e-12, `${id}: P(≥1 Icon)`);
  const b = packEconomy("estandar", cards);
  assert.ok(Math.abs(b.topTier.icon.expectedCost - price("estandar") / 0.01) < 1e-6);
  const i = packEconomy("icon", cards);
  assert.equal(i.topTier.prime.pAtLeastOne, 0);
  assert.equal(i.topTier.primeOrIcon.pAtLeastOne, 1);
  // Coste por Prime: baja estrictamente de Bronce a Champions (los sobres ICON no dan Prime).
  const primeCost = MAIN_PACK_LINE.filter((id) => id !== "icon" && id !== "icon-single").map((id) => packEconomy(id, cards).topTier.prime.costPerCard);
  for (let j = 1; j < primeCost.length; j++) assert.ok(primeCost[j] < primeCost[j - 1], `prime: ${primeCost.map(Math.round).join(" > ")}`);
  // Coste por Icon: los sobres ICON son la vía más barata (Premium 26.667 por Icon < Sobre ICON 30.000); entre los demás ya
  // no baja: Plata = Oro = 120.000 < Masters 133.333 < Champions 175.000 < Bronce 250.000 (informado, sin cambiar).
  assert.deepEqual(MAIN_PACK_LINE.map((id) => Math.round(packEconomy(id, cards).topTier.icon.costPerCard)), [250000, 120000, 120000, 133333, 175000, 30000, 26667]);
});
