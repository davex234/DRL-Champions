/**
 * QA AUTENTICADA · I18N — utilidades (instrumento, fuera de CI y de la release).
 *
 * Solo funciona contra el STACK DE QA AISLADO (`scripts/ops/i18n-qa-stack`): cuentas sintéticas `@example.invalid`,
 * credenciales en un fichero fuera del repo (`QA_ENV`). Se niega a correr contra valorosters.com o contra el puerto
 * del túnel de producción.
 */
import { readFileSync } from "node:fs";
import { launch, sleep, type Browser, type Tab } from "./lib/cdp";

export { sleep };
export const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3027";
if (/valorosters\.com|:3005\b/.test(BASE)) throw new Error("QA i18n: solo contra el stack de QA aislado, nunca producción");
const envFile = process.env.QA_ENV;
if (!envFile) throw new Error("QA_ENV=<ruta a qa.env> (fuera del repo)");
export const QA: Record<string, string> = Object.fromEntries(readFileSync(envFile, "utf8").split(/\r?\n/).filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
for (const who of ["PLAYER", "ADMIN"]) if (!/@example\.invalid$/.test(QA[`QA_${who}_EMAIL`] ?? "")) throw new Error("cuenta QA no sintética");

export type Who = "PLAYER" | "ADMIN";
export const LOCALES = ["es", "en", "de", "it", "fr", "pt-PT", "pt-BR", "ja"] as const;
export type Loc = (typeof LOCALES)[number];
export const esc = (s: string) => JSON.stringify(s);

export async function token(who: Who): Promise<{ access: string; userId: string; meta: Record<string, unknown> }> {
  const r = await fetch(`${BASE}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: QA.QA_ANON_KEY, "content-type": "application/json" }, body: JSON.stringify({ email: QA[`QA_${who}_EMAIL`], password: QA[`QA_${who}_PASSWORD`] }) });
  const j = await r.json() as { access_token?: string; user?: { id: string; user_metadata: Record<string, unknown> } };
  if (!j.access_token || !j.user) throw new Error(`login ${who}: ${r.status}`);
  return { access: j.access_token, userId: j.user.id, meta: j.user.user_metadata ?? {} };
}

export interface ApiRes { status: number; json: any } // eslint-disable-line @typescript-eslint/no-explicit-any
export async function api(access: string | null, path: string, body?: unknown): Promise<ApiRes> {
  for (let i = 0; i < 6; i++) {
    const r = await fetch(`${BASE}${path}`, { method: body === undefined ? "GET" : "POST", headers: { ...(access ? { authorization: `Bearer ${access}` } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (r.status === 429) { await sleep(Math.max(1, Number(r.headers.get("retry-after") ?? 3)) * 1000); continue; }
    const text = await r.text(); let json: unknown = null; try { json = JSON.parse(text); } catch { json = text; }
    return { status: r.status, json };
  }
  throw new Error(`429 persistente en ${path}`);
}

export interface Client { tab: Tab; browser: Browser; width: number; errors: string[] }
export async function open(width = 1440, opts: { reduced?: boolean; acceptLanguage?: string; gpu?: boolean } = {}): Promise<Client> {
  const browser = await launch({ args: ["--mute-audio", "--hide-scrollbars", ...(process.env.QA_CHROME_ARGS ? process.env.QA_CHROME_ARGS.split(" ") : []), ...(opts.gpu ? ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] : [])] });
  const tab = browser.tab;
  await tab.resize(width, width < 600 ? 844 : width <= 1024 ? 1024 : 900, 1);
  await tab.setMedia([{ name: "prefers-reduced-motion", value: opts.reduced === false ? "no-preference" : "reduce" }]);
  await tab.send("Network.setUserAgentOverride", { userAgent: await tab.js<string>("navigator.userAgent"), acceptLanguage: opts.acceptLanguage ?? "es-ES,es" });
  return { tab, browser, width, errors: [] };
}

export const SETTLED = `!document.querySelector('[class*="z-[100]"][class*="bg-base-900"]') && !!document.querySelector('main, [data-testid]') && document.readyState === 'complete'`;
export async function waitFor(tab: Tab, expr: string, ms = 20000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await tab.js<boolean>(expr).catch(() => false)) return true; await sleep(250); }
  return false;
}
export async function goto(c: Client, path: string, extra = 900): Promise<void> {
  await c.tab.goto(`${BASE}${path}`, 1200);
  await waitFor(c.tab, SETTLED, 30000);
  await sleep(extra);
  collect(c, path);
}
/** Errores de consola relevantes (se ignoran avisos del navegador que no son de la app). */
export function collect(c: Client, at: string): void {
  for (const e of c.tab.takeErrors()) {
    if (/favicon|ERR_ABORTED|net::ERR_FAILED.*flagcdn|Download the React DevTools|GPU stall|WebGL.*(fallback|software|deprecated)|GL Driver Message|swiftshader/i.test(e)) continue;
    c.errors.push(`${at} :: ${e.slice(0, 260)}`);
  }
}
export const q = (tid: string) => `!!document.querySelector('[data-testid="${tid}"]')`;
export async function clickTid(c: Client, tid: string): Promise<boolean> {
  return c.tab.js<boolean>(`(() => { const e = document.querySelector('[data-testid="${tid}"]'); if (!e || e.disabled) return false; e.scrollIntoView({ block: 'center' }); e.click(); return true; })()`);
}
export async function clickText(c: Client, re: string, sel = "button, a"): Promise<boolean> {
  return c.tab.js<boolean>(`(() => { const r = new RegExp(${esc(re)}, 'i'); const e = [...document.querySelectorAll(${esc(sel)})].find((x) => r.test((x.innerText || '').trim()) && !x.disabled && x.getBoundingClientRect().width > 0); if (!e) return false; e.scrollIntoView({ block: 'center' }); e.click(); return true; })()`);
}
export const lang = (c: Client) => c.tab.js<string>("document.documentElement.lang");
export const bodyText = (c: Client) => c.tab.js<string>("document.body.innerText");

/** Elige idioma en el selector real (`/cuenta`). */
export async function chooseLocale(c: Client, l: Loc): Promise<boolean> {
  // con sesión, el selector vive en la pestaña «Cuenta» de /cuenta
  if (!(await waitFor(c.tab, q(`language-${l}`), 4000))) { await goto(c, "/cuenta?seccion=cuenta", 1500); }
  if (!(await waitFor(c.tab, q(`language-${l}`), 15000))) return false;
  await clickTid(c, `language-${l}`);
  return waitFor(c.tab, `document.documentElement.lang === '${l}' && document.querySelector('[data-testid="language-${l}"]')?.getAttribute('aria-pressed') === 'true'`, 15000);
}

/** Inicia sesión por el formulario real de `/cuenta`. */
export async function loginUi(c: Client, who: Who): Promise<boolean> {
  if (!(await waitFor(c.tab, `!!document.querySelector('input[type="password"]')`, 15000))) return false;
  await c.tab.js(`(() => { const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
    set(document.querySelector('input[type="email"]'), ${esc(QA[`QA_${who}_EMAIL`])}); set(document.querySelector('input[type="password"]'), ${esc(QA[`QA_${who}_PASSWORD`])}); document.querySelector('form button[type="submit"]').click(); })()`);
  const ok = await waitFor(c.tab, `!document.querySelector('input[type="password"]')`, 25000);
  await sleep(1800);
  return ok;
}

/** Sonda de pantalla: idioma, desbordes, textos cortados, restos de español y claves visibles. */
export const PROBE = `(() => {
  const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && r.bottom > 0 && r.top < innerHeight * 6; };
  const clipped = [];
  for (const e of document.querySelectorAll('button, a, span, b, p, h1, h2, h3, h4, label, th, td, li, div')) {
    if (!e.childNodes.length || [...e.childNodes].some((c) => c.nodeType !== 3) || !e.textContent.trim() || !vis(e)) continue;
    const s = getComputedStyle(e);
    if (e.scrollWidth > e.clientWidth + 2 && s.overflowX !== 'visible' && s.textOverflow !== 'ellipsis' && !e.closest('[class*="overflow-x-auto"],[class*="overflow-auto"],[class*="sr-only"],[class*="truncate"],[class*="line-clamp"]')) clipped.push('CORTADO: ' + e.textContent.trim().slice(0, 60));
    const r = e.getBoundingClientRect();
    if (r.right > innerWidth + 2 && r.left < innerWidth && !e.closest('[class*="overflow-x-auto"],[class*="overflow-auto"],[class*="overflow-hidden"],[class*="sr-only"]')) clipped.push('FUERA: ' + e.textContent.trim().slice(0, 60));
  }
  for (const b of document.querySelectorAll('button, a[class*="nx-"], [role="button"]')) {
    if (!vis(b)) continue; const r = b.getBoundingClientRect();
    for (const k of b.querySelectorAll('span, b')) { if (!k.textContent.trim() || !vis(k)) continue; const kr = k.getBoundingClientRect(); if (kr.right > r.right + 3 || kr.left < r.left - 3) { clipped.push('BOTON: ' + b.textContent.trim().slice(0, 60)); break; } }
  }
  const text = document.body.innerText;
  const WORDS = {"it":"los|las|el|para|sin|tus|hay|más|todavía|aún|cartas|sobres?|partidas?|equipos?|jugar|abrir|recompensas?|misiones|temporada|tienda|colección|créditos|comprar|cuenta|cerrar|sesión|idioma|ajustes|guardar|cancelar|siguiente|volver|jugador(es)?|nuevo|nueva|todos|todas|aquí|ahora|hoy|días?|semana|con las|de la|garantizad[ao]s?","fr":"el|los|las|del|para|con|sin|tus|una|esta|este|hay|más|todavía|aún|cartas?|sobres|partidas?|equipos?|jugar|abrir|recompensas?|misiones|temporada|tienda|colección|créditos|comprar|cuenta|cerrar|sesión|idioma|ajustes|guardar|cancelar|siguiente|volver|nivel|jugador(es)?|nuevo|nueva|todos|todas|aquí|ahora|hoy|día|días|semana|garantizad[ao]s?","pt":"el|del|con|sin|tus|una|hay|más|todavía|aún|sobres|equipos?|jugar|misiones|tienda|colección|cuenta|cerrar|sesión|siguiente|volver|nivel|jugador(es)?|nuevo|nueva|aquí|ahora|hoy|días|garantizad[ao]s?|recompensas de la|con las|de los","*":"el|la|los|las|del|para|con|sin|tus|una|esta|este|hay|que|más|todavía|aún|cartas?|sobres?|partidas?|equipos?|jugar|abrir|recompensas?|misiones|temporada|tienda|colección|créditos|comprar|cuenta|cerrar|sesión|idioma|ajustes|guardar|cancelar|siguiente|volver|nivel|jugador(es)?|nuevo|nueva|todos|todas|ver|tu|mis?|aquí|ahora|hoy|día|días|semana|garantizad[ao]s?"}; const W = WORDS[document.documentElement.lang.toLowerCase().split('-')[0]] ?? WORDS['*'];
  const ES = new RegExp('(^|[^\\\\p{L}])(' + W + ')([^\\\\p{L}]|$)', 'iu');
  const lines = [...new Set(text.split('\\n').map((l) => l.trim()).filter((l) => l.length > 2 && /\\p{L}{3}/u.test(l)))];
  const keys = lines.filter((l) => /^[a-z]+(\\.[a-zA-Z0-9_]+){1,}$/.test(l) || /\\{[a-zA-Z_]+\\}/.test(l) || /\\{n, plural/.test(l));
  return { lang: document.documentElement.lang, overflow: document.documentElement.scrollWidth - innerWidth, clipped: [...new Set(clipped)].slice(0, 15), lines: lines.length, spanish: lines.filter((l) => ES.test(l)).slice(0, 40), keys: keys.slice(0, 10), hydration: /hydrat|did not match|Minified React error #(418|423|425)/i.test(text) };
})()`;
export interface Probe { lang: string; overflow: number; clipped: string[]; lines: number; spanish: string[]; keys: string[]; hydration: boolean }
export const probe = (c: Client) => c.tab.js<Probe>(PROBE);
