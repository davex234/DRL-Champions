/**
 * FASE 47.1 · RECORRIDO REAL DEL ENTRENADOR (instrumento `_`, fuera de CI).
 *
 *   npx tsx scripts/_fase47-1-qa.ts <credsFile> [baseUrl]
 *
 * Hace por INTERFAZ lo que hace un entrenador: monta una jugada con cinco agentes, dibuja,
 * añade pasos, guarda, recarga y comprueba que las fichas siguen donde se dejaron. Después
 * mide esas mismas posiciones a cuatro anchos distintos: una coordenada normalizada tiene que
 * significar el mismo punto del mapa a 768 y a 1920.
 *
 * Escribe UNA jugada de QA en la cuenta de pruebas (`__QA_F471_STRAT__`). No toca ninguna otra.
 *
 * Guardián de memoria de la Fase 44.1: un Chrome, cierre garantizado, parada si baja la RAM.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { freemem } from "node:os";
import { join } from "node:path";
import { launch, sleep, type Tab, type Browser } from "./lib/cdp";

const CREDS = process.argv[2];
const BASE = process.argv.find((a) => a.startsWith("http")) ?? "http://127.0.0.1:3005";
if (!CREDS) { console.error("uso: _fase47-1-qa.ts <credsFile> [baseUrl]"); process.exit(1); }
const OUT = join(process.cwd(), "docs/product/qa/fase47-1");
mkdirSync(OUT, { recursive: true });
const creds = JSON.parse(readFileSync(CREDS, "utf8")) as { email: string; password: string };
const freeMb = () => Math.round(freemem() / 1048576);

const NOMBRE = "__QA_F471_STRAT__";

/** Dónde va cada uno. Rejilla normalizada 0..100, dentro del encuadre de Ascent. */
const PUESTOS: [string, number, number][] = [
  ["DUE", 63, 38],
  ["CON", 50, 50],
  ["INI", 43, 45],
  ["CEN", 29, 41],
  ["FLX", 53, 63],
];
const AGENTES = ["spear", "veil", "probe", "warden", "echo"];

/* eslint-disable @typescript-eslint/no-explicit-any */
const informe: Record<string, unknown> = { base: BASE, inicio: new Date().toISOString() };

/*
 * AYUDAS QUE VIVEN EN LA PÁGINA.
 *
 * Sin acentos ni comillas invertidas: este texto viaja dentro de una plantilla de JavaScript y
 * el transform de esbuild se atraganta con ellas (lección de la Fase 47).
 */
const AYUDAS = `
  /*
   * EL SVG DEL MAPA. No vale «el mas grande de la pagina»: el ambiente de NEXUS pinta un SVG a
   * pantalla completa que siempre gana por area y no tiene ni mapa ni fichas. El lienzo se
   * marca a si mismo con data-tactical, y ademas lleva el <image> del PNG.
   */
  const mapaSvg = () => [...document.querySelectorAll('[data-tactical="lienzo"] svg')]
    .filter((el) => el.querySelector('image'))
    .map((el) => ({ el, a: el.getBoundingClientRect().width * el.getBoundingClientRect().height }))
    .sort((x, y) => y.a - x.a)[0].el;
  const cliente = (nx, ny) => {
    const svg = mapaSvg();
    const img = svg.querySelector('image');
    const W = Number(img.getAttribute('width'));
    const H = Number(img.getAttribute('height'));
    const p = svg.createSVGPoint();
    p.x = (nx / 100) * W;
    p.y = (ny / 100) * H;
    const q = p.matrixTransform(svg.getScreenCTM());
    return { x: q.x, y: q.y };
  };
  const toca = (el, x, y) => {
    for (const tipo of ['pointerdown', 'pointerup']) {
      el.dispatchEvent(new PointerEvent(tipo, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, isPrimary: true, button: 0 }));
    }
  };
  const boton = (re) => [...document.querySelectorAll('button')].find((b) => re.test((b.textContent || '').trim()));
`;

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

/** Escribe en un campo controlado de React. */
const escribir = (sel: string, v: string) =>
  `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; const d = Object.getOwnPropertyDescriptor(proto, 'value'); d.set.call(el, ${JSON.stringify(v)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`;

/** Las fichas que hay sobre el mapa, con su posición normalizada leída de la PANTALLA. */
const FICHAS = `(() => {
  ${AYUDAS}
  const svg = mapaSvg();
  const img = svg.querySelector('image');
  const W = Number(img.getAttribute('width'));
  const H = Number(img.getAttribute('height'));
  const inv = svg.getScreenCTM().inverse();
  return [...svg.querySelectorAll('g[role="button"]')].map((g) => {
    const r = g.getBoundingClientRect();
    const p = svg.createSVGPoint();
    p.x = r.x + r.width / 2;
    p.y = r.y + r.height / 2;
    const q = p.matrixTransform(inv);
    return {
      etiqueta: (g.getAttribute('aria-label') || '').slice(0, 60),
      x: Math.round((q.x / W) * 1000) / 10,
      y: Math.round((q.y / H) * 1000) / 10,
      visible: r.width > 6 && r.height > 6,
    };
  }).sort((a, b) => a.etiqueta.localeCompare(b.etiqueta));
})()`;

async function main() {
  if (freeMb() < 900) { console.log(`PARADA: RAM libre ${freeMb()} MB`); return; }
  let browser: Browser | null = null;
  try {
    browser = await launch({ width: 1600, height: 950, args: ["--in-process-gpu", "--mute-audio"] });
    const tab = browser.tab;
    await tab.setMedia([{ name: "prefers-reduced-motion", value: "no-preference" }]);
    if (!(await entrar(tab))) { console.log("NO SE PUDO ENTRAR"); return; }
    console.log("sesion iniciada");

    await tab.goto(`${BASE}/entrenador/strats`, 3500);

    /* ── 1 · Jugada nueva ─────────────────────────────────────────────────── */
    await tab.js(`(() => {
      const d = [...document.querySelectorAll('details')].find((x) => /mis estrategias/i.test(x.textContent || ''));
      if (d) d.open = true;
      const b = [...document.querySelectorAll('button')].find((x) => /\\+ Nueva estrategia/i.test(x.textContent || ''));
      if (b) b.click();
    })()`);
    await sleep(600);
    await tab.js(escribir('input[aria-label="Nombre de la estrategia"]', NOMBRE));
    await sleep(400);

    /* ── 2 · Los cinco, movidos a su sitio ───────────────────────────────── */
    /*
     * Una jugada NUEVA ya nace con los cinco en la base: `emptyStrat` los reparte por el
     * spawn del bando. O sea que un entrenador no los «coloca», los MUEVE — y eso es lo que
     * se hace aquí, arrastrando ficha a ficha como se hace con el dedo.
     */
    const colocados = await tab.js<any>(`(async () => {
      ${AYUDAS}
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const puestos = ${JSON.stringify(PUESTOS)};
      const hechos = [];
      for (let i = 0; i < puestos.length; i++) {
        const [abbr, nx, ny] = puestos[i];
        const g = [...mapaSvg().querySelectorAll('g[role="button"]')][i];
        if (!g) { hechos.push({ abbr, error: 'sin ficha' }); continue; }
        const r = g.getBoundingClientRect();
        const destino = cliente(nx, ny);
        g.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, pointerId: 7, isPrimary: true, button: 0 }));
        await sleep(70);
        window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: destino.x, clientY: destino.y, pointerId: 7 }));
        await sleep(90);
        window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: destino.x, clientY: destino.y, pointerId: 7 }));
        await sleep(240);
        hechos.push({ abbr, nx, ny });
      }
      return hechos;
    })()`);
    informe.colocados = colocados;
    console.log("colocados:", JSON.stringify(colocados));

    /* ── 3 · Un agente por ficha ──────────────────────────────────────────── */
    const conAgente = await tab.js<any>(`(async () => {
      ${AYUDAS}
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const agentes = ${JSON.stringify(AGENTES)};
      let n = 0;
      for (let i = 0; i < agentes.length; i++) {
        const g = [...mapaSvg().querySelectorAll('g[role="button"]')][i];
        if (!g) continue;
        const r = g.getBoundingClientRect();
        toca(g, r.x + r.width / 2, r.y + r.height / 2);
        await sleep(360);
        const re = new RegExp('^' + agentes[i], 'i');
        const b = [...document.querySelectorAll('button')].find((x) => x.querySelector('svg[role="img"]') && re.test((x.textContent || '').trim()));
        if (b) { b.click(); n++; await sleep(300); }
      }
      return n;
    })()`);
    informe.agentes = conAgente;
    console.log("agentes asignados:", conAgente);

    /* ── 4 · Dibujo: una flecha, una zona, un humo y una nota ─────────────── */
    const dibujado = await tab.js<any>(`(async () => {
      ${AYUDAS}
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const arrastra = async (x1, y1, x2, y2) => {
        const svg = mapaSvg();
        svg.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: x1, clientY: y1, pointerId: 3, isPrimary: true, button: 0 }));
        await sleep(60);
        for (let i = 1; i <= 6; i++) {
          const x = x1 + ((x2 - x1) * i) / 6;
          const y = y1 + ((y2 - y1) * i) / 6;
          window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x, clientY: y, pointerId: 3 }));
          await sleep(30);
        }
        window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: x2, clientY: y2, pointerId: 3 }));
        await sleep(260);
      };
      const salida = {};

      // Flecha: del centro al sitio A.
      let b = boton(/^Flecha$/i);
      if (b) { b.click(); await sleep(160); const a = cliente(50, 50), c = cliente(66, 36); await arrastra(a.x, a.y, c.x, c.y); salida.flecha = true; }

      // Zona sobre el sitio A.
      b = boton(/^Zona$/i);
      if (b) { b.click(); await sleep(160); const a = cliente(60, 30), c = cliente(72, 44); await arrastra(a.x, a.y, c.x, c.y); salida.zona = true; }

      // Humo en el cuello de botella.
      b = [...document.querySelectorAll('button')].find((x) => x.getAttribute('aria-label') === 'Humo');
      if (b) { b.click(); await sleep(160); const c = cliente(57, 45); toca(mapaSvg(), c.x, c.y); await sleep(260); salida.humo = true; }

      // Una nota.
      const campo = document.querySelector('input[aria-label="Texto de la anotación"]');
      if (campo) {
        const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
        d.set.call(campo, 'Entrada por A');
        campo.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(140);
        const bc = boton(/^Colocar$/i);
        if (bc) { bc.click(); await sleep(160); const c = cliente(70, 52); toca(mapaSvg(), c.x, c.y); await sleep(260); salida.nota = true; }
      }
      return salida;
    })()`);
    informe.dibujado = dibujado;
    console.log("dibujado:", JSON.stringify(dibujado));

    /* ── 5 · Dos pasos más, con movimiento ────────────────────────────────── */
    const pasos = await tab.js<any>(`(async () => {
      ${AYUDAS}
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const mueve = async (i, nx, ny) => {
        const g = [...mapaSvg().querySelectorAll('g[role="button"]')][i];
        if (!g) return false;
        const r = g.getBoundingClientRect();
        const destino = cliente(nx, ny);
        g.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, pointerId: 5, isPrimary: true, button: 0 }));
        await sleep(60);
        window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: destino.x, clientY: destino.y, pointerId: 5 }));
        await sleep(80);
        window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: destino.x, clientY: destino.y, pointerId: 5 }));
        await sleep(240);
        return true;
      };
      const nombra = (v) => {
        const el = document.querySelector('input[aria-label="Nombre del paso"]');
        if (!el) return false;
        const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
        d.set.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      };
      nombra('Montaje');
      await sleep(200);

      boton(/^\\+ Paso$/).click();
      await sleep(500);
      nombra('Humo y entrada');
      await sleep(200);
      await mueve(0, 70, 34);
      await mueve(2, 55, 40);

      boton(/^\\+ Paso$/).click();
      await sleep(500);
      nombra('Plantado');
      await sleep(200);
      await mueve(0, 72, 40);
      await mueve(1, 66, 44);

      return [...document.querySelectorAll('button')].filter((b) => /^\\d+\\./.test((b.textContent || '').trim())).length;
    })()`);
    informe.pasos = pasos;
    console.log("pasos:", pasos);

    await tab.shot(join(OUT, "qa-01-montada.png"));

    /* ── 6 · Guardar y volver a leer ──────────────────────────────────────── */
    const antes = await tab.js<any>(`(() => {
      ${AYUDAS}
      const bs = [...document.querySelectorAll('button')].filter((b) => /^\\d+\\./.test((b.textContent || '').trim()));
      if (bs[0]) bs[0].click();
      return null;
    })()`);
    void antes;
    await sleep(600);
    const fichasAntes = await tab.js<any>(FICHAS);
    informe.fichasAntes = fichasAntes;

    await tab.js(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /^Guardar/i.test((x.textContent || '').trim())); if (b) b.click(); })()`);
    await sleep(2600);
    informe.guardado = await tab.js<string>(`document.body.innerText.match(/Estrategia guardada|No se pudo guardar|[A-Z][^\\n]*necesita[^\\n]*/i)?.[0] ?? "sin aviso"`);
    console.log("guardar:", informe.guardado);

    /* Recargar de cero y abrir la jugada por su nombre. */
    await tab.goto(`${BASE}/entrenador/strats`, 3500);
    const reabierta = await tab.js<any>(`(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const d = [...document.querySelectorAll('details')].find((x) => /mis estrategias/i.test(x.textContent || ''));
      if (d) d.open = true;
      await sleep(300);
      const fila = [...document.querySelectorAll('*')].find((el) => el.children.length === 0 && (el.textContent || '').trim() === ${JSON.stringify(NOMBRE)});
      if (!fila) return { error: 'no aparece en la lista' };
      let caja = fila;
      for (let i = 0; i < 6 && caja; i++) { caja = caja.parentElement; if (caja && [...caja.querySelectorAll('button')].some((b) => /^abrir$/i.test((b.textContent || '').trim()))) break; }
      const b = caja && [...caja.querySelectorAll('button')].find((x) => /^abrir$/i.test((x.textContent || '').trim()));
      if (!b) return { error: 'sin boton abrir' };
      b.click();
      await sleep(1200);
      return { nombre: document.querySelector('input[aria-label="Nombre de la estrategia"]')?.value ?? null };
    })()`);
    informe.reabierta = reabierta;
    console.log("reabierta:", JSON.stringify(reabierta));
    await sleep(800);
    informe.fichasDespues = await tab.js<any>(FICHAS);
    await tab.shot(join(OUT, "qa-02-recargada.png"));

    /* ── 7 · La misma coordenada a cuatro anchos ──────────────────────────── */
    const porAncho: Record<string, unknown> = {};
    for (const [w, h] of [[768, 1024], [1024, 1366], [1440, 900], [1920, 1080]] as const) {
      await tab.resize(w, h, 1);
      await sleep(900);
      porAncho[`${w}`] = await tab.js<any>(FICHAS);
    }
    informe.coordenadas = porAncho;

    writeFileSync(join(OUT, "qa-informe.json"), JSON.stringify(informe, null, 2));
    console.log(`\nlisto → ${join(OUT, "qa-informe.json")}`);
  } finally {
    if (browser) await browser.close();
  }
}

void main();
