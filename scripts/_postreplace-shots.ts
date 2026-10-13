/**
 * POST-REEMPLAZO · QA VISUAL REAL (instrumento `_`, fuera de CI). Derivado de `_catalog-replace-shots.ts`.
 *
 *   npx tsx scripts/_catalog-replace-shots.ts <credsFile> [--widths=1440,768,390] [--no-open]
 *
 * Recorre la app REAL (`npm run start` en :3005, BD por túnel) con la cuenta QA: inicia sesión por el formulario de
 * /cuenta, compra y abre un sobre por ancho con la ceremonia real (`/abrir/[packId]`), y captura Colección, Detalle de
 * carta (poseída y no poseída) y la apertura (sellado, revelación, resumen) en cada ancho. ESCRIBE en la cuenta QA:
 * cada apertura crea ejemplares del catálogo nuevo (es la prueba de apertura). No toca ninguna otra cuenta.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep, type Tab } from "./lib/cdp";

const credsFile = process.argv[2];
if (!credsFile) { console.error("uso: _catalog-replace-shots.ts <credsFile> [--widths=…]"); process.exit(1); }
const creds = JSON.parse(readFileSync(credsFile, "utf8")) as { email: string; password: string };
const WIDTHS = (process.argv.find((a) => a.startsWith("--widths="))?.slice(9) ?? "1440,768,390").split(",").map(Number);
const OPEN = !process.argv.includes("--no-open");
const BASE = "http://127.0.0.1:3005";
const OUT = join(process.cwd(), "docs/product/qa/catalog-post-replace");
mkdirSync(OUT, { recursive: true });
const esc = (s: string) => JSON.stringify(s);
const log: unknown[] = [];
const note = (paso: string, detalle: unknown = "") => { log.push({ paso, detalle, at: new Date().toISOString() }); console.log(`· ${paso} ${typeof detalle === "string" ? detalle : JSON.stringify(detalle)}`); };

async function waitFor(tab: Tab, expr: string, ms = 20000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await tab.js<boolean>(expr).catch(() => false)) return true; await sleep(300); }
  return false;
}
const heightFor = (w: number) => (w <= 430 ? 844 : w <= 800 ? 1024 : 900);

async function login(tab: Tab) {
  await tab.goto(`${BASE}/cuenta`, 3500);
  const filled = await tab.js<boolean>(`(() => {
    const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
    const e = document.querySelector('input[type="email"]'); const p = document.querySelector('input[type="password"]');
    if (!e || !p) return false; set(e, ${esc(creds.email)}); set(p, ${esc(creds.password)}); return true; })()`);
  if (filled) {
    await tab.js(`document.querySelector('form button[type="submit"]').click()`);
    await waitFor(tab, `!document.querySelector('input[type="password"]')`, 20000);
    await sleep(1500);
  }
  note("login", { formulario: filled });
}

/** Compra por la API pública con la sesión del navegador (el mismo token que usa la app). */
async function buy(tab: Tab, packId: string): Promise<unknown> {
  return tab.js(`(async () => {
    const k = Object.keys(localStorage).find((x) => /-auth-token$/.test(x));
    const tok = k ? JSON.parse(localStorage.getItem(k)).access_token : null;
    const r = await fetch('/api/game/packs', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok },
      body: JSON.stringify({ action: 'buy', packId: ${esc(packId)}, ref: 'qa-catalog-' + ${esc(packId)} + '-' + Date.now() }) });
    return { status: r.status, body: (await r.text()).slice(0, 300) };
  })()`);
}

async function openCeremony(tab: Tab, w: number, packId: string) {
  const bought = await buy(tab, packId);
  note(`compra ${packId} @${w}`, bought);
  await tab.goto(`${BASE}/abrir/${packId}`, 4000);
  const ready = await waitFor(tab, `!!document.querySelector('[data-testid="pack-open"]')`, 25000);
  await tab.shot(join(OUT, `apertura-1-sellado-${w}.png`));
  if (!ready) { note(`sin botón de abrir @${w}`, await tab.js(`document.body.innerText.slice(0, 300)`)); return; }
  await tab.js(`document.querySelector('[data-testid="pack-open"]').click()`);
  await waitFor(tab, `!!document.querySelector('[data-testid="reveal-card"], [data-testid="pack-hand"], [data-testid="pack-reveal"]')`, 25000);
  await sleep(2600);
  await tab.shot(join(OUT, `apertura-2-revelacion-${w}.png`));
  const all = await tab.js<boolean>(`(() => { const b = document.querySelector('[data-testid="pack-reveal-all"]'); if (b) { b.click(); return true; } return false; })()`);
  // Si no hay «revelar todo», se avanza carta a carta con el botón de siguiente del revelado.
  for (let i = 0; i < 8 && !(await tab.js<boolean>(`!!document.querySelector('[data-testid="pack-summary"]')`)); i++) {
    await tab.js(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /siguiente|continuar|ver resumen|revelar/i.test(x.textContent || '')); if (b) b.click(); })()`);
    await sleep(1800);
  }
  await waitFor(tab, `!!document.querySelector('[data-testid="pack-summary"]')`, 20000);
  await sleep(1500);
  await tab.shot(join(OUT, `apertura-3-resumen-${w}.png`));
  const cartas = await tab.js<string[]>(`[...document.querySelectorAll('[data-testid="summary-card"]')].map((x) => x.getAttribute('data-card-id') || x.textContent.trim().slice(0, 40))`);
  note(`resumen @${w}`, { revelarTodo: all, cartas, errores: tab.takeErrors() });
}

async function main() {
  const browser = await launch({ width: 1440, height: 900, args: ["--in-process-gpu", "--mute-audio"] });
  const tab = browser.tab;
  try {
    await tab.resize(1440, 900, 1);
    await tab.setMedia([{ name: "prefers-reduced-motion", value: "no-preference" }]);
    await login(tab);
    let first = true;
    for (const w of WIDTHS) {
      await tab.resize(w, heightFor(w), 1);
      // UN solo sobre (el Masters, cuyo pool cambió), en el primer ancho.
      if (OPEN && first) await openCeremony(tab, w, process.argv.find((a) => a.startsWith("--pack="))?.slice(7) ?? "masters");
      first = false;
      const vistas: [string, string][] = [
        ["coleccion", "/coleccion"],
        ["coleccion-edicion-masters-l", "/coleccion?edicion=masters-l"],
        ["coleccion-equipo-heretics", "/coleccion?equipo=team-heretics"],
        ["detalle-derke-vit", "/coleccion/carta/derke__base"],
        ["detalle-kru", "/coleccion/carta/dantedeu5__base"],
      ];
      for (const [nombre, ruta] of vistas) {
        await tab.goto(`${BASE}${ruta}`, 5000);
        await waitFor(tab, `document.querySelectorAll('img[src*="/cards/"]').length > 0`, 25000);
        await sleep(1500);
        if (nombre === "coleccion") await tab.js(`(() => { const el = [...document.querySelectorAll('button, summary')].find((x) => /filtr/i.test(x.textContent || '')); el?.click(); })()`);
        await sleep(600);
        await tab.shot(join(OUT, `${nombre}-${w}.png`));
        const d = await tab.js<unknown>(`(() => { const t = document.body.innerText; const im = [...document.querySelectorAll('img[src*="/cards/"]')];
          return { imgs: im.length, rotas: im.filter((i) => i.complete && i.naturalWidth === 0).length, mojibake: /Ã|Â/.test(t),
            fantasma: ['Regional','Ganadores','Exclusivas','Internacional','MVP'].filter((x) => new RegExp('\b' + x + '\b').test(t)),
            ediciones: ['Base','Masters L','Masters SDC','Future Star','Champions S','Record Breaker','Moments'].filter((x) => t.includes(x)),
            vitality: /Team Vitality/i.test(t), kru: /KRÜ/.test(t), overflowX: document.documentElement.scrollWidth > innerWidth + 1 }; })()`);
        note(`${nombre} @${w}`, { d, errores: tab.takeErrors() });
      }
    }
  } finally {
    writeFileSync(join(OUT, "shots-log.json"), JSON.stringify(log, null, 2));
    await browser.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
