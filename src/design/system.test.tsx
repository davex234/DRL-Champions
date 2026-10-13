/**
 * SISTEMA DE DISEÑO — tests de las fundaciones y las primitivas.
 *
 * Se comprueban PROPIEDADES del sistema, no aspectos. La más importante: que la Fase 3 no
 * cambie ni un valor de los que ya usan 36 pantallas. Una fundación que reflowa el producto
 * mientras lo ordena no es una fundación, es un rediseño encubierto.
 */
import { test } from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CHAMFER, RECESSED, READOUT, DEPTH, LAYER, DENSITY,
  SURFACE, RADIUS, ELEVATION, DURATION, EASING, BREAKPOINT, SPACE,
} from "./tokens";
import { NxButton, type NxButtonVariant } from "@/components/ui/NxButton";
import { Stage, Plate, Recessed, Rail, Medallion } from "@/components/ui/Surface";
import { Readout } from "@/components/ui/Readout";

const VARIANTES: NxButtonVariant[] = ["primary", "secondary", "tertiary", "ghost", "danger", "icon"];

/* ─────────────────────── NO ROMPER LO QUE YA EXISTE ─────────────────────── */

test("FUNDACIÓN · el chaflán nuevo NO cambia los valores que ya usaban 94 llamadas", () => {
  /*
   * `.nx-clip` valía 18 px y `.nx-clip-sm` 10 px antes de esta fase. Si la escala por rol
   * cambiara esos dos, las 94 llamadas existentes al chaflán se moverían — y esta fase tiene
   * prohibido rediseñar pantallas.
   */
  assert.equal(CHAMFER.stage, "18px", "`stage` es el --nx-chamfer de siempre");
  assert.equal(CHAMFER.control, "10px", "`control` es el --nx-chamfer-sm de siempre");
});

test("FUNDACIÓN · globals.css y el token del chaflán NO pueden divergir", () => {
  /*
   * `globals.css` no puede importar TypeScript, así que publica `--nx-chamfer` con su valor
   * escrito a mano. Eso es DOS fuentes para un mismo valor —justo lo que esta fase viene a
   * eliminar—, y la única forma honesta de tener dos copias es que algo falle cuando se
   * separen. Este test es ese algo.
   */
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  const leer = (v: string): string | undefined => new RegExp(`${v}:\\s*([0-9]+px)`).exec(css)?.[1];
  assert.equal(leer("--nx-chamfer"), CHAMFER.stage, "--nx-chamfer debe valer CHAMFER.stage");
  assert.equal(leer("--nx-chamfer-sm"), CHAMFER.control, "--nx-chamfer-sm debe valer CHAMFER.control");
});

test("FUNDACIÓN · los tokens anteriores siguen intactos", () => {
  assert.equal(SURFACE.canvas, "#06070d");
  assert.equal(RADIUS.md, "10px");
  assert.equal(ELEVATION.md, "0 6px 16px -4px rgba(0,0,0,0.55)");
  assert.equal(DURATION.fast, 200);
  assert.equal(EASING.out, "cubic-bezier(0.16, 1, 0.3, 1)");
  assert.equal(BREAKPOINT.mobile, 390);
});

test("FUNDACIÓN · la escalera de profundidad reutiliza ELEVATION, no la duplica", () => {
  // Si `DEPTH` inventara sus propias sombras habría dos sistemas de elevación.
  assert.equal(DEPTH.subtle, ELEVATION.sm);
  assert.equal(DEPTH.surface, ELEVATION.md);
  assert.equal(DEPTH.object, ELEVATION.lg);
  assert.equal(DEPTH.impact, ELEVATION.xl);
  assert.ok(DEPTH.focus.length > 0, "`focus` es el único escalón nuevo: no existía");
});

/* ─────────────────────── ESCALAS ─────────────────────── */

test("las escalas son CORTAS: el problema era la arbitrariedad, no el número", () => {
  assert.equal(Object.keys(CHAMFER).length, 4, "cuatro roles de chaflán");
  assert.equal(Object.keys(READOUT).length, 5, "cinco pasos de cifra");
  assert.equal(Object.keys(RECESSED).length, 3, "tres profundidades de hueco");
  assert.equal(Object.keys(DENSITY).length, 2, "dos densidades, ni una más");
});

test("la escala de cifras es MONÓTONA", () => {
  const px = Object.values(READOUT).map((v) => parseFloat(v));
  for (let i = 1; i < px.length; i++) assert.ok(px[i] > px[i - 1], "cada paso crece");
});

test("las capas tienen orden y no se pisan", () => {
  const v = Object.values(LAYER);
  for (let i = 1; i < v.length; i++) assert.ok(v[i] > v[i - 1], "la jerarquía es estricta");
  assert.ok(LAYER.toast > LAYER.modal && LAYER.modal > LAYER.overlay);
});

test("las dos densidades comparten geometría y solo cambian el ritmo", () => {
  const g = DENSITY.gameplay, m = DENSITY.management;
  assert.ok(parseFloat(g.gap) > parseFloat(m.gap), "jugar tiene más aire que administrar");
  assert.ok(parseFloat(g.readout) > parseFloat(m.readout), "y el dato pesa más");
  assert.equal(g.label, m.label, "pero la etiqueta es la misma: es el conector del HUD");
  assert.ok(Object.values(SPACE).includes(g.gap) && Object.values(SPACE).includes(m.gap),
    "los dos ritmos salen de la escala de espaciado, no de valores sueltos");
});

/* ─────────────────────── BOTONES ─────────────────────── */

const btn = (v: NxButtonVariant, props: Record<string, unknown> = {}): string =>
  renderToStaticMarkup(<NxButton variant={v} {...props}>x</NxButton>);

test("BOTÓN · los seis papeles comparten la MISMA geometría", () => {
  // Es lo que los hace una familia. Seis geometrías serían seis botones.
  for (const v of VARIANTES) assert.match(btn(v), /nx-clip-sm/, `${v} sin el chaflán de control`);
});

test("BOTÓN · ninguno es una píldora", () => {
  // La píldora (`rounded-full`) se usa 218 veces en el producto y es la anti-gramática.
  for (const v of VARIANTES) assert.ok(!/rounded-full/.test(btn(v)), `${v} es una píldora`);
});

test("BOTÓN · el foco no se borra sin sustituto", () => {
  for (const v of VARIANTES) {
    const html = btn(v);
    assert.match(html, /focus-visible:ring-2/, `${v} sin anillo de foco`);
    assert.match(html, /focus-visible:ring-offset-2/, `${v} sin separación del anillo`);
  }
});

test("BOTÓN · md y lg cumplen el objetivo táctil de 44 px", () => {
  assert.match(btn("primary", { size: "md" }), /min-h-\[44px\]/);
  assert.match(btn("primary", { size: "lg" }), /min-h-\[52px\]/);
  assert.match(btn("icon", { size: "md" }), /h-\[44px\]/);
});

test("BOTÓN · por defecto NO envía formularios", () => {
  assert.match(btn("primary"), /type="button"/);
  assert.match(renderToStaticMarkup(<NxButton type="submit">x</NxButton>), /type="submit"/);
});

test("BOTÓN · el estado deshabilitado no depende solo del color", () => {
  const html = renderToStaticMarkup(<NxButton variant="primary" disabled>x</NxButton>);
  assert.match(html, /disabled=""/, "el atributo real, no solo un estilo");
  assert.match(html, /disabled:cursor-not-allowed/);
});

test("BOTÓN · una sola variante rellena de acento: la primaria", () => {
  const rellenos = VARIANTES.filter((v) => /bg-drl\b/.test(btn(v)));
  assert.deepEqual(rellenos, ["primary"], "si algo es rojo pleno, se pulsa");
});

/* ─────────────────────── SUPERFICIES ─────────────────────── */

test("SUPERFICIE · las cinco se identifican y llevan la geometría de la casa", () => {
  const casos: [string, string][] = [
    [renderToStaticMarkup(<Stage>x</Stage>), "stage"],
    [renderToStaticMarkup(<Plate>x</Plate>), "plate"],
    [renderToStaticMarkup(<Recessed>x</Recessed>), "recessed"],
    [renderToStaticMarkup(<Rail label="x" />), "rail"],
    [renderToStaticMarkup(<Medallion>x</Medallion>), "medallion"],
  ];
  for (const [html, nombre] of casos) {
    assert.match(html, new RegExp(`data-surface="${nombre}"`), `${nombre} sin marcar`);
    assert.match(html, /nx-clip/, `${nombre} sin chaflán`);
    assert.ok(!/rounded-full/.test(html), `${nombre} es una píldora`);
  }
});

test("SUPERFICIE · la hundida se dibuja con sombra interior, que es lo que la hace hueco", () => {
  const html = renderToStaticMarkup(<Recessed depth="md">x</Recessed>);
  assert.match(html, /inset/, "un hueco no tiene color propio: tiene luz");
});

test("SUPERFICIE · el tinte es semántico y sale de la paleta, no de valores sueltos", () => {
  const cyan = renderToStaticMarkup(<Plate tone="cyan">x</Plate>);
  assert.match(cyan, /25,227,255/, "el cian del sistema");
});

/* ─────────────────────── CIFRAS ─────────────────────── */

test("READOUT · la cifra se reconoce SIN color", () => {
  /*
   * §10 del encargo. La firma es la familia condensada + cifras tabulares + la etiqueta en
   * versalitas encima, no el tono: por eso `nx-readout` y `nx-label` tienen que estar los dos.
   */
  const html = renderToStaticMarkup(<Readout label="OVR" value="92" />);
  assert.match(html, /nx-readout/);
  assert.match(html, /nx-label/);
  assert.ok(!/color:/.test(html), "sin `tone` no impone color: hereda");
});

test("READOUT · los cinco pasos salen de la escala", () => {
  for (const s of Object.keys(READOUT) as (keyof typeof READOUT)[]) {
    assert.ok(renderToStaticMarkup(<Readout size={s} value="1" />).includes(READOUT[s]), `${s} fuera de escala`);
  }
});

test("READOUT · no formatea: eso es del dominio", () => {
  // Se le da el valor ya escrito. Separar millares o abreviar no es una decisión tipográfica.
  assert.match(renderToStaticMarkup(<Readout value="1.284.000" />), /1\.284\.000/);
});

/* ─────────────────────── NO REGRESIÓN DE LO CERRADO ─────────────────────── */

test("REGRESIÓN · CardEffects y VariantIdentity siguen intactos", async () => {
  const { materialForRank, MATERIAL_ORDER } = await import("@/components/cards/CardEffects");
  const { variantIdentity } = await import("./variantIdentity");
  assert.equal(materialForRank(12), "premium", "Clutch King conserva su material");
  assert.equal(MATERIAL_ORDER.length, 5);
  assert.equal(variantIdentity("champion-edition" as never).seal, "champion");
  assert.equal(variantIdentity("rookie" as never).seal, null, "rookie sigue bloqueada");
});
