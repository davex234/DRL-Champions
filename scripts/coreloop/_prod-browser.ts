/**
 * CORE GAME LOOP · QA EN NAVEGADOR EN PRODUCCIÓN con sesión QA (instrumento, fuera de CI y de la release).
 *
 *   BASE_URL=https://valorosters.com QA_SESSION_FILE=<json de sesión supabase> npx tsx scripts/coreloop/_prod-browser.ts
 *
 * Portada y /progresion con cuenta: las diarias son abrir/jugar/ganar (ninguna «Haz una predicción»), la insignia de
 * TIENDA (Centro de eventos local) no anuncia nada con sesión, sin desbordamiento. Anónimo: la insignia local sigue.
 * 1440 / 1024 / 390, normal y movimiento reducido.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openBrowser, sleep, type Client } from "../_fase68-lib";

const BASE = process.env.BASE_URL ?? "https://valorosters.com";
const SESSION = readFileSync(process.env.QA_SESSION_FILE!, "utf8");
const OUT = join(process.cwd(), "docs/product/qa/core-loop/prod");
mkdirSync(OUT, { recursive: true });
const checks: { id: string; w: number; name: string; ok: boolean; detail?: unknown }[] = [];
const check = (id: string, w: number, name: string, ok: boolean, detail?: unknown) => { checks.push({ id, w, name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} [${id} ${w}] ${name}${ok ? "" : ` ${JSON.stringify(detail)?.slice(0, 300)}`}`); };
async function waitFor(c: Client, expr: string, ms = 25000) { for (let i = 0; i < ms / 200; i++) { if (await c.tab.js<boolean>(expr).catch(() => false)) return true; await sleep(200); } return false; }
const PAGE = `(() => { const main = document.querySelector('main') || document.body; const t = main.innerText;
  const shop = [...document.querySelectorAll('.nx-dock a, .nx-dock > div, header a, header button')].filter((a) => /tienda/i.test(a.innerText)).map((a) => a.innerText.replace(/\\s+/g, ' ').trim());
  return { pickem: /Haz una predicci[oó]n/i.test(document.body.innerText), abrir: /Abre un sobre/i.test(t), jugar: /Juega un duelo/i.test(t), ganar: /Gana un duelo/i.test(t),
    shop, shopBadge: shop.some((s) => /\\d/.test(s)), overflow: document.documentElement.scrollWidth - innerWidth, entrar: /\\bENTRAR\\b/.test(document.body.innerText) }; })()`;

async function pass(w: number, reduced: boolean) {
  const c = await openBrowser("QA", w, { reduced, label: `cl-prod-${w}${reduced ? "-r" : ""}` });
  try {
    await c.tab.goto(`${BASE}/robots.txt`, 300);
    await c.tab.setStorage("sb-valorosters-auth-token", SESSION);
    for (const [id, path, ready] of [["home", "/", "JUGAR"], ["progresion", "/progresion", "Juega un duelo"]] as const) {
      await c.tab.goto(`${BASE}${path}`, 2500);
      const ok = await waitFor(c, `document.body.innerText.includes(${JSON.stringify(ready)})`);
      await sleep(reduced ? 600 : 1500);
      const m = await c.tab.js<any>(PAGE);
      // La portada enseña UNA acción (no la lista); /progresion enseña las diarias.
      check(id, w, id === "home" ? "con sesión: portada con cuenta y ninguna «Haz una predicción»" : "con sesión: las diarias reales (jugar) y ninguna «Haz una predicción»", ok && (id === "home" || m.jugar) && !m.pickem && !m.entrar, m);
      check(id, w, "con sesión: TIENDA sin número del Centro de eventos local", !m.shopBadge, m.shop);
      check(id, w, "sin desbordamiento horizontal", m.overflow <= 0, m.overflow);
      await c.tab.shot(join(OUT, `${id}-${w}${reduced ? "-reduced" : ""}.png`));
    }
  } finally { await c.browser.close().catch(() => null); }
}

async function anon(w: number) {
  const c = await openBrowser("QA", w, { label: `cl-prod-anon-${w}` });
  try {
    await c.tab.goto(`${BASE}/`, 3000);
    await sleep(2500);
    const m = await c.tab.js<any>(PAGE);
    // Control informativo: la portada pública sin sesión no lleva la barra de juego (no hay insignia que mirar).
    console.log(`INFO [anon ${w}] sin sesión: barra=${m.shop.length ? "sí" : "no"} insignia=${m.shopBadge}`);
  } finally { await c.browser.close().catch(() => null); }
}

(async () => {
  for (const w of [1440, 1024, 390]) { await pass(w, false); await pass(w, true); }
  await anon(390);
  const failed = checks.filter((x) => !x.ok);
  writeFileSync(join(OUT, "browser-checks.json"), JSON.stringify({ base: BASE, at: new Date().toISOString(), total: checks.length, failed: failed.length, checks }, null, 2));
  console.log(`\n${checks.length - failed.length}/${checks.length} PASS`);
  process.exit(failed.length ? 1 : 0);
})();
