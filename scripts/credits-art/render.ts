/**
 * ARTE DE DRL CREDITS — generador procedural (Fase 49.1). Reproducible: misma semilla, mismos píxeles.
 *
 *   npx tsx scripts/credits-art/render.ts [--preview]
 *
 * Dibuja en SVG (vectorial, sin assets externos ni IA) la MONEDA DRL —oro grueso, canto estriado, relieve y el
 * emblema propio de NEXUS: corona de tres puntas dentro de un hexágono— y con ella compone una escena por
 * paquete. La regla visual es la del producto: cuantos más créditos, más monedas. El generador CUENTA las
 * monedas que dibuja y las escribe en `src/data/creditsArt.ts`, donde un test fija que la progresión es
 * estrictamente creciente y que ningún paquete tiene el arte de otro.
 *
 * Salida: `public/store/credits/<id>.webp` (720×540, alfa) y `hero.webp` (1600×900, alfa). Sin texto impreso:
 * nombres y cantidades los pinta la interfaz.
 */
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

const ROOT = process.cwd();
const OUT = join(ROOT, "public/store/credits");
const DATA = join(ROOT, "src/data/creditsArt.ts");
const PREVIEW = process.argv.includes("--preview");
/** Las vistas previas (fondo opaco, para revisar) van a la QA, nunca a `public/`. */
const PREVIEW_DIR = join(ROOT, "docs/product/qa/fase49-1");

// ───────────────────────────── azar reproducible ─────────────────────────────
function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const f = (n: number) => n.toFixed(1);

// ───────────────────────────── definiciones compartidas ─────────────────────────────
const DEFS = `
<defs>
  <radialGradient id="face" cx="38%" cy="30%" r="80%">
    <stop offset="0" stop-color="#fff7cf"/><stop offset="0.18" stop-color="#ffe07a"/><stop offset="0.45" stop-color="#f2b92e"/>
    <stop offset="0.75" stop-color="#b87a10"/><stop offset="1" stop-color="#6e4506"/>
  </radialGradient>
  <radialGradient id="recess" cx="45%" cy="40%" r="70%">
    <stop offset="0" stop-color="#f6c94a"/><stop offset="0.7" stop-color="#c88a16"/><stop offset="1" stop-color="#8a5a08"/>
  </radialGradient>
  <linearGradient id="rim" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#fff2b8"/><stop offset="0.35" stop-color="#f4c243"/><stop offset="0.7" stop-color="#a86c0c"/><stop offset="1" stop-color="#ffd978"/>
  </linearGradient>
  <linearGradient id="edge" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#6a4205"/><stop offset="0.18" stop-color="#c98d17"/><stop offset="0.4" stop-color="#ffe089"/>
    <stop offset="0.6" stop-color="#e3a624"/><stop offset="0.85" stop-color="#9a6109"/><stop offset="1" stop-color="#5c3904"/>
  </linearGradient>
  <linearGradient id="edgeV" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#ffe089"/><stop offset="0.5" stop-color="#c48814"/><stop offset="1" stop-color="#6a4205"/>
  </linearGradient>
  <linearGradient id="emblem" x1="0" y1="0" x2="0.4" y2="1">
    <stop offset="0" stop-color="#fffbe6"/><stop offset="0.45" stop-color="#ffd35a"/><stop offset="1" stop-color="#c7890f"/>
  </linearGradient>
  <linearGradient id="metal" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#2a3142"/><stop offset="0.5" stop-color="#151a24"/><stop offset="1" stop-color="#07090e"/>
  </linearGradient>
  <linearGradient id="metalSide" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#10141d"/><stop offset="1" stop-color="#2b3140"/>
  </linearGradient>
  <linearGradient id="trim" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#fff0b0"/><stop offset="0.4" stop-color="#e2a52a"/><stop offset="1" stop-color="#8a5a08"/>
  </linearGradient>
  <linearGradient id="lidIn" x1="0" y1="1" x2="0" y2="0">
    <stop offset="0" stop-color="#ffcf5a" stop-opacity="0.95"/><stop offset="0.55" stop-color="#6a4a12"/><stop offset="1" stop-color="#1a1610"/>
  </linearGradient>
  <radialGradient id="glow" cx="50%" cy="50%" r="50%">
    <stop offset="0" stop-color="#ffcf4a" stop-opacity="0.55"/><stop offset="0.45" stop-color="#ffb020" stop-opacity="0.18"/><stop offset="1" stop-color="#ffb020" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="shadow" cx="50%" cy="50%" r="50%">
    <stop offset="0" stop-color="#000" stop-opacity="0.75"/><stop offset="1" stop-color="#000" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="ray" x1="0" y1="1" x2="0" y2="0">
    <stop offset="0" stop-color="#ffd35a" stop-opacity="0.5"/><stop offset="1" stop-color="#ffd35a" stop-opacity="0"/>
  </linearGradient>
  <filter id="blur2" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2"/></filter>
  <filter id="blur6" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6"/></filter>
  <filter id="blur14" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="14"/></filter>
</defs>`;

/** El emblema DRL: hexágono + corona de tres puntas con joya. Coordenadas en una caja de 200 centrada en 0. */
const EMBLEM_HEX = "M0,-78 L67.5,-39 L67.5,39 L0,78 L-67.5,39 L-67.5,-39 Z M0,-64 L-55.4,-32 L-55.4,32 L0,64 L55.4,32 L55.4,-32 Z";
const EMBLEM_CROWN = "M-44,26 L-50,-20 L-22,4 L0,-38 L22,4 L50,-20 L44,26 Z M-40,32 L40,32 L37,44 L-37,44 Z";
const EMBLEM_BALLS: [number, number][] = [[-50, -25], [0, -44], [50, -25]];

function emblem(fill: string, dark = false): string {
  const shade = dark ? "#6b4506" : fill;
  return `<path d="${EMBLEM_HEX}" fill="${shade}" fill-rule="evenodd"/>`
    + `<path d="${EMBLEM_CROWN}" fill="${shade}"/>`
    + EMBLEM_BALLS.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="7.5" fill="${shade}"/>`).join("")
    + (dark ? "" : `<path d="M0,6 L9,16 L0,26 L-9,16 Z" fill="#9c6408"/>`);
}

/** Relieve: sombra hundida, cuerpo claro y filo de luz. Se escala a la cara de la moneda. */
function embossed(cx: number, cy: number, sx: number, sy: number, rot = 0): string {
  const t = `translate(${f(cx)},${f(cy)}) rotate(${f(rot)}) scale(${(sx / 100).toFixed(4)},${(sy / 100).toFixed(4)})`;
  return `<g transform="${t}">`
    + `<g transform="translate(3,4)" opacity="0.55">${emblem("#000", true)}</g>`
    + `<g>${emblem("url(#emblem)")}</g>`
    + `<g transform="translate(-1.5,-2)" opacity="0.35">${emblem("#fff")}</g>`
    + `<g opacity="1">${emblem("url(#emblem)")}</g>`
    + `</g>`;
}

interface Drawable { z: number; svg: string; coins: number }

/** Moneda TUMBADA vista desde arriba en perspectiva: cara elíptica + canto estriado. */
function flatCoin(cx: number, cy: number, r: number, opts: { k?: number; t?: number; rot?: number; detail?: boolean } = {}): string {
  const k = opts.k ?? 0.42, t = opts.t ?? r * 0.16, ry = r * k, rot = opts.rot ?? 0;
  const edgePath = `M${f(cx - r)},${f(cy)} A${f(r)},${f(ry)} 0 0 0 ${f(cx + r)},${f(cy)} L${f(cx + r)},${f(cy + t)} A${f(r)},${f(ry)} 0 0 1 ${f(cx - r)},${f(cy + t)} Z`;
  let reeds = "";
  if (opts.detail !== false && r > 14) {
    const n = Math.round(r / 3.2);
    for (let i = 1; i < n; i++) {
      const a = Math.PI * (i / n), x = cx - r * Math.cos(a), y = cy + ry * Math.sin(a);
      reeds += `<line x1="${f(x)}" y1="${f(y + 1)}" x2="${f(x)}" y2="${f(y + t - 1)}" stroke="#5a3804" stroke-opacity="0.45" stroke-width="${f(Math.max(0.6, r / 40))}"/>`;
    }
  }
  const face = `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(r)}" ry="${f(ry)}" fill="url(#face)"/>`
    + `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(r * 0.955)}" ry="${f(ry * 0.955)}" fill="none" stroke="url(#rim)" stroke-width="${f(r * 0.07)}"/>`
    + `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(r * 0.8)}" ry="${f(ry * 0.8)}" fill="url(#recess)" opacity="0.55"/>`
    + (r > 16 ? embossed(cx, cy, r * 0.62, ry * 0.62) : "")
    + `<ellipse cx="${f(cx - r * 0.3)}" cy="${f(cy - ry * 0.35)}" rx="${f(r * 0.35)}" ry="${f(ry * 0.18)}" fill="#fff" opacity="0.28" filter="url(#blur2)"/>`;
  return `<g transform="rotate(${f(rot)} ${f(cx)} ${f(cy)})"><path d="${edgePath}" fill="url(#edge)"/>${reeds}`
    + `<path d="M${f(cx - r)},${f(cy + t)} A${f(r)},${f(ry)} 0 0 0 ${f(cx + r)},${f(cy + t)}" fill="none" stroke="#3a2402" stroke-opacity="0.5" stroke-width="1"/>${face}</g>`;
}

/** Sombra de contacto bajo un objeto. */
const contact = (cx: number, cy: number, rx: number, ry: number, o = 0.8) =>
  `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(rx)}" ry="${f(ry)}" fill="url(#shadow)" opacity="${o}"/>`;

/** Pila de `n` monedas, desde el suelo. Ligero desorden, como una pila de verdad. */
function stack(cx: number, baseY: number, r: number, n: number, rand: () => number): Drawable {
  const t = r * 0.17;
  let svg = contact(cx + r * 0.1, baseY + t + r * 0.2, r * 1.35, r * 0.42);
  for (let i = 0; i < n; i++) {
    const jx = (rand() - 0.5) * r * 0.1;
    svg += flatCoin(cx + jx, baseY - i * t, r, { t, detail: i === n - 1 || i % 2 === 0, rot: (rand() - 0.5) * 3 });
  }
  return { z: baseY, svg, coins: n };
}

/** Moneda de PIE, girada hacia el espectador: la protagonista. */
function standingCoin(cx: number, cy: number, r: number, turn = 0.86, lean = -8): Drawable {
  const rx = r * turn, depth = r * 0.2;
  let body = "";
  const steps = Math.ceil(depth / 1.5);
  for (let i = steps; i >= 1; i--) {
    const dx = (depth * i) / steps;
    body += `<ellipse cx="${f(cx + dx)}" cy="${f(cy)}" rx="${f(rx)}" ry="${f(r)}" fill="url(#edgeV)"/>`;
  }
  const svg = `<g transform="rotate(${lean} ${f(cx)} ${f(cy + r)})">`
    + contact(cx + depth, cy + r * 0.98, r * 1.1, r * 0.2, 0.9)
    + body
    + `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(rx)}" ry="${f(r)}" fill="url(#face)"/>`
    + `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(rx * 0.95)}" ry="${f(r * 0.95)}" fill="none" stroke="url(#rim)" stroke-width="${f(r * 0.075)}"/>`
    + `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(rx * 0.8)}" ry="${f(r * 0.8)}" fill="url(#recess)" opacity="0.55"/>`
    + embossed(cx, cy, rx * 0.64, r * 0.64)
    + `<path d="M${f(cx - rx * 0.7)},${f(cy - r * 0.35)} A${f(rx * 0.85)},${f(r * 0.85)} 0 0 1 ${f(cx + rx * 0.1)},${f(cy - r * 0.84)}" fill="none" stroke="#fff" stroke-opacity="0.55" stroke-width="${f(r * 0.05)}" filter="url(#blur2)"/>`
    + `</g>`;
  return { z: cy + r, svg, coins: 1 };
}

/** Moneda al vuelo (inclinada y algo desenfocada si está lejos). */
function flyingCoin(cx: number, cy: number, r: number, rot: number, k: number, blur = false): Drawable {
  const inner = flatCoin(cx, cy, r, { k, rot, t: r * 0.14 });
  return { z: -1e6 + cy, svg: blur ? `<g filter="url(#blur2)" opacity="0.9">${inner}</g>` : inner, coins: 1 };
}

/** Destello de cuatro puntas. */
const sparkle = (x: number, y: number, s: number, o = 0.9) =>
  `<g transform="translate(${f(x)},${f(y)})" opacity="${o}"><path d="M0,${-s} L${s * 0.18},${-s * 0.18} L${s},0 L${s * 0.18},${s * 0.18} L0,${s} L${-s * 0.18},${s * 0.18} L${-s},0 L${-s * 0.18},${-s * 0.18} Z" fill="#fff6d0" filter="url(#blur2)"/><circle r="${f(s * 0.12)}" fill="#fff"/></g>`;

/**
 * COFRE NEXUS abierto y lleno. `premium` = versión máxima: más grande, ribetes de oro gruesos, rayos de luz y
 * monedas desbordando por delante.
 */
function chest(cx: number, baseY: number, w: number, premium: boolean, rand: () => number): Drawable[] {
  const out: Drawable[] = [];
  const h = w * 0.5, d = w * 0.2, dy = d * 0.55;
  const x0 = cx - w / 2 - d / 2, x1 = x0 + w, top = baseY - h;
  const trimW = premium ? w * 0.03 : w * 0.018;
  let coins = 0;

  let back = contact(cx, baseY + h * 0.08, w * 0.75, h * 0.22, 0.95);
  back += `<ellipse cx="${f(cx)}" cy="${f(top - h * 0.1)}" rx="${f(w * (premium ? 0.95 : 0.75))}" ry="${f(h * (premium ? 1.05 : 0.8))}" fill="url(#glow)"/>`;
  if (premium) {
    for (let i = 0; i < 9; i++) {
      const a = -70 + i * 17.5, len = h * (1.5 + rand() * 0.6);
      back += `<g transform="translate(${f(cx + d / 2)},${f(top - dy)}) rotate(${f(a)})" opacity="${(0.25 + rand() * 0.25).toFixed(2)}"><path d="M-${f(w * 0.025)},0 L${f(w * 0.025)},0 L${f(w * 0.06)},${f(-len)} L-${f(w * 0.06)},${f(-len)} Z" fill="url(#ray)" filter="url(#blur6)"/></g>`;
    }
  }
  // Tapa abierta (cara interior iluminada) e interior.
  const bl = [x0 + d, top - dy], br = [x1 + d, top - dy], lidH = h * 0.78, lean = d * 0.35;
  back += `<path d="M${f(bl[0])},${f(bl[1])} L${f(br[0])},${f(br[1])} L${f(br[0] + lean)},${f(br[1] - lidH)} L${f(bl[0] + lean)},${f(bl[1] - lidH)} Z" fill="url(#metal)" stroke="url(#trim)" stroke-width="${f(trimW)}"/>`;
  back += `<path d="M${f(bl[0] + trimW * 2)},${f(bl[1] - trimW)} L${f(br[0] - trimW * 2)},${f(br[1] - trimW)} L${f(br[0] + lean - trimW * 2)},${f(br[1] - lidH + trimW * 2)} L${f(bl[0] + lean + trimW * 2)},${f(bl[1] - lidH + trimW * 2)} Z" fill="url(#lidIn)" opacity="0.9"/>`;
  back += embossedPlate(cx + d / 2 + lean * 0.5, top - dy - lidH * 0.55, w * 0.16, 0.55);
  back += `<path d="M${f(x0)},${f(top)} L${f(x1)},${f(top)} L${f(x1 + d)},${f(top - dy)} L${f(x0 + d)},${f(top - dy)} Z" fill="#2a1a04"/>`;
  back += `<ellipse cx="${f(cx + d / 2)}" cy="${f(top - dy / 2)}" rx="${f(w * 0.48)}" ry="${f(dy * 0.8)}" fill="#ffc53a" opacity="0.55" filter="url(#blur6)"/>`;
  out.push({ z: baseY - h * 2, svg: back, coins: 0 });

  // Montón de monedas dentro (cúpula), de atrás hacia delante.
  const mound: string[] = [];
  const domeH = h * (premium ? 0.72 : 0.45), rx = w * 0.46, rows = premium ? 7 : 5;
  const cr = w * (premium ? 0.058 : 0.065);
  for (let row = 0; row < rows; row++) {
    const fr = row / (rows - 1);
    const yRow = top - dy + fr * dy;
    const count = Math.round((w / (cr * 1.45)) * (0.75 + 0.25 * Math.sin(Math.PI * fr)));
    for (let i = 0; i < count; i++) {
      const u = (i + 0.5) / count * 2 - 1 + (rand() - 0.5) * 0.08;
      const lift = domeH * (1 - u * u) * (1 - 0.35 * fr);
      const x = cx + d / 2 - d * fr + u * rx;
      mound.push(flatCoin(x, yRow - lift + (rand() - 0.5) * cr * 0.4, cr * (0.9 + rand() * 0.25), { rot: (rand() - 0.5) * 40, k: 0.38 + rand() * 0.2, detail: false }));
      coins++;
    }
  }
  // Algunas monedas de canto sobre el montón (volumen).
  for (let i = 0; i < (premium ? 8 : 4); i++) {
    const u = (rand() - 0.5) * 1.4;
    mound.push(flatCoin(cx + u * rx * 0.8, top - dy - domeH * (1 - u * u) * 0.9 - cr * 0.5, cr, { k: 0.8 + rand() * 0.2, rot: (rand() - 0.5) * 70, detail: false }));
    coins++;
  }
  out.push({ z: baseY - h * 1.5, svg: mound.join(""), coins });

  // Cuerpo delantero y lateral (tapan la base del montón).
  let front = `<path d="M${f(x1)},${f(baseY)} L${f(x1 + d)},${f(baseY - dy)} L${f(x1 + d)},${f(top - dy)} L${f(x1)},${f(top)} Z" fill="url(#metalSide)" stroke="url(#trim)" stroke-width="${f(trimW)}"/>`;
  front += `<rect x="${f(x0)}" y="${f(top)}" width="${f(w)}" height="${f(h)}" fill="url(#metal)" stroke="url(#trim)" stroke-width="${f(trimW)}"/>`;
  // Bandas, esquineras y remaches.
  for (const bx of [x0 + w * 0.22, x1 - w * 0.22]) {
    front += `<rect x="${f(bx - w * 0.035)}" y="${f(top)}" width="${f(w * 0.07)}" height="${f(h)}" fill="#0a0d13" stroke="url(#trim)" stroke-width="${f(trimW * 0.6)}"/>`;
    for (let j = 1; j <= 3; j++) front += `<circle cx="${f(bx)}" cy="${f(top + (h * j) / 4)}" r="${f(w * 0.009)}" fill="url(#trim)"/>`;
  }
  front += `<rect x="${f(x0)}" y="${f(top + h * 0.08)}" width="${f(w)}" height="${f(h * 0.05)}" fill="url(#trim)" opacity="0.85"/>`;
  // Reflejo diagonal y panel inferior: volumen del metal.
  front += `<path d="M${f(x0 + w * 0.05)},${f(top + h * 0.14)} L${f(x0 + w * 0.32)},${f(top + h * 0.14)} L${f(x0 + w * 0.12)},${f(baseY - h * 0.08)} L${f(x0 + w * 0.02)},${f(baseY - h * 0.08)} Z" fill="#fff" opacity="0.06"/>`;
  front += `<rect x="${f(x0)}" y="${f(baseY - h * 0.2)}" width="${f(w)}" height="${f(h * 0.2)}" fill="#000" opacity="0.25"/>`;
  for (const [ex, ey, sx, sy] of [[x0, top, 1, 1], [x1, top, -1, 1], [x0, baseY, 1, -1], [x1, baseY, -1, -1]] as const) {
    const c = w * (premium ? 0.09 : 0.07);
    front += `<path d="M${f(ex)},${f(ey)} L${f(ex + sx * c)},${f(ey)} L${f(ex + sx * c * 0.55)},${f(ey + sy * c * 0.25)} L${f(ex + sx * c * 0.25)},${f(ey + sy * c * 0.55)} L${f(ex)},${f(ey + sy * c)} Z" fill="url(#trim)"/>`;
  }
  // Placa central con el emblema DRL.
  front += embossedPlate(cx - d / 2 + w * 0.0, top + h * 0.56, w * (premium ? 0.2 : 0.17), 1);
  if (premium) {
    front += `<rect x="${f(x0 - trimW)}" y="${f(baseY - h * 0.06)}" width="${f(w + trimW * 2)}" height="${f(h * 0.06)}" fill="url(#trim)"/>`;
    front += sparkle(x0 + w * 0.08, top + h * 0.1, w * 0.03) + sparkle(x1 - w * 0.1, top + h * 0.8, w * 0.025, 0.7);
  }
  out.push({ z: baseY, svg: front, coins: 0 });

  // Monedas desbordando por el borde delantero (premium) y en el suelo.
  if (premium) {
    const spill: string[] = [];
    for (let i = 0; i < 14; i++) {
      const u = (rand() - 0.5) * 1.6;
      spill.push(flatCoin(cx + u * w * 0.45, top - rand() * cr * 1.2, cr * (0.95 + rand() * 0.2), { k: 0.5 + rand() * 0.35, rot: (rand() - 0.5) * 60, detail: false }));
    }
    out.push({ z: baseY + 1, svg: spill.join(""), coins: 14 });
  }
  return out;
}

/** Placa hexagonal con el emblema, para cofres. */
function embossedPlate(cx: number, cy: number, size: number, o: number): string {
  const s = (size / 100).toFixed(4);
  return `<g transform="translate(${f(cx)},${f(cy)}) scale(${s})" opacity="${o}">`
    + `<circle r="95" fill="#ffc53a" opacity="0.35" filter="url(#blur14)"/>`
    + `<path d="M0,-92 L80,-46 L80,46 L0,92 L-80,46 L-80,-46 Z" fill="#0b0e15" stroke="url(#trim)" stroke-width="7"/>`
    + `<g transform="scale(0.95)"><g transform="translate(3,4)" opacity="0.6">${emblem("#000", true)}</g>${emblem("url(#emblem)")}</g></g>`;
}

// ───────────────────────────── escenas ─────────────────────────────

interface Scene { id: string; w: number; h: number; draw: (rand: () => number) => Drawable[] }

const scatter = (rand: () => number, n: number, area: { x0: number; x1: number; y0: number; y1: number }, r: [number, number]): Drawable[] =>
  Array.from({ length: n }, () => {
    const x = area.x0 + rand() * (area.x1 - area.x0), y = area.y0 + rand() * (area.y1 - area.y0);
    const rr = r[0] + rand() * (r[1] - r[0]);
    return { z: y, svg: contact(x, y + rr * 0.3, rr * 1.2, rr * 0.35, 0.6) + flatCoin(x, y, rr, { rot: (rand() - 0.5) * 50, k: 0.36 + rand() * 0.14 }), coins: 1 };
  });

const glowAt = (cx: number, cy: number, rx: number, ry: number): Drawable => ({ z: -1e9, svg: `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="url(#glow)"/>`, coins: 0 });

const SCENES: Scene[] = [
  {
    id: "starter", w: 720, h: 540,
    draw: (rand) => [
      glowAt(360, 300, 260, 190),
      standingCoin(360, 285, 118, 0.84, -9),
      stack(505, 400, 52, 2, rand),
      { z: 430, svg: contact(215, 438, 70, 20) + flatCoin(215, 425, 58, { rot: -12 }), coins: 1 },
      { z: 452, svg: contact(470, 462, 60, 17) + flatCoin(470, 450, 48, { rot: 18, k: 0.4 }), coins: 1 },
      { z: 380, svg: contact(248, 388, 44, 12, 0.5) + flatCoin(248, 380, 36, { rot: 25, k: 0.5 }), coins: 1 },
    ],
  },
  {
    id: "basic", w: 720, h: 540,
    draw: (rand) => [
      glowAt(370, 300, 290, 200),
      stack(455, 395, 56, 8, rand),
      stack(555, 415, 50, 5, rand),
      stack(375, 432, 46, 3, rand),
      standingCoin(275, 300, 104, 0.84, -8),
      ...scatter(rand, 6, { x0: 150, x1: 600, y0: 430, y1: 485 }, [24, 38]),
    ],
  },
  {
    id: "popular", w: 720, h: 540,
    draw: (rand) => [
      glowAt(360, 290, 320, 220),
      stack(365, 360, 58, 15, rand),
      stack(255, 382, 54, 10, rand),
      stack(478, 386, 54, 11, rand),
      stack(165, 418, 48, 6, rand),
      stack(565, 420, 50, 7, rand),
      stack(318, 448, 44, 4, rand),
      stack(430, 452, 44, 3, rand),
      standingCoin(230, 330, 84, 0.84, -10),
      standingCoin(528, 338, 70, 0.8, 9),
      ...scatter(rand, 10, { x0: 110, x1: 640, y0: 455, y1: 500 }, [20, 34]),
    ],
  },
  {
    id: "large", w: 720, h: 540,
    draw: (rand) => [
      glowAt(360, 270, 330, 230),
      ...chest(360, 410, 300, false, rand),
      stack(122, 430, 44, 8, rand),
      stack(178, 452, 40, 5, rand),
      stack(598, 432, 44, 9, rand),
      stack(548, 458, 38, 4, rand),
      ...scatter(rand, 14, { x0: 120, x1: 620, y0: 440, y1: 505 }, [18, 30]),
    ],
  },
  {
    id: "ultimate", w: 720, h: 540,
    draw: (rand) => [
      glowAt(360, 250, 360, 250),
      ...chest(360, 425, 392, true, rand),
      stack(78, 410, 40, 13, rand),
      stack(128, 440, 40, 9, rand),
      stack(170, 462, 36, 6, rand),
      stack(640, 408, 40, 14, rand),
      stack(592, 438, 40, 10, rand),
      stack(548, 464, 36, 5, rand),
      ...scatter(rand, 26, { x0: 60, x1: 660, y0: 445, y1: 515 }, [16, 28]),
      ...Array.from({ length: 9 }, (_, i) => flyingCoin(90 + i * 68 + rand() * 20, 60 + rand() * 90, 12 + rand() * 12, (rand() - 0.5) * 160, 0.3 + rand() * 0.6, i % 3 === 0)),
      { z: 1e6, svg: [sparkle(120, 170, 16), sparkle(610, 140, 20), sparkle(420, 60, 14, 0.7), sparkle(250, 110, 12, 0.6)].join(""), coins: 0 },
    ],
  },
  {
    id: "hero", w: 1600, h: 900,
    draw: (rand) => [
      glowAt(880, 430, 700, 420),
      ...chest(900, 640, 560, true, rand),
      stack(330, 650, 58, 12, rand), stack(420, 690, 56, 8, rand), stack(250, 700, 52, 6, rand),
      stack(1340, 640, 60, 13, rand), stack(1430, 690, 56, 9, rand), stack(1250, 700, 54, 6, rand),
      stack(560, 720, 50, 5, rand), stack(1180, 730, 48, 4, rand),
      standingCoin(640, 600, 150, 0.84, -9),
      standingCoin(1130, 640, 96, 0.8, 11),
      ...scatter(rand, 40, { x0: 180, x1: 1500, y0: 730, y1: 860 }, [22, 40]),
      ...Array.from({ length: 12 }, (_, i) => flyingCoin(260 + i * 100 + rand() * 40, 90 + rand() * 220, 16 + rand() * 18, (rand() - 0.5) * 160, 0.3 + rand() * 0.6, i % 3 === 0)),
      { z: 1e6, svg: [sparkle(420, 300, 22), sparkle(1380, 260, 26), sparkle(980, 120, 18, 0.7), sparkle(700, 180, 14, 0.6), sparkle(1220, 420, 16, 0.7)].join(""), coins: 0 },
    ],
  },
];

async function main() {
  mkdirSync(OUT, { recursive: true });
  const meta: { id: string; file: string; width: number; height: number; bytes: number; coins: number; chest: "none" | "standard" | "premium" }[] = [];
  for (const [i, sc] of SCENES.entries()) {
    const rand = rng(0x4e5855 + i * 977);
    const items = sc.draw(rand).sort((a, b) => a.z - b.z);
    const coins = items.reduce((s, d) => s + d.coins, 0);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${sc.w * 2}" height="${sc.h * 2}" viewBox="0 0 ${sc.w} ${sc.h}">${DEFS}${items.map((d) => d.svg).join("")}</svg>`;
    const file = join(OUT, `${sc.id}.webp`);
    await sharp(Buffer.from(svg)).resize(sc.w, sc.h, { kernel: "lanczos3" }).webp({ quality: 84, alphaQuality: 90, effort: 6, smartSubsample: true }).toFile(file);
    if (PREVIEW) { mkdirSync(PREVIEW_DIR, { recursive: true }); await sharp(Buffer.from(svg)).resize(sc.w, sc.h).flatten({ background: "#070a12" }).png().toFile(join(PREVIEW_DIR, `asset-${sc.id}.png`)); }
    const chestKind = sc.id === "ultimate" || sc.id === "hero" ? "premium" : sc.id === "large" ? "standard" : "none";
    meta.push({ id: sc.id, file: `/store/credits/${sc.id}.webp`, width: sc.w, height: sc.h, bytes: statSync(file).size, coins, chest: chestKind });
    console.log(`${sc.id.padEnd(9)} ${sc.w}×${sc.h}  ${String(coins).padStart(4)} monedas  ${(statSync(file).size / 1024).toFixed(0)} KB  cofre=${chestKind}`);
  }
  const ts = `/**
 * ARTE DE DRL CREDITS — FICHERO GENERADO por \`scripts/credits-art/render.ts\`. No se edita a mano.
 *
 * Una escena por paquete (y el héroe). \`coins\` es el número de monedas DIBUJADAS: la regla visual del producto
 * («más créditos, más monedas») la fija \`creditsArt.test.ts\` contra el catálogo de \`domain/economy/drlCredits\`.
 */
export interface CreditsArt { id: string; file: string; width: number; height: number; bytes: number; coins: number; chest: "none" | "standard" | "premium" }

export const CREDITS_ART: readonly CreditsArt[] = ${JSON.stringify(meta, null, 2)};
`;
  writeFileSync(DATA, ts);
}

void main().catch((e) => { console.error(e); process.exit(1); });
