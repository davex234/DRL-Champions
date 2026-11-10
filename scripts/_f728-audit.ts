/**
 * F72.8 · AUDITORÍA DEL RENDER DE LAS PISTAS (fuera de CI) — Chrome real contra BASE_URL (por defecto :3005).
 *
 * Lo que `elementsFromPoint` NO ve: capas con `pointer-events:none`, pseudo-elementos y fondos de antepasados. Para la
 * primera pista con vecino a la derecha vuelca: (1) cadena completa de antepasados con TODO lo que puede alterar el
 * color (filter, backdrop, opacity, blend, mask, isolation, transform, will-change); (2) todo elemento o ::before/::after
 * del documento que SOLAPA el rectángulo de la pista y no es antepasado suyo; (3) captura a escala 4.
 * Se ejecuta con movimiento reducido y sin él (el Chrome del usuario reporta `reduce`).
 *
 *   npx tsx scripts/_f728-audit.ts [persona=A] [ancho=1440]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openBrowser, loginUi, goto, sleep, waitFor, token, api, type Client } from "./_fase68-lib";

const P = process.argv[2] ?? "A";
const W = Number(process.argv[3] ?? 1440);
const OUT = join(process.cwd(), "docs/product/qa/fase72-8/audit");
mkdirSync(OUT, { recursive: true });

async function reachBoard(c: Client): Promise<boolean> {
  await goto(c, "/jugar", 2500);
  await c.tab.js(`document.querySelector('[data-testid="play-area-cta-DUELS"]')?.click()`);
  await waitFor(c.tab, `location.pathname === '/duelos' && !!document.querySelector('[data-testid="duel-mode-cta-QUICK"]')`, 15000);
  await c.tab.js(`document.querySelector('[data-testid="duel-mode-cta-QUICK"]')?.click()`);
  await sleep(3500);
  if (await c.tab.js<boolean>(`/Comenzar duelo/i.test(document.body.innerText)`)) {
    await c.tab.js(`[...document.querySelectorAll('button')].find(b => /^Comenzar duelo$/i.test((b.innerText||'').trim()))?.click()`);
    await sleep(3000);
  }
  return waitFor(c.tab, `(() => { document.querySelector('[data-f61="moment"]')?.click(); return document.querySelectorAll('[data-testid="rival-hint"]').length > 0 && !document.querySelector('[data-scene="intro"]'); })()`, 30000);
}

const DUMP = `(() => {
  const arts = [...document.querySelectorAll('[data-hint-art]')]; const a = arts[Math.max(0, Math.floor(arts.length / 2) - 1)]; if (!a) return null;
  const r = a.getBoundingClientRect();
  const KEYS = ['position','zIndex','filter','backdropFilter','opacity','mixBlendMode','backgroundBlendMode','isolation','transform','willChange','maskImage','clipPath','pointerEvents','visibility','boxShadow','color'];
  const pick = (cs) => { const o = {}; for (const k of KEYS) { const v = cs[k]; if (v && !['none','normal','auto','1','visible','static','0px','rgba(0, 0, 0, 0)'].includes(v)) o[k] = String(v).slice(0, 140); } return o; };
  const name = (e) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\\s+/).slice(0, 4).join('.') : '');
  const anc = []; for (let e = a; e; e = e.parentElement) anc.push(e);
  const chain = anc.map((e) => ({ el: name(e).slice(0, 110), ...pick(getComputedStyle(e)), bg: getComputedStyle(e).backgroundImage.slice(0, 90) }));
  const hit = (b) => b.width > 0 && b.height > 0 && b.left < r.right && b.right > r.left && b.top < r.bottom && b.bottom > r.top;
  const over = [];
  for (const e of document.querySelectorAll('body *')) {
    if (anc.includes(e) || a.contains(e)) continue;
    const b = e.getBoundingClientRect(); if (!hit(b)) continue;
    const cs = getComputedStyle(e);
    const pos = a.compareDocumentPosition(e); const after = !!(pos & Node.DOCUMENT_POSITION_FOLLOWING);
    const paints = cs.backgroundImage !== 'none' || cs.backgroundColor !== 'rgba(0, 0, 0, 0)' || cs.boxShadow !== 'none' || cs.filter !== 'none' || cs.backdropFilter !== 'none' || cs.mixBlendMode !== 'normal';
    if (!paints || cs.visibility === 'hidden' || cs.display === 'none') continue;
    over.push({ el: name(e).slice(0, 110), after, fixed: cs.position === 'fixed', ...pick(cs), bg: cs.backgroundImage.slice(0, 90), bgc: cs.backgroundColor });
  }
  const pseudo = [];
  for (const e of [document.documentElement, document.body, ...document.querySelectorAll('body *')]) for (const p of ['::before', '::after']) {
    const cs = getComputedStyle(e, p); if (cs.content === 'none' || cs.content === 'normal' || cs.display === 'none') continue;
    const b = e.getBoundingClientRect(); const fixed = cs.position === 'fixed';
    if (!fixed && !hit(b)) continue;
    if (cs.backgroundImage === 'none' && cs.backgroundColor === 'rgba(0, 0, 0, 0)' && cs.boxShadow === 'none' && cs.mixBlendMode === 'normal') continue;
    pseudo.push({ el: name(e).slice(0, 90) + p, ancestor: anc.includes(e), fixed, ...pick(cs), bg: cs.backgroundImage.slice(0, 90), bgc: cs.backgroundColor });
  }
  return { reduced: matchMedia('(prefers-reduced-motion: reduce)').matches, rect: [r.left, r.top, r.width, r.height], art: a.outerHTML.slice(0, 400), chain, over, pseudo };
})()`;

(async () => {
  const t = await token(P);
  const duel = (body: any) => api(t, "/api/game/duel", body);
  for (const reduced of [true, false]) {
    const stale = (await duel({ action: "active" })).json?.view?.matchId;
    if (stale) await duel({ action: "abandon", matchId: stale });
    const c = await openBrowser(P, W, { label: "f728", reduced });
    try {
      await loginUi(c, P);
      if (!(await reachBoard(c))) throw new Error("sin tablero");
      await sleep(2500);
      const d = await c.tab.js<any>(DUMP);
      const tag = `${W}-${reduced ? "reducido" : "normal"}`;
      writeFileSync(join(OUT, `audit-${tag}.json`), JSON.stringify(d, null, 2));
      const box = await c.tab.js<any>(`(() => { const r = document.querySelector('[data-testid="rival-hand"]').getBoundingClientRect(); return { x: r.left - 8, y: r.top - 8, width: r.width + 16, height: r.height + 16 }; })()`);
      const s = await c.tab.send("Page.captureScreenshot", { format: "png", clip: { ...box, scale: 4 } });
      writeFileSync(join(OUT, `mano-${tag}.png`), Buffer.from(s.data, "base64"));
      console.log(`== ${tag} reduced=${d.reduced} over=${d.over.length} pseudo=${d.pseudo.length}`);
      console.log(JSON.stringify({ chain: d.chain, over: d.over, pseudo: d.pseudo }, null, 1).slice(0, 9000));
    } finally {
      await c.browser.close().catch(() => null);
      const left = (await duel({ action: "active" })).json?.view?.matchId;
      if (left) await duel({ action: "abandon", matchId: left });
    }
  }
})();
