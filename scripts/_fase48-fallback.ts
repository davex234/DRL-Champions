/**
 * FASE 48 · PRUEBA DE RESPALDO EN NAVEGADOR (instrumento `_`, fuera de CI).
 *
 *   npx tsx scripts/_fase48-fallback.ts <credsFile> [baseUrl]
 *
 * Responde a una sola pregunta, y la responde en un navegador de verdad: si el manifiesto
 * DECLARA una pieza de arte que no está en el despliegue, ¿qué ve el usuario?
 *
 * La respuesta correcta es «el sigilo», no una imagen rota. El `onError` del componente es lo
 * único que separa una cosa de la otra, y es código que sólo se ejecuta en un navegador: una
 * prueba de servidor no lo toca. De ahí este instrumento.
 *
 * Deja una captura y un JSON con lo que hay en el DOM de cada retrato.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep, type Tab, type Browser } from "./lib/cdp";

const CREDS = process.argv[2];
const BASE = process.argv.find((a) => a.startsWith("http")) ?? "http://127.0.0.1:3005";
if (!CREDS) { console.error("uso: _fase48-fallback.ts <credsFile> [baseUrl]"); process.exit(1); }
const OUT = join(process.cwd(), "docs/product/qa/fase48");
mkdirSync(OUT, { recursive: true });
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

const MONTAR_CINCO = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const nueva = document.querySelector('[data-testid="new-composition"]');
  if (nueva) { nueva.click(); await sleep(700); }
  for (const id of ['veil','probe','spear','warden','echo']) {
    const b = document.querySelector('[data-testid="roster-' + id + '"]');
    if (b) { b.click(); await sleep(130); }
  }
  return true;
})()`;

/**
 * Qué hay de verdad en el DOM. `data-art` dice qué rama pintó React; `roto` comprueba el
 * estado REAL de la imagen, porque un `<img>` que falló sigue siendo un `<img>` en el árbol.
 */
const RADIOGRAFIA = `(() => {
  const fichas = [...document.querySelectorAll('[data-testid="agent-portrait"]')];
  const img = [...document.querySelectorAll('img')].filter((i) => (i.getAttribute('src') || '').includes('/agents/'));
  return {
    retratos: fichas.length,
    porAgente: fichas.map((f) => ({
      agente: f.getAttribute('data-agent'),
      variante: f.getAttribute('data-variant'),
      arte: f.getAttribute('data-art'),
      sigilo: !!f.querySelector('svg'),
      imagen: !!f.querySelector('img'),
    })),
    /* Una imagen rota se delata así: cargó, pero sin píxeles. */
    imagenesRotas: img.filter((i) => i.complete && i.naturalWidth === 0).length,
    imagenesVivas: img.filter((i) => i.complete && i.naturalWidth > 0).length,
    /* Ni un texto alternativo suelto flotando donde debería haber un dibujo. */
    altVisible: img.some((i) => i.complete && i.naturalWidth === 0 && (i.getAttribute('alt') || '') !== ''),
  };
})()`;

async function main() {
  let browser: Browser | null = null;
  try {
    browser = await launch({ width: 1440, height: 900, args: ["--in-process-gpu", "--mute-audio"] });
    const tab = browser.tab;
    if (!(await entrar(tab))) { console.log("NO SE PUDO ENTRAR"); return; }

    await tab.resize(1440, 900, 1);
    await tab.goto(`${BASE}/entrenador/composiciones`, 2800);
    await tab.js(MONTAR_CINCO);
    await sleep(1600);

    const r = await tab.js<any>(RADIOGRAFIA);
    await tab.shot(join(OUT, "fallback-1440.png"));
    writeFileSync(join(OUT, "fallback.json"), JSON.stringify(r, null, 1));

    console.log(`retratos en pantalla: ${r.retratos}`);
    for (const p of r.porAgente) {
      console.log(`  · ${String(p.agente).padEnd(10)} ${p.variante.padEnd(9)} → ${p.arte}${p.sigilo ? " (sigilo)" : ""}${p.imagen ? " (img)" : ""}`);
    }
    console.log(`imagenes rotas: ${r.imagenesRotas} · vivas: ${r.imagenesVivas} · alt suelto visible: ${r.altVisible}`);
    const e = tab.takeErrors().filter((x) => !/favicon|manifest\.json|429/i.test(x));
    console.log(`errores de consola relevantes: ${e.length}${e.length ? " → " + JSON.stringify(e.slice(0, 3)) : ""}`);
  } finally {
    if (browser) await browser.close();
  }
}

void main();
