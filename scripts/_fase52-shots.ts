/**
 * FASE 52 · instrumento de capturas del Season Command Center (fuera de CI).
 *
 *   npx tsx scripts/_fase52-shots.ts [--out=draft] [--only=full]
 *
 * Arnés `/design-system/fase52` (fixtures QA SYNTHETIC sobre carriles y misiones reales). Hace capturas de
 * página ENTERA por ancho y recortes por sección (`[data-testid=…]`), a `docs/product/qa/fase52-season/<out>`.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep, type Tab } from "./lib/cdp";

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg("base") ?? "http://127.0.0.1:3005";
const OUT = join(process.cwd(), "docs", "product", "qa", "fase52-season", arg("out") ?? "");
mkdirSync(OUT, { recursive: true });

async function fullPage(tab: Tab, file: string, w: number) {
  const h = await tab.js<number>("Math.ceil(document.documentElement.scrollHeight)");
  const r = await tab.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: w, height: Math.min(h, 12000), scale: 1 } });
  writeFileSync(file, Buffer.from(r.data, "base64"));
}
async function element(tab: Tab, sel: string, file: string, pad = 16): Promise<boolean> {
  const box = await tab.js<{ x: number; y: number; w: number; h: number } | null>(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height }; })()`);
  if (!box) return false;
  const r = await tab.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: box.w + pad * 2, height: box.h + pad * 2, scale: 1 } });
  writeFileSync(file, Buffer.from(r.data, "base64"));
  return true;
}

interface Job { name: string; scene: string; w: number; h: number; full?: boolean; sel?: string; gesture?: string }
const J: Job[] = [
  { name: "01-season-1920", scene: "full", w: 1920, h: 1080, full: true },
  { name: "02-season-1440", scene: "full", w: 1440, h: 900, full: true },
  { name: "03-season-1366", scene: "full", w: 1366, h: 768, full: true },
  { name: "04-season-1024", scene: "full", w: 1024, h: 768, full: true },
  { name: "05-season-768", scene: "full", w: 768, h: 1024, full: true },
  { name: "06-season-390", scene: "full", w: 390, h: 844, full: true },
  { name: "07-hero", scene: "full", w: 1440, h: 900, sel: '[data-testid="season-hero"]' },
  { name: "08-current-level", scene: "full", w: 1440, h: 900, sel: '[data-testid="hero-pass"]' },
  { name: "09-reward-track", scene: "full", w: 1440, h: 900, sel: '[data-testid="reward-track"]' },
  { name: "09b-reward-track-390", scene: "full", w: 390, h: 844, sel: '[data-testid="reward-track"]' },
  { name: "09c-competitive-open", scene: "competitive-open", w: 1440, h: 900, sel: '[data-testid="reward-track"]' },
  { name: "10-reward-card", scene: "reward-card", w: 1440, h: 900, sel: '[data-testid="reward-kinds"]' },
  { name: "11-reward-pack", scene: "full", w: 1440, h: 900, sel: '[data-testid="reward-detail"]', gesture: `(() => { const b = document.querySelector('[data-node="free-10"]'); b?.click(); return !!b; })()` },
  { name: "12-reward-credits", scene: "full", w: 1440, h: 900, sel: '[data-testid="reward-detail"]', gesture: `(() => { const b = document.querySelector('[data-node="free-8"]'); b?.click(); return !!b; })()` },
  { name: "12b-reward-claimable", scene: "full", w: 1440, h: 900, sel: '[data-testid="reward-detail"]', gesture: `(() => { const b = document.querySelector('[data-node="free-6"]'); b?.click(); return !!b; })()` },
  { name: "13-missions", scene: "full", w: 1440, h: 900, sel: '[data-testid="season-missions"]' },
  { name: "14-mission-progress", scene: "full", w: 1440, h: 900, sel: '[data-mission-kind="weekly"]' },
  { name: "15-completed-state", scene: "full", w: 1440, h: 900, sel: '[data-mission-kind="seasonal"]' },
  { name: "16-next-objective", scene: "full", w: 1440, h: 900, sel: '[data-testid="season-next"]' },
  { name: "17-anonymous", scene: "anonymous", w: 1440, h: 900, full: true },
  { name: "18-new-player", scene: "new-player", w: 1440, h: 900, full: true },
  { name: "19-ended", scene: "ended", w: 1440, h: 900, full: true },
  { name: "20-no-season", scene: "no-season", w: 1440, h: 900, full: true },
  { name: "21-missions-390", scene: "full", w: 390, h: 844, sel: '[data-testid="season-missions"]' },
];

(async () => {
  const only = arg("only");
  const browser = await launch({ args: ["--in-process-gpu", "--mute-audio", "--hide-scrollbars"] });
  const rows: { name: string; ok: boolean; errors: string[] }[] = [];
  try {
    for (const j of J) {
      if (only && !j.name.includes(only)) continue;
      await browser.tab.resize(j.w, j.h, 1);
      await browser.tab.setMedia([{ name: "prefers-reduced-motion", value: "reduce" }]);
      await browser.tab.goto(`${BASE}/design-system/fase52?scene=${j.scene}`, 2200);
      if (j.gesture) { await browser.tab.js(j.gesture); await sleep(400); }
      const file = join(OUT, `${j.name}.png`);
      const ok = j.full ? (await fullPage(browser.tab, file, j.w), true) : await element(browser.tab, j.sel!, file);
      const errors = browser.tab.takeErrors();
      rows.push({ name: j.name, ok, errors });
      console.log(`  ${ok ? "✓" : "✗"} ${j.name}${errors.length ? ` · ${errors.length} err: ${errors[0].slice(0, 140)}` : ""}`);
    }
  } finally { await browser.close(); }
  writeFileSync(join(OUT, "shots.json"), JSON.stringify({ base: BASE, generated: new Date().toISOString(), note: "arnés /design-system/fase52 · QA SYNTHETIC sobre carriles y misiones reales", rows }, null, 2));
})();
