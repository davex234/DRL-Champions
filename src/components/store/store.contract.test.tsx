import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { resolveStore } from "@/domain/store/resolve";
import { STORE_CATALOG } from "@/data/storeCatalog";
import { getCard } from "@/data/catalog";
import { PackOfferCard, BoxOfferCard, CardOfferCard, BundleOfferCard, CatalogPrice } from "./StoreProducts";
import { StoreHero } from "./StoreHero";

/**
 * TIENDA 4.0 · CONTRATO DE INTERFAZ (Fase 49). Las piezas nuevas cumplen la gramática del sistema
 * (la misma que se exigía a la vitrina antigua), enseñan el arte REAL completo y no fingen nada.
 */
const DIR = join(process.cwd(), "src", "components", "store");
const FILES = ["StoreHero.tsx", "StoreTabs.tsx", "StoreProducts.tsx", "PurchaseModal.tsx", "storeView.ts"];
const body = (f: string) => readFileSync(join(DIR, f), "utf8").split("*/").slice(1).join("*/");
const NOW = Date.parse("2026-09-21T12:00:00Z");
const view = resolveStore(NOW);
const noop = () => undefined;

test("ANTI-GRAMÁTICA · sin tamaños fuera de escala, z-index arbitrarios, tarjetas redondeadas ni hex sueltos", () => {
  for (const f of FILES) {
    const src = body(f);
    assert.ok(!/text-\[\d+(\.\d+)?px\]/.test(src), `${f}: tamaño de letra fuera de la escala`);
    assert.ok(!/z-\[\d+\]/.test(src), `${f}: z-index arbitrario`);
    assert.ok(!/rounded-(xl|2xl|3xl|panel|card)\b/.test(src), `${f}: tarjeta redondeada genérica`);
    assert.deepEqual(src.match(/#[0-9a-fA-F]{6}\b/g) ?? [], [], `${f}: hexadecimal suelto (usa tokens)`);
  }
});

test("PRIMITIVAS · los botones de acción son NxButton y el modal no usa confirm()/alert()", () => {
  assert.match(readFileSync(join(DIR, "PurchaseModal.tsx"), "utf8"), /@\/components\/ui\/NxButton/);
  assert.match(readFileSync(join(DIR, "StoreHero.tsx"), "utf8"), /@\/components\/ui\/NxButton/);
  for (const f of FILES) assert.ok(!/window\.(confirm|alert)\(|(^|[^\w.])alert\(/.test(body(f)), f);
});

test("MODAL · diálogo accesible: role=dialog, aria-modal, título, Escape y foco atrapado", () => {
  const src = readFileSync(join(DIR, "PurchaseModal.tsx"), "utf8");
  assert.match(src, /role="dialog"/);
  assert.match(src, /aria-modal="true"/);
  assert.match(src, /aria-labelledby=\{titleId\}/);
  assert.match(src, /e\.key === "Escape"/);
  assert.match(src, /e\.key !== "Tab"/);
  assert.match(src, /createPortal\(/, "por encima de todo el cromo");
});

test("SIN ECONOMÍA EN LA INTERFAZ · ningún precio ni peso escrito a mano en los componentes", () => {
  for (const f of FILES) {
    const src = body(f);
    assert.ok(!/price\s*[:=]\s*\d/.test(src), `${f}: precio literal`);
    assert.ok(!/weights\s*[:=]/.test(src), `${f}: peso literal`);
    assert.ok(!/credits\s*[-+]=/.test(src), `${f}: resta de saldo en cliente`);
  }
});

test("CARTA · se enseña el ARTE COMPLETO (con alt y lazy), sin reconstruir OVR/stats encima", () => {
  const p = view.cards[0];
  const html = renderToStaticMarkup(<CardOfferCard product={p} index={0} onSelect={noop} />);
  const card = getCard(p.cardId!)!;
  assert.ok(html.includes(`src="${card.image}"`), "usa el WebP real de la carta");
  assert.match(html, /loading="lazy"/);
  assert.match(html, /alt="Carta de /);
  // El OVR y las stats ya van impresos en el arte: la ficha no los repinta en texto.
  assert.ok(!html.includes(`>${card.printed!.ovr}<`), "no repinta el OVR encima");
  assert.ok(!/DMG|SCR|FKS/.test(html), "no repinta las estadísticas");
});

// F72.4 · el catálogo es VISUAL: arte + nombre + precio + COMPRAR. Cartas, probabilidades, contenido y euros se
// enseñan en el detalle de compra (ver f724.storeSimplification.test.tsx).
test("SOBRE · arte real, nombre, UN precio (créditos del sobre) e insignia de propiedad; sin nº de cartas ni probabilidades", () => {
  const p = view.packs.find((x) => x.packId === "premium")!;
  const html = renderToStaticMarkup(<PackOfferCard product={p} owned={2} index={0} onSelect={noop} />);
  assert.match(html, /src="\/packs\/pack-premium\.webp"/);
  assert.match(html, /Sobre Plata/);   // Packs Base 4.0: `premium` se llama «Sobre Plata»
  assert.match(html, /6\.000/);  // F80 · Plata = 6.000
  assert.match(html, /2 sin abrir/);
  assert.ok(!/cartas aleatorias|%|€|Por anunciar/.test(html), "ni cartas, ni probabilidades, ni euros en la tarjeta");
});

test("CAJA · caja dibujada (sin assets externos) con el arte real del sobre; contenido en el detalle", () => {
  const b = view.boxes.find((x) => x.packId === "masters")!;
  const html = renderToStaticMarkup(<BoxOfferCard product={b} index={0} onSelect={noop} />);
  assert.match(html, /<svg/);
  assert.match(html, /href="\/packs\/pack-masters\.webp"/, "el emblema es el arte real del sobre");
  assert.match(html, /Caja Masters/);
  assert.match(html, /Próximamente/);
  assert.ok(!/10 × Sobre|50 cartas|%/.test(html.replace(/<[^>]+>/g, " ")), "el contenido va al detalle");
  assert.ok(!/https?:\/\//.test(html), "ningún asset externo");
});

test("PACK ESPECIAL · sus sobres reales como arte; no se vende sin pasarela; el contenido va al detalle", () => {
  const b = view.bundles[0];
  const html = renderToStaticMarkup(<BundleOfferCard product={b} index={0} onSelect={noop} />);
  assert.match(html, /\/packs\/pack-/);
  assert.match(html, /Próximamente/);
  assert.ok(!/▸|DRL Credits \(|cartas\)/.test(html), "sin la lista de contenido en la tarjeta");
});

test("PRECIOS · pendiente se dice «por anunciar», nunca un número inventado", () => {
  for (const p of [...view.boxes, ...view.cards, ...view.bundles]) {
    const html = renderToStaticMarkup(<CatalogPrice product={p} />);
    assert.match(html, /por anunciar/i, p.productId);
    assert.ok(!/€\s*\d|\d+,\d{2}\s*€/.test(html), `${p.productId}: precio en euros inventado`);
  }
});

test("HÉROE · edición y cartas reales, prioridad de carga solo arriba y SIN cuenta atrás", () => {
  const html = renderToStaticMarkup(<StoreHero hero={view.hero!} onCta={noop} />);
  for (const id of STORE_CATALOG.featuredHero[0].cardIds) assert.ok(html.includes(`/cards/${id}.webp`), id);
  assert.match(html, /fetchPriority="high"|fetchpriority="high"/i);
  assert.ok(!/\d{1,2}:\d{2}:\d{2}/.test(html), "sin temporizador");
  assert.match(html, /Champions S/);
});
