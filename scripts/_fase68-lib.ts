/**
 * FASE 68 · CLOSED BETA — utillaje común de los instrumentos de la beta (fuera de CI). App real :3005 → túnel → BD del VPS.
 * SOLO cuentas QA: aborta si le llega la cuenta del usuario. Credenciales en el scratchpad de la sesión (nunca en el repo).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { launch, sleep, type Tab, type Browser } from "./lib/cdp";

/* eslint-disable @typescript-eslint/no-explicit-any */
export { sleep };
export const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3005";
// F69 · `F68_OUT` redirige la evidencia (las repeticiones de F69 no pisan la de la beta).
export const OUT = join(process.cwd(), process.env.F68_OUT ?? "docs/product/qa/fase68-beta");
export const RAW = join(OUT, "raw");
export const SHOTS = join(OUT, "screenshots");
for (const d of [OUT, RAW, SHOTS]) mkdirSync(d, { recursive: true });
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_0-9]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
// F87 · QA_SB / QA_ANON: Supabase público de producción y su clave anon PÚBLICA (la de .env.local es anterior a F77-S1).
const SB = process.env.QA_SB || env.SUPABASE_INTERNAL_URL || env.NEXT_PUBLIC_SUPABASE_URL, ANON = process.env.QA_ANON || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
export const USER_ACCOUNT_PREFIX = "2f86cbe8";
/** F87 · cuentas REALES que ningún instrumento puede usar: davex (#NB2Z9BM), ValoRosters (#H5ND8K7) y la antigua personal. */
export const REAL_ACCOUNT_PREFIXES = ["2f86cbe8", "3befce61", "b7ccff02"];
export const isRealAccount = (id: unknown): boolean => REAL_ACCOUNT_PREFIXES.some((p) => String(id ?? "").startsWith(p));
/** F87 · `QA_CREDS_DIR=<dir>`: credenciales QA nuevas como `<dir>/<persona>.json` (las de A–K se borraron el 2026-10-05). */
const credFile = (name: string, fallback: string | undefined): string => (process.env.QA_CREDS_DIR ? join(process.env.QA_CREDS_DIR, `${name}.json`) : String(fallback));
const TMP = process.env.TEMP ?? "C:/Users/david/AppData/Local/Temp";
export const SCRATCH = join(TMP, "claude/C--NEXUS-CENTRAL-DRLCards/b6d0c3e1-87c4-49c9-928e-6d61dcb353e9/scratchpad");
export const esc = (s: string) => JSON.stringify(s);
export const log = (s: string) => console.log(s);

/** Personas de la beta. E (RETURNING) es una cuenta QA con historial de F63; el resto nacen en F68 por /cuenta. */
export const PERSONA_FILES: Record<string, string> = {
  A: join(SCRATCH, "f68-A.json"), B: join(SCRATCH, "f68-B.json"), C: join(SCRATCH, "f68-C.json"), D: join(SCRATCH, "f68-D.json"),
  E: join(TMP, "claude/C--NEXUS-CENTRAL-DRLCards/bf089a0a-88d0-408c-a67f-d51d19745e4d/scratchpad/f63-n1-creds.json"),
  F: join(SCRATCH, "f68-F.json"), G: join(SCRATCH, "f68-G.json"), H: join(SCRATCH, "f68-H.json"), I: join(SCRATCH, "f68-I.json"), J: join(SCRATCH, "f68-J.json"),
  // F69 · cuentas nuevas de la regresión final (credenciales en el scratchpad de la sesión F69, nunca en el repo).
  K: join(TMP, "claude/C--NEXUS-CENTRAL-DRLCards/110d56d1-a997-4e41-85dd-fc8ee49ab46e/scratchpad/f69-K.json"),
  L: join(TMP, "claude/C--NEXUS-CENTRAL-DRLCards/110d56d1-a997-4e41-85dd-fc8ee49ab46e/scratchpad/f69-L.json"),
};
export interface Creds { email: string; password: string; userId: string; username?: string }
export function creds(p: string): Creds {
  const c = JSON.parse(readFileSync(credFile(p, PERSONA_FILES[p]), "utf8")) as Creds;
  if (isRealAccount(c.userId)) throw new Error("ESA ES LA CUENTA DEL USUARIO: prohibido");
  return c;
}
export const hasCreds = (p: string) => existsSync(credFile(p, PERSONA_FILES[p]));

export async function token(p: string): Promise<string> {
  const c = creds(p);
  const r = await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "content-type": "application/json" }, body: JSON.stringify({ email: c.email, password: c.password }) });
  const j = await r.json() as any;
  if (!j.access_token) throw new Error(`login ${p}: ${j.error_description ?? r.status}`);
  if (isRealAccount(j.user?.id)) throw new Error("ESA ES LA CUENTA DEL USUARIO: prohibido");
  return j.access_token;
}

export interface ApiRes { status: number; json: any; ms: number }
export async function api(t: string | null, path: string, body?: unknown, noRetry = false): Promise<ApiRes> {
  for (let i = 0; i < 8; i++) {
    const t0 = Date.now();
    const r = await fetch(`${BASE}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { ...(t ? { authorization: `Bearer ${t}` } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (r.status === 429 && !noRetry) { await sleep(Math.max(1, Number(r.headers.get("retry-after") ?? 3)) * 1000); continue; }
    const text = await r.text(); let json: any = null; try { json = JSON.parse(text); } catch { json = text; }
    return { status: r.status, json, ms: Date.now() - t0 };
  }
  throw new Error(`429 persistente en ${path}`);
}

/** Foto de la cuenta por LECTURAS del producto (GET): lo que el jugador tiene según el servidor. */
export async function snapshot(t: string) {
  const [st, decks, ob, comp] = await Promise.all([api(t, "/api/game/state"), api(t, "/api/game/duels"), api(t, "/api/game/onboarding"), api(t, "/api/game/competitive")]);
  const prog = await api(t, "/api/game/progression", { action: "state" });
  const s = st.json ?? {};
  return {
    credits: s.credits ?? null, xp: s.xp ?? null, level: s.level ?? null, packsOpened: s.packsOpened ?? null,
    unopenedPacks: s.unopenedPacks ?? null, ownedCards: (s.ownedCards ?? []).length,
    decks: (decks.json?.decks ?? []).map((d: any) => ({ id: String(d.id).slice(0, 8), name: d.name, valid: d.valid, cards: d.cards?.length ?? d.cardUids?.length ?? null })),
    activeDeckId: decks.json?.activeDeckId ? String(decks.json.activeDeckId).slice(0, 8) : null,
    onboarding: { status: ob.json?.status ?? null, current: ob.json?.current ?? null },
    rating: comp.json?.self?.rating?.rating ?? null, rankedGames: comp.json?.self?.rating?.gamesPlayed ?? null,
    pass: prog.json?.pass ? { level: prog.json.pass.level ?? null, xp: prog.json.pass.xp ?? null } : null,
    progressionKeys: prog.json ? Object.keys(prog.json).slice(0, 20) : null,
  };
}

/* ─────────── navegador ─────────── */

/** Contador de red persistente entre cargas (localStorage): peticiones /api y estáticos, estado, duración. */
const NET_OBSERVER = `(() => { try {
  const K = '__f68net';
  const load = () => { try { return JSON.parse(localStorage.getItem(K) || '{"api":0,"all":0,"byPath":{},"status":{},"bad":[],"slow":[]}'); } catch { return {"api":0,"all":0,"byPath":{},"status":{},"bad":[],"slow":[]}; } };
  const obs = new PerformanceObserver((l) => { const n = load(); for (const e of l.getEntries()) {
    let u; try { u = new URL(e.name); } catch { continue; } if (u.origin !== location.origin) continue;
    n.all++; const st = e.responseStatus || 0; n.status[st] = (n.status[st] || 0) + 1;
    if (u.pathname.startsWith('/api/')) { n.api++; n.byPath[u.pathname] = (n.byPath[u.pathname] || 0) + 1; if (e.duration > 1500 && n.slow.length < 60) n.slow.push(u.pathname + ' ' + Math.round(e.duration)); }
    if ((st >= 400 || st === 0 && e.transferSize === 0 && e.decodedBodySize === 0 && e.initiatorType !== 'fetch' && false) && n.bad.length < 80) n.bad.push(st + ' ' + u.pathname);
  } try { localStorage.setItem(K, JSON.stringify(n)); } catch {} });
  obs.observe({ type: 'resource', buffered: true });
} catch {} })()`;

export interface Client {
  persona: string; tab: Tab; browser: Browser; width: number; errors: { at: string; url: string; text: string }[];
  screens: number; actions: number; label: string;
}

export async function openBrowser(persona: string, width = 1440, opts: { reduced?: boolean; label?: string; userDataDir?: string } = {}): Promise<Client> {
  const browser = await launch({ args: ["--mute-audio", "--in-process-gpu", "--hide-scrollbars"], userDataDir: opts.userDataDir });
  const tab = browser.tab;
  await tab.resize(width, width < 600 ? 844 : width <= 1024 ? 768 : 900, 1);
  await tab.setMedia([{ name: "prefers-reduced-motion", value: opts.reduced ? "reduce" : "no-preference" }]);
  await tab.send("Page.addScriptToEvaluateOnNewDocument", { source: NET_OBSERVER });
  return { persona, tab, browser, width, errors: [], screens: 0, actions: 0, label: opts.label ?? persona };
}

export async function net(c: Client): Promise<any> { return c.tab.js<any>(`(() => { try { return JSON.parse(localStorage.getItem('__f68net') || 'null'); } catch { return null; } })()`).catch(() => null); }
export async function netReset(c: Client) { await c.tab.js(`(() => { try { localStorage.removeItem('__f68net'); } catch {} })()`).catch(() => null); }

export const waitFor = async (tab: Tab, expr: string, ms = 20000) => {
  for (let i = 0; i < ms / 200; i++) { if (await tab.js<boolean>(expr).catch(() => false)) return true; await sleep(200); }
  return false;
};
export const SPLASH_GONE = `!document.querySelector('[class*="z-[100]"][class*="bg-base-900"]')`;
export const q = (tid: string) => `!!document.querySelector('[data-testid="${tid}"]')`;
export async function clickTid(c: Client, tid: string): Promise<boolean> {
  const ok = await c.tab.js<boolean>(`(() => { const e = document.querySelector('[data-testid="${tid}"]'); if (!e || e.disabled) return false; e.scrollIntoView({block:'center'}); e.click(); return true; })()`);
  if (ok) c.actions++;
  return ok;
}
export async function clickText(c: Client, re: string, sel = "button, a"): Promise<boolean> {
  const ok = await c.tab.js<boolean>(`(() => { const b = [...document.querySelectorAll(${esc(sel)})].find(x => new RegExp(${esc(re)}, 'i').test((x.innerText||x.textContent||'').trim()) && !x.disabled && x.offsetParent !== null); if (!b) return false; b.scrollIntoView({block:'center'}); b.click(); return true; })()`);
  if (ok) c.actions++;
  return ok;
}
/** Doble clic real (dos eventos seguidos en el mismo elemento). */
export async function dblText(c: Client, re: string, sel = "button, a"): Promise<boolean> {
  const ok = await c.tab.js<boolean>(`(() => { const b = [...document.querySelectorAll(${esc(sel)})].find(x => new RegExp(${esc(re)}, 'i').test((x.innerText||x.textContent||'').trim()) && !x.disabled && x.offsetParent !== null); if (!b) return false; b.click(); b.click(); return true; })()`);
  if (ok) c.actions += 2;
  return ok;
}
export async function dblTid(c: Client, tid: string): Promise<boolean> {
  const ok = await c.tab.js<boolean>(`(() => { const e = document.querySelector('[data-testid="${tid}"]'); if (!e || e.disabled) return false; e.click(); e.click(); return true; })()`);
  if (ok) c.actions += 2;
  return ok;
}

/** Recoge los errores de consola de la pantalla actual. */
export async function collectErrors(c: Client) {
  const url = await c.tab.js<string>("location.pathname + location.search").catch(() => "?");
  for (const text of c.tab.takeErrors()) c.errors.push({ at: new Date().toISOString(), url, text });
}

export async function goto(c: Client, path: string, settle = 1800) {
  await collectErrors(c);
  await c.tab.goto(`${BASE}${path}`, settle);
  await waitFor(c.tab, SPLASH_GONE, 6000);
  c.screens++; c.actions++;
}
export async function reload(c: Client, settle = 2500) {
  await collectErrors(c);
  await c.tab.send("Page.reload", {});
  await sleep(settle);
  await waitFor(c.tab, SPLASH_GONE, 6000);
  c.actions++;
}
export async function back(c: Client, settle = 2000) {
  await collectErrors(c);
  await c.tab.js("history.back()"); await sleep(settle); c.actions++;
}
export async function forward(c: Client, settle = 2000) {
  await collectErrors(c);
  await c.tab.js("history.forward()"); await sleep(settle); c.actions++;
}

export async function shot(c: Client, name: string) {
  await sleep(400);
  await c.tab.shot(join(SHOTS, `${c.label}-${name}-${c.width}.png`)).catch(() => null);
}

/** Qué hay en pantalla: textos visibles, testids y botones (para la sonda y para las notas de sesión). */
export async function screen(c: Client): Promise<any> {
  return c.tab.js<any>(`(() => ({
    url: location.pathname + location.search,
    title: document.title,
    h: [...document.querySelectorAll('h1, h2')].map(e => e.innerText.trim()).filter(Boolean).slice(0, 8),
    testids: [...new Set([...document.querySelectorAll('[data-testid]')].map(e => e.getAttribute('data-testid')))].slice(0, 120),
    buttons: [...document.querySelectorAll('button')].filter(b => b.offsetParent !== null).map(b => (b.innerText||'').trim().replace(/\\s+/g,' ')).filter(Boolean).slice(0, 60),
    links: [...document.querySelectorAll('a[href]')].filter(b => b.offsetParent !== null).map(a => a.getAttribute('href')).slice(0, 80),
    text: (document.querySelector('main') || document.body).innerText.replace(/\\s+/g, ' ').slice(0, 700),
    hScroll: document.documentElement.scrollWidth > innerWidth + 1,
    broken: [...document.images].filter(i => i.complete && i.naturalWidth === 0).map(i => i.currentSrc || i.src).slice(0, 10),
  }))()`);
}

export const bodyHas = (c: Client, re: string) => c.tab.js<boolean>(`new RegExp(${esc(re)}, 'i').test(document.body.innerText)`);

export async function setInput(c: Client, selector: string, value: string) {
  await c.tab.js(`(() => { const el = document.querySelector(${esc(selector)}); if (!el) return false; const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, ${esc(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
}

/** Registro REAL por /cuenta (GoTrue con autoconfirmación en la beta local). */
export async function registerUi(c: Client, persona: string): Promise<Creds> {
  const tag = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const cr: Creds = { email: `qa-f68-${persona.toLowerCase()}-${tag}@example.invalid`, password: randomBytes(18).toString("base64url"), userId: "", username: `qaf68${persona.toLowerCase()}${tag.slice(-6)}` };
  await goto(c, "/cuenta", 2500);
  await clickText(c, "registro", "button");
  await sleep(400);
  await c.tab.js(`(() => {
    const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
    const user = [...document.querySelectorAll('form input')].find(i => i.type === 'text'); if (user) set(user, ${esc(cr.username!)});
    set(document.querySelector('input[type="email"]'), ${esc(cr.email)}); set(document.querySelector('input[type="password"]'), ${esc(cr.password)});
    document.querySelector('form button[type="submit"]').click(); })()`);
  c.actions += 4;
  await waitFor(c.tab, `location.pathname === '/' || !document.querySelector('input[type="password"]')`, 25000);
  await sleep(1500);
  cr.userId = await c.tab.js<string>(`(() => { for (const k of Object.keys(localStorage)) if (k.includes('auth-token')) { try { return JSON.parse(localStorage.getItem(k)).user.id } catch {} } return '' })()`);
  if (!cr.userId || isRealAccount(cr.userId)) throw new Error("registro sin usuario");
  writeFileSync(credFile(persona, PERSONA_FILES[persona]), JSON.stringify(cr), { mode: 0o600 });
  return cr;
}

/** Login REAL por /cuenta (formulario). */
export async function loginUi(c: Client, persona: string): Promise<boolean> {
  const cr = creds(persona);
  await goto(c, "/cuenta", 2500);
  if (!(await c.tab.js<boolean>(`!!document.querySelector('input[type="password"]')`))) return true;
  await c.tab.js(`(() => { const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
    set(document.querySelector('input[type="email"]'), ${esc(cr.email)}); set(document.querySelector('input[type="password"]'), ${esc(cr.password)}); document.querySelector('form button[type="submit"]').click(); })()`);
  c.actions += 3;
  const ok = await waitFor(c.tab, `!document.querySelector('input[type="password"]')`, 25000);
  await sleep(1500);
  return ok;
}

export async function logoutUi(c: Client): Promise<boolean> {
  await goto(c, "/cuenta", 2500);
  const ok = await clickText(c, "^(Cerrar sesi[oó]n|Salir)$", "button");
  await sleep(2500);
  return ok && await waitFor(c.tab, `!!document.querySelector('input[type="password"]') || /Entrar|Iniciar sesi/i.test(document.body.innerText)`, 15000);
}

/** Notas de sesión: escribe raw/<id>.json. */
export function writeRaw(id: string, data: unknown) {
  writeFileSync(join(RAW, `${id}.json`), JSON.stringify(data, null, 2));
  log(`→ raw/${id}.json`);
}
export function readRaw(id: string): any { const f = join(RAW, `${id}.json`); return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null; }

/** Juega UNA jugada por la interfaz de duelo (PvE o PvP): carta → eje si ataca → confirmar. */
export async function playOneUi(c: Client, dbl = false): Promise<string> {
  const tab = c.tab;
  await tab.js(`document.querySelector('[data-f61="moment"]')?.click()`).catch(() => null);
  const ok = await waitFor(tab, `(() => { const b = [...document.querySelectorAll('[aria-label="Tu mano"] button')].filter(x => !x.disabled); return b.length > 0 && !document.querySelector('[data-scene="intro"]') && !document.querySelector('[data-f61="moment"]'); })()`, 25000);
  if (!ok) return "hand-not-ready";
  await tab.js(`(() => { const h = [...document.querySelectorAll('[aria-label="Tu mano"] button')].filter(x => !x.disabled); h[Math.floor(Math.random() * h.length)].click(); })()`);
  await sleep(250);
  await tab.js(`(() => { const s = [...document.querySelectorAll('button')].filter(b => /^(SH|GS|EF)\\s*\\d+$/.test((b.textContent||'').trim()) && !b.disabled); if (s.length) s[Math.floor(Math.random() * s.length)].click(); return s.length; })()`);
  await sleep(250);
  const clicked = await tab.js<boolean>(`(() => { const b = [...document.querySelectorAll('button')].find(x => /^(Declarar y atacar|Responder)$/i.test((x.textContent||'').trim()) && !x.disabled); if (!b) return false; b.click(); ${dbl ? "b.click();" : ""} return true; })()`);
  c.actions += dbl ? 4 : 3;
  return clicked ? "played" : "no-confirm";
}

export { launch, type Tab };
