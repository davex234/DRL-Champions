/**
 * EL ARTWORK MANUAL EN EL CLIENTE — que aparezca cuando lo hay, y que NUNCA aparezca el de
 * otra versión.
 *
 * Lo que de verdad se prueba aquí no es «se ve una imagen». Es la propiedad que el bloque de
 * artwork existe para garantizar: **un ejemplar enseña el artwork de la versión con la que se
 * acuñó, y punto**. Por eso casi todas las pruebas montan dos versiones de la MISMA carta con
 * ficheros distintos y comprueban que ninguna se cuela en la otra.
 *
 * El fallback se prueba caso a caso porque es el contrato, no un adorno: cinco caminos tienen
 * que llevar al dibujado de siempre, y si alguno dejara un hueco en su lugar la colección se
 * llenaría de agujeros el día que un fichero desaparezca del bucket.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { CardFace, debePintarArtwork } from "./CardVisual";
import { artworkPintable, type CardArtworkRef } from "@/domain/cards/artwork";
import { useArtworkStore } from "@/store/useArtworkStore";

const ref = (url: string | null, cardVersion: number, cardId = "carta__prime"): CardArtworkRef =>
  ({ url, cardVersion, cardId, format: "png" });

const A_V1 = ref("https://cdn.test/artwork-v1.png", 1);
const A_V2 = ref("https://cdn.test/artwork-v2.png", 2);

/**
 * Pinta la cara con un fallback reconocible, para poder afirmar CUÁL de los dos salió.
 *
 * Se resuelve el artwork por el mismo camino que `CardVisual` —el mapa por `uid`— pero sin
 * pasar por el hook: en un render de servidor el almacén de zustand entrega su estado
 * inicial, así que un test que dependiera del hook sería ciego y pasaría siempre por el
 * fallback. Lo que importa probar es la resolución POR EJEMPLAR, y eso es el mapa.
 */
const conMapa = (mapa: Record<string, CardArtworkRef>) =>
  useArtworkStore.getState().setArtworks(mapa);

const pinta = (uid: string | undefined) =>
  renderToStaticMarkup(
    <CardFace artwork={useArtworkStore.getState().artworkOf(uid)} alt="carta">
      <div id="dibujado-por-capas" />
    </CardFace>,
  );

// ─────────────────────────── LA DECISIÓN ───────────────────────────

test("artwork presente y válido → se pinta el fichero", () => {
  assert.equal(debePintarArtwork(A_V1, false), true);
});

test("artwork null → dibujado de siempre", () => {
  assert.equal(debePintarArtwork(null, false), false);
  assert.equal(debePintarArtwork(undefined, false), false);
});

test("URL inválida → dibujado de siempre, sin llegar al DOM", () => {
  for (const malo of [null, "", "   ", "javascript:alert(1)", "data:image/png;base64,AAAA", "ftp://x/y.png"]) {
    assert.equal(
      artworkPintable(ref(malo as string | null, 1)), false,
      `debería rechazar «${malo}»`,
    );
  }
});

test("error al cargar la imagen → dibujado de siempre", () => {
  // Mismo artwork, misma URL: lo único que cambia es que esa imagen ya falló una vez.
  assert.equal(debePintarArtwork(A_V1, false), true);
  assert.equal(debePintarArtwork(A_V1, true), false);
});

// ─────────────────────────── LAS VERSIONES ───────────────────────────

test("la instancia de la v1 pinta el artwork de la v1", () => {
  conMapa({ "uid-v1": A_V1, "uid-v2": A_V2 });
  const html = pinta("uid-v1");
  assert.match(html, /artwork-v1\.png/);
  assert.doesNotMatch(html, /artwork-v2\.png/);
});

test("la instancia de la v2 pinta el artwork de la v2", () => {
  conMapa({ "uid-v1": A_V1, "uid-v2": A_V2 });
  const html = pinta("uid-v2");
  assert.match(html, /artwork-v2\.png/);
  assert.doesNotMatch(html, /artwork-v1\.png/);
});

test("una instancia SIN artwork no toma prestado el de otra versión", () => {
  // Las dos versiones de la misma carta están en el mapa; esta tercera copia no.
  conMapa({ "uid-v1": A_V1, "uid-v2": A_V2 });
  const html = pinta("uid-sin-artwork");
  assert.doesNotMatch(html, /artwork-v1\.png/);
  assert.doesNotMatch(html, /artwork-v2\.png/);
  assert.match(html, /dibujado-por-capas/);
});

test("una carta que no posees (sin uid) se dibuja como siempre", () => {
  conMapa({ "uid-v1": A_V1 });
  const html = pinta(undefined);
  assert.doesNotMatch(html, /artwork-v1\.png/);
  assert.match(html, /dibujado-por-capas/);
});

test("sin sesión el mapa está vacío y TODO cae al dibujado de siempre", () => {
  conMapa({});
  const html = pinta("uid-v1");
  assert.match(html, /dibujado-por-capas/);
  assert.doesNotMatch(html, /<img/);
});

// ─────────────────────────── LA IMAGEN QUE SE EMITE ───────────────────────────

test("la imagen lleva dimensiones explícitas y proporción de carta", () => {
  conMapa({ "uid-v1": A_V1 });
  const html = pinta("uid-v1");
  // Sin `width`/`height` la rejilla salta cuando cada imagen aterriza.
  // CARD ART = CARD VISUAL: las medidas REALES del WebP (750×1048) y su proporción, entera
  // (`nx-card-art` → `object-contain`), sin la caja con chaflán ni la sombra de caja de antes.
  assert.match(html, /width="750"/);
  assert.match(html, /height="1048"/);
  assert.match(html, /aspect-ratio:750 \/ 1048/);
  assert.match(html, /class="nx-card-art /);
  assert.doesNotMatch(html, /nx-clip|shadow-card|object-cover/);
});

test("la imagen se carga en diferido y no bloquea la rejilla", () => {
  conMapa({ "uid-v1": A_V1 });
  const html = pinta("uid-v1");
  assert.match(html, /loading="lazy"/);
  assert.match(html, /decoding="async"/);
});

test("la imagen tiene texto alternativo", () => {
  conMapa({ "uid-v1": A_V1 });
  const html = renderToStaticMarkup(
    <CardFace artwork={A_V1} alt="Carta de aspas__prime"><div /></CardFace>,
  );
  assert.match(html, /alt="Carta de aspas__prime"/);
});

// ─────────────────────────── EL ALMACÉN ───────────────────────────

test("el mapa REEMPLAZA: un artwork retirado en el servidor desaparece aquí", () => {
  conMapa({ "uid-v1": A_V1, "uid-v2": A_V2 });
  conMapa({ "uid-v2": A_V2 });
  assert.equal(useArtworkStore.getState().artworkOf("uid-v1"), undefined);
  assert.equal(useArtworkStore.getState().artworkOf("uid-v2")?.url, A_V2.url);
});

test("artworkOf sin uid no devuelve nada, en vez de devolver el primero que haya", () => {
  conMapa({ "uid-v1": A_V1 });
  assert.equal(useArtworkStore.getState().artworkOf(undefined), undefined);
  assert.equal(useArtworkStore.getState().artworkOf(null), undefined);
  assert.equal(useArtworkStore.getState().artworkOf(""), undefined);
});
