/**
 * MERCADO ENTRE JUGADORES · PUBLICAR (Fase 23.1).
 *
 * El servidor, la base de datos y su antifraude ya existían (migración 0020, `economy:verify`):
 * transferencia atómica, idempotencia, `FOR UPDATE`, banda de precio, comisión, RLS. Lo que la
 * Fase 23.1 añade es la ÚNICA puerta que le faltaba al bucle —publicar una repetida— y estos
 * tests protegen que esa puerta no reabra ninguno de los agujeros que cerraron el mercado:
 * que el navegador no decida propiedad ni precio, que pase por `/api/game/market`, que respete
 * el interruptor de apertura y que solo ofrezca cartas repetidas propias y no listadas.
 *
 * Es la misma clase de red que el resto del mercado (`market.test.tsx`): asevera sobre el
 * CÓDIGO propiedades que la interfaz no puede romper, no reimplementa la lógica del servidor.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { SellComposer, type SellableInstance } from "./PlayerMarket";
import { CARDS } from "@/data/catalog";
import { marketValue } from "@/domain/economy/pricing";

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), "utf8");
const SRC = read("./PlayerMarket.tsx");
const CLIENT = readFileSync(new URL("../../lib/game/market.ts", import.meta.url), "utf8");
const html = (n: React.ReactElement): string => renderToStaticMarkup(n);
const noop = () => {};

const DEF = CARDS[0];
const vendible = (over: Partial<SellableInstance> = {}): SellableInstance => ({
  uid: "u1", def: DEF, serial: undefined, reference: marketValue(DEF), ...over,
});

/* ─────────────── AUTORIDAD DEL SERVIDOR ─────────────── */

test("SERVER-AUTHORITY · publicar pasa por `/api/game/market`, no por RPC directa", () => {
  // La venta usa el envoltorio de Fase 11, que resuelve el usuario desde el token.
  assert.match(SRC, /listCardOnMarket\(/, "el composer llama al envoltorio de servidor");
  // Nunca el camino legado que hablaba con la base de datos desde el navegador (BUG/SEC de Fase A).
  for (const legado of ["listCardOnline", "deposit_card", "create_listing", "\\.rpc\\("]) {
    assert.ok(!new RegExp(legado).test(SRC), `no usa el camino legado (${legado})`);
  }
});

test("SERVER-AUTHORITY · el navegador manda uid + precio y NADA de autoridad", () => {
  // Solo se envían el ejemplar y el precio. Ni vendedor, ni serial, ni instanceValue, ni saldo.
  assert.match(SRC, /onPublish\(elegida\.uid, price\)/, "publica con uid + precio");
  const wrapper = CLIENT.slice(CLIENT.indexOf("listCardOnMarket"));
  assert.match(wrapper.slice(0, 220), /action: "list", cardUid, price, ref/, "el cuerpo es uid+precio+ref");
  assert.ok(!/sellerId|seller_id|ownerId|instanceValue/.test(wrapper.slice(0, 220)), "no manda autoridad");
});

test("IDEMPOTENCIA · publicar y comprar llevan clave de gesto", () => {
  // Doble clic / reintento / refresh no duplican: cada operación de valor lleva `ref`.
  assert.match(CLIENT, /listCardOnMarket = \([^)]*ref = newGesture\(\)\)/, "publicar lleva ref idempotente");
  assert.match(CLIENT, /buyFromMarket = \([^)]*ref = newGesture\(\)\)/, "comprar lleva ref idempotente");
});

/* ─────────────── SOLO REPETIDAS PROPIAS Y NO LISTADAS ─────────────── */

test("PROPIEDAD · lo vendible sale de tus repetidas del estado del servidor, no de un 2.º inventario", () => {
  // Se derivan de `ownedCards` (que rellena `syncFromServer`) con el selector `duplicates`.
  assert.match(SRC, /duplicates\(ownedCards\)/, "vendibles = repetidas del estado sincronizado");
});

test("SIN DOBLE LISTADO · se excluyen las retenidas y las ya publicadas", () => {
  // Excluye por partida doble: `lockedUids` (retenida/bloqueada) y tus listados activos.
  assert.match(SRC, /locked\.has\(o\.uid\)/, "excluye las bloqueadas/retenidas");
  assert.match(SRC, /listed\.has\(o\.uid\)/, "excluye las ya listadas");
  assert.match(SRC, /status === "active" && l\.cardUid/, "lo listado sale de tus listados activos");
});

test("SIN EDITAR PRECIO · «Mis ventas» solo permite retirar un listado, no reeditarlo", () => {
  // No hay afín para cambiar el precio de un listado vivo: el precio se fija al publicar.
  const misVentas = SRC.slice(SRC.indexOf("MIS VENTAS"), SRC.indexOf("HISTORIAL"));
  assert.match(misVentas, /Retirar/, "el único acto sobre un listado vivo es retirarlo");
  assert.ok(!/editar precio|cambiar precio|updatePrice/i.test(misVentas), "no se reedita el precio");
});

/* ─────────────── PRECIO, COMISIÓN Y APERTURA ─────────────── */

test("PRECIO · el formulario exige el suelo del mercado, pero la banda la valida el servidor", () => {
  // Suelo de cliente (no molestar con lo obvio); la banda real la impone la RPC `_market_check_band`.
  assert.match(SRC, /price >= minPrice/, "exige el precio mínimo");
  assert.match(SRC, /marketValue\(def\)/, "parte del ancla de referencia, no la recalcula");
});

test("COMISIÓN HONESTA · se enseña la retención y el neto (a diferencia del mercado local)", () => {
  const markup = html(<SellComposer cards={[vendible()]} cfg={{ feeBps: 500, minPrice: 25, minMult: 0.2, maxMult: 10 }} busy={null} onPublish={noop} />);
  assert.match(markup, /Comisión/, "dice que hay comisión");
  assert.match(markup, /Recibes/, "y cuánto recibes tras ella");
});

test("MERCADO CERRADO · publicar se desactiva mientras el interruptor esté apagado", () => {
  // Simétrico al botón de comprar: el escaparate y el formulario se ven, pero la escritura
  // se apaga con `GLOBAL_MARKET_ENABLED` (y el servidor responde 503 igualmente).
  assert.match(SRC, /const cerrado = !GLOBAL_MARKET_ENABLED/, "lee el interruptor");
  assert.match(SRC, /disabled=\{!valido \|\| cerrado \|\| busy !== null\}/, "cerrado desactiva publicar");
  assert.match(SRC, /todavía no está abierto/, "y explica por qué, no solo con el color");
});

test("VACÍO · sin repetidas vendibles, el formulario no se pinta (no estorba)", () => {
  const markup = html(<SellComposer cards={[]} cfg={null} busy={null} onPublish={noop} />);
  assert.equal(markup, "", "sin cartas, no hay formulario");
});

/* ─────────────── ACCESIBILIDAD ─────────────── */

test("ACCESIBILIDAD · el selector de carta y el precio se anuncian y son enfocables", () => {
  const markup = html(<SellComposer cards={[vendible()]} cfg={{ feeBps: 500, minPrice: 25, minMult: 0.2, maxMult: 10 }} busy={null} onPublish={noop} />);
  assert.match(markup, /role="listbox"/, "el selector de carta es una lista");
  assert.match(markup, /aria-label="Precio de venta en créditos"/, "el precio tiene etiqueta");
  assert.match(SRC, /nx-focus/, "los controles muestran el foco");
});
