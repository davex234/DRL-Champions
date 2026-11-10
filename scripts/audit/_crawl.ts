/**
 * FULL GAME AUDIT · RASTREADOR DE RUTAS (instrumento de operador, fuera de CI y de la release).
 *
 *   BASE_URL=https://valorosters.com QA_SESSION_FILE=<sesión QA> QA_IDS=<json de ids reales> npx tsx scripts/audit/_crawl.ts [anon|qa] [1440,1024,390]
 *
 * Visita TODAS las rutas reales (inventario de `src/app/**\/page.tsx`, con los parámetros resueltos a ids REALES) y anota
 * por ruta y ancho: estado HTTP del documento, URL final, errores de consola (excepciones, console.error, avisos de React),
 * respuestas propias ≥ 400, desbordamiento horizontal, textos imposibles (undefined/NaN/null/[object Object]), pantalla
 * de error, carga infinita (esqueleto/«Cargando» tras 14 s) y bucles de recarga. Escribe un JSON por pasada.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openBrowser, sleep, net, netReset, type Client } from "../_fase68-lib";

const BASE = process.env.BASE_URL!;
const MODE = (process.argv[2] ?? "qa") as "anon" | "qa";
const WIDTHS = (process.argv[3] ?? "1440,1024,390").split(",").map(Number);
const IDS = JSON.parse(readFileSync(process.env.QA_IDS!, "utf8")) as Record<string, string>;
const SESSION = MODE === "qa" ? readFileSync(process.env.QA_SESSION_FILE!, "utf8") : null;
const OUT = join(process.cwd(), "docs/product/qa/full-audit", MODE);
mkdirSync(OUT, { recursive: true });
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null;

const ROUTES = readFileSync(process.env.ROUTES_FILE!, "utf8").split(/\r?\n/).filter(Boolean)
  .filter((r) => !r.startsWith("/design-system"))
  .map((r) => r.replace(/\[([^\]]+)\]/g, (_m, k) => IDS[`${r}:${k}`] ?? IDS[k] ?? `__${k}__`))
  .filter((r) => !r.includes("__") && (!ONLY || ONLY.test(r)));

const BAD_TEXT = /\bundefined\b|\bNaN\b|\[object Object\]|(^|\s)null(\s|$)|Infinity/;
const PROBE = `(() => {
  const main = document.querySelector('main') || document.body; const t = main.innerText || '';
  const lines = t.split('\\n').filter((l) => ${BAD_TEXT}.test(l)).slice(0, 5);
  return { url: location.pathname + location.search, title: document.title, over: document.documentElement.scrollWidth - innerWidth,
    bad: lines, errorScreen: /algo (ha )?(salido|fallado) mal|application error|runtime error|unhandled|error inesperado/i.test(document.body.innerText),
    notFound: /no (existe|encontr)|404/i.test(document.querySelector('h1,h2')?.innerText ?? ''),
    loading: !!document.querySelector('[aria-busy="true"], [data-loading="true"]') || /^\\s*cargando/i.test(t.slice(0, 200)),
    chars: t.length };
})()`;

type Row = { route: string; w: number; status: number | null; final: string; errors: string[]; badNet: string[]; over: number; bad: string[]; errorScreen: boolean; notFound: boolean; loading: boolean; loads: number; chars: number };

async function run(w: number): Promise<Row[]> {
  const rows: Row[] = [];
  const c: Client = await openBrowser("QA", w, { label: `audit-${MODE}-${w}`, reduced: process.env.REDUCED === "1" });
  let docStatus: number | null = null;
  c.tab.on("Network.responseReceived", (p: any) => { if (p?.type === "Document") docStatus = p.response?.status ?? null; });
  await c.tab.send("Network.enable", {}).catch(() => null);
  try {
    await c.tab.goto(`${BASE}/robots.txt`, 300);
    if (SESSION) await c.tab.setStorage("sb-valorosters-auth-token", SESSION);
    for (const route of ROUTES) {
      c.tab.takeErrors(); await netReset(c); docStatus = null;
      const loads0 = c.tab.loadCount();
      await c.tab.goto(`${BASE}${route}`, 2500);
      let m: any = null;
      for (let i = 0; i < 7; i++) { m = await c.tab.js<any>(PROBE).catch(() => null); if (m && !m.loading && m.chars > 30) break; await sleep(2000); }
      await sleep(600);
      m = await c.tab.js<any>(PROBE).catch(() => m);
      const n = await net(c);
      const errors = c.tab.takeErrors().filter((e) => !/favicon|chrome-extension|Download the React DevTools/i.test(e));
      rows.push({ route, w, status: docStatus, final: m?.url ?? "?", errors, badNet: (n?.bad ?? []) as string[], over: m?.over ?? 0, bad: m?.bad ?? [], errorScreen: !!m?.errorScreen, notFound: !!m?.notFound, loading: !!m?.loading, loads: c.tab.loadCount() - loads0, chars: m?.chars ?? 0 });
      const r = rows[rows.length - 1];
      const flag = r.errors.length || r.badNet.length || r.over > 0 || r.bad.length || r.errorScreen || r.loading || (r.status ?? 200) >= 400 || r.loads > 2;
      console.log(`${flag ? "!!" : "ok"} ${w} ${route} → ${r.final} [${r.status}] err=${r.errors.length} net=${r.badNet.join(",")} over=${r.over} bad=${r.bad.length} es=${r.errorScreen} load=${r.loading}`);
    }
  } finally { await c.browser.close().catch(() => null); }
  return rows;
}

(async () => {
  const all: Row[] = [];
  for (const w of WIDTHS) all.push(...(await run(w)));
  writeFileSync(join(OUT, `crawl-${WIDTHS.join("-")}${process.env.REDUCED === "1" ? "-reduced" : ""}${process.env.TAG ? "-" + process.env.TAG : ""}${process.env.ONLY ? "-partial" : ""}.json`), JSON.stringify({ base: BASE, mode: MODE, at: new Date().toISOString(), routes: ROUTES.length, rows: all }, null, 2));
  console.log(`\n${ROUTES.length} rutas × ${WIDTHS.length} anchos`);
})();
