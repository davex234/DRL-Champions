/**
 * FASE 48B · QA DEL GOLDEN SAMPLE DE VEIL (instrumento `_`, fuera de CI).
 *
 *   npx tsx scripts/_fase48b-veil-qa.ts <credsFile> [baseUrl]
 *
 * Complementa a `_fase48-shots.ts` (que hace las capturas antes/después) con lo que una foto no
 * dice: en cada superficie y a cada ancho, QUÉ pinta cada `AgentPortrait` (arte o sigilo), si
 * la imagen de Veil ha cargado de verdad (naturalWidth), si algo se sale del viewport, y si el
 * tablero sigue sin caras. Además pinta el avatar y el retrato REALES a 20/32/48/56/96 px y a
 * tamaño grande sobre el fondo de la casa para juzgar la legibilidad.
 *
 * No escribe nada en la base de datos: abre, mira, mide y fotografía.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { freemem } from "node:os";
import { join } from "node:path";
import { launch, sleep, type Tab, type Browser } from "./lib/cdp";

const CREDS = process.argv[2];
const BASE = process.argv.find((a) => a.startsWith("http")) ?? "http://127.0.0.1:3005";
if (!CREDS) { console.error("uso: _fase48b-veil-qa.ts <credsFile> [baseUrl]"); process.exit(1); }
/* `--out=` para no pisar la evidencia de una fase anterior (F48C lo usa con fase48c/qa). */
const OUT = join(process.cwd(), (process.argv.find((a) => a.startsWith("--out=")) ?? "--out=docs/product/qa/fase48b/qa").slice(6));
mkdirSync(OUT, { recursive: true });
const creds = JSON.parse(readFileSync(CREDS, "utf8")) as { email: string; password: string };
const freeMb = () => Math.round(freemem() / 1048576);

/* eslint-disable @typescript-eslint/no-explicit-any */
const informe: Record<string, any> = {};

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

/** Radiografía de los retratos visibles: qué pinta cada uno y si cabe en pantalla. */
const MEDIR = `(async () => {
  const imgs = [...document.querySelectorAll('[data-testid="agent-portrait"] img')];
  await Promise.all(imgs.map((i) => i.complete ? null : new Promise((r) => { i.onload = r; i.onerror = r; setTimeout(r, 4000); })));
  const vw = window.innerWidth;
  const retratos = [...document.querySelectorAll('[data-testid="agent-portrait"]')].map((el) => {
    const r = el.getBoundingClientRect();
    const img = el.querySelector('img');
    return {
      agent: el.getAttribute('data-agent'), variant: el.getAttribute('data-variant'), art: el.getAttribute('data-art'),
      w: Math.round(r.width), h: Math.round(r.height),
      fuera: r.width > 0 && (r.left < -1 || r.right > vw + 1),
      img: img ? { src: img.getAttribute('src'), ok: img.complete && img.naturalWidth > 0, natural: img.naturalWidth + 'x' + img.naturalHeight } : null,
    };
  });
  const rotas = [...document.images].filter((i) => i.complete && i.naturalWidth === 0 && /\\/agents\\//.test(i.src)).length;
  const svgs = [...document.querySelectorAll('svg')].map((s) => ({ s, a: s.getBoundingClientRect().width * s.getBoundingClientRect().height })).sort((x, y) => y.a - x.a);
  const mapa = svgs[0] && svgs[0].a > 90000 ? svgs[0].s : null;
  return {
    vw, scrollX: document.documentElement.scrollWidth > vw + 1,
    retratos, rotas,
    veil: retratos.filter((p) => p.agent === 'veil'),
    otrosConImagen: retratos.filter((p) => p.agent !== 'veil' && p.art === 'image').length,
    mapaConCaras: mapa ? mapa.querySelectorAll('img, image[href*="/agents/"], [data-testid="agent-portrait"]').length : null,
  };
})()`;

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

const ABRIR_PRIMERA = `(() => {
  const d = [...document.querySelectorAll('details')].find((x) => /mis estrategias/i.test(x.textContent || ''));
  if (d) d.open = true;
  const b = [...document.querySelectorAll('button')].filter((x) => /^abrir$/i.test((x.textContent || '').trim()));
  if (!b.length) return false;
  b[0].click();
  return true;
})()`;

/** Banco de tamaños: el arte REAL servido por el producto, a los tamaños que pide el encargo. */
const BANCO = `(() => {
  document.body.innerHTML = '';
  document.body.style.cssText = 'margin:0;background:#06070d;font:12px system-ui;color:#9aa4bf';
  const fila = (titulo, src, tams, ratio) => {
    const f = document.createElement('div');
    f.style.cssText = 'display:flex;align-items:flex-end;gap:22px;padding:18px 24px';
    const t = document.createElement('div'); t.textContent = titulo; t.style.cssText = 'width:90px'; f.appendChild(t);
    for (const z of tams) {
      const c = document.createElement('div'); c.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:6px';
      const caja = document.createElement('div');
      caja.style.cssText = 'width:' + Math.round(z * ratio) + 'px;height:' + z + 'px;background:#141726;box-shadow:inset 0 0 0 1px #a78bfa66;overflow:hidden;border-radius:' + (ratio === 1 ? '6px' : '4px');
      const i = document.createElement('img'); i.src = src; i.style.cssText = 'width:100%;height:100%;object-fit:cover;object-position:top';
      caja.appendChild(i); c.appendChild(caja);
      const l = document.createElement('div'); l.textContent = z + ' px'; c.appendChild(l); f.appendChild(c);
    }
    document.body.appendChild(f);
  };
  fila('avatar', '/agents/veil/avatar.webp', [24, 30, 32, 48, 56, 96, 128, 256], 1);
  fila('portrait', '/agents/veil/portrait.webp', [96, 171, 320, 640], 0.75);
  return true;
})()`;

async function main() {
  if (freeMb() < 1500) { console.log(`PARADA: RAM libre ${freeMb()} MB`); return; }
  let browser: Browser | null = null;
  try {
    browser = await launch({ width: 1440, height: 900, args: ["--in-process-gpu", "--mute-audio"] });
    const tab = browser.tab;
    if (!(await entrar(tab))) { console.log("NO SE PUDO ENTRAR"); return; }
    console.log("sesion iniciada");

    const escena = async (nombre: string, url: string, ancho: number, alto: number, antes?: () => Promise<void>) => {
      if (freeMb() < 900) throw new Error(`RAM libre ${freeMb()} MB`);
      await tab.resize(ancho, alto, 1);
      await tab.goto(`${BASE}${url}`, 2800);
      if (antes) await antes();
      const m = await tab.js<any>(MEDIR);
      await tab.shot(join(OUT, `${nombre}.png`));
      informe[nombre] = m;
      const v = m.veil.map((p: any) => `${p.variant}:${p.art}${p.img ? (p.img.ok ? "✓" : "✗") : ""}@${p.w}x${p.h}`).join(" ");
      console.log(`  · ${nombre}  veil[${v || "—"}]  otros-con-imagen=${m.otrosConImagen}  rotas=${m.rotas}  scrollX=${m.scrollX}  fuera=${m.retratos.filter((p: any) => p.fuera).length}  mapaConCaras=${m.mapaConCaras}`);
    };
    const lleno = async () => { await tab.js(MONTAR_CINCO); await sleep(1100); };

    for (const [w, h] of [[390, 844], [768, 1024], [1024, 768], [1440, 900], [1920, 1080]]) {
      await escena(`composiciones-editor-${w}`, "/entrenador/composiciones", w, h, lleno);
    }
    await escena("composiciones-lista-1440", "/entrenador/composiciones", 1440, 900);
    await escena("pizarra-1440", "/entrenador/strats", 1440, 900, async () => { await tab.js(ABRIR_PRIMERA); await sleep(1500); });
    for (const [w, h] of [[390, 844], [1440, 900]]) {
      await escena(`presentar-${w}`, "/entrenador/strats", w, h, async () => {
        await tab.js(ABRIR_PRIMERA); await sleep(1500);
        await tab.js(`(() => { const b = document.querySelector('[data-testid="open-theater"]'); if (b) b.click(); })()`);
        await sleep(1800);
      });
    }
    await tab.resize(1440, 900, 1);
    await tab.goto(`${BASE}/entrenador/partidos`, 3000);
    const href = await tab.js<string>(`(() => { const a = [...document.querySelectorAll('a')].map((x) => x.getAttribute('href') || '').find((h) => h.includes('/entrenador/plan?match=')); return a || ''; })()`);
    if (href) for (const [w, h] of [[390, 844], [1024, 768], [1440, 900]]) await escena(`plan-${w}`, href, w, h);
    else console.log("sin partidas con plan");

    await tab.resize(1440, 900, 1);
    await tab.goto(`${BASE}/`, 1500);
    await tab.js(BANCO);
    await sleep(1500);
    await tab.shot(join(OUT, "banco-tamanos.png"));
    console.log("  · banco-tamanos");

    writeFileSync(join(OUT, "_qa.json"), JSON.stringify(informe, null, 2));
    console.log(`\nlisto → ${OUT}`);
  } finally {
    if (browser) await browser.close();
  }
}

void main();
