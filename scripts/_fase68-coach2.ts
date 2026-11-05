/**
 * FASE 68 · juega un partido del Tactical Coach por la INTERFAZ, como un jugador: plan (confirmar), compra, ronda en
 * vivo a 8×, decisiones del entrenador y «Siguiente ronda», hasta el resultado. Fuera de CI.
 *   npx tsx scripts/_fase68-coach2.ts <persona> [ancho]
 */
import { openBrowser, loginUi, goto, sleep, clickTid, token, api, writeRaw, net, collectErrors, type Client } from "./_fase68-lib";

/* eslint-disable @typescript-eslint/no-explicit-any */
const FINAL = `(() => { const t = document.body.innerText; return /Partido registrado|REVANCHA/i.test(t) && /(VICTORIA|DERROTA|EMPATE)/.test(t) && !/PREPARAS (ATAQUE|DEFENSA)/.test(t); })()`;

/** Ganchos opcionales (F69 · el instrumento de autoridad del HUD observa cada paso sin copiar el bucle). */
export interface CoachHooks {
  /** Antes de cada clic, con la pantalla del paso delante. */
  onStep?: (c: Client) => Promise<void>;
  /** Captura final propia (por defecto, la de F68 en fase68-beta/screenshots). */
  finalShot?: (c: Client) => Promise<void>;
}

export async function playCoach(c: Client, t: string, shotPrefix: string, hooks: CoachHooks = {}) {
  const out: any = { rounds: [], clicks: 0 };
  const t0 = Date.now();
  out.before = (await api(t, "/api/game/coach-matches")).json?.total ?? null;
  await goto(c, "/entrenador/jugar", 3500);
  if (await c.tab.js<boolean>(`!!document.querySelector('[data-testid="quick-agent-jett"]')`)) for (const a of ["jett", "omen", "sova", "killjoy", "breach"]) { await clickTid(c, `quick-agent-${a}`); await sleep(200); }
  out.agentFaces = await c.tab.js<number>(`[...document.querySelectorAll('img[src*="/agents/"]')].filter(i => i.complete && i.naturalWidth > 0).length`);
  if (!(await clickTid(c, "quick-save-play"))) await clickTid(c, "play-start");
  await sleep(4000);
  for (let r = 0; r < 500; r++) {
    if (await c.tab.js<boolean>(FINAL)) { out.final = await c.tab.js<string>(`document.body.innerText.replace(/\\s+/g, ' ').slice(0, 400)`); break; }
    if (hooks.onStep) await hooks.onStep(c);
    const clicked = await c.tab.js<string>(`(() => {
      const vis = [...document.querySelectorAll('button')].filter(x => x.offsetParent !== null && !x.disabled);
      const txt = (x) => (x.innerText||'').trim().replace(/\\s+/g, ' ');
      const dec = [...document.querySelectorAll('div, section, aside')].find(e => /^DECISI[ÓO]N DEL ENTRENADOR/i.test((e.innerText||'').trim()) && e.querySelectorAll('button').length >= 2);
      if (dec) { const o = [...dec.querySelectorAll('button')].filter(x => !x.disabled); const pick = o[Math.floor(Math.random() * o.length)]; pick.click(); return 'decisión: ' + txt(pick); }
      const fast = vis.find(x => txt(x) === '8×'); if (fast && !window.__f68fast) { window.__f68fast = 1; fast.click(); }
      // F69 · F68-012: la compra solo tiene la orden del pie («Jugar la ronda»).
      const order = [/^Comprar y empezar ronda/i, /^Jugar la ronda/i, /^Confirmar plan/i, /^Comenzar fase de compra/i, /^Siguiente ronda/i, /^Continuar/i, /^Ver resultado/i, /^Ver el resultado/i];
      for (const re of order) { const b = vis.find(x => re.test(txt(x))); if (b) { b.scrollIntoView({ block: 'center' }); b.click(); return txt(b); } }
      return '';
    })()`);
    if (clicked) { out.clicks++; c.actions++; out.rounds.push({ r, clicked }); }
    await sleep(clicked ? 1200 : 1500);
  }
  if (hooks.finalShot) await hooks.finalShot(c);
  else await c.tab.shot(`docs/product/qa/fase68-beta/screenshots/${shotPrefix}-coach-final-${c.width}.png`).catch(() => null);
  out.after = (await api(t, "/api/game/coach-matches")).json;
  out.historyGrew = typeof out.before === "number" && (out.after?.total ?? 0) === out.before + 1;
  out.ms = Date.now() - t0;
  return out;
}

if (process.argv[1]?.includes("_fase68-coach2")) (async () => {
  const p = process.argv[2]; const W = Number(process.argv[3] ?? 1440);
  const c = await openBrowser(p, W, { label: `coach2-${p}` });
  let out: any = {};
  try {
    const t = await token(p);
    await loginUi(c, p);
    out = await playCoach(c, t, `${p}`);
    await collectErrors(c);
    out.errors = c.errors; out.network = await net(c);
  } finally { await c.browser.close(); }
  writeRaw(`${p}-coach-play`, out);
  console.log(JSON.stringify({ clicks: out.clicks, final: out.final?.slice(0, 160), historyGrew: out.historyGrew, errors: out.errors?.length, ms: out.ms }));
})();
