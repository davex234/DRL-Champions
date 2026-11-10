/**
 * DRL CHAMPIONS — generador de marca.
 *
 * Fuente única: src/branding/geometry.ts → emite TODOS los entregables:
 *   public/branding/{icon,logo,assets}/*.svg  (lockups y variantes)
 *   public/favicon.svg · favicon.ico · favicon-32.png · apple-touch-icon.png
 *   public/icons/*.png  (PWA: any + maskable)
 *
 * Sin dependencias (rasteriza por píxel y codifica PNG/ICO a mano). Determinista.
 * Uso:  npx tsx scripts/generate-brand.ts
 */
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  PALETTE, SHIELD_OUTER, SHIELD_INNER, CREST, BLADE, SLASH, ptsToPath, pointInPoly,
  markInner, wordPath, wordSegments, type MarkVariant, type Pt,
} from "../src/branding/geometry";

// ─── PNG / ICO encoders (sin dependencias) ───────────────────────────────
const crcTable = (() => { const t: number[] = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b: Buffer) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function pngChunk(type: string, data: Buffer) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0); const t = Buffer.from(type, "ascii"); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0); return Buffer.concat([len, t, data, crc]); }
function encodePng(size: number, rgba: Buffer) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  const stride = size * 4; const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) { raw[y * (stride + 1)] = 0; rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride); }
  return Buffer.concat([sig, pngChunk("IHDR", ihdr), pngChunk("IDAT", deflateSync(raw, { level: 9 })), pngChunk("IEND", Buffer.alloc(0))]);
}
function encodeIco(pngs: { size: number; buf: Buffer }[]) {
  const head = Buffer.alloc(6); head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4);
  const entries: Buffer[] = []; let offset = 6 + pngs.length * 16;
  for (const p of pngs) { const e = Buffer.alloc(16); e[0] = p.size >= 256 ? 0 : p.size; e[1] = p.size >= 256 ? 0 : p.size; e[4] = 1; e[6] = 32; e.writeUInt32LE(p.buf.length, 8); e.writeUInt32LE(offset, 12); entries.push(e); offset += p.buf.length; }
  return Buffer.concat([head, ...entries, ...pngs.map((p) => p.buf)]);
}

// ─── Color helpers ───────────────────────────────────────────────────────
type RGB = [number, number, number];
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const mix = (a: RGB, b: RGB, t: number): RGB => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const gradV = (y: number, y0: number, y1: number, c0: RGB, c1: RGB) => mix(c0, c1, clamp01((y - y0) / (y1 - y0)));

const C = {
  black: hex(PALETTE.black), graphite: hex(PALETTE.graphite), graphiteHi: hex(PALETTE.graphiteHi),
  steel: hex(PALETTE.steel), silver: hex(PALETTE.silver), silverLo: hex(PALETTE.silverLo),
  darkRed: hex(PALETTE.darkRed), magenta: hex(PALETTE.magenta), magentaHi: hex(PALETTE.magentaHi), white: hex(PALETTE.white),
};

// Fondo "placa" (radial grafito + brillo magenta inferior), en espacio 0..256.
function plate(mx: number, my: number): RGB {
  const dx = (mx - 128) / 150, dy = (my - 128) / 150; const r = Math.sqrt(dx * dx + dy * dy);
  let col = mix(C.graphiteHi, C.black, clamp01(r * 0.95));
  const gd = Math.hypot(mx - 128, my - 205); col = mix(col, C.magenta, clamp01(1 - gd / 130) * 0.16);
  return col;
}
// Color de la MARCA en un punto 0..256 (capas: hoja > corona > escudo > placa).
function markColor(mx: number, my: number, bg: RGB): RGB {
  if (pointInPoly(mx, my, BLADE)) return gradV(my, 138, 198, C.magentaHi, C.darkRed);
  if (pointInPoly(mx, my, CREST)) return gradV(my, 70, 198, C.white, C.silverLo);
  if (pointInPoly(mx, my, SHIELD_OUTER)) {
    let base = gradV(my, 38, 228, C.graphiteHi, C.black);
    if (pointInPoly(mx, my, SLASH)) base = mix(base, C.magenta, 0.16);
    if (!pointInPoly(mx, my, SHIELD_INNER)) base = mix(base, C.steel, 0.6); // borde biselado
    return base;
  }
  return bg;
}

// ─── Rasterizador del icono (placa + marca), con supersampling ───────────
function rasterIcon(size: number, markScale: number): Buffer {
  const ss = 3, rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let r = 0, g = 0, b = 0;
    for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
      const mx = ((x + (sx + 0.5) / ss) / size) * 256, my = ((y + (sy + 0.5) / ss) / size) * 256;
      const bg = plate(mx, my);
      const smx = 128 + (mx - 128) / markScale, smy = 128 + (my - 128) / markScale;
      const col = markColor(smx, smy, bg);
      r += col[0]; g += col[1]; b += col[2];
    }
    const n = ss * ss, i = (y * size + x) * 4;
    rgba[i] = Math.round(r / n); rgba[i + 1] = Math.round(g / n); rgba[i + 2] = Math.round(b / n); rgba[i + 3] = 255;
  }
  return rgba;
}

// ─── SVG builders ────────────────────────────────────────────────────────
const svg = (w: number, h: number, inner: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${inner}</svg>\n`;

const plateBg = (id: string) => `
  <defs>
    <radialGradient id="${id}-pl" cx="0.5" cy="0.42" r="0.75">
      <stop offset="0" stop-color="${PALETTE.graphiteHi}"/><stop offset="1" stop-color="${PALETTE.black}"/>
    </radialGradient>
    <radialGradient id="${id}-gl" cx="0.5" cy="0.82" r="0.5">
      <stop offset="0" stop-color="${PALETTE.magenta}" stop-opacity="0.28"/><stop offset="1" stop-color="${PALETTE.magenta}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="256" height="256" rx="56" fill="url(#${id}-pl)"/>
  <rect width="256" height="256" rx="56" fill="url(#${id}-gl)"/>
  <rect x="1" y="1" width="254" height="254" rx="55" fill="none" stroke="${PALETTE.steel}" stroke-opacity="0.5"/>`;

const iconSvg = (variant: MarkVariant, plated: boolean) =>
  svg(256, 256, `${plated ? plateBg("p") : ""}${markInner("m", variant)}`);

// Wordmark group at (x,y) scaled so 100u → h px.
function wordGroup(text: string, x: number, y: number, h: number, color: string, weight: number, tracking: number) {
  const { d, width } = wordPath(text, tracking);
  const s = h / 100;
  return { g: `<g transform="translate(${x} ${y}) scale(${s})"><path d="${d}" fill="none" stroke="${color}" stroke-width="${weight}" stroke-linecap="butt" stroke-linejoin="miter"/></g>`, w: width * s };
}

function lockupHorizontal(variant: MarkVariant) {
  const onLight = variant === "light";
  const accent = onLight ? PALETTE.graphite : PALETTE.white;
  const sub = onLight ? PALETTE.steel : "rgba(255,255,255,0.45)";
  const ICON = 128, GAP = 34, PAD = 16;
  const tx = PAD + ICON + GAP;
  const drl = wordGroup("DRL", tx, PAD + 14, 64, accent, 13, 9);
  const ch = wordGroup("CHAMPIONS", tx, PAD + 90, 22, sub, 9, 14);
  const textW = Math.max(drl.w, ch.w);
  const W = tx + textW + PAD, H = ICON + PAD * 2;
  const mark = `<g transform="translate(${PAD} ${PAD}) scale(${ICON / 256})">${markInner("h", variant)}</g>`;
  return svg(Math.round(W), Math.round(H), mark + drl.g + ch.g);
}

function lockupVertical(variant: MarkVariant) {
  const accent = variant === "light" ? PALETTE.graphite : PALETTE.white;
  const sub = variant === "light" ? PALETTE.steel : "rgba(255,255,255,0.45)";
  const ICON = 140, W = 360;
  const mark = `<g transform="translate(${(W - ICON) / 2} 16) scale(${ICON / 256})">${markInner("v", variant)}</g>`;
  const drl = wordPath("DRL", 12); const ch = wordPath("CHAMPIONS", 16);
  const drlS = 70 / 100, chS = 24 / 100;
  const drlW = drl.width * drlS, chW = ch.width * chS;
  const drlG = `<g transform="translate(${(W - drlW) / 2} ${16 + ICON + 18}) scale(${drlS})"><path d="${drl.d}" fill="none" stroke="${accent}" stroke-width="13" stroke-linejoin="miter"/></g>`;
  const chG = `<g transform="translate(${(W - chW) / 2} ${16 + ICON + 18 + 78}) scale(${chS})"><path d="${ch.d}" fill="none" stroke="${sub}" stroke-width="9" stroke-linejoin="miter"/></g>`;
  return svg(W, 16 + ICON + 18 + 78 + 30 + 16, mark + drlG + chG);
}

function wordmarkSvg(text: string, color: string = PALETTE.white, weight = 12, tracking = 10) {
  const { d, width } = wordPath(text, tracking); const PAD = weight;
  return svg(Math.round(width + PAD * 2), Math.round(100 + PAD * 2),
    `<g transform="translate(${PAD} ${PAD})"><path d="${d}" fill="none" stroke="${color}" stroke-width="${weight}" stroke-linecap="butt" stroke-linejoin="miter"/></g>`);
}

// ─── OpenGraph PNG (1200×630): placa + marca + wordmark ──────────────────
function rasterOG(W: number, H: number): Buffer {
  const rgba = Buffer.alloc(W * H * 4);
  const MS = 300, MX = 150, MY = (H - MS) / 2; // caja de la marca
  const tx = MX + MS + 70, drlH = 150, chH = 52;
  const drl = wordSegments("DRL", 9), ch = wordSegments("CHAMPIONS", 14);
  const drlS = drlH / 100, chS = chH / 100;
  const drlY = H / 2 - 95, chY = H / 2 + 70;
  const segDist = (px: number, py: number, segs: [Pt, Pt][], ox: number, oy: number, s: number) => {
    let m = 1e9;
    for (const [a, b] of segs) {
      const ax = ox + a[0] * s, ay = oy + a[1] * s, bx = ox + b[0] * s, by = oy + b[1] * s;
      const dx = bx - ax, dy = by - ay; const l2 = dx * dx + dy * dy || 1;
      let t = ((px - ax) * dx + (py - ay) * dy) / l2; t = Math.max(0, Math.min(1, t));
      const cx = ax + t * dx, cy = ay + t * dy; m = Math.min(m, Math.hypot(px - cx, py - cy));
    }
    return m;
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = (x - W / 2) / (W / 2), dy = (y - H / 2) / (H / 2);
    let col = mix(C.graphiteHi, C.black, clamp01(Math.sqrt(dx * dx + dy * dy) * 0.8));
    col = mix(col, C.magenta, clamp01(1 - Math.hypot(x - tx, y - H) / 520) * 0.12);
    // marca
    if (x >= MX && x < MX + MS && y >= MY && y < MY + MS) {
      const smx = ((x - MX) / MS) * 256, smy = ((y - MY) / MS) * 256;
      col = markColor(smx, smy, col);
    }
    // wordmark (trazos)
    if (segDist(x, y, drl.segs, tx, drlY, drlS) < 9) col = C.white;
    else if (segDist(x, y, ch.segs, tx, chY, chS) < 5) col = C.silverLo;
    const i = (y * W + x) * 4; col = col.map((c) => Math.round(c)) as RGB;
    rgba[i] = col[0]; rgba[i + 1] = col[1]; rgba[i + 2] = col[2]; rgba[i + 3] = 255;
  }
  // PNG no-cuadrado: reusar encoder con dimensiones distintas
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6;
  const stride = W * 4; const raw = Buffer.alloc((stride + 1) * H);
  for (let y = 0; y < H; y++) { raw[y * (stride + 1)] = 0; rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride); }
  return Buffer.concat([sig, pngChunk("IHDR", ihdr), pngChunk("IDAT", deflateSync(raw, { level: 9 })), pngChunk("IEND", Buffer.alloc(0))]);
}

// ─── Escritura ────────────────────────────────────────────────────────────
function write(path: string, data: string | Buffer) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, data); console.log("✎", path); }
const png = (path: string, size: number, scale: number) => write(path, encodePng(size, rasterIcon(size, scale)));

// Iconos SVG (variantes)
write("public/branding/icon/icon.svg", iconSvg("color", false));
write("public/branding/icon/icon-plate.svg", iconSvg("color", true));
write("public/branding/icon/icon-mono.svg", iconSvg("mono", false));
write("public/branding/icon/icon-negative.svg", iconSvg("negative", false));
write("public/branding/icon/icon-light.svg", iconSvg("light", false));
write("public/favicon.svg", iconSvg("color", false));
// Lockups
write("public/branding/logo/lockup-horizontal.svg", lockupHorizontal("color"));
write("public/branding/logo/lockup-horizontal-light.svg", lockupHorizontal("light"));
write("public/branding/logo/lockup-horizontal-mono.svg", lockupHorizontal("mono"));
write("public/branding/logo/lockup-horizontal-negative.svg", lockupHorizontal("negative"));
write("public/branding/logo/lockup-vertical.svg", lockupVertical("color"));
write("public/branding/logo/wordmark-drl.svg", wordmarkSvg("DRL", PALETTE.white, 13, 9));
write("public/branding/logo/wordmark-champions.svg", wordmarkSvg("CHAMPIONS", PALETTE.silverLo, 9, 14));
// Assets
write("public/branding/assets/og.png", rasterOG(1200, 630));
// PWA / favicon PNG
png("public/icons/icon-192.png", 192, 0.84);
png("public/icons/icon-512.png", 512, 0.84);
png("public/icons/maskable-192.png", 192, 0.64);
png("public/icons/maskable-512.png", 512, 0.64);
png("public/apple-touch-icon.png", 180, 0.84);
png("public/favicon-32.png", 32, 0.92);
// favicon.ico (16/32/48)
write("public/favicon.ico", encodeIco([16, 32, 48].map((s) => ({ size: s, buf: encodePng(s, rasterIcon(s, 0.94)) }))));

// ── Iconos de ESCRITORIO (Tauri) — desde la misma marca, sin copias manuales ──
png("src-tauri/icons/32x32.png", 32, 0.92);
png("src-tauri/icons/128x128.png", 128, 0.84);
png("src-tauri/icons/128x128@2x.png", 256, 0.84);
png("src-tauri/icons/icon.png", 512, 0.84);
write("src-tauri/app-icon.png", encodePng(1024, rasterIcon(1024, 0.84)));
write("src-tauri/icons/icon.ico", encodeIco([16, 32, 48, 64].map((s) => ({ size: s, buf: encodePng(s, rasterIcon(s, 0.94)) }))));
// Nota: icon.icns (macOS) lo genera `npm run tauri icon src-tauri/app-icon.png` (oficial).

// README de marca
write("public/branding/README.md", `# DRL Champions — Brand Kit\n\nGenerado por \`npx tsx scripts/generate-brand.ts\` (fuente: \`src/branding/geometry.ts\`).\n\n- \`icon/\` — icono (color/plate/mono/negative/light)\n- \`logo/\` — lockups (horizontal/vertical) y wordmarks\n- \`assets/\` — OpenGraph\n\nPaleta: negro ${PALETTE.black} · grafito ${PALETTE.graphite} · plata ${PALETTE.silver} · rojo ${PALETTE.darkRed} · magenta ${PALETTE.magenta}.\nApp icons en \`/public/icons\`, favicon en \`/public/favicon.{svg,ico}\`.\n`);

console.log("\n✅ Marca generada.");
