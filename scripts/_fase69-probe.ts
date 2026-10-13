/**
 * FASE 69 · sondas de cierre (fuera de CI, solo lectura: GET y navegación, sin compras ni reclamos). SOLO cuentas QA.
 *   npx tsx scripts/_fase69-probe.ts <persona>
 * 1) Terminología competitiva viva (/cuenta, /competitivo, /ranking) — F68-013.
 * 2) CLS de /cuenta (3 cargas, PerformanceObserver layout-shift sin entrada reciente).
 * 3) Rastreo de enlaces internos desde las pantallas principales (GET de cada ruta) y de assets (<img>, 404 de red).
 * 4) Foco: hoja «Menú» a 390 (Tab/Shift+Tab dentro, Escape cierra, foco vuelve) y desplegable «Más» a 1440 (Escape).
 */
import {
  openBrowser, loginUi, goto, sleep, net, netReset, collectErrors, creds, BASE, type Client,
} from "./_fase68-lib";
import { writeRaw69, shot69 } from "./_fase69-lib";

/* eslint-disable @typescript-eslint/no-explicit-any */
const P = process.argv[2] ?? "J";
// F69 (reanudación) · ancho del rastreo (responsive 390/1024/1440); por defecto 1440 como siempre.
const W = Number(process.argv[3] ?? 1440);
const PAGES = ["/", "/jugar", "/coleccion", "/duelos/mazos", "/tienda", "/progresion", "/temporada", "/competitivo", "/cuenta", "/entrenador",
  "/social", "/logros", "/ranking", "/pickems", "/inventario", "/eventos", "/torneos", "/como-jugar", "/boveda", "/mundo", "/duelos", "/duelos/pvp", "/entrenador/jugar"];
const text = (c: Client) => c.tab.js<string>(`(document.querySelector('main') || document.body).innerText.replace(/\\s+/g, ' ')`);

async function key(c: Client, k: string, shift = false) {
  const kc: Record<string, number> = { Tab: 9, Enter: 13, Escape: 27 };
  await c.tab.send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code: k, windowsVirtualKeyCode: kc[k] ?? 0, modifiers: shift ? 8 : 0 });
  await c.tab.send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code: k, windowsVirtualKeyCode: kc[k] ?? 0, modifiers: shift ? 8 : 0 });
  await sleep(150);
}
const active = (c: Client) => c.tab.js<any>(`(() => { const a = document.activeElement; if (!a || a === document.body) return null; const d = a.closest('[role="dialog"],[aria-modal="true"]'); return { tag: a.tagName, text: (a.innerText || a.getAttribute('aria-label') || '').trim().slice(0, 40), inDialog: !!d }; })()`);

(async () => {
  const out: any = { persona: P, at: new Date().toISOString(), base: BASE };
  const uid = creds(P).userId;
  // ─── 1+2+3 a 1440 ───
  const c = await openBrowser(P, W, { label: `probe-${P}-${W}` });
  try {
    await loginUi(c, P);
    await goto(c, "/cuenta", 5000);
    const cuenta = await text(c);
    await goto(c, "/competitivo", 5000);
    const comp = await text(c);
    await goto(c, "/ranking", 5000);
    const rank = await text(c);
    const near = (t: string, re: RegExp, n = 90) => { const m = t.match(re); return m ? t.slice(Math.max(0, m.index! - 20), m.index! + n) : null; };
    out.terminology = {
      cuenta: { rangoDePuntos: near(cuenta, /RANGO DE PUNTOS/i), ratingElo: near(cuenta, /RATING RANKED \(ELO\)/i), puestoRanked: near(cuenta, /PUESTO RANKED/i), oldRatingPvp: /RATING PVP/i.test(cuenta), bareRango: /(^|[^A-ZÁÉÍÓÚ])RANGO(?! DE PUNTOS)(?!S DE PUNTOS)/.test(cuenta.toUpperCase()) },
      competitivo: { namedTierNearElo: /(BRONCE|PLATA|ORO|PLATINO|DIAMANTE|MAESTRO|NEXUS)\s+(I{1,3})\b/i.test(comp), sample: comp.slice(0, 400), usesPuesto: /PUESTO|ESCALERA/i.test(comp), legacyRangoLoading: /Leyendo tu rango/i.test(comp) },
      ranking: { title: near(rank, /CLASIFICACI[ÓO]N/i, 180), rangosDePuntos: /RANGOS DE PUNTOS/i.test(rank), laEscalera: /LA ESCALERA/i.test(rank) },
    };
    await shot69(c, "cuenta-terminologia");
    // CLS de /cuenta
    const cls: number[] = [];
    // Un solo observador (registrarlo en cada vuelta sumaba el mismo desplazamiento 1×, 2×, 3×).
    await c.tab.send("Page.addScriptToEvaluateOnNewDocument", { source: `window.__cls=0;try{new PerformanceObserver(l=>{for(const e of l.getEntries()){if(!e.hadRecentInput)window.__cls+=e.value}}).observe({type:'layout-shift',buffered:true})}catch{}` });
    for (let i = 0; i < 3; i++) {
      await goto(c, "/cuenta", 6000);
      cls.push(await c.tab.js<number>(`Math.round((window.__cls||0)*1000)/1000`));
    }
    out.cuentaCls = cls;
    // Rastreo de enlaces y assets
    const hrefs = new Set<string>(); const imgs = new Set<string>(); const perPage: any[] = [];
    for (const p of [...PAGES, `/jugador/${uid}`]) {
      await netReset(c);
      await goto(c, p, 3500);
      const found = await c.tab.js<any>(`(() => ({
        h: [...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href')).filter(h => h && h.startsWith('/') && !h.startsWith('//')),
        i: [...document.querySelectorAll('img')].map(i => i.currentSrc || i.src).filter(Boolean),
        broken: [...document.querySelectorAll('img')].filter(i => i.complete && i.naturalWidth === 0 && (i.currentSrc || i.src)).map(i => i.currentSrc || i.src),
        hScroll: document.documentElement.scrollWidth > window.innerWidth + 1,
        wider: [...document.querySelectorAll('main *')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > window.innerWidth + 2 || r.left < -2) && getComputedStyle(e).position !== 'fixed' && !e.closest('[aria-hidden="true"],.overflow-x-auto,.overflow-x-scroll,.overflow-hidden,.overflow-x-hidden,.overflow-clip,[data-scroll-rail]'); }).length,
        title: document.title, notFound: /no encontrada|404/i.test(document.body.innerText.slice(0, 400)) }))()`);
      found.h.forEach((h: string) => hrefs.add(h.split("#")[0].split("?")[0] || "/"));
      found.i.forEach((s: string) => imgs.add(s));
      const n = await net(c);
      perPage.push({ page: p, width: W, hScroll: found.hScroll, wider: found.wider, links: found.h.length, imgs: found.i.length, brokenImgs: found.broken, notFound: found.notFound, bad: (n?.bad ?? []).slice(0, 5), requests: n?.all ?? null, api: n?.api ?? null });
    }
    const links: any[] = [];
    for (const h of [...hrefs].sort()) {
      if (/^\/(api|_next)\//.test(h)) continue;
      const r = await fetch(`${BASE}${h}`, { redirect: "manual" }).catch(() => null);
      links.push({ href: h, status: r?.status ?? 0, location: r?.headers.get("location") ?? undefined });
    }
    const assets: any[] = [];
    for (const s of [...imgs]) {
      if (!s.startsWith(BASE) && !s.startsWith("/")) { assets.push({ src: s.slice(0, 80), external: true }); continue; }
      const r = await fetch(s.startsWith("/") ? `${BASE}${s}` : s).catch(() => null);
      if (!r || r.status >= 400) assets.push({ src: s.replace(BASE, ""), status: r?.status ?? 0 });
    }
    out.crawl = { pages: perPage, internalLinks: links.length, linksNot2xx3xx: links.filter((l) => l.status >= 400 || l.status === 0), links, images: imgs.size, imagesBroken: assets.filter((a) => !a.external), externalImages: assets.filter((a) => a.external) };
    // F68-014 · partida inválida → «no encontrada» con salida (no «Reintentar»).
    await goto(c, "/duelos/competitivo/partida/nope", 4000);
    const bad = await text(c);
    out.f68_014 = { notFound: /Partida no encontrada/i.test(bad), exit: /Volver al competitivo/i.test(bad), retryOnly: /Reintentar/i.test(bad) && !/no encontrada/i.test(bad) };
    await collectErrors(c); out.consoleErrors1440 = c.errors;
  } finally { await c.browser.close(); }

  // ─── 4 · foco en la hoja «Menú» (390) y «Más» (1440) ───
  const m = await openBrowser(P, 390, { label: `probe-${P}-390` });
  try {
    await loginUi(m, P);
    // La portada tiene su propia cabecera («Más opciones») sin `shell-menu`: el menú del armazón se prueba donde existe.
    await goto(m, "/coleccion", 4000);
    const opened = await m.tab.js<boolean>(`(() => { const b = document.querySelector('[data-testid="shell-menu"]'); if (!b) return false; b.focus(); b.click(); return true; })()`);
    await sleep(800);
    const ev: any = { opened, dialog: await m.tab.js<boolean>(`!!document.querySelector('[role="dialog"],[aria-modal="true"]')`) };
    const seq: any[] = [];
    for (let i = 0; i < 25; i++) { await key(m, "Tab"); seq.push(await active(m)); }
    ev.tabStaysInDialog = seq.every((x) => x?.inDialog);
    const back: any[] = [];
    for (let i = 0; i < 5; i++) { await key(m, "Tab", true); back.push(await active(m)); }
    ev.shiftTabStaysInDialog = back.every((x) => x?.inDialog);
    await key(m, "Escape"); await sleep(600);
    ev.closedByEscape = !(await m.tab.js<boolean>(`!!document.querySelector('[role="dialog"],[aria-modal="true"]')`));
    ev.focusAfterClose = await active(m);
    ev.focusReturnedToOpener = await m.tab.js<boolean>(`document.activeElement?.getAttribute('data-testid') === 'shell-menu'`);
    out.mobileMenuFocus = ev;
    await collectErrors(m); out.consoleErrors390 = m.errors;
  } finally { await m.browser.close(); }

  // F68-009 · enlace de correo caducado (sin sesión): aviso claro y el # limpio.
  const a = await openBrowser(P, 1440, { label: `probe-${P}-anon` });
  try {
    await a.tab.goto(`${BASE}/cuenta#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired`, 4000);
    await sleep(1500);
    const t = await a.tab.js<string>(`document.body.innerText`);
    out.f68_009 = { message: /caducado o ya se us[oó]/i.test(t), hashCleared: await a.tab.js<boolean>(`!location.hash.includes('error')`), rawEnglish: /Email link is invalid/i.test(t) };
  } finally { await a.browser.close(); }

  out.verdict = {
    terminologyOk: !!out.terminology.cuenta.rangoDePuntos && !out.terminology.cuenta.oldRatingPvp && !out.terminology.competitivo.namedTierNearElo && out.terminology.ranking.rangosDePuntos && !out.terminology.ranking.laEscalera,
    brokenLinks: out.crawl.linksNot2xx3xx.length, brokenImages: out.crawl.imagesBroken.length,
    cuentaClsMax: Math.max(...out.cuentaCls),
    menuFocusTrap: out.mobileMenuFocus.tabStaysInDialog && out.mobileMenuFocus.shiftTabStaysInDialog && out.mobileMenuFocus.closedByEscape,
  };
  writeRaw69(W === 1440 ? `probe-${P}` : `probe-${P}-${W}`, out);
  console.log(JSON.stringify(out.verdict, null, 1));
})().catch((e) => { console.error(e); process.exit(1); });
