/**
 * PACK WALKOUT 0.2 · capturas de la PERSONA por beats (instrumento local, fuera de CI). Necesita la app en BASE_URL con
 * el arnés abierto (`npm run dev` o `NEXUS_QA_HARNESS=1 next start`). Espera a que el GLB esté en escena
 * (`data-human="ready"` en el lienzo) antes de cada captura. Sin cuentas, sin BD: la página es DEMO.
 *
 *   BASE_URL=http://localhost:3000 npx tsx scripts/_walkout-human-shots.ts [fx] [intensity]
 *   WALKOUT_BEATS=2-,3- (prefijos) · WALKOUT_WIDTHS=1440,390 · WALKOUT_OUT=docs/product/qa/walkout-0.2
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { launch, sleep } from "./lib/cdp";

/* eslint-disable @typescript-eslint/no-explicit-any */
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = resolve(process.cwd(), process.env.WALKOUT_OUT ?? "docs/product/qa/walkout-0.2");
mkdirSync(OUT, { recursive: true });
const fx = process.argv[2] ?? "champions-s";
const intensity = process.argv[3] ?? "WALKOUT";

const BEATS: Record<string, [string, number][]> = {
  // 0.3: la arena y la celebración (el prefijo «0-» pinta la arena SIN persona)
  WALKOUT: [
    ["0-arena-vacia", 3.6], ["1-figura-al-fondo", 2.8], ["2-inicio-caminata", 3.3], ["3-bandera", 4.3], ["4-mitad-caminata", 5.1],
    ["5-impacto-escudo", 6.25], ["5b-logo-en-pantallas", 7.1], ["6-deteniendose", 8.0], ["7a-celebracion", 8.75], ["7b-celebracion", 9.3],
    ["7c-celebracion", 10.0], ["8-ovr", 10.5], ["9-transicion", 11.15], ["10-carta-final", 12.6],
  ],
  MEGA_WALKOUT: [["2-inicio-caminata", 3.6], ["4-mitad-caminata", 6.0], ["6-deteniendose", 9.4], ["7a-celebracion", 10.3], ["7b-celebracion", 11.0], ["8-ovr", 12.0], ["9-transicion", 12.9], ["10-carta-final", 14.6]],
  RARE: [["1-plataforma", 1.8], ["7a-pose", 3.5], ["8-ovr", 4.2], ["10-carta-final", 5.8]],
};

async function run() {
  const report: any[] = [];
  const widths = (process.env.WALKOUT_WIDTHS ?? "1440,390").split(",").map(Number);
  const only = process.env.WALKOUT_BEATS?.split(",");
  for (const width of widths) {
    const browser = await launch({ args: ["--mute-audio", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
    const tab = browser.tab;
    await tab.resize(width, width < 600 ? 844 : 900, 1);
    await tab.setMedia([{ name: "prefers-reduced-motion", value: "no-preference" }]);
    for (const [name, t] of (BEATS[process.env.WALKOUT_SET ?? intensity] ?? BEATS[intensity]).filter(([n]) => !only || only.some((o) => n.startsWith(o)))) {
      await tab.goto(`${BASE}/design-system/pack-walkout?fx=${fx}&i=${intensity}&t=${t}&panel=0&reduced=0${process.env.WALKOUT_CAM ? `&cam=${process.env.WALKOUT_CAM}` : ""}${process.env.WALKOUT_Q ?? ""}${name.startsWith("0-") ? "&qaNoHuman=1" : ""}`, 2500);
      let human = "";
      for (let i = 0; i < 60; i++) {
        human = await tab.js(`document.querySelector('[data-testid=walkout-stage-3d]')?.dataset.human ?? (document.querySelector('[data-testid=walkout]')?.dataset.stage ?? '')`);
        if (human === "ready" || human === "failed" || human === "2d") break;
        await sleep(250);
      }
      await sleep(700);
      const info = await tab.js(`(() => { const w = document.querySelector('[data-testid=walkout]'); const c = document.querySelector('[data-testid=walkout-stage-3d]'); return { stage: w?.dataset.stage, t: w?.dataset.t, human: c?.dataset.human ?? null, humanMs: c?.dataset.humanMs ?? null }; })()`);
      const file = `${fx}-${intensity}${process.env.WALKOUT_TAG ?? ""}-${name}-${width}${process.env.WALKOUT_CAM ? "-cam" : ""}.png`;
      await tab.shot(join(OUT, file));
      report.push({ width, name, t, ...info, file });
      console.log(width, name, JSON.stringify(info));
    }
    const errs = tab.takeErrors();
    if (errs.length) console.log("console errors:", errs.slice(0, 8));
    report.push({ width, consoleErrors: errs });
    await browser.close();
  }
  writeFileSync(join(OUT, `${fx}-${intensity}-human-report.json`), JSON.stringify(report, null, 2));
}

run().catch((e) => { console.error(e); process.exit(1); });
