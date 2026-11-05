/**
 * F72.4 · TIENDA SIMPLIFICADA — CATÁLOGO MÍNIMO → DETALLE → PROBABILIDADES → CONFIRMACIÓN.
 *
 * S1 la tarjeta del catálogo de TODA clase de producto enseña solo arte + nombre + precio + COMPRAR (+ insignias).
 * S2 COMPRAR abre el detalle (no llama a la compra); el cobro solo sale de «Confirmar compra».
 * S3 CONTRATO UI ≡ SERVIDOR: los porcentajes del detalle salen de la MISMA fuente que usa `openPack` para abrir el sobre
 *    (tabla por clase en la línea principal; reparto medido con el motor real en el resto), y el motor real, sorteando,
 *    reproduce la tabla que enseña la interfaz.
 * S4 el detalle enseña nº de cartas, probabilidades, precio, saldo y saldo después, y el botón de confirmar.
 * S5 un sobre publicado desde el panel (CMS) adopta tarjeta y detalle sin tocar el frontend.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { resolveStore } from "@/domain/store/resolve";
import { getPack, applyRuntimePacks, PACKS } from "@/data/packs";
import { packStats } from "@/data/packStats";
import { CardRegistry } from "@/collection/registry";
import { openPack } from "@/domain/packs/openPack";
import { freshPity } from "@/domain/packs/pity";
import { mainPackDistribution, packDistribution, activeClasses, packCardClass, iconChanceOf, MAIN_PACK_LINE } from "@/domain/packs/packClass";
import { normalizedWeights, pct } from "@/domain/packs/odds";
import { formatCredits } from "@/lib/format";
import type { PackDef } from "@/domain/packs/types";
import type { ResolvedProduct } from "@/domain/store/types";
import { BoxOfferCard, BundleOfferCard, CardOfferCard, PackOfferCard } from "./StoreProducts";
import { PurchaseDetails } from "./PurchaseModal";
import { catalogPrice, productName, productOdds } from "./storeView";

const NOW = Date.parse("2026-09-21T12:00:00Z");
const view = resolveStore(NOW);
const noop = () => undefined;
/** Texto VISIBLE: sin etiquetas y sin el texto dibujado dentro de un SVG (el «×10» de la caja es arte). */
const text = (html: string) => html.replace(/<svg[\s\S]*?<\/svg>/g, " ").replace(/<[^>]+>/g, " ").replace(/&[a-z]+;|&#\d+;/g, " ").replace(/\s+/g, " ").trim();
const ALL: ResolvedProduct[] = [...view.packs, ...view.boxes, ...view.cards, ...view.bundles];

function renderCard(p: ResolvedProduct): string {
  switch (p.kind) {
    case "PACK": return renderToStaticMarkup(<PackOfferCard product={p} owned={0} index={0} onSelect={noop} />);
    case "BOX": return renderToStaticMarkup(<BoxOfferCard product={p} index={0} onSelect={noop} />);
    case "CARD": return renderToStaticMarkup(<CardOfferCard product={p} index={0} onSelect={noop} />);
    case "BUNDLE": return renderToStaticMarkup(<BundleOfferCard product={p} index={0} onSelect={noop} />);
  }
}
const details = (p: ResolvedProduct, credits = 9725) =>
  renderToStaticMarkup(<PurchaseDetails product={p} credits={credits} owned={0} phase={{ at: "confirm" }} onConfirm={noop} onOpenNow={noop} onClose={noop} titleId="t" />);

test("S1 · catálogo: TODA tarjeta = arte + nombre + precio + COMPRAR (+ insignias); nada de %, nº de cartas, €, rarezas ni contenido", () => {
  assert.ok(ALL.length >= 20, "hay productos de las cuatro clases");
  const BADGES = /^(Destacado |Nuevo |Próximamente |\d+ sin abrir )*/;
  for (const p of ALL) {
    const html = renderCard(p);
    const t = text(html);
    const price = catalogPrice(p).text;
    const cta = p.status !== "AVAILABLE" ? "Ver" : price === "Gratis" ? "Conseguir" : "Comprar";
    const core = t.replace(BADGES, "").replace(/ ?DRL Credits/, "");
    assert.equal(core, `${productName(p)} ${price} ${cta}`, `${p.productId}: «${t}»`);
    assert.ok(!/%|cartas|carta aleatoria|€|Por anunciar ·|Puede traer|OVR|×/.test(t), `${p.productId}: información de detalle en el catálogo`);
    assert.match(html, /data-product-art/, `${p.productId}: zona de arte`);
    assert.match(html, new RegExp(`aria-label="${cta} ${productName(p).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`), `${p.productId}: botón con nombre accesible`);
    assert.match(html, /aria-haspopup="dialog"/, "el botón abre un diálogo, no compra");
  }
});

test("S1 · el precio de la tarjeta es el del PackDef/configuración (sin tocar): créditos del sobre, o «por anunciar»", () => {
  for (const p of view.packs) assert.equal(catalogPrice(p).text, getPack(p.packId!)!.price === 0 ? "Gratis" : formatCredits(getPack(p.packId!)!.price), p.productId);
  for (const p of [...view.boxes, ...view.cards, ...view.bundles]) assert.equal(catalogPrice(p).kind, "pending", `${p.productId}: sin precio decidido`);
});

test("S2 · COMPRAR solo selecciona (abre el detalle); el cobro sale de «Confirmar compra»", () => {
  const src = readFileSync(join(process.cwd(), "src/components/store/StoreProducts.tsx"), "utf8");
  assert.ok(!/buyPack|buyPackOnline|fetch\(|api\/game/.test(src), "las tarjetas no compran");
  assert.match(src, /onClick=\{\(\) => onSelect\(product\)\}/);
  const page = readFileSync(join(process.cwd(), "src/app/tienda/page.tsx"), "utf8");
  assert.match(page, /onConfirm=\{confirm\}/, "la compra real solo la dispara la confirmación del detalle");
  assert.match(page, /if \(busy \|\| inFlight\.current \|\| !packId\) return;/, "doble clic / Enter repetido: una compra por gesto");
});

test("S3 · CONTRATO: probabilidades del detalle ≡ fuente que usa el servidor, para CADA sobre vendido (también en cajas y packs)", () => {
  const packIds = new Set(ALL.flatMap((p) => p.grant.packs.map((x) => x.packId)));
  assert.ok(packIds.size >= 15);
  for (const id of packIds) {
    const pack = getPack(id)!;
    const [g] = productOdds({ ...view.packs[0], kind: "PACK", grant: { packs: [{ packId: id, count: 1 }], cardIds: [], credits: 0 }, previewPack: undefined });
    const table = packDistribution(id); // Pack Opening 3.1 · todo sobre con plan (línea y especiales)
    if (table) {
      // Línea principal (Pack Opening 3.0): la media exacta por carta del plan que `openPack` usa, con un decimal, y las
      // líneas de ranura normal / destacada / mejor carta (las mismas frases que la ficha).
      assert.equal(g.source, "class-table", id);
      assert.deepEqual(g.rows.map((r) => r.key), activeClasses(table), id);
      assert.deepEqual(g.rows.map((r) => r.pct), activeClasses(table).map((c) => `${(Math.round(table[c] * 10) / 10).toLocaleString("es-ES")} %`), id);
      assert.ok(Math.abs(activeClasses(table).reduce((s, c) => s + table[c], 0) - 100) < 1e-9, id);
      assert.ok(g.rows.every((r) => r.pct !== "0 %"), `${id}: ninguna clase posible se enseña como 0 %`);
      // Un sobre de 1 carta (Icon) no tiene línea de huecos normales: la destacada pasa a ser la primera.
      const off = getPack(id)!.cardCount === 1 ? 0 : 1;
      assert.ok(g.slots && /^Carta destacada \(1 por sobre\): /.test(g.slots[off]) && /^Mejor carta del sobre: OVR 90\+ /.test(g.slots[off + 1]), id);
      // Icon por sobre (2026-10-09): la línea de la Icon sale del mismo plan que sortea el servidor.
      const chance = iconChanceOf(id);
      if (chance === null) assert.equal(g.icon ?? null, null, id);
      else if (chance === 1) assert.match(g.icon!.text, new RegExp(`^Contiene exactamente ${pack.cardCount === 1 ? "1 carta ICON garantizada" : `${pack.cardCount} cartas ICON garantizadas`}\\.`), id);
      else assert.equal(g.icon?.text, `Probabilidad de conseguir al menos una carta ICON en este sobre: ${(chance * 100).toLocaleString("es-ES")} %`, id);
    } else {
      // Resto: el reparto MEDIDO con el motor real (packStats.test lo revalida contra `openPack`); sin medición (el Sobre
      // Inicial, regalo con su propia regla), los pesos declarados normalizados — la misma rama que `packOddsFor`.
      const st = packStats(id);
      const per: Record<string, number> = st ? st.drawn : normalizedWeights(pack.weights);
      const impossible = new Set<string>(st?.impossible ?? []);
      assert.equal(g.source, st ? "measured" : "weights", id);
      const keys = ["common", "uncommon", "rare", "epic", "legendary"].filter((b) => (per[b] ?? 0) > 0 && !impossible.has(b));
      assert.deepEqual(g.rows.map((r) => [r.key, r.pct]), keys.map((b) => [b, pct(per[b])]), id);
    }
    assert.ok(g.rows.length > 0 && g.cardCount === pack.cardCount, id);
  }
});

test("S3 · el MOTOR REAL (`openPack`) sortea con la misma tabla que enseña la interfaz (6 sobres × 1.500 aperturas, ±2,5 pp)", () => {
  const reg = new CardRegistry();
  for (const id of MAIN_PACK_LINE) {
    const pack = getPack(id)!;
    const table = mainPackDistribution(id)!;
    const n: Record<string, number> = {};
    let total = 0;
    for (let s = 1; s <= 1500; s++) {
      for (const d of openPack(reg, pack, { seed: s * 7919 + 13, owned: new Set(), pity: freshPity() }).decisions) {
        const k = packCardClass(d.card)!; n[k] = (n[k] ?? 0) + 1; total++;
      }
    }
    const ui = productOdds({ ...view.packs[0], grant: { packs: [{ packId: id, count: 1 }], cardIds: [], credits: 0 }, previewPack: undefined })[0];
    for (const r of ui.rows) {
      const measured = (100 * (n[r.key] ?? 0)) / total;
      assert.ok(Math.abs(measured - table[r.key as keyof typeof table]) <= 2.5, `${id}/${r.key}: UI ${r.pct} vs motor ${measured.toFixed(2)} %`);
    }
    assert.ok(Object.keys(n).every((k) => table[k as keyof typeof table] > 0), `${id}: el motor no saca clases que la UI no enseña`);
  }
});

test("S4 · detalle de un sobre: imagen, nombre, nº de cartas, probabilidades, precio, saldo → después y «Confirmar compra»", () => {
  const oro = view.packs.find((p) => p.packId === "oro")!;
  const html = details(oro, 19725); // F80 · Oro cuesta 12.000: un saldo que alcanza
  const t = text(html);
  assert.match(html, /src="\/packs\/pack-oro\.webp"/);
  assert.match(t, /Sobre Oro/);
  assert.match(t, /5 cartas/);
  for (const r of productOdds(oro)[0].rows) assert.ok(html.includes(`data-pct="${r.pct}"`), r.key);
  assert.match(t, /Tu saldo 19\.725/);
  assert.ok(t.includes(`Después ${formatCredits(19725 - getPack("oro")!.price)}`), t);
  assert.ok(t.includes(`Confirmar compra · ${formatCredits(getPack("oro")!.price)}`), t);
  assert.match(t, /Cancelar/);
  // Sin saldo: se dice cuánto falta y no se puede confirmar.
  const poor = details(oro, 100);
  assert.match(text(poor), /Saldo insuficiente/);
  assert.match(poor, /<button[^>]*disabled=""[^>]*>Confirmar compra/);
});

test("S4 · detalle de sobre regional y de equipo: reparto medido + nota de equipo; caja: la tabla de su sobre; carta: edición/OVR solo aquí", () => {
  // Pack Opening 3.1 · un regional enseña su reparto por clase del PLAN (el que sortea el servidor) y sus ranuras.
  const reg = view.packs.find((p) => getPack(p.packId!)!.restrictRegion)!;
  assert.match(details(reg), /data-odds-source="class-table"/);
  assert.match(details(reg), /data-testid="odds-slots"[\s\S]*Carta destacada \(1 por sobre\)/);
  const team = view.packs.find((p) => getPack(p.packId!)!.team)!;
  assert.match(text(details(team)), /Probabilidad aumentada/);
  const box = view.boxes[0];
  assert.match(details(box), new RegExp(`data-pack-id="${box.packId}"`));
  const card = view.cards[0];
  const ct = text(details(card));
  assert.match(ct, /OVR \d+/);
  assert.doesNotMatch(text(renderCard(card)), /OVR/);
  const bundle = view.bundles[0];
  assert.equal(productOdds(bundle).length, new Set(bundle.grant.packs.map((x) => x.packId)).size, "una tabla por tipo de sobre del pack");
  // Imagen grande en el detalle de TODA clase: el pack enseña sus sobres reales (antes su detalle salía sin imagen).
  assert.match(details(bundle), /src="\/packs\/pack-/);
  assert.match(details(box), /<svg/);
  assert.match(details(card), new RegExp(`src="/cards/${card.cardId}\\.webp"`));
});

test("S5 · CMS: un sobre publicado desde el panel adopta tarjeta, precio, COMPRAR y detalle con probabilidades — sin tocar el frontend", () => {
  const template = getPack("oro")!;
  const regional = getPack("emea")!;
  const cms = (id: string, t: PackDef, name: string): PackDef => ({ ...t, id, name, lifecycle: "ACTIVE", retired: undefined, cms: { templateId: t.id, art: `/packs/pack-${t.id}.webp` } } as PackDef);
  const before = PACKS.length;
  try {
    applyRuntimePacks([cms("cms-f724-oro", template, "Sobre Prueba F72.4"), cms("cms-f724-emea", regional, "Sobre Región F72.4")]);
    const v = resolveStore(Date.now());
    for (const [id, tpl] of [["cms-f724-oro", template], ["cms-f724-emea", regional]] as const) {
      const p = v.packs.find((x) => x.packId === id);
      assert.ok(p, `${id} aparece en la tienda`);
      const t = text(renderCard(p!));
      assert.equal(t.replace(/^Nuevo /, "").replace(/ ?DRL Credits/, ""), `${getPack(id)!.name} ${formatCredits(tpl.price)} Comprar`, t);
      assert.match(renderCard(p!), new RegExp(`src="/packs/pack-${tpl.id}\\.webp"`), "su propio arte (Storage/panel)");
      const g = productOdds(p!)[0];
      assert.ok(g.rows.length > 0, `${id}: probabilidades en el detalle`);
      if (id === "cms-f724-oro") assert.deepEqual(g.rows.map((r) => r.pct), productOdds(v.packs.find((x) => x.packId === "oro")!)[0].rows.map((r) => r.pct), "hereda la tabla de su plantilla (la que usa openPack vía alias)");
      assert.match(details(p!), /Confirmar compra/);
    }
  } finally {
    applyRuntimePacks([]);
  }
  assert.equal(PACKS.length, before, "el registro vuelve a su estado");
});
