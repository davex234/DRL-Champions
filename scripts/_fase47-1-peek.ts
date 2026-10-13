/**
 * FASE 47.1 · MIRAR LA PÁGINA POR DENTRO (instrumento `_`, fuera de CI).
 *
 *   npx tsx scripts/_fase47-1-peek.ts <credsFile> [ruta] [expresion]
 *
 * Entra con la cuenta de QA, abre una ruta y evalúa una expresión. Para cuando una aserción
 * falla y hace falta ver qué hay de verdad en el DOM en vez de adivinarlo.
 */
import { readFileSync } from "node:fs";
import { launch, sleep, type Tab, type Browser } from "./lib/cdp";

const CREDS = process.argv[2];
const RUTA = process.argv[3] ?? "/entrenador/strats";
const EXPR = process.argv[4] ?? `[...document.querySelectorAll('button')].map((b) => (b.textContent || '').trim()).slice(0, 80)`;
const BASE = process.argv.find((a) => a.startsWith("http")) ?? "http://127.0.0.1:3005";
if (!CREDS) { console.error("uso: _fase47-1-peek.ts <credsFile> [ruta] [expr]"); process.exit(1); }
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

async function main() {
  let browser: Browser | null = null;
  try {
    browser = await launch({ width: 1600, height: 950, args: ["--in-process-gpu", "--mute-audio"] });
    const tab = browser.tab;
    if (!(await entrar(tab))) { console.log("NO SE PUDO ENTRAR"); return; }
    await tab.goto(`${BASE}${RUTA}`, 3500);
    console.log(JSON.stringify(await tab.js<any>(EXPR), null, 1));
    const e = tab.takeErrors();
    if (e.length) console.log("errores:", JSON.stringify(e.slice(0, 5), null, 1));
  } finally {
    if (browser) await browser.close();
  }
}

void main();
