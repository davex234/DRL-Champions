/**
 * FASE 56 · instrumento de capturas del Perfil de Jugador 4.0 (fuera de CI).
 *
 *   npx tsx scripts/_fase56-shots.ts [--base=http://127.0.0.1:3005] [--only=own]
 *
 * Arnés `/design-system/fase56` (QA SYNTHETIC, cartas reales). Salida: `docs/product/qa/fase56-profile/` + `shots.json`
 * con errores de consola y piezas que desbordan el ancho de la ventana. En serie: un solo Chrome (memoria justa).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep, type Tab } from "./lib/cdp";

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg("base") ?? "http://127.0.0.1:3005";
const OUT = join(process.cwd(), "docs", "product", "qa", "fase56-profile");
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
const OVERFLOW = `(() => { const W = innerWidth; const out = []; for (const e of document.querySelectorAll('[data-qa-scene] *')) { const r = e.getBoundingClientRect(); if (r.width > 0 && (r.right > W + 1 || r.left < -1)) { if (getComputedStyle(e).position === 'fixed') continue; let p = e.parentElement, clipped = false; while (p) { const ps = getComputedStyle(p); if (/(hidden|clip|auto|scroll)/.test(ps.overflowX)) { const pr = p.getBoundingClientRect(); if (pr.right <= W + 1 && pr.left >= -1) { clipped = true; break; } } p = p.parentElement; } if (!clipped) out.push((e.getAttribute('data-testid') || e.tagName) + ':' + Math.round(r.left) + '..' + Math.round(r.right)); } } return { scroll: document.documentElement.scrollWidth > W + 1, pieces: out.slice(0, 6) }; })()`;

interface Job { name: string; scene: string; w: number; h: number; full?: boolean; sel?: string }
const J: Job[] = [
  { name: "01-own-profile-1440", scene: "own", w: 1440, h: 900, full: true },
  { name: "02-other-profile-1440", scene: "other", w: 1440, h: 900, full: true },
  { name: "03-own-profile-390", scene: "own", w: 390, h: 844, full: true },
  { name: "04-other-profile-390", scene: "other", w: 390, h: 844, full: true },
  { name: "05-ranked-player", scene: "ranked", w: 1440, h: 900, sel: '[data-testid="ranked-panel"]' },
  { name: "05b-ranked-hero", scene: "ranked", w: 1440, h: 900, sel: '[data-testid="player-hero"]' },
  { name: "06-placement-player", scene: "placement", w: 1440, h: 900, sel: '[data-testid="ranked-panel"]' },
  { name: "06b-placement-hero", scene: "placement", w: 1440, h: 900, sel: '[data-testid="player-hero"]' },
  { name: "07-no-ranked-games", scene: "no-ranked", w: 1440, h: 900, full: true },
  { name: "08-featured-cards", scene: "featured-cards", w: 1440, h: 900, sel: '[data-testid="showcase"]' },
  { name: "09-achievements", scene: "achievements", w: 1440, h: 900, sel: '[data-testid="featured-achievements"]' },
  { name: "10-history", scene: "history", w: 1440, h: 900, full: true },
  { name: "11-leaderboard-to-profile", scene: "leaderboard", w: 1440, h: 900, full: true },
  { name: "12-nonexistent", scene: "nonexistent", w: 1440, h: 900, full: true },
  { name: "13-tablet-768", scene: "other", w: 768, h: 1024, full: true },
  { name: "13b-tablet-1024", scene: "other", w: 1024, h: 768, full: true },
  { name: "14-long-name", scene: "long-name", w: 390, h: 844, sel: '[data-testid="player-hero"]' },
  { name: "14b-long-name-1440", scene: "long-name", w: 1440, h: 900, sel: '[data-testid="player-hero"]' },
  { name: "15-empty-profile", scene: "empty", w: 1440, h: 900, full: true },
  { name: "16-season", scene: "own", w: 1440, h: 900, sel: '[data-testid="profile-season"]' },
  { name: "17-anon", scene: "anon", w: 1440, h: 900, sel: '[data-testid="player-hero"]' },
  { name: "r-own-1920", scene: "own", w: 1920, h: 1080, full: true },
  { name: "r-own-1366", scene: "own", w: 1366, h: 768, full: true },
];

(async () => {
  const only = arg("only");
  const browser = await launch({ args: ["--in-process-gpu", "--mute-audio", "--hide-scrollbars"] });
  const rows: { name: string; ok: boolean; errors: string[]; overflow: unknown }[] = [];
  try {
    for (const j of J) {
      if (only && !j.name.includes(only)) continue;
      await browser.tab.resize(j.w, j.h, 1);
      await browser.tab.setMedia([{ name: "prefers-reduced-motion", value: "reduce" }]);
      await browser.tab.goto(`${BASE}/design-system/fase56?scene=${j.scene}`, 2600);
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
  writeFileSync(join(OUT, "shots.json"), JSON.stringify({ base: BASE, generated: new Date().toISOString(), note: "arnés /design-system/fase56 · QA SYNTHETIC; cartas reales del catálogo", rows }, null, 2));
})();
