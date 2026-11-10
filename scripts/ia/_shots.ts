/**
 * IA / SEASON HUB / ACCOUNT CONSOLIDATION · QA EN NAVEGADOR (instrumento de operador, fuera de CI y de la release).
 *
 *   BASE_URL=http://127.0.0.1:3011 npx tsx scripts/ia/_shots.ts                          (sin sesión)
 *   BASE_URL=https://valorosters.com QA_SESSION_FILE=<sesión QA> QA_TAG=prod npx tsx scripts/ia/_shots.ts
 *
 * Sin sesión: hub de Temporada (3 áreas, foco visible), Tienda (tarjeta del pase, sin Centro de eventos en la hoja móvil).
 * Con sesión además: icono de usuario → Mi cuenta (Perfil · Progresión · Cuenta · Dar feedback), Objetivos, Crafteo
 * (Cartas · Sobres), Cartas → Recetas avanzadas, redirecciones /progresion y /feedback, perfil público.
 * 1440 / 1024 / 390, normal y movimiento reducido.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openBrowser, sleep, type Client } from "../_fase68-lib";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3011";
const SESSION = process.env.QA_SESSION_FILE ? readFileSync(process.env.QA_SESSION_FILE, "utf8") : null;
const OUT = join(process.cwd(), "docs/product/qa/ia-consolidation", process.env.QA_TAG ?? "local");
mkdirSync(OUT, { recursive: true });
const checks: { id: string; w: number; name: string; ok: boolean; detail?: unknown }[] = [];
const check = (id: string, w: number, name: string, ok: boolean, detail?: unknown) => { checks.push({ id, w, name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} [${id} ${w}] ${name}${ok ? "" : ` ${JSON.stringify(detail)?.slice(0, 300)}`}`); };
async function waitFor(c: Client, expr: string, ms = 25000) { for (let i = 0; i < ms / 200; i++) { if (await c.tab.js<boolean>(expr).catch(() => false)) return true; await sleep(200); } return false; }
const OVER = `document.documentElement.scrollWidth - innerWidth`;
const href = () => `location.pathname + location.search`;

async function pass(w: number, reduced: boolean) {
  const tag = `${w}${reduced ? "-reduced" : ""}`;
  const c = await openBrowser("QA", w, { reduced, label: `ia-${tag}` });
  const shot = (n: string) => c.tab.shot(join(OUT, `${n}-${tag}.png`));
  try {
    if (SESSION) { await c.tab.goto(`${BASE}/robots.txt`, 300); await c.tab.setStorage("sb-valorosters-auth-token", SESSION); }

    // ── HUB DE TEMPORADA ──
    await c.tab.goto(`${BASE}/temporada`, 2000);
    const hub = await waitFor(c, `!!document.querySelector('[data-testid="season-areas"]')`);
    await sleep(reduced ? 300 : 900);
    const h = await c.tab.js<any>(`({ areas: [...document.querySelectorAll('[data-testid^="season-area-"]:not([data-testid*="cta"])')].map((e) => e.querySelector('h2')?.innerText.trim()),
      ctas: [...document.querySelectorAll('[data-testid^="season-area-cta-"]')].map((a) => a.getAttribute('href')), over: ${OVER} })`);
    check("hub", w, "Temporada → exactamente Pase de batalla · Objetivos · Crafteo, con sus destinos", hub && JSON.stringify(h.areas).toUpperCase() === JSON.stringify(["PASE DE BATALLA", "OBJETIVOS", "CRAFTEO"]) && JSON.stringify(h.ctas) === JSON.stringify(["/temporada/pase", "/misiones", "/misiones/crafting"]), h);
    check("hub", w, "sin desbordamiento", h.over <= 0, h.over);
    await c.tab.js(`document.querySelector('[data-testid="season-area-cta-PASS"]').focus()`);
    const focus = await c.tab.js<any>(`(() => { const a = document.activeElement; return { id: a?.dataset.testid, outline: getComputedStyle(a).outlineStyle, shadow: getComputedStyle(a).boxShadow }; })()`);
    check("hub", w, "las tarjetas son enlaces enfocables (teclado)", focus.id === "season-area-cta-PASS", focus);
    await shot("hub");

    // ── TIENDA ──
    await c.tab.goto(`${BASE}/tienda`, 2000);
    await waitFor(c, `!!document.querySelector('[data-testid="store-battle-pass"]')`);
    await sleep(500);
    const t = await c.tab.js<any>(`({ pass: document.querySelector('[data-testid="store-battle-pass"]')?.getAttribute('href'), line: document.querySelector('[data-testid="store-battle-pass-premium"]')?.innerText,
      eventos: [...document.querySelectorAll('main a')].some((a) => /\\/eventos/.test(a.getAttribute('href') ?? '')), comprado: /comprad/i.test(document.querySelector('[data-testid="store-battle-pass"]')?.innerText ?? ''), over: ${OVER} })`);
    check("tienda", w, "tarjeta PASE DE BATALLA → pase canónico; premium «próximamente»; nunca «comprado»", t.pass === "/temporada/pase?desde=tienda" && /próximamente/.test(t.line ?? "") && !t.comprado, t);
    check("tienda", w, "la Tienda no enlaza al Centro de eventos; sin desbordamiento", !t.eventos && t.over <= 0, t);
    await c.tab.js(`document.querySelector('[data-testid="store-battle-pass"]').scrollIntoView({ block: 'center' })`); await sleep(300);
    await shot("tienda");
    if (w < 1024) {
      await c.tab.js(`document.querySelector('[data-testid="shell-menu"]')?.click()`); await sleep(700);
      const sheet = await c.tab.js<any>(`(() => { const d = document.querySelector('[role="dialog"]'); const t = d?.innerText ?? ''; return { tiendaEventos: /centro de eventos/i.test(t), pase: /pase de batalla/i.test(t), prog: /\\bprogresi[oó]n\\b/i.test(t), feedback: /dar feedback/i.test(t), perfil: /mi perfil/i.test(t) }; })()`);
      check("menu", w, "hoja «Menú»: sin Centro de eventos, Progresión, Mi perfil ni Dar feedback; con Pase de batalla", !sheet.tiendaEventos && sheet.pase && !sheet.prog && !sheet.feedback && !sheet.perfil, sheet);
      await shot("menu");
    }

    if (!SESSION) return;

    // ── ICONO DE USUARIO → MI CUENTA ──
    await c.tab.goto(`${BASE}/tienda`, 1500);
    await waitFor(c, `!!document.querySelector('[data-testid="shell-account"]')`);
    const icon = await c.tab.js<any>(`(() => { const a = document.querySelector('[data-testid="shell-account"]'); const r = a?.getBoundingClientRect(); return { label: a?.getAttribute('aria-label'), title: a?.getAttribute('title'), svg: !!a?.querySelector('svg'), w: r ? Math.round(r.width) : 0, visible: !!r && r.width > 0 && r.right <= innerWidth }; })()`);
    check("icono", w, "icono de usuario visible arriba a la derecha (aria-label/title «Mi cuenta», SVG, 44 px)", icon.label === "Mi cuenta" && icon.title === "Mi cuenta" && icon.svg && icon.w >= 44 && icon.visible, icon);
    await c.tab.js(`document.querySelector('[data-testid="shell-account"]').click()`);
    const toAccount = await waitFor(c, `!!document.querySelector('[data-testid="account-hub"]')`);
    check("icono", w, "pulsarlo abre Mi cuenta", toAccount && (await c.tab.js<string>(href())).startsWith("/cuenta"), await c.tab.js(href()));

    // Perfil
    await waitFor(c, `!!document.querySelector('[data-testid="player-profile-screen"]')`);
    await sleep(600);
    const pf = await c.tab.js<any>(`({ tabs: [...document.querySelectorAll('[data-testid^="account-tab-"]')].map((a) => a.innerText.trim().toUpperCase()), cur: document.querySelector('[aria-current="page"][data-testid^="account-tab-"]')?.dataset.testid,
      profile: !!document.querySelector('[data-testid="player-profile-screen"]'), edit: !!document.querySelector('[data-action="edit"]'), signout: !!document.querySelector('[data-action="sign-out"]'), feedback: !!document.querySelector('[data-testid="account-feedback"]'), over: ${OVER} })`);
    check("cuenta", w, "Mi cuenta → Perfil (por defecto): pestañas PERFIL · PROGRESIÓN · CUENTA; tu identidad con editar y cerrar sesión", JSON.stringify(pf.tabs) === JSON.stringify(["PERFIL", "PROGRESIÓN", "CUENTA"]) && pf.cur === "account-tab-perfil" && pf.profile && pf.edit && pf.signout, pf);
    check("cuenta", w, "botón DAR FEEDBACK en la cabecera; sin desbordamiento", pf.feedback && pf.over <= 0, pf);
    await shot("cuenta-perfil");

    // Progresión
    await c.tab.js(`document.querySelector('[data-testid="account-tab-progresion"]').click()`);
    const prog = await waitFor(c, `!!document.querySelector('[data-testid="account-section-progresion"] [data-testid="claim-center"]')`);
    await sleep(500);
    const pr = await c.tab.js<any>(`({ url: ${href()}, claims: document.querySelector('[data-testid="claim-center"]')?.dataset.count, hero: !!document.querySelector('[data-testid="hub-hero"]'), history: !!document.querySelector('[data-testid="progress-rewards-history"]'), over: ${OVER} })`);
    check("cuenta", w, "Progresión dentro de Mi cuenta: centro de reclamos, progreso y enlace al historial", prog && pr.url === "/cuenta?seccion=progresion" && pr.hero && pr.history, pr);
    await shot("cuenta-progresion");

    // Cuenta (ajustes)
    await c.tab.js(`document.querySelector('[data-testid="account-tab-cuenta"]').click()`);
    const st = await waitFor(c, `!!document.querySelector('[aria-label="Ajustes del perfil"]')`);
    check("cuenta", w, "Cuenta: los ajustes de siempre (avatar, región, sonido)", st, await c.tab.js(href()));
    await shot("cuenta-ajustes");

    // Feedback
    await c.tab.js(`document.querySelector('[data-testid="account-feedback"]').click()`);
    const fb = await waitFor(c, `!!document.querySelector('[data-testid="account-section-feedback"] form, [data-testid="account-section-feedback"] textarea')`);
    check("feedback", w, "Dar feedback abre el formulario real dentro de Mi cuenta", fb && (await c.tab.js<string>(href())) === "/cuenta?seccion=feedback", await c.tab.js(href()));
    await shot("cuenta-feedback");

    // Redirecciones
    await c.tab.goto(`${BASE}/progresion`, 1500);
    await waitFor(c, `location.pathname === "/cuenta"`, 15000);
    check("redirect", w, "/progresion → Mi cuenta → Progresión", (await c.tab.js<string>(href())) === "/cuenta?seccion=progresion", await c.tab.js(href()));
    await c.tab.goto(`${BASE}/feedback?desde=cup`, 1500);
    await waitFor(c, `location.pathname === "/cuenta"`, 15000);
    check("redirect", w, "/feedback?desde=cup → Mi cuenta → Dar feedback (conserva el origen)", (await c.tab.js<string>(href())) === "/cuenta?seccion=feedback&desde=cup", await c.tab.js(href()));

    // Objetivos
    await c.tab.goto(`${BASE}/misiones`, 2000);
    const ob = await waitFor(c, `!!document.querySelector('[data-testid="pass-objectives"] #objetivos') && !!document.querySelector('[data-testid="special-missions-title"]')`);
    const o = await c.tab.js<any>(`({ groups: document.querySelectorAll('[data-testid="pass-objectives"] [data-group]').length, title: document.querySelector('h1')?.innerText, pickem: /Haz una predicci/i.test(document.body.innerText), over: ${OVER} })`);
    check("objetivos", w, "Objetivos: objetivos del pase por tipo + misiones especiales; sin desbordamiento", ob && o.groups > 0 && !o.pickem && o.over <= 0, o);
    await shot("objetivos");

    // Pase de batalla
    await c.tab.goto(`${BASE}/temporada/pase`, 2000);
    const ps = await waitFor(c, `/temporada/i.test(document.querySelector('main')?.innerText ?? '') && !document.querySelector('[data-testid="season-areas"]')`);
    const pp = await c.tab.js<any>(`({ comprado: /\\bcomprado\\b/i.test(document.body.innerText), over: ${OVER} })`);
    check("pase", w, "Pase de batalla: la pantalla canónica de temporada (no el hub); sin «comprado»; sin desbordamiento", ps && !pp.comprado && pp.over <= 0, pp);
    await shot("pase");

    // Crafteo
    await c.tab.goto(`${BASE}/misiones/crafting`, 2000);
    const cr = await waitFor(c, `!!document.querySelector('[data-testid="crafting-options"]')`);
    const co = await c.tab.js<any>(`({ opts: [...document.querySelectorAll('[data-testid="crafting-options"] a')].map((a) => a.getAttribute('href')), avanzado: !!document.querySelector('[data-testid="crafting-entry-avanzado"]'), over: ${OVER} })`);
    check("crafteo", w, "Crafteo: SOLO Cartas · Sobres", cr && JSON.stringify(co.opts) === JSON.stringify(["/misiones/crafting/cartas", "/misiones/crafting/sobres"]) && !co.avanzado && co.over <= 0, co);
    await shot("crafteo");
    await c.tab.js(`document.querySelector('[data-testid="crafting-entry-cartas"]').click()`);
    const ca = await waitFor(c, `!!document.querySelector('[data-testid="cards-advanced-link"]')`);
    check("crafteo", w, "Crafteo → Cartas: intercambio · proyectos y acceso a Recetas avanzadas", ca && (await c.tab.js<string>(`location.pathname`)) === "/misiones/crafting/cartas", await c.tab.js(href()));
    await shot("crafteo-cartas");
    await c.tab.goto(`${BASE}/misiones/crafting/sobres`, 2000);
    const so = await waitFor(c, `/Forja de sobres/i.test(document.body.innerText)`);
    check("crafteo", w, "Crafteo → Sobres: la forja de sobres canónica (no la compra)", so && (await c.tab.js<number>(OVER)) <= 0, null);
    await shot("crafteo-sobres");

    // Perfil público
    await c.tab.goto(`${BASE}/jugador/me`, 2500);
    const pub = await waitFor(c, `/^\\/jugador\\/[0-9a-f-]{36}$/.test(location.pathname) && !!document.querySelector('[data-testid="player-profile-screen"]')`);
    check("publico", w, "/jugador/me → /jugador/<id>: el perfil sigue funcionando", pub, await c.tab.js(href()));
  } finally { await c.browser.close().catch(() => null); }
}

(async () => {
  for (const w of [1440, 1024, 390]) { await pass(w, false); await pass(w, true); }
  const failed = checks.filter((x) => !x.ok);
  writeFileSync(join(OUT, "checks.json"), JSON.stringify({ base: BASE, session: !!SESSION, at: new Date().toISOString(), total: checks.length, failed: failed.length, checks }, null, 2));
  console.log(`\n${checks.length - failed.length}/${checks.length} PASS`);
  process.exit(failed.length ? 1 : 0);
})();
