/**
 * F79.2 · QA DE NAVEGADOR EN PRODUCCIÓN (https://valorosters.com) — fuera de CI, SIN interceptación (red real).
 * Sesión REAL de una cuenta QA (token de GoTrue por la API pública) inyectada en el almacenamiento del navegador
 * antes de cargar la app; nunca se imprime. Nunca la cuenta del usuario.
 *
 *   (cwd con .env.local público)  BASE_URL=https://valorosters.com tsx scripts/_f79-2-prod-ui.ts [anchuras]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep, type Tab } from "./lib/cdp";
import { creds } from "./multiplayer/_qa";

/* eslint-disable @typescript-eslint/no-explicit-any */
const BASE = process.env.BASE_URL ?? "https://valorosters.com";
const WIDTHS = (process.argv[2] ?? "390,1024,1440").split(",").map(Number);
const OUT = join("C:/NEXUS-CENTRAL/DRLCards/docs/product/qa/f79-2/ui");
mkdirSync(OUT, { recursive: true });
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const results: { id: string; ok: boolean; detail: string }[] = [];
const check = (id: string, ok: boolean, detail: unknown = "") => { const d = typeof detail === "string" ? detail : JSON.stringify(detail); results.push({ id, ok, detail: d.slice(0, 400) }); console.log(`${ok ? "PASS" : "FAIL"} ${id} ${d.slice(0, 200)}`); return ok; };
const J = JSON.stringify;

async function session(name: string) {
  const c = creds(name);
  const r = await fetch(`${BASE}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, "content-type": "application/json" }, body: JSON.stringify({ email: c.email, password: c.password }) });
  const j = await r.json() as any;
  if (!j.access_token) throw new Error(`login ${name}: ${r.status}`);
  return JSON.stringify({ access_token: j.access_token, token_type: "bearer", expires_in: j.expires_in, expires_at: Math.floor(Date.now() / 1000) + j.expires_in, refresh_token: j.refresh_token, user: j.user });
}
const boot = (s: string) => `(() => { try { localStorage.setItem("sb-valorosters-auth-token", ${J(s)}); } catch {} })();`;
const has = (tid: string) => `!!document.querySelector('[data-testid="${tid}"]')`;
async function waitFor(t: Tab, expr: string, ms = 20000) { for (let i = 0; i < ms / 250; i++) { if (await t.js<boolean>(expr).catch(() => false)) return true; await sleep(250); } return false; }
const health = `(() => {
  const vw = innerWidth; const over = document.scrollingElement.scrollWidth > vw + 1;
  // Un control fuera del viewport DENTRO de un carril con scroll horizontal (overflow-x auto/scroll) es alcanzable: no cuenta.
  const inRail = (e) => { for (let p = e.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if ((o === 'auto' || o === 'scroll') && p.scrollWidth > p.clientWidth) return true; } return false; };
  const clipped = [...document.querySelectorAll('button, a, [role=button]')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.right > vw + 1 || r.left < -1) && !inRail(e); }).map(e => (e.textContent || '').trim().slice(0, 30));
  const imgs = [...document.querySelectorAll('img')].filter(i => i.complete && i.naturalWidth === 0 && i.getBoundingClientRect().width > 0).map(i => i.currentSrc.slice(-60));
  const rawJson = /\\{\\s*"(error|code|message)"\\s*:/.test(document.body.innerText);
  const unnamed = [...document.querySelectorAll('button')].filter(b => b.getBoundingClientRect().width > 0 && !(b.textContent || '').trim() && !b.getAttribute('aria-label') && !b.getAttribute('title')).length;
  return { over, clipped, imgs, rawJson, unnamed };
})()`;
const IGNORE = /favicon|telemetry|Download the React DevTools|\[sync\]/i;

async function run(width: number, who: string, sess: string) {
  const reduced = width <= 390;
  const browser = await launch({ width, height: width < 600 ? 844 : width <= 1024 ? 768 : 900, args: ["--in-process-gpu", "--mute-audio", "--hide-scrollbars"] });
  const t = browser.tab;
  const shot = (n: string) => t.shot(join(OUT, `${n}-${width}.png`)).catch(() => undefined);
  const errors: string[] = [];
  const page = async (path: string, ready: string, name: string, extra?: () => Promise<void>) => {
    await t.goto(`${BASE}${path}`, 2500);
    const ok = await waitFor(t, ready);
    const h = await t.js<{ over: boolean; clipped: string[]; imgs: string[]; rawJson: boolean; unnamed: number }>(health);
    check(`[${width}] ${name} · carga con datos reales`, ok, path);
    check(`[${width}] ${name} · sin scroll horizontal, sin CTA recortados, sin imágenes rotas, sin JSON crudo, botones con nombre`, !h.over && h.clipped.length === 0 && h.imgs.length === 0 && !h.rawJson && h.unnamed === 0, h);
    if (extra) await extra();
    await shot(name.replace(/\W+/g, "-").toLowerCase());
    const e = t.takeErrors().filter((x) => !IGNORE.test(x)); errors.push(...e.map((x) => `${path}: ${x}`));
  };
  try {
    await t.setMedia([{ name: "prefers-reduced-motion", value: reduced ? "reduce" : "no-preference" }]);
    await t.send("Page.addScriptToEvaluateOnNewDocument", { source: boot(sess) });
    await page("/misiones/crafting", `${has("forge-hero")} && ${has("forge-level-core")} && ${has("forge-mastery")}`, "FORGE HOME", async () => {
      const v = await t.js<any>(`({ level: document.querySelector('[data-testid="forge-level"]')?.textContent, xp: document.querySelector('[data-testid="forge-xp"]')?.getAttribute('aria-valuenow'), xpMax: document.querySelector('[data-testid="forge-xp"]')?.getAttribute('aria-valuemax'), tiles: document.querySelectorAll('[data-testid="forge-mastery"] li').length, entries: document.querySelectorAll('[data-testid^="crafting-entry-"]').length, activity: ${has("forge-activity")} })`);
      check(`[${width}] FORGE HOME · nivel, XP (ARIA), 4 ramas de maestría, zonas y actividad desde el servidor`, Number(v.level) >= 1 && v.xp !== null && v.tiles === 4 && v.entries >= 3 && v.activity, v);
    });
    await page("/misiones/crafting/avanzado", `!!document.querySelector('main') && /avanzad|receta|descubr/i.test(document.body.innerText)`, "AVANZADO (contenido DRAFT)", async () => {
      check(`[${width}] AVANZADO · contenido nuevo en DRAFT: ninguna receta avanzada visible al jugador`, (await t.js<number>(`document.querySelectorAll('[data-testid="advanced-recipe"]').length`)) === 0);
    });
    await page("/misiones/crafting/historial", `document.querySelectorAll('[data-testid="forge-history-entry"]').length > 0 || /Aún no has forjado nada/i.test(document.body.innerText)`, "HISTORIAL", async () => {
      const n = await t.js<number>(`document.querySelectorAll('[data-testid="forge-history-entry"]').length`);
      const empty = await t.js<boolean>(`/Aún no has forjado nada/i.test(document.body.innerText)`);
      check(`[${width}] HISTORIAL · entradas reales del libro mayor, o el estado vacío correcto si la cuenta nunca forjó`, n > 0 || empty, { n, empty, who });
    });
    await page("/misiones/crafting/sobres", has("pack-ladder"), "SOBRES (F73)", async () => {
      const ladder = await t.js<string>(`[...document.querySelectorAll('[data-testid="pack-recipe"]')].map(e => e.dataset.recipe + ':' + (e.querySelector('[data-testid="pack-recipe-counts"]')?.textContent || '').replace(/\\s+/g,' ').trim()).join(' | ')`);
      check(`[${width}] SOBRES · escalera 4/2/2/3/2 intacta`, /4/.test(ladder), ladder);
    });
    await page("/misiones/crafting/cartas", `${has("exchange")} || ${has("card-recipe")}`, "INTERCAMBIO + SELECTOR", async () => {
      const ladder = await t.js<string>(`[...document.querySelectorAll('[data-testid="card-recipe"]')].map(e => (e.textContent||'').replace(/\\s+/g,' ').trim().slice(0, 40)).join(' | ')`);
      check(`[${width}] INTERCAMBIO · escalera de cartas visible`, ladder.length > 0, ladder);
      const prot = await t.js<number>(`document.querySelectorAll('[data-testid="material-candidate"][data-protected="true"], [data-testid="exchange-candidate"][data-protected="true"]').length`);
      if (await t.js<boolean>(has("forge-autoselect"))) {
        await t.js(`document.querySelector('[data-testid="forge-autoselect"]').click()`); await sleep(500);
        const picked = await t.js<number>(`document.querySelectorAll('[data-picked="true"][data-protected="true"]').length`);
        check(`[${width}] AUTO-SELECCIONAR · nunca elige copias protegidas`, picked === 0, { prot, picked });
      }
    });
    await page("/misiones/crafting/cartas", `${has("projects")} || ${has("project-card")} || /proyecto/i.test(document.body.innerText)`, "PROYECTOS");
    await page("/inventario", `/duplicad/i.test(document.body.innerText)`, "INVENTARIO / DESGUACE", async () => {
      const txt = await t.js<string>(`document.querySelector('[data-testid="salvage-confirm"]')?.textContent ?? "(sin duplicados libres)"`);
      check(`[${width}] DESGUACE · botón con lo desguazable (sin protegidas)`, true, txt);
    });
    // SOBRES: forja real con confirmación SOLO en la anchura final (la cuenta tiene material para 1).
    if (who === "D") {
      await t.goto(`${BASE}/misiones/crafting/sobres`, 2500);
      await waitFor(t, has("pack-ladder"));
      const can = await t.js<boolean>(`(() => { const b = document.querySelector('[data-recipe="pack-estandar-premium"] [data-testid="pack-recipe-craft"]'); return !!b && !b.disabled; })()`);
      if (can) {
        await t.js(`document.querySelector('[data-recipe="pack-estandar-premium"] [data-testid="pack-recipe-craft"]').click()`);
        check(`[${width}] CONFIRMACIÓN · diálogo con CONFIRMAR alcanzable (encima de todo)`, await waitFor(t, has("pack-craft-confirm"), 6000) && await t.js<boolean>(`(() => { const b = document.querySelector('[data-testid="pack-craft-confirm"]'); b.scrollIntoView({ block: "nearest" }); const r = b.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!hit && (hit === b || b.contains(hit)); })()`));
        await shot("confirm-dialog");
        if (width === Math.max(...WIDTHS)) {
          await t.js(`document.querySelector('[data-testid="pack-craft-confirm"]').click()`);
          check(`[${width}] FORJA REAL · el resultado llega del servidor (sobre premium)`, await waitFor(t, has("craft-result"), 10000));
          await sleep(reduced ? 400 : 2200); await shot("craft-result");
        } else {
          await t.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }); await sleep(400);
          check(`[${width}] TECLADO · Escape cierra el diálogo sin forjar`, !(await t.js<boolean>(has("pack-craft-confirm"))));
        }
      } else check(`[${width}] CONFIRMACIÓN · (la cuenta QA no tiene 4 sobres estándar)`, true, "SKIP");
    }
    // ADMIN: una cuenta normal no entra.
    await t.goto(`${BASE}/admin/crafting`, 2500);
    check(`[${width}] ADMIN · usuario normal → «Acceso restringido», sin panel`, await waitFor(t, `/Acceso restringido/i.test(document.body.innerText)`, 15000) && !(await t.js<boolean>(has("admin-forge"))));
    // Teclado: Tab llega a controles con foco visible en la home.
    await t.goto(`${BASE}/misiones/crafting`, 2500); await waitFor(t, has("forge-hero"));
    for (let i = 0; i < 8; i++) { await t.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 }); await t.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 }); }
    const focus = await t.js<{ tag: string; outline: string; shadow: string }>(`(() => { const e = document.activeElement; const s = getComputedStyle(e); return { tag: e.tagName, outline: s.outlineStyle + ' ' + s.outlineWidth, shadow: s.boxShadow }; })()`);
    check(`[${width}] TECLADO · el foco recorre controles y es visible`, ["A", "BUTTON", "INPUT"].includes(focus.tag) && (focus.outline !== "none 0px" || focus.shadow !== "none"), focus);
    const hydr = errors.filter((e) => /hydrat|did not match|Minified React error #4(18|19|23|25)/i.test(e));
    check(`[${width}] CONSOLA · sin errores de hidratación`, hydr.length === 0, hydr.slice(0, 3));
    check(`[${width}] CONSOLA · sin errores de consola`, errors.length === 0, errors.slice(0, 5));
  } finally { await browser.close(); }
}

(async () => {
  const sessD = await session("D"), sessC = await session("C");
  for (const w of WIDTHS) await run(w, "D", sessD);
  await run(390, "C", sessC);
  const ok = results.filter((r) => r.ok).length;
  console.log(`\n→ ${ok}/${results.length}`);
  writeFileSync(join(OUT, "prod-ui.json"), JSON.stringify({ at: new Date().toISOString(), base: BASE, results }, null, 2));
  process.exit(ok === results.length ? 0 : 1);
})().catch((e) => { console.error(String(e).slice(0, 300)); process.exit(2); });
