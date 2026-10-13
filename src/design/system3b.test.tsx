/**
 * SISTEMA DE DISEÑO · FASE 3B — tests del CIERRE.
 *
 * La Fase 3 dejó la fundación construida pero no consumible: media escala definida sin
 * exponer, tres primitivas usadas solo por su propio escaparate y un launcher que, al no
 * encontrar piezas, se fabricó un segundo sistema. Esto verifica que eso está cerrado.
 *
 * Son PROPIEDADES, no aspectos. Y la más importante es la última: que no vuelva a haber dos
 * sistemas de diseño en el mismo repositorio.
 */
import { test } from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ACCENT, CHAMFER, DEPTH, FOCUS, LAYER, READOUT, RECESSED, SPACE, STROKE, SURFACE, SURFACES, TYPE,
} from "./tokens";
import { Backdrop, Piece, Plate, Recessed, Stage } from "@/components/ui/Surface";
import { NxButton } from "@/components/ui/NxButton";
import { Badge, StatusDot } from "@/components/ui/Badge";
import { Meter } from "@/components/ui/Meter";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { TONE } from "@/components/ui/tone";

const html = (node: React.ReactElement): string => renderToStaticMarkup(node);
const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), "utf8");

/* ─────────────────────── SUPERFICIES: la gramática, completa ─────────────────────── */

test("SUPERFICIE · los cinco papeles de la gramática existen y tienen pieza", () => {
  const papeles = Object.keys(SURFACES);
  assert.deepEqual(papeles, ["background", "stage", "plate", "recessed", "object"],
    "la lista de papeles es la aprobada, en orden de profundidad");

  const piezas: [string, string][] = [
    [html(<Backdrop>x</Backdrop>), "background"],
    [html(<Stage>x</Stage>), "stage"],
    [html(<Plate>x</Plate>), "plate"],
    [html(<Recessed>x</Recessed>), "recessed"],
    [html(<Piece>x</Piece>), "object"],
  ];
  for (const [markup, papel] of piezas) {
    assert.match(markup, new RegExp(`data-surface="${papel}"`), `${papel} no se identifica`);
  }
});

test("SUPERFICIE · el fondo es el único sin chaflán: es el mundo, no una pieza", () => {
  assert.equal(SURFACES.background.chamfer, null);
  assert.ok(!/nx-clip/.test(html(<Backdrop>x</Backdrop>)));
  // Y sí pinta el lienzo del sistema aunque no se le pase nada.
  assert.match(html(<Backdrop>x</Backdrop>), new RegExp(SURFACE.canvas));
});

test("SUPERFICIE · el objeto se DESPEGA del plano; la placa está apoyada", () => {
  // Es la única diferencia que importa entre las dos, y por eso se verifica.
  assert.equal(SURFACES.object.depth, "object");
  assert.equal(SURFACES.plate.depth, "surface");
  assert.match(html(<Piece>x</Piece>), /box-shadow/i);
  assert.notEqual(String(DEPTH.object), String(DEPTH.surface), "no comparten sombra");
});

test("SUPERFICIE · cada papel toma su chaflán de la escala, no de un valor suelto", () => {
  for (const [papel, def] of Object.entries(SURFACES)) {
    if (def.chamfer === null) continue;
    assert.ok(Object.values(CHAMFER).includes(def.chamfer as never), `${papel} fuera de la escala`);
  }
});

/* ─────────────────────── TRAZO Y FOCO ─────────────────────── */

test("TRAZO · tres pasos semánticos y crecientes", () => {
  assert.equal(Object.keys(STROKE).length, 3, "separar / señalar / advertir");
  const px = Object.values(STROKE).map(parseFloat);
  for (let i = 1; i < px.length; i++) assert.ok(px[i] > px[i - 1]);
});

test("FOCO · una decisión, no tres: el anillo sale de los tokens", () => {
  assert.equal(FOCUS.ring, ACCENT.primary, "el foco no inventa color");
  assert.equal(FOCUS.offset, SURFACE.canvas, "la separación es del color del lienzo");
  assert.equal(FOCUS.width, STROKE.edge, "y su grosor es el paso de «señalar»");
  // `DEPTH.focus` es la misma decisión escrita como sombra: los dos colores tienen que estar.
  assert.ok(DEPTH.focus.includes(SURFACE.canvas), "la sombra de foco usa el lienzo");
  assert.match(DEPTH.focus, /255,\s*46,\s*99/, "y el acento de marca");
});

test("FOCO · NxButton NO pierde su anillo accesible", () => {
  // Regresión: la unificación añade `.nx-focus` al sistema; no puede quitar el foco existente.
  const markup = html(<NxButton variant="primary">x</NxButton>);
  assert.match(markup, /focus-visible:ring-2/);
  assert.match(markup, /focus-visible:ring-offset-2/);
});

/* ─────────────────────── BOTÓN: el acento semántico ─────────────────────── */

test("BOTÓN · el acento solo pinta la primaria y no duplica el relleno", () => {
  const oro = html(<NxButton variant="primary" accent="gold">x</NxButton>);
  assert.ok(!/bg-drl\b/.test(oro), "con acento se retira el relleno de marca");
  assert.ok(oro.includes(ACCENT.gold), "y entra el del acento");

  // Sin acento, nada cambia respecto a la Fase 3.
  assert.match(html(<NxButton variant="primary">x</NxButton>), /bg-drl/);
  // El acento es inerte fuera de la primaria: el papel manda sobre el color.
  assert.ok(!html(<NxButton variant="secondary" accent="gold">x</NxButton>).includes(ACCENT.gold));
});

/* ─────────────────────── PRIMITIVAS PROMOVIDAS ─────────────────────── */

test("INSIGNIA · dice estado, no es un control, y no es una píldora", () => {
  const b = html(<Badge tone="ok">Listo</Badge>);
  assert.match(b, /nx-clip-sm/, "lleva la geometría de la casa");
  assert.ok(!/rounded-full/.test(b), "la insignia no es una píldora (el punto sí es redondo: es un punto)");
  assert.ok(!/<button/.test(b), "una insignia no se pulsa: para eso está Chip");
  assert.ok(b.includes(TONE.ok), "el color sale del vocabulario de tonos");
});

test("PUNTO · el latido se reserva a lo que está vivo", () => {
  assert.match(html(<StatusDot tone="info" pulse />), /animate-ping/);
  assert.ok(!/animate-ping/.test(html(<StatusDot tone="muted" />)), "lo apagado no late");
});

test("MEDIDOR · recorta el rango imposible y publica el valor exacto", () => {
  assert.match(html(<Meter value={140} />), /data-progress="100.000"/);
  assert.match(html(<Meter value={-20} />), /data-progress="0.000"/);
  assert.match(html(<Meter value={Number.NaN} />), /data-progress="0.000"/);
  assert.match(html(<Meter value={50} />), /role="progressbar"/);
  // Se anima por transform, no por width: una descarga avanza cuatro veces por segundo.
  assert.match(html(<Meter value={50} />), /scaleX\(0\.5\)/);
  assert.ok(html(<Meter value={50} />).includes(RECESSED.sm), "el canal es una superficie hundida");
});

test("RÓTULO · usa el papel `label` de la escala, no un tamaño a ojo", () => {
  const s = html(<SectionTitle>Novedades</SectionTitle>);
  assert.match(s, /text-label/);
  assert.ok(!/text-\[\d/.test(s), "sin tamaños arbitrarios");
});

/* ─────────────────────── TOKENS CONSUMIBLES ─────────────────────── */

test("TAILWIND · expone las siete escalas que estaban definidas y no publicadas", () => {
  /*
   * Un token que no se puede escribir en una clase no existe. Antes de la 3B, estas siete
   * tenían CERO referencias en `tailwind.config.ts` y por eso las pantallas escribían
   * `z-70` y tamaños sueltos.
   */
  const cfg = read("../../tailwind.config.ts");
  for (const escala of ["CHAMFER", "LAYER", "TYPE", "READOUT", "SPACE", "DEPTH", "RECESSED", "STROKE", "FOCUS"]) {
    assert.match(cfg, new RegExp(`\\b${escala}\\b`), `${escala} sigue sin exponerse`);
  }
});

test("TAILWIND · consume los tokens, no los copia", () => {
  /*
   * La regla de la fase: `tokens.ts` es la fuente y Tailwind el consumidor. Si el config
   * escribiera los valores a mano habría dos verdades — que es justo lo que se vino a quitar.
   */
  const cfg = read("../../tailwind.config.ts");
  const literales = [CHAMFER.plate, READOUT.lg, STROKE.heavy, RECESSED.md, TYPE.body.size];
  for (const v of literales) {
    assert.ok(!cfg.includes(`"${v}"`), `el valor ${v} está copiado en el config`);
  }
  assert.match(cfg, /from "\.\/src\/design\/tokens"/);
});

test("TOKENS · las escalas nuevas no rompen las anteriores", () => {
  assert.equal(CHAMFER.stage, "18px");
  assert.equal(CHAMFER.control, "10px");
  assert.equal(SPACE[4], "16px");
  assert.equal(LAYER.toast, 80);
});

/* ─────────────────────── NO VOLVER A TENER DOS SISTEMAS ─────────────────────── */

test("GUARDA · el launcher no reimplementa piezas que ya existen", () => {
  /*
   * Este es el test que impide que la Fase 3B se deshaga sola. El launcher tenía su propia
   * placa, su propio botón y su propia insignia; si alguien vuelve a exportarlas desde ahí,
   * esto se pone rojo antes de que crezca un segundo sistema.
   */
  const local = read("../components/launcher/shell/primitives.tsx");
  for (const prohibida of ["Panel", "Cta", "StateBadge", "Tag", "Fact", "Meter", "SectionTitle", "StateDot", "TONE_COLOR"]) {
    assert.ok(
      !new RegExp(`export (function|const) ${prohibida}\\b`).test(local),
      `el launcher vuelve a exportar ${prohibida}: usa la primitiva del sistema`,
    );
  }
});

test("GUARDA · las primitivas locales del launcher no llevan color ni tamaño arbitrario", () => {
  const local = read("../components/launcher/shell/primitives.tsx");
  const cuerpo = local.split("*/").slice(1).join("*/"); // fuera la cabecera documental
  assert.ok(!/#[0-9a-fA-F]{6}\b/.test(cuerpo), "hexadecimal suelto en una primitiva");
  assert.ok(!/text-\[\d+(\.\d+)?px\]/.test(cuerpo), "tamaño de letra fuera de la escala");
});

test("ADOPCIÓN · las pantallas migradas consumen el sistema de verdad", () => {
  /*
   * La Fase 3 se cerró en falso una vez porque las primitivas solo las usaba su propio
   * escaparate. Esto ata la adopción a tres pantallas REALES de producto.
   */
  const pantallas = ["../app/eventos/page.tsx", "../app/logros/page.tsx", "../app/inventario/page.tsx"];
  for (const p of pantallas) {
    const src = read(p);
    assert.match(src, /@\/components\/ui\/(Surface|NxButton|Meter|Badge|Readout|SectionTitle)/,
      `${p} no importa ninguna primitiva del sistema`);
  }
});
