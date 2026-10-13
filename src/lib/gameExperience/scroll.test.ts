/**
 * FASE 44.1 · SCROLL (1–28) — la rueda del ratón vuelve a mover las páginas, y ningún modal la deja bloqueada.
 *
 * Causa raíz demostrada con rueda REAL (CDP `mouseWheel`, `scripts/_fase44-1-wheel.ts`): `overflow-x: hidden` en html y
 * body convertía body en un contenedor de scroll que no se desplaza y `overscroll-behavior-y: none` en body cortaba el
 * encadenamiento al documento. Estas pruebas fijan el arreglo en la CSS, prohíben los parches (listeners de rueda
 * globales, `scrollBy`) y ejercitan el cerrojo de scroll compartido, incluido un fuzzer de 100.000 operaciones.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createScrollLock, lockScroll, scrollLockCount, type StyleTarget } from "./scrollLock";

const ROOT = process.cwd();
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");
const GLOBALS = read("src", "app", "globals.css");
const GX = read("src", "app", "game-experience.css");
/** La CSS sin comentarios (los comentarios explican la causa y citan las reglas viejas). */
const css = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "");

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n)) out.push(p);
  }
  return out;
}
const SOURCES = walk(join(ROOT, "src")).map((p) => ({ p: p.replace(/\\/g, "/"), s: readFileSync(p, "utf8") }));
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** Bloques de regla cuyo selector contiene `sel` (sin anidamiento de @media para html/body de nivel superior). */
function rules(source: string, sel: RegExp): string[] {
  const out: string[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css(source)))) if (sel.test(m[1].trim())) out.push(m[2]);
  return out;
}

function target(initial = ""): StyleTarget { return { style: { overflow: initial } }; }

/* ───────────── CSS: la causa raíz ───────────── */

test("SCROLL 01 · html/body recortan en horizontal con `clip`, no con `hidden`", () => {
  const block = rules(GLOBALS, /(^|,)\s*html\s*,\s*body\s*$|^html,\s*body$/).join("\n");
  assert.match(block, /overflow-x:\s*clip/);
  assert.ok(!/overflow-x:\s*hidden/.test(block));
});

test("SCROLL 02 · ninguna regla de nivel superior pone `overflow-x: hidden` en html o body", () => {
  for (const src of [GLOBALS, GX]) {
    for (const b of rules(src, /^(html|body)(\s*,\s*(html|body))?$/)) assert.ok(!/overflow(-x|-y)?:\s*(hidden|auto|scroll)/.test(b), b);
  }
});

test("SCROLL 03 · `overscroll-behavior` solo en html (el viewport), nunca en body", () => {
  const html = rules(GLOBALS, /^html$/).join("\n");
  assert.match(html, /overscroll-behavior-y:\s*none/);
  for (const b of rules(GLOBALS, /(^|,)\s*body\s*$/)) assert.ok(!/overscroll-behavior/.test(b), "body sin overscroll-behavior");
  for (const b of rules(GX, /(^|,)\s*body\s*$/)) assert.ok(!/overscroll-behavior/.test(b));
});

test("SCROLL 04 · la causa queda documentada junto al arreglo (no un cambio mudo)", () => {
  assert.match(GLOBALS, /LA RUEDA DEL RATÓN NO MOVÍA NINGUNA PÁGINA/);
  assert.match(GLOBALS, /contenedor de scroll/);
});

test("SCROLL 05 · body transparente: el lienzo (html) pinta el fondo y el ambiente se ve", () => {
  assert.ok(rules(GX, /^body$/).some((b) => /background:\s*transparent/.test(b)));
});

test("SCROLL 06 · html/body sin `height: 100%` que convierta el documento en caja fija", () => {
  for (const b of rules(GLOBALS, /^(html|body)(\s*,\s*(html|body))?$/)) assert.ok(!/(^|;)\s*height:\s*100(%|vh)/.test(b), b);
});

test("SCROLL 07 · sin `position: fixed` en body (bloqueo de scroll a la antigua)", () => {
  for (const b of rules(GLOBALS, /(^|,)\s*body\s*$/)) assert.ok(!/position:\s*fixed/.test(b));
});

/* ───────────── sin parches ───────────── */

test("SCROLL 08 · ningún listener de rueda en window/document (no hay parche de wheel)", () => {
  for (const { p, s } of SOURCES) assert.ok(!/(window|document|documentElement|body)\.addEventListener\(\s*["']wheel["']/.test(code(s)), p);
});

test("SCROLL 09 · ningún `window.scrollBy` que reimplemente la rueda", () => {
  for (const { p, s } of SOURCES) assert.ok(!/window\.scrollBy\(/.test(code(s)), p);
});

test("SCROLL 10 · el único listener de rueda es el zoom del mapa táctico, sobre su SVG", () => {
  const withWheel = SOURCES.filter(({ s }) => /addEventListener\(\s*["']wheel["']/.test(code(s))).map((x) => x.p);
  assert.deepEqual(withWheel.map((p) => p.split("/src/")[1]), ["components/tactics/MapCanvas.tsx"]);
  assert.match(read("src", "components", "tactics", "MapCanvas.tsx"), /svg\.addEventListener\("wheel"/);
});

test("SCROLL 11 · el zoom del mapa solo cancela la rueda cuando es zoom (pellizco/ctrl)", () => {
  assert.match(read("src", "components", "tactics", "MapCanvas.tsx"), /if \(conZoom\(e\)\) e\.preventDefault\(\)/);
});

test("SCROLL 12 · nadie escribe `body.style.overflow` a mano fuera del cerrojo compartido", () => {
  for (const { p, s } of SOURCES) {
    if (p.endsWith("gameExperience/scrollLock.ts")) continue;
    assert.ok(!/body\.style\.overflow\s*=/.test(code(s)), p);
    assert.ok(!/documentElement\.style\.overflow\s*=/.test(code(s)), p);
  }
});

test("SCROLL 13 · el parallax del ambiente escucha el puntero en pasivo (nunca bloquea la rueda)", () => {
  const env = read("src", "components", "visual", "GameEnvironment.tsx");
  assert.match(env, /addEventListener\("pointermove", onMove, \{ passive: true \}\)/);
  assert.match(env, /pointer-events-none fixed inset-0 -z-10/);
});

test("SCROLL 14 · el director de música escucha gestos en pasivo", () => {
  assert.match(read("src", "components", "audio", "MusicDirector.tsx"), /passive: true/);
});

/* ───────────── cerrojo compartido ───────────── */

test("SCROLL 15 · GameOverlay y CardViewer usan el cerrojo compartido", () => {
  const overlay = read("src", "components", "ui", "game", "GameOverlay.tsx");
  const viewer = read("src", "components", "cards", "CardViewer.tsx");
  for (const s of [overlay, viewer]) { assert.match(s, /lockScroll\(\)/); assert.match(s, /from "@\/lib\/gameExperience\/scrollLock"/); }
});

test("SCROLL 16 · bloquear pone `hidden` y liberar restaura el valor previo", () => {
  const t = target("clip");
  const l = createScrollLock(() => t);
  const r = l.lock();
  assert.equal(t.style.overflow, "hidden");
  r();
  assert.equal(t.style.overflow, "clip");
});

test("SCROLL 17 · anidados: el scroll solo vuelve cuando se libera el ÚLTIMO", () => {
  const t = target();
  const l = createScrollLock(() => t);
  const a = l.lock(); const b = l.lock();
  a();
  assert.equal(t.style.overflow, "hidden");
  b();
  assert.equal(t.style.overflow, "");
});

test("SCROLL 18 · liberar dos veces no descuenta dos (desmontaje doble de React)", () => {
  const t = target();
  const l = createScrollLock(() => t);
  const a = l.lock(); const b = l.lock();
  a(); a();
  assert.equal(l.count(), 1);
  assert.equal(t.style.overflow, "hidden");
  b();
  assert.equal(l.count(), 0);
});

test("SCROLL 19 · liberar en orden inverso o cruzado da igual", () => {
  const t = target("visible");
  const l = createScrollLock(() => t);
  const a = l.lock(); const b = l.lock(); const c = l.lock();
  b(); c(); a();
  assert.equal(t.style.overflow, "visible");
});

test("SCROLL 20 · sin documento (servidor) bloquear no hace nada ni rompe", () => {
  const l = createScrollLock(() => null);
  const r = l.lock();
  r();
  assert.equal(l.count(), 0);
});

test("SCROLL 21 · el cerrojo global de la app arranca a cero y actúa sobre <html>", () => {
  assert.equal(scrollLockCount(), 0);
  const r = lockScroll(); // en node no hay document: no-op seguro
  r();
  assert.equal(scrollLockCount(), 0);
  assert.match(read("src", "lib", "gameExperience", "scrollLock.ts"), /document\.documentElement/);
});

test("SCROLL 22 · 100 ciclos abrir/cerrar modal: el scroll queda exactamente como estaba", () => {
  const t = target("");
  const l = createScrollLock(() => t);
  for (let i = 0; i < 100; i++) { const r = l.lock(); assert.equal(t.style.overflow, "hidden"); r(); assert.equal(t.style.overflow, ""); }
  assert.equal(l.count(), 0);
});

test("SCROLL 23 · modal dentro de hoja (sheet → modal → cerrar ambos) restaura", () => {
  const t = target("");
  const l = createScrollLock(() => t);
  const sheet = l.lock(); const modal = l.lock();
  modal(); sheet();
  assert.equal(t.style.overflow, "");
});

test("SCROLL 24 · sobre: visor de carta sobre el resumen, cerrar visor y salir → scroll libre", () => {
  const t = target("");
  const l = createScrollLock(() => t);
  const viewer = l.lock(); viewer();
  const sheet = l.lock(); const viewer2 = l.lock(); sheet(); viewer2();
  assert.equal(t.style.overflow, "");
});

test("SCROLL 25 · las hojas y diálogos del juego liberan al desmontar (efecto con limpieza)", () => {
  const overlay = read("src", "components", "ui", "game", "GameOverlay.tsx");
  assert.ok(overlay.includes("const release = lockScroll();") && overlay.includes("release();"));
});

test("SCROLL 26 · la cámara de sobres vuelve a su luz normal al desmontar la ceremonia", () => {
  const pack = read("src", "components", "packs", "PackOpeningExperience.tsx");
  assert.match(pack, /useEffect\(\(\) => \(\) => dimEnvironment\(0\), \[\]\)/);
});

test("SCROLL 27 · el instrumento de rueda real existe y mide rueda, teclado y el elemento que se desplaza", () => {
  const instr = read("scripts", "_fase44-1-wheel.ts");
  assert.match(instr, /mouseWheel/);
  assert.match(instr, /PageUp|End/);
});

/* ───────────── fuzzer ───────────── */

test("SCROLL 28 · FUZZ 100.000 operaciones lock/release al azar: nunca negativo, hidden ⇔ cuenta > 0, restaura siempre", () => {
  let seed = 441;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const initial = ["", "clip", "visible", "auto"];
  let ops = 0;
  for (let round = 0; round < 200; round++) {
    const start = initial[round % initial.length];
    const t = target(start);
    const l = createScrollLock(() => t);
    const open: (() => void)[] = [];
    for (let i = 0; i < 500; i++, ops++) {
      const r = rnd();
      if (r < 0.45 || open.length === 0) open.push(l.lock());
      else if (r < 0.9) open.splice(Math.floor(rnd() * open.length), 1)[0]();
      else open[Math.floor(rnd() * open.length)](); // liberación repetida: no debe contar
      assert.ok(l.count() >= 0);
      assert.equal(t.style.overflow === "hidden", l.count() > 0 || (start === "hidden"));
    }
    // las que quedaron abiertas se liberan (las ya liberadas no cuentan dos veces)
    for (const r of open) r();
    assert.equal(l.count(), 0);
    assert.equal(t.style.overflow, start);
  }
  assert.equal(ops, 100_000);
});
