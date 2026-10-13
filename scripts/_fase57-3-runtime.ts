/**
 * FASE 57.3 · evidencia de RUNTIME (fuera de CI). SIN sesión y SIN comprar ni abrir nada: visita las fichas `/packs/<id>`
 * de la app de :3005 (línea principal + especiales de control) y el arnés `/design-system/fase57` del Sobre Icon (una carta),
 * lee lo que ve el jugador y hace capturas.
 *
 *   npx tsx scripts/_fase57-3-runtime.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep } from "./lib/cdp";

const BASE = "http://127.0.0.1:3005";
const OUT = join(process.cwd(), "docs", "product", "qa", "fase57-3-pack-class");
mkdirSync(OUT, { recursive: true });

const READ = `(() => {
  const odds = document.querySelector('section[aria-label="Probabilidades del sobre"]');
  const text = (el) => el?.textContent?.replace(/\\s+/g, ' ').trim() ?? null;
  return {
    title: text(document.querySelector('h1')),
    body: text(document.querySelector('main') ?? document.body).slice(0, 4000),
    drawMode: odds?.getAttribute('data-draw-mode') ?? 'rarity-weights',
    guarantee: text(odds?.querySelector('[data-class-guarantee]')),
    classRows: [...(odds?.querySelectorAll('li[data-class]') ?? [])].map((li) => li.getAttribute('data-class') + ' | ' + text(li)),
    rows: [...(odds?.querySelectorAll('li') ?? [])].map((li) => text(li)),
    header: text(odds?.querySelector('div')),
  };
})()`;

const SCENE = `(() => ({
  scene: document.querySelector('[data-scene]')?.getAttribute('data-scene') ?? null,
  cardBacks: document.querySelectorAll('[data-card-back]').length,
  revealAll: !!document.querySelector('[data-testid="pack-reveal-all"]'),
  text: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 600),
}))()`;

(async () => {
  const browser = await launch({ args: ["--in-process-gpu", "--mute-audio", "--hide-scrollbars"] });
  const t = browser.tab;
  const out: Record<string, unknown> = {};
  try {
    for (const [w, h] of [[1440, 1000], [390, 844]] as const) {
      await t.resize(w, h, 1);
      const ids = w === 1440
        ? ["estandar", "premium", "oro", "masters", "champions", "icon", "ewc", "emea", "china", "team-heretics", "team-fnatic", "inicial"]
        : ["icon"];
      for (const id of ids) {
        await t.goto(`${BASE}/packs/${id}`, 6000);
        for (let i = 0; i < 20; i++) { if (await t.js<boolean>(`!!document.querySelector('section[aria-label="Probabilidades del sobre"]')`)) break; await sleep(500); }
        const r = await t.js(READ);
        out[`${id}@${w}`] = r;
        console.log(id, w, JSON.stringify({ ...(r as Record<string, unknown>), body: undefined }));
        await t.shot(join(OUT, `ficha-${id}-${w}.png`));
      }
      for (const scene of ["01-sealed", "04-emerging", "05-face-down", "06a-idle", "09-reveal-max", "10-summary"]) {
        await t.goto(`${BASE}/design-system/fase57?scene=${scene}`, 6000);
        await sleep(2500);
        const r = await t.js(SCENE);
        out[`scene:${scene}@${w}`] = r;
        console.log(scene, w, JSON.stringify(r));
        await t.shot(join(OUT, `icon-${scene}-${w}.png`));
      }
    }
  } finally {
    writeFileSync(join(OUT, "runtime.json"), JSON.stringify(out, null, 2));
    await browser.close();
  }
})();
