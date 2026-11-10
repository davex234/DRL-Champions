/**
 * I18N + ICON · COMPROBACIÓN DE INVITADO AMPLIADA TRAS DESPLEGAR (instrumento, fuera de CI y de la release).
 *
 *   BASE_URL=https://valorosters.com npx tsx scripts/_i18n-prod-guest-extra.ts [es,en,…]
 *
 * SOLO LECTURA y SIN SESIÓN, como `_i18n-prod-guest-smoke.ts`: no inicia sesión, no compra, no abre. Lo único que
 * escribe es la preferencia de idioma en el navegador desechable de la prueba. Añade a aquel humo, por idioma:
 *   A · detección automática (idioma del navegador, sin preferencia guardada)
 *   B · selector de idioma de /cuenta y persistencia al navegar y recargar
 *   C · portada, tienda, fichas de los dos sobres ICON, colección y crafteo a 390 y 1440 px: idioma, desbordes,
 *       claves visibles, errores de consola y, en las fichas, precio y reparto.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep } from "./lib/cdp";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3027";
const OUT = join(process.cwd(), process.env.SMOKE_OUT ?? "logs/i18n/prod-extra");
const LOCS = (process.argv[2] ?? "es,en,de,it,fr,pt-PT,pt-BR,ja").split(",");
/** Etiqueta regional que mandaría un navegador real: comprueba la reducción a los ocho idiomas. */
const BROWSER: Record<string, string[]> = { es: ["es-MX", "es"], en: ["en-GB", "en"], de: ["de-AT", "de"], it: ["it-CH", "it"], fr: ["fr-CA", "fr"], "pt-PT": ["pt-AO", "pt"], "pt-BR": ["pt-BR", "pt"], ja: ["ja-JP", "ja"] };
const PAGES = ["/", "/tienda", "/packs/icon-single", "/packs/icon", "/coleccion", "/misiones/crafting/sobres"];
const rows: { locale: string; id: string; ok: boolean; detail: string }[] = [];
const check = (locale: string, id: string, ok: boolean, detail: unknown = "") => { const d = typeof detail === "string" ? detail : JSON.stringify(detail); rows.push({ locale, id, ok, detail: d.slice(0, 400) }); console.log(`${ok ? "PASS" : "FAIL"} · ${locale} · ${id} — ${d.slice(0, 260)}`); };
const args = ["--mute-audio", "--hide-scrollbars", ...(process.env.QA_CHROME_ARGS ? process.env.QA_CHROME_ARGS.split(" ") : [])];
const navLang = (langs: string[]) => `Object.defineProperty(navigator, 'languages', { get: () => ${JSON.stringify(langs)} }); Object.defineProperty(navigator, 'language', { get: () => ${JSON.stringify(langs[0])} });`;
const SETTLED = `document.readyState === 'complete' && !!document.querySelector('main, [data-testid]') && !document.querySelector('[class*="z-[100]"][class*="bg-base-900"]')`;
const PROBE = `(() => {
  const text = document.body.innerText;
  const lines = [...new Set(text.split('\\n').map((l) => l.trim()).filter((l) => l.length > 2))];
  return { lang: document.documentElement.lang, overflow: document.documentElement.scrollWidth - innerWidth,
    keys: lines.filter((l) => /^[a-z]+(\\.[a-zA-Z0-9_]+){1,}$/.test(l) || /\\{[a-zA-Z_]+\\}/.test(l) || /\\{n, plural/.test(l)).slice(0, 6),
    digits: text.replace(/[\\s.,\\u00a0\\u202f]/g, ''), pct: (text.match(/\\d+(?:[.,]\\d+)?\\s?[%％]/g) ?? []).slice(0, 12) };
})()`;
type Tab = Awaited<ReturnType<typeof launch>>["tab"];
async function settle(tab: Tab, ms = 2200) { for (let i = 0; i < 80; i++) { if (await tab.js<boolean>(SETTLED).catch(() => false)) break; await sleep(250); } await sleep(ms); }
const noise = (e: string) => !/favicon|ERR_ABORTED|flagcdn|React DevTools|GPU stall|WebGL|GL Driver|swiftshader/i.test(e);

async function run(locale: string) {
  // A · detección: navegador nuevo, sin preferencia guardada, con la etiqueta regional
  let b = await launch({ args });
  try {
    await b.tab.send("Page.addScriptToEvaluateOnNewDocument", { source: navLang(BROWSER[locale]) });
    await b.tab.resize(1440, 900, 1);
    await b.tab.goto(`${BASE}/`, 1500); await settle(b.tab);
    const lang = await b.tab.js<string>("document.documentElement.lang");
    check(locale, `detección automática (${BROWSER[locale][0]})`, lang === locale, { lang });
  } finally { await b.close(); }

  // B · selector + persistencia: navegador en otro idioma, se elige en /cuenta
  const other = locale === "es" ? ["en-US", "en"] : ["es-ES", "es"];
  b = await launch({ args });
  try {
    const tab = b.tab;
    await tab.send("Page.addScriptToEvaluateOnNewDocument", { source: navLang(other) });
    await tab.resize(1440, 900, 1);
    await tab.goto(`${BASE}/cuenta`, 1500); await settle(tab);
    const n = await tab.js<number>(`document.querySelectorAll('[data-testid^="language-"]:not([data-testid="language-settings"])').length`);
    check(locale, "selector con los ocho idiomas", n === 8, { botones: n });
    await tab.js(`document.querySelector('[data-testid="language-${locale}"]').click()`);
    let lang = ""; for (let i = 0; i < 40; i++) { lang = await tab.js<string>("document.documentElement.lang"); if (lang === locale) break; await sleep(250); }
    check(locale, "selector cambia el idioma", lang === locale, { lang });
    await tab.goto(`${BASE}/tienda`, 1500); await settle(tab);
    check(locale, "persistencia al navegar", (await tab.js<string>("document.documentElement.lang")) === locale, "");
    await tab.send("Page.reload"); await sleep(1500); await settle(tab);
    check(locale, "persistencia al recargar", (await tab.js<string>("document.documentElement.lang")) === locale, "");
    tab.takeErrors();

    // C · pantallas a móvil y escritorio (misma preferencia ya guardada)
    mkdirSync(join(OUT, locale), { recursive: true });
    for (const [w, h] of [[390, 844], [1440, 900]] as const) {
      await tab.resize(w, h, 1);
      for (const r of PAGES) {
        await tab.goto(`${BASE}${r}`, 1500); await settle(tab);
        const p = await tab.js<{ lang: string; overflow: number; keys: string[]; digits: string; pct: string[] }>(PROBE);
        const errors = tab.takeErrors().filter(noise);
        await tab.shot(join(OUT, locale, `${w}-${r === "/" ? "home" : r.slice(1).replace(/\//g, "_")}.png`)).catch(() => null);
        check(locale, `${w} ${r} · idioma, sin desborde, sin claves, sin errores`, p.lang === locale && p.overflow <= 1 && p.keys.length === 0 && errors.length === 0, { lang: p.lang, overflow: p.overflow, keys: p.keys, errors: errors.slice(0, 2) });
        if (r === "/packs/icon-single") check(locale, `${w} ficha ICON · precio 30.000`, p.digits.includes("30000"), { pct: p.pct });
        if (r === "/packs/icon") check(locale, `${w} ficha ICON Premium · precio 80.000`, p.digits.includes("80000"), { pct: p.pct });
      }
    }
  } finally { await b.close(); }
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  for (const l of LOCS) { try { await run(l); } catch (e) { check(l, "EJECUCIÓN", false, String(e)); } }
  writeFileSync(join(OUT, "guest-extra.json"), JSON.stringify({ base: BASE, at: new Date().toISOString(), rows }, null, 1));
  const bad = rows.filter((r) => !r.ok).length;
  console.log(`RESULTADO · ${BASE} · ${rows.length - bad} PASS · ${bad} FAIL`);
  process.exit(bad ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
