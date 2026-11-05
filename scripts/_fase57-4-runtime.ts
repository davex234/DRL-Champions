/**
 * FASE 57.4 · evidencia de RUNTIME (fuera de CI). SIN sesión, SIN comprar ni abrir: visita /packs, las fichas de la línea
 * principal y /tienda en la app de :3005 (1440 y 390), lee precio, cartas, tabla y arte, busca precios antiguos y captura.
 *
 *   npx tsx scripts/_fase57-4-runtime.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep } from "./lib/cdp";

const BASE = "http://127.0.0.1:3005";
const OUT = join(process.cwd(), "docs", "product", "qa", "fase57-4-pack-economy");
mkdirSync(OUT, { recursive: true });
const LINE = ["estandar", "premium", "oro", "masters", "champions", "icon"];

const FICHA = `(() => {
  const odds = document.querySelector('section[aria-label="Probabilidades del sobre"]');
  const t = (el) => el?.textContent?.replace(/\\s+/g, ' ').trim() ?? '';
  const readouts = [...document.querySelectorAll('*')].filter((e) => e.children.length < 6 && /^(Precio|Contiene)/.test(t(e))).map(t).slice(0, 4);
  return {
    title: t(document.querySelector('h1')),
    readouts,
    classRows: [...(odds?.querySelectorAll('li[data-class]') ?? [])].map((li) => li.getAttribute('data-class') + ' ' + (t(li).match(/(\\d+(?:,\\d+)?) %/) ?? [])[1]),
    header: t(odds?.querySelector('div')),
    guarantee: t(odds?.querySelector('[data-class-guarantee]')) || null,
    art: [...document.querySelectorAll('img')].map((i) => i.getAttribute('src')).filter((s) => s && s.includes('/packs/')),
  };
})()`;

const PAGE = `(() => ({ text: document.body.innerText.replace(/\\s+/g, ' ') }))()`;

(async () => {
  const browser = await launch({ args: ["--in-process-gpu", "--mute-audio", "--hide-scrollbars"] });
  const t = browser.tab;
  const out: Record<string, unknown> = {};
  try {
    for (const [w, h] of [[1440, 1000], [390, 844]] as const) {
      await t.resize(w, h, 1);
      for (const id of LINE) {
        await t.goto(`${BASE}/packs/${id}`, 6000);
        for (let i = 0; i < 20; i++) { if (await t.js<boolean>(`!!document.querySelector('section[aria-label="Probabilidades del sobre"]')`)) break; await sleep(500); }
        const r = await t.js(FICHA);
        out[`ficha:${id}@${w}`] = r;
        console.log(w, id, JSON.stringify(r));
        await t.shot(join(OUT, `ficha-${id}-${w}.png`));
      }
      for (const path of ["/packs", "/tienda"]) {
        await t.goto(`${BASE}${path}`, 6000);
        await sleep(3500);
        const r = await t.js<{ text: string }>(PAGE);
        const prices = ["1.000", "2.500", "4.000", "5.000", "8.000", "12.500"].filter((p) => r.text.includes(p));
        const old = ["20.000", " 750 ", "750 créditos"].filter((p) => r.text.includes(p));
        out[`${path}@${w}`] = { pricesSeen: prices, oldPricesSeen: old, excerpt: r.text.slice(0, 1500) };
        console.log(w, path, "precios vistos:", prices.join(" "), "· antiguos:", old.join(" ") || "ninguno");
        await t.shot(join(OUT, `${path.slice(1)}-${w}.png`));
      }
    }
  } finally {
    writeFileSync(join(OUT, "runtime.json"), JSON.stringify(out, null, 2));
    await browser.close();
  }
})();
