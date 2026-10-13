/**
 * FASE 47 · QA REAL DE LA PIZARRA TÁCTICA (instrumento `_`, fuera de CI).
 *
 *   npx tsx scripts/_fase47-coach-qa.ts <credsFile> [baseUrl]
 *
 * Abre el entrenador en un Chrome de verdad, monta una jugada de QA con clics —cinco jugadores,
 * flecha, zona, texto, utilidad y tres pasos—, abre el teatro a pantalla completa, recorre los
 * pasos y va fotografiando. No usa la base de datos: trabaja sobre el editor, que es donde vive el
 * estado antes de guardar.
 *
 * Guardián de memoria de la Fase 44.1: un Chrome, cierre garantizado, parada si la RAM baja.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { freemem } from "node:os";
import { join } from "node:path";
import { launch, sleep, type Tab } from "./lib/cdp";

const CREDS = process.argv[2];
const BASE = process.argv.find((a) => a.startsWith("http")) ?? "http://127.0.0.1:3005";
if (!CREDS) { console.error("uso: _fase47-coach-qa.ts <credsFile> [baseUrl]"); process.exit(1); }
const OUT = join(process.cwd(), "docs/product/qa/fase47");
mkdirSync(OUT, { recursive: true });
const freeMb = () => Math.round(freemem() / 1048576);

let n = 0;
const foto = async (tab: Tab, nombre: string) => {
  await tab.shot(join(OUT, `${String(++n).padStart(2, "0")}-${nombre}.png`));
  console.log(`· ${nombre}`);
};

/* eslint-disable @typescript-eslint/no-explicit-any */
async function main() {
  if (freeMb() < 2048) { console.log(`PARADA: RAM libre ${freeMb()} MB`); return; }
  const browser = await launch({ width: 1600, height: 950, args: ["--in-process-gpu", "--mute-audio"] });
  const tab = browser.tab;
  const informe: Record<string, unknown> = { base: BASE, inicio: new Date().toISOString() };

  try {
    await tab.resize(1600, 950, 1);
    await tab.setMedia([{ name: "prefers-reduced-motion", value: "no-preference" }]);
    /*
     * La pizarra guarda en el servidor, así que exige sesión —y hace bien—. Se entra con la cuenta
     * QA temporal de la Fase 45, que quedó documentada y preservada.
     */
    const creds = JSON.parse(readFileSync(CREDS, "utf8")) as { email: string; password: string };
    await tab.goto(`${BASE}/cuenta`, 4500);
    if (await tab.js<boolean>(`!!document.querySelector('input[type="password"]')`)) {
      await tab.js(`(() => { const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }; set(document.querySelector('input[type="email"]'), ${JSON.stringify(creds.email)}); set(document.querySelector('input[type="password"]'), ${JSON.stringify(creds.password)}); document.querySelector('form button[type="submit"]').click(); })()`);
    }
    for (let i = 0; i < 160; i++) {
      if (await tab.js<boolean>(`/cerrar sesión/i.test(document.body.innerText)`).catch(() => false)) break;
      await sleep(250);
    }

    await tab.goto(`${BASE}/entrenador/strats`, 4000);
    await sleep(2500);
    await foto(tab, "editor-inicial");

    // Qué hay en pantalla: mapa, herramientas y el botón nuevo de pantalla completa.
    informe.editor = await tab.js<any>(`(() => ({
      hayMapa: !!document.querySelector('svg image, svg [href*="/maps/"]') || /ascent|bind|haven/i.test(document.body.innerHTML),
      hayTeatro: !!document.querySelector('[data-testid="open-theater"]'),
      teatroActivo: !document.querySelector('[data-testid="open-theater"]')?.disabled,
      botones: [...document.querySelectorAll('button')].length,
    }))()`);
    console.log("editor:", JSON.stringify(informe.editor));

    /*
     * Colocar cinco jugadores. La pizarra coloca al pulsar sobre el mapa con la herramienta de
     * jugador activa; los botones de rol están en el rail. Se buscan por texto para no depender
     * de una clase.
     */
    const colocados = await tab.js<any>(`(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      /*
       * EL SVG DEL MAPA, no el primero de la pagina. La primera version usaba querySelector('svg')
       * y cogia un icono de la barra de navegacion: las coordenadas salian calculadas contra un
       * rectangulo de 20 px, se normalizaban fuera de rango y las fichas acababan pegadas al borde,
       * invisibles en el encuadre. Se toma el svg de MAYOR area, que es siempre el tablero.
       */
      const svg = [...document.querySelectorAll('svg')]
        .map((e) => ({ e, r: e.getBoundingClientRect() }))
        .sort((a, b) => b.r.width * b.r.height - a.r.width * a.r.height)[0]?.e;
      if (!svg) return { error: 'sin svg' };
      const r = svg.getBoundingClientRect();
      const roles = ['Duelista','Controlador','Iniciador','Centinela','Flex'];
      let puestos = 0;
      for (let i = 0; i < roles.length; i++) {
        const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === roles[i]);
        if (!b) continue;
        b.click(); await sleep(140);
        // Un punto distinto por jugador, dentro del mapa.
        const x = r.left + r.width * (0.38 + i * 0.06);
        const y = r.top + r.height * (0.42 + (i % 2) * 0.10);
        for (const tipo of ['pointerdown','pointerup']) {
          svg.dispatchEvent(new PointerEvent(tipo, { clientX: x, clientY: y, bubbles: true, pointerId: 1, isPrimary: true }));
        }
        await sleep(160);
        puestos++;
      }
      return { puestos, fichas: document.querySelectorAll('svg g[role="button"]').length };
    })()`);
    informe.colocados = colocados;
    console.log("jugadores:", JSON.stringify(colocados));
    await sleep(500);
    await foto(tab, "cinco-jugadores");

    /*
     * ASIGNAR AGENTE A CADA FICHA. Se selecciona la ficha en el mapa y se elige agente en el
     * inspector. Es el paso que convierte «cinco círculos de rol» en «cinco agentes»: sin esto la
     * ficha usa su respaldo de texto y el emblema no se ve.
     */
    const agentes = await tab.js<any>(`(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const fichas = [...document.querySelectorAll('svg g[role="button"]')];
      let puestos = 0;
      for (let i = 0; i < fichas.length; i++) {
        const g = document.querySelectorAll('svg g[role="button"]')[i];
        if (!g) continue;
        const r = g.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        for (const tipo of ['pointerdown','pointerup']) {
          g.dispatchEvent(new PointerEvent(tipo, { clientX: cx, clientY: cy, bubbles: true, pointerId: 1, isPrimary: true }));
        }
        await sleep(300);
        /*
         * Los botones de AGENTE son los unicos que llevan dentro un emblema, y el emblema es el
         * unico svg con role=img de la pantalla. Filtrar por aria-pressed mas svg a secas cogia los
         * botones de UTILIDAD, que tambien lo cumplen: la primera version asignaba humos en vez de
         * agentes, y por eso no salia ningun emblema en las fichas.
         * (Sin acentos ni comillas invertidas: esto viaja DENTRO de una plantilla de JS.)
         */
        const botones = [...document.querySelectorAll('button[aria-pressed]')]
          .filter((b) => b.querySelector('svg[role=img]'));
        const libre = botones[i];
        if (libre) { libre.scrollIntoView({ block: 'center' }); libre.click(); puestos++; await sleep(320); }
      }
      return { puestos, conEmblema: document.querySelectorAll('svg g[role="button"] path').length };
    })()`);
    informe.agentes = agentes;
    console.log("agentes:", JSON.stringify(agentes));
    await foto(tab, "agentes-asignados");

    // Un paso más: la pizarra trae su propio botón de «añadir paso».
    const pasos = await tab.js<any>(`(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      let añadidos = 0;
      for (let i = 0; i < 2; i++) {
        const b = [...document.querySelectorAll('button')].find((x) => /a(ñ|n)adir paso|nuevo paso|\\+ paso/i.test(x.textContent || ''));
        if (!b) break;
        b.click(); añadidos++; await sleep(350);
      }
      const t = document.body.innerText;
      return { añadidos, mencionaPasos: /paso/i.test(t) };
    })()`);
    informe.pasos = pasos;
    console.log("pasos:", JSON.stringify(pasos));
    await foto(tab, "pasos");

    /* ── EL TEATRO ── */
    const abierto = await tab.js<any>(`(() => {
      const b = document.querySelector('[data-testid="open-theater"]');
      if (!b || b.disabled) return { abierto: false, motivo: b ? 'deshabilitado' : 'sin boton' };
      b.click();
      return { abierto: true };
    })()`);
    await sleep(1600);
    informe.teatro = await tab.js<any>(`(() => {
      const t = document.querySelector('[data-testid="tactical-theater"]');
      return {
        montado: !!t,
        modo: t ? t.getAttribute('data-mode') : null,
        hayLinea: !!document.querySelector('[data-testid="theater-timeline"]'),
        hayLado: !!document.querySelector('[data-testid="theater-side"]'),
        lado: document.querySelector('[data-testid="theater-side"]')?.textContent?.trim() ?? null,
      };
    })()`);
    console.log("teatro:", JSON.stringify(abierto), JSON.stringify(informe.teatro));
    // ¿Llegan las fichas al teatro? Es el punto que decide si la presentación sirve para algo.
    informe.fichasTeatro = await tab.js<any>(`(() => {
      const t = document.querySelector('[data-testid="tactical-theater"]');
      if (!t) return { error: 'sin teatro' };
      return {
        tokens: t.querySelectorAll('svg g[role="button"]').length,
        emblemas: t.querySelectorAll('svg g[role="button"] path').length,
        svgs: t.querySelectorAll('svg').length,
      };
    })()`);
    console.log("fichas en teatro:", JSON.stringify(informe.fichasTeatro));
    await foto(tab, "teatro-paso-1");

    // Recorrer los pasos con el botón y con el teclado.
    await tab.js(`document.querySelector('[data-testid="theater-next"]')?.click()`);
    await sleep(900);
    await foto(tab, "teatro-paso-2");
    await tab.js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))`);
    await sleep(900);
    await foto(tab, "teatro-paso-3");

    informe.recorrido = await tab.js<any>(`(() => {
      const t = document.body.innerText;
      const m = t.match(/(\\d+)\\s*\\/\\s*(\\d+)\\s*·/);
      return { indicador: m ? m[0] : null };
    })()`);
    console.log("recorrido:", JSON.stringify(informe.recorrido));

    await tab.js(`document.querySelector('[data-testid="theater-close"]')?.click()`);
    await sleep(800);
    await foto(tab, "vuelta-al-editor");

    /* ── RESIZE: las posiciones son normalizadas, así que no pueden moverse ── */
    const antes = await tab.js<any>(`(() => [...document.querySelectorAll('svg g[role="button"]')].map((g) => g.getAttribute('transform'))) ()`);
    await tab.resize(1024, 800, 1);
    await sleep(900);
    await foto(tab, "resize-1024");
    const despues = await tab.js<any>(`(() => [...document.querySelectorAll('svg g[role="button"]')].map((g) => g.getAttribute('transform'))) ()`);
    informe.resize = { fichasAntes: antes?.length ?? 0, fichasDespues: despues?.length ?? 0, mismas: JSON.stringify(antes) === JSON.stringify(despues) };
    console.log("resize:", JSON.stringify(informe.resize));

    await tab.resize(2560, 1440, 1);
    await sleep(900);
    await foto(tab, "editor-2560");

    informe.fin = new Date().toISOString();
    informe.capturas = n;
  } finally {
    await browser.close();
    console.log(`\nFIN · ${n} capturas · ${JSON.stringify(informe).length} B de informe · RAM ${freeMb()} MB`);
    console.log(JSON.stringify(informe, null, 1));
  }
}

main().catch((e) => { console.error("ERROR", e instanceof Error ? e.message : e); process.exit(1); });
