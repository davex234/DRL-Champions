/**
 * MERCADO — tests de las transferencias (Fase 7).
 *
 * La propiedad que más importa aquí no es visual: es que la pantalla distinga las DOS CIFRAS
 * que el mercado mezclaba. `price` es lo que pide quien vende; `reference` (`instanceValue`)
 * es el índice interno del juego para esa carta y esa serie. Enseñar una sola —o llamar
 * «valor» al precio— hacía imposible saber si una compra era cara o barata.
 *
 * Lo demás son regresiones de forma que ya nos han mordido dos veces: envoltorios más
 * estrechos que la carta que llevan dentro, y rejillas que no miden lo que mide una carta.
 */
import { test } from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { ListingCard, type ListingView } from "./ListingCard";
import { MarketToolbar } from "./MarketToolbar";
import { SellPanel, MIN_PRICE, type SellableCard } from "./SellPanel";
import { CARDS } from "@/data/catalog";
import { instanceValue } from "@/domain/economy/pricing";

const html = (n: React.ReactElement): string => renderToStaticMarkup(n);
const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), "utf8");
const noop = () => {};

const DEF = CARDS[0];
const REF = instanceValue(DEF, undefined);

const anuncio = (price: number): ListingView => ({
  id: "l1", cardId: DEF.id, def: DEF, price, reference: REF,
});

const mia = (over: Partial<SellableCard> = {}): SellableCard => ({
  uid: "u1", def: DEF, reference: REF, locked: false, ...over,
});

const facetas = [
  {
    label: "Región", value: "Todas",
    options: [{ value: "Todas", label: "Todas" }, { value: "EMEA", label: "EMEA" }],
    onChange: noop,
  },
];

/* ─────────────────────── LAS DOS CIFRAS ─────────────────────── */

test("FICHA · el precio y la referencia se dicen por separado y con su nombre", () => {
  /*
   * El mercado anterior escribía una sola cifra. Un jugador que ve «2.500» no puede saber si
   * está pagando por encima del índice del juego o por debajo: le falta el otro número.
   */
  const markup = html(<ListingCard listing={anuncio(REF)} credits={99999} busy={false} onOpen={noop} onBuy={noop} />);
  assert.match(markup, /Precio/, "la cifra que pagas, rotulada");
  assert.match(markup, /Ref\./, "y la referencia, dicha por su nombre");
  assert.ok(!/\bvale\b/i.test(markup), "«vale» convertiría la petición de un vendedor en un hecho");
});

test("FICHA · la desviación se dice cuando cambia una decisión, y no antes", () => {
  const caro = html(<ListingCard listing={anuncio(Math.round(REF * 1.4))} credits={999999} busy={false} onOpen={noop} onBuy={noop} />);
  assert.match(caro, /\+40%/, "un 40 % por encima tiene que verse");

  const justo = html(<ListingCard listing={anuncio(Math.round(REF * 1.03))} credits={999999} busy={false} onOpen={noop} onBuy={noop} />);
  assert.ok(!/%<\/span>/.test(justo), "un 3 % es ruido: marcarlo enseña a ignorar la marca");
});

test("FICHA · la tendencia solo se dibuja cuando hay tendencia", () => {
  /*
   * `computeTrend` devuelve «estable» también SIN DATOS, así que la insignia salía idéntica
   * en las 54 fichas. Una marca que está siempre no marca nada.
   */
  const src = read("./ListingCard.tsx");
  assert.match(src, /tendencia !== "stable" && <TrendBadge/);
  const sinMovimiento = html(<ListingCard listing={anuncio(REF)} credits={99999} busy={false} onOpen={noop} onBuy={noop} />);
  assert.ok(!/Estable/.test(sinMovimiento));
});

test("FICHA · sin saldo el botón lo DICE, no se queda apagado sin explicación", () => {
  const markup = html(<ListingCard listing={anuncio(5000)} credits={10} busy={false} onOpen={noop} onBuy={noop} />);
  assert.match(markup, /Sin saldo/);
  assert.match(markup, /disabled/);
});

test("FICHA · el alto de la línea de referencia está reservado", () => {
  /*
   * Sin alto fijo, las fichas con insignia de desviación crecen una línea y los botones de
   * compra de una misma fila dejan de estar alineados: la rejilla se desdentaba sola.
   */
  const src = read("./ListingCard.tsx");
  assert.match(src, /min-h-\[22px\]/, "la línea de referencia tiene que ocupar siempre lo mismo");
});

test("FICHA · el bloque mide LO QUE MIDE LA CARTA", () => {
  /*
   * Misma familia de fallo que la Fase 5 (celda de 262 px para una carta de 150) y la Fase 6
   * (el resumen del sobre). `PlayerCard size="sm"` mide 150 px: el envoltorio, también.
   */
  const src = read("./ListingCard.tsx");
  assert.match(src, /w-\[150px\]/);
  assert.match(src, /size="sm"/);
  /* Solo la sala «Comprar»: el panel diferido de Fase E conserva su rejilla antigua. */
  const page = read("../../app/mercado/page.tsx");
  const comprar = page.slice(page.indexOf("function BuyTab"), page.indexOf("function SalesTab"));
  assert.match(comprar, /repeat\(auto-fill,150px\)/, "la columna, atada al ancho de la carta");
  assert.ok(!/grid-cols-\d/.test(comprar), "columnas flexibles es de donde venía el hueco muerto");
});

/* ─────────────────────── PUBLICAR ─────────────────────── */

test("VENDER · el mercado deja vender; antes mandaba a otra pantalla", () => {
  const markup = html(<SellPanel cards={[mia()]} busy={false} onPublish={noop} />);
  assert.match(markup, /Publicar una carta/);
  assert.match(markup, /Precio de venta/);
  const page = read("../../app/mercado/page.tsx");
  assert.ok(
    !/Publícalas desde tu colección/.test(page),
    "el sitio donde se vende es el mercado, no un texto que te manda a buscar el botón",
  );
});

test("VENDER · el precio parte de la referencia de ESA carta", () => {
  const markup = html(<SellPanel cards={[mia()]} busy={false} onPublish={noop} />);
  assert.match(markup, new RegExp(`value="${REF}"`), "el ancla honesta es el índice de la carta");
  assert.match(markup, /Referencia/);
});

test("VENDER · el mínimo que se enseña es el que aplica el motor", () => {
  /*
   * `useMarketStore.listForSale` rechaza por debajo de 25. Si la pantalla dijera otra cosa,
   * el jugador descubriría la regla por un error rojo después de pulsar.
   */
  const store = read("../../store/useMarketStore.ts");
  assert.match(store, /rounded < 25/, "el motor sigue poniendo el mínimo en 25");
  assert.equal(MIN_PRICE, 25, "la pantalla no puede anunciar otro mínimo");
});

test("VENDER · publicar no deja el panel quejándose de un precio que ya no existe", () => {
  /*
   * Al publicar, el uid elegido desaparece de la colección. Si la selección se queda
   * apuntando a esa carta, el panel pierde el precio y pinta «el precio mínimo es 25» —una
   * queja sobre nada— justo encima del aviso de que la publicación ha ido bien.
   */
  const src = read("./SellPanel.tsx");
  assert.match(src, /!vendibles\.some\(\(c\) => c\.uid === uid\)/, "hay que reelegir cuando la carta se va");
  assert.match(src, /\{elegida && !valido &&/, "y sin carta elegida no hay precio del que quejarse");
});

test("VENDER · una carta bloqueada se ve y no se puede elegir", () => {
  const markup = html(<SellPanel cards={[mia({ locked: true })]} busy={false} onPublish={noop} />);
  assert.match(markup, /Bloqueada/);
  assert.match(markup, /disabled/);
});

test("VENDER · se dice QUÉ PASA al publicar antes de publicar", () => {
  const markup = html(<SellPanel cards={[mia()]} busy={false} onPublish={noop} />);
  assert.match(markup, /sale de tu colección/, "la carta se retira: eso no puede ser una sorpresa");
  assert.match(markup, /retirarla cuando quieras/);
});

test("VENDER · no se inventa una comisión que nadie cobra", () => {
  /*
   * El mercado local no retiene nada. La retención existe en el mercado ENTRE JUGADORES, y
   * ese flujo la muestra donde se aplica. Anunciarla aquí sería tan falso como ocultarla allí.
   */
  const markup = html(<SellPanel cards={[mia()]} busy={false} onPublish={noop} />);
  assert.ok(!/comisión|impuesto|tasa/i.test(markup));
  const src = read("./SellPanel.tsx").split("*/").slice(1).join("*/");
  assert.ok(!/applyTax|taxPercent/.test(src), "la pantalla no calcula economía");
});

test("VENDER · la carta del selector se ESCALA, no se recorta", () => {
  /*
   * Una caja de 96 px con una carta de 150 dentro no encoge la carta: la corta. Es el mismo
   * fallo del resumen del sobre, y aquí se resuelve con `transform`, que no miente sobre el
   * tamaño real del objeto.
   */
  const src = read("./SellPanel.tsx");
  assert.match(src, /scale-\[0\.64\]/);
  assert.match(src, /h-\[134px\] w-\[96px\]/);
});

/* ─────────────────────── LA HERRAMIENTA ─────────────────────── */

test("BARRA · buscar y ordenar a la vista; acotar, plegado", () => {
  const cerrada = html(
    <MarketToolbar query="" onQuery={noop} sort="price-asc" onSort={noop} facets={facetas}
      open={false} onToggle={noop} activeCount={0} onClear={noop} matched={12} />,
  );
  assert.match(cerrada, /Buscar jugador o equipo/);
  assert.match(cerrada, /Precio ↑/);
  assert.ok(!/EMEA/.test(cerrada), "catorce píldoras a la vez no se leen: las facetas se pliegan");

  const abierta = html(
    <MarketToolbar query="" onQuery={noop} sort="price-asc" onSort={noop} facets={facetas}
      open onToggle={noop} activeCount={0} onClear={noop} matched={12} />,
  );
  assert.match(abierta, /Región/, "y al abrirlas llevan su rótulo");
  assert.match(abierta, /EMEA/);
});

test("BARRA · filtrando, se dice qué está puesto, cuánto queda y cómo salir", () => {
  const markup = html(
    <MarketToolbar query="derke" onQuery={noop} sort="ovr" onSort={noop}
      facets={[{ ...facetas[0], value: "EMEA" }]}
      open={false} onToggle={noop} activeCount={1} onClear={noop} matched={3} />,
  );
  assert.match(markup, /Buscando «derke»/);
  assert.match(markup, /EMEA/);
  assert.match(markup, /3<\/span> cartas a la venta/);
  assert.match(markup, /Limpiar/);
});

test("BARRA · ningún desplegable nativo dentro del juego", () => {
  const src = read("./MarketToolbar.tsx");
  assert.ok(!/<select/.test(src), "un `select` del sistema operativo se lee como un formulario");
  assert.match(src, /@\/components\/ui\/Segmented/);
});

/* ─────────────────────── LÍMITES ─────────────────────── */

test("SERVIDOR · la pantalla presenta; la regla la sigue poniendo el motor", () => {
  const piezas = ["ListingCard.tsx", "SellPanel.tsx", "MarketToolbar.tsx"].map((f) => read(`./${f}`)).join("\n");
  assert.ok(!/instanceValue\s*\(/.test(piezas), "el valor de referencia llega calculado, no se recalcula aquí");
  assert.ok(!/credits\s*-=|setCredits|addCredits/.test(piezas), "ninguna pieza toca el saldo");
  const page = read("../../app/mercado/page.tsx");
  assert.match(page, /buyListing\(id\)/, "comprar sigue siendo una llamada al store");
  assert.match(page, /listForSale\(uid, price\)/, "publicar, también");
  assert.match(page, /if \(busy\) return;/, "y un solo intento por pulsación");
});

test("ADOPCIÓN · el mercado se compone con primitivas del sistema", () => {
  const piezas = ["ListingCard.tsx", "SellPanel.tsx", "MarketToolbar.tsx"].map((f) => read(`./${f}`)).join("\n");
  for (const p of ["Surface", "NxButton", "Readout", "Badge"]) {
    assert.match(piezas, new RegExp(`@/components/ui/${p}`), `el mercado no usa ${p}`);
  }
  const page = read("../../app/mercado/page.tsx");
  for (const c of ["MarketToolbar", "ListingCard", "SellPanel", "Segmented"]) {
    assert.match(page, new RegExp(c), `la página no compone ${c}`);
  }
});

test("ANTI-GRAMÁTICA · el mercado no reintroduce lo que el sistema vino a quitar", () => {
  const cuerpo = ["ListingCard.tsx", "SellPanel.tsx", "MarketToolbar.tsx"]
    .map((f) => read(`./${f}`).split("*/").slice(1).join("*/"))
    .join("\n");
  assert.ok(!/#[0-9a-fA-F]{6}\b/.test(cuerpo), "hexadecimal suelto");
  assert.ok(!/text-\[\d+(\.\d+)?px\]/.test(cuerpo), "tamaño de letra fuera de la escala");
  assert.ok(!/z-\[\d+\]/.test(cuerpo), "z-index arbitrario");
  assert.ok(!/rounded-(xl|2xl|3xl|panel|card)\b/.test(cuerpo), "tarjeta redondeada genérica");
});

test("LÍMITE DE FASE · el panel diferido de Fase E no se toca", () => {
  /*
   * `GlobalTab` es código inalcanzable —la sala «Global» la sirve `PlayerMarket` desde la
   * Fase 11— y durante esta fase llegué a borrarlo. `security-verify` lo cazó: su
   * permanencia es una decisión DELIBERADA («el panel sigue en el repositorio para Fase E»)
   * porque ahí vive la corrección de BUG-07. Retirarlo es de Fase E, no de una fase visual.
   * Este test existe para que el siguiente que pase por aquí no repita el borrado.
   */
  const page = read("../../app/mercado/page.tsx");
  assert.match(page, /function GlobalTab\(/, "el panel diferido se queda hasta Fase E");
  assert.match(page, /restoreOwnedCard\(removed\);/, "y con él la corrección de BUG-07");
  assert.match(page, /\{tab === "global" && <PlayerMarket/, "pero quien pinta la sala es PlayerMarket");
  assert.ok(!/<GlobalTab/.test(page), "el panel no se monta: sigue inalcanzable, como en Fase 11");
});
