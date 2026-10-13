/**
 * I18N + ICON · HUMO DE INVITADO TRAS DESPLEGAR (instrumento, fuera de CI y de la release).
 *
 *   BASE_URL=https://valorosters.com npx tsx scripts/_i18n-prod-guest-smoke.ts [es,en,de,it]
 *
 * SOLO LECTURA y SIN SESIÓN: no inicia sesión, no compra, no abre, no escribe nada. Por idioma visita portada, tienda,
 * sobres y cuenta como invitado y comprueba: idioma del documento, restos de español, claves visibles, errores de
 * consola y, en la tienda, los precios del Sobre ICON (30.000) y del ICON Premium (80.000).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep } from "./lib/cdp";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3027";
const OUT = join(process.cwd(), process.env.SMOKE_OUT ?? "logs/i18n/prod-smoke");
const LOCS = (process.argv[2] ?? "es,en,de,it,fr,pt-PT,pt-BR,ja").split(",");
const ROUTES = ["/", "/tienda", "/packs", "/cuenta"];
const rows: { locale: string; id: string; ok: boolean; detail: string }[] = [];
const check = (locale: string, id: string, ok: boolean, detail: unknown = "") => { const d = typeof detail === "string" ? detail : JSON.stringify(detail); rows.push({ locale, id, ok, detail: d.slice(0, 400) }); console.log(`${ok ? "PASS" : "FAIL"} · ${locale} · ${id} — ${d.slice(0, 260)}`); };

const PROBE = `(() => {
  const text = document.body.innerText;
  const WORDS = {"it":"los|las|el|para|sin|tus|hay|más|todavía|aún|cartas|sobres?|partidas?|equipos?|jugar|abrir|recompensas?|misiones|temporada|tienda|colección|créditos|comprar|cuenta|cerrar|sesión|idioma|ajustes|guardar|cancelar|siguiente|volver|jugador(es)?|nuevo|nueva|todos|todas|aquí|ahora|hoy|días?|semana|con las|de la|garantizad[ao]s?","fr":"el|los|las|del|para|con|sin|tus|una|esta|este|hay|más|todavía|aún|cartas?|sobres|partidas?|equipos?|jugar|abrir|recompensas?|misiones|temporada|tienda|colección|créditos|comprar|cuenta|cerrar|sesión|idioma|ajustes|guardar|cancelar|siguiente|volver|nivel|jugador(es)?|nuevo|nueva|todos|todas|aquí|ahora|hoy|día|días|semana|garantizad[ao]s?","pt":"el|del|con|sin|tus|una|hay|más|todavía|aún|sobres|equipos?|jugar|misiones|tienda|colección|cuenta|cerrar|sesión|siguiente|volver|nivel|jugador(es)?|nuevo|nueva|aquí|ahora|hoy|días|garantizad[ao]s?|recompensas de la|con las|de los","*":"el|la|los|las|del|para|con|sin|tus|una|esta|este|hay|que|más|todavía|aún|cartas?|sobres?|partidas?|equipos?|jugar|abrir|recompensas?|misiones|temporada|tienda|colección|créditos|comprar|cuenta|cerrar|sesión|idioma|ajustes|guardar|cancelar|siguiente|volver|nivel|jugador(es)?|nuevo|nueva|todos|todas|ver|tu|mis?|aquí|ahora|hoy|día|días|semana|garantizad[ao]s?"}; const W = WORDS[document.documentElement.lang.toLowerCase().split('-')[0]] ?? WORDS['*'];
  const ES = new RegExp('(^|[^\\\\p{L}])(' + W + ')([^\\\\p{L}]|$)', 'iu');
  const lines = [...new Set(text.split('\\n').map((l) => l.trim()).filter((l) => l.length > 2 && /\\p{L}{3}/u.test(l)))];
  const prices = Object.fromEntries([...document.querySelectorAll('[data-testid="store-product"]')].map((e) => [e.getAttribute('data-product-id'), (e.querySelector('[data-testid="store-price"]')?.innerText ?? '').replace(/[^\\d]/g, '')]));
  return { lang: document.documentElement.lang, lines: lines.length, spanish: lines.filter((l) => ES.test(l)).slice(0, 12), keys: lines.filter((l) => /^[a-z]+(\\.[a-zA-Z0-9_]+){1,}$/.test(l) || /\\{[a-zA-Z_]+\\}/.test(l) || /\\{n, plural/.test(l)).slice(0, 6), prices };
})()`;

async function run(locale: string) {
  const browser = await launch({ args: ["--mute-audio", "--hide-scrollbars", ...(process.env.QA_CHROME_ARGS ? process.env.QA_CHROME_ARGS.split(" ") : [])] });
  const tab = browser.tab;
  try {
    await tab.resize(1440, 900, 1);
    await tab.send("Page.addScriptToEvaluateOnNewDocument", { source: `try { localStorage.setItem('vr.locale', JSON.stringify({ locale: ${JSON.stringify(locale)}, at: 1 })); } catch {}` });
    mkdirSync(join(OUT, locale), { recursive: true });
    for (const r of ROUTES) {
      await tab.goto(`${BASE}${r}`, 1500);
      for (let i = 0; i < 80; i++) { if (await tab.js<boolean>(`document.readyState === 'complete' && !!document.querySelector('main, [data-testid]') && !document.querySelector('[class*="z-[100]"][class*="bg-base-900"]')`).catch(() => false)) break; await sleep(250); }
      await sleep(2500);
      const p = await tab.js<{ lang: string; lines: number; spanish: string[]; keys: string[]; prices: Record<string, string> }>(PROBE);
      const errors = tab.takeErrors().filter((e) => !/favicon|ERR_ABORTED|flagcdn|React DevTools|GPU stall|WebGL|GL Driver|swiftshader/i.test(e));
      await tab.shot(join(OUT, locale, `${r === "/" ? "home" : r.slice(1)}.png`)).catch(() => null);
      check(locale, `${r} · idioma del documento`, p.lang === locale, { lang: p.lang, lineas: p.lines });
      if (locale !== "es") check(locale, `${r} · sin restos de español`, p.spanish.length === 0, p.spanish);
      check(locale, `${r} · sin claves visibles`, p.keys.length === 0, p.keys);
      check(locale, `${r} · sin errores de consola`, errors.length === 0, errors.slice(0, 3));
      if (r === "/tienda") check(locale, "tienda · ICON 30.000 e ICON Premium 80.000", p.prices["pack:icon-single"] === "30000" && p.prices["pack:icon"] === "80000", { single: p.prices["pack:icon-single"], premium: p.prices["pack:icon"], productos: Object.keys(p.prices).length });
    }
  } finally { await browser.close(); }
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  for (const l of LOCS) { try { await run(l); } catch (e) { check(l, "EJECUCIÓN", false, String(e)); } }
  writeFileSync(join(OUT, "guest-smoke.json"), JSON.stringify({ base: BASE, at: new Date().toISOString(), rows }, null, 1));
  const bad = rows.filter((r) => !r.ok).length;
  console.log(`RESULTADO · ${BASE} · ${rows.length - bad} PASS · ${bad} FAIL`);
  process.exit(bad ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
