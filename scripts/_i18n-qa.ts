/**
 * QA EN NAVEGADOR · I18N (instrumento, fuera de CI y de la release).
 *
 *   BASE_URL=http://127.0.0.1:3005 npx tsx scripts/_i18n-qa.ts            recorrido + capturas (es/en/de/it × 1440/768/390)
 *   BASE_URL=… npx tsx scripts/_i18n-qa.ts flows                          solo los flujos (selector, detección, persistencia)
 *   I18N_ROUTES=/tienda,/packs I18N_LOCALES=de I18N_WIDTHS=390 …          acotar
 *
 * Por pantalla e idioma comprueba: `<html lang>`, desbordamiento horizontal, textos cortados (un texto de una línea
 * más ancho que su caja sin elipsis) y RESTOS DE ESPAÑOL (líneas visibles con palabras españolas fuera de español).
 * Escribe docs/product/qa/i18n/<idioma>/<ancho>-<ruta>.png y logs/i18n/qa-report.json.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep, type Tab } from "./lib/cdp";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3005";
const OUT = join(process.cwd(), "docs/product/qa/i18n");
const LOCALES = (process.env.I18N_LOCALES ?? "es,en,de,it").split(",");
const WIDTHS = (process.env.I18N_WIDTHS ?? "1440,768,390").split(",").map(Number);
const ROUTES = (process.env.I18N_ROUTES ?? "/,/jugar,/duelos,/tienda,/packs,/coleccion,/inventario,/temporada,/temporada/pase,/misiones,/misiones/crafting,/ranking,/competitivo,/copas,/torneos,/pickems,/social,/entrenador,/como-jugar,/cuenta,/tienda/creditos,/duelos/mazos,/esta-ruta-no-existe").split(",");
const MODE = process.argv[2] ?? "all";

const PROBE = `(() => {
  const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && r.bottom > 0 && r.top < innerHeight * 6; };
  const clipped = [];
  for (const e of document.querySelectorAll('button, a, span, b, p, h1, h2, h3, h4, label, th, td, li, div')) {
    if (!e.childNodes.length || [...e.childNodes].some((c) => c.nodeType !== 3) || !e.textContent.trim() || !vis(e)) continue;
    const s = getComputedStyle(e);
    if (e.scrollWidth > e.clientWidth + 2 && s.overflowX !== 'visible' && s.textOverflow !== 'ellipsis' && !e.closest('[class*="overflow-x-auto"],[class*="overflow-auto"],[class*="sr-only"]')) clipped.push(e.textContent.trim().slice(0, 60));
    const r = e.getBoundingClientRect();
    if (r.right > innerWidth + 2 && r.left < innerWidth && !e.closest('[class*="overflow-x-auto"],[class*="overflow-auto"],[class*="overflow-hidden"],[class*="sr-only"]')) clipped.push('FUERA: ' + e.textContent.trim().slice(0, 60));
  }
  const text = (document.querySelector('main') || document.body).innerText + '\\n' + (document.querySelector('header')?.innerText ?? '') + '\\n' + (document.querySelector('nav')?.innerText ?? '');
  const ES = /(^|[^\\p{L}])(el|la|los|las|del|para|con|sin|tus|una|esta|este|hay|que|más|todavía|aún|cartas?|sobres?|partidas?|equipos?|jugar|abrir|recompensas?|misiones|temporada|tienda|colección|iniciar|sesión|cuenta|ajustes|siguiente|continuar|volver|cargando|ganas|pierdes|créditos|duelos?|ronda|rival|nivel|gratis|comprar|reclamar|todos|todas|ver|nuevo|nueva|ahora|hoy)([^\\p{L}]|$)/iu;
  const lines = [...new Set(text.split('\\n').map((l) => l.trim()).filter((l) => l.length > 2 && /\\p{L}{3}/u.test(l)))];
  const spanish = lines.filter((l) => ES.test(l));
  return { lang: document.documentElement.lang, overflow: document.documentElement.scrollWidth - innerWidth, clipped: [...new Set(clipped)].slice(0, 12), lines: lines.length, spanish: spanish.slice(0, 40), spanishCount: spanish.length, title: document.title, keys: lines.filter((l) => /^[a-z]+(\\.[a-zA-Z_]+){1,}$/.test(l)).slice(0, 5) };
})()`;

const SETTLED = `!document.querySelector('[class*="z-[100]"][class*="bg-base-900"]') && !!document.querySelector('main, [data-testid]') && document.readyState === 'complete'`;

async function open(width: number, acceptLanguage?: string): Promise<{ tab: Tab; close: () => Promise<void> }> {
  const b = await launch({ args: ["--mute-audio", "--hide-scrollbars"] });
  await b.tab.resize(width, width < 600 ? 844 : width <= 1024 ? 1024 : 900, 1);
  await b.tab.setMedia([{ name: "prefers-reduced-motion", value: "reduce" }]);
  if (acceptLanguage) await b.tab.send("Network.setUserAgentOverride", { userAgent: await b.tab.js<string>("navigator.userAgent"), acceptLanguage });
  return { tab: b.tab, close: b.close };
}
async function visit(tab: Tab, path: string, extra = 700) {
  await tab.goto(`${BASE}${path}`, 1200);
  for (let i = 0; i < 150; i++) { if (await tab.js<boolean>(SETTLED).catch(() => false)) break; await sleep(200); }
  await sleep(extra);
}
const slug = (r: string) => (r === "/" ? "home" : r.replace(/^\//, "").replace(/[/?=&]/g, "_"));

interface Row { locale: string; width: number; route: string; lang: string; overflow: number; clipped: string[]; lines: number; spanishCount: number; spanish: string[]; keys: string[]; errors: string[] }
const rows: Row[] = [];
const checks: { name: string; ok: boolean; detail?: unknown }[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => { checks.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} · ${name}${ok ? "" : ` ${JSON.stringify(detail)}`}`); };

async function crawl() {
  for (const locale of LOCALES) for (const width of WIDTHS) {
    const { tab, close } = await open(width);
    try {
      await tab.send("Page.addScriptToEvaluateOnNewDocument", { source: `try { localStorage.setItem('vr.locale', JSON.stringify({ locale: ${JSON.stringify(locale)}, at: 1 })); } catch {}` });
      mkdirSync(join(OUT, locale), { recursive: true });
      for (const route of ROUTES) {
        await visit(tab, route);
        tab.takeErrors();
        const p = await tab.js<Omit<Row, "locale" | "width" | "route" | "errors">>(PROBE);
        await tab.shot(join(OUT, locale, `${width}-${slug(route)}.png`));
        const errors = tab.takeErrors().filter((e) => !/favicon|Failed to load resource|net::ERR|supabase|fetch/i.test(e)).slice(0, 3);
        rows.push({ locale, width, route, ...p, errors });
        const flag = [p.lang !== locale && `lang=${p.lang}`, p.overflow > 1 && `desborda ${p.overflow}px`, p.clipped.length && `cortados ${p.clipped.length}`, locale !== "es" && p.spanishCount && `español ${p.spanishCount}/${p.lines}`, p.keys.length && `claves ${p.keys.length}`, errors.length && `errores ${errors.length}`].filter(Boolean).join(" · ");
        console.log(`${locale} ${String(width).padStart(4)} ${route.padEnd(26)} ${flag || "ok"}`);
      }
    } finally { await close(); }
  }
}

/**
 * ARNESES (solo en `next dev`): cada /design-system/<fase> es un índice de escenas (?scene=…) que pinta las pantallas
 * REALES con datos fijos. Se descubren sus enlaces y se recorren hasta `I18N_SCENES` por arnés.
 */
async function discover(): Promise<string[]> {
  const per = Number(process.env.I18N_SCENES ?? 6);
  const { tab, close } = await open(1440);
  const out: string[] = [];
  try {
    for (const index of ROUTES) {
      await visit(tab, index, 400);
      const links = await tab.js<string[]>(`[...new Set([...document.querySelectorAll('a[href*="/design-system/"]')].map((a) => a.getAttribute('href')).filter((h) => h && h.includes('?')))]`).catch(() => []);
      const step = Math.max(1, Math.floor(links.length / per));
      out.push(...(links.length ? links.filter((_, i) => i % step === 0).slice(0, per) : [index]));
    }
  } finally { await close(); }
  return out;
}

async function flows() {
  // 1 · Detección: navegador en alemán, visitante nuevo → alemán; navegador en japonés → español.
  for (const [accept, want] of [["de-DE,de;q=0.9", "de"], ["it-IT", "it"], ["en-US,en", "en"], ["ja-JP,ja", "es"], ["es-ES", "es"]] as const) {
    const { tab, close } = await open(1440, accept);
    try {
      await visit(tab, "/cuenta");
      const r = await tab.js<{ lang: string; stored: string | null }>(`({ lang: document.documentElement.lang, stored: localStorage.getItem('vr.locale') })`);
      check(`detección · navegador «${accept}» → ${want}`, r.lang === want, r);
      check(`detección · «${accept}» no guarda preferencia (solo se detecta)`, r.stored === null, r);
    } finally { await close(); }
  }

  // 2 · Selector: cambia sin navegar ni recargar, guarda, y persiste tras recargar.
  const { tab, close } = await open(1440, "es-ES");
  try {
    await visit(tab, "/cuenta");
    const before = await tab.js<{ href: string; loads: number; sel: boolean }>(`({ href: location.href, loads: performance.getEntriesByType('navigation').length, sel: !!document.querySelector('[data-testid="language-settings"]') })`);
    check("selector · visible sin sesión en /cuenta", before.sel, before);
    await tab.js(`document.querySelector('input[type="email"], input[name="email"]') && (function(){ const i = document.querySelector('input[type="email"], input[name="email"]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'borrador@ejemplo.test'); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    const loads0 = tab.loadCount();
    const seen: Record<string, unknown> = {};
    for (const l of ["en", "de", "it", "es", "de"]) {
      await tab.js(`document.querySelector('[data-testid="language-${l}"]').click()`);
      for (let i = 0; i < 50; i++) { if (await tab.js<boolean>(`document.documentElement.lang === ${JSON.stringify(l)}`)) break; await sleep(100); }
      await sleep(300);
      seen[l] = await tab.js(`({ lang: document.documentElement.lang, pressed: document.querySelector('[data-testid="language-${l}"]').getAttribute('aria-pressed'), stored: JSON.parse(localStorage.getItem('vr.locale') || 'null')?.locale, cookie: (document.cookie.match(/vr_locale=([a-z]+)/) || [])[1], href: location.href, email: document.querySelector('input[type="email"], input[name="email"]')?.value ?? null, heading: document.querySelector('h1, h2')?.innerText })`);
    }
    const ok = (l: string) => { const s = seen[l] as { lang: string; pressed: string; stored: string; cookie: string; href: string }; return s.lang === l && s.pressed === "true" && s.stored === l && s.cookie === l && s.href === before.href; };
    check("selector · los cuatro idiomas se aplican (lang, aria-pressed, localStorage, cookie) sin cambiar de URL", ["en", "de", "it", "es"].every(ok), seen);
    check("selector · no recarga la página", tab.loadCount() === loads0, { loads0, now: tab.loadCount() });
    check("selector · el formulario a medio escribir se conserva al cambiar de idioma", (seen.de as { email: string | null }).email === "borrador@ejemplo.test", seen.de);
    check("selector · los textos cambian de verdad (cabecera distinta entre idiomas)", new Set(["en", "de", "it", "es"].map((l) => (seen[l] as { heading: string }).heading)).size >= 3, ["en", "de", "it", "es"].map((l) => (seen[l] as { heading: string }).heading));
    await visit(tab, "/tienda");
    check("persistencia · al navegar a otra pantalla sigue en alemán", await tab.js<boolean>(`document.documentElement.lang === 'de'`));
    await visit(tab, "/cuenta");
    const after = await tab.js<{ lang: string; pressed: string | null }>(`({ lang: document.documentElement.lang, pressed: document.querySelector('[data-testid="language-de"]')?.getAttribute('aria-pressed') ?? null })`);
    check("persistencia · tras recargar manda la preferencia guardada sobre el navegador (es-ES)", after.lang === "de" && after.pressed === "true", after);
    // operación crítica: el cambio se aplaza
    const deferred = await tab.js<{ during: string; pending: string | null }>(`(async () => { const m = window; const ev = new StorageEvent('storage', { key: 'vr.locale', newValue: JSON.stringify({ locale: 'it', at: Date.now() }) }); m.__vrEnd = null; return { during: document.documentElement.lang, pending: null }; })()`);
    void deferred;
  } finally { await close(); }
}

(async () => {
  mkdirSync(OUT, { recursive: true });
  if (MODE === "all" || MODE === "flows") await flows();
  if (MODE === "harness") { const found = await discover(); ROUTES.length = 0; ROUTES.push(...found); console.log(`escenas: ${found.length}`); await crawl(); }
  if (MODE === "all" || MODE === "crawl") await crawl();
  const summary = LOCALES.map((l) => {
    const r = rows.filter((x) => x.locale === l);
    return { locale: l, screens: r.length, wrongLang: r.filter((x) => x.lang !== l).length, overflow: r.filter((x) => x.overflow > 1).length, clipped: r.filter((x) => x.clipped.length).length, spanishLines: l === "es" ? 0 : r.reduce((a, x) => a + x.spanishCount, 0), lines: r.reduce((a, x) => a + x.lines, 0), keysVisible: r.reduce((a, x) => a + x.keys.length, 0), consoleErrors: r.reduce((a, x) => a + x.errors.length, 0) };
  });
  writeFileSync(join(process.cwd(), "logs/i18n/qa-report.json"), JSON.stringify({ base: BASE, checks, summary, rows }, null, 1), "utf8");
  console.table(summary);
  console.log(`flujos: ${checks.filter((c) => c.ok).length}/${checks.length}`);
})().catch((e) => { console.error(e); process.exit(1); });
