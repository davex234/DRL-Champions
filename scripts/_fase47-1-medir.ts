/**
 * FASE 47.1 · MEDIR EL REPARTO DEL ENTRENADOR (instrumento `_`, fuera de CI).
 *
 *   npx tsx scripts/_fase47-1-medir.ts <credsFile> [baseUrl]
 *
 * No juzga por captura: mide. Para cada ancho dice cuánto del hueco útil se lleva el mapa,
 * cuánto se pierde en franja muerta entre el tablero y el rail, y si el dibujo del mapa cabe
 * entero dentro del lienzo o se está recortando.
 *
 * Solo lee: abre, mira y escribe un JSON en el scratchpad. No toca la base de datos.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { launch, sleep, type Tab, type Browser } from "./lib/cdp";

const CREDS = process.argv[2];
const BASE = process.argv.find((a) => a.startsWith("http")) ?? "http://127.0.0.1:3005";
const OUT = process.argv.find((a) => a.startsWith("--out="))?.slice(6) ?? "medida.json";
if (!CREDS) { console.error("uso: _fase47-1-medir.ts <credsFile> [baseUrl] [--out=fichero]"); process.exit(1); }
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

const ABRIR_PRIMERA = `(() => {
  const d = [...document.querySelectorAll('details')].find((x) => /mis estrategias/i.test(x.textContent || ''));
  if (d) d.open = true;
  const b = [...document.querySelectorAll('button')].filter((x) => /^abrir$/i.test((x.textContent || '').trim()));
  if (!b.length) return false;
  b[0].click();
  return true;
})()`;

/**
 * La radiografía del reparto.
 *
 * El `<image>` del SVG es el dibujo del mapa: su rectángulo en pantalla dice si el mapa cabe
 * entero dentro del lienzo (`recorte` a cero) o se está saliendo por algún lado.
 */
const MEDIDA = `(() => {
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), bottom: Math.round(b.bottom), right: Math.round(b.right) }; };
  const lienzo = document.querySelector('[data-tactical="lienzo"]');
  const svg = lienzo ? lienzo.querySelector('svg') : null;
  const img = svg ? svg.querySelector('image') : null;
  const rail = document.querySelector('aside');
  const L = r(lienzo), I = r(img), R = r(rail);
  const recorte = (L && I) ? {
    izq: Math.max(0, L.x - I.x), der: Math.max(0, I.right - L.right),
    arriba: Math.max(0, L.y - I.y), abajo: Math.max(0, I.bottom - L.bottom),
  } : null;
  const vw = window.innerWidth, vh = window.innerHeight;
  return {
    viewport: { w: vw, h: vh },
    lienzo: L,
    dibujo: I,
    recorte,
    rail: R,
    /* Franja muerta entre el borde derecho del lienzo y el principio del rail. */
    franja: (L && R && R.x > L.right) ? R.x - L.right : 0,
    scroll: Math.max(0, document.documentElement.scrollHeight - vh),
    /* Qué porcentaje del ALTO del viewport se lleva el dibujo del mapa. */
    altoMapa: I ? Math.round((I.h / vh) * 100) : 0,
    anchoMapa: I ? Math.round((I.w / vw) * 100) : 0,
  };
})()`;

const ANCHOS: [number, number][] = [[390, 844], [768, 1024], [1024, 1366], [1440, 900], [1920, 1080], [2560, 1440]];

async function main() {
  let browser: Browser | null = null;
  const informe: Record<string, any> = {};
  try {
    browser = await launch({ width: 1440, height: 900, args: ["--in-process-gpu", "--mute-audio"] });
    const tab = browser.tab;
    if (!(await entrar(tab))) { console.log("NO SE PUDO ENTRAR"); return; }

    for (const [w, h] of ANCHOS) {
      await tab.resize(w, h);
      await tab.goto(`${BASE}/entrenador/strats`, 2600);
      await tab.js(ABRIR_PRIMERA);
      await sleep(900);
      const m = await tab.js<any>(MEDIDA);
      informe[`${w}x${h}`] = { pizarra: m };
      console.log(`${w}x${h}  mapa ${m.dibujo?.w}x${m.dibujo?.h}  alto ${m.altoMapa}%  recorte ${JSON.stringify(m.recorte)}  franja ${m.franja}  scroll ${m.scroll}`);
    }

    /* El Plan Táctico: ¿se ven los dos bandos o sólo el que tiene jugadas? */
    await tab.resize(1440, 900);
    await tab.goto(`${BASE}/entrenador/partidos`, 2600);
    const href = await tab.js<string>(`(() => { const a = [...document.querySelectorAll('a')].map((x) => x.getAttribute('href') || '').find((h) => h.includes('/entrenador/plan?match=')); return a || ''; })()`);
    if (href) {
      await tab.goto(`${BASE}${href}`, 2800);
      informe.plan = await tab.js<any>(`(() => ({
        ataque: /ataque/i.test(document.body.innerText),
        defensa: /defensa/i.test(document.body.innerText),
        alto: document.documentElement.scrollHeight,
        texto: document.body.innerText.slice(0, 900),
      }))()`);
      console.log(`plan  ataque=${informe.plan.ataque} defensa=${informe.plan.defensa}`);
    }

    writeFileSync(OUT, JSON.stringify(informe, null, 1));
    console.log(`\n→ ${OUT}`);
  } finally {
    if (browser) await browser.close();
  }
}

void main();
