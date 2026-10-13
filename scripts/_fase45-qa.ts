/**
 * FASE 45 · QA DE LA PARTIDA EN NAVEGADOR REAL (instrumento `_`, fuera de CI).
 *
 *   npx tsx scripts/_fase45-qa.ts <credsFile> [baseUrl]
 *
 * Con una partida REAL abierta comprueba lo que solo se puede ver jugando: que la arena monta su ambiente y su
 * escenario, que el bando que ataca cambia con el turno, que refrescar devuelve la MISMA partida (y no abre otra),
 * que la música está en MATCH durante el combate y pasa a RESULT al acabar, y que nunca suenan dos temas.
 *
 * Termina la partida que abre: no deja nada a medias. Escribe `docs/product/qa/fase45/ui-qa.json`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep, type Tab } from "./lib/cdp";

/* eslint-disable @typescript-eslint/no-explicit-any */
const CREDS = process.argv[2];
const BASE = process.argv.find((a) => a.startsWith("http")) ?? "http://127.0.0.1:3005";
const OUT = process.env.F45_OUT ?? join(process.cwd(), "docs/product/qa/fase45");
mkdirSync(OUT, { recursive: true });

const READY = `(() => { const b = [...document.querySelectorAll('button')].find((x) => /^(Elige una carta|Elige una estadística|Declarar y atacar|Responder)$/.test(x.textContent.trim())); return !!b && !document.querySelector('[data-scene="intro"]'); })()`;
const SIGNED_IN = `(() => !document.querySelector('input[type="password"]') && /cerrar sesión/i.test(document.body.innerText))()`;
const waitFor = async (tab: Tab, expr: string, ms = 25000) => { for (let i = 0; i < ms / 250; i++) { if (await tab.js<boolean>(expr).catch(() => false)) return true; await sleep(250); } return false; };

/** Foto del estado de la arena tal y como la ve el jugador. */
const ARENA = `(() => {
  const root = document.querySelector('[data-phase]');
  const env = document.querySelector('[data-environment]');
  const text = document.body.innerText;
  const turn = (text.match(/(\\d+) \\/ 10/) || [])[1] ?? null;
  const score = text.match(/(\\d+)\\s*[–-]\\s*(\\d+)/);
  return {
    turn: turn ? Number(turn) : null,
    attacker: root ? root.getAttribute('data-attacker') : null,
    final: root ? root.getAttribute('data-final') : null,
    phase: root ? root.getAttribute('data-phase') : null,
    stage: !!document.querySelector('.nx-arena-stage'),
    environment: env ? env.getAttribute('data-environment') : null,
    table: !!document.querySelector('[data-arena="mesa"]'),
    scoreYou: score ? Number(score[1]) : null,
    scoreRival: score ? Number(score[2]) : null,
    playedYou: document.querySelectorAll('[aria-label="Tus cartas en la mesa"] [data-slot="lleno"]').length,
    playedRival: document.querySelectorAll('[aria-label="Cartas del rival en la mesa"] [data-slot="lleno"]').length,
    handCards: [...document.querySelectorAll('button')].filter((b) => /OVR \\d+$/.test(b.getAttribute('aria-label') || '')).length,
    lockOpen: !!([...document.querySelectorAll('button')].find((b) => /^(Elige una carta|Elige una estadística|Declarar y atacar|Responder)$/.test(b.textContent.trim()) && !b.disabled)),
  };
})()`;

const MUSIC = `(window.__nexusMusic ? { context: window.__nexusMusic().plan.context, gain: window.__nexusMusic().plan.gain, layers: window.__nexusMusic().layers.filter((l) => !l.stopping).length } : null)`;

async function login(tab: Tab) {
  const creds = JSON.parse(readFileSync(CREDS, "utf8"));
  await tab.goto(`${BASE}/cuenta`, 4500);
  if (await tab.js<boolean>(`!!document.querySelector('input[type="password"]')`)) {
    await tab.js(`(() => { const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }; set(document.querySelector('input[type="email"]'), ${JSON.stringify(creds.email)}); set(document.querySelector('input[type="password"]'), ${JSON.stringify(creds.password)}); document.querySelector('form button[type="submit"]').click(); })()`);
  }
  if (!(await waitFor(tab, SIGNED_IN, 40000))) throw new Error("sin sesión QA");
}

/**
 * Pulsa el primer botón cuyo texto encaje. Primero lo trae a la vista y luego lo pulsa con el ratón de verdad; si el
 * botón sigue fuera de pantalla (la preparación es larga), cae en el clic del DOM. Reintenta: la hidratación tarda.
 */
async function clickButton(tab: Tab, pattern: string, tries = 5): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    const box = await tab.js<{ x: number; y: number; inView: boolean } | null>(`(() => { const b = [...document.querySelectorAll('button')].find((x) => ${pattern}.test(x.textContent.trim()) && !x.disabled); if (!b) return null; b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, inView: r.top >= 0 && r.bottom <= innerHeight }; })()`).catch(() => null);
    if (!box) return false;
    await sleep(500);
    const box2 = await tab.js<{ x: number; y: number; inView: boolean } | null>(`(() => { const b = [...document.querySelectorAll('button')].find((x) => ${pattern}.test(x.textContent.trim()) && !x.disabled); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, inView: r.top >= 0 && r.bottom <= innerHeight }; })()`).catch(() => null);
    if (box2?.inView) {
      await tab.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: box2.x, y: box2.y });
      await tab.send("Input.dispatchMouseEvent", { type: "mousePressed", x: box2.x, y: box2.y, button: "left", clickCount: 1 });
      await tab.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: box2.x, y: box2.y, button: "left", clickCount: 1 });
    } else {
      await tab.js(`(() => { const b = [...document.querySelectorAll('button')].find((x) => ${pattern}.test(x.textContent.trim()) && !x.disabled); if (b) b.click(); })()`);
    }
    await sleep(1500);
    const gone = await tab.js<boolean>(`(() => { const b = [...document.querySelectorAll('button')].find((x) => ${pattern}.test(x.textContent.trim())); return !b; })()`).catch(() => false);
    if (gone) return true;
  }
  return false;
}

/** Un gesto real del jugador (desbloquea el audio, como en el juego). */
async function gesture(tab: Tab) {
  await tab.send("Input.dispatchMouseEvent", { type: "mousePressed", x: 8, y: 300, button: "left", clickCount: 1 });
  await tab.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 8, y: 300, button: "left", clickCount: 1 });
  await sleep(1200);
}

/** Juega UN turno con clics reales. Devuelve si pudo. */
async function playOneTurn(tab: Tab) {
  return await tab.js<boolean>(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const btns = () => [...document.querySelectorAll('button')];
    const confirm = () => btns().find((b) => /^(Elige una carta|Elige una estadística|Declarar y atacar|Responder)$/.test(b.textContent.trim()));
    const cont = btns().find((b) => b.textContent.trim() === 'Continuar');
    if (cont) { cont.click(); await sleep(500); }
    const cards = btns().filter((b) => /OVR \\d+$/.test(b.getAttribute('aria-label') || ''));
    if (!cards.length || !confirm()) return false;
    cards[0].click(); await sleep(250);
    const stats = btns().filter((b) => !b.getAttribute('aria-label') && /^(SH|GS|EF)/.test(b.textContent.trim()));
    if (stats.length === 3) { stats[0].click(); await sleep(250); }
    const c = confirm();
    if (!c || c.disabled) return false;
    c.click();
    for (let w = 0; w < 60; w++) {
      const done = /VICTORIA|DERROTA|EMPATE/.test(document.body.innerText);
      const cont2 = btns().find((b) => b.textContent.trim() === 'Continuar');
      const c2 = confirm();
      if (done || cont2 || (c2 && !c2.disabled && /Elige una carta/.test(c2.textContent))) break;
      await sleep(250);
    }
    return true;
  })()`);
}

async function main() {
  if (!CREDS || !existsSync(CREDS)) throw new Error("hacen falta credenciales QA");
  const b = await launch({ width: 1440, height: 900, userDataDir: join(CREDS, "..", "f45-qa-profile"), args: ["--renderer-process-limit=1", "--disable-extensions", "--in-process-gpu", "--mute-audio", "--disable-features=BackForwardCache"] });
  const tab = b.tab;
  const arena: any[] = [];
  const audio: any = {};
  const resume: any = {};
  try {
    await tab.setMedia([{ name: "prefers-reduced-motion", value: "no-preference" }]);
    await login(tab);

    // 1 · Entrar en la arena: si no hay partida abierta, empezar una. Se reintenta: la preparación es larga y el
    //     botón vive por debajo del pliegue, así que a veces hay que volver a entrar.
    let live = false;
    for (let intento = 1; intento <= 3 && !live; intento++) {
      await tab.goto(`${BASE}/duelos/jugar`, 7000);
      await waitFor(tab, `/Preparación/.test(document.body.innerText) || ${READY}`, 30000);
      if (await tab.js<boolean>(READY)) { live = true; break; }
      if (await tab.js<boolean>(`/Preparación/.test(document.body.innerText)`)) {
        await waitFor(tab, `(() => { const b = [...document.querySelectorAll('button')].find((x) => /Comenzar duelo/i.test(x.textContent)); return !!b && !b.disabled; })()`, 25000);
        const started = await clickButton(tab, "/Comenzar duelo/i");
        const introUp = await waitFor(tab, `!!document.querySelector('[data-scene="intro"]')`, 6000);
        console.log(`· intento ${intento}: «Comenzar duelo» ${started ? "pulsado" : "no pulsado"} · intro ${introUp}`);
        await tab.js(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /^Saltar$/i.test(x.textContent.trim())); if (b) b.click(); })()`);
      }
      live = await waitFor(tab, READY, 30000);
    }
    if (!live) {
      const diag = await tab.js<string>(`document.body.innerText.slice(0, 300)`).catch(() => "");
      throw new Error(`la mesa no llegó a aceptar jugadas · pantalla: ${diag.split(String.fromCharCode(10)).join(" | ")}`);
    }
    await gesture(tab);
    arena.push({ step: "inicio", ...(await tab.js<any>(ARENA)) });
    audio.match = (await tab.js<any>(MUSIC))?.context ?? null;
    audio.matchLayers = (await tab.js<any>(MUSIC))?.layers ?? null;

    // 2 · Dos turnos reales, mirando el escenario en cada uno.
    for (let i = 0; i < 2; i++) {
      const played = await playOneTurn(tab);
      await sleep(600);
      arena.push({ step: `turno ${i + 1}`, played, ...(await tab.js<any>(ARENA)) });
    }

    // 3 · Refrescar en mitad de la partida: tiene que volver la MISMA partida.
    const antes = await tab.js<any>(ARENA);
    await tab.goto(`${BASE}/duelos/jugar`, 8000);
    await waitFor(tab, READY, 30000);
    const despues = await tab.js<any>(ARENA);
    resume.before = antes;
    resume.after = despues;
    resume.sameTurn = antes.turn === despues.turn;
    resume.sameScore = antes.scoreYou === despues.scoreYou && antes.scoreRival === despues.scoreRival;
    resume.lockOpen = despues.lockOpen;
    resume.recoveredNotice = await tab.js<boolean>(`/Partida recuperada desde el servidor/.test(document.body.innerText)`);
    // Tras una recarga el audio vuelve a estar bloqueado (política de autoplay): hace falta otro gesto real.
    await gesture(tab);
    audio.afterReload = (await tab.js<any>(MUSIC))?.context ?? null;
    arena.push({ step: "tras refrescar", ...despues });

    // 4 · Terminar la partida y mirar el final: golpe, resultado y música.
    let guard = 0;
    let maxLayers = audio.matchLayers ?? 0;
    while (guard++ < 14) {
      const ok = await playOneTurn(tab);
      const m = await tab.js<any>(MUSIC);
      if (m) maxLayers = Math.max(maxLayers, m.layers);
      if (!ok) break;
      if (await tab.js<boolean>(`/VICTORIA|DERROTA|EMPATE/.test(document.body.innerText)`)) break;
    }
    audio.completeSeen = await tab.js<boolean>(`!!document.querySelector('[data-scene="match-complete"]') || /VICTORIA|DERROTA|EMPATE/.test(document.body.innerText)`);
    await waitFor(tab, `!!document.querySelector('[data-scene="result"]')`, 20000);
    await sleep(1500);
    audio.result = (await tab.js<any>(MUSIC))?.context ?? null;
    const m2 = await tab.js<any>(MUSIC);
    audio.maxActiveLayers = Math.max(maxLayers, m2?.layers ?? 0);
    audio.resultActions = await tab.js<string[]>(`[...document.querySelectorAll('[data-testid="result-actions"] a, [data-testid="result-actions"] button')].map((b) => (b.textContent || '').trim())`);
    audio.primaryAction = await tab.js<string | null>(`(() => { const p = document.querySelector('[data-testid="result-actions"] [data-cta="primary"]'); return p ? (p.textContent || '').trim() : null; })()`);
    audio.jsErrors = tab.takeErrors().filter((e) => !/status of (404|429)|favicon|DevTools/.test(e));
  } finally {
    await b.close();
  }
  const out = { generatedAt: new Date().toISOString(), base: BASE, arena, resume, audio };
  writeFileSync(join(OUT, "ui-qa.json"), JSON.stringify(out, null, 2) + "\n");
  console.log(JSON.stringify({ arena: arena.map((a) => [a.step, a.turn, a.attacker, a.environment, a.stage]), resume: { sameTurn: resume.sameTurn, sameScore: resume.sameScore, lockOpen: resume.lockOpen }, audio }, null, 1));
}
void main();
