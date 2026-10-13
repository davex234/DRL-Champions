/**
 * F72.6 · DIAGNÓSTICO (fuera de CI): qué contamina el color de las pistas. Llega al tablero como F72.3 y vuelca, para
 * la primera pista, (a) todo lo que hay en su centro según elementsFromPoint y (b) la cadena de ancestros con cualquier
 * filter / opacity / mix-blend-mode / backdrop-filter que no sea el neutro. Deja captura a escala 4 de la mano.
 *
 *   npx tsx scripts/_f726-diag.ts [persona=A] [ancho=1440]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openBrowser, loginUi, goto, sleep, waitFor, type Client } from "./_fase68-lib";

const P = process.argv[2] ?? "A";
const W = Number(process.argv[3] ?? 1440);
const OUT = join(process.cwd(), "docs/product/qa/fase72-6");
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
  const a = document.querySelector('[data-hint-art]'); if (!a) return null;
  const r = a.getBoundingClientRect(); const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const d = (e) => { const cs = getComputedStyle(e); return { tag: e.tagName, cls: String(e.className || '').slice(0, 90), z: cs.zIndex, pos: cs.position,
    filter: cs.filter, opacity: cs.opacity, blend: cs.mixBlendMode, bgBlend: cs.backgroundBlendMode, backdrop: cs.backdropFilter, iso: cs.isolation,
    bg: cs.backgroundImage.slice(0, 80), bgc: cs.backgroundColor }; };
  const stack = document.elementsFromPoint(cx, cy).map(d);
  const chain = []; for (let e = a; e; e = e.parentElement) { const x = d(e);
    if (x.filter !== 'none' || x.opacity !== '1' || x.blend !== 'normal' || x.backdrop !== 'none' || x.bgBlend !== 'normal' || e === a) chain.push(x); }
  const pseudo = []; for (let e = a; e; e = e.parentElement) for (const p of ['::before', '::after']) { const cs = getComputedStyle(e, p);
    if (cs.content !== 'none' && cs.content !== 'normal') pseudo.push({ cls: String(e.className || '').slice(0, 60), p, blend: cs.mixBlendMode, bg: cs.backgroundImage.slice(0, 80), z: cs.zIndex, pos: cs.position, opacity: cs.opacity }); }
  return { rect: [r.left, r.top, r.width, r.height], stack, chain, pseudo };
})()`;

async function main() {
const c = await openBrowser(P, W, { label: "f726" });
try {
  await loginUi(c, P);
  if (!(await reachBoard(c))) throw new Error("sin tablero con pistas");
  await sleep(1500);
  const dump = await c.tab.js<any>(DUMP);
  writeFileSync(join(OUT, `diag-${W}.json`), JSON.stringify(dump, null, 2));
  console.log(JSON.stringify(dump, null, 2));
  const box = await c.tab.js<any>(`(() => { const rs = [...document.querySelectorAll('[data-testid="rival-hint"]')].map(e => e.getBoundingClientRect());
    const l = Math.min(...rs.map(r => r.left)), t = Math.min(...rs.map(r => r.top)); return { x: l - 6, y: t - 6, width: Math.max(...rs.map(r => r.right)) - l + 12, height: Math.max(...rs.map(r => r.bottom)) - t + 12 }; })()`);
  const s = await c.tab.send("Page.captureScreenshot", { format: "png", clip: { ...box, scale: 4 } }).catch(() => null);
  if (s?.data) writeFileSync(join(OUT, `diag-mano-${W}.png`), Buffer.from(s.data, "base64"));
  await goto(c, "/jugar", 800);
} finally {
  await c.browser.close().catch(() => null);
}
}
main().catch((e) => { console.error(e); process.exit(1); });
