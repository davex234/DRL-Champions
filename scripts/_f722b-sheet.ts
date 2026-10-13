// F72.2b · hoja de contacto de los logos candidatos (revisión visual; fuera de CI). docs/product/qa/fase72-2/logo-candidates.png
import sharp from "sharp";
import { join } from "node:path";
const L = "C:/NEXUS-CENTRAL/NEXUSFICHAJES/players/EQUIPOS";
const C: [string, string][] = [
  ["100t", "AMERICAS/100T/Logo.png"], ["bbl", "EMEA/BBL/LOGO.png"], ["c9", "AMERICAS/C9/Logo.png"], ["drg", "CHINA/DRG/logo.png"],
  ["eg", "AMERICAS/EG/Logo.png"], ["envy", "AMERICAS/ENVY/logo.png"], ["ef", "EMEA/EF/LOGO.png"], ["fnatic", "EMEA/FNC/LOGO.png"],
  ["furia", "AMERICAS/FUR/logo.png"], ["g2", "AMERICAS/G2/LOGO.png"], ["kru", "AMERICAS/KRÜ/logo.png"], ["leviatan", "AMERICAS/LEV/logo.png"],
  ["loud", "AMERICAS/LOUD/logo.png"], ["mibr", "AMERICAS/MIBR/logo.png"], ["nrg", "AMERICAS/NRG/logo.png"], ["sentinels", "AMERICAS/SEN/logo.png"],
  ["team-heretics", "EMEA/TH/LOGO.png"], ["team-liquid", "EMEA/TL/LOGO.png"], ["vitality", "EMEA/VIT/LOGO.png"],
  ["fut", "EMEA/FUT/FUT.png"], ["giantx", "EMEA/GX/GX.png"], ["karmine-corp", "EMEA/KC/KC.png"], ["m8", "EMEA/M8/M8.png"], ["navi", "EMEA/NAVI/NAVI.png"], ["pcific", "EMEA/PCF/PCF.png"],
];
(async () => {
  const S = 160, P = 30, COLS = 5, rows = Math.ceil(C.length / COLS);
  const tiles = await Promise.all(C.map(async ([id, f], i) => {
    const img = await sharp(join(L, f)).resize(S, S, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    const label = Buffer.from(`<svg width="${S}" height="${P}"><text x="${S / 2}" y="20" font-size="15" fill="#fff" text-anchor="middle" font-family="Arial">${id}</text></svg>`);
    return [{ input: img, left: (i % COLS) * (S + 20) + 10, top: Math.floor(i / COLS) * (S + P + 20) + 10 }, { input: label, left: (i % COLS) * (S + 20) + 10, top: Math.floor(i / COLS) * (S + P + 20) + 10 + S }];
  }));
  await sharp({ create: { width: COLS * (S + 20), height: rows * (S + P + 20), channels: 4, background: { r: 40, g: 12, b: 24, alpha: 1 } } })
    .composite(tiles.flat()).png().toFile(join(process.cwd(), "docs/product/qa/fase72-2/logo-candidates.png"));
  console.log("ok");
})();
