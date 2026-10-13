/**
 * ARMERÍA — tests de la tienda y del botín (Fase 6).
 *
 * Se prueban PROPIEDADES. La más importante es la última: que un envoltorio de carta nunca
 * vuelva a ser más estrecho que la carta que lleva dentro. Ese fallo —invisible en el código,
 * evidente en cuanto se mide— apilaba «el resto del sobre» en una columna que se salía del
 * cuadro, y es el mismo que en la Fase 5 dejaba 112 px muertos en cada celda del álbum.
 */
import { test } from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { ShopHero } from "./ShopHero";
import { ShopRail } from "./ShopRail";
import { PACKS, getPack } from "@/data/packs";
import { packStats } from "@/data/packStats";
import { READOUT } from "@/design/tokens";

const html = (n: React.ReactElement): string => renderToStaticMarkup(n);
const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), "utf8");

const PREMIUM = getPack("premium")!;
const INICIAL = getPack("inicial")!;
const EWC = getPack("ewc")!;
const noop = () => {};

/* ─────────────────────── LA VITRINA ─────────────────────── */

test("VITRINA · el precio y el saldo se leen juntos", () => {
  /*
   * Antes el precio estaba DEBAJO del botón, al final de la tarjeta: se decidía comprar
   * antes de saber lo que costaba. La resta la tiene que poder hacer el ojo, no la memoria.
   */
  const markup = html(
    <ShopHero pack={PREMIUM} owned={0} credits={18450} busy={false} onBuyAndOpen={noop} onBuyOnly={noop} />,
  );
  assert.match(markup, /Precio/);
  assert.match(markup, /Tu saldo/);
  assert.match(markup, /18\.450/);
  assert.ok(markup.includes(READOUT.md), "el precio usa el paso `md` de la escala de cifras");
});

test("VITRINA · sin saldo se dice cuánto falta y no se deja comprar", () => {
  const markup = html(
    <ShopHero pack={PREMIUM} owned={0} credits={50} busy={false} onBuyAndOpen={noop} onBuyOnly={noop} />,
  );
  assert.match(markup, /Te faltan/, "un botón apagado sin explicación no es una respuesta");
  assert.match(markup, /disabled/);
});

test("VITRINA · con un sobre en el inventario se abre, no se vuelve a comprar", () => {
  const markup = html(
    <ShopHero pack={PREMIUM} owned={2} credits={0} busy={false} onBuyAndOpen={noop} onBuyOnly={noop} />,
  );
  assert.match(markup, /Abrir sobre/);
  assert.match(markup, /2 sin abrir/);
  assert.ok(!/Te faltan/.test(markup), "teniendo el sobre, el saldo da igual");
});

test("VITRINA · el sobre gratuito no ofrece «comprar sin abrir»", () => {
  const gratis = html(<ShopHero pack={INICIAL} owned={0} credits={0} busy={false} onBuyAndOpen={noop} onBuyOnly={noop} />);
  assert.match(gratis, /Conseguir y abrir/);
  assert.ok(!/Comprar sin abrir/.test(gratis));

  const pago = html(<ShopHero pack={PREMIUM} owned={0} credits={99999} busy={false} onBuyAndOpen={noop} onBuyOnly={noop} />);
  assert.match(pago, /Comprar sin abrir/, "y el de pago sí, CON etiqueta: no un «+» sin nombre");
});

test("VITRINA · un sobre por rareza enseña el reparto MEDIDO, no el declarado", () => {
  /*
   * Un sobre declara sus pesos y la garantía de la última carta desplaza el reparto. Enseñar el peso declarado sería
   * prometer una probabilidad que el sobre no cumple. La cifra sale de `data/packStats`, la medición del motor.
   * (Fase 57.3 / Pack Opening 3.1: la línea y los especiales sortean por plan; Prime —retirado, de recompensa— sigue por
   * rareza, y la regla vale para él y para cualquier producto futuro por rareza.)
   */
  const stats = packStats("prime");
  assert.ok(stats, "Prime tiene estadística medida");
  const markup = html(<ShopHero pack={getPack("prime")!} owned={0} credits={0} busy={false} onBuyAndOpen={noop} onBuyOnly={noop} />);
  assert.match(markup, /Reparto real/);
  assert.match(markup, new RegExp(`${Math.round(stats!.drawn.common * 100)}%`));
});

test("VITRINA · Pack Opening 3.0: un sobre de la línea principal enseña su media EXACTA por clase (un decimal), no rarezas", () => {
  const markup = html(<ShopHero pack={PREMIUM} owned={0} credits={0} busy={false} onBuyAndOpen={noop} onBuyOnly={noop} />);
  assert.doesNotMatch(markup, /Reparto real/);
  // Plata: 5 normales (Plata 82 % · Oro 15 % · Masters 3 %) + la destacada → media por carta; ninguna posible sale como 0 %.
  for (const [label, p] of [["Plata", "70,8"], ["Oro", "19,1"], ["Masters", "7,3"], ["Champions", "1,7"], ["Prime", "0,8"], ["Icon", "0,3"]] as const) {
    assert.match(markup, new RegExp(`${label}<span[^>]*>${p} %`), `${label} ${p} %`);
  }
  assert.doesNotMatch(markup, />0 %</);
});

test("VITRINA · la garantía se anuncia solo si es verdad", () => {
  // Pack Opening 3.1 · EWC sortea por plan: su garantía vive en la carta destacada y se dice así.
  assert.match(html(<ShopHero pack={EWC} owned={0} credits={0} busy={false} onBuyAndOpen={noop} onBuyOnly={noop} />), /Champions o Icon garantizada en la carta destacada/);
  assert.match(html(<ShopHero pack={getPack("prime")!} owned={0} credits={0} busy={false} onBuyAndOpen={noop} onBuyOnly={noop} />), /Épica\+ garantizada/);
  assert.doesNotMatch(html(<ShopHero pack={PREMIUM} owned={0} credits={0} busy={false} onBuyAndOpen={noop} onBuyOnly={noop} />), /garantizada/i, "Plata puede dar cualquier clase de Plata a Icon: no garantiza ninguna");
  assert.match(html(<ShopHero pack={getPack("icon")!} owned={0} credits={0} busy={false} onBuyAndOpen={noop} onBuyOnly={noop} />), /Prime o Icon garantizada/);
});

test("VITRINA · la economía se consulta, no abre la tienda", () => {
  const markup = html(<ShopHero pack={PREMIUM} owned={0} credits={0} busy={false} onBuyAndOpen={noop} onBuyOnly={noop} />);
  assert.match(markup, /Para qué sirve este sobre/, "el detalle existe");
  assert.ok(!/por carta/.test(markup), "pero plegado: una tienda no abre con una hoja de cálculo");
});

test("VITRINA · mientras compra, el botón lo dice y no se puede pulsar dos veces", () => {
  const markup = html(<ShopHero pack={PREMIUM} owned={0} credits={99999} busy onBuyAndOpen={noop} onBuyOnly={noop} />);
  assert.match(markup, /Procesando…/);
  assert.match(markup, /disabled/);
});

/* ─────────────────────── EL CARRIL ─────────────────────── */

test("CARRIL · cada sobre dice qué es, cuánto cuesta y cuántos tienes", () => {
  const packs = PACKS.filter((p) => !p.eventId && !p.retired).slice(0, 3);
  const markup = html(
    <ShopRail packs={packs} selectedId={packs[1].id} onSelect={noop} owned={{ [packs[0].id]: 2 }} credits={1000} />,
  );
  for (const p of packs) assert.match(markup, new RegExp(p.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(markup, /2 sin abrir/);
  assert.match(markup, /aria-current="true"/, "se ve cuál estás mirando");
});

test("CARRIL · dibuja el MISMO sobre que se compra y se abre", () => {
  const src = read("./ShopRail.tsx");
  assert.match(src, /@\/components\/packs\/SealedPack/, "sin segunda representación del objeto");
  assert.ok(!/<img/.test(src), "el sobre no es una imagen: es la pieza del sistema");
});

/* ─────────────────────── REGRESIÓN DEL ENVOLTORIO ─────────────────────── */

test("CARTA · un ancho propio gana al `w-full` por defecto de Card3D", () => {
  /*
   * `clsx` concatena y no resuelve conflictos: cuál de las dos clases manda lo decide el
   * orden del CSS, no el del atributo. Por eso `className="w-[150px]"` perdía contra el
   * `w-full` interno y el resumen del sobre se apilaba en una columna a ancho completo.
   */
  const src = read("../visual/Card3D.tsx");
  assert.match(src, /anchoPropio/, "la carta debe apartarse cuando le dan una medida");
  assert.ok(!/"relative block w-full origin-center/.test(src), "`w-full` ya no puede ser incondicional");
});

test("BOTÍN · el envoltorio mide lo que mide la carta que lleva dentro", () => {
  /*
   * `PlayerCard` tiene anchos FIJOS por tamaño (sm 150, md 230, lg 300). Si el envoltorio
   * pide menos, la carta se sale y tapa lo que tenga al lado — que es exactamente lo que le
   * pasaba a la carta grande del botín sobre las cifras.
   */
  // Fase 38: el botín vive en el resumen de la ceremonia.
  const src = read("../packs/PackSummary.tsx");
  // Pack Opening 3.0 · la hero crece a `lg` (300 px) y su caja también.
  const hero = /className="w-\[300px\]"[\s\S]{0,220}?size="lg"/.test(src);
  assert.ok(hero, "la carta protagonista: 300 px de caja para una carta `lg` de 300 px");
  const resto = /className="w-\[150px\]"[\s\S]{0,220}?size="sm"/.test(src);
  assert.ok(resto, "el resto del botín: 150 px de caja para una carta `sm` de 150 px");
});

/* ─────────────────────── ADOPCIÓN Y ANTI-GRAMÁTICA ─────────────────────── */

test("ADOPCIÓN · la tienda se compone con primitivas del sistema", () => {
  const piezas = ["ShopHero.tsx", "ShopRail.tsx"].map((f) => read(`./${f}`)).join("\n");
  for (const p of ["Surface", "NxButton", "Readout", "Badge"]) {
    assert.match(piezas, new RegExp(`@/components/ui/${p}`), `la tienda no usa ${p}`);
  }
  // Fase 49 · /tienda ya no compone ShopHero/ShopRail (siguen vivos en el arnés de la Fase 44.1): la
  // Tienda 4.0 se compone con sus piezas, que usan las mismas primitivas (ver `store.contract`).
  const page = read("../../app/tienda/page.tsx");
  for (const piece of ["StoreHero", "StoreTabs", "PackOfferCard", "BoxOfferCard", "CardOfferCard", "BundleOfferCard", "PurchaseModal"]) {
    assert.match(page, new RegExp(piece), `la tienda no compone ${piece}`);
  }
});

test("ANTI-GRAMÁTICA · la tienda no reintroduce lo que el sistema vino a quitar", () => {
  const cuerpo = ["ShopHero.tsx", "ShopRail.tsx"]
    .map((f) => read(`./${f}`).split("*/").slice(1).join("*/"))
    .join("\n");
  assert.ok(!/text-\[\d+(\.\d+)?px\]/.test(cuerpo), "tamaño de letra fuera de la escala");
  assert.ok(!/z-\[\d+\]/.test(cuerpo), "z-index arbitrario");
  assert.ok(!/rounded-(xl|2xl|3xl|panel|card)\b/.test(cuerpo), "tarjeta redondeada genérica");
  // Los cinco colores de rareza SÍ son literales: son la identidad del sistema de cartas,
  // no una decisión de esta pantalla. Cualquier otro hexadecimal sobra.
  const hex = cuerpo.match(/#[0-9a-fA-F]{6}\b/g) ?? [];
  assert.ok(hex.length <= 5, `hexadecimales de más: ${hex.join(", ")}`);
});

test("ECONOMÍA · la tienda no decide precios ni probabilidades", () => {
  const page = read("../../app/tienda/page.tsx");
  const hero = read("./ShopHero.tsx");
  // Fase 49 · la página no lee el catálogo a mano: lo resuelve `domain/store/resolve` desde `data/packs`.
  assert.match(page, /from "@\/domain\/store\/resolve"/, "los productos salen del resolvedor");
  assert.match(read("../../domain/store/resolve.ts"), /from "@\/data\/packs"/, "los sobres salen del catálogo");
  assert.match(hero, /@\/data\/packStats/, "el reparto sale de la medición");
  assert.match(hero, /@\/domain\/packs\/guidance/, "la orientación sale del dominio");
  // Ojo con el patrón: `pack.price === 0` es una COMPARACIÓN, no una asignación. Lo que no
  // puede haber aquí es un precio o un peso escrito a mano.
  assert.ok(!/price\s*[:=][^=]/.test(hero), "aquí no se escribe un precio");
  assert.ok(!/weights\s*[:=][^=]/.test(hero), "ni un peso");
});
