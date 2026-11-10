/**
 * FASE 47.1 · CAPTURAS DEL ENTRENADOR (instrumento `_`, fuera de CI).
 *
 *   npx tsx scripts/_fase47-1-shots.ts <credsFile> --dir=antes [baseUrl]
 *
 * Recorre las cinco pantallas tácticas con una sesión real y las fotografía a los anchos que
 * importan. No escribe nada en la base de datos: abre, mira y fotografía. La única excepción es
 * el teatro, que es presentación pura.
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
if (!CREDS) { console.error("uso: _fase47-1-shots.ts <credsFile> --dir=antes|despues [baseUrl]"); process.exit(1); }

const OUT = join(process.cwd(), "docs/product/qa/fase47-1", DIR);
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
    if (await tab.js<boolean>(`/cerrar sesion|cerrar sesión/i.test(document.body.innerText)`).catch(() => false)) return true;
    await sleep(250);
  }
  return false;
}

/** Abre la primera estrategia guardada del rail de la pizarra. */
const ABRIR_PRIMERA = `(() => {
  const d = [...document.querySelectorAll('details')].find((x) => /mis estrategias/i.test(x.textContent || ''));
  if (d) d.open = true;
  const b = [...document.querySelectorAll('button')].filter((x) => /^abrir$/i.test((x.textContent || '').trim()));
  if (!b.length) return false;
  b[0].click();
  return true;
})()`;

/** El identificador de la primera partida con plan, leido de los enlaces de /entrenador/partidos. */
const PRIMER_PLAN = `(() => {
  const a = [...document.querySelectorAll('a')].map((x) => x.getAttribute('href') || '').find((h) => h.includes('/entrenador/plan?match='));
  return a || '';
})()`;

/**
 * El guardian de memoria ESPERA antes de rendirse: el Chrome del usuario da bajones de un par
 * de segundos y abortar en el primero deja la tanda a medias sin que pase nada malo de verdad.
 */
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

    /* ── HUB ── */
    await escena("01-hub-1440", "/entrenador", 1440, 900);
    await escena("02-hub-390", "/entrenador", 390, 844);

    /* ── COMPOSICIONES ── */
    await escena("03-composiciones-1440", "/entrenador/composiciones", 1440, 900);
    await escena("04-composiciones-768", "/entrenador/composiciones", 768, 1024);
    await escena("05-composiciones-390", "/entrenador/composiciones", 390, 844);
    await escena("06-composicion-editor-1440", "/entrenador/composiciones", 1440, 900, async () => {
      await tab.js(`(() => { const b = document.querySelector('[data-testid="new-composition"]'); if (b) b.click(); })()`);
      await sleep(900);
    });
    await escena("07-composicion-editor-768", "/entrenador/composiciones", 768, 1024, async () => {
      await tab.js(`(() => { const b = document.querySelector('[data-testid="new-composition"]'); if (b) b.click(); })()`);
      await sleep(900);
    });
    await escena("08-composicion-llena-1440", "/entrenador/composiciones", 1440, 900, async () => {
      await tab.js(`(() => { const b = document.querySelector('[data-testid="new-composition"]'); if (b) b.click(); })()`);
      await sleep(700);
      await tab.js(`(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const ids = ['veil','probe','spear','warden','echo'];
        for (const id of ids) {
          const b = document.querySelector('[data-testid="roster-' + id + '"]');
          if (b) { b.click(); await sleep(120); }
        }
      })()`);
      await sleep(700);
    });

    /* ── PIZARRA ── */
    await escena("09-pizarra-vacia-1440", "/entrenador/strats", 1440, 900);
    await escena("10-pizarra-strat-1440", "/entrenador/strats", 1440, 900, async () => {
      await tab.js(ABRIR_PRIMERA);
      await sleep(1400);
    });
    await escena("11-pizarra-strat-1920", "/entrenador/strats", 1920, 1080, async () => {
      await tab.js(ABRIR_PRIMERA);
      await sleep(1400);
    });
    await escena("12-pizarra-strat-1024", "/entrenador/strats", 1024, 1366, async () => {
      await tab.js(ABRIR_PRIMERA);
      await sleep(1400);
    });
    await escena("13-pizarra-strat-768", "/entrenador/strats", 768, 1024, async () => {
      await tab.js(ABRIR_PRIMERA);
      await sleep(1400);
    });
    await escena("14-pizarra-strat-390", "/entrenador/strats", 390, 844, async () => {
      await tab.js(ABRIR_PRIMERA);
      await sleep(1400);
    });
    await escena("15-pizarra-seleccion-1440", "/entrenador/strats", 1440, 900, async () => {
      await tab.js(ABRIR_PRIMERA);
      await sleep(1400);
      // Selecciona la primera ficha del mapa: el inspector se abre con agente y habilidades.
      await tab.js(`(() => {
        const mapa = document.querySelector('[data-tactical="lienzo"] svg');
        if (!mapa) return false;
        const t = mapa.querySelector('g[role="button"]');
        if (!t) return false;
        const r = t.getBoundingClientRect();
        const ev = (tipo) => t.dispatchEvent(new PointerEvent(tipo, { bubbles: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, pointerId: 1 }));
        ev('pointerdown'); ev('pointerup');
        return true;
      })()`);
      await sleep(600);
    });

    await escena("15b-pizarra-anotada-1440", "/entrenador/strats", 1440, 900, async () => {
      await tab.js(ABRIR_PRIMERA);
      await sleep(1400);
      /*
       * Un humo y una nota, colocados a mano. NO se guarda: es una foto de la pizarra
       * trabajando, no una edicion de la jugada de QA.
       */
      await tab.js(`(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const svg = document.querySelector('[data-tactical="lienzo"] svg');
        const img = svg && svg.querySelector('image');
        if (!img) return false;
        const W = Number(img.getAttribute('width'));
        const H = Number(img.getAttribute('height'));
        const cliente = (nx, ny) => {
          const p = svg.createSVGPoint();
          p.x = (nx / 100) * W;
          p.y = (ny / 100) * H;
          const q = p.matrixTransform(svg.getScreenCTM());
          return { x: q.x, y: q.y };
        };
        const toca = (x, y) => {
          for (const t of ['pointerdown', 'pointerup']) {
            svg.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 9, isPrimary: true, button: 0 }));
          }
        };
        let b = [...document.querySelectorAll('button')].find((x) => x.getAttribute('aria-label') === 'Humo');
        if (b) { b.click(); await sleep(220); const c = cliente(57, 44); toca(c.x, c.y); await sleep(320); }
        const campo = document.querySelector('input[aria-label="Texto de la anotación"]');
        if (campo) {
          const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
          d.set.call(campo, 'Humo antes de entrar');
          campo.dispatchEvent(new Event('input', { bubbles: true }));
          await sleep(200);
          const bc = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === 'Colocar');
          if (bc) { bc.click(); await sleep(220); const c = cliente(38, 58); toca(c.x, c.y); await sleep(320); }
        }
        return true;
      })()`);
      await sleep(700);
    });

    /* ── TEATRO ── */
    const teatro = async () => {
      await tab.js(ABRIR_PRIMERA);
      await sleep(1400);
      await tab.js(`(() => { const b = document.querySelector('[data-testid="open-theater"]'); if (b) b.click(); })()`);
      await sleep(1800);
    };
    await escena("16-teatro-1440", "/entrenador/strats", 1440, 900, teatro);
    await escena("17-teatro-1920", "/entrenador/strats", 1920, 1080, teatro);
    await escena("18-teatro-768", "/entrenador/strats", 768, 1024, teatro);
    await escena("19-teatro-paso2-1440", "/entrenador/strats", 1440, 900, async () => {
      await teatro();
      await tab.js(`(() => { const b = document.querySelector('[data-testid="theater-next"]'); if (b) b.click(); })()`);
      await sleep(1200);
    });

    /* ── PLAN TACTICO ── */
    await escena("19b-partidos-1440", "/entrenador/partidos", 1440, 900);
    await tab.resize(1440, 900, 1);
    await tab.goto(`${BASE}/entrenador/partidos`, 3000);
    const href = await tab.js<string>(PRIMER_PLAN);
    if (href) {
      await escena("20-plan-1440", href, 1440, 900);
      await escena("21-plan-768", href, 768, 1024);
      await escena("22-plan-390", href, 390, 844);
      await escena("23-plan-presentar-1440", href, 1440, 900, async () => {
        await tab.js(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /presentar/i.test(x.textContent || '')); if (b) b.click(); })()`);
        await sleep(1800);
      });
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
