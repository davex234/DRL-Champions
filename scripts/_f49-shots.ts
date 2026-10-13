/**
 * FASE 49 · QA VISUAL DE LA TIENDA 4.0 (instrumento `_`, fuera de CI). Sin sesión: la economía LOCAL
 * del navegador (no toca la BD ni ninguna cuenta). Captura la página entera y por secciones en cada
 * ancho, los modales (sobre, saldo insuficiente, caja/dinero real, carta, pack) y mide overflow,
 * imágenes rotas y errores de consola.
 *
 *   npx tsx scripts/_f49-shots.ts [base=http://127.0.0.1:3006] [anchos=1920,1440,1024,768,390] [--prefix=despues]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep, type Tab } from "./lib/cdp";

const BASE = process.argv[2]?.startsWith("http") ? process.argv[2] : "http://127.0.0.1:3006";
const WIDTHS = (process.argv.find((a) => /^\d+(,\d+)*$/.test(a)) ?? "1920,1440,1024,768,390").split(",").map(Number);
const PREFIX = process.argv.find((a) => a.startsWith("--prefix="))?.slice(9) ?? "despues";
const MODALS = !process.argv.includes("--no-modals");
const OUT = join(process.cwd(), "docs/product/qa/fase49");
mkdirSync(OUT, { recursive: true });

async function waitFor(tab: Tab, expr: string, ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await tab.js<boolean>(expr).catch(() => false)) return true; await sleep(300); }
  return false;
}
async function fullShot(tab: Tab, W: number, H: number, file: string) {
  const h = await tab.js<number>("Math.ceil(document.documentElement.scrollHeight)");
  await tab.resize(W, Math.min(h, 9000), 1);
  await sleep(900);
  await tab.shot(file);
  await tab.resize(W, H, 1);
  await sleep(400);
}
const clickSel = (tab: Tab, sel: string) => tab.js<boolean>(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.scrollIntoView({block:'center'}); el.click(); return true; })()`);
const closeModal = async (tab: Tab) => { await tab.js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`); await sleep(400); };

(async () => {
  const report: Record<string, unknown> = {};
  for (const W of WIDTHS) {
    const H = W <= 430 ? 844 : W <= 800 ? 1024 : W <= 1100 ? 1366 : W >= 1900 ? 1080 : 900;
    const b = await launch({ width: W, height: H, args: ["--in-process-gpu", "--mute-audio"] });
    try {
      await b.tab.setMedia([{ name: "prefers-reduced-motion", value: "no-preference" }]);
      await b.tab.resize(W, H, 1);
      await b.tab.goto(`${BASE}/tienda`, 3000);
      await waitFor(b.tab, `!!document.querySelector('#sobres article')`);
      await sleep(1800);
      await b.tab.shot(join(OUT, `${PREFIX}-${W}-viewport.png`));
      const metrics = await b.tab.js(`(() => {
        const vw = window.innerWidth;
        const wide = [...document.querySelectorAll('main *')].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.right > vw + 1 || r.left < -1) && getComputedStyle(el).position !== 'fixed' && !el.closest('[aria-hidden="true"]') && !el.closest('nav ul') && !el.closest('[data-rail]'); }).map((el) => (el.id || el.className || el.tagName).toString().slice(0, 60)).slice(0, 8);
        const imgs = [...document.querySelectorAll('img')];
        return {
          scrollX: document.documentElement.scrollWidth - vw,
          overflow: wide,
          imgs: imgs.length, broken: imgs.filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.getAttribute('src')),
          lazy: imgs.filter((i) => i.loading === 'lazy').length,
          cardImgs: imgs.filter((i) => (i.getAttribute('src')||'').startsWith('/cards/')).length,
          sections: ['destacado','sobres','cajas','cartas','packs'].map((id) => [id, !!document.getElementById(id)]),
          packs: document.querySelectorAll('#sobres article').length,
          boxes: document.querySelectorAll('#cajas article').length,
          cards: document.querySelectorAll('#cartas article').length,
          bundles: document.querySelectorAll('#packs article').length,
          tabs: [...document.querySelectorAll('nav[aria-label="Secciones de la tienda"] button')].map((b) => b.textContent),
          navActive: [...document.querySelectorAll('header [aria-current="page"]')].map((a) => a.textContent.trim()),
          tyl: /Sobre TYL|Sobre XLG/i.test(document.body.innerText),
          fakeTimer: /\\d{2}:\\d{2}:\\d{2}/.test(document.querySelector('#destacado')?.innerText || ''),
        };
      })()`);
      report[`${W} métricas`] = metrics;
      await fullShot(b.tab, W, H, join(OUT, `${PREFIX}-${W}-completa.png`));

      // Pestañas: CAJAS lleva a su sección.
      await b.tab.js(`window.scrollTo(0,0)`);
      await b.tab.js(`[...document.querySelectorAll('nav[aria-label="Secciones de la tienda"] button')].find((b) => /Cajas/i.test(b.textContent)).click()`);
      await sleep(1400);
      report[`${W} pestaña cajas`] = await b.tab.js(`(() => { const r = document.getElementById('cajas').getBoundingClientRect(); return { top: Math.round(r.top), activa: document.querySelector('nav[aria-label="Secciones de la tienda"] [aria-current="true"]')?.textContent }; })()`);
      if (W === 1440 || W === 390) await b.tab.shot(join(OUT, `${PREFIX}-${W}-tab-cajas.png`));

      if (MODALS && (W === 1440 || W === 390)) {
        // Sobre asequible (Estándar) → modal de compra.
        await b.tab.js(`window.scrollTo(0,0)`);
        await clickSel(b.tab, '#sobres article button[aria-label^="Comprar Sobre Est"]');
        await waitFor(b.tab, `!!document.querySelector('[data-testid="store-purchase-modal"]')`, 5000);
        await sleep(600);
        await b.tab.shot(join(OUT, `${PREFIX}-${W}-modal-sobre.png`));
        report[`${W} modal sobre`] = await b.tab.js(`(() => { const m = document.querySelector('[data-testid="store-purchase-modal"]'); return m ? { texto: m.innerText.replace(/\\s+/g,' ').slice(0, 400), foco: m.contains(document.activeElement) } : null; })()`);
        await closeModal(b.tab);
        report[`${W} modal cerrado`] = await b.tab.js(`!document.querySelector('[data-testid="store-purchase-modal"]')`);

        // Saldo insuficiente: el Sobre Icon (20.000) con el saldo local.
        await b.tab.js(`document.querySelector('button[aria-controls="lista-sobres"]').click()`);
        await sleep(500);
        await clickSel(b.tab, '#sobres article button[aria-label$="Sobre Icon"]');
        await sleep(700);
        await b.tab.shot(join(OUT, `${PREFIX}-${W}-modal-saldo-insuficiente.png`));
        report[`${W} modal icon`] = await b.tab.js(`(() => { const m = document.querySelector('[data-testid="store-purchase-modal"]'); const btn = [...(m?.querySelectorAll('button') ?? [])].find((b) => /Confirmar/.test(b.textContent)); return { alerta: m?.querySelector('[role="alert"]')?.textContent, confirmarDesactivado: btn?.disabled }; })()`);
        await closeModal(b.tab);

        // Caja (dinero real, sin pasarela).
        await clickSel(b.tab, '#cajas article button');
        await sleep(700);
        await b.tab.shot(join(OUT, `${PREFIX}-${W}-modal-caja-dinero-real.png`));
        report[`${W} modal caja`] = await b.tab.js(`(() => { const m = document.querySelector('[data-testid="store-purchase-modal"]'); return { texto: m?.innerText.replace(/\\s+/g,' ').slice(0, 400), botones: [...(m?.querySelectorAll('button') ?? [])].map((b) => [b.textContent, b.disabled]) }; })()`);
        await closeModal(b.tab);

        // Carta.
        await clickSel(b.tab, '#cartas article button[aria-label^="Comprar"]');
        await sleep(700);
        await b.tab.shot(join(OUT, `${PREFIX}-${W}-modal-carta.png`));
        report[`${W} modal carta`] = await b.tab.js(`document.querySelector('[data-testid="store-purchase-modal"]')?.innerText.replace(/\\s+/g,' ').slice(0, 300)`);
        await closeModal(b.tab);

        // Pack especial.
        await clickSel(b.tab, '#packs article button');
        await sleep(700);
        await b.tab.shot(join(OUT, `${PREFIX}-${W}-modal-pack.png`));
        await closeModal(b.tab);
      }
      report[`${W} errores consola`] = b.tab.takeErrors();
    } finally { await b.close(); }
  }
  writeFileSync(join(OUT, `${PREFIX}-report.json`), JSON.stringify(report, null, 1));
  console.log(JSON.stringify(report, null, 1));
})();
