/**
 * HOTFIX 57.2 · evidencia de RUNTIME de la ficha de sobre (fuera de CI). SIN sesión y SIN comprar ni abrir nada: solo
 * visita /packs/<id> en la app de :3005 y lee lo que ve el jugador en «Qué puede salir» (techo, descripción, rarezas
 * imposibles), con captura. Bronce/Plata/Oro/Icon y dos especiales de control.
 *
 *   npx tsx scripts/_fase57-2-runtime.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep } from "./lib/cdp";

const BASE = "http://127.0.0.1:3005";
const OUT = join(process.cwd(), "docs", "product", "qa", "fase57-2-pack-power");
mkdirSync(OUT, { recursive: true });

const READ = `(() => {
  const odds = document.querySelector('section[aria-label="Probabilidades del sobre"]');
  const cap = odds?.querySelector('[data-power-cap]');
  return {
    url: location.pathname,
    title: document.querySelector('h1')?.textContent?.trim() ?? null,
    description: document.querySelector('h1')?.nextElementSibling?.textContent?.trim() ?? null,
    capAttr: cap?.getAttribute('data-power-cap') ?? null,
    capText: cap?.textContent?.trim() ?? null,
    impossible: [...(odds?.querySelectorAll('p') ?? [])].map((p) => p.textContent.trim()).find((t) => t.startsWith('No contiene')) ?? null,
    rows: [...(odds?.querySelectorAll('li') ?? [])].map((li) => li.textContent.replace(/\\s+/g, ' ').trim()),
  };
})()`;

(async () => {
  const browser = await launch({ args: ["--in-process-gpu", "--mute-audio", "--hide-scrollbars"] });
  const t = browser.tab;
  const out: unknown[] = [];
  try {
    await t.resize(1440, 1000, 1);
    for (const id of ["estandar", "premium", "oro", "icon", "team-heretics", "masters"]) {
      await t.goto(`${BASE}/packs/${id}`, 6000);
      for (let i = 0; i < 20; i++) { if (await t.js<boolean>(`!!document.querySelector('section[aria-label="Probabilidades del sobre"]')`)) break; await sleep(500); }
      const r = await t.js(READ);
      out.push({ id, ...(r as object) });
      console.log(JSON.stringify({ id, ...(r as object) }));
      await t.shot(join(OUT, `ficha-${id}.png`));
    }
  } finally {
    writeFileSync(join(OUT, "runtime.json"), JSON.stringify(out, null, 2));
    await browser.close();
  }
})();
