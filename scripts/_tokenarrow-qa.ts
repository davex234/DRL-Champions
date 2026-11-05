/**
 * PIZARRA · FICHA SOBRE FLECHA — reproducción y QA (instrumento `_`, fuera de CI).
 *
 *   npx tsx scripts/_tokenarrow-qa.ts <credsFile> --tag=antes|despues [--save] [baseUrl]
 *
 * Dibuja una flecha en mapa libre, arrastra una ficha EXACTAMENTE sobre su inicio y comprueba:
 * clic en la ficha → ficha; arrastre de la ficha → se mueve; clic en el tramo libre → flecha;
 * quitar la flecha → funciona. Con `--save` guarda la jugada `__QA_TOKEN_ARROW__` (cuenta QA),
 * recarga, la reabre y comprueba que ficha y flecha siguen donde estaban.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep, type Tab, type Browser } from "./lib/cdp";

const CREDS = process.argv[2];
const BASE = process.argv.find((a) => a.startsWith("http")) ?? "http://127.0.0.1:3005";
const TAG = (process.argv.find((a) => a.startsWith("--tag=")) ?? "--tag=antes").slice(6);
const SAVE = process.argv.includes("--save");
if (!CREDS) { console.error("uso: _tokenarrow-qa.ts <credsFile> --tag=antes|despues [--save]"); process.exit(1); }
const OUT = join(process.cwd(), "docs/product/qa/token-arrow", TAG);
mkdirSync(OUT, { recursive: true });
const creds = JSON.parse(readFileSync(CREDS, "utf8")) as { email: string; password: string };
const NOMBRE = "__QA_TOKEN_ARROW__";

const r: Record<string, unknown> = {};
const ok = (k: string, v: boolean, extra?: unknown) => { r[k] = { ok: v, ...(extra as object ?? {}) }; console.log(`  ${v ? "PASS" : "FAIL"} · ${k}${extra ? " " + JSON.stringify(extra) : ""}`); };

async function entrar(tab: Tab) {
  await tab.goto(`${BASE}/cuenta`, 4000);
  await tab.js(`(() => { const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }; const e = document.querySelector('input[type="email"]'); if (!e) return; set(e, ${JSON.stringify(creds.email)}); set(document.querySelector('input[type="password"]'), ${JSON.stringify(creds.password)}); document.querySelector('form button[type="submit"]').click(); })()`);
  for (let i = 0; i < 160; i++) { if (await tab.js<boolean>(`/cerrar sesi/i.test(document.body.innerText)`).catch(() => false)) return true; await sleep(250); }
  return false;
}
const CLICK_TEXT = (re: string) => `(() => { const b = [...document.querySelectorAll('button')].find((x) => new RegExp(${JSON.stringify(re)}, 'i').test((x.textContent || '').trim())); if (!b) return false; b.click(); return true; })()`;

type P = { x: number; y: number };
async function press(tab: Tab, p: P) {
  await tab.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y });
  await tab.send("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button: "left", clickCount: 1 });
}
async function release(tab: Tab, p: P) { await tab.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x, y: p.y, button: "left", clickCount: 1 }); }
async function click(tab: Tab, p: P) { await press(tab, p); await release(tab, p); await sleep(350); }
async function drag(tab: Tab, a: P, b: P) {
  await press(tab, a);
  for (let i = 1; i <= 8; i++) {
    await tab.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: a.x + ((b.x - a.x) * i) / 8, y: a.y + ((b.y - a.y) * i) / 8, button: "left", buttons: 1 });
    await sleep(25);
  }
  await release(tab, b); await sleep(400);
}
/** Qué dice el panel de selección: «Jugador», «Dibujo · Flecha»… */
const seleccion = (tab: Tab) => tab.js<string>(`(() => { const t = document.body.innerText; const m = t.match(/SELECCI[ÓO]N\\s*\\n\\s*(JUGADOR|DIBUJO|UTILIDAD|NOTA)\\s*\\n\\s*([^\\n]*)/i); return m ? (m[1] + ' · ' + m[2]).trim() : '(nada)'; })()`);
const TOKEN0 = `[...document.querySelectorAll('svg g[role="button"][aria-label]')][0]`;
const centro = (tab: Tab, expr: string) => tab.js<P & { r: number }>(`(() => { const g = ${expr}; const c = (g.querySelector('circle') || g).getBoundingClientRect(); return { x: c.left + c.width / 2, y: c.top + c.height / 2, r: c.width / 2 }; })()`);
const MAPA = `document.querySelector('svg image')`;

async function main() {
  let browser: Browser | null = null;
  try {
    browser = await launch({ width: 1440, height: 900, args: ["--in-process-gpu", "--mute-audio"] });
    const tab = browser.tab;
    if (!(await entrar(tab))) { console.log("NO SE PUDO ENTRAR"); return; }
    await tab.goto(`${BASE}/entrenador/strats`, 3500);
    await tab.js(CLICK_TEXT("Nueva estrategia")); await sleep(900);
    await tab.js(`(() => { const el = document.querySelector('input[aria-label="Nombre de la estrategia"]'); const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, ${JSON.stringify(NOMBRE)}); el.dispatchEvent(new Event('input', { bubbles: true })); })()`);

    const m = await tab.js<{ x: number; y: number; w: number; h: number }>(`(() => { const b = ${MAPA}.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; })()`);
    const t0 = await centro(tab, TOKEN0);
    // La flecha, en mapa libre, por encima de las fichas de salida.
    const A: P = { x: m.x + m.w * 0.42, y: m.y + m.h * 0.55 };
    const B: P = { x: m.x + m.w * 0.62, y: m.y + m.h * 0.30 };
    await tab.js(CLICK_TEXT("^Flecha$")); await sleep(250);
    await drag(tab, A, B);
    await tab.js(CLICK_TEXT("^Seleccionar$")); await sleep(250);
    const dibujos = await tab.js<number>(`[...document.querySelectorAll('svg line[stroke="transparent"]')].length`);
    ok("flecha dibujada", dibujos >= 1, { dibujos });

    // La ficha, EXACTAMENTE sobre el inicio de la flecha.
    await drag(tab, t0, A);
    const t1 = await centro(tab, TOKEN0);
    ok("ficha colocada sobre el inicio de la flecha", Math.hypot(t1.x - A.x, t1.y - A.y) < 3, { t1: [Math.round(t1.x), Math.round(t1.y)], A: [Math.round(A.x), Math.round(A.y)], radio: Math.round(t1.r) });

    // Deselecciona pulsando fondo libre (lejos de todo).
    await click(tab, { x: m.x + m.w * 0.9, y: m.y + m.h * 0.9 });

    // 1 · clic en la ficha
    await click(tab, t1);
    const s1 = await seleccion(tab);
    ok("clic en la ficha → ficha", /^JUGADOR/i.test(s1), { seleccion: s1 });
    await tab.shot(join(OUT, "01-clic-ficha.png"));

    // 2 · arrastrar la ficha (y devolverla al inicio de la flecha)
    const D: P = { x: t1.x + 40, y: t1.y + 30 };
    await drag(tab, t1, D);
    const t2 = await centro(tab, TOKEN0);
    const movida = Math.hypot(t2.x - D.x, t2.y - D.y) < 4;
    await drag(tab, t2, A);
    const t3 = await centro(tab, TOKEN0);
    ok("arrastre de la ficha desde encima de la flecha", movida && Math.hypot(t3.x - A.x, t3.y - A.y) < 4, { movidaA: [Math.round(t2.x), Math.round(t2.y)], vuelta: [Math.round(t3.x), Math.round(t3.y)] });

    // 3 · clic en el tramo libre de la flecha
    const M: P = { x: A.x + (B.x - A.x) * 0.6, y: A.y + (B.y - A.y) * 0.6 };
    await click(tab, M);
    const s3 = await seleccion(tab);
    ok("clic en el tramo libre → flecha", /^DIBUJO · Flecha/i.test(s3), { seleccion: s3 });
    await tab.shot(join(OUT, "02-clic-tramo-flecha.png"));

    if (SAVE) {
      await tab.js(CLICK_TEXT("^Guardar( nueva)?$")); await sleep(2600);
      await tab.goto(`${BASE}/entrenador/strats`, 3500);
      await tab.js(`(() => { const d = [...document.querySelectorAll('details')].find((x) => /mis estrategias/i.test(x.textContent || '')); if (d) d.open = true; })()`); await sleep(300);
      const abierta = await tab.js<boolean>(`(() => { const row = [...document.querySelectorAll('li, div')].filter((x) => (x.textContent || '').includes(${JSON.stringify(NOMBRE)}) && [...x.querySelectorAll('button')].some((b) => /^abrir$/i.test(b.textContent.trim()))).sort((a, b) => a.textContent.length - b.textContent.length)[0]; if (!row) return false; [...row.querySelectorAll('button')].find((b) => /^abrir$/i.test(b.textContent.trim())).click(); return true; })()`);
      await sleep(1800);
      const t4 = await centro(tab, TOKEN0);
      await click(tab, t4);
      const s4 = await seleccion(tab);
      await click(tab, M);
      const s5 = await seleccion(tab);
      ok("guardar → recargar: ficha sobre el inicio y flecha intactas", abierta && Math.hypot(t4.x - A.x, t4.y - A.y) < 4 && /^JUGADOR/i.test(s4) && /^DIBUJO · Flecha/i.test(s5),
        { abierta, t4: [Math.round(t4.x), Math.round(t4.y)], fichaTrasRecarga: s4, flechaTrasRecarga: s5 });
      await tab.shot(join(OUT, "03-recargada.png"));
    }

    // 4 · editar la flecha: seleccionarla y quitarla (sin guardar)
    await click(tab, M);
    await tab.js(CLICK_TEXT("^Quitar$")); await sleep(400);
    const quedan = await tab.js<number>(`[...document.querySelectorAll('svg line[stroke="transparent"]')].length`);
    const t5 = await centro(tab, TOKEN0);
    ok("quitar la flecha seleccionada (la ficha no se toca)", quedan === dibujos - 1 && Math.hypot(t5.x - A.x, t5.y - A.y) < 4, { quedan });

    writeFileSync(join(OUT, "_qa.json"), JSON.stringify(r, null, 2));
    console.log(`listo → ${OUT}`);
  } finally {
    if (browser) await browser.close();
  }
}

void main();
