/**
 * FASE 47.1 · SONDA (instrumento `_`, fuera de CI).
 *
 *   npx tsx scripts/_fase47-1-probe.ts <credsFile> [baseUrl]
 *
 * Mide lo que una captura no dice: cuánto ocupa el mapa, cuántas fichas hay en el DOM y qué
 * geometría tiene cada capa. Es lectura pura.
 */
import { readFileSync } from "node:fs";
import { launch, sleep, type Tab, type Browser } from "./lib/cdp";

const CREDS = process.argv[2];
const BASE = process.argv.find((a) => a.startsWith("http")) ?? "http://127.0.0.1:3005";
if (!CREDS) { console.error("uso: _fase47-1-probe.ts <credsFile> [baseUrl]"); process.exit(1); }
const creds = JSON.parse(readFileSync(CREDS, "utf8")) as { email: string; password: string };

/* eslint-disable @typescript-eslint/no-explicit-any */
async function entrar(tab: Tab) {
  await tab.goto(`${BASE}/cuenta`, 4000);
  if (await tab.js<boolean>(`!!document.querySelector('input[type="password"]')`)) {
    await tab.js(`(() => { const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }; set(document.querySelector('input[type="email"]'), ${JSON.stringify(creds.email)}); set(document.querySelector('input[type="password"]'), ${JSON.stringify(creds.password)}); document.querySelector('form button[type="submit"]').click(); })()`);
  }
  for (let i = 0; i < 180; i++) {
    if (await tab.js<boolean>(`/cerrar sesi/i.test(document.body.innerText)`).catch(() => false)) return true;
    await sleep(250);
  }
  return false;
}

const MEDIR = `(() => {
  const vw = innerWidth, vh = innerHeight;
  const lienzos = [...document.querySelectorAll('[data-tactical="lienzo"]')].map((el) => {
    const r = el.getBoundingClientRect();
    const svg = el.querySelector('svg');
    const img = svg && svg.querySelector('image');
    let dib = null;
    if (img) { const b = img.getBoundingClientRect(); dib = { w: Math.round(b.width), h: Math.round(b.height), x: Math.round(b.x), y: Math.round(b.y) }; }
    return {
      caja: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      mapaDibujado: dib,
      hijosSvg: svg ? [...svg.children].map((c) => c.tagName + (c.childElementCount ? ':' + c.childElementCount : '')) : [],
      divsDentroDelSvg: svg ? svg.querySelectorAll('div').length : 0,
      fichas: svg ? svg.querySelectorAll('g[role="button"]').length : 0,
      textos: svg ? svg.querySelectorAll('text').length : 0,
    };
  });
  return {
    viewport: { vw, vh },
    scrollY: Math.round(document.documentElement.scrollHeight - vh),
    lienzos,
  };
})()`;

async function main() {
  let browser: Browser | null = null;
  try {
    browser = await launch({ width: 1440, height: 900, args: ["--in-process-gpu", "--mute-audio"] });
    const tab = browser.tab;
    if (!(await entrar(tab))) { console.log("NO SE PUDO ENTRAR"); return; }

    for (const [w, h] of [[1440, 900], [1920, 1080], [768, 1024]] as const) {
      await tab.resize(w, h, 1);
      await tab.goto(`${BASE}/entrenador/strats`, 3000);
      await tab.js(`(() => {
        const d = [...document.querySelectorAll('details')].find((x) => /mis estrategias/i.test(x.textContent || ''));
        if (d) d.open = true;
        const b = [...document.querySelectorAll('button')].filter((x) => /^abrir$/i.test((x.textContent || '').trim()));
        if (b.length) b[0].click();
      })()`);
      await sleep(1600);
      console.log(`\n── PIZARRA ${w}x${h} ──`);
      console.log(JSON.stringify(await tab.js<any>(MEDIR), null, 1));
      console.log("estado del paso:", JSON.stringify(await tab.js<any>(`(() => {
        const t = document.body.innerText;
        const m = t.match(/JUGADORES\\s*·\\s*(\\d)\\/(\\d)/i);
        return { rail: m ? m[0] : null, objetos: (t.match(/(\\d+) objetos?/i) || [])[0] || null };
      })()`)));

      await tab.js(`(() => { const b = document.querySelector('[data-testid="open-theater"]'); if (b) b.click(); })()`);
      await sleep(1800);
      console.log(`── TEATRO ${w}x${h} ──`);
      console.log(JSON.stringify(await tab.js<any>(MEDIR), null, 1));
    }
  } finally {
    if (browser) await browser.close();
  }
}

void main();
