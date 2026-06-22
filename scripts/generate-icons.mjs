/**
 * Genera los iconos PNG de la PWA (gradiente DRL + letra "D") sin dependencias
 * externas ni IA: dibuja por píxel y codifica PNG con zlib.
 *
 *   node scripts/generate-icons.mjs
 */
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const crcTable = (() => {
  const t = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function encodePng(size, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filtro 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

const lerp = (a, b, t) => a + (b - a) * t;
function bg(u, v) {
  const t = (u + v) / 2;
  return [Math.round(lerp(0xff, 0x11, t)), Math.round(lerp(0x2e, 0x13, t)), Math.round(lerp(0x63, 0x1f, t))];
}
// ¿El punto (u,v) cae dentro de la letra "D" (a escala `scale`)?
function inD(u, v, scale) {
  const gu = (u - 0.5) / scale + 0.5;
  const gv = (v - 0.5) / scale + 0.5;
  const x0 = 0.3,
    xMid = 0.52,
    y0 = 0.24,
    y1 = 0.76,
    t = 0.115;
  const rx = 0.24,
    ry = (y1 - y0) / 2,
    yc = (y0 + y1) / 2;
  const outer =
    (gu >= x0 && gu <= xMid && gv >= y0 && gv <= y1) ||
    (gu >= xMid && ((gu - xMid) / rx) ** 2 + ((gv - yc) / ry) ** 2 <= 1);
  if (!outer) return false;
  const inner =
    (gu >= x0 + t && gu <= xMid && gv >= y0 + t && gv <= y1 - t) ||
    (gu >= xMid && ((gu - xMid) / (rx - t)) ** 2 + ((gv - yc) / (ry - t)) ** 2 <= 1);
  return !inner;
}

function makeIcon(size, scale, path) {
  const ss = 2; // supersampling para suavizar bordes
  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const u = (x + (sx + 0.5) / ss) / size;
          const v = (y + (sy + 0.5) / ss) / size;
          let [cr, cg, cb] = bg(u, v);
          if (inD(u, v, scale)) {
            cr = 0xf5;
            cg = 0xf6;
            cb = 0xfa;
          }
          r += cr;
          g += cg;
          b += cb;
        }
      }
      const n = ss * ss;
      const i = (y * size + x) * 4;
      rgba[i] = Math.round(r / n);
      rgba[i + 1] = Math.round(g / n);
      rgba[i + 2] = Math.round(b / n);
      rgba[i + 3] = 255;
    }
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, encodePng(size, rgba));
  console.log("escrito", path, `(${size}px)`);
}

makeIcon(192, 1, "public/icons/icon-192.png");
makeIcon(512, 1, "public/icons/icon-512.png");
makeIcon(192, 0.72, "public/icons/maskable-192.png");
makeIcon(512, 0.72, "public/icons/maskable-512.png");
makeIcon(180, 1, "public/apple-touch-icon.png");
makeIcon(32, 1, "public/favicon-32.png");
