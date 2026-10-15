/**
 * LOGOS DE EQUIPO EN COLECCIONES (instrumento; 2026-10-15). Sin sesión ni BD: usa el arnés
 * `/design-system/colecciones-equipos` (pantallas REALES con el modelo real), servido en local con NEXUS_QA_HARNESS=1.
 *
 *   BASE_URL=http://127.0.0.1:3019 npx tsx scripts/_team-logos-qa.ts [idiomas]
 *
 * Por idioma y ancho (390/768/1440): la sala con TODOS los equipos desplegados — cada escudo de equipo es un <img> del
 * logo del producto (`/hints/teams/<clave>.png`), cargado (naturalWidth > 0), 200×200, `object-fit: contain` y caja
 * cuadrada (proporción intacta), sin monograma; y el detalle de cada uno de los 16 que faltaban. Además: idioma del
 * documento, sin respuestas ≥ 400, sin errores de consola, sin desborde horizontal. Capturas en logs/team-logos-qa/.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep, type Tab } from "./lib/cdp";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3019";
if (/valorosters\.com|:3005\b/.test(BASE)) throw new Error("solo contra un servidor local de QA");
const LOCS = (process.argv[2] ?? "es,en,de,it,fr,pt-PT,pt-BR,ja").split(",");
const WIDTHS = [390, 768, 1440];
const OUT = join(process.cwd(), "logs", "team-logos-qa");
const ADDED = ["all-gamers", "detonation-focusme", "drx", "edward-gaming", "full-sense", "ge", "gen-g", "ns", "paper-rex", "rrq", "t1", "team-secret", "tyl", "vl", "xlg", "zeta-division"];
const noise = (e: string) => !/favicon|ERR_ABORTED|React DevTools|GPU stall|WebGL|GL Driver|swiftshader/i.test(e);
/** Sin BD en local, el catálogo de contenido del armazón (`/api/content/*`) responde 503: entorno, no logos. Se anota aparte. */
const envOnly = (r: string) => /^503 \/api\/content\//.test(r);

const rows: { scope: string; id: string; ok: boolean; detail: string }[] = [];
const check = (scope: string, id: string, ok: boolean, detail: unknown = "") => {
  const d = typeof detail === "string" ? detail : JSON.stringify(detail);
  rows.push({ scope, id, ok, detail: d.slice(0, 600) });
  console.log(`${ok ? "PASS" : "FAIL"} · ${scope} · ${id}${ok ? "" : ` — ${d.slice(0, 300)}`}`);
};

const waitFor = async (tab: Tab, expr: string, ms: number) => {
  for (const t0 = Date.now(); Date.now() - t0 < ms; await sleep(200)) if (await tab.js<boolean>(expr).catch(() => false)) return true;
  return false;
};

/** Escudos de equipo pintados: logo (img) o monograma, con lo que hace falta para juzgarlos. */
const SHIELDS = `(() => [...document.querySelectorAll('[data-testid="trophy-badge"]')].filter((f) => !f.closest('[data-testid="region-badges"]')).map((f) => {
  const img = f.querySelector('img');
  const r = img?.getBoundingClientRect();
  return { id: f.getAttribute('data-badge'), src: img ? new URL(img.src).pathname : null, complete: !!img?.complete, nw: img?.naturalWidth ?? 0, nh: img?.naturalHeight ?? 0,
    fit: img ? getComputedStyle(img).objectFit : null, w: r ? Math.round(r.width * 10) / 10 : 0, h: r ? Math.round(r.height * 10) / 10 : 0, alt: img?.alt ?? null };
}))()`;
const NAV: Record<string, string[]> = { es: ["es-ES", "es"], en: ["en-GB", "en"], de: ["de-DE", "de"], it: ["it-IT", "it"], fr: ["fr-FR", "fr"], "pt-PT": ["pt-PT", "pt"], "pt-BR": ["pt-BR", "pt"], ja: ["ja-JP", "ja"] };
/** El splash del armazón (`pwa/SplashScreen`) tapa la primera pintura: se espera a que se vaya antes de fotografiar. */
const NO_SPLASH = `!document.querySelector('div.fixed.inset-0[class~="z-[100]"]')`;
const PAGE = `(() => ({ lang: document.documentElement.lang, overflow: document.documentElement.scrollWidth - window.innerWidth }))()`;
type Shield = { id: string; src: string | null; complete: boolean; nw: number; nh: number; fit: string | null; w: number; h: number; alt: string | null };

function judge(s: Shield) {
  const want = `/hints/teams/${s.id}.png`;
  // 200×200 en los 16 añadidos (la convención); los 25 de antes, cargados (DRG es 900×1022 desde F72.3).
  const size = ADDED.includes(s.id) ? s.nw === 200 && s.nh === 200 : s.nw > 0 && s.nh > 0;
  return s.src === want && s.complete && size && s.fit === "contain" && s.w > 0 && Math.abs(s.w - s.h) < 0.6 && !!s.alt;
}

async function run(locale: string, width: number) {
  const S = `${locale} · ${width}`;
  const b = await launch({ args: ["--mute-audio", "--hide-scrollbars"] });
  const tab = b.tab;
  const bad: string[] = [];
  await tab.send("Network.enable");
  tab.on("Network.responseReceived", (p: any) => { if (p?.response?.status >= 400) bad.push(`${p.response.status} ${new URL(p.response.url).pathname}`); });
  // Igual que `_team-collections-ui.ts`: el idioma del navegador (sin cuenta, el cliente decide con `navigator.languages`).
  await tab.send("Page.addScriptToEvaluateOnNewDocument", { source: `Object.defineProperty(navigator, 'languages', { get: () => ${JSON.stringify(NAV[locale])} }); Object.defineProperty(navigator, 'language', { get: () => ${JSON.stringify(NAV[locale][0])} });` });
  await tab.send("Network.setCookie", { name: "vr_locale", value: locale, url: BASE });
  await tab.resize(width, width < 600 ? 844 : 900, 1);
  const dir = join(OUT, `${locale}-${width}`); mkdirSync(dir, { recursive: true });
  try {
    await tab.goto(`${BASE}/design-system/colecciones-equipos?scene=room-all`, 1200);
    check(S, "sala carga", await waitFor(tab, `!!document.querySelector('[data-testid="set-grid"]')`, 40000));
    await waitFor(tab, `document.documentElement.lang === ${JSON.stringify(locale)}`, 10000);
    await waitFor(tab, NO_SPLASH, 10000);
    for (let i = 0; i < 12 && await tab.js<boolean>(`!!document.querySelector('[data-testid="more-teams"]')`); i++) {
      await tab.js(`document.querySelector('[data-testid="more-teams"]').click()`); await sleep(250);
    }
    await tab.js(`window.scrollTo(0, document.body.scrollHeight)`); await sleep(400);
    await waitFor(tab, `[...document.querySelectorAll('[data-testid="set-grid"] img')].every((i) => i.complete)`, 15000);
    const shields = await tab.js<Shield[]>(SHIELDS);
    const page = await tab.js<{ lang: string; overflow: number }>(PAGE);
    const total = await tab.js<number>(`Number(document.querySelector('[data-testid="set-grid"]').getAttribute('data-total'))`);
    check(S, "sala · los 41 equipos desplegados", shields.length === 41 && total === 41, { shields: shields.length, total });
    const wrong = shields.filter((s) => !judge(s));
    check(S, "sala · todos con su logo cargado (añadidos 200×200), contain, caja cuadrada, alt", wrong.length === 0, wrong.slice(0, 4));
    check(S, "sala · los 16 añadidos presentes con logo", ADDED.every((id) => shields.some((s) => s.id === id && judge(s))), ADDED.filter((id) => !shields.some((s) => s.id === id && judge(s))));
    check(S, "sala · idioma y sin desborde horizontal", page.lang === locale && page.overflow <= 1, page);
    // La etiqueta de estado de cada tarjeta, en el idioma (antes «✓ Completada» salía en español en todos).
    const done = locale === "es" ? "Completada" : JSON.parse(readFileSync(join(process.cwd(), "src/i18n/messages", locale, "trophies.json"), "utf8"))["Completada"];
    const chips = await tab.js<string[]>(`[...document.querySelectorAll('[data-testid="set-tile"][data-state="COMPLETED"] span.rounded-full')].map((s) => s.textContent.trim())`);
    check(S, "sala · etiqueta «✓ Completada» traducida en las 41", chips.length === 41 && chips.every((c) => c === `✓ ${done}`), { want: `✓ ${done}`, got: [...new Set(chips)].slice(0, 3), n: chips.length });
    await waitFor(tab, NO_SPLASH, 10000);
    await tab.js(`window.scrollTo(0, 0)`); await sleep(300);
    await tab.shot(join(dir, "sala-arriba.png"));
    await tab.js(`document.querySelector('[data-testid="set-grid"]').scrollIntoView()`); await sleep(300);
    await tab.shot(join(dir, "sala-equipos.png"));

    for (const id of ADDED) {
      if (width === 768 && !["paper-rex", "team-secret", "drx"].includes(id)) continue; // 768: muestra; 390 y 1440: los 16
      await tab.goto(`${BASE}/design-system/colecciones-equipos?scene=detail-empty&team=${id}`, 600);
      const ok = await waitFor(tab, `!!document.querySelector('[data-testid="set-detail"][data-set="${id}"] [data-testid="trophy-badge"] img')`, 20000);
      await waitFor(tab, `document.querySelector('[data-testid="set-detail"] img')?.complete === true`, 10000);
      await waitFor(tab, `document.documentElement.lang === ${JSON.stringify(locale)}`, 10000);
      await waitFor(tab, NO_SPLASH, 10000);
      const [s] = await tab.js<Shield[]>(SHIELDS);
      const p = await tab.js<{ lang: string; overflow: number }>(PAGE);
      check(S, `detalle ${id} · logo correcto y cargado`, ok && !!s && s.id === id && judge(s) && p.lang === locale && p.overflow <= 1, { s, p });
      if (width !== 768) await tab.shot(join(dir, `detalle-${id}.png`));
    }
    const env = bad.filter(envOnly), real = bad.filter((r) => !envOnly(r));
    // Cada 503 de entorno deja su línea «Failed to load resource … 503» en la consola: se descuentan esas, ni una más.
    let budget = env.length;
    const errors = tab.takeErrors().filter(noise).filter((e) => !(/status of 503/.test(e) && budget-- > 0));
    check(S, "sin errores de consola (descontados los 503 de entorno)", errors.length === 0, errors.slice(0, 3));
    check(S, "sin respuestas ≥ 400 (ningún 404; ningún logo ni estático fallido)", real.length === 0, real.slice(0, 5));
    check(S, "entorno · 503 de /api/content sin BD local (informativo)", true, `${env.length}`);
  } finally { await b.close(); }
}

(async () => {
  mkdirSync(OUT, { recursive: true });
  for (const l of LOCS) for (const w of WIDTHS) await run(l, w).catch((e) => check(`${l} · ${w}`, "ejecución", false, String(e)));
  const fail = rows.filter((r) => !r.ok);
  writeFileSync(join(OUT, "report.json"), JSON.stringify({ base: BASE, at: new Date().toISOString(), pass: rows.length - fail.length, fail: fail.length, rows }, null, 2));
  console.log(`\n${rows.length - fail.length} PASS · ${fail.length} FAIL`);
  process.exit(fail.length ? 1 : 0);
})();
