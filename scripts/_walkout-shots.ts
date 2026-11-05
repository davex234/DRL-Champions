/**
 * PACK WALKOUT 0.1 · capturas por beats (instrumento local, fuera de CI). Necesita la app en BASE_URL con el arnés
 * abierto (`npm run dev` o `NEXUS_QA_HARNESS=1 next start`). Sin cuentas, sin BD: la página es DEMO.
 *
 *   BASE_URL=http://127.0.0.1:3011 npx tsx scripts/_walkout-shots.ts [fx] [intensity]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep } from "./lib/cdp";

/* eslint-disable @typescript-eslint/no-explicit-any */
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3011";
const OUT = join(process.cwd(), process.env.WALKOUT_OUT ?? "docs/product/qa/walkout-0.1");
mkdirSync(OUT, { recursive: true });
const fx = process.argv[2] ?? "champions-s";
const intensity = process.argv[3] ?? "WALKOUT";

const BEATS: Record<string, [string, number][]> = {
  WALKOUT: [["0-pack", 0.75], ["0-open", 1.25], ["A-darkness", 1.75], ["B-human", 3.0], ["C-flag", 3.8], ["D-role", 4.75], ["E-team", 5.62], ["F0-ovr-first", 7.35], ["F-ovr", 8.15], ["F2-flash", 8.65], ["G-player", 9.25], ["H-final", 10.5]],
  MEGA_WALKOUT: [["A-darkness", 2.2], ["B-human", 3.6], ["C-flag", 4.7], ["D-role", 5.8], ["E-team", 6.95], ["F-ovr", 10.1], ["G-player", 11.6], ["H-final", 13]],
  RARE: [["A-darkness", 1.0], ["C-flag", 2.1], ["D-role", 2.7], ["F-ovr", 4.1], ["G-player", 4.8], ["H-final", 5.6]],
  STANDARD: [["0-pack", 0.3], ["A-darkness", 0.65], ["F-ovr", 1.25], ["G-player", 1.8], ["H-final", 2.6]],
  REDUCED: [["C-flag", 0.4], ["D-role", 0.9], ["E-team", 1.4], ["F-ovr", 2.45], ["G-player", 2.8], ["H-final", 3.3]],
};

async function run() {
  const report: any[] = [];
  const widths = (process.env.WALKOUT_WIDTHS ?? "1440,390").split(",").map(Number);
  const modes = (process.env.WALKOUT_MODES ?? "motion,reduced").split(",").map((m) => m === "reduced");
  for (const width of widths) {
    for (const reduced of modes) {
      const browser = await launch({ args: ["--mute-audio", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
      const tab = browser.tab;
      await tab.resize(width, width < 600 ? 844 : 900, 1);
      await tab.setMedia([{ name: "prefers-reduced-motion", value: reduced ? "reduce" : "no-preference" }]);
      const only = process.env.WALKOUT_BEATS?.split(",");
      const list = (reduced ? BEATS.REDUCED : BEATS[intensity]).filter(([n]) => !only || only.some((o) => n.startsWith(o)));
      for (const [name, t] of list) {
        await tab.goto(`${BASE}/design-system/pack-walkout?fx=${fx}&i=${intensity}&t=${t}&panel=0&reduced=${reduced ? 1 : 0}`, 2500);
        await sleep(900);
        const info = await tab.js(`(() => { const w = document.querySelector('[data-testid=walkout]'); return { stage: w?.dataset.stage, t: w?.dataset.t, status: w?.dataset.status, summary: document.querySelector('[data-testid=walkout-summary]')?.textContent ?? null }; })()`);
        const file = `${fx}-${intensity}-${reduced ? "reduced" : "motion"}-${name}-${width}.png`;
        await tab.shot(join(OUT, file));
        report.push({ width, reduced, name, t, ...info, file });
        console.log(width, reduced ? "R" : "M", name, JSON.stringify(info));
      }
      const errs = tab.takeErrors();
      if (errs.length) console.log("console errors:", errs.slice(0, 8));
      report.push({ width, reduced, consoleErrors: errs });
      await browser.close();
    }
  }
  writeFileSync(join(OUT, `${fx}-${intensity}-report.json`), JSON.stringify(report, null, 2));
}

run().catch((e) => { console.error(e); process.exit(1); });
