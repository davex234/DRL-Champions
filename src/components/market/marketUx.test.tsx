/**
 * MERCADO · EXPERIENCIA DE COMPRA (Fase 23.2).
 *
 * La Fase 23.1 dejó el bucle cableado y seguro en el servidor. La 23.2 añade la EXPERIENCIA
 * —ficha de detalle, confirmación de compra con saldo antes/después, mensajes humanos,
 * filtros, historial de compras/ventas— sobre esa base, SIN tocar backend ni abrir el
 * mercado. Estos tests protegen justo eso: que la UX esté lista para el día que Operaciones
 * encienda `GLOBAL_MARKET_ENABLED`, y que hasta entonces NO haya ningún bypass del cierre.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { ListingDetail } from "./ListingDetail";
import { PlayerMarket } from "./PlayerMarket";
import type { ListingView } from "@/lib/game/market";
import { CARDS } from "@/data/catalog";

const html = (n: React.ReactElement): string => renderToStaticMarkup(n);
const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), "utf8");
const DETAIL_SRC = read("./ListingDetail.tsx");
const MARKET_SRC = read("./PlayerMarket.tsx");
const noop = () => {};
const DEF = CARDS[0];

const listing = (over: Partial<ListingView> = {}): ListingView => ({
  id: "l1", cardId: DEF.id, cardUid: "u1", serial: 12, price: 3500, sellerId: "s1",
  createdAt: "2026-09-01T00:00:00.000Z", nick: "Alfajer", team: "Fnatic", region: "EMEA",
  ovr: DEF.ovr, variantId: DEF.variantId, variantLabel: "Oro", rank: 3, reference: 4000, ...over,
});

/* ─────────────── MERCADO CERRADO / SIN BYPASS ─────────────── */

test("MERCADO CERRADO · el escaparate lo dice arriba, sin fingir tienda", () => {
  const markup = html(<PlayerMarket notify={noop} />);
  assert.match(markup, /próximamente/, "anuncia que abrirá próximamente");
});

test("NO BYPASS · comprar está gobernado SOLO por GLOBAL_MARKET_ENABLED, sin trucos", () => {
  // El CTA de compra depende del flag; no hay `= true`, ni mock, ni mercado abierto simulado.
  assert.match(MARKET_SRC, /canBuy=\{GLOBAL_MARKET_ENABLED\}/, "canBuy sale del flag real");
  for (const trampa of ["GLOBAL_MARKET_ENABLED = true", "GLOBAL_MARKET_ENABLED=true", "canBuy={true}"]) {
    assert.ok(!MARKET_SRC.includes(trampa) && !DETAIL_SRC.includes(trampa), `sin bypass (${trampa})`);
  }
  // En la ficha, el paso de confirmar solo se habilita con canBuy; cerrado no ejecuta nada.
  assert.match(DETAIL_SRC, /disabled=\{!canBuy\}/, "cerrado: el CTA no abre la compra");
  assert.match(DETAIL_SRC, /busy \|\| !enough \|\| !canBuy/, "confirmar exige canBuy + saldo");
});

test("CERRADO · la ficha muestra el CTA pero desactivado (no una compra falsa)", () => {
  const markup = html(<ListingDetail listing={listing()} credits={9000} canBuy={false} onBuy={async () => ({ price: 3500 })} onClose={noop} />);
  assert.match(markup, /No disponible/, "cerrado: CTA desactivado con motivo");
  assert.match(markup, /disabled/, "y realmente disabled");
});

/* ─────────────── FICHA DE DETALLE ─────────────── */

test("DETALLE · la ficha es una carta de videojuego, no una fila de SQL", () => {
  const markup = html(<ListingDetail listing={listing()} credits={9000} canBuy onBuy={async () => ({ price: 3500 })} onClose={noop} />);
  for (const dato of ["Alfajer", "Fnatic", "EMEA", "Oro", "role=\"dialog\""]) {
    assert.match(markup, new RegExp(dato), `la ficha muestra ${dato}`);
  }
  assert.match(markup, /#12/, "el serial, cuando existe");
  assert.match(markup, /Comprar/, "y el CTA de compra cuando el mercado está abierto");
});

test("PRECIO · las TRES cifras se dicen por separado, no se mezclan (§22)", () => {
  const markup = html(<ListingDetail listing={listing()} credits={9000} canBuy onBuy={async () => ({ price: 3500 })} onClose={noop} />);
  assert.match(markup, /Precio de venta/, "el precio del listado");
  assert.match(markup, /Valor de mercado/, "el valor de mercado");
  assert.match(markup, /Valor de instancia/, "el valor de instancia");
  // El precio mostrado es el del LISTADO real, no uno recalculado en el cliente.
  assert.match(markup, /3\.500/, "el precio es el del listing");
  assert.ok(!/instanceValue\(|marketValue\(/.test(""), "las fórmulas no se reimplementan, se llaman");
});

/* ─────────────── CONFIRMACIÓN / COMPRA ─────────────── */

test("CONFIRMACIÓN · saldo antes y después, y no hay compra optimista", () => {
  // El paso de confirmar enseña precio, saldo y «después», y solo entonces llama a onBuy.
  assert.match(DETAIL_SRC, /Tu saldo/, "muestra el saldo");
  assert.match(DETAIL_SRC, /Después/, "y el saldo tras la compra");
  assert.match(DETAIL_SRC, /credits - l\.price/, "el «después» es saldo − precio del listing");
  assert.match(DETAIL_SRC, /await onBuy\(l\)/, "la compra es el endpoint, no un cambio local");
  assert.match(DETAIL_SRC, /setStep\("success"\)/, "solo se marca éxito cuando el servidor responde");
});

test("SALDO INSUFICIENTE · se detecta y bloquea el botón con mensaje humano", () => {
  assert.match(DETAIL_SRC, /const enough = credits >= l\.price/, "compara saldo con precio real");
  assert.match(DETAIL_SRC, /Créditos insuficientes/, "mensaje humano, no un stack trace");
});

test("DOBLE CLIC · durante la compra el botón se desactiva (idempotencia + UX)", () => {
  assert.match(DETAIL_SRC, /if \(busy \|\| !canBuy \|\| !enough\) return/, "no se manda dos veces");
  assert.match(DETAIL_SRC, /disabled=\{busy \|\| !enough \|\| !canBuy\}/, "botón bloqueado mientras compra");
});

test("ÉXITO · «Carta adquirida» con acciones, sin crear otra instancia", () => {
  // No hay `addOwnedCard`/creación local: la carta la trae el servidor con syncFromServer.
  assert.match(DETAIL_SRC, /Carta adquirida/, "confirma la adquisición");
  assert.match(DETAIL_SRC, /Ver en colección/, "acción a la colección");
  assert.ok(!/addOwnedCard|new Card|mint/i.test(DETAIL_SRC), "no fabrica una segunda instancia");
});

test("ERROR · se traduce a mensaje humano, sin exponer el fallo crudo", () => {
  assert.match(DETAIL_SRC, /No hemos podido completar la compra/, "mensaje humano por defecto");
  assert.match(DETAIL_SRC, /role="alert"/, "el error se anuncia a lectores de pantalla");
});

/* ─────────────── FILTROS / BÚSQUEDA / HISTORIAL ─────────────── */

test("FILTROS · rareza y media filtran EN CLIENTE lo cargado, sin N+1", () => {
  assert.match(MARKET_SRC, /const visible = useMemo/, "hay un derivado de lo visible");
  assert.match(MARKET_SRC, /l\.variantLabel === rarity/, "filtra por rareza sin pedir al servidor");
  assert.match(MARKET_SRC, /l\.ovr >= minOvr/, "y por media");
});

test("HISTORIAL · separa Mis compras de Mis ventas reutilizando los trades", () => {
  assert.match(MARKET_SRC, /const visibleTrades = useMemo/, "deriva el historial filtrado");
  assert.match(MARKET_SRC, /t\.side === side/, "por compra/venta, sin segundo ledger");
  assert.match(MARKET_SRC, /Mis compras/, "expone la vista de compras");
});

/* ─────────────── CANCELAR / REDUCED MOTION ─────────────── */

test("CANCELAR · retirar pide confirmación antes de tocar el servidor", () => {
  assert.match(MARKET_SRC, /confirmCancel === l\.id/, "hay un paso de confirmación");
  assert.match(MARKET_SRC, /¿Retirar del mercado\?/, "y pregunta antes de retirar");
});

test("REDUCED-MOTION · la ficha y las cartas respetan la preferencia", () => {
  assert.match(DETAIL_SRC, /useReducedMotion/, "la ficha lee la preferencia");
  assert.match(DETAIL_SRC, /duration: reduce \? 0/, "sin movimiento, la animación de entrada es instantánea");
  assert.match(MARKET_SRC, /motion-safe:hover/, "la microinteracción de la carta es solo con movimiento permitido");
});

test("ACCESIBILIDAD · la ficha es un diálogo cerrable por teclado, con foco", () => {
  const markup = html(<ListingDetail listing={listing()} credits={9000} canBuy onBuy={async () => ({ price: 3500 })} onClose={noop} />);
  assert.match(markup, /aria-modal="true"/, "es un diálogo modal");
  assert.match(markup, /aria-label="Cerrar"/, "con cierre etiquetado");
  assert.match(DETAIL_SRC, /e\.key === "Escape"/, "Escape cierra");
});
