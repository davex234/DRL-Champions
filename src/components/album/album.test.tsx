/**
 * ÁLBUM — tests de la colección (Fase 5).
 *
 * Se prueban PROPIEDADES, no aspectos. La más importante es la primera: que la rejilla se
 * declare en la medida de la carta. Ese era el fallo que descolocaba las marcas de duplicado
 * y de bloqueada, y no se veía en ninguna captura anterior porque hay que MEDIR la celda para
 * darse cuenta de que sobraban 112 px.
 */
import { test } from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { AlbumHeader } from "./AlbumHeader";
import { AlbumToolbar } from "./AlbumToolbar";
import { AlbumEmpty, AlbumGrid, AlbumNoResults, type AlbumCard } from "./AlbumGrid";
import { CARDS } from "@/data/catalog";
import { READOUT } from "@/design/tokens";

const html = (n: React.ReactElement): string => renderToStaticMarkup(n);
const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), "utf8");

const carta = (owned: boolean, count = 1): AlbumCard => ({
  cardId: CARDS[0].id, def: CARDS[0], owned, count,
});

const facetas = [
  { label: "Región", value: "Todas", options: [{ value: "Todas", label: "Todas" }, { value: "EMEA", label: "EMEA" }], onChange: () => {} },
];

/* ─────────────────────── LA REJILLA ─────────────────────── */

test("REJILLA · las columnas miden lo que mide una carta", () => {
  /*
   * La celda era flexible (`grid-cols-5`) y a 1440 px medía 262 px para una carta de 150:
   * 112 px muertos, y las marcas de `Card3D` —que se posicionan contra SU caja— caían fuera
   * del objeto. Declarar la columna en 150 px es lo que las vuelve a pegar a la carta.
   */
  const src = read("./AlbumGrid.tsx");
  assert.match(src, /repeat\(auto-fill,150px\)/, "la columna no está atada al ancho de la carta");
  assert.ok(!/grid-cols-\d/.test(src), "un número fijo de columnas vuelve a dejar hueco muerto");
  assert.match(src, /justify-center/, "sin centrar, el álbum se pega a un lado");
});

test("REJILLA · no inventa una cuarta carta: usa PlayerCard dentro de Card3D estático", () => {
  const src = read("./AlbumGrid.tsx");
  assert.match(src, /<PlayerCard/);
  assert.match(src, /mode="static"/, "el modo estático es el que no monta framer-motion");
  assert.match(src, /interactive=\{false\}/, "el movimiento lo pone Card3D, y solo él");
});

test("REJILLA · la carta que no tienes se marca como bloqueada, no se esconde (y abre su ficha pública — Fase 37)", () => {
  const markup = html(<AlbumGrid cards={[carta(false)]} onOpen={() => {}} remaining={0} onMore={() => {}} />);
  assert.match(markup, /data-locked/, "la silueta bloqueada del sistema");
  assert.match(markup, /todavía no la tienes/, "y se dice en el nombre accesible");
  assert.match(markup, /No conseguida/, "y en texto visible, no solo con color");
  assert.ok(!/disabled/.test(markup), "Fase 37: la definición pública de una carta no conseguida se puede abrir");
});

test("REJILLA · el duplicado se cuenta sobre la carta", () => {
  const markup = html(<AlbumGrid cards={[carta(true, 3)]} onOpen={() => {}} remaining={0} onMore={() => {}} />);
  assert.match(markup, /×3/);
  assert.ok(!/×1/.test(html(<AlbumGrid cards={[carta(true, 1)]} onOpen={() => {}} remaining={0} onMore={() => {}} />)),
    "una sola copia no lleva contador");
});

test("REJILLA · el paginado dice cuántas quedan y no aparece si no queda ninguna", () => {
  const con = html(<AlbumGrid cards={[carta(true)]} onOpen={() => {}} remaining={120} onMore={() => {}} />);
  assert.match(con, /quedan 120/);
  assert.match(con, /48 cartas más/, "pide una tanda, no todas de golpe");
  const sin = html(<AlbumGrid cards={[carta(true)]} onOpen={() => {}} remaining={0} onMore={() => {}} />);
  assert.ok(!/quedan/.test(sin));
});

/* ─────────────────────── ESTADOS ─────────────────────── */

test("VACÍO · el álbum de un jugador nuevo explica el siguiente paso con su dato real", () => {
  const conSobres = html(<AlbumEmpty packs={4} />);
  assert.match(conSobres, /Tu álbum está vacío/);
  assert.match(conSobres, /4 sobres sin abrir/, "la cifra sale del estado, no de una plantilla");
  assert.match(conSobres, /Abrir sobres/);
  assert.match(conSobres, /href="\/inventario"/);

  const sinSobres = html(<AlbumEmpty packs={0} />);
  assert.match(sinSobres, /Ir a la tienda/);
  assert.match(sinSobres, /href="\/tienda"/);
});

test("SIN RESULTADOS · no es un error y lo que ofrece es deshacer, no reintentar", () => {
  const markup = html(<AlbumNoResults onClear={() => {}} />);
  assert.match(markup, /Sin resultados/);
  assert.match(markup, /Limpiar filtros/);
  assert.ok(!/error|fallo|reintentar/i.test(markup));
});

/* ─────────────────────── CABECERA ─────────────────────── */

test("CABECERA · contesta cuántas tengo y cuántas me faltan, con la cifra del sistema", () => {
  const markup = html(<AlbumHeader distinct={42} total={772} percent={5} instances={45} online={false} />);
  assert.match(markup, /Conseguidas/);
  assert.match(markup, />42</);
  assert.match(markup, /\/ 772/);
  assert.match(markup, /Por descubrir/);
  assert.match(markup, />730</, "lo que falta es una resta, no un dato nuevo");
  assert.ok(markup.includes(READOUT.lg), "la cifra principal usa el paso `lg` de la escala");
  assert.match(markup, /45 copias en posesión/, "los duplicados se dicen aparte de las distintas");
});

test("CABECERA · distingue de dónde vienen las cartas", () => {
  assert.match(html(<AlbumHeader distinct={1} total={2} percent={50} instances={1} online />), /Guardado en el servidor/);
  assert.match(html(<AlbumHeader distinct={1} total={2} percent={50} instances={1} online={false} />), /Modo local/);
});

/* ─────────────────────── HERRAMIENTA ─────────────────────── */

test("HERRAMIENTA · buscar, propiedad y orden están SIEMPRE a la vista", () => {
  const markup = html(
    <AlbumToolbar
      query="" onQuery={() => {}} ownership="todas" onOwnership={() => {}} sort="rarity" onSort={() => {}}
      facets={facetas} open={false} onToggle={() => {}} activeCount={0} onClear={() => {}} shown={48} matched={772}
    />,
  );
  assert.match(markup, /Buscar jugador o equipo/);
  for (const t of ["Todas", "Tengo", "Faltan", "Rareza", "OVR", "A-Z"]) {
    assert.match(markup, new RegExp(t), `${t} debería estar sin desplegar nada`);
  }
  assert.ok(!/EMEA/.test(markup), "las facetas sí se pliegan");
});

test("HERRAMIENTA · plegada no dice nada; desplegada, agrupa con su rótulo", () => {
  const abierta = html(
    <AlbumToolbar
      query="" onQuery={() => {}} ownership="todas" onOwnership={() => {}} sort="rarity" onSort={() => {}}
      facets={facetas} open onToggle={() => {}} activeCount={0} onClear={() => {}} shown={48} matched={772}
    />,
  );
  assert.match(abierta, /Región/, "catorce píldoras sin rótulo no son un filtro");
  assert.match(abierta, /EMEA/);
});

test("HERRAMIENTA · el resumen solo aparece cuando hay algo acotado", () => {
  const limpia = html(
    <AlbumToolbar
      query="" onQuery={() => {}} ownership="todas" onOwnership={() => {}} sort="rarity" onSort={() => {}}
      facets={facetas} open={false} onToggle={() => {}} activeCount={0} onClear={() => {}} shown={48} matched={772}
    />,
  );
  assert.ok(!/Limpiar/.test(limpia), "una barra vacía es ruido");

  const filtrada = html(
    <AlbumToolbar
      query="derke" onQuery={() => {}} ownership="owned" onOwnership={() => {}} sort="ovr" onSort={() => {}}
      facets={facetas} open={false} onToggle={() => {}} activeCount={1} onClear={() => {}} shown={3} matched={3}
    />,
  );
  assert.match(filtrada, /Buscando/);
  assert.match(filtrada, /Solo las que tengo/);
  assert.match(filtrada, /Limpiar/);
});

/* ─────────────────────── SISTEMA Y ANTI-GRAMÁTICA ─────────────────────── */

test("ADOPCIÓN · el álbum se compone con primitivas del sistema", () => {
  const piezas = ["AlbumHeader.tsx", "AlbumToolbar.tsx", "AlbumGrid.tsx"].map((f) => read(`./${f}`)).join("\n");
  for (const p of ["Surface", "NxButton", "Readout", "Meter", "Badge", "Segmented", "SectionTitle", "Chip"]) {
    assert.match(piezas, new RegExp(`@/components/ui/${p}`), `el álbum no usa ${p}`);
  }
  // Fase 37: la sala sustituye cabecera/barra por CollectionHero + filtros propios; la rejilla sigue siendo AlbumGrid
  // (Card3D canónico) y el detalle vive en su ruta enlazable, no en un visor modal con valor y venta.
  const page = read("../../app/coleccion/page.tsx") + read("../collectionRoom/CollectionRoomScreen.tsx");
  assert.match(page, /AlbumGrid/);
  assert.match(page, /CollectionHero/);
  assert.match(page, /cardHref/, "abrir una carta navega a /coleccion/carta/[cardId]");
  assert.ok(!/CardViewer/.test(page), "sin el visor legado con valor en monedas y venta rápida");
});

test("ANTI-GRAMÁTICA · el álbum no reintroduce lo que el sistema vino a quitar", () => {
  const cuerpo = ["AlbumHeader.tsx", "AlbumToolbar.tsx", "AlbumGrid.tsx"]
    .map((f) => read(`./${f}`).split("*/").slice(1).join("*/"))
    .join("\n");
  assert.ok(!/#[0-9a-fA-F]{6}\b/.test(cuerpo), "hexadecimal suelto");
  assert.ok(!/text-\[\d+(\.\d+)?px\]/.test(cuerpo), "tamaño de letra fuera de la escala");
  assert.ok(!/z-\[\d+\]/.test(cuerpo), "z-index arbitrario");
  assert.ok(!/rounded-(xl|2xl|3xl|panel|card)\b/.test(cuerpo), "tarjeta redondeada genérica");
});

test("SISTEMA · el segmentado ya no es una primitiva local del launcher", () => {
  const local = read("../launcher/shell/primitives.tsx");
  assert.ok(!/export function Segmented/.test(local), "quedaría duplicado con el del sistema");
  const settings = read("../launcher/shell/SettingsView.tsx");
  assert.match(settings, /@\/components\/ui\/Segmented/, "el launcher consume el del sistema");
});
