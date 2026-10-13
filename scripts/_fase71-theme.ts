/**
 * F71 · la temática de duelo en un NAVEGADOR REAL contra la build servida (fuera de CI, cuenta QA).
 *   npx tsx scripts/_fase71-theme.ts [persona=K]
 * Sin tocar la BD de producción (crear un tema exige un admin): se sustituye SOLO la respuesta de `/api/content/duel-theme`
 * y se comprueba lo que pinta la arena de verdad:
 *   1. tema de evento con imagen válida → la capa del tema va encima de la arena por defecto;
 *   2. tema con imagen inexistente → el fondo sigue siendo visible (capa DEFAULT debajo);
 *   3. sin interceptar → DEFAULT (slug «default»).
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { openBrowser, loginUi, goto, sleep, clickText, waitFor } from "./_fase68-lib";

/* eslint-disable @typescript-eslint/no-explicit-any */
const P = process.argv[2] ?? "K";
const OUT = join(process.cwd(), "docs/product/qa/fase71");
mkdirSync(OUT, { recursive: true });

async function arenaWith(theme: Record<string, unknown> | null, label: string) {
  const c = await openBrowser(P, 1440, { label: `f71-theme-${label}` });
  try {
    // El cdp de los arneses no expone eventos: se sustituye fetch SOLO para esa ruta.
    if (theme) {
      await c.tab.send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => { const of = window.fetch; const body = ${JSON.stringify(JSON.stringify({ theme }))};
        window.fetch = (u, i) => (String(typeof u === 'string' ? u : u && u.url).includes('/api/content/duel-theme') ? Promise.resolve(new Response(body, { status: 200, headers: { 'content-type': 'application/json' } })) : of(u, i)); })();` });
    }
    await loginUi(c, P);
    await goto(c, "/duelos/jugar", 3500);
    if (await waitFor(c.tab, `/Comenzar duelo/i.test(document.body.innerText)`, 8000)) { await clickText(c, "^Comenzar duelo$"); await sleep(3000); }
    await waitFor(c.tab, `!!document.querySelector('[data-arena-env]')`, 15000);
    await sleep(1500);
    const info = await c.tab.js<any>(`(() => { const env = document.querySelector('[data-arena-env]'); const st = document.querySelector('.nx-arena-env-stage');
      return { theme: env?.getAttribute('data-duel-theme'), varWide: env?.style.getPropertyValue('--arena-bg-wide'), bg: st ? getComputedStyle(st).backgroundImage : null }; })()`);
    const loaded = await c.tab.js<any>(`Promise.all([...new Set((getComputedStyle(document.querySelector('.nx-arena-env-stage')).backgroundImage.match(/url\\("([^"]+)"\\)/g) || []).map(s => s.slice(5, -2)))].map(u => new Promise(r => { const i = new Image(); i.onload = () => r({ u, ok: true }); i.onerror = () => r({ u, ok: false }); i.src = u; })))`);
    return { label, ...info, layers: loaded };
  } finally { await c.browser.close(); }
}

(async () => {
  const base = "http://127.0.0.1:3005";
  const results = [
    await arenaWith({ id: "t1", slug: "champions-test", name: "Champions (prueba)", wide: `${base}/packs/pack-champions.webp`, narrow: `${base}/packs/pack-champions.webp`, source: "event" }, "event"),
    await arenaWith({ id: "t2", slug: "broken-test", name: "Roto", wide: `${base}/no-existe-f71.webp`, narrow: `${base}/no-existe-f71.webp`, source: "event" }, "broken"),
    await arenaWith(null, "default"),
  ];
  const ok = results[0].theme === "champions-test" && results[0].layers.length === 2 && results[0].layers.every((l: any) => l.ok)
    && results[1].theme === "broken-test" && results[1].layers.some((l: any) => !l.ok) && results[1].layers.some((l: any) => l.ok && /nexus-champions/.test(l.u))
    && results[2].theme === "default" && results[2].layers.length === 1 && results[2].layers[0].ok;
  writeFileSync(join(OUT, "theme-browser.json"), JSON.stringify({ at: new Date().toISOString(), ok, results }, null, 2) + "\n");
  for (const r of results) console.log(r.label, r.theme, JSON.stringify(r.layers));
  console.log(ok ? "THEME_BROWSER PASS" : "THEME_BROWSER FAIL");
  process.exit(ok ? 0 : 1);
})();
