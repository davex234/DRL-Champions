/**
 * FASE 70.1 · reproducción en Chrome REAL (perfil persistente: service worker y cachés sobreviven entre ejecuciones,
 * como en el navegador del usuario). Fuera de CI. SOLO cuenta QA.
 *   npx tsx scripts/_fase70-1-repro.ts <up|down> <perfil-dir> [persona=K]
 * up   → login + matriz de rutas con el servidor vivo.
 * down → la misma matriz SIN login, para ver qué pinta el navegador cuando el servidor no responde.
 * Registra por ruta: URL pedida/final, títulos, si la respuesta vino del service worker, fetch fallidos y consola.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { launch } from "./lib/cdp";
import { creds, BASE, sleep } from "./_fase68-lib";

/* eslint-disable @typescript-eslint/no-explicit-any */
const MODE = process.argv[2] ?? "up";
const PROFILE = process.argv[3];
const P = process.argv[4] ?? "K";
if (!PROFILE) throw new Error("falta perfil");
const OUT = join(process.cwd(), "docs/product/qa/fase70-1");
mkdirSync(OUT, { recursive: true });

// Observador de fetch: registra en localStorage cada fetch que termina en error de RED (no de negocio).
const FETCH_OBS = `(() => { try { const K='__f701fetch'; const of = window.fetch; window.fetch = async (...a) => {
  const u = typeof a[0] === 'string' ? a[0] : (a[0] && a[0].url) || String(a[0]); const m = (a[1] && a[1].method) || (a[0] && a[0].method) || 'GET';
  try { return await of(...a); } catch (e) { try { const l = JSON.parse(localStorage.getItem(K) || '[]'); l.push({ url: u.replace(/[?#].*/, ''), method: m, origin: location.origin, page: location.pathname, error: String(e && e.message || e) }); localStorage.setItem(K, JSON.stringify(l.slice(-80))); } catch {} throw e; } }; } catch {} })();`;

(async () => {
  const b = await launch({ userDataDir: PROFILE, args: ["--mute-audio"] });
  const tab = b.tab;
  await tab.send("Page.addScriptToEvaluateOnNewDocument", { source: FETCH_OBS });
  const me = creds(P);
  const res: any = { mode: MODE, base: BASE, at: new Date().toISOString(), routes: [], login: null };
  const go = async (path: string) => { await tab.goto(`${BASE}${path}`, 3500).catch((e) => res.gotoErr = String(e)); await sleep(1200); };
  const fetchFails = async () => tab.js<any[]>(`(() => { try { const l = JSON.parse(localStorage.getItem('__f701fetch') || '[]'); localStorage.removeItem('__f701fetch'); return l; } catch { return []; } })()`).catch(() => []);

  if (MODE === "up") {
    await go("/cuenta");
    const hasForm = await tab.js<boolean>(`!!document.querySelector('input[type="password"]')`);
    if (hasForm) {
      await tab.js(`(() => { const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
        set(document.querySelector('input[type="email"]'), ${JSON.stringify(me.email)}); set(document.querySelector('input[type="password"]'), ${JSON.stringify(me.password)}); document.querySelector('form button[type="submit"]').click(); })()`);
      await sleep(6000);
    }
    res.login = { hadForm: hasForm, formGoneAfter: !(await tab.js<boolean>(`!!document.querySelector('input[type="password"]')`)), fetchFails: await fetchFails(), console: tab.takeErrors() };
  }
  const routes = ["/", "/cuenta", `/jugador/${me.userId}`, "/coleccion", "/inventario", "/duelos/mazos", "/tienda", "/tienda/creditos", "/progresion", "/mundo", "/competitivo", "/entrenador", "/jugar"];
  for (const r of routes) {
    await go(r);
    const info = await tab.js<any>(`(() => { const nav = performance.getEntriesByType('navigation')[0] || {};
      return { finalUrl: location.pathname, title: document.title, h: [...document.querySelectorAll('h1,h2')].map(e => e.innerText.trim()).filter(Boolean).slice(0, 4),
        fromServiceWorker: (nav.workerStart || 0) > 0, swControlled: !!navigator.serviceWorker?.controller, responseStatus: nav.responseStatus ?? null,
        hubSignature: /\\bJUGAR\\b/.test(document.body.innerText) && /\\bINVENTARIO\\b/i.test(document.body.innerText) && /\\bTIENDA\\b/.test(document.body.innerText),
        loginForm: !!document.querySelector('input[type="password"]'), failedText: /Failed to fetch|Algo ha fallado/i.test(document.body.innerText),
        text: (document.querySelector('main') || document.body).innerText.replace(/\\s+/g, ' ').slice(0, 160) }; })()`).catch((e) => ({ error: String(e) }));
    res.routes.push({ requested: r, ...info, fetchFails: await fetchFails(), console: tab.takeErrors().slice(0, 4) });
    console.log(`${r.padEnd(24)} → ${info.finalUrl} sw=${info.fromServiceWorker} status=${info.responseStatus} h=${JSON.stringify(info.h)} hub=${info.hubSignature} login=${info.loginForm} failed=${info.failedText}`);
  }
  writeFileSync(join(OUT, `repro-${MODE}.json`), JSON.stringify(res, null, 2) + "\n");
  await b.close();
  process.exit(0);
})();
