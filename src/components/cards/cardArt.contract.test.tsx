/**
 * CARD ART = CARD VISUAL — contrato de la limpieza global de cartas.
 *
 * Las cartas del catálogo son el propio WebP (marco, rareza, OVR y estadísticas incluidos, con margen
 * transparente). Estos tests fijan que la interfaz NO dibuja otra carta alrededor del asset: ni fondo,
 * ni borde, ni chaflán, ni radio, ni sombra de caja, ni anillo; los estados van sobre la silueta con
 * `drop-shadow` o filtros de color. Son tests de marcado y de fuente, no de capturas.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { CardArt, cardArtFilter, CARD_ART_W, CARD_ART_H } from "./CardArt";
import { CardFace } from "./CardVisual";
import { PlayerCard } from "./PlayerCard";
import { CardThumb } from "./CardThumb";
import { Card3D } from "@/components/visual/Card3D";
import { DuelCard } from "@/components/duel/DuelCard";
import { CARDS, getCard } from "@/data/catalog";
import { fase45Fixtures } from "@/app/design-system/fase45/fixtures";

const ROOT = process.cwd();
const html = (n: React.ReactElement) => renderToStaticMarkup(n);
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");
const conImagen = CARDS.find((c) => c.image)!;

/** Lo que NO puede aparecer alrededor del asset (fuera de la reserva por capas). */
const MARCO = /nx-clip|shadow-card|rounded-(?:xl|md|card)|border-2|\bborder\b|ring-2|box-shadow|background:/;

test("CARD ART 01 · el asset con sus medidas reales, entero y sin caja", () => {
  const h = html(<CardArt src="/cards/x.webp" alt="x" />);
  assert.match(h, new RegExp(`width="${CARD_ART_W}"`));
  assert.match(h, new RegExp(`height="${CARD_ART_H}"`));
  assert.match(h, /aspect-ratio:750 \/ 1048/);
  assert.match(h, /data-card-art/);
  assert.match(h, /class="nx-card-art /);
  assert.doesNotMatch(h, /box-shadow|background|border|border-radius|object-cover/);
});

test("CARD ART 02 · profundidad y estados sobre la silueta (drop-shadow), nunca una caja", () => {
  assert.match(cardArtFilter({ shadow: "rest" }) ?? "", /^drop-shadow\(/);
  assert.match(cardArtFilter({ glow: "#2fe0ff" }) ?? "", /drop-shadow\(0 0 14px #2fe0ff\)/);
  assert.match(cardArtFilter({ dim: true }) ?? "", /grayscale\(0\.9\) brightness\(0\.5\)/);
  assert.equal(cardArtFilter({ shadow: "none" }), undefined);
});

test("CARD ART 03 · la regla CSS global garantiza lo que la carta NO lleva", () => {
  const css = read("src", "app", "globals.css").replace(/\r/g, "");
  const regla = css.slice(css.indexOf(".nx-card-art {"), css.indexOf("}", css.indexOf(".nx-card-art {")));
  for (const d of ["background: transparent", "border: 0", "border-radius: 0", "box-shadow: none", "object-fit: contain"]) {
    assert.ok(regla.includes(d), d);
  }
});

test("CARD ART 04 · CardFace: contenedor técnico transparente alrededor del fichero", () => {
  const h = html(<CardFace artwork={{ url: "/cards/x.webp", cardId: "x", cardVersion: 1, format: "webp" }} alt="x"><i /></CardFace>);
  assert.doesNotMatch(h, MARCO);
  assert.match(h, /data-card-art-wrap/);
});

test("CARD ART 05 · PlayerCard con carta del catálogo = el WebP, sin canto, placa ni chaflán", () => {
  const h = html(<PlayerCard card={conImagen} size="sm" interactive={false} />);
  assert.ok(h.includes(`src="${conImagen.image}"`));
  assert.doesNotMatch(h, MARCO);
  assert.doesNotMatch(h, /data-card-frame/, "el canto del dibujado por capas no se monta con imagen");
});

test("CARD ART 06 · la miniatura es la carta reducida: sin borde de rareza ni recorte", () => {
  const h = html(<CardThumb card={conImagen} width={56} />);
  assert.ok(h.includes(`src="${conImagen.image}"`));
  assert.doesNotMatch(h, MARCO);
  assert.doesNotMatch(h, /overflow-hidden/);
});

test("CARD ART 07 · DuelCard impresa: sin borde de rareza, sin fondo de paleta, selección = halo cian", () => {
  const fx = fase45Fixtures();
  const card = fx.attack.yourHand.find((c) => getCard(c.cardId)?.image)!;
  const quieta = html(<DuelCard card={card} size="md" />);
  assert.doesNotMatch(quieta, /border-2|rounded-xl|ring-2|background:/);
  const elegida = html(<DuelCard card={card} size="md" selected onClick={() => {}} />);
  assert.match(elegida, /drop-shadow\(0 0 12px #2fe0ff\)/);
  assert.doesNotMatch(elegida, /ring-2 ring-\[#2fe0ff\]/);
  const usada = html(<DuelCard card={card} size="md" used />);
  assert.match(usada, /grayscale\(0\.9\)/, "usada = apagada por filtro, no con un velo rectangular");
  assert.doesNotMatch(usada, /bg-base-900\/55/);
});

test("CARD ART 08 · Card3D no dibuja rectángulos: ni filo, ni brillo, ni anillo, ni velo", () => {
  const src = read("src", "components", "visual", "Card3D.tsx").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
  for (const p of ["ring-2", "inset 0 0 0 1px", "mixBlendMode", "animate-shimmer", "boxShadow", "rounded-card", "rgba(6,7,13,0.62)"]) {
    assert.ok(!src.includes(p), `Card3D ya no usa ${p}`);
  }
  for (const mode of ["static", "hover", "selected", "legendary"] as const) {
    const h = html(<Card3D mode={mode} glow="#ffce4f"><i data-carta /></Card3D>);
    assert.doesNotMatch(h, /box-shadow|border|rounded-card/, mode);
  }
  const bloqueada = html(<Card3D mode="static" status="locked"><i /></Card3D>);
  assert.match(bloqueada, /data-locked/);
  assert.match(bloqueada, /brightness\(0\.42\)/);
  assert.match(html(<Card3D mode="selected" glow="#ffce4f"><i /></Card3D>), /drop-shadow\(0 0 14px #ffce4f\)/);
});

test("CARD ART 09 · en la arena las auras del duelo van sobre la silueta (glow), no en cajas", () => {
  for (const f of ["MatchBoard.tsx", "DuelMoment.tsx"]) {
    const src = read("src", "components", "duel", f);
    assert.ok(!/absolute inset-0 -z-10 rounded-xl" style=\{\{ boxShadow/.test(src), `${f} sin caja de aura`);
    assert.ok(src.includes("glow={"), `${f} pasa el aura a la carta`);
  }
});

/**
 * EL BARRIDO. Toda `<img>` que pinte la imagen de una carta del catálogo (`.image`) pasa por la regla:
 * o es `CardArt`, o lleva `data-card-art` + `nx-card-art`. Excepciones: fotos de jugador (no son cartas)
 * en Tactical Coach y retransmisión, y la revisión del admin.
 */
test("CARD ART 10 · ninguna pantalla nueva pinta una carta fuera de la regla", () => {
  const EXCEPCIONES = ["components/coach/", "components/broadcast/", "app/admin/", "design-system/"];
  const tsx = (d: string): string[] => readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? tsx(p) : /\.tsx$/.test(n) && !/\.test\.tsx$/.test(n) ? [p] : [];
  });
  const fuera: string[] = [];
  for (const f of tsx(join(ROOT, "src"))) {
    const rel = relative(join(ROOT, "src"), f).replace(/\\/g, "/");
    if (EXCEPCIONES.some((e) => rel.startsWith(e))) continue;
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/<img\b[^>]*src=\{[^}]*\.image\b[^}]*\}[^>]*>/g)) {
      if (!/data-card-art/.test(m[0]) || !/nx-card-art/.test(m[0])) fuera.push(`${rel}: ${m[0].slice(0, 90)}`);
    }
  }
  assert.deepEqual(fuera, []);
});
