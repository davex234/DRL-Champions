/**
 * COLECCIONES ILIMITADAS · PANTALLAS CON UNA COLECCIÓN GRANDE (instrumento; SOLO stack de QA aislado, cuenta sintética).
 *
 *   BASE_URL=http://127.0.0.1:3027 COLL_PW=… QA_ANON_KEY=… npx tsx scripts/_collection-scale-ui.ts [tamaño=50000] [idiomas=es,ja]
 *
 * Entra con la cuenta `coll-<tamaño>@example.invalid` por el formulario real y recorre, a 390 y 1440 px, las pantallas que
 * antes contaban o pintaban la colección entera: álbum, ficha de carta (copias por páginas), inventario, constructor
 * de equipos, cuenta y portada. Comprueba recuentos contra el servidor, carga progresiva, desbordes, claves visibles,
 * errores de consola, lo que se guarda en el navegador y la memoria de la página. No compra ni desguaza nada.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep } from "./lib/cdp";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3027";
if (/valorosters\.com|:3005\b/.test(BASE)) throw new Error("solo contra el stack de QA aislado");
const ANON = process.env.QA_ANON_KEY ?? "", PW = process.env.COLL_PW ?? "";
if (!ANON || !PW) throw new Error("faltan QA_ANON_KEY / COLL_PW");
const SIZE = process.argv[2] ?? "50000";
const LOCS = (process.argv[3] ?? "es,ja").split(",");
const EMAIL = `coll-${SIZE}@example.invalid`;
const OUT = join(process.cwd(), process.env.UI_OUT ?? "logs/collection-scale-ui");
const NAV: Record<string, string[]> = { es: ["es-ES", "es"], en: ["en-GB", "en"], de: ["de-DE", "de"], it: ["it-IT", "it"], fr: ["fr-FR", "fr"], "pt-PT": ["pt-PT", "pt"], "pt-BR": ["pt-BR", "pt"], ja: ["ja-JP", "ja"] };
const rows: { locale: string; width: number; id: string; ok: boolean; detail: string }[] = [];
const args = ["--mute-audio", "--hide-scrollbars", "--enable-precise-memory-info", ...(process.env.QA_CHROME_ARGS ? process.env.QA_CHROME_ARGS.split(" ") : [])];
type Tab = Awaited<ReturnType<typeof launch>>["tab"];
const SETTLED = `document.readyState === 'complete' && !!document.querySelector('main, [data-testid]') && !document.querySelector('[class*="z-[100]"][class*="bg-base-900"]')`;
async function waitFor(tab: Tab, expr: string, ms = 25000): Promise<boolean> { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await tab.js<boolean>(expr).catch(() => false)) return true; await sleep(250); } return false; }
const noise = (e: string) => !/favicon|ERR_ABORTED|flagcdn|React DevTools|GPU stall|WebGL|GL Driver|swiftshader/i.test(e);
const PROBE = `(() => {
  const text = document.body.innerText;
  const lines = [...new Set(text.split('\\n').map((l) => l.trim()).filter((l) => l.length > 2))];
  return { lang: document.documentElement.lang, overflow: document.documentElement.scrollWidth - innerWidth,
    keys: lines.filter((l) => /^[a-z]+(\\.[a-zA-Z0-9_]+){1,}$/.test(l) || /\\{[a-zA-Z_]+\\}/.test(l) || /\\{n, plural/.test(l)).slice(0, 6),
    digits: text.replace(/[\\s.,\\u00a0\\u202f]/g, ''), nodes: document.querySelectorAll('*').length,
    heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null };
})()`;

async function server(): Promise<{ total: number; distinct: number; top: [string, number]; credits: number }> {
  const j = await (await fetch(`${BASE}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "content-type": "application/json" }, body: JSON.stringify({ email: EMAIL, password: PW }) })).json() as { access_token: string };
  const s = await (await fetch(`${BASE}/api/game/state`, { headers: { authorization: `Bearer ${j.access_token}` } })).json() as { ownedTotal: number; ownedCounts: Record<string, number>; credits: number };
  const top = Object.entries(s.ownedCounts).sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
  return { total: s.ownedTotal, distinct: Object.keys(s.ownedCounts).length, top, credits: s.credits };
}

async function run(locale: string, width: number, truth: Awaited<ReturnType<typeof server>>) {
  const check = (id: string, ok: boolean, detail: unknown = "") => { const d = typeof detail === "string" ? detail : JSON.stringify(detail); rows.push({ locale, width, id, ok, detail: d.slice(0, 300) }); console.log(`${ok ? "PASS" : "FAIL"} · ${locale} · ${width} · ${id} — ${d.slice(0, 220)}`); };
  const b = await launch({ args });
  const tab = b.tab;
  const dir = join(OUT, `${locale}-${width}`); mkdirSync(dir, { recursive: true });
  try {
    await tab.send("Page.addScriptToEvaluateOnNewDocument", { source: `Object.defineProperty(navigator, 'languages', { get: () => ${JSON.stringify(NAV[locale])} }); Object.defineProperty(navigator, 'language', { get: () => ${JSON.stringify(NAV[locale][0])} });` });
    await tab.resize(width, width < 600 ? 844 : 900, 1);
    const visit = async (path: string, name: string, extra = 1800) => {
      const t0 = Date.now();
      await tab.goto(`${BASE}${path}`, 1200); await waitFor(tab, SETTLED, 40000); await sleep(extra);
      const p = await tab.js<{ lang: string; overflow: number; keys: string[]; digits: string; nodes: number; heapMB: number | null }>(PROBE);
      const errors = tab.takeErrors().filter(noise);
      await tab.shot(join(dir, `${name}.png`)).catch(() => null);
      check(`${name} · idioma, sin desborde, sin claves, sin errores`, p.lang === locale && p.overflow <= 1 && p.keys.length === 0 && errors.length === 0, { lang: p.lang, overflow: p.overflow, keys: p.keys, errors: errors.slice(0, 2), nodos: p.nodes, heapMB: p.heapMB, ms: Date.now() - t0 });
      return p;
    };

    // Entrar por el formulario real.
    await tab.goto(`${BASE}/cuenta`, 1200); await waitFor(tab, `!!document.querySelector('input[type="password"]')`, 30000);
    await tab.js(`(() => { const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
      set(document.querySelector('input[type="email"]'), ${JSON.stringify(EMAIL)}); set(document.querySelector('input[type="password"]'), ${JSON.stringify(PW)}); document.querySelector('form button[type="submit"]').click(); })()`);
    check("inicio de sesión", await waitFor(tab, `!document.querySelector('input[type="password"]')`, 30000));
    await sleep(2500); tab.takeErrors();

    // Lo que queda guardado en el navegador NO crece con la colección.
    const stored = await tab.js<{ bytes: number; cards: number; total: number | null }>(`(() => { const raw = localStorage.getItem('drl-champions') || ''; let s = {}; try { s = JSON.parse(raw).state || {}; } catch {} return { bytes: raw.length, cards: (s.ownedCards || []).length, total: s.ownedTotal ?? null }; })()`);
    check("almacenamiento local: un ejemplar por carta y recuentos (no la colección)", stored.cards <= truth.distinct + 20 && stored.total === truth.total && stored.bytes < 300_000, { ...stored, colección: truth.total });

    // Cuenta (la pestaña «Perfil» no enseña recuentos: solo se comprueba que carga limpia con la colección grande).
    await visit("/cuenta", "cuenta");

    // Álbum.
    const album = await visit("/coleccion", "coleccion", 2500);
    check("álbum · cartas distintas y copias totales exactas", album.digits.includes(String(truth.total)) || album.digits.includes(String(truth.total - truth.distinct)), { total: truth.total, distintas: truth.distinct, duplicadas: truth.total - truth.distinct });
    const tiles = await tab.js<number>(`document.querySelectorAll('[data-testid="album-grid"] a, [data-testid="album-grid"] button, [data-card-id]').length`);
    check("álbum · la rejilla no pinta una carta por copia", album.nodes < 9000, { nodos: album.nodes, teselas: tiles });

    // Ficha de la carta más repetida: copias por páginas.
    const [cardId, copies] = truth.top;
    const detail = await visit(`/coleccion/carta/${encodeURIComponent(cardId)}`, "carta", 2500);
    check("ficha · «tus copias» = las del servidor", detail.digits.includes(String(copies)), { copias: copies });
    const count = () => tab.js<number>(`document.querySelectorAll('[data-testid="card-copies"] li[data-serial]').length`);
    const first = await count();
    check("ficha · primera página de copias (48), no todas", first > 0 && first <= 48, { pintadas: first, copias: copies });
    const moreState = () => tab.js<string>(`document.querySelector('[data-testid="card-copies-more"]')?.getAttribute('data-state') ?? 'ausente'`);
    if (copies > 48) {
      check("ficha · pie de carga presente", (await moreState()) !== "ausente", await moreState());
      // Scroll infinito: llegar al final carga la siguiente página.
      await tab.js(`document.querySelector('[data-testid="card-copies-more"]').scrollIntoView({ block: 'center' })`);
      const grew = await waitFor(tab, `document.querySelectorAll('[data-testid="card-copies"] li[data-serial]').length > ${first}`, 15000);
      const second = await count();
      check("ficha · al llegar al final se carga la página siguiente (scroll infinito)", grew && second > first && second <= first + 96, { antes: first, después: second });
      // Varias páginas seguidas: sin duplicados y sin congelar la página.
      for (let i = 0; i < 6; i++) { await tab.js(`(() => { const b = document.querySelector('[data-testid="card-copies-more-button"]'); if (b) b.click(); else document.querySelector('[data-testid="card-copies-more"]')?.scrollIntoView({ block: 'center' }); })()`); await sleep(900); }
      const many = await count();
      const keys = await tab.js<{ n: number; uniq: number }>(`(() => { const t = [...document.querySelectorAll('[data-testid="card-copies"] li[data-serial]')].map((li) => li.innerText.split('\\n')[0] + '|' + li.getAttribute('data-serial')); const numbered = t.filter((x) => !x.endsWith('|')); return { n: numbered.length, uniq: new Set(numbered).size }; })()`);
      check("ficha · tras varias páginas: más copias, ninguna numerada repetida", many > second && keys.n === keys.uniq, { pintadas: many, numeradas: keys.n, distintas: keys.uniq });
      const errs = tab.takeErrors().filter(noise);
      check("ficha · sin errores de consola al paginar", errs.length === 0, errs.slice(0, 2));
      await tab.shot(join(dir, "carta-paginada.png")).catch(() => null);
    }

    // Inventario: repetidas por carta y botón de desguace con el total del servidor.
    const inv = await visit("/inventario", "inventario", 3500);
    const dups = truth.total - truth.distinct;
    check("inventario · número de duplicados exacto", inv.digits.includes(String(dups)), { duplicados: dups });
    const lines = await tab.js<number>(`document.querySelectorAll('[data-testid="inventory-duplicate-line"]').length`);
    check("inventario · una ficha por carta repetida (máx. 40 a la vez), no una por copia", lines > 0 && lines <= 40, { fichas: lines });
    const btn = await tab.js<string>(`document.querySelector('[data-testid="salvage-confirm"]')?.innerText ?? ''`);
    check("inventario · el botón de desguace anuncia TODAS las repetidas", btn.replace(/[\s.,  ]/g, "").includes(String(dups)), btn);

    // Constructor de equipos: un ejemplar por carta.
    const deck = await visit("/duelos/mazos", "equipos", 3000);
    check("equipos · la página no crece con la colección", deck.nodes < 9000, { nodos: deck.nodes, heapMB: deck.heapMB });

    const home = await visit("/", "portada", 2000);
    check("memoria de la página tras el recorrido", (home.heapMB ?? 0) < 250, { heapMB: home.heapMB });
  } catch (e) {
    check("EJECUCIÓN", false, String(e));
  } finally { await b.close(); }
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const truth = await server();
  console.log(`cuenta ${EMAIL}: ${truth.total} cartas · ${truth.distinct} distintas · la más repetida ${truth.top[0]} ×${truth.top[1]}`);
  for (const l of LOCS) for (const w of [390, 1440]) await run(l, w, truth);
  writeFileSync(join(OUT, `ui-${SIZE}.json`), JSON.stringify({ base: BASE, at: new Date().toISOString(), truth, rows }, null, 1));
  const bad = rows.filter((r) => !r.ok).length;
  console.log(`RESULTADO · ${BASE} · ${rows.length - bad} PASS · ${bad} FAIL`);
  process.exit(bad ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
