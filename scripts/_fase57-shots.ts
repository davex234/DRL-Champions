/**
 * FASE 57 · capturas de Pack Opening 5.0 (fuera de CI).
 *
 *   npx tsx scripts/_fase57-shots.ts [--base=http://127.0.0.1:3005] [--only=09]
 *
 * Arnés `/design-system/fase57` (QA SYNTHETIC; sobres y cartas reales del catálogo). Las escenas animadas están
 * congeladas en el arnés; las de movimiento se fotografían con `no-preference` y un reposo largo para el estado final.
 * Salida: `docs/product/qa/fase57-pack-opening/` + `shots.json` (errores de consola y piezas fuera del viewport).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep } from "./lib/cdp";

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg("base") ?? "http://127.0.0.1:3005";
const OUT = join(process.cwd(), "docs", "product", "qa", "fase57-pack-opening");
mkdirSync(OUT, { recursive: true });

/** Piezas clave (sobre, carta revelada, botones) que se salen de la ventana. */
const CHECK = `(() => { const W = innerWidth, H = innerHeight; const out = []; for (const sel of ['[data-testid="ceremony-pack"]','[data-testid="reveal-card"] [data-face="front"]','[data-card-back]','[data-testid="pack-open"]','[data-testid="pack-reveal"]']) { for (const e of document.querySelectorAll(sel)) { const r = e.getBoundingClientRect(); if (r.width === 0) continue; if (r.left < -1 || r.right > W + 1 || r.top < -1 || r.bottom > H + 1) out.push(sel + ':' + Math.round(r.left) + ',' + Math.round(r.top) + ',' + Math.round(r.right) + ',' + Math.round(r.bottom)); } } return { hscroll: document.documentElement.scrollWidth > W + 1, out: out.slice(0, 6) }; })()`;

interface Job { name: string; scene: string; w: number; h: number; motion?: boolean; wait?: number }
const J: Job[] = [
  { name: "01-sealed", scene: "01-sealed", w: 1440, h: 900, motion: true, wait: 2600 },
  { name: "01b-sealed-oro", scene: "01b-sealed-oro", w: 1440, h: 900, motion: true, wait: 2600 },
  { name: "01c-sealed-team", scene: "01c-sealed-team", w: 1440, h: 900, motion: true, wait: 2600 },
  { name: "01d-sealed-procedural", scene: "01d-sealed-procedural", w: 1440, h: 900, motion: true, wait: 2600 },
  { name: "02-anticipation", scene: "02-anticipation", w: 1440, h: 900, motion: true, wait: 2000 },
  { name: "03-tearing", scene: "03-tearing", w: 1440, h: 900, motion: true, wait: 2000 },
  { name: "04-emerging", scene: "04-emerging", w: 1440, h: 900, motion: true, wait: 2600 },
  { name: "05-face-down", scene: "05-face-down", w: 1440, h: 900, motion: true, wait: 2600 },
  { name: "05b-face-down-6", scene: "05b-face-down-6", w: 1440, h: 900, motion: true, wait: 2600 },
  { name: "06a-idle", scene: "06a-idle", w: 1440, h: 900, motion: true, wait: 2000 },
  { name: "06-reveal-common", scene: "06-reveal-common", w: 1440, h: 900, motion: true, wait: 2400 },
  { name: "07-reveal-rare", scene: "07-reveal-rare", w: 1440, h: 900, motion: true, wait: 2400 },
  { name: "08a-epic-charging", scene: "08a-epic-charging", w: 1440, h: 900, motion: true, wait: 1500 },
  { name: "08-reveal-epic", scene: "08-reveal-epic", w: 1440, h: 900, motion: true, wait: 2600 },
  { name: "09a-max-charging", scene: "09a-max-charging", w: 1440, h: 900, motion: true, wait: 1900 },
  { name: "09-reveal-max", scene: "09-reveal-max", w: 1440, h: 900, motion: true, wait: 2800 },
  { name: "10-summary", scene: "10-summary", w: 1440, h: 900, wait: 2400 },
  { name: "11-duplicate", scene: "11-duplicate", w: 1440, h: 900, motion: true, wait: 2400 },
  { name: "11b-summary-duplicates", scene: "11b-summary-duplicates", w: 1440, h: 900, wait: 2400 },
  { name: "12-mobile-sealed", scene: "01-sealed", w: 390, h: 844, motion: true, wait: 2600 },
  { name: "12b-mobile-face-down", scene: "05-face-down", w: 390, h: 844, motion: true, wait: 2600 },
  { name: "12c-mobile-reveal-max", scene: "09-reveal-max", w: 390, h: 844, motion: true, wait: 2800 },
  { name: "12d-mobile-summary", scene: "10-summary", w: 390, h: 844, wait: 2400 },
  { name: "13-reduced-sealed", scene: "13-reduced-sealed", w: 1440, h: 900, wait: 1600 },
  { name: "13b-reduced-hand", scene: "13b-reduced-hand", w: 1440, h: 900, wait: 1600 },
  { name: "13c-reduced-reveal", scene: "13c-reduced-reveal", w: 390, h: 844, wait: 1600 },
  ...[1920, 1366, 1024, 768].flatMap((w) => {
    const h = w === 1920 ? 1080 : w === 1366 ? 768 : w === 1024 ? 768 : 1024;
    return [
      { name: `r-sealed-${w}`, scene: "01-sealed", w, h, motion: true, wait: 2600 },
      { name: `r-hand-${w}`, scene: "05-face-down", w, h, motion: true, wait: 2600 },
      { name: `r-reveal-${w}`, scene: "09-reveal-max", w, h, motion: true, wait: 2800 },
    ];
  }),
];

(async () => {
  const only = arg("only");
  const browser = await launch({ args: ["--in-process-gpu", "--mute-audio", "--hide-scrollbars"] });
  const rows: { name: string; errors: string[]; check: unknown }[] = [];
  try {
    for (const j of J) {
      if (only && !j.name.includes(only)) continue;
      await browser.tab.resize(j.w, j.h, 1);
      await browser.tab.setMedia([{ name: "prefers-reduced-motion", value: j.motion ? "no-preference" : "reduce" }]);
      await browser.tab.goto(`${BASE}/design-system/fase57?scene=${j.scene}`, j.wait ?? 2200);
      await sleep(300);
      const check = await browser.tab.js(CHECK);
      await browser.tab.shot(join(OUT, `${j.name}.png`));
      const errors = browser.tab.takeErrors();
      rows.push({ name: j.name, errors, check });
      const c = check as { hscroll: boolean; out: string[] };
      console.log(`  ✓ ${j.name}${c.hscroll || c.out.length ? ` · FUERA ${JSON.stringify(c)}` : ""}${errors.length ? ` · ${errors.length} err: ${errors[0].slice(0, 140)}` : ""}`);
    }
  } finally { await browser.close(); }
  writeFileSync(join(OUT, "shots.json"), JSON.stringify({ base: BASE, generated: new Date().toISOString(), note: "arnés /design-system/fase57 · QA SYNTHETIC; sobres y cartas reales del catálogo", rows }, null, 2));
})();
