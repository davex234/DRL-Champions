/**
 * FASE 44.1 · REPRODUCCIÓN DE LA RUEDA (instrumento `_`, fuera de CI, SOLO LECTURA)
 *
 *   npx tsx scripts/_fase44-1-wheel.ts <credsFile> [baseUrl] [--paths=/,/coleccion]
 *
 * Rueda REAL por CDP (`Input.dispatchMouseEvent` tipo `mouseWheel`, como el ratón del sistema) en el centro de la
 * pantalla, y teclado real (PageDown/PageUp/End/Home/Espacio). Por paso: scrollY del documento, qué elemento se ha
 * desplazado de verdad (documento, body u otro contenedor), overflow calculado de html/body y el estilo en línea del body.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep, type Tab } from "./lib/cdp";

/* eslint-disable @typescript-eslint/no-explicit-any */
const CREDS = process.argv[2];
const BASE = process.argv.find((a) => a.startsWith("http")) ?? "http://127.0.0.1:3005";
const pathsArg = process.argv.find((a) => a.startsWith("--paths="));
const PATHS = pathsArg ? pathsArg.slice(8).split(",") : ["/", "/coleccion", "/tienda", "/inventario", "/duelos/mazos", "/jugar/road-to-champions", "/temporada", "/jugador/me", "/jugar", "/duelos/competitivo", "/logros"];
const OUT = process.env.F441_OUT ?? join(process.cwd(), "docs/product/qa/fase44-1/wheel.json");

const STATE = `(() => {
  const se = document.scrollingElement;
  const scrolled = [...document.querySelectorAll('*')].filter((el) => el.scrollTop > 0).slice(0, 4).map((el) => (el.id ? '#' + el.id : el.tagName.toLowerCase()) + '.' + String(el.className || '').split(' ')[0] + ':' + el.scrollTop);
  const cs = (el) => { const c = getComputedStyle(el); return c.overflowX + '/' + c.overflowY; };
  return { y: Math.round(window.scrollY), se: se ? se.tagName : null, seTop: se ? Math.round(se.scrollTop) : null, bodyTop: Math.round(document.body.scrollTop), max: Math.round((se?.scrollHeight ?? 0) - window.innerHeight), html: cs(document.documentElement), body: cs(document.body), bodyInline: document.body.getAttribute('style') || '', scrolled };
})()`;

async function wheel(tab: Tab, dy: number) {
  await tab.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 720, y: 500 });
  for (let i = 0; i < 3; i++) { await tab.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: 720, y: 500, deltaX: 0, deltaY: dy }); await sleep(120); }
  await sleep(700);
}
async function key(tab: Tab, k: string, code: number) {
  await tab.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: k, code: k, windowsVirtualKeyCode: code });
  await tab.send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code: k, windowsVirtualKeyCode: code });
  await sleep(700);
}

async function main() {
  const creds = CREDS && existsSync(CREDS) ? JSON.parse(readFileSync(CREDS, "utf8")) : null;
  const b = await launch({ width: 1440, height: 900, userDataDir: CREDS ? join(CREDS, "..", "f441-wheel-profile") : undefined });
  const tab = b.tab;
  const rows: any[] = [];
  try {
    if (creds) {
      await tab.goto(`${BASE}/cuenta`, 4000);
      if (await tab.js<boolean>(`!!document.querySelector('input[type="password"]')`)) {
        await tab.js(`(() => { const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }; set(document.querySelector('input[type="email"]'), ${JSON.stringify(creds.email)}); set(document.querySelector('input[type="password"]'), ${JSON.stringify(creds.password)}); document.querySelector('form button[type="submit"]').click(); })()`);
        for (let i = 0; i < 60; i++) { if (await tab.js<boolean>(`/cerrar sesión/i.test(document.body.innerText)`).catch(() => false)) break; await sleep(500); }
      }
    }
    for (const p of PATHS) {
      await tab.goto(`${BASE}${p}`, 6000);
      const inject = process.env.F441_INJECT;
      if (inject) await tab.js(`(() => { const s = document.createElement('style'); s.textContent = ${JSON.stringify(inject)}; document.head.appendChild(s); })()`);
      const s0 = await tab.js<any>(STATE);
      await wheel(tab, 360); const down = await tab.js<any>(STATE);
      await wheel(tab, -360); const up = await tab.js<any>(STATE);
      await key(tab, "PageDown", 34); const pgDown = await tab.js<any>(STATE);
      await key(tab, "End", 35); const end = await tab.js<any>(STATE);
      await key(tab, "PageUp", 33); const pgUp = await tab.js<any>(STATE);
      await key(tab, "Home", 36); const home = await tab.js<any>(STATE);
      const row = { path: p, max: s0.max, start: s0, wheelDown: down.y - s0.y, wheelUp: up.y - down.y, pageDown: pgDown.y - home.y + (home.y - 0), end: end.y, pageUp: end.y - pgUp.y, home: home.y, afterDown: down, scrollable: s0.max > 10 };
      rows.push(row);
      console.log(`${p}: max ${s0.max} · rueda ↓ ${row.wheelDown} ↑ ${row.wheelUp} · End ${end.y} · PageUp −${row.pageUp} · Home ${home.y} · html ${s0.html} body ${s0.body} inline «${s0.bodyInline}» · desplazado ${JSON.stringify(down.scrolled)}`);
    }
  } finally {
    await b.close();
  }
  writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), base: BASE, rows }, null, 2) + "\n");
}
void main();
