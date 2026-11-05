/**
 * FASE 55 · instrumento de capturas del Competitivo 4.0 (fuera de CI).
 *
 *   npx tsx scripts/_fase55-shots.ts [--base=http://127.0.0.1:3005] [--only=hub]
 *
 * Arnés `/design-system/fase55` (fixtures QA SYNTHETIC; partidas simuladas con el motor real). Estados que NO deben
 * forzarse en la cuenta real (bloqueado, ascenso, descenso…) se fotografían aquí. Salida:
 * `docs/product/qa/fase55-competitive/` (15 obligatorias + matriz responsive `r-*` a 6 anchos) y `shots.json`
 * con los errores de consola y los desbordes horizontales medidos por pieza.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep, type Tab } from "./lib/cdp";

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg("base") ?? "http://127.0.0.1:3005";
const OUT = join(process.cwd(), "docs", "product", "qa", "fase55-competitive");
mkdirSync(OUT, { recursive: true });

async function fullPage(tab: Tab, file: string, w: number) {
  const h = await tab.js<number>("Math.ceil(document.documentElement.scrollHeight)");
  const r = await tab.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: w, height: Math.min(h, 9000), scale: 1 } });
  writeFileSync(file, Buffer.from(r.data, "base64"));
}
async function element(tab: Tab, sel: string, file: string, pad = 16): Promise<boolean> {
  const box = await tab.js<{ x: number; y: number; w: number; h: number } | null>(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height }; })()`);
  if (!box) return false;
  const r = await tab.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: box.w + pad * 2, height: box.h + pad * 2, scale: 1 } });
  writeFileSync(file, Buffer.from(r.data, "base64"));
  return true;
}
/** Piezas que se salen del ancho de la ventana (un `overflow` recortado no se ve con scrollWidth). */
const OVERFLOW = `(() => { const W = innerWidth; const out = []; for (const e of document.querySelectorAll('main *, [data-qa-scene] *')) { const r = e.getBoundingClientRect(); if (r.width > 0 && (r.right > W + 1 || r.left < -1)) { const s = getComputedStyle(e); if (s.position === 'fixed') continue; let p = e.parentElement, clipped = false; while (p) { const ps = getComputedStyle(p); if (/(hidden|clip|auto|scroll)/.test(ps.overflowX)) { const pr = p.getBoundingClientRect(); if (pr.right <= W + 1 && pr.left >= -1) { clipped = true; break; } } p = p.parentElement; } if (!clipped) out.push((e.getAttribute('data-testid') || e.tagName) + ':' + Math.round(r.left) + '..' + Math.round(r.right)); } } return { scroll: document.documentElement.scrollWidth > W + 1, pieces: out.slice(0, 6) }; })()`;

interface Job { name: string; scene: string; w: number; h: number; full?: boolean; sel?: string; wait?: number; motion?: boolean }
const W6 = [1920, 1440, 1366, 1024, 768, 390] as const;
const HEIGHT: Record<number, number> = { 1920: 1080, 1440: 900, 1366: 768, 1024: 768, 768: 1024, 390: 844 };

const J: Job[] = [
  { name: "01-hub-desktop", scene: "01-hub", w: 1440, h: 900, full: true },
  { name: "02-hub-mobile", scene: "01-hub", w: 390, h: 844, full: true },
  { name: "03-locked", scene: "03-locked", w: 1440, h: 900, full: true },
  { name: "03b-no-decks", scene: "03b-no-decks", w: 1440, h: 900, sel: '[data-testid="ranked-play"]' },
  { name: "04-ready", scene: "04-ready", w: 1440, h: 900, full: true },
  { name: "04b-placement", scene: "04b-placement", w: 1440, h: 900, sel: '[data-scene="ranked-hero"]' },
  { name: "05-searching", scene: "05-searching", w: 1440, h: 900, full: true, motion: true, wait: 1400 },
  { name: "05b-searching-long", scene: "05b-searching-long", w: 390, h: 844, full: true },
  { name: "06-match-found", scene: "06-match-found", w: 1440, h: 900, full: true, motion: true, wait: 1100 },
  { name: "07-match", scene: "07-match", w: 1440, h: 900, full: true, wait: 2600 },
  { name: "08-victory", scene: "08-victory", w: 1440, h: 900, full: true, wait: 2600 },
  { name: "09-defeat", scene: "09-defeat", w: 1440, h: 900, full: true, wait: 2600 },
  { name: "10-rating-up", scene: "10-rating-up", w: 1440, h: 900, sel: '[data-testid="pvp-rating"]', wait: 2600 },
  { name: "11-rating-down", scene: "11-rating-down", w: 1440, h: 900, sel: '[data-testid="pvp-rating"]', wait: 2600 },
  { name: "12-promotion", scene: "12-promotion", w: 1440, h: 900, sel: '[data-testid="ranked-movement"]', motion: true, wait: 3000 },
  { name: "12b-placed", scene: "12b-placed", w: 1440, h: 900, sel: '[data-testid="ranked-movement"]', motion: true, wait: 3000 },
  { name: "12c-entered", scene: "12c-entered", w: 390, h: 844, sel: '[data-testid="ranked-movement"]', motion: true, wait: 3000 },
  { name: "12d-demotion", scene: "09-defeat", w: 1440, h: 900, sel: '[data-testid="ranked-movement"]', motion: true, wait: 3000 },
  { name: "13-history", scene: "13-history", w: 1440, h: 900, full: true },
  { name: "14-leaderboard", scene: "14-leaderboard", w: 1440, h: 900, full: true },
  { name: "14b-leaderboard-390", scene: "14-leaderboard", w: 390, h: 844, full: true },
  { name: "15-season-integration", scene: "15-season-integration", w: 1440, h: 900, full: true },
  { name: "16-first", scene: "16-first", w: 1440, h: 900, sel: '[data-scene="ranked-hero"]' },
  { name: "17-resume", scene: "17-resume", w: 1440, h: 900, sel: '[data-testid="ranked-play"]' },
  // Matriz responsive: centro, resultado con ascenso, clasificación e historial en los seis anchos.
  ...W6.flatMap((w) => [
    { name: `r-hub-${w}`, scene: "01-hub", w, h: HEIGHT[w], full: true },
    { name: `r-result-${w}`, scene: "12-promotion", w, h: HEIGHT[w], full: true, wait: 2600 },
    { name: `r-search-${w}`, scene: "05-searching", w, h: HEIGHT[w], full: true },
    { name: `r-found-${w}`, scene: "06-match-found", w, h: HEIGHT[w], full: true },
  ]),
];

(async () => {
  const only = arg("only");
  const browser = await launch({ args: ["--in-process-gpu", "--mute-audio", "--hide-scrollbars"] });
  const rows: { name: string; ok: boolean; errors: string[]; overflow: unknown }[] = [];
  try {
    for (const j of J) {
      if (only && !j.name.includes(only)) continue;
      await browser.tab.resize(j.w, j.h, 1);
      await browser.tab.setMedia([{ name: "prefers-reduced-motion", value: j.motion ? "no-preference" : "reduce" }]);
      await browser.tab.goto(`${BASE}/design-system/fase55?scene=${j.scene}`, j.wait ?? 2200);
      await sleep(400);
      const overflow = await browser.tab.js(OVERFLOW);
      const file = join(OUT, `${j.name}.png`);
      const ok = j.full ? (await fullPage(browser.tab, file, j.w), true) : await element(browser.tab, j.sel!, file);
      const errors = browser.tab.takeErrors();
      rows.push({ name: j.name, ok, errors, overflow });
      const ov = overflow as { scroll: boolean; pieces: string[] };
      console.log(`  ${ok ? "✓" : "✗"} ${j.name}${ov.scroll || ov.pieces.length ? ` · DESBORDE ${JSON.stringify(ov)}` : ""}${errors.length ? ` · ${errors.length} err: ${errors[0].slice(0, 140)}` : ""}`);
    }
  } finally { await browser.close(); }
  writeFileSync(join(OUT, "shots.json"), JSON.stringify({ base: BASE, generated: new Date().toISOString(), note: "arnés /design-system/fase55 · QA SYNTHETIC; partidas simuladas con el motor real", rows }, null, 2));
})();
