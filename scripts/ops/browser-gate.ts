/**
 * F70.1 · GATE DE NAVEGADOR REAL — `npm run gate:browser`.
 *
 * Por qué existe: la RC F70 pasó 5.420 tests, smoke 74/74 y un recorrido 14/14, y aun así el usuario vio rutas que
 * pintaban la portada, «Failed to fetch» en /tienda/creditos y en la compra, y un login que «no hacía nada». Todo
 * venía de lo mismo: la app de :3005 había caído y el service worker lo tapaba sirviendo la portada cacheada.
 * Ningún gate miraba lo que ve el NAVEGADOR del usuario, con su service worker, contra el servidor en marcha.
 *
 * Qué comprueba, en Chrome real, mismo origen que el usuario (BASE_URL, por defecto http://127.0.0.1:3005), perfil
 * persistente (el service worker se instala y CONTROLA las cargas siguientes) y sin simular fetch:
 *   1. el servidor responde (/, /api/health, /api/ready) y el navegador llega a la API y a Supabase (Kong);
 *   2. login por el formulario → sesión en el navegador → /api/game/me 200 con esa sesión → sigue tras recargar;
 *   3. matriz de rutas por URL directa Y por clic: URL final correcta, página correcta (su marca), respuesta de
 *      red real (no la página offline ni la portada), 0 fetch fallidos, 0 errores de consola;
 *   4. atrás/adelante; 5. compra real de un Sobre Bronce: saldo −precio exacto, +1 sobre, persiste tras recargar;
 *   6. 390 px; 7. logout → sesión cerrada de verdad (sin token y con formulario).
 *   F72 · DUELS 2.0: /duelos es un selector (elegir no navega). FLOW 1 partida rápida; FLOW 2 COMPETITIVO con el
 *   rango/rating REAL inline → JUGAR → cola ranked directa (registro de navegación: nunca pasa por /competitivo; se
 *   cancela la búsqueda); FLOW 3 DRAFT: coste visible → ENTRAR → CONFIRMAR → cobro EXACTO (una vez) → 3 cartas con
 *   efectos → elegir → confirmar → persiste tras recargar → /duelos dice CONTINUAR sin segundo cobro.
 *   `GATE_DRAFT_ENTRY=0` salta el cobro (si ya hay run, solo comprueba CONTINUAR). Por defecto, si hay una run activa
 *   se abandona por la API y se entra de nuevo (cuesta la entrada: usa una cuenta QA con saldo).
 *
 * Credenciales: QA_GATE_EMAIL / QA_GATE_PASSWORD (una cuenta QA; nunca la del usuario). Sale 1 si algo falla.
 * Escribe docs/product/qa/fase70-1/browser-gate.json (sin secretos).
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { launch, type Tab } from "../lib/cdp";
import { qaPassword } from "../lib/qaCredentials";

/* eslint-disable @typescript-eslint/no-explicit-any */
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3005";
const OUT = join(process.cwd(), "docs/product/qa/fase70-1");
const EMAIL = qaPassword("QA_GATE_EMAIL");
const PASSWORD = qaPassword("QA_GATE_PASSWORD");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const envLocal: Record<string, string> = existsSync(".env.local")
  ? Object.fromEntries(readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^NEXT_PUBLIC_[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "").trim()]))
  : {};
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? envLocal.NEXT_PUBLIC_SUPABASE_URL ?? "";
// valorosters.com · con NEXT_PUBLIC_SUPABASE_SAME_ORIGIN=1 el navegador habla con Supabase por SU origen (src/lib/supabase/client.ts).
const SB_SAME_ORIGIN = (process.env.NEXT_PUBLIC_SUPABASE_SAME_ORIGIN ?? envLocal.NEXT_PUBLIC_SUPABASE_SAME_ORIGIN) === "1";

const results: { id: string; ok: boolean; detail: string }[] = [];
const check = (id: string, ok: boolean, detail = "") => { results.push({ id, ok, detail: detail.slice(0, 300) }); console.log(`${ok ? "PASS" : "FAIL"} ${id} ${detail.slice(0, 160)}`); };

// Fetch fallidos por RED (TypeError), registrados en la propia página desde antes de que cargue su código.
const FETCH_OBS = `(() => { try { const K='__gatefetch'; const of = window.fetch; window.fetch = async (...a) => {
  try { return await of(...a); } catch (e) { try { const u = typeof a[0] === 'string' ? a[0] : (a[0] && a[0].url) || ''; const l = JSON.parse(sessionStorage.getItem(K) || '[]');
    l.push({ url: String(u).replace(/[?#].*/, ''), page: location.pathname, error: String(e && e.message || e) }); sessionStorage.setItem(K, JSON.stringify(l.slice(-50))); } catch {} throw e; } }; } catch {} })();`;
const takeFetchFails = (tab: Tab) => tab.js<any[]>(`(() => { try { const l = JSON.parse(sessionStorage.getItem('__gatefetch') || '[]'); sessionStorage.removeItem('__gatefetch'); return l; } catch { return []; } })()`).catch(() => []);
const TOKEN = `(() => { const k = Object.keys(localStorage).find(k => /^sb-.*-auth-token$/.test(k)); if (!k) return null; try { const v = JSON.parse(localStorage.getItem(k)); return v.access_token || (v.currentSession && v.currentSession.access_token) || null; } catch { return null; } })()`;
const inPage = (tab: Tab, path: string, init = "{}") => tab.js<{ status: number; json: any }>(`(async () => { const t = ${TOKEN}; const i = ${init}; i.headers = Object.assign({}, i.headers || {}, t ? { authorization: 'Bearer ' + t } : {}); i.cache = 'no-store';
  try { const r = await fetch(${JSON.stringify(path)}, i); let j = null; try { j = await r.json(); } catch {} return { status: r.status, json: j }; } catch (e) { return { status: -1, json: String(e) }; } })()`);

/** Cada ruta con la marca que SOLO tiene su página (no el menú). */
const ROUTES: { path: string; mark: RegExp }[] = [
  { path: "/coleccion", mark: /MI COLECCIÓN/i },
  { path: "/inventario", mark: /MIS SOBRES/i },
  { path: "/duelos/mazos", mark: /MIS EQUIPOS/i },
  { path: "/tienda", mark: /CAJAS|CARTAS DESTACADAS/i },
  { path: "/tienda/creditos", mark: /DRL CREDITS/i },
  { path: "/progresion", mark: /TU PROGRESO/i },
  { path: "/mundo", mark: /EL MUNDO/i },
  { path: "/competitivo", mark: /CLASIFICACIÓN|ÚLTIMAS PARTIDAS/i },
  { path: "/entrenador", mark: /TACTICAL COACH/i },
  { path: "/jugar", mark: /ROAD TO CHAMPIONS/i },
  { path: "/duelos", mark: /PARTIDA RÁPIDA/i },
  { path: "/logros", mark: /LOGROS/i },
];
const pageInfo = (tab: Tab) => tab.js<any>(`(() => { const nav = performance.getEntriesByType('navigation')[0] || {};
  return { url: location.pathname, head: [...document.querySelectorAll('h1,h2')].map(e => e.innerText.trim()).join(' | ').slice(0, 300),
    offline: !!document.querySelector('[data-offline]'), status: nav.responseStatus ?? null,
    loginForm: !!document.querySelector('input[type="password"]'), errorScreen: /Algo ha fallado|Failed to fetch/i.test(document.body.innerText) }; })()`);

async function verifyPage(tab: Tab, id: string, path: string, mark: RegExp, direct: boolean) {
  await sleep(direct ? 1500 : 2500);
  const ok0 = await tab.js<boolean>(`new Promise(r => { const t0 = Date.now(); const f = () => { const h = [...document.querySelectorAll('h1,h2')].map(e => e.innerText).join(' '); if (${mark}.test(h) || Date.now() - t0 > 12000) r(${mark}.test(h)); else setTimeout(f, 300); }; f(); })`).catch(() => false);
  const p = await pageInfo(tab);
  const fails = await takeFetchFails(tab);
  const errs = tab.takeErrors();
  check(id, ok0 && p.url === path.split("?")[0] && !p.offline && !p.loginForm && !p.errorScreen && fails.length === 0 && errs.length === 0 && (!direct || p.status === 200),
    `url=${p.url} status=${p.status} offline=${p.offline} login=${p.loginForm} errorScreen=${p.errorScreen} fetchFails=${fails.length} console=${errs.length} head=${p.head.slice(0, 80)}${errs[0] ? " err=" + errs[0].slice(0, 80) : ""}${fails[0] ? " fail=" + JSON.stringify(fails[0]) : ""}`);
}

(async () => {
  mkdirSync(OUT, { recursive: true });
  const profile = process.env.GATE_PROFILE_DIR ?? mkdtempSync(join(tmpdir(), "drl-gate-"));
  const b = await launch({ userDataDir: profile, args: ["--mute-audio"] });
  const tab = b.tab;
  try {
    await tab.send("Page.addScriptToEvaluateOnNewDocument", { source: FETCH_OBS });
    // 1 · Servidor vivo y conectividad DESDE EL NAVEGADOR (no desde Node).
    for (const p of ["/api/health", "/api/ready"]) {
      const r = await fetch(`${BASE}${p}`).then(async (x) => ({ s: x.status, j: await x.json().catch(() => null) })).catch((e) => ({ s: -1, j: String(e) }));
      check(`server ${p}`, r.s === 200 && (p !== "/api/ready" || r.j?.status === "ready"), `status=${r.s}`);
    }
    await tab.goto(`${BASE}/cuenta`, 3000);
    await sleep(1500);
    const apiFromBrowser = await inPage(tab, "/api/health");
    check("browser → API (/api/health)", apiFromBrowser.status === 200, `status=${apiFromBrowser.status}`);
    const sbFromBrowser = await tab.js<number>(`fetch(${SB_SAME_ORIGIN ? "location.origin + '/auth/v1/health'" : JSON.stringify(SB_URL + "/auth/v1/health")}, { headers: { apikey: ${JSON.stringify(envLocal.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "")} } }).then(r => r.status).catch(() => -1)`);
    check("browser → Supabase/Kong (auth health)", sbFromBrowser === 200, `origin del cliente=${SB_SAME_ORIGIN ? "mismo origen (BASE_URL)" : SB_URL.replace(/\/\/.*@/, "//")} status=${sbFromBrowser}`);

    // 2 · Login por el formulario real.
    const hadForm = await tab.js<boolean>(`!!document.querySelector('input[type="password"]')`);
    if (hadForm) {
      await tab.js(`(() => { const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
        set(document.querySelector('input[type="email"]'), ${JSON.stringify(EMAIL)}); set(document.querySelector('input[type="password"]'), ${JSON.stringify(PASSWORD)}); document.querySelector('form button[type="submit"]').click(); })()`);
    }
    const loggedIn = await tab.js<boolean>(`new Promise(r => { const t0 = Date.now(); const f = () => { if (!document.querySelector('input[type="password"]')) r(true); else if (Date.now() - t0 > 20000) r(false); else setTimeout(f, 300); }; f(); })`);
    const me = await inPage(tab, "/api/game/me");
    check("login (formulario → sesión → /api/game/me)", loggedIn && me.status === 200 && !!me.json?.profile, `form=${hadForm} me=${me.status}`);
    const userId: string | undefined = me.json?.profile?.id;
    await tab.goto(`${BASE}/cuenta`, 3000); await sleep(1500);
    const meAfterReload = await inPage(tab, "/api/game/me");
    const pAfter = await pageInfo(tab);
    check("sesión tras recargar", meAfterReload.status === 200 && !pAfter.loginForm, `me=${meAfterReload.status} login=${pAfter.loginForm}`);
    const sw = await tab.js<boolean>(`!!navigator.serviceWorker && !!navigator.serviceWorker.controller`);
    check("service worker controla la página (condición real del usuario)", sw, `controller=${sw}`);
    tab.takeErrors(); await takeFetchFails(tab);

    // 3 · Matriz de rutas: URL directa (y recarga) …
    for (const r of ROUTES) { await tab.goto(`${BASE}${r.path}`, 2500); await verifyPage(tab, `direct ${r.path}`, r.path, r.mark, true); }
    if (userId) { await tab.goto(`${BASE}/jugador/${userId}`, 2500); await verifyPage(tab, "direct /jugador/[id]", `/jugador/${userId}`, /EXPÓN|COMPETITIVO|TEMPORADA/i, true); }
    // … y por clic en enlaces de la propia app (navegación de cliente).
    await tab.goto(`${BASE}/`, 3000); await sleep(1500); tab.takeErrors(); await takeFetchFails(tab);
    const CLICKS = ["/coleccion", "/duelos/mazos", "/tienda", "/mundo"];   // enlaces visibles de la cabecera
    for (const r of CLICKS.map((p) => ROUTES.find((x) => x.path === p)!)) {
      const clicked = await tab.js<boolean>(`(() => { const a = [...document.querySelectorAll('a[href="${r.path}"]')].find(x => x.offsetParent !== null); if (!a) return false; a.click(); return true; })()`);
      if (!clicked) { check(`click ${r.path}`, false, "sin enlace visible"); continue; }
      await verifyPage(tab, `click ${r.path}`, r.path, r.mark, false);
    }
    // 4 · Atrás / adelante.
    await tab.js("history.back()"); await verifyPage(tab, "back", "/tienda", /CAJAS|CARTAS DESTACADAS/i, false);
    await tab.js("history.forward()"); await verifyPage(tab, "forward", "/mundo", /EL MUNDO/i, false);
    // El service worker no guarda HTML de ninguna página (solo offline.html) ni queda la caché v2 envenenada.
    const cacheState = await tab.js<any>(`(async () => { const keys = await caches.keys(); const html = [];
      for (const k of keys) { const c = await caches.open(k); for (const req of await c.keys()) { const u = new URL(req.url); if (!/\\.[a-z0-9]+$/i.test(u.pathname) || u.pathname.endsWith('.html')) html.push(u.pathname); } }
      return { keys, html }; })()`);
    check("caché del SW sin HTML personal ni v2", !cacheState.keys.some((k: string) => /-v[12]$/.test(k)) && cacheState.html.every((h: string) => h === "/offline.html"), JSON.stringify(cacheState));

    // F71 · JUGAR → 3 áreas; RtC y Coach con entrada propia; DUELOS → 4 modos → PARTIDA RÁPIDA → carta → stat grande →
    //       pista del rival → el servidor resuelve el turno. Todo por clic, como el usuario.
    await tab.goto(`${BASE}/jugar`, 3000); await sleep(1500); tab.takeErrors(); await takeFetchFails(tab);
    const areas = await tab.js<any>(`["RTC","DUELS","COACH"].map(k => { const a = document.querySelector('[data-testid="play-area-cta-' + k + '"]'); return a ? a.getAttribute('href') : null; })`);
    check("F71 /jugar: 3 áreas (RtC, Duelos, Coach)", areas[0] != null && areas[1] === "/duelos" && areas[2] === "/entrenador" && (await tab.js<number>(`document.querySelectorAll('[data-testid^="play-area-"]:not([data-testid^="play-area-cta"])').length`)) === 3, JSON.stringify(areas));
    for (const [k, path, mark] of [["RTC", "/jugar/road-to-champions", /ROAD TO CHAMPIONS|CAP[IÍ]TULO/i], ["COACH", "/entrenador", /TACTICAL COACH/i]] as const) {
      await tab.goto(`${BASE}/jugar`, 2500); await sleep(1200);
      const href = await tab.js<string | null>(`document.querySelector('[data-testid="play-area-cta-${k}"]')?.getAttribute('href') ?? null`);
      await tab.js(`document.querySelector('[data-testid="play-area-cta-${k}"]')?.click()`);
      // RtC con partida abierta ofrece «Retomar partida» (/duelos/jugar): destino legítimo, se comprueba esa URL.
      const resume = k === "RTC" && !!href && href !== path;
      if (resume) { await sleep(2500); check(`F71 entrada ${k} (retomar)`, (await tab.js<string>("location.pathname")) === href, `href=${href}`); }
      else await verifyPage(tab, `F71 entrada ${k}`, path, mark, false);
    }
    await tab.goto(`${BASE}/jugar`, 2500); await sleep(1200);
    await tab.js(`document.querySelector('[data-testid="play-area-cta-DUELS"]')?.click()`);
    await verifyPage(tab, "F71 entrada DUELOS", "/duelos", /PARTIDA RÁPIDA/i, false);
    // F72 · selector: los 4 modos se eligen (no navegan); por defecto PARTIDA RÁPIDA con su CTA grande.
    const duelModes = await tab.js<any>(`({ selectable: ["QUICK","RANKED","FRIEND","DRAFT_GAUNTLET"].map(k => !!document.querySelector('[data-testid="duel-mode-select-' + k + '"]')),
      selected: document.querySelector('[data-testid="duel-modes-hub"]')?.getAttribute('data-selected'), ctas: document.querySelectorAll('[data-testid^="duel-mode-cta-"]').length,
      quick: (document.querySelector('[data-testid="duel-mode-cta-QUICK"]')?.innerText || '').trim().toUpperCase() })`);
    check("F72 /duelos: 4 modos seleccionables, PARTIDA RÁPIDA elegida con UN CTA (JUGAR)", duelModes.selectable.every(Boolean) && duelModes.ctas === 1 && duelModes.selected === "QUICK" && /JUGAR|RETOMAR/.test(duelModes.quick), JSON.stringify(duelModes));
    await tab.js(`document.querySelector('[data-testid="duel-mode-cta-QUICK"]')?.click()`);
    await sleep(3500);
    if (await tab.js<boolean>(`/Comenzar duelo/i.test(document.body.innerText)`)) {
      await tab.js(`[...document.querySelectorAll('button')].find(b => /^Comenzar duelo$/i.test((b.innerText||'').trim()))?.click()`);
      await sleep(3000);
    }
    const handReady = await tab.js<boolean>(`new Promise(r => { const t0 = Date.now(); const f = () => { const h = [...document.querySelectorAll('[aria-label="Tu mano"] button')].filter(x => !x.disabled); document.querySelector('[data-f61="moment"]')?.click(); if (h.length && !document.querySelector('[data-scene="intro"]')) r(true); else if (Date.now() - t0 > 30000) r(false); else setTimeout(f, 400); }; f(); })`);
    const hints = await tab.js<any[]>(`[...document.querySelectorAll('[data-testid="rival-hint"]')].map(e => ({ type: e.getAttribute('data-hint-type'), label: e.getAttribute('aria-label'), text: (e.innerText||'').trim().slice(0, 30), img: !!e.querySelector('img:not([data-hint-art])'), shape: e.getAttribute('data-hint-shape'), art: (e.querySelector('img[data-hint-art]')?.getAttribute('src') || '').slice(0, 80), clean: (() => { const i = e.querySelector('img[data-hint-art]'); if (!i) return false; const cs = getComputedStyle(i); return cs.filter === 'none' && cs.mixBlendMode === 'normal' && cs.opacity === '1' && i.naturalWidth > 0; })() }))`);
    const okTypes = ["COUNTRY", "REGION", "TEAM", "ROLE"];
    check("F71 pista del rival en cada carta oculta (sin foto)", handReady && hints.length > 0 && hints.every((h) => okTypes.includes(h.type) && /pista/i.test(h.label ?? "") && !h.img), JSON.stringify(hints.slice(0, 5)));
    // F72.2 · la pista es SOLO imagen: ni una letra visible (nada de «US», «PAC», «TH», «FLX»…) y un asset real detrás.
    // F72.8 · y es el <img> ORIGINAL sin tratamiento (filter none, blend normal, opacidad 1) y cargado (naturalWidth > 0).
    check("F72.2 pistas visuales: sin texto visible, con imagen (bandera/icono/logo)", hints.length > 0 && hints.every((h) => h.text === "" && !!h.shape && !!h.art && h.clean), JSON.stringify(hints.slice(0, 4)));
    // F72.3 · el asset de la pista es LOCAL (banderas flag-icons y logos en public/): ningún host externo en tiempo de ejecución.
    check("F72.3 pistas visuales: asset local (sin flagcdn ni ningún host)", hints.length > 0 && hints.every((h) => /^\/(flags|hints)\//.test(h.art) && !/https?:/.test(h.art)), JSON.stringify(hints.map((h) => h.art).slice(0, 4)));
    const turn0 = (await inPage(tab, "/api/game/duel", `{ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'active' }) }`)).json?.view;
    await tab.js(`(() => { const h = [...document.querySelectorAll('[aria-label="Tu mano"] button')].filter(x => !x.disabled); h[0]?.click(); })()`);
    await sleep(700);
    const panel = await tab.js<any>(`(() => { const p = document.querySelector('[data-testid="stat-panel"]'); if (!p) return null; const r = p.getBoundingClientRect();
      const opts = [...p.querySelectorAll('[data-testid^="stat-option-"]')].map(b => ({ id: b.getAttribute('data-testid'), tag: b.tagName, state: b.getAttribute('data-state'), text: (b.innerText||'').replace(/\s+/g,' ').trim(), h: Math.round(b.getBoundingClientRect().height), w: Math.round(b.getBoundingClientRect().width) }));
      return { x: Math.round(r.left), w: Math.round(r.width), vw: innerWidth, opts }; })()`);
    const attacking = !!panel && panel.opts.filter((o: any) => o.tag === "BUTTON").length === 3;
    const forced = !!panel && panel.opts.length === 1 && panel.opts[0].state === "forced";
    check("F71 selector de stats: columna derecha, bloques grandes (3 al atacar / 1 obligada al defender)", !!panel && (attacking || forced) && panel.x > panel.vw / 2 && panel.opts.every((o: any) => o.h >= 44), JSON.stringify(panel));
    if (attacking) {
      await tab.js(`document.querySelector('[data-testid="stat-option-GS"]')?.click()`); await sleep(400);
      const sel = await tab.js<any>(`({ state: document.querySelector('[data-testid="stat-option-GS"]')?.getAttribute('data-state'), pressed: document.querySelector('[data-testid="stat-option-GS"]')?.getAttribute('aria-pressed'), badge: !!document.querySelector('[data-testid="stat-selected-badge"]') })`);
      check("F71 stat elegida: marcada sin depender del color", sel.state === "selected" && sel.pressed === "true" && sel.badge, JSON.stringify(sel));
    }
    await tab.js(`document.querySelector('[data-testid="stat-confirm"]')?.click()`);
    const resolved = await tab.js<boolean>(`new Promise(r => { const t0 = Date.now(); const f = async () => { try { const k = Object.keys(localStorage).find(k => /^sb-.*-auth-token$/.test(k)); const t = JSON.parse(localStorage.getItem(k)).access_token;
      const v = (await (await fetch('/api/game/duel', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + t }, body: JSON.stringify({ action: 'active' }), cache: 'no-store' })).json()).view;
      if (v && (v.turn !== ${Number(turn0?.turn ?? -1)} || v.phase !== ${JSON.stringify(turn0?.phase ?? "")})) return r(true); } catch {} if (Date.now() - t0 > 30000) r(false); else setTimeout(f, 1000); }; f(); })`);
    const f71Fails = await takeFetchFails(tab); const f71Errs = tab.takeErrors();
    check("F71 el servidor resuelve el turno (0 fetch fallidos, 0 errores de consola)", resolved && f71Fails.length === 0 && f71Errs.length === 0, `turn0=${turn0?.turn}/${turn0?.phase} fetchFails=${f71Fails.length} console=${f71Errs.length} ${f71Errs[0]?.slice(0, 100) ?? ""}`);

    // ═════ F72 · FLOW 2 — COMPETITIVO INLINE → cola ranked directa (sin /competitivo) ═════
    const NAV_LOG = `(() => { try { const K='__f72nav'; const push = (u) => { try { const l = JSON.parse(sessionStorage.getItem(K)||'[]'); l.push(String(u)); sessionStorage.setItem(K, JSON.stringify(l.slice(-80))); } catch {} };
      push(location.pathname); for (const m of ['pushState','replaceState']) { const o = history[m].bind(history); history[m] = function (st, t, u) { if (u != null) { try { push(new URL(String(u), location.href).pathname); } catch {} } return o(st, t, u); }; } } catch {} })();`;
    await tab.send("Page.addScriptToEvaluateOnNewDocument", { source: NAV_LOG });
    // La partida rápida de FLOW 1 queda abierta en el servidor: se retira para que no bloquee nada (el gate no deja rastro).
    const openPve = (await inPage(tab, "/api/game/duel", `{ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'active' }) }`)).json?.view?.matchId;
    if (openPve) await inPage(tab, "/api/game/duel", `{ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'abandon', matchId: ${JSON.stringify(String(openPve))} }) }`);
    await tab.goto(`${BASE}/jugar`, 2500); await sleep(1200); tab.takeErrors(); await takeFetchFails(tab);
    await tab.js(`sessionStorage.setItem('__f72nav', JSON.stringify([location.pathname]))`);
    await tab.js(`document.querySelector('[data-testid="play-area-cta-DUELS"]')?.click()`);
    await verifyPage(tab, "F72 JUGAR → DUELOS", "/duelos", /PARTIDA RÁPIDA/i, false);
    await tab.js(`document.querySelector('[data-testid="duel-mode-select-RANKED"]')?.click()`);
    const inline = await tab.js<any>(`new Promise(r => { const t0 = Date.now(); const f = () => { const e = document.querySelector('[data-testid="duel-ranked-inline"]'); const cta = document.querySelector('[data-testid="duel-mode-cta-RANKED"]');
      if (e && e.getAttribute('data-state') !== 'loading' && cta && cta.getAttribute('href')) r({ state: e.getAttribute('data-state'), rank: (e.querySelector('[data-field="rank"]')?.textContent || '').trim(), rating: (e.querySelector('[data-field="rating"]')?.textContent || '').trim(), href: cta.getAttribute('href'), label: (cta.textContent || '').trim(), path: location.pathname, details: document.querySelector('[data-testid="duel-ranked-details"]')?.getAttribute('href') });
      else if (Date.now() - t0 > 15000) r(null); else setTimeout(f, 300); }; f(); })`);
    const self = (await inPage(tab, "/api/game/competitive")).json?.self;
    const unranked = !self || self.position == null || self.rating.gamesPlayed <= 0;
    const expRank = unranked ? "Sin clasificar" : self.rating.gamesPlayed < 10 ? `Colocación ${self.rating.gamesPlayed}/10` : `#${self.position}`;
    check("F72 COMPETITIVO: rango y rating REALES dentro de /duelos (sin navegar)", !!inline && inline.path === "/duelos" && inline.rank === expRank && inline.rating === `Rating ${self?.rating?.rating}` && inline.details === "/competitivo",
      `ui=${JSON.stringify(inline)} api=${JSON.stringify({ rating: self?.rating?.rating, games: self?.rating?.gamesPlayed, position: self?.position })}`);
    const f72e0 = tab.takeErrors(); const f72f0 = await takeFetchFails(tab);
    await tab.js(`document.querySelector('[data-testid="duel-mode-cta-RANKED"]')?.click()`);
    const queued = await tab.js<any>(`new Promise(r => { const t0 = Date.now(); const f = async () => { try { const k = Object.keys(localStorage).find(k => /^sb-.*-auth-token$/.test(k)); const t = JSON.parse(localStorage.getItem(k)).access_token;
      const v = await (await fetch('/api/game/duel/matchmaking', { headers: { authorization: 'Bearer ' + t }, cache: 'no-store' })).json();
      const st = v && v.entry ? v.entry.state : null; if (st === 'QUEUED' || st === 'PAIRING' || st === 'MATCHED') return r({ state: st, path: location.pathname, searching: !!document.querySelector('[data-testid="ranked-searching"]') }); } catch {} if (Date.now() - t0 > 25000) r({ state: null, path: location.pathname }); else setTimeout(f, 800); }; f(); })`);
    const navLog = await tab.js<string[]>(`JSON.parse(sessionStorage.getItem('__f72nav') || '[]')`);
    check("F72 COMPETITIVO: JUGAR → cola ranked directa, sin pasar por /competitivo", queued.state === "QUEUED" || queued.state === "PAIRING", `queue=${JSON.stringify(queued)} nav=${JSON.stringify(navLog)}`);
    check("F72 COMPETITIVO: registro de navegación sin /competitivo", navLog.length > 0 && !navLog.some((u) => u.startsWith("/competitivo")) && navLog.includes("/duelos/pvp"), JSON.stringify(navLog));
    const cancel = await inPage(tab, "/api/game/duel/matchmaking", `{ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'cancel' }) }`);
    const f72e1 = tab.takeErrors(); const f72f1 = await takeFetchFails(tab);
    check("F72 COMPETITIVO: búsqueda cancelada (el gate no deja a la cuenta QA en cola); 0 fetch fallidos, 0 errores", cancel.status === 200 && [...f72e0, ...f72e1].length === 0 && [...f72f0, ...f72f1].length === 0, `cancel=${cancel.status} console=${[...f72e0, ...f72e1][0]?.slice(0, 120) ?? 0} fetch=${JSON.stringify([...f72f0, ...f72f1][0] ?? 0)}`);

    // ═════ F72 · FLOW 3 — DRAFT: coste → entrar → confirmar → cobro exacto → 3 cartas → elegir → persistir → CONTINUAR ═════
    const payEntry = process.env.GATE_DRAFT_ENTRY !== "0";
    let d0 = (await inPage(tab, "/api/game/draft-gauntlet")).json;
    if (d0?.run && payEntry) {
      await inPage(tab, "/api/game/draft-gauntlet", `{ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'abandon', actionId: crypto.randomUUID(), expectedVersion: ${Number(d0.run.version)}, confirm: true }) }`);
      d0 = (await inPage(tab, "/api/game/draft-gauntlet")).json;
    }
    const fee = Number(d0?.economy?.entryFee);
    await tab.goto(`${BASE}/jugar`, 2500); await sleep(1200); tab.takeErrors(); await takeFetchFails(tab);
    await tab.js(`document.querySelector('[data-testid="play-area-cta-DUELS"]')?.click()`);
    await verifyPage(tab, "F72 JUGAR → DUELOS (draft)", "/duelos", /PARTIDA RÁPIDA/i, false);
    await tab.js(`document.querySelector('[data-testid="duel-mode-select-DRAFT_GAUNTLET"]')?.click()`); await sleep(900);
    const card = await tab.js<any>(`({ fee: (document.querySelector('[data-testid="duel-draft-entry"] [data-field="entry-fee"]')?.textContent || '').trim(), ladder: document.querySelectorAll('[data-testid="duel-draft-entry"] [data-wins]').length,
      cta: (document.querySelector('[data-testid="duel-mode-cta-DRAFT_GAUNTLET"]')?.textContent || '').trim(), step: document.querySelector('[data-testid="duel-mode-cta-DRAFT_GAUNTLET"]')?.getAttribute('data-step') })`);
    const feeTxt = new Intl.NumberFormat("es-ES", { useGrouping: "always" } as Intl.NumberFormatOptions).format(fee);
    if (!d0?.run) {
      check("F72 DRAFT: coste de entrada del servidor y escalera de premios en la tarjeta", card.fee === feeTxt && card.ladder === 6 && card.cta === `Entrar · ${feeTxt}` && card.step === "enter", `${JSON.stringify(card)} fee=${fee}`);
      const c0 = Number((await inPage(tab, "/api/game/state")).json?.credits);
      await tab.js(`document.querySelector('[data-testid="duel-mode-cta-DRAFT_GAUNTLET"]')?.click()`); await sleep(500);
      const confirmStep = await tab.js<string | null>(`document.querySelector('[data-testid="duel-mode-cta-DRAFT_GAUNTLET"]')?.getAttribute('data-step') ?? null`);
      const c1 = Number((await inPage(tab, "/api/game/state")).json?.credits);
      check("F72 DRAFT: ENTRAR pide confirmación y todavía no cobra", confirmStep === "confirm" && c1 === c0, `step=${confirmStep} saldo ${c0}→${c1}`);
      await tab.js(`document.querySelector('[data-testid="duel-mode-cta-DRAFT_GAUNTLET"]')?.click()`);
      const inRoom = await tab.js<boolean>(`new Promise(r => { const t0 = Date.now(); const f = () => { if (location.pathname === '/jugar/draft-gauntlet' && document.querySelectorAll('[data-testid="draft-option"]').length === 3) r(true); else if (Date.now() - t0 > 20000) r(false); else setTimeout(f, 300); }; f(); })`);
      const c2 = Number((await inPage(tab, "/api/game/state")).json?.credits);
      const d1 = (await inPage(tab, "/api/game/draft-gauntlet")).json;
      check("F72 DRAFT: confirmar → sala del draft y cobro EXACTO de la entrada, una vez", inRoom && c0 - c2 === fee && d1?.run?.entry?.paid === true && d1?.run?.status === "DRAFTING", `room=${inRoom} saldo ${c0}→${c2} (−${c0 - c2}, entrada ${fee}) entry=${JSON.stringify(d1?.run?.entry)}`);
      const fx = await tab.js<any>(`({ options: document.querySelectorAll('[data-testid="draft-option"]').length, auras: document.querySelectorAll('[data-testid="draft-option"] [data-testid="draft-aura"]').length, stage: !!document.querySelector('[data-testid="draft-stage"]'),
        presence: [...document.querySelectorAll('[data-testid="draft-option"]')].map(e => e.getAttribute('data-presence')), cardOnTop: [...document.querySelectorAll('[data-testid="draft-option"] button[aria-label^="Opción"]')].length })`);
      check("F72 DRAFT: 3 cartas con escenario y aura DETRÁS (la carta sigue siendo el botón)", fx.options === 3 && fx.auras === 3 && fx.stage && fx.cardOnTop === 3, JSON.stringify(fx));
      await tab.js(`document.querySelector('[data-testid="draft-option"] button[aria-label^="Opción 1"]')?.click()`); await sleep(900);
      const chosen = await tab.js<any>(`({ selected: [...document.querySelectorAll('[data-testid="draft-option"]')].map(e => e.getAttribute('data-selected')), confirm: !!document.querySelector('[data-testid="draft-confirm"]') })`);
      await tab.js(`document.querySelector('[data-testid="draft-confirm"]')?.click()`);
      const picked = await tab.js<boolean>(`new Promise(r => { const t0 = Date.now(); const f = () => { if (document.querySelector('[data-testid="draft-room"]')?.getAttribute('data-pick') === '1') r(true); else if (Date.now() - t0 > 15000) r(false); else setTimeout(f, 300); }; f(); })`);
      check("F72 DRAFT: elegir marca UNA carta → CONFIRMAR → elección guardada", chosen.selected.filter((x: string) => x === "true").length === 1 && chosen.confirm && picked, JSON.stringify({ chosen, picked }));
      await tab.send("Page.reload", {}); await sleep(3500);
      const afterReload = await tab.js<string | null>(`new Promise(r => { const t0 = Date.now(); const f = () => { const v = document.querySelector('[data-testid="draft-room"]')?.getAttribute('data-pick'); if (v) r(v); else if (Date.now() - t0 > 15000) r(null); else setTimeout(f, 300); }; f(); })`);
      const c3 = Number((await inPage(tab, "/api/game/state")).json?.credits);
      check("F72 DRAFT: recargar conserva la elección y NO cobra", afterReload === "1" && c3 === c2, `pick=${afterReload} saldo ${c2}→${c3}`);
      d0 = (await inPage(tab, "/api/game/draft-gauntlet")).json;
    }
    // Run activa ⇒ /duelos dice CONTINUAR (con el progreso real) y no vuelve a cobrar.
    const cBefore = Number((await inPage(tab, "/api/game/state")).json?.credits);
    await tab.goto(`${BASE}/duelos?modo=DRAFT_GAUNTLET`, 3000); await sleep(1500);
    const cont = await tab.js<any>(`({ cta: (document.querySelector('[data-testid="duel-mode-cta-DRAFT_GAUNTLET"]')?.textContent || '').trim(), href: document.querySelector('[data-testid="duel-mode-cta-DRAFT_GAUNTLET"]')?.getAttribute('href'), note: (document.querySelector('[data-testid="duel-mode-DRAFT_GAUNTLET"] [data-testid="mode-note"]')?.textContent || '').trim() })`);
    await tab.js(`document.querySelector('[data-testid="duel-mode-cta-DRAFT_GAUNTLET"]')?.click()`); await sleep(3000);
    const back2 = await tab.js<string>("location.pathname");
    const cAfter = Number((await inPage(tab, "/api/game/state")).json?.credits);
    const expNote = d0?.run?.status === "DRAFTING" ? `Draft ${d0.run.pickIndex}/10` : `${d0?.run?.wins}/5 victorias`;
    check("F72 DRAFT: run activa = CONTINUAR con su progreso real, sin segundo cobro", !!d0?.run && cont.cta === "Continuar" && cont.note === expNote && (back2 === "/jugar/draft-gauntlet" || back2 === "/duelos/jugar") && cAfter === cBefore,
      `${JSON.stringify(cont)} esperado=${expNote} → ${back2} saldo ${cBefore}→${cAfter}`);
    const f72e2 = tab.takeErrors(); const f72f2 = await takeFetchFails(tab);
    check("F72 DRAFT: 0 errores de consola y 0 fetch fallidos", f72e2.length === 0 && f72f2.length === 0, `console=${f72e2[0]?.slice(0, 140) ?? 0} fetch=${JSON.stringify(f72f2[0] ?? 0)}`);

    // 5 · Compra real de un Sobre Bronce (autoridad del servidor).
    const s0 = await inPage(tab, "/api/game/state");
    // Precondición, no fallo del producto: sin 1.000 créditos el «Confirmar» no se puede pulsar. Se dice tal cual.
    if (typeof s0.json?.credits === "number" && s0.json.credits < 1000) console.log(`AVISO precondición: la cuenta QA tiene ${s0.json.credits} créditos (< 1.000); usa otra cuenta QA con saldo`);
    await tab.goto(`${BASE}/tienda`, 3000); await sleep(2000); tab.takeErrors(); await takeFetchFails(tab);
    // El botón de cada sobre lleva aria-label «Comprar <nombre>» (StoreProducts); el modal debe ser el del Bronce a 1.000.
    const openedBronze = await tab.js<boolean>(`(async () => { const b = [...document.querySelectorAll('button[aria-label]')].find(x => /^Comprar (o abrir )?Sobre Bronce$/i.test(x.getAttribute('aria-label')) && !x.disabled);
      if (!b) return false; b.scrollIntoView(); b.click(); await new Promise(r => setTimeout(r, 1200)); const m = document.querySelector('[data-testid="store-purchase-modal"]');
      return !!m && /Bronce/i.test(m.innerText) && /Confirmar( compra)? · 1[.]000/i.test(m.innerText); })()`);
    const modalTxt = await tab.js<string>(`document.querySelector('[data-testid="store-purchase-modal"]')?.innerText ?? ''`);
    const price = Number((/Confirmar(?: compra)? · ([\d.]+)/i.exec(modalTxt)?.[1] ?? "").replace(/\./g, "")) || null;
    const confirmed = await tab.js<boolean>(`(() => { const b = [...document.querySelectorAll('[data-testid="store-purchase-modal"] button')].find(x => /^Confirmar( compra)? ·/i.test((x.innerText||'').trim()) && !x.disabled); if (!b) return false; b.click(); return true; })()`);
    await sleep(4000);
    const buyFails = await takeFetchFails(tab);
    const s1 = await inPage(tab, "/api/game/state");
    await tab.goto(`${BASE}/tienda`, 3000); await sleep(1500);
    const s2 = await inPage(tab, "/api/game/state");
    const c0 = s0.json?.credits, c1 = s1.json?.credits, c2 = s2.json?.credits;
    const packCount = (u: any): number | null => (typeof u === "number" ? u : u && typeof u === "object" ? Object.values(u).reduce((a: number, v: any) => a + (Number(v) || 0), 0) : null);
    const u0 = packCount(s0.json?.unopenedPacks), u1 = packCount(s1.json?.unopenedPacks);
    check(typeof c0 === "number" && c0 < 1000 ? "compra Sobre Bronce (PRECONDICIÓN: saldo QA insuficiente)" : "compra Sobre Bronce", openedBronze && confirmed && price === 1000 && c1 === c0 - price && c2 === c1 && (typeof u0 !== "number" || u1 === u0 + 1) && buyFails.length === 0,
      `modalBronce=${openedBronze} precio=${price} créditos ${c0}→${c1}→(recarga)${c2} sobres ${u0}→${u1} fetchFails=${buyFails.length}`);

    // 6 · 390 px.
    await tab.resize(390, 844, 2);
    for (const r of [ROUTES[0], ROUTES[4], ROUTES[5]]) { await tab.goto(`${BASE}${r.path}`, 2500); await verifyPage(tab, `390 ${r.path}`, r.path, r.mark, true); }
    await tab.resize(1440, 900, 1);

    // 7 · Logout real.
    await tab.goto(`${BASE}/cuenta`, 3000); await sleep(1200);
    const out = await tab.js<boolean>(`(() => { const b = [...document.querySelectorAll('button')].find(x => /^(Cerrar sesi[oó]n|Salir)$/i.test((x.innerText||'').trim())); if (!b) return false; b.click(); return true; })()`);
    await sleep(3000);
    await tab.goto(`${BASE}/cuenta`, 3000); await sleep(1500);
    const tokenAfter = await tab.js<string | null>(TOKEN);
    const meOut = await inPage(tab, "/api/game/me");
    const pOut = await pageInfo(tab);
    check("logout (sin token, 401, formulario)", out && !tokenAfter && meOut.status === 401 && pOut.loginForm, `click=${out} token=${!!tokenAfter} me=${meOut.status} form=${pOut.loginForm}`);
  } catch (e) {
    check("exception", false, String((e as Error)?.message ?? e));
  } finally {
    await b.close().catch(() => null);
    const pass = results.filter((r) => r.ok).length;
    writeFileSync(join(OUT, "browser-gate.json"), JSON.stringify({ at: new Date().toISOString(), base: BASE, pass, total: results.length, results }, null, 2) + "\n");
    console.log(`BROWSER_GATE ${pass}/${results.length}`);
    process.exit(pass === results.length ? 0 : 1);
  }
})();
