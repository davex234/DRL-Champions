/**
 * FASE 47.1 · BARRIDO RESPONSIVE DEL ENTRENADOR (instrumento `_`, fuera de CI).
 *
 *   npx tsx scripts/_fase47-1-responsive.ts <credsFile> [baseUrl]
 *
 * Seis anchos, cuatro pantallas. Mide tres cosas por parada: si hay desbordamiento
 * horizontal, cuánto ocupa el mapa dentro del viewport y si el mapa entra entero sin
 * desplazar la página. Es lectura pura: no toca ningún dato.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { freemem } from "node:os";
import { join } from "node:path";
import { launch, sleep, type Tab, type Browser } from "./lib/cdp";

const CREDS = process.argv[2];
const BASE = process.argv.find((a) => a.startsWith("http")) ?? "http://127.0.0.1:3005";
if (!CREDS) { console.error("uso: _fase47-1-responsive.ts <credsFile> [baseUrl]"); process.exit(1); }
const OUT = join(process.cwd(), "docs/product/qa/fase47-1");
mkdirSync(OUT, { recursive: true });
const creds = JSON.parse(readFileSync(CREDS, "utf8")) as { email: string; password: string };

const ANCHOS: [number, number][] = [[390, 844], [768, 1024], [1024, 1366], [1440, 900], [1920, 1080], [2560, 1440]];

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
  const d = document.documentElement;
  const lienzo = document.querySelector('[data-tactical="lienzo"]');
  const r = lienzo ? lienzo.getBoundingClientRect() : null;
  return {
    desborde: d.scrollWidth - d.clientWidth,
    scrollPagina: Math.max(0, d.scrollHeight - innerHeight),
    mapa: r ? { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), bottom: Math.round(r.bottom) } : null,
    /* Cuanto del viewport ocupa el mapa. Es la cifra de «el mapa domina». */
    porcentaje: r ? Math.round((r.width * r.height * 100) / (innerWidth * innerHeight)) : 0,
    /* Si el mapa cabe entero sin desplazar la pagina. */
    entero: r ? r.bottom <= innerHeight + 1 : false,
  };
})()`;

async function main() {
  if (freemem() / 1048576 < 800) { console.log("PARADA: RAM"); return; }
  let browser: Browser | null = null;
  const informe: Record<string, any> = {};
  try {
    browser = await launch({ width: 1440, height: 900, args: ["--in-process-gpu", "--mute-audio"] });
    const tab = browser.tab;
    if (!(await entrar(tab))) { console.log("NO SE PUDO ENTRAR"); return; }

    for (const [w, h] of ANCHOS) {
      await tab.resize(w, h, 1);
      const fila: Record<string, any> = {};

      /* Pizarra con una jugada abierta. */
      await tab.goto(`${BASE}/entrenador/strats`, 2800);
      await tab.js(`(() => {
        const d = [...document.querySelectorAll('details')].find((x) => /mis estrategias/i.test(x.textContent || ''));
        if (d) d.open = true;
        const b = [...document.querySelectorAll('button')].filter((x) => /^abrir$/i.test((x.textContent || '').trim()));
        if (b.length) b[0].click();
      })()`);
      await sleep(1500);
      fila.pizarra = await tab.js<any>(MEDIR);

      /* Teatro sobre esa misma jugada. */
      await tab.js(`(() => { const b = document.querySelector('[data-testid="open-theater"]'); if (b) b.click(); })()`);
      await sleep(1600);
      fila.teatro = await tab.js<any>(`(() => {
        const t = document.querySelector('[data-testid="tactical-theater"]');
        const lienzos = [...document.querySelectorAll('[data-tactical="lienzo"]')];
        const l = lienzos[lienzos.length - 1];
        const r = l ? l.getBoundingClientRect() : null;
        return {
          abierto: !!t,
          fichas: l ? l.querySelectorAll('g[role="button"]').length : 0,
          mapa: r ? { w: Math.round(r.width), h: Math.round(r.height) } : null,
          porcentaje: r ? Math.round((r.width * r.height * 100) / (innerWidth * innerHeight)) : 0,
        };
      })()`);

      /* Composiciones y plan. */
      await tab.goto(`${BASE}/entrenador/composiciones`, 2600);
      fila.composiciones = await tab.js<any>(MEDIR);
      await tab.goto(`${BASE}/entrenador`, 2400);
      fila.hub = await tab.js<any>(MEDIR);

      informe[`${w}x${h}`] = fila;
      console.log(
        `${String(w).padStart(4)} · pizarra ${fila.pizarra.mapa?.w}x${fila.pizarra.mapa?.h} (${fila.pizarra.porcentaje}% del viewport, entero: ${fila.pizarra.entero})` +
        ` · teatro ${fila.teatro.mapa?.w}x${fila.teatro.mapa?.h} (${fila.teatro.porcentaje}%, ${fila.teatro.fichas} fichas)` +
        ` · desbordes: ${fila.pizarra.desborde}/${fila.composiciones.desborde}/${fila.hub.desborde}`,
      );
    }
    writeFileSync(join(OUT, "responsive.json"), JSON.stringify(informe, null, 2));
    console.log(`\nlisto → ${join(OUT, "responsive.json")}`);
  } finally {
    if (browser) await browser.close();
  }
}

void main();
