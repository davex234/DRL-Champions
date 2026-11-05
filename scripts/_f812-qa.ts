/**
 * F81.2 · QA EN NAVEGADOR DE LA HIDRATACIÓN (instrumento, fuera de CI) — «NEUTRAL → REAL», nunca «DEMO → REAL».
 *
 *   BASE_URL=http://127.0.0.1:3082 npx tsx scripts/_f812-qa.ts --serve [--only s1,s4…]
 *
 * Sin tocar ninguna base de datos: la sesión de Supabase se SIEMBRA en localStorage (como la deja supabase-js) y CDP
 * Fetch intercepta `/auth/v1/*`, `/api/game/state` y `/api/game/me` con respuestas de prueba y RETRASOS deliberados
 * (250 ms / 1 s / 3 s / 5 s). Un muestreador inyectado en cada documento registra CADA cambio de lo visible (cargador,
 * esqueleto, saldo del HUD, panel de reintento, marcas de la demo) desde el primer instante, y se fotografía a
 * 0/250/1000/3000 ms y al resolverse. Caché de partida: la DEMO (6.000 créditos, sobres de inicio, cartas de demo).
 * Escribe docs/product/qa/f812-hydration/.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openBrowser, sleep, type Client } from "./_fase68-lib";
import { CARDS, getPlayer } from "../src/data/catalog";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3082";
const OUT = join(process.cwd(), "docs/product/qa/f812-hydration");
const SHOTS = join(OUT, "shots");
mkdirSync(SHOTS, { recursive: true });
const rows: { id: string; ok: boolean; detail: string }[] = [];
let fails = 0;
const check = (id: string, ok: boolean, detail: unknown = "") => {
  const d = typeof detail === "string" ? detail : JSON.stringify(detail);
  rows.push({ id, ok, detail: d.slice(0, 600) }); if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} ${id} ${d.slice(0, 260)}`);
};

/* ─────────────── fixtures ─────────────── */
const USER = "f812qa00-0000-4000-8000-000000000001";
const REAL_HUD = "2.120";
const nick = (c: (typeof CARDS)[number]) => getPlayer(c.playerId)?.nick ?? c.id;
const distinct = (() => { const seen = new Set<string>(); return CARDS.filter((c) => { const n = nick(c); if (seen.has(n) || n.length < 4) return false; seen.add(n); return true; }); })();
const DEMO_CARDS = distinct.slice(10, 12);
const REAL_CARDS = distinct.slice(40, 43);
const b64u = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (exp: number) => `${b64u({ alg: "HS256", typ: "JWT" })}.${b64u({ sub: USER, role: "authenticated", aud: "authenticated", exp })}.f812-firma-falsa`;
const userObj = { id: USER, aud: "authenticated", role: "authenticated", email: "qa-f812@example.invalid", app_metadata: { provider: "email" }, user_metadata: { username: "QA F812" }, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" };
const session = (expired = false) => {
  const exp = Math.floor(Date.now() / 1000) + (expired ? -600 : 3600);
  return { access_token: jwt(exp), refresh_token: "f812-refresh", token_type: "bearer", expires_in: 3600, expires_at: exp, user: userObj };
};
const SERVER_STATE = {
  credits: 2120, xp: 1500, ownedCards: REAL_CARDS.map((c, i) => ({ uid: `f812-srv-${i}`, cardId: c.id, obtainedAt: 1_700_000_000_000 + i })),
  origins: {}, lockedUids: [], unopenedPacks: { estandar: 2 }, pity: { version: 1, counters: {} }, packsOpened: 7, mintCounts: {}, artworks: {},
};
const PROFILE = { profile: { id: USER, username: "QA F812", credits: 2120, xp: 1500, points: 0, avatar: null, region: null } };
const demoCache = (owner?: string, credits = 6000) => JSON.stringify({
  state: { credits, xp: 0, ownedCards: DEMO_CARDS.map((c, i) => ({ uid: `f812-demo-${i}`, cardId: c.id, obtainedAt: 1 })), unopenedPacks: { inicial: 3, estandar: 1 }, mintCounts: {}, pityState: { version: 1, counters: {} }, cardOrigins: {}, materials: {}, cosmetics: [], lockedUids: [], packsOpened: 0, craftedCount: 0, claimedAchievements: [], record: { played: 0, won: 0, lost: 0, streak: 0, best: 0 }, ...(owner ? { cacheOwner: owner } : {}) },
  version: 0,
});
const SESSION_KEY = `sb-${new URL(BASE).hostname.split(".")[0]}-auth-token`;

/* ─────────────── muestreador (en cada documento, desde el primer instante) ─────────────── */
const SAMPLER = `(() => {
  const S = []; window.__f812 = S; const t0 = performance.now();
  const DEMO = ${JSON.stringify(DEMO_CARDS.map((c) => nick(c).toLowerCase()))};
  const snap = () => {
    const b = document.body; if (!b) return;
    const txt = (b.innerText || '').toLowerCase();
    const hud = [...document.querySelectorAll('[title="DRL Credits"] .nx-readout')].map(e => e.textContent.trim()).join('|');
    const rec = {
      loader: !!document.querySelector('[data-testid="game-loader"]'),
      skel: !!document.querySelector('[data-testid="daily-skeleton"]'),
      unavailable: !!document.querySelector('[data-testid="economy-unavailable"]'),
      signin: !!document.querySelector('[data-testid="hud-signin"]'),
      hud, demoText: DEMO.filter(n => txt.includes(n)), six: /\\b6\\.000\\b/.test(hud),
      pack: document.querySelector('[data-testid="pack-opening"]')?.dataset.phase ?? '',
      realText: /(^|[^0-9.])2.?120([^0-9]|$)/.test(txt), demoCredits: /(^|[^0-9.])6.?000([^0-9]|$)/.test(txt),
    };
    const k = JSON.stringify(rec); const last = S[S.length - 1];
    if (!last || last.k !== k) S.push({ t: Math.round(performance.now() - t0), k, ...rec });
  };
  new MutationObserver(snap).observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
  setInterval(snap, 25); document.addEventListener('DOMContentLoaded', snap);
})()`;

/* ─────────────── interceptación ─────────────── */
type Rule = (url: string, method: string, post?: string) => { delay?: number; status?: number; body?: unknown; fail?: string } | null;
async function intercept(c: Client, rule: { current: Rule }) {
  const H = [{ name: "content-type", value: "application/json" }, { name: "access-control-allow-origin", value: "*" }];
  c.tab.on("Fetch.requestPaused", async (p: any) => {
    const r = rule.current(p.request.url, p.request.method, p.request.postData);
    try {
      if (!r) { await c.tab.send("Fetch.continueRequest", { requestId: p.requestId }); return; }
      if (r.delay) await sleep(r.delay);
      if (r.fail) { await c.tab.send("Fetch.failRequest", { requestId: p.requestId, errorReason: r.fail }); return; }
      await c.tab.send("Fetch.fulfillRequest", { requestId: p.requestId, responseCode: r.status ?? 200, responseHeaders: H, body: Buffer.from(r.body === undefined ? "" : JSON.stringify(r.body)).toString("base64") });
    } catch { /* la página navegó: petición ya cancelada */ }
  });
  await c.tab.send("Fetch.enable", { patterns: [{ urlPattern: "*/auth/v1/*" }, { urlPattern: "*/api/game/state*" }, { urlPattern: "*/api/game/me*" }, { urlPattern: "*/api/game/meta*" }] });
}
const authed = (stateDelay: number, extra: Rule = () => null): Rule => (url, method, post) => {
  const x = extra(url, method, post); if (x) return x;
  if (/\/api\/game\/state/.test(url)) return { delay: stateDelay, body: SERVER_STATE };
  if (/\/api\/game\/me(\?|$)/.test(url)) return { body: PROFILE };
  // F81.2 · `/api/game/meta` NO es `/api/game/me` (antes la regla del perfil también le respondía y el panel de objetivos
  // de colección leía un perfil como si fuera la foto meta). Sin BD local: 401, su camino de «sin datos».
  if (/\/api\/game\/meta/.test(url)) return { status: 401, body: { error: "No autenticado" } };
  if (/\/auth\/v1\/user/.test(url)) return { body: userObj };
  if (/\/auth\/v1\/logout/.test(url)) return { status: 204 };
  return null;
};

const GATED = new Set(["/tienda", "/coleccion", "/packs", "/packs/estandar", "/abrir/estandar", "/inventario", "/carrera"]);
type Sample = { t: number; loader: boolean; skel: boolean; unavailable: boolean; signin: boolean; hud: string; demoText: string[]; six: boolean; pack: string; realText: boolean; demoCredits: boolean };
/** Pantallas inmersivas sin HUD: su «real» es otro (la ceremonia lista con los sobres del servidor, el saldo en el vestíbulo). */
const isReal = (path: string, x: Sample) => path === "/abrir/estandar" ? x.pack === "ready" : path === "/" ? x.realText && !x.skel : x.hud === REAL_HUD;
const samples = (c: Client) => c.tab.js<Sample[]>(`(window.__f812 || []).map(({ k, ...r }) => r)`);

/** Siembra el almacenamiento del origen (antes de cualquier script de la app) y deja la pestaña en blanco. */
async function seed(c: Client, items: Record<string, string | null>) {
  await c.tab.goto(`${BASE}/manifest.webmanifest`, 300).catch(() => undefined);
  await c.tab.js(`(() => { localStorage.clear(); sessionStorage.clear(); const it = ${JSON.stringify(items)}; for (const [k, v] of Object.entries(it)) if (v !== null) localStorage.setItem(k, v); })()`);
}

/** Una llamada CDP que no puede colgar la pasada (capturas o recargas a mitad de navegación). */
const bounded = <T,>(p: Promise<T>, ms = 5000): Promise<T | undefined> => Promise.race([p.catch(() => undefined), sleep(ms).then(() => undefined)]);

/** Navega sin esperar y fotografía a los instantes pedidos. */
async function visit(c: Client, path: string, opts: { shotsAt?: number[]; tag?: string; settle?: number; reload?: boolean } = {}) {
  const t0 = Date.now();
  console.log(`  · ${opts.reload ? "recarga" : path} ${new Date().toISOString().slice(11, 19)}`);
  // Ctrl+F5 = recarga saltándose la caché; sin esperar a la respuesta CDP (llega tras la carga y puede retrasarse).
  if (opts.reload) void bounded(c.tab.send("Page.reload", { ignoreCache: true })); else await bounded(c.tab.send("Page.navigate", { url: `${BASE}${path}` }));
  for (const at of opts.shotsAt ?? []) {
    const wait = at - (Date.now() - t0); if (wait > 0) await sleep(wait);
    await bounded(c.tab.shot(join(SHOTS, `${opts.tag}-${at}ms.png`)));
  }
  const rest = (opts.settle ?? 2500) - (Date.now() - t0); if (rest > 0) await sleep(rest);
  if (opts.tag) await bounded(c.tab.shot(join(SHOTS, `${opts.tag}-resolved.png`)));
  return samples(c);
}

/** Veredicto de una visita AUTENTICADA: nunca demo; neutral antes; real al final. */
function judgeAuthed(id: string, path: string, s: Sample[]) {
  // `/coleccion` es el ÁLBUM (todo el catálogo, poseído o no): ahí los nombres no delatan propiedad; la compuerta sí.
  const bad = s.filter((x) => x.six || (x.hud && x.hud !== "—" && x.hud !== REAL_HUD) || (path !== "/coleccion" && x.demoText.length > 0)
    || (GATED.has(path) && !x.loader && !x.unavailable && x.hud !== REAL_HUD && !x.signin && x.hud !== "")
    || (path === "/" && !x.skel && !x.realText)
    || (path === "/" && x.demoCredits)
    || (path === "/abrir/estandar" && !!x.pack && s.indexOf(x) < s.findIndex((y) => y.pack === "ready")));
  const last = s[s.length - 1];
  const neutralFirst = s.some((x) => !isReal(path, x) && (x.loader || x.skel || x.hud === "—"));
  check(`${id} · ${path} · NUNCA demo/caché (${s.length} estados)`, bad.length === 0, bad.length ? bad.slice(0, 3) : s.map((x) => `${x.t}:${x.loader ? "L" : ""}${x.skel ? "S" : ""}${x.unavailable ? "E" : ""}${x.signin ? "I" : ""}[${x.hud}]`).join(" "));
  check(`${id} · ${path} · NEUTRAL → REAL`, neutralFirst && !!last && isReal(path, last) && !last.loader && !last.unavailable, last);
}

const errorsOf = (c: Client) => c.tab.takeErrors();
/** Ruido de entorno esperado: las API que el instrumento NO intercepta reciben un token de prueba (401/503 del servidor local). */
const unexpected = (errs: string[]) => errs.filter((e) => !/Failed to load resource: the server responded with a status of (401|403|404|500|502|503)/.test(e));

async function s1Slow(width: number, delays: number[], paths: string[]) {
  const c = await openBrowser("A", width, { label: `f812-s1-${width}` });
  const rule = { current: authed(0) };
  try {
    await c.tab.send("Page.addScriptToEvaluateOnNewDocument", { source: SAMPLER });
    await intercept(c, rule);
    for (const d of delays) {
      rule.current = authed(d);
      for (const p of paths) {
        await seed(c, { [SESSION_KEY]: JSON.stringify(session()), "drl-champions": demoCache() });
        const shoot = d === 3000 && (p === "/tienda" || p === "/coleccion" || p === "/");
        const s = await visit(c, p, { shotsAt: shoot ? [0, 250, 1000, 3000] : [], tag: shoot ? `s1-${width}-${p.replace(/\//g, "_") || "home"}-d${d}` : undefined, settle: p === "/" ? Math.max(d + 2600, 7500) : d + 2600 });
        judgeAuthed(`S1 sesión guardada + servidor lento ${d} ms @${width}`, p, s);
        const owner = await c.tab.js(`JSON.parse(localStorage.getItem('drl-champions')).state.cacheOwner ?? null`);
        if (p === "/tienda") check(`S1 @${width} d${d} · la caché queda etiquetada con su dueño`, owner === USER, owner);
      }
    }
    // HARD REFRESH (Ctrl+F5) ya autenticado.
    rule.current = authed(3000);
    await visit(c, "/tienda", { settle: 3800 }); // Ctrl+F5 recarga la página ACTUAL: primero /tienda, ya con la caché de la cuenta
    await c.tab.js(`(window.__f812.length = 0, true)`);
    const s = await visit(c, "/tienda", { reload: true, shotsAt: width === 1440 ? [0, 1000] : [], tag: width === 1440 ? `s2-hard-reload-${width}` : undefined, settle: 5600 });
    judgeAuthed(`S2 HARD REFRESH (caché de la cuenta, servidor a 3 s) @${width}`, "/tienda", s);
    const errs = unexpected(errorsOf(c));
    check(`S1/S2 @${width} · consola: 0 errores inesperados (ni hidratación ni React)`, errs.length === 0, errs.slice(0, 4));
  } finally { await c.browser.close(); }
}

async function s3MultiTab() {
  const c = await openBrowser("A", 1440, { label: "f812-s3" });
  const rule = { current: authed(500) };
  try {
    await c.tab.send("Page.addScriptToEvaluateOnNewDocument", { source: SAMPLER });
    await intercept(c, rule);
    await seed(c, { [SESSION_KEY]: JSON.stringify(session()), "drl-champions": demoCache() });
    await visit(c, "/tienda", { settle: 3000 });
    await c.tab.js(`(window.__f812other = window.open('/coleccion', 'f812-other'), true)`); // la otra pestaña sigue autenticada
    await sleep(4000);
    rule.current = authed(3000);
    const s = await visit(c, "/coleccion", { reload: true, settle: 5600, shotsAt: [0, 1000], tag: "s3-multitab-reload" });
    judgeAuthed("S3 MULTI-PESTAÑA (recarga con otra pestaña autenticada abierta)", "/coleccion", s);
    check("S3 · la otra pestaña sigue abierta y con la sesión", await c.tab.js<boolean>(`!!localStorage.getItem(${JSON.stringify(SESSION_KEY)})`));
  } finally { await c.browser.close(); }
}

async function s4Guest() {
  for (const width of [1440, 390]) {
    const c = await openBrowser("A", width, { label: `f812-s4-${width}` });
    const rule = { current: authed(0) };
    try {
      await c.tab.send("Page.addScriptToEvaluateOnNewDocument", { source: SAMPLER });
      await intercept(c, rule);
      await seed(c, { "drl-champions": demoCache() });
      const s = await visit(c, "/tienda", { settle: 2500, shotsAt: [0], tag: `s4-guest-${width}` });
      const last = s[s.length - 1];
      check(`S4 VISITANTE CONFIRMADO @${width} · su demo se monta (sin cargador eterno ni reintento) y el HUD es «Entrar»`, !!last && !last.loader && !last.unavailable && last.signin, s.map((x) => `${x.t}:${x.loader ? "L" : ""}${x.signin ? "I" : ""}`).join(" "));
      const store = await c.tab.js<any>(`JSON.parse(localStorage.getItem('drl-champions')).state`);
      check(`S4 @${width} · la demo intacta (6.000, sobres de inicio, sus cartas)`, store.credits === 6000 && store.unopenedPacks.inicial === 3 && store.ownedCards.length === DEMO_CARDS.length, { credits: store.credits, packs: store.unopenedPacks, cards: store.ownedCards.length });
      const s2 = await visit(c, "/coleccion", { settle: 2500 });
      check(`S4 @${width} · /coleccion del visitante montada (álbum público, sin cargador ni reintento)`, !s2[s2.length - 1].loader && !s2[s2.length - 1].unavailable && /Inicia sesión para guardar tu colección/.test(await c.tab.js<string>(`document.body.innerText`)), s2[s2.length - 1]);
      const errs = unexpected(errorsOf(c));
      check(`S4 @${width} · consola limpia`, errs.length === 0, errs.slice(0, 4));
    } finally { await c.browser.close(); }
  }
}

async function s5Expired() {
  const c = await openBrowser("A", 1440, { label: "f812-s5" });
  const rule = { current: authed(0) };
  try {
    await c.tab.send("Page.addScriptToEvaluateOnNewDocument", { source: SAMPLER });
    await intercept(c, rule);
    // Sesión CADUCADA + caché de esa cuenta (2.120). El refresco tarda 1,5 s y el servidor la rechaza.
    rule.current = authed(0, (url) => (/\/auth\/v1\/token/.test(url) ? { delay: 1500, status: 400, body: { error: "invalid_grant", error_description: "Invalid Refresh Token: Refresh Token Not Found", code: "refresh_token_not_found" } } : null));
    for (const variant of ["etiquetada", "legada"] as const) {
    // «etiquetada» = caché F81.2 con dueño; «legada» = caché anterior a F81.2, sin dueño (la que había en producción).
    await seed(c, { [SESSION_KEY]: JSON.stringify(session(true)), "drl-champions": demoCache(variant === "etiquetada" ? USER : undefined, 2120) });
    const s = await visit(c, "/tienda", { settle: 5000, shotsAt: [0, 250, 1000], tag: `s5-expired-${variant}` });
    const shown = s.filter((x) => x.hud && x.hud !== "—");
    check("S5 SESIÓN CADUCADA · ni el saldo cacheado de la cuenta ni la demo como suyos mientras se resuelve", shown.length === 0 && s.every((x) => x.demoText.length === 0 || x.signin), s.map((x) => `${x.t}:${x.loader ? "L" : ""}${x.unavailable ? "E" : ""}${x.signin ? "I" : ""}[${x.hud}]`).join(" "));
    const last = s[s.length - 1];
    check("S5 · resuelta como visitante: demo (sin carga infinita)", !!last && !last.loader && !last.unavailable && last.signin, last);
    const store = await c.tab.js<any>(`({ ...JSON.parse(localStorage.getItem('drl-champions')).state, session: !!localStorage.getItem(${JSON.stringify(SESSION_KEY)}) })`);
    check(`S5 (${variant}) · la caché de la cuenta se limpió a la demo de inicio (6.000, 0 cartas, sin dueño)`, store.credits === 6000 && store.ownedCards.length === 0 && !store.cacheOwner && !store.session, { credits: store.credits, cards: store.ownedCards.length, owner: store.cacheOwner, session: store.session });
    }
  } finally { await c.browser.close(); }
}

async function s6AuthFailure() {
  const c = await openBrowser("A", 390, { label: "f812-s6" });
  const rule = { current: authed(0) };
  try {
    await c.tab.send("Page.addScriptToEvaluateOnNewDocument", { source: SAMPLER });
    await intercept(c, rule);
    // Sesión caducada y el refresco FALLA por red (técnico): supabase-js conserva la sesión → no es visitante confirmado.
    rule.current = authed(0, (url) => (/\/auth\/v1\/token/.test(url) ? { delay: 300, fail: "ConnectionFailed" } : null));
    await seed(c, { [SESSION_KEY]: JSON.stringify(session(true)), "drl-champions": demoCache() });
    // supabase-js reintenta el refresco con espera exponencial hasta 30 s (AUTO_REFRESH_TICK_DURATION_MS) y luego responde
    // «sin sesión» CONSERVÁNDOLA (error reintentable): la pantalla debe acabar en reintento, no en la demo ni cargando.
    const s = await visit(c, "/tienda", { settle: 40000, shotsAt: [0, 1000, 3000], tag: "s6-auth-failure" });
    const leak = s.filter((x) => (x.hud && x.hud !== "—") || (!x.loader && !x.unavailable && !x.skel && x.demoText.length > 0));
    check("S6 FALLO TÉCNICO DE AUTH · nunca demo ni cifras", leak.length === 0, leak.slice(0, 3));
    const last = s[s.length - 1];
    check("S6 · termina en un estado seguro con reintento (no carga infinita)", !!last && last.unavailable && !last.loader, s.map((x) => `${x.t}:${x.loader ? "L" : ""}${x.unavailable ? "E" : ""}${x.signin ? "I" : ""}`).join(" "));

    // Fallo del ESTADO del servidor con sesión válida: reintento → real.
    let fail = true;
    rule.current = authed(0, (url) => (/\/api\/game\/state/.test(url) && fail ? { status: 500, body: { error: "No se pudo completar la operación" } } : null));
    await seed(c, { [SESSION_KEY]: JSON.stringify(session()), "drl-champions": demoCache() });
    const s2 = await visit(c, "/tienda", { settle: 3000 });
    const l2 = s2[s2.length - 1];
    check("S6b estado del servidor 500 · panel de reintento, ninguna cifra", !!l2 && l2.unavailable && s2.every((x) => !x.hud || x.hud === "—"), s2.map((x) => `${x.t}:${x.loader ? "L" : ""}${x.unavailable ? "E" : ""}[${x.hud}]`).join(" "));
    await c.tab.shot(join(SHOTS, "s6b-state-500-390.png"));
    fail = false;
    await c.tab.js(`[...document.querySelectorAll('[data-testid="economy-unavailable"] button')].find(b => /reintentar/i.test(b.innerText))?.click()`);
    await sleep(2500);
    const s3 = await samples(c);
    check("S6b · «Reintentar» → estado real", s3[s3.length - 1].hud === REAL_HUD && !s3[s3.length - 1].unavailable, s3[s3.length - 1]);
    const errs = unexpected(errorsOf(c)).filter((e) => !/\[sync\] no se pudo cargar el estado del servidor/.test(e) && !/status of 500/.test(e) && !/ERR_CONNECTION_FAILED|^TypeError: Failed to fetch|^AuthRetryableFetchError/.test(e));
    check("S6 · consola: solo el error registrado del fallo provocado", errs.length === 0, errs.slice(0, 4));
  } finally { await c.browser.close(); }
}

async function s7LoginLogout() {
  for (const width of [1440, 1024, 390]) {
    const c = await openBrowser("A", width, { label: `f812-s7-${width}` });
    const rule = { current: authed(3000) };
    try {
      await c.tab.send("Page.addScriptToEvaluateOnNewDocument", { source: SAMPLER });
      await intercept(c, rule);
      rule.current = authed(3000, (url, method) => (/\/auth\/v1\/token/.test(url) && method === "POST" ? { delay: 400, body: session() } : null));
      await seed(c, { "drl-champions": demoCache() });
      await visit(c, "/cuenta", { settle: 2500 });
      await c.tab.js(`(() => {
        const set = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
        set(document.querySelector('input[type="email"]'), 'qa-f812@example.invalid'); set(document.querySelector('input[type="password"]'), 'contrasena-de-prueba');
      })()`);
      await sleep(200);
      await c.tab.js(`(window.__f812.length = 0, document.querySelector('form button[type="submit"]').click(), true)`);
      for (const at of [250, 1000, 3000]) { await sleep(at === 250 ? 250 : at === 1000 ? 750 : 2000); await c.tab.shot(join(SHOTS, `s7-login-${width}-${at}ms.png`)); }
      await sleep(2500);
      await c.tab.shot(join(SHOTS, `s7-login-${width}-resolved.png`));
      const s = await samples(c);
      const leak = s.filter((x) => x.six || (x.hud && x.hud !== "—" && x.hud !== REAL_HUD));
      check(`S7 LOGIN @${width} · la demo se esconde en la transición (nunca 6.000 como saldo de la cuenta)`, leak.length === 0 && s.some((x) => x.hud === "—") , s.map((x) => `${x.t}:${x.signin ? "I" : ""}[${x.hud}]`).join(" "));
      check(`S7 LOGIN @${width} · después, el saldo real`, s[s.length - 1].hud === REAL_HUD, s[s.length - 1]);
      // LOGOUT real desde /cuenta.
      await c.tab.js(`(window.__f812.length = 0, true)`);
      await c.tab.js(`[...document.querySelectorAll('button')].find(b => /Cerrar sesión/i.test(b.innerText))?.click()`);
      await sleep(2500);
      const so = await samples(c);
      const store = await c.tab.js<any>(`({ ...JSON.parse(localStorage.getItem('drl-champions')).state, session: !!localStorage.getItem(${JSON.stringify(SESSION_KEY)}) })`);
      check(`S7 LOGOUT @${width} · nunca el saldo de la cuenta como visitante; HUD «Entrar»`, so.every((x) => !x.hud || x.hud === "—" || x.hud === REAL_HUD) && so[so.length - 1].signin, so.map((x) => `${x.t}:${x.signin ? "I" : ""}[${x.hud}]`).join(" "));
      check(`S7 LOGOUT @${width} · la caché de la cuenta pasa a la demo de inicio (no a «demo con mis cartas»)`, !store.session && store.credits === 6000 && store.ownedCards.length === 0 && !store.cacheOwner, { credits: store.credits, cards: store.ownedCards.length, owner: store.cacheOwner, session: store.session });
      const s2 = await visit(c, "/coleccion", { settle: 2500, tag: `s7-logout-coleccion-${width}`, shotsAt: [] });
      const l2 = s2[s2.length - 1];
      check(`S7 LOGOUT @${width} · /coleccion de visitante montada (demo de inicio, sin cargador ni reintento)`, !!l2 && !l2.loader && !l2.unavailable && l2.signin, l2);
      const errs = unexpected(errorsOf(c));
      check(`S7 @${width} · consola limpia`, errs.length === 0, errs.slice(0, 4));
    } finally { await c.browser.close(); }
  }
}

const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
async function serve(): Promise<() => void> {
  const { spawn } = await import("node:child_process");
  const port = new URL(BASE).port || "3082";
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", port, "-H", "127.0.0.1"], { env: { ...process.env }, stdio: "ignore" });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${BASE}/manifest.webmanifest`)).status < 500) break; } catch { /* arrancando */ } await sleep(500); }
  return () => child.kill();
}
async function main() {
  const t0 = Date.now();
  const stop = process.argv.includes("--serve") ? await serve() : () => undefined;
  const only = arg("--only")?.split(",");
  const run = (k: string) => !only || only.includes(k);
  try {
    const delays = arg("--delays")?.split(",").map(Number) ?? [250, 1000, 3000, 5000];
    const paths = arg("--paths")?.split(",") ?? ["/tienda", "/coleccion", "/packs/estandar", "/abrir/estandar", "/", "/packs", "/inventario"];
    if (run("s1")) await s1Slow(1440, delays, paths);
    if (run("s1m")) { await s1Slow(1024, [3000], ["/tienda", "/coleccion", "/"]); await s1Slow(390, [3000], ["/tienda", "/coleccion", "/", "/packs/estandar"]); }
    if (run("s3")) await s3MultiTab();
    if (run("s4")) await s4Guest();
    if (run("s5")) await s5Expired();
    if (run("s6")) await s6AuthFailure();
    if (run("s7")) await s7LoginLogout();
  } finally { stop(); }
  const tag = (only ? only.join("-") : "all") + (arg("--delays") ? `-d${arg("--delays")!.replace(/,/g, "_")}` : "");
  writeFileSync(join(OUT, `results-${tag}.json`), JSON.stringify({ at: new Date().toISOString(), base: BASE, ms: Date.now() - t0, pass: rows.filter((r) => r.ok).length, fail: fails, rows }, null, 2));
  console.log(`\nF81.2 QA ${tag}: ${rows.length - fails}/${rows.length} PASS en ${Math.round((Date.now() - t0) / 1000)} s`);
  process.exit(fails ? 1 : 0);
}
void main();
