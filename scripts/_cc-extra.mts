/** Instrumento (fuera de CI/release): limpieza de /coleccion — comprobaciones extra en producción con la QA M. */
import { join } from "node:path";
import { openBrowser, sleep, token, api } from "./_fase68-lib";
const BASE = "https://valorosters.com", OUT = join(process.cwd(), "docs/product/qa/collection-cleanup/prod");
const KEY = process.env.QA_SESSION_KEY!, SES = process.env.QA_SESSION!;
let ok = 0, ko = 0; const check = (n: string, b: boolean, d?: unknown) => { b ? ok++ : ko++; console.log(`${b ? "PASS" : "FAIL"} ${n}${b ? "" : " " + JSON.stringify(d)}`); };
const wait = async (c: any, e: string, ms = 30000) => { for (let i = 0; i < ms / 250; i++) { if (await c.tab.js(e).catch(() => false)) return true; await sleep(250); } return false; };
const t = await token("M");
const mastery = (await api(t, "/api/game/mastery")).json; const sets = (await api(t, "/api/game/collection-sets")).json;
const st = (await api(t, "/api/game/state")).json;
for (const w of [1024]) {
  const c = await openBrowser("QA", w, { label: `cc-x-${w}` });
  try {
    await c.tab.goto(`${BASE}/robots.txt`, 300); await c.tab.setStorage(KEY, SES);
    await c.tab.goto(`${BASE}/coleccion/trofeos`, 1500);
    await wait(c, `!!document.querySelector('[aria-label="Maestría de colección"]')`);
    const r = await c.tab.js<any>(`(() => ({ panels: document.querySelectorAll('[aria-label="Maestría de colección"]').length, prestige: document.querySelectorAll('[aria-label="Prestigio"]').length,
      mtext: document.querySelector('[aria-label="Maestría de colección"]').innerText, tiles: document.querySelectorAll('[data-testid="set-grid"] > *').length,
      statSets: document.querySelector('[data-testid="stat-sets"]')?.innerText, overflow: document.documentElement.scrollWidth - innerWidth }))()`);
    check(`1024 trofeos: UNA Maestría, sin desbordamiento`, r.panels === 1 && r.overflow <= 0, r);
    check(`1024 trofeos: ${sets.sets.length} sets F82 = API`, r.tiles === sets.sets.length, { ui: r.tiles, api: sets.sets.length });
    check(`1024 trofeos: Colecciones ${sets.totals.setsCompleted}/${sets.totals.sets} = API`, (r.statSets || "").includes(`${sets.totals.setsCompleted}/${sets.totals.sets}`), r.statSets);
    const n = mastery.sets.length; check(`Maestría cuenta ${n} conjuntos (API)`, new RegExp(String(n)).test(r.mtext), r.mtext.slice(0, 200));
    const first = mastery.sets[0]; check(`Maestría: progreso ${first.label} ${first.owned}/${first.total} = API`, r.mtext.includes(`${first.owned}/${first.total}`) || r.mtext.includes(`${first.owned} / ${first.total}`), r.mtext.slice(0, 400));
    check("Prestigio oculto sin insignias (regla F14: sin insignias, no hay panel); API owned=[]", r.prestige === 0, r.prestige);
    await c.tab.shot(join(OUT, `E-trofeos-top-1024.png`));
    await c.tab.js(`document.querySelector('[aria-label="Maestría de colección"]').scrollIntoView({ block: 'start' })`); await sleep(500);
    await c.tab.shot(join(OUT, `E-trofeos-maestria-1024.png`));
    // /coleccion: búsqueda, filtro, orden, ficha.
    await c.tab.goto(`${BASE}/coleccion`, 1500);
    await wait(c, `!!document.querySelector('[data-testid="collection-room"][data-access="server"] [data-card]')`);
    const own = st.ownedCards[0].cardId as string;
    await c.tab.js(`(() => { const sel = document.querySelector('[data-testid="collection-sort"]'); const d = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value'); d.set.call(sel, [...sel.options].at(-1).value); sel.dispatchEvent(new Event('change',{bubbles:true})); })()`); await sleep(800);
    check("orden cambia la URL (?orden)", /orden=|sort=/.test(await c.tab.js<string>("location.search")), await c.tab.js("location.search"));
    await c.tab.js(`[...document.querySelectorAll('[role="radio"], button')].find(b => /^Poseídas$/i.test(b.textContent.trim()))?.click()`); await sleep(800);
    const cnt = await c.tab.js<string>(`document.querySelector('#album-title')?.parentElement?.innerText || ''`);
    const distinct = new Set(st.ownedCards.map((x: any) => x.cardId)).size;
    check(`filtro «Poseídas» = ${distinct} cartas propias`, cnt.includes(String(distinct)), cnt);
    const nick = await c.tab.js<string>(`(document.querySelector('[data-testid="collection-album"] [data-card] [aria-label]')?.getAttribute('aria-label') || document.querySelector('[data-testid="collection-album"] a[aria-label]')?.getAttribute('aria-label') || '').split(',')[0]`);
    await c.tab.js(`(() => { const i = document.querySelector('[data-testid="collection-search"]'); const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value'); d.set.call(i, ${JSON.stringify("")} + ${JSON.stringify("x")}.slice(1) + arguments.length); })()`).catch(() => null);
    await c.tab.js(`(() => { const i = document.querySelector('[data-testid="collection-search"]'); const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value'); d.set.call(i, ${JSON.stringify("NICK")}.replace('NICK', document.querySelector('[data-testid="discovery-top"] a')?.getAttribute('aria-label')?.replace('Abrir ficha de ','').split(',')[0] || '')); i.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    await sleep(1200);
    check("búsqueda escribe en la URL (?q=)", /[?&]q=/.test(await c.tab.js<string>("location.search")), { s: await c.tab.js("location.search"), nick });
    await c.tab.js(`document.querySelector('[data-testid="discovery-top"] a').click()`);
    const card = await wait(c, `location.pathname.startsWith('/coleccion/carta/')`, 15000);
    check("ficha de carta abre desde «mayor OVR»", card, await c.tab.js("location.pathname"));
    void own;
    // Inventario por el desplegable.
    await c.tab.goto(`${BASE}/coleccion`, 1500);
    await c.tab.js(`document.querySelector('a.nx-gamebar-link[href="/coleccion"]').focus()`);
    await c.tab.send("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40 }); await sleep(400);
    await c.tab.js(`document.querySelector('[data-menu-style] a[href="/inventario"]').click()`);
    const inv = await wait(c, `location.pathname === '/inventario' && /sobres|Inventario/i.test(document.querySelector('main')?.innerText || '')`, 15000);
    check("INVENTARIO navega a /inventario y carga", inv, await c.tab.js("location.pathname"));
    await sleep(1000); await c.tab.shot(join(OUT, `G-inventario-1024.png`));
    // /colecciones legado intacto.
    await c.tab.goto(`${BASE}/colecciones`, 2500);
    check("/colecciones (legado) sigue respondiendo", await wait(c, `/Colecciones/i.test(document.querySelector('h1')?.innerText || '')`, 15000));
  } finally { await c.browser.close().catch(() => null); }
}
console.log(`\n${ok}/${ok + ko} PASS`);
