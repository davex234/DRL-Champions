/**
 * FASE 45 · REVANCHA REAL Y HUMO DE AUDIO (instrumento `_`, fuera de CI).
 *
 *   npx tsx scripts/_fase45-revancha-audio.ts <credsFile> [baseUrl]
 *
 * Cierra las dos comprobaciones que el playtest dejó a medias:
 *
 *   1. REVANCHA. El playtest pulsó «Comenzar duelo» desde la preparación, no «Revancha» desde el resultado. Aquí se
 *      termina la partida que quedó abierta, se llega al resultado de verdad y se pulsa **Revancha**, que es la
 *      acción dominante de esa pantalla. Se comprueba que arranca una partida nueva (turno 1, marcador 0-0).
 *
 *   2. AUDIO. La primera medición contaba elementos `<audio>` y daba 0 siempre. Era una medición inútil: la Fase
 *      44.1 no usa `<audio>`, usa **WebAudio** (música procedural). Aquí se instrumenta `AudioContext` ANTES de
 *      cargar la página y se cuenta cuántos contextos se crean y cuántos están en marcha a la vez, que es lo que
 *      de verdad respondería «¿suenan dos músicas?».
 *
 * No decide nada del combate y no toca la economía: juega a clics y mira.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep, type Tab } from "./lib/cdp";

const CREDS = process.argv[2];
const BASE = process.argv.find((a) => a.startsWith("http")) ?? "http://127.0.0.1:3005";
if (!CREDS) { console.error("uso: _fase45-revancha-audio.ts <credsFile> [baseUrl]"); process.exit(1); }

const OUT = join(process.cwd(), "docs/product/qa/fase45/playtest");
mkdirSync(OUT, { recursive: true });
const creds = JSON.parse(readFileSync(CREDS, "utf8")) as { email: string; password: string };

const SIGNED_IN = `(() => !document.querySelector('input[type="password"]') && /cerrar sesión/i.test(document.body.innerText))()`;
const waitFor = async (tab: Tab, expr: string, ms = 30000) => {
  for (let i = 0; i < ms / 250; i++) { if (await tab.js<boolean>(expr).catch(() => false)) return true; await sleep(250); }
  return false;
};

/**
 * Instrumentación de WebAudio. Se inyecta en CADA documento antes de que corra nada de la página, así que ve
 * también el contexto que crea el gestor de sonido al arrancar. Cuenta creaciones y estados; no reproduce nada.
 */
const SONDA_AUDIO = `
(() => {
  if (window.__nxAudioProbe) return;
  window.__nxAudioProbe = { creados: 0, contextos: [] };
  for (const nombre of ['AudioContext', 'webkitAudioContext']) {
    const Original = window[nombre];
    if (!Original) continue;
    window[nombre] = function (...args) {
      const ctx = new Original(...args);
      window.__nxAudioProbe.creados++;
      window.__nxAudioProbe.contextos.push(ctx);
      return ctx;
    };
    window[nombre].prototype = Original.prototype;
  }
})();`;

const LEE_AUDIO = `(() => {
  const p = window.__nxAudioProbe || { creados: 0, contextos: [] };
  const estados = p.contextos.map((c) => c.state);
  return {
    contextosCreados: p.creados,
    enMarcha: estados.filter((s) => s === 'running').length,
    estados,
    elementosAudio: document.querySelectorAll('audio').length,
  };
})()`;

/* eslint-disable @typescript-eslint/no-explicit-any */
async function main() {
  const browser = await launch({ width: 1440, height: 900, args: ["--in-process-gpu", "--autoplay-policy=no-user-gesture-required"] });
  const tab = browser.tab;
  const informe: Record<string, unknown> = { inicio: new Date().toISOString() };
  try {
    await tab.resize(1440, 900, 1);
    await tab.setMedia([{ name: "prefers-reduced-motion", value: "no-preference" }]);
    // La sonda tiene que estar puesta ANTES de que la página cree su contexto.
    await tab.send("Page.addScriptToEvaluateOnNewDocument", { source: SONDA_AUDIO });

    await tab.goto(`${BASE}/cuenta`, 5000);
    if (await tab.js<boolean>(`!!document.querySelector('input[type="password"]')`)) {
      await tab.js(`(() => { const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }; set(document.querySelector('input[type="email"]'), ${JSON.stringify(creds.email)}); set(document.querySelector('input[type="password"]'), ${JSON.stringify(creds.password)}); document.querySelector('form button[type="submit"]').click(); })()`);
    }
    if (!(await waitFor(tab, SIGNED_IN, 45000))) throw new Error("no se pudo iniciar sesión");

    // ── AUDIO EN EL VESTÍBULO ─────────────────────────────────────────────
    await tab.goto(`${BASE}/`, 6000);
    // Un gesto real: sin él, el navegador no deja sonar nada (y eso también es correcto).
    await tab.js(`document.body.click()`);
    await sleep(2500);
    informe.audioLobby = await tab.js<any>(LEE_AUDIO);
    console.log("· audio vestíbulo:", JSON.stringify(informe.audioLobby));

    // ── TERMINAR LA PARTIDA ABIERTA ───────────────────────────────────────
    await tab.goto(`${BASE}/duelos/jugar`, 9000);
    await sleep(2500);
    await tab.js(`document.body.click()`);
    await sleep(1500);
    informe.audioMatch = await tab.js<any>(LEE_AUDIO);
    console.log("· audio en partida:", JSON.stringify(informe.audioMatch));

    for (let i = 0; i < 16; i++) {
      const r = await tab.js<any>(`(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const btns = () => [...document.querySelectorAll('button')];
        const confirmar = () => btns().find((b) => /^(Elige una carta|Elige una estadística|Declarar y atacar|Responder)$/.test(b.textContent.trim()));
        const cont = btns().find((b) => b.textContent.trim() === 'Continuar');
        if (cont) { cont.click(); await sleep(450); }
        if (/VICTORIA|DERROTA|EMPATE/.test(document.body.innerText) && !confirmar()) return { fin: true };
        if (!confirmar()) return { fin: true };
        const cartas = btns().filter((b) => /OVR \\d+$/.test(b.getAttribute('aria-label') || ''));
        if (!cartas.length) return { fin: true };
        cartas[0].click(); await sleep(280);
        const ejes = btns().filter((b) => !b.getAttribute('aria-label') && /^(SH|GS|EF)/.test(b.textContent.trim()));
        if (ejes.length === 3) { ejes[0].click(); await sleep(280); }
        const c = confirmar();
        if (!c || c.disabled) return { fin: true };
        c.click();
        for (let w = 0; w < 100; w++) {
          const hayCont = btns().some((b) => b.textContent.trim() === 'Continuar');
          const fin = /VICTORIA|DERROTA|EMPATE/.test(document.body.innerText);
          const c2 = confirmar();
          if (hayCont || fin || (c2 && !c2.disabled && /Elige una carta/.test(c2.textContent))) break;
          await sleep(250);
        }
        return { fin: false };
      })()`);
      if (r.fin) break;
    }

    // Cerrar el golpe final para llegar al resultado detallado.
    await sleep(1600);
    await tab.js(`(() => { const d = document.querySelector('[role="dialog"]'); if (d) d.click(); const c = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Continuar'); if (c) c.click(); })()`);
    await sleep(2200);
    informe.audioResult = await tab.js<any>(LEE_AUDIO);
    console.log("· audio en resultado:", JSON.stringify(informe.audioResult));
    await tab.shot(join(OUT, "19-resultado-segunda-partida.png"));

    const antesDeRevancha = await tab.js<any>(`(() => {
      const t = document.body.innerText;
      const v = /VICTORIA/.test(t) ? "VICTORIA" : /DERROTA/.test(t) ? "DERROTA" : /EMPATE/.test(t) ? "EMPATE" : null;
      const b = (document.querySelector('[data-testid="result-play-again"]') ?? [...document.querySelectorAll('button, a')].find((x) => /^(jugar otra|revancha)$/i.test((x.textContent || '').trim())));
      return { veredicto: v, hayRevancha: !!b };
    })()`);
    console.log("· resultado alcanzado:", JSON.stringify(antesDeRevancha));
    informe.antesDeRevancha = antesDeRevancha;

    // ── PULSAR REVANCHA ───────────────────────────────────────────────────
    if (antesDeRevancha.hayRevancha) {
      await tab.js(`(() => { const b = (document.querySelector('[data-testid="result-play-again"]') ?? [...document.querySelectorAll('button, a')].find((x) => /^(jugar otra|revancha)$/i.test((x.textContent || '').trim()))); if (b) b.click(); })()`);
      await waitFor(tab, `(() => [...document.querySelectorAll('button')].some((b) => /^(Elige una carta|Elige una estadística|Declarar y atacar|Responder)$/.test(b.textContent.trim())))()`, 40000);
      await sleep(1200);
      const tras = await tab.js<any>(`(() => {
        const t = document.body.innerText;
        const m = t.match(/(\\d+)\\s*\\/\\s*10/);
        const s = t.match(/(\\d+)\\s*[–-]\\s*(\\d+)/);
        return { turno: m ? Number(m[1]) : null, marcador: s ? s[0] : null, hayRecinto: !!document.querySelector('.nx-arena-env') };
      })()`);
      informe.trasRevancha = tras;
      console.log("· tras REVANCHA:", JSON.stringify(tras));
      await tab.shot(join(OUT, "20-revancha-nueva-partida.png"));
      informe.audioRevancha = await tab.js<any>(LEE_AUDIO);
      console.log("· audio tras revancha:", JSON.stringify(informe.audioRevancha));
    }

    // ── SALIR: no se deja una partida a medias sin decirlo ─────────────────
    informe.fin = new Date().toISOString();
  } finally {
    await browser.close();
    writeFileSync(join(OUT, "revancha-audio.json"), JSON.stringify(informe, null, 2));
    console.log(`\n→ ${join(OUT, "revancha-audio.json")}`);
  }
}

main().catch((e) => { console.error("ERROR", e instanceof Error ? e.message : e); process.exit(1); });
