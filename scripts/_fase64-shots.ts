/**
 * FASE 64 · MATRIZ VISUAL ANTES/DESPUÉS (instrumento `_`, fuera de CI) contra :3005, con una cuenta QA (nunca la del usuario).
 *
 *   npx tsx scripts/_fase64-shots.ts <before|after> <credsFile> [--only=/,/jugar] [--w=1440,390] [--reduced]
 *
 * Por ruta y ancho: captura, desbordes, imágenes rotas, errores de consola (incl. 404/429), y SEÑALES OBJETIVAS de «web»:
 * estilos de botón distintos, radios distintos, cajas con borde anidadas, emojis visibles, «mazo/plantilla», texto técnico,
 * spinners, peticiones y bytes de JS/imágenes. Salida: docs/product/qa/fase64-game-feel/<label>/matrix.json
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep, type Tab } from "./lib/cdp";

/* eslint-disable @typescript-eslint/no-explicit-any */
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3005";
const label = process.argv[2];
const credsFile = process.argv[3];
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7).split(",");
const widths = (process.argv.find((a) => a.startsWith("--w="))?.slice(4) ?? "1440,1024,390").split(",").map(Number);
const REDUCED = process.argv.includes("--reduced");
const OUT = join(process.cwd(), "docs/product/qa/fase64-game-feel", label);
mkdirSync(join(OUT, "screenshots"), { recursive: true });
const esc = (s: string) => JSON.stringify(s);

/** Rutas del producto (jugador). `anon` = sin sesión. */
export const ROUTES: { path: string; name: string; anon?: boolean }[] = [
  { path: "/", name: "home" },
  { path: "/jugar", name: "play" },
  { path: "/duelos/jugar", name: "pve-prematch" },
  { path: "/competitivo", name: "competitive" },
  { path: "/coleccion", name: "collection" },
  { path: "/duelos/mazos", name: "teams" },
  { path: "/duelos/mazos?nuevo=1", name: "team-builder" },
  { path: "/inventario", name: "my-packs" },
  { path: "/packs", name: "packs" },
  { path: "/abrir/inicial", name: "pack-sealed" },
  { path: "/tienda", name: "store" },
  { path: "/progresion", name: "progression" },
  { path: "/temporada", name: "season" },
  { path: "/logros", name: "achievements" },
  { path: "/jugador/me", name: "profile" },
  { path: "/jugar/draft-gauntlet", name: "draft" },
  { path: "/jugar/road-to-champions", name: "campaign" },
  { path: "/entrenador", name: "coach" },
  { path: "/pickems", name: "pickems" },
  { path: "/cuenta", name: "account" },
  { path: "/como-jugar", name: "how-to-play" },
  { path: "/esta-ruta-no-existe", name: "404" },
  { path: "/cuenta", name: "auth", anon: true },
  { path: "/", name: "home-anon", anon: true },
];

const SIGNALS = `(() => {
  const W = innerWidth; const vis = (e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 && b.bottom > 0 && b.top < innerHeight * 3 && getComputedStyle(e).visibility !== 'hidden'; };
  let over = 0; const overList = [];
  for (const e of document.querySelectorAll('body *')) {
    const b = e.getBoundingClientRect(); if (!b.width || !b.height) continue;
    if (b.right > W + 1 || b.left < -1) {
      let skip = !!e.closest('[aria-hidden="true"]') || !!e.closest('[data-testid="nexus-hall"]');
      for (let a = e; !skip && a && a !== document.body; a = a.parentElement) { const cs = getComputedStyle(a); if (Number(cs.opacity) === 0) skip = true; else if (a !== e && cs.overflowX !== 'visible') { const r = a.getBoundingClientRect(); if (r.left >= -1 && r.right <= W + 1) skip = true; } }
      if (!skip) { over++; if (overList.length < 5) overList.push((e.getAttribute('data-testid') || e.tagName) + ' ' + Math.round(b.left) + '..' + Math.round(b.right)); }
    }
  }
  const btns = [...document.querySelectorAll('button, a[href], [role="button"]')].filter(vis).filter(e => (e.innerText||'').trim().length > 1);
  const sig = new Set(btns.map(e => { const s = getComputedStyle(e); return [s.borderRadius, s.backgroundColor, s.textTransform, s.fontWeight, s.clipPath !== 'none' ? 'clip' : '', Math.round(parseFloat(s.fontSize))].join('|'); }));
  const all = [...document.querySelectorAll('main *, [data-testid="main-menu"] *')].filter(vis).slice(0, 4000);
  const radii = new Set(all.map(e => getComputedStyle(e).borderRadius).filter(r => r && r !== '0px'));
  const boxed = (e) => { const s = getComputedStyle(e); return parseFloat(s.borderTopWidth) > 0 && s.borderTopStyle !== 'none' && s.backgroundColor !== 'rgba(0, 0, 0, 0)'; };
  let nested = 0; for (const e of all) { if (!boxed(e)) continue; for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) { if (boxed(a)) { nested++; break; } } }
  const text = (document.querySelector('main') || document.body).innerText || '';
  const emoji = (text.match(/[\\u{1F300}-\\u{1FAFF}\\u{2600}-\\u{27BF}]/gu) || []);
  const legacy = (text.match(/\\b(mazos?|plantillas?)\\b/gi) || []);
  const technical = /(failed to fetch|networkerror|internal server error|typeerror|pgrst|supabase|undefined)/i.test(text) || /\bNaN\b/.test(text);
  const spinners = document.querySelectorAll('.animate-spin').length;
  const res = performance.getEntriesByType('resource');
  const js = res.filter(r => r.initiatorType === 'script' || /\\.js(\\?|$)/.test(r.name));
  const img = res.filter(r => r.initiatorType === 'img' || /\\.(webp|png|jpe?g|svg|avif)(\\?|$)/.test(r.name));
  const api = res.filter(r => /\\/api\\//.test(r.name));
  const imgs = [...document.images];
  return JSON.stringify({
    W, docScrollW: document.documentElement.scrollWidth, hScroll: document.documentElement.scrollWidth > W + 1, over, overList,
    buttonStyles: sig.size, buttons: btns.length, radii: radii.size, nestedBoxes: nested, emoji: emoji.length, emojiSample: [...new Set(emoji)].slice(0, 6),
    legacyTerms: legacy.length, legacySample: [...new Set(legacy.map(x => x.toLowerCase()))], technical, spinners,
    requests: res.length, apiRequests: api.length, jsKB: Math.round(js.reduce((s, r) => s + (r.transferSize || r.encodedBodySize || 0), 0) / 1024),
    images: imgs.length, imgKB: Math.round(img.reduce((s, r) => s + (r.transferSize || r.encodedBodySize || 0), 0) / 1024),
    broken: imgs.filter(i => i.complete && i.naturalWidth === 0).map(i => i.currentSrc || i.src).slice(0, 5),
    title: (document.querySelector('h1')?.innerText || '').slice(0, 60),
    cls: (window.__nxCls ?? null),
  });
})()`;

const CLS = `(() => { try { window.__nxCls = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__nxCls += e.value; }).observe({ type: 'layout-shift', buffered: true }); } catch {} })()`;

async function login(tab: Tab, c: { email: string; password: string }) {
  await tab.goto(`${BASE}/cuenta`, 3000);
  if (await tab.js<boolean>(`!!document.querySelector('input[type="password"]')`)) {
    await tab.js(`(() => { const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
      set(document.querySelector('input[type="email"]'), ${esc(c.email)}); set(document.querySelector('input[type="password"]'), ${esc(c.password)}); document.querySelector('form button[type="submit"]').click(); })()`);
    for (let i = 0; i < 100 && await tab.js<boolean>(`!!document.querySelector('input[type="password"]')`); i++) await sleep(200);
  }
}

async function main() {
  const creds = JSON.parse(readFileSync(credsFile, "utf8"));
  const rows: any[] = [];
  const routes = ROUTES.filter((r) => !only || only.includes(r.path) || only.includes(r.name));
  for (const anon of [false, true]) {
    const list = routes.filter((r) => !!r.anon === anon);
    if (!list.length) continue;
    const b = await launch({ args: ["--mute-audio", "--in-process-gpu", "--hide-scrollbars"] });
    try {
      await b.tab.resize(1440, 900, 1);
      await b.tab.setMedia([{ name: "prefers-reduced-motion", value: REDUCED ? "reduce" : "no-preference" }]);
      if (!anon) await login(b.tab, creds);
      for (const w of widths) {
        await b.tab.resize(w, w < 600 ? 844 : w === 1024 ? 768 : 900, 1);
        for (const r of list) {
          await sleep(2000); // el limitador corta ~15 navegaciones seguidas
          b.tab.takeErrors();
          await b.tab.goto(`${BASE}${r.path}`, 1200);
          await b.tab.js(CLS);
          for (let i = 0; i < 30 && !(await b.tab.js<boolean>(`!document.querySelector('[class*="z-[100]"][class*="bg-base-900"]')`)); i++) await sleep(200);
          await sleep(2600);
          const m = JSON.parse(await b.tab.js<string>(SIGNALS));
          const name = `${r.name}-${w}${REDUCED ? "-reduced" : ""}`;
          await b.tab.shot(join(OUT, "screenshots", `${name}.png`));
          const errors = b.tab.takeErrors();
          rows.push({ route: r.path, name: r.name, w, reduced: REDUCED, anon, ...m, errors: errors.map((e) => e.slice(0, 200)) });
          console.log(`${name} over=${m.over} btnStyles=${m.buttonStyles} radii=${m.radii} nested=${m.nestedBoxes} emoji=${m.emoji} legacy=${m.legacyTerms} spin=${m.spinners} err=${errors.length} cls=${m.cls?.toFixed?.(3)}`);
        }
      }
    } finally { await b.close(); }
  }
  const prev = (() => { try { return JSON.parse(readFileSync(join(OUT, "matrix.json"), "utf8")); } catch { return null; } })();
  const merged = prev && only ? [...prev.rows.filter((x: any) => !rows.some((y) => y.name === x.name && y.w === x.w && y.reduced === x.reduced)), ...rows] : rows;
  writeFileSync(join(OUT, "matrix.json"), JSON.stringify({ at: new Date().toISOString(), base: BASE, rows: merged }, null, 2));
}

main().catch((e) => { console.error("ERROR", e instanceof Error ? e.stack : e); process.exit(1); });
