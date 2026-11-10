/**
 * FASE 49.1 · QA VISUAL DE /tienda/creditos (instrumento `_`, fuera de CI, SOLO LECTURA). Con credenciales,
 * entra por /cuenta (saldo real del servidor); sin ellas, economía local. No compra ni concede nada.
 *   npx tsx scripts/_f491-shots.ts <base> <anchos> <prefijo> [credsFile]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep, type Tab } from "./lib/cdp";
const BASE = process.argv[2] ?? "http://localhost:3005";
const WIDTHS = (process.argv[3] ?? "1920,1440,1024,768,390").split(",").map(Number);
const PREFIX = process.argv[4] ?? "final";
const credsFile = process.argv[5];
const OUT = join(process.cwd(), "docs/product/qa/fase49-1");
mkdirSync(OUT, { recursive: true });
async function login(tab: Tab) {
  if (!credsFile) return;
  const c = JSON.parse(readFileSync(credsFile, "utf8")) as { email: string; password: string };
  await tab.goto(`${BASE}/cuenta`, 3500);
  await tab.js(`(() => { const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
    set(document.querySelector('input[type="email"]'), ${JSON.stringify(c.email)}); set(document.querySelector('input[type="password"]'), ${JSON.stringify(c.password)});
    document.querySelector('form button[type="submit"]').click(); })()`);
  for (let i = 0; i < 60 && await tab.js<boolean>(`!!document.querySelector('input[type="password"]')`); i++) await sleep(500);
  await sleep(1500);
}
(async () => {
  const report: Record<string, unknown> = {};
  for (const W of WIDTHS) {
    const H = W <= 430 ? 844 : W <= 800 ? 1024 : W <= 1100 ? 1366 : W >= 1900 ? 1080 : 900;
    const b = await launch({ width: W, height: H, args: ["--in-process-gpu", "--mute-audio"] });
    try {
      await b.tab.setMedia([{ name: "prefers-reduced-motion", value: "no-preference" }]);
      await b.tab.resize(W, H, 1);
      await login(b.tab);
      b.tab.takeErrors();
      await b.tab.goto(`${BASE}/tienda/creditos`, 4000);
      for (let i = 0; i < 40 && !(await b.tab.js<boolean>(`!!document.querySelector('.nx-credits-card') || /Cargando/.test(document.body.innerText) === false`)); i++) await sleep(500);
      await sleep(2500);
      await b.tab.shot(join(OUT, `${PREFIX}-${W}-viewport.png`));
      report[`${W}`] = await b.tab.js(`(() => {
        const vw = window.innerWidth; const imgs = [...document.querySelectorAll('img')];
        const wide = [...document.querySelectorAll('main *')].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.right > vw + 1 || r.left < -1) && getComputedStyle(el).position !== 'fixed' && !el.closest('[aria-hidden="true"]') && !el.closest('[data-rail]'); }).map((el) => (el.id || el.className || el.tagName).toString().slice(0, 50)).slice(0, 6);
        const cards = [...document.querySelectorAll('.nx-credits-card')].map((c) => ({ label: c.getAttribute('aria-label'), img: c.querySelector('img')?.getAttribute('src'), badge: c.querySelector('.nx-credits-badge')?.textContent, cta: c.querySelector('button')?.textContent, ctaDisabled: c.querySelector('button')?.disabled }));
        return { scrollX: document.documentElement.scrollWidth - vw, overflow: wide, imgs: imgs.length, broken: imgs.filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.getAttribute('src')),
          lazy: imgs.filter((i) => i.loading === 'lazy').length, cards, saldo: document.querySelector('.nx-credits-balance')?.innerText.replace(/\s+/g,' '),
          header: document.querySelector('header')?.innerText.replace(/\s+/g,' ').slice(0, 140),
          tachados: [...document.querySelectorAll('s, del, .line-through')].length, euros: (document.body.innerText.match(/\d+,\d{2}\s*€/g) || []),
          navActive: [...document.querySelectorAll('header [aria-current="page"]')].map((a) => a.textContent.trim()) };
      })()`);
      const h = await b.tab.js<number>("Math.ceil(document.documentElement.scrollHeight)");
      await b.tab.resize(W, Math.min(h, 9000), 1); await sleep(900);
      await b.tab.shot(join(OUT, `${PREFIX}-${W}-completa.png`));
      report[`${W} errores`] = b.tab.takeErrors();
    } finally { await b.close(); }
  }
  writeFileSync(join(OUT, `${PREFIX}-report.json`), JSON.stringify(report, null, 1));
  console.log(JSON.stringify(report, null, 1).slice(0, 4000));
})();
