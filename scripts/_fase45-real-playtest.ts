/**
 * FASE 45 · PLAYTEST REAL, TURNO A TURNO (instrumento `_`, fuera de CI).
 *
 *   npx tsx scripts/_fase45-real-playtest.ts <credsFile> [baseUrl]
 *
 * Juega UNA partida PvE en Fácil contra el servidor real, con clics de verdad en un Chrome de verdad, y va mirando:
 * vestíbulo → JUGAR → selector → preparación → intro → arena → diez turnos → golpe final → resultado → JUGAR OTRA.
 *
 * ────────────────────────── POR QUÉ TURNO A TURNO DESDE NODE ──────────────────────────
 *
 * El instrumento anterior jugaba la partida entera dentro de un único `evaluate` en la página. Eso funciona para
 * comprobar que la máquina no se atasca, pero deja la partida a ciegas: no hay forma de capturar el instante del
 * enfrentamiento, ni el turno 10, ni el golpe final, porque todo ocurre dentro de la misma llamada. Aquí cada turno
 * es una ida y vuelta: Node pide un turno, la página lo juega, Node MIRA (captura y lee el DOM) y pide el siguiente.
 * Un playtest que no puede mirar no es un playtest.
 *
 * ────────────────────────── QUÉ NO HACE ──────────────────────────
 *
 * No decide nada del combate. No manda ganador, ni marcador, ni recompensa, ni eje del defensor. Elige carta y
 * estadística con clics, como una persona, y lee lo que el servidor devuelve. No hay SQL, ni escritura directa, ni
 * reintento buscando un resultado mejor: sale lo que salga.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep, type Tab } from "./lib/cdp";

const CREDS = process.argv[2];
const BASE = process.argv.find((a) => a.startsWith("http")) ?? "http://127.0.0.1:3005";
if (!CREDS) { console.error("uso: _fase45-real-playtest.ts <credsFile> [baseUrl]"); process.exit(1); }

const OUT = join(process.cwd(), "docs/product/qa/fase45/playtest");
mkdirSync(OUT, { recursive: true });
const creds = JSON.parse(readFileSync(CREDS, "utf8")) as { email: string; password: string; userId: string };

let n = 0;
const bitacora: unknown[] = [];
const anota = (paso: string, detalle: unknown) => {
  bitacora.push({ paso, detalle, instante: new Date().toISOString() });
  console.log(`· ${paso}: ${typeof detalle === "string" ? detalle : JSON.stringify(detalle)}`);
};
const foto = async (tab: Tab, nombre: string) => {
  const f = join(OUT, `${String(++n).padStart(2, "0")}-${nombre}.png`);
  await tab.shot(f);
  return f;
};

const SIGNED_IN = `(() => !document.querySelector('input[type="password"]') && /cerrar sesión/i.test(document.body.innerText))()`;
const waitFor = async (tab: Tab, expr: string, ms = 25000) => {
  for (let i = 0; i < ms / 250; i++) { if (await tab.js<boolean>(expr).catch(() => false)) return true; await sleep(250); }
  return false;
};

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Lo que se puede saber del estado de la mesa mirando SOLO el DOM, como lo ve el jugador. */
const LEE_MESA = `(() => {
  const t = document.body.innerText;
  const turno = (t.match(/(\\d+)\\s*\\/\\s*10/) || [])[1];
  const marcador = t.match(/(\\d+)\\s*[–-]\\s*(\\d+)/);
  return {
    turno: turno ? Number(turno) : null,
    atacas: /Atacas tú/i.test(t),
    defiendes: /Ataca el rival/i.test(t),
    marcadorTu: marcador ? Number(marcador[1]) : null,
    marcadorRival: marcador ? Number(marcador[2]) : null,
    terminada: /VICTORIA|DERROTA|EMPATE/.test(t),
    ejeVisible: /STRONGHOLD|GAMESENSE|ENTRYFRAG/i.test(t),
    hayRecinto: !!document.querySelector('.nx-arena-env'),
    atacante: (document.querySelector('[data-attacker]') || {}).getAttribute ? document.querySelector('[data-attacker]').getAttribute('data-attacker') : null,
    finalTurno: (document.querySelector('[data-final]') || {}).getAttribute ? document.querySelector('[data-final]').getAttribute('data-final') : null,
  };
})()`;

/** Cuántos elementos de audio están sonando a la vez. Dos temas simultáneos serían una regresión de F44.1. */
const AUDIO = `(() => {
  const m = [...document.querySelectorAll('audio')];
  return { elementos: m.length, sonando: m.filter((a) => !a.paused && !a.muted && a.currentTime > 0).length };
})()`;

/** La rueda del ratón sigue moviendo la página: F44.1 lo arregló y no se puede volver a romper. */
const SCROLL_OK = `(() => {
  const html = document.documentElement;
  const antes = window.scrollY;
  const puedeDesplazarse = html.scrollHeight > window.innerHeight + 4;
  const estilo = getComputedStyle(document.body);
  return { puedeDesplazarse, overflowBody: estilo.overflow, overflowHtml: getComputedStyle(html).overflow, scrollY: antes };
})()`;

async function login(tab: Tab) {
  await tab.goto(`${BASE}/cuenta`, 5000);
  if (await tab.js<boolean>(`!!document.querySelector('input[type="password"]')`)) {
    await tab.js(`(() => { const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }; set(document.querySelector('input[type="email"]'), ${JSON.stringify(creds.email)}); set(document.querySelector('input[type="password"]'), ${JSON.stringify(creds.password)}); document.querySelector('form button[type="submit"]').click(); })()`);
  }
  if (!(await waitFor(tab, SIGNED_IN, 45000))) throw new Error("no se pudo iniciar sesión con la cuenta QA");
}

/** Juega UN turno y devuelve lo que pasó. No decide nada: pulsa y espera al servidor. */
const JUEGA_UN_TURNO = (dobleClic: boolean) => `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const btns = () => [...document.querySelectorAll('button')];
  const confirmar = () => btns().find((b) => /^(Elige una carta|Elige una estadística|Declarar y atacar|Responder)$/.test(b.textContent.trim()));
  const turnoAhora = () => { const m = document.body.innerText.match(/(\\d+)\\s*\\/\\s*10/); return m ? Number(m[1]) : null; };

  const cont = btns().find((b) => b.textContent.trim() === 'Continuar');
  if (cont) { cont.click(); await sleep(450); }

  if (!confirmar()) return { fin: true, motivo: 'sin boton de confirmar' };
  const cartas = btns().filter((b) => /OVR \\d+$/.test(b.getAttribute('aria-label') || ''));
  if (!cartas.length) return { fin: true, motivo: 'sin cartas' };

  const turnoAntes = turnoAhora();
  cartas[0].click(); await sleep(260);
  const cartaElegida = cartas[0].getAttribute('aria-label');

  const ejes = btns().filter((b) => !b.getAttribute('aria-label') && /^(SH|GS|EF)/.test(b.textContent.trim()));
  const ataca = ejes.length === 3;
  if (ataca) { ejes[0].click(); await sleep(260); }

  const c = confirmar();
  if (!c || c.disabled) return { fin: true, motivo: 'confirmar bloqueado', turnoAntes };

  let pulsaciones = 1;
  if (${dobleClic}) { c.click(); c.click(); c.click(); pulsaciones = 3; } else { c.click(); }

  for (let w = 0; w < 100; w++) {
    const terminada = /VICTORIA|DERROTA|EMPATE/.test(document.body.innerText);
    const hayContinuar = btns().some((b) => b.textContent.trim() === 'Continuar');
    const c2 = confirmar();
    if (hayContinuar || terminada || (c2 && !c2.disabled && /Elige una carta/.test(c2.textContent))) break;
    await sleep(250);
  }
  return { fin: false, turnoAntes, turnoDespues: turnoAhora(), ataca, cartaElegida, pulsaciones,
           revelacion: /PUNTO PARA TI|PUNTO PARA EL RIVAL|EMPATE/i.test(document.body.innerText) };
})()`;

const LEE_RESULTADO = `(() => {
  const t = document.body.innerText;
  const veredicto = /VICTORIA/.test(t) ? "VICTORIA" : /DERROTA/.test(t) ? "DERROTA" : /EMPATE/.test(t) ? "EMPATE" : null;
  const marcador = t.match(/(\\d+)\\s*[–-]\\s*(\\d+)/);
  const creditos = t.match(/\\+\\s*(\\d+)[\\s\\S]{0,40}?Cr[ée]ditos/i) || t.match(/Cr[ée]ditos[\\s\\S]{0,40}?\\+\\s*(\\d+)/i);
  const xp = t.match(/\\+\\s*(\\d+)[\\s\\S]{0,40}?(Experiencia|XP)/i) || t.match(/(Experiencia|XP)[\\s\\S]{0,40}?\\+\\s*(\\d+)/i);
  const acciones = [...document.querySelectorAll('button, a')].map((b) => (b.textContent || '').trim()).filter((x) => x.length > 0 && x.length < 40);
  return {
    veredicto,
    marcadorTu: marcador ? Number(marcador[1]) : null,
    marcadorRival: marcador ? Number(marcador[2]) : null,
    creditos: creditos ? Number(creditos[1]) : null,
    xpTexto: xp ? xp[0] : null,
    jugarOtra: acciones.find((a) => /jugar otra|revancha|otra partida/i.test(a)) || null,
    accionesVisibles: [...new Set(acciones)].slice(0, 14),
  };
})()`;

async function main() {
  const browser = await launch({ width: 1440, height: 900, args: ["--in-process-gpu", "--mute-audio"] });
  const tab = browser.tab;
  const resumen: Record<string, unknown> = { userId: creds.userId, base: BASE, inicio: new Date().toISOString() };

  try {
    await tab.resize(1440, 900, 1);
    await tab.setMedia([{ name: "prefers-reduced-motion", value: "no-preference" }]);

    // ── LOGIN ─────────────────────────────────────────────────────────────
    await login(tab);
    anota("sesión iniciada", creds.userId);

    // ── VESTÍBULO + SMOKE DE SCROLL (F44.1) ───────────────────────────────
    await tab.goto(`${BASE}/`, 6000);
    await sleep(1200);
    resumen.scrollLobby = await tab.js<any>(SCROLL_OK);
    resumen.audioLobby = await tab.js<any>(AUDIO);
    anota("vestíbulo", { scroll: resumen.scrollLobby, audio: resumen.audioLobby });
    await foto(tab, "lobby");

    // ── PLAY HUB ──────────────────────────────────────────────────────────
    await tab.goto(`${BASE}/jugar`, 6000);
    await sleep(1400);
    resumen.playHub = await tab.js<any>(`(() => {
      const t = document.body.innerText;
      return { modos: [...document.querySelectorAll('[data-mode]')].map((e) => e.getAttribute('data-mode')),
               tieneRapida: /partida r[áa]pida/i.test(t), ctas: [...document.querySelectorAll('[data-cta="primary"]')].length };
    })()`);
    anota("play hub", resumen.playHub);
    await foto(tab, "play-hub");

    // ── ENTRAR EN PvE ─────────────────────────────────────────────────────
    await tab.goto(`${BASE}/duelos/jugar`, 8000);
    await sleep(1500);
    await foto(tab, "prematch");
    resumen.prematch = await tab.js<any>(`(() => {
      const t = document.body.innerText;
      return { hayDificultad: /f[áa]cil/i.test(t), hayComenzar: [...document.querySelectorAll('button')].some((b) => /comenzar duelo|entrar en partida/i.test(b.textContent)),
               textoCorto: t.slice(0, 260) };
    })()`);
    anota("preparación", resumen.prematch);

    // Elegir Fácil y empezar, con clics.
    await tab.js(`(() => {
      const btns = [...document.querySelectorAll('button')];
      const facil = btns.find((b) => /^f[áa]cil$/i.test(b.textContent.trim()));
      if (facil) facil.click();
    })()`);
    await sleep(500);
    await foto(tab, "prematch-facil");
    await tab.js(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /comenzar duelo|entrar en partida/i.test(x.textContent)); if (b) b.click(); })()`);

    // ── INTRO ─────────────────────────────────────────────────────────────
    await sleep(700);
    await foto(tab, "intro");
    resumen.intro = await tab.js<any>(`(() => ({ hayIntro: !!document.querySelector('[data-scene="intro"]') || /VS/.test(document.body.innerText) }))()`);
    anota("intro", resumen.intro);

    const listo = await waitFor(tab, `(() => [...document.querySelectorAll('button')].some((b) => /^(Elige una carta|Elige una estadística|Declarar y atacar|Responder)$/.test(b.textContent.trim())))()`, 40000);
    if (!listo) throw new Error("la mesa no llegó a aceptar jugadas");

    // ── ARENA ─────────────────────────────────────────────────────────────
    await sleep(600);
    resumen.arenaInicial = await tab.js<any>(LEE_MESA);
    resumen.audioMatch = await tab.js<any>(AUDIO);
    anota("arena, turno 1", resumen.arenaInicial);
    anota("audio en partida", resumen.audioMatch);
    await foto(tab, "arena-turno-1");

    // ── LOS DIEZ TURNOS ───────────────────────────────────────────────────
    const turnos: any[] = [];
    // El doble clic se prueba en el turno 3: bastante dentro de la partida como para no ser un caso de borde.
    const TURNO_DOBLE_CLIC = 3;
    for (let i = 1; i <= 14; i++) {
      const dobleClic = i === TURNO_DOBLE_CLIC;
      const r = await tab.js<any>(JUEGA_UN_TURNO(dobleClic));
      if (r.fin) { anota(`turno ${i} · fin`, r); break; }
      const mesa = await tab.js<any>(LEE_MESA);
      turnos.push({ i, ...r, mesa });
      anota(`turno ${r.turnoAntes ?? i}`, { ataca: r.ataca, pulsaciones: r.pulsaciones, marcador: `${mesa.marcadorTu}-${mesa.marcadorRival}`, siguiente: r.turnoDespues });

      if (i === 1) await foto(tab, "primer-enfrentamiento");
      if (i === TURNO_DOBLE_CLIC) await foto(tab, "doble-clic-turno-3");
      if (r.turnoAntes === 5) await foto(tab, "arena-turno-5");
      if (r.turnoAntes === 10 || mesa.finalTurno === "true") await foto(tab, "turno-10-final");
      if (mesa.terminada) { await foto(tab, "match-complete"); break; }
    }
    resumen.turnos = turnos;

    // ── GOLPE FINAL + RESULTADO ───────────────────────────────────────────
    await sleep(1400);
    await foto(tab, "match-complete-o-resultado");
    // El golpe final es saltable: un clic lo cierra y deja ver el resultado detallado.
    await tab.js(`(() => { const d = document.querySelector('[role="dialog"]'); if (d) d.click(); const c = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Continuar'); if (c) c.click(); })()`);
    await sleep(1600);
    await foto(tab, "resultado");
    const resultado = await tab.js<any>(LEE_RESULTADO);
    resumen.resultado = resultado;
    resumen.audioResult = await tab.js<any>(AUDIO);
    anota("RESULTADO", resultado);
    anota("audio en resultado", resumen.audioResult);
    await foto(tab, "resultado-recompensas");

    // ── EL BUCLE: RESULTADO → REVANCHA → ARENA ────────────────────────────
    /*
     * Esto se prueba ANTES de refrescar y SIN navegar, que es como lo vive el jugador: acaba la partida, pulsa la
     * acción dominante y vuelve a jugar. La primera versión de este instrumento se iba a otra ruta y volvía, y por
     * eso pulsaba «Comenzar duelo» desde la preparación en vez de «Revancha» desde el resultado: probaba otra cosa.
     */
    const revancha = await tab.js<any>(`(() => {
      const b = [...document.querySelectorAll('button, a')].find((x) => /^revancha$/i.test((x.textContent || '').trim()));
      if (!b) return { encontrado: false };
      b.click();
      return { encontrado: true };
    })()`);
    await waitFor(tab, `(() => [...document.querySelectorAll('button')].some((b) => /^(Elige una carta|Elige una estadística|Declarar y atacar|Responder)$/.test(b.textContent.trim())))()`, 45000);
    await sleep(1200);
    const trasRevancha = await tab.js<any>(LEE_MESA);
    resumen.bucleRevancha = { revancha, trasRevancha };
    anota("RESULTADO → REVANCHA", { revancha, trasRevancha });
    await foto(tab, "revancha-desde-resultado");

    // ── IDEMPOTENCIA: REFRESCAR ───────────────────────────────────────────
    await tab.goto(`${BASE}/duelos/jugar`, 8000);
    await sleep(2000);
    const trasRefresco = await tab.js<any>(LEE_RESULTADO);
    resumen.trasRefresco = trasRefresco;
    anota("tras refrescar", trasRefresco);
    await foto(tab, "tras-refresco");

    // ── SCROLL DESPUÉS DE LA PARTIDA (F44.1) ──────────────────────────────
    await tab.goto(`${BASE}/`, 6000);
    await sleep(1200);
    resumen.scrollTrasPartida = await tab.js<any>(SCROLL_OK);
    resumen.audioTrasPartida = await tab.js<any>(AUDIO);
    anota("scroll tras la partida", resumen.scrollTrasPartida);

    // ── JUGAR OTRA ────────────────────────────────────────────────────────
    await tab.goto(`${BASE}/duelos/jugar`, 8000);
    await sleep(1800);
    const pulsó = await tab.js<any>(`(() => {
      const b = [...document.querySelectorAll('button, a')].find((x) => /jugar otra|revancha|otra partida|comenzar duelo/i.test(x.textContent || ''));
      if (!b) return { encontrado: false };
      const texto = b.textContent.trim();
      b.click();
      return { encontrado: true, texto };
    })()`);
    await sleep(2500);
    const trasJugarOtra = await tab.js<any>(LEE_MESA);
    resumen.jugarOtra = { pulsó, trasJugarOtra };
    anota("JUGAR OTRA", { pulsó, trasJugarOtra });
    await foto(tab, "jugar-otra");

    resumen.fin = new Date().toISOString();
    resumen.capturas = n;
  } finally {
    await browser.close();
    writeFileSync(join(OUT, "playtest.json"), JSON.stringify({ ...resumen, bitacora }, null, 2));
    console.log(`\n→ ${join(OUT, "playtest.json")} · ${n} capturas`);
  }
}

main().catch((e) => { console.error("ERROR", e instanceof Error ? e.message : e); process.exit(1); });
