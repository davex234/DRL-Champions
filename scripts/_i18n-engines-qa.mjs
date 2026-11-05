// QA DE MOTORES · I18N (instrumento, fuera de CI y de la release). Recorre las pantallas en un idioma con Firefox (Gecko),
// WebKit (el motor de Safari) y Chromium de referencia, y aplica la MISMA sonda de recortes que la QA visual.
// Para qué: `word-break: auto-phrase` (japonés) solo existe en Chromium; aquí se mide si en los otros motores hay textos
// cortados o desbordes. Se ejecuta en el stack de QA aislado con la imagen de Playwright (ver engines-run.sh).
//   ENGINES=firefox,webkit,chromium I18N_LOCALES=ja I18N_WIDTHS=390,768,1440 node _i18n-engines-qa.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
const pw = createRequire(process.env.PW_REQUIRE_FROM ?? import.meta.url)("playwright");

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3027";
if (/valorosters\.com|:3005\b/.test(BASE)) throw new Error("solo contra el stack de QA aislado, nunca producción");
const QA = Object.fromEntries(readFileSync(process.env.QA_ENV, "utf8").split(/\r?\n/).filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
if (!/@example\.invalid$/.test(QA.QA_ADMIN_EMAIL ?? "")) throw new Error("cuenta QA no sintética");
const ENGINES = (process.env.ENGINES ?? "firefox,webkit,chromium").split(",");
const LOCS = (process.env.I18N_LOCALES ?? "ja").split(",");
const WIDTHS = (process.env.I18N_WIDTHS ?? "390,768,1440").split(",").map(Number);
const OUT = process.env.OUT_DIR ?? "out-engines";
const GUEST = ["/", "/tienda", "/cuenta"];
const ROUTES = ["/", "/jugar", "/duelos", "/duelos/mazos", "/tienda", "/tienda/creditos", "/packs", "/coleccion", "/inventario", "/colecciones", "/temporada", "/temporada/pase", "/misiones", "/misiones/crafting", "/misiones/crafting/sobres", "/misiones/crafting/cartas", "/logros", "/ranking", "/competitivo", "/copas", "/torneos", "/pickems", "/social", "/entrenador", "/como-jugar", "/cuenta", "/cuenta?seccion=progresion", "/cuenta?seccion=cuenta",
  "/admin", "/admin/admins", "/admin/alpha", "/admin/audit", "/admin/cartas", "/admin/copas", "/admin/crafting", "/admin/economy", "/admin/packs", "/admin/pools", "/admin/system", "/admin/users", "/admin/walkout"];
const SHOTS = new Set(["/", "/tienda", "/packs", "/misiones/crafting/sobres", "/cuenta?seccion=cuenta", "/admin/pools", "/admin/walkout"]);
const slug = (r) => (r === "/" ? "home" : r.replace(/^\//, "").replace(/[/?=&]/g, "_"));

/** La sonda de la QA visual (scripts/_i18n-auth-lib.ts · PROBE), parte de recortes y desbordes. */
function probe() {
  const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && r.bottom > 0 && r.top < innerHeight * 6; };
  const clipped = [];
  for (const e of document.querySelectorAll("button, a, span, b, p, h1, h2, h3, h4, label, th, td, li, div")) {
    if (!e.childNodes.length || [...e.childNodes].some((c) => c.nodeType !== 3) || !e.textContent.trim() || !vis(e)) continue;
    const s = getComputedStyle(e);
    if (e.scrollWidth > e.clientWidth + 2 && s.overflowX !== "visible" && s.textOverflow !== "ellipsis" && !e.closest('[class*="overflow-x-auto"],[class*="overflow-auto"],[class*="sr-only"],[class*="truncate"],[class*="line-clamp"]')) clipped.push("CORTADO: " + e.textContent.trim().slice(0, 60));
    // recorte vertical: una etiqueta que parte en más líneas de las que caben en su caja con overflow oculto
    if (e.scrollHeight > e.clientHeight + 3 && s.overflowY !== "visible" && s.overflowY !== "auto" && s.overflowY !== "scroll" && !e.closest('[class*="line-clamp"],[class*="sr-only"],[class*="overflow-y-auto"],[class*="overflow-auto"]')) clipped.push("ALTO: " + e.textContent.trim().slice(0, 60));
    const r = e.getBoundingClientRect();
    if (r.right > innerWidth + 2 && r.left < innerWidth && !e.closest('[class*="overflow-x-auto"],[class*="overflow-auto"],[class*="overflow-hidden"],[class*="sr-only"]')) clipped.push("FUERA: " + e.textContent.trim().slice(0, 60));
  }
  for (const b of document.querySelectorAll('button, a[class*="nx-"], [role="button"]')) {
    if (!vis(b)) continue; const r = b.getBoundingClientRect();
    for (const k of b.querySelectorAll("span, b")) { if (!k.textContent.trim() || !vis(k)) continue; const kr = k.getBoundingClientRect(); if (kr.right > r.right + 3 || kr.left < r.left - 3) { clipped.push("BOTON: " + b.textContent.trim().slice(0, 60)); break; } }
  }
  // informativo (no es fallo): textos cuya última línea es UN solo carácter — mide la calidad de la partición de línea por motor
  let orphans = 0;
  for (const e of document.querySelectorAll("button, a, span, b, p, h1, h2, h3, h4, label, li, div")) {
    if (e.childNodes.length !== 1 || e.firstChild.nodeType !== 3 || !vis(e)) continue; const n = e.firstChild; const len = n.data.replace(/\s+$/, "").length; if (len < 4) continue;
    const box = (i) => { const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 1); return r.getBoundingClientRect(); };
    const last = box(len - 1), prev = box(len - 2); if (last.height > 0 && prev.height > 0 && last.top >= prev.bottom - 1) orphans++;
  }
  return { orphans, lang: document.documentElement.lang, overflow: document.documentElement.scrollWidth - innerWidth, clipped: [...new Set(clipped)].slice(0, 15), autoPhrase: CSS.supports("word-break", "auto-phrase"), wordBreak: getComputedStyle(document.body).wordBreak };
}
const SETTLED = () => !document.querySelector('[class*="z-[100]"][class*="bg-base-900"]') && !!document.querySelector("main, [data-testid]") && document.readyState === "complete";

const rows = [];
for (const engine of ENGINES) {
  const browser = await pw[engine].launch();
  for (const locale of LOCS) for (const width of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : width <= 1024 ? 1024 : 900 }, locale: "es-ES", reducedMotion: "reduce" });
    await ctx.addInitScript((l) => { try { if (!localStorage.getItem("vr.locale")) localStorage.setItem("vr.locale", JSON.stringify({ locale: l, at: 1 })); } catch { /* sin almacenamiento */ } }, locale);
    await ctx.addCookies([{ name: "vr_locale", value: locale, url: BASE }]);
    const page = await ctx.newPage();
    const go = async (r, screen) => {
      try {
        await page.goto(BASE + r, { waitUntil: "load", timeout: 45000 });
        await page.waitForFunction(SETTLED, null, { timeout: 30000 }).catch(() => null);
        await page.waitForTimeout(1300);
        const p = await page.evaluate(probe);
        rows.push({ engine, locale, width, screen, ...p });
        if (SHOTS.has(r) || p.clipped.length || p.overflow > 1) { mkdirSync(`${OUT}/${engine}/${locale}`, { recursive: true }); await page.screenshot({ path: `${OUT}/${engine}/${locale}/${width}-${screen}.png`, fullPage: p.clipped.length > 0 }).catch(() => null); }
        const flag = [p.lang !== locale && `lang=${p.lang}`, p.overflow > 1 && `desborda ${p.overflow}px`, p.clipped.length && `cortados ${p.clipped.length}: ${p.clipped.slice(0, 3).join(" ¦ ")}`].filter(Boolean).join(" · ");
        console.log(`${engine.padEnd(8)} ${locale.padEnd(5)} ${String(width).padStart(4)} ${screen.padEnd(34)} ${flag || "ok"}`);
      } catch (e) { rows.push({ engine, locale, width, screen, lang: "", overflow: 0, clipped: [], error: String(e).slice(0, 200) }); console.log(`${engine} ${locale} ${width} ${screen} ERROR ${String(e).slice(0, 160)}`); }
    };
    for (const r of GUEST) await go(r, `invitado-${slug(r)}`);
    // sesión por el formulario real (cuenta sintética admin: ve juego y administración)
    await page.goto(BASE + "/cuenta", { waitUntil: "load" });
    let logged = false;
    try {
      await page.waitForSelector('input[type="password"]', { timeout: 20000 });
      await page.fill('input[type="email"]', QA.QA_ADMIN_EMAIL); await page.fill('input[type="password"]', QA.QA_ADMIN_PASSWORD);
      await page.click('form button[type="submit"]');
      await page.waitForSelector('input[type="password"]', { state: "detached", timeout: 30000 });
      await page.waitForTimeout(1800);
      // la cuenta guarda su idioma y al entrar manda sobre el del navegador: se elige en el selector real
      await page.goto(BASE + "/cuenta?seccion=cuenta", { waitUntil: "load" });
      await page.waitForSelector(`[data-testid="language-${locale}"]`, { timeout: 20000 });
      await page.click(`[data-testid="language-${locale}"]`);
      await page.waitForFunction((l) => document.documentElement.lang === l, locale, { timeout: 15000 });
      await page.waitForTimeout(800); logged = true;
    } catch (e) { rows.push({ engine, locale, width, screen: "LOGIN", lang: "", overflow: 0, clipped: [], error: String(e).slice(0, 200) }); console.log(`${engine} ${locale} ${width} LOGIN ERROR`); }
    if (logged) for (const r of ROUTES) await go(r, slug(r));
    await ctx.close();
  }
  await browser.close();
}
mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/engines-qa.json`, JSON.stringify(rows, null, 1));
for (const engine of ENGINES) for (const locale of LOCS) {
  const r = rows.filter((x) => x.engine === engine && x.locale === locale);
  console.log(`RESUMEN ${engine} ${locale}: pantallas ${r.length} · idiomaMal ${r.filter((x) => x.lang && x.lang !== locale).length} · desbordes ${r.filter((x) => x.overflow > 1).length} · cortados ${r.filter((x) => x.clipped.length).length} · errores ${r.filter((x) => x.error).length} · últimas líneas de 1 carácter ${r.reduce((a, x) => a + (x.orphans ?? 0), 0)} · auto-phrase ${r.find((x) => x.autoPhrase !== undefined)?.autoPhrase}`);
}
const bad = rows.filter((x) => x.error || x.overflow > 1 || x.clipped.length || (x.lang && x.lang !== x.locale)).length;
console.log(`RESULTADO · ${rows.length - bad} PASS · ${bad} FAIL`);
