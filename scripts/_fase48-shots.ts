/**
 * FASE 48 · CAPTURAS DEL AGENT IDENTITY SYSTEM (instrumento `_`, fuera de CI).
 *
 *   npx tsx scripts/_fase48-shots.ts <credsFile> --dir=antes|despues [baseUrl]
 *
 * Fotografía SOLO las superficies donde aparecen agentes: el gestor de composiciones (lista,
 * editor vacío, editor completo), el Plan Táctico, Presentar y la pizarra —esta última para
 * demostrar que el MAPA sigue usando fichas tácticas y no retratos—.
 *
 * No escribe nada en la base de datos: abre, mira y fotografía.
 *
 * Guardián de memoria de la Fase 44.1: un Chrome, cierre garantizado, parada si baja la RAM.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { freemem } from "node:os";
import { join } from "node:path";
import { launch, sleep, type Tab, type Browser } from "./lib/cdp";

const CREDS = process.argv[2];
const BASE = process.argv.find((a) => a.startsWith("http")) ?? "http://127.0.0.1:3005";
const DIR = (process.argv.find((a) => a.startsWith("--dir=")) ?? "--dir=antes").slice(6);
const SOLO = (process.argv.find((a) => a.startsWith("--solo=")) ?? "").slice(7);
if (!CREDS) { console.error("uso: _fase48-shots.ts <credsFile> --dir=antes|despues [baseUrl]"); process.exit(1); }

const OUT = join(process.cwd(), "docs/product/qa/fase48", DIR);
mkdirSync(OUT, { recursive: true });
const freeMb = () => Math.round(freemem() / 1048576);
const creds = JSON.parse(readFileSync(CREDS, "utf8")) as { email: string; password: string };

/* eslint-disable @typescript-eslint/no-explicit-any */
const errores: Record<string, string[]> = {};

const foto = async (tab: Tab, nombre: string) => {
  await tab.shot(join(OUT, `${nombre}.png`));
  const e = tab.takeErrors().filter((x) => !/favicon|manifest\.json/i.test(x));
  if (e.length) errores[nombre] = e;
  console.log(`  · ${nombre}${e.length ? `  [${e.length} error(es)]` : ""}`);
};

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

const PRIMER_PLAN = `(() => { const a = [...document.querySelectorAll('a')].map((x) => x.getAttribute('href') || '').find((h) => h.includes('/entrenador/plan?match=')); return a || ''; })()`;

/** Abre el editor y monta los cinco: es la pantalla donde más se nota la identidad. */
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

const ABRIR_EDITOR = `(() => { const b = document.querySelector('[data-testid="new-composition"]'); if (b) b.click(); return !!b; })()`;

async function esperarRam(minimo: number, intentos = 24): Promise<boolean> {
  for (let i = 0; i < intentos; i++) {
    if (freeMb() >= minimo) return true;
    await sleep(2500);
  }
  return false;
}

async function main() {
  if (!(await esperarRam(1500))) { console.log(`PARADA: RAM libre ${freeMb()} MB`); return; }
  let browser: Browser | null = null;
  try {
    browser = await launch({ width: 1440, height: 900, args: ["--in-process-gpu", "--mute-audio"] });
    const tab = browser.tab;
    await tab.setMedia([{ name: "prefers-reduced-motion", value: "no-preference" }]);
    if (!(await entrar(tab))) { console.log("NO SE PUDO ENTRAR"); return; }
    console.log("sesion iniciada");

    const escena = async (nombre: string, url: string, ancho: number, alto: number, despues?: () => Promise<void>) => {
      if (SOLO && !nombre.includes(SOLO)) return;
      if (!(await esperarRam(900))) { console.log(`PARADA: RAM libre ${freeMb()} MB`); throw new Error("RAM"); }
      await tab.resize(ancho, alto, 1);
      await tab.goto(`${BASE}${url}`, 2800);
      if (despues) await despues();
      await foto(tab, nombre);
    };

    const editorVacio = async () => { await tab.js(ABRIR_EDITOR); await sleep(900); };
    const editorLleno = async () => { await tab.js(MONTAR_CINCO); await sleep(900); };

    /* ── COMPOSITION MANAGER: donde más se nota F48 ── */
    await escena("01-composiciones-lista-1440", "/entrenador/composiciones", 1440, 900);
    await escena("02-editor-vacio-1440", "/entrenador/composiciones", 1440, 900, editorVacio);
    await escena("03-editor-lleno-1440", "/entrenador/composiciones", 1440, 900, editorLleno);
    await escena("04-editor-lleno-768", "/entrenador/composiciones", 768, 1024, editorLleno);
    await escena("05-editor-lleno-390", "/entrenador/composiciones", 390, 844, editorLleno);
    await escena("06-editor-lleno-1920", "/entrenador/composiciones", 1920, 1080, editorLleno);
    await escena("07-editor-lleno-2560", "/entrenador/composiciones", 2560, 1440, editorLleno);

    /* ── LA PIZARRA: el mapa NO lleva retratos, y esto lo demuestra ── */
    await escena("08-pizarra-fichas-1440", "/entrenador/strats", 1440, 900, async () => {
      await tab.js(ABRIR_PRIMERA);
      await sleep(1500);
    });

    /* ── PRESENTAR ── */
    const teatro = async () => {
      await tab.js(ABRIR_PRIMERA);
      await sleep(1500);
      await tab.js(`(() => { const b = document.querySelector('[data-testid="open-theater"]'); if (b) b.click(); })()`);
      await sleep(1800);
    };
    await escena("09-presentar-1440", "/entrenador/strats", 1440, 900, teatro);
    await escena("10-presentar-1920", "/entrenador/strats", 1920, 1080, teatro);

    /* ── PLAN TÁCTICO ── */
    await tab.resize(1440, 900, 1);
    await tab.goto(`${BASE}/entrenador/partidos`, 3000);
    const href = await tab.js<string>(PRIMER_PLAN);
    if (href) {
      await escena("11-plan-1440", href, 1440, 900);
      await escena("12-plan-768", href, 768, 1024);
    } else {
      console.log("sin partidas con plan: se omiten las capturas del plan tactico");
    }

    writeFileSync(join(OUT, "_errores.json"), JSON.stringify(errores, null, 2));
    console.log(`\nlisto → ${OUT}`);
    console.log(`errores de consola: ${Object.keys(errores).length} escena(s)`);
  } finally {
    if (browser) await browser.close();
  }
}

void main();
