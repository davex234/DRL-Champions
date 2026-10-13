/**
 * F85 · QA EN NAVEGADOR DE SOCIAL 2.0 (instrumento, fuera de CI) — arnés `/design-system/f85`.
 *
 *   BASE_URL=http://127.0.0.1:3085 npx tsx scripts/_f85-qa.ts --serve        (arranca SU propio next start con NEXUS_QA_HARNESS=1)
 *
 * Por anchura (1440/1024/390) y movimiento (normal/reducido): hub, amigos 0/1/20/200+, nombres largos, solicitudes,
 * búsqueda (resultados / más / vacía), recientes, retos, perfil (amigo / menú / desconocido / enviada / bloqueado / largo),
 * comparar, reto recibido (normal / revancha / largo / ocupado). Desbordamiento horizontal, consola, objetivos táctiles,
 * estado con palabra (no solo color), ARIA de pestañas/menú/región, foco por teclado, reto recibido dentro de pantalla
 * en 390, sin puntuación compuesta en comparar. Escribe docs/product/qa/f85-social/.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openBrowser, sleep, type Client } from "./_fase68-lib";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3085";
const OUT = join(process.cwd(), "docs/product/qa/f85-social");
const SHOTS = join(OUT, "shots");
mkdirSync(SHOTS, { recursive: true });

interface Check { w: number; motion: string; scene: string; name: string; ok: boolean; detail?: unknown }
const checks: Check[] = [];
const check = (w: number, motion: string, scene: string, name: string, ok: boolean, detail?: unknown) => {
  checks.push({ w, motion, scene, name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} [${w} ${motion}] ${scene} · ${name}${ok ? "" : ` ${JSON.stringify(detail)}`}`);
};
const js = <T,>(c: Client, s: string) => c.tab.js<T>(s);
const errs = (c: Client) => c.tab.takeErrors().filter((e) => !/Failed to load resource: the server responded with a status of (401|503)/.test(e) && !/api\/content\//.test(e));

const SCENES = [
  "hub", "friends-0", "friends-1", "friends-20", "friends-200", "friends-200-more", "long-names", "requests", "search", "search-more",
  "search-empty", "recent", "challenges", "profile-friend", "profile-friend-menu", "profile-stranger", "profile-sent", "profile-blocked",
  "profile-long", "compare", "compare-sparse", "incoming", "incoming-rematch", "incoming-long", "incoming-busy",
] as const;
const REDUCED = new Set(["hub", "challenges", "incoming", "incoming-rematch", "profile-friend"]);

async function open(c: Client, scene: string) {
  c.tab.takeErrors();
  await c.tab.goto(`${BASE}/design-system/f85?scene=${scene}`, 1500);
  for (let i = 0; i < 60; i++) { if (await js<boolean>(c, `document.querySelector('[data-qa-scene]')?.dataset.qaScene === ${JSON.stringify(scene)}`).catch(() => false)) break; await sleep(150); }
  await js(c, "document.fonts && document.fonts.ready").catch(() => null);
  await sleep(scene === "profile-friend-menu" ? 900 : 450);
}

async function pass(w: number, motion: "normal" | "reduced") {
  const c = await openBrowser("QA", w, { reduced: motion === "reduced", label: `f85-${w}-${motion}` });
  try {
    for (const scene of SCENES) {
      if (motion === "reduced" && !REDUCED.has(scene)) continue;
      await open(c, scene);
      const ox = await js<number>(c, "document.documentElement.scrollWidth - window.innerWidth");
      check(w, motion, scene, "sin desbordamiento horizontal", ox <= 0, ox);
      const e = errs(c);
      check(w, motion, scene, "consola limpia", e.length === 0, e);
      const noAlt = await js<number>(c, "[...document.querySelectorAll('img')].filter(i => !i.hasAttribute('alt')).length");
      check(w, motion, scene, "toda imagen con alt", noAlt === 0, noAlt);
      // Botones visibles de la escena (no los del índice/cabecera del arnés) con objetivo táctil ≥ 40 px de alto en móvil.
      if (w === 390) {
        const small = await js<string[]>(c, `[...document.querySelectorAll('[data-qa-scene] button, [data-qa-scene] a[href]')].filter(b => b.offsetParent && !b.closest('[data-qa-chrome]')).filter(b => { const r = b.getBoundingClientRect(); return r.height < 40 && r.width > 0; }).map(b => (b.getAttribute('aria-label') || b.textContent || '').trim().slice(0,30))`);
        check(w, motion, scene, "objetivos táctiles ≥ 40 px", small.length === 0, small);
      }
      // Cortes por nombres largos: ningún botón se sale de su contenedor.
      const clipped = await js<string[]>(c, `[...document.querySelectorAll('[data-qa-scene] button')].filter(b => b.offsetParent && b.scrollWidth > b.clientWidth + 2 && getComputedStyle(b).overflow !== 'hidden').map(b => b.textContent.trim().slice(0,30))`);
      check(w, motion, scene, "ningún botón con texto desbordado", clipped.length === 0, clipped);

      if (["hub", "friends-0", "friends-1", "friends-20", "friends-200", "friends-200-more", "long-names", "requests", "search", "search-more", "search-empty", "recent", "challenges"].includes(scene)) {
        const tabs = await js<{ list: number; tabs: number; selected: number; panel: number }>(c, `({ list: document.querySelectorAll('[role="tablist"]').length, tabs: document.querySelectorAll('[role="tab"]').length, selected: document.querySelectorAll('[role="tab"][aria-selected="true"]').length, panel: document.querySelectorAll('[role="tabpanel"]').length })`);
        check(w, motion, scene, "ARIA de pestañas (tablist, 1 seleccionada, panel)", tabs.list === 1 && tabs.tabs >= 4 && tabs.selected === 1 && tabs.panel >= 1, tabs);
      }
      if (scene.startsWith("friends-") && scene !== "friends-0" || scene === "hub" || scene === "long-names") {
        const words = await js<{ rows: number; worded: number }>(c, `(() => { const rows = [...document.querySelectorAll('[data-testid="friends-list"] li')]; const re = /(En partida|En cola ranked|En línea|Desconectado)/; return { rows: rows.length, worded: rows.filter(r => re.test(r.textContent)).length }; })()`);
        check(w, motion, scene, "presencia con palabra en cada amigo (no solo color)", words.rows > 0 && words.rows === words.worded, words);
      }
      if (scene === "friends-0") check(w, motion, scene, "vacío de amigos con CTA útil", await js<boolean>(c, `(() => { const e = document.querySelector('[data-testid="friends-empty"]'); return !!e && !!e.querySelector('button, a[href]'); })()`));
      if (scene === "friends-200") check(w, motion, scene, "200+ amigos: primera página acotada + «Ver más»", await js<boolean>(c, `document.querySelectorAll('[data-testid="friends-list"] li').length <= 100 && !!document.querySelector('[data-testid="friends-more"]')`));
      if (scene === "search-empty") check(w, motion, scene, "búsqueda sin resultados con mensaje", await js<boolean>(c, `!!document.querySelector('[data-testid="search-empty"]')`));
      if (scene === "search") {
        const leak = await js<boolean>(c, `/@|[0-9a-f]{8}-[0-9a-f]{4}-/i.test(document.querySelector('[data-testid="search-results"]')?.textContent ?? '')`);
        check(w, motion, scene, "resultados sin correo ni UUID visibles", !leak);
      }
      if (scene === "challenges") check(w, motion, scene, "reto enviado: «esperando respuesta» visible", await js<boolean>(c, `!!document.querySelector('[data-testid="challenge-waiting"]') || /esperando/i.test(document.querySelector('[data-testid="challenges"]')?.textContent ?? '')`));
      if (scene === "profile-friend-menu") {
        const m = await js<{ menu: number; items: number; block: boolean }>(c, `({ menu: document.querySelectorAll('[role="menu"]').length, items: document.querySelectorAll('[role="menuitem"]').length, block: !!document.querySelector('[role="menu"] [data-action="block"]') })`);
        check(w, motion, scene, "bloquear en menú contextual (no botón principal)", m.menu === 1 && m.items >= 1 && m.block, m);
      }
      if (scene === "profile-friend") {
        // El amigo del arnés ya me ha retado (un reto pendiente por pareja): la acción es ACEPTAR su reto, no crear otro.
        check(w, motion, scene, "amigo con reto suyo pendiente: ACEPTAR RETO/RECHAZAR, sin AÑADIR ni RETAR duplicado", await js<boolean>(c, `!!document.querySelector('[data-testid="pending-challenge"]') && /Aceptar reto/i.test(document.querySelector('[data-testid="pending-challenge"]').textContent) && !document.querySelector('[data-action="add"]') && !document.querySelector('[data-action="challenge"]')`));
        check(w, motion, scene, "BLOQUEAR no es botón principal", await js<boolean>(c, `!document.querySelector('[data-testid="social-actions"] > * [data-action="block"]:not([role="menuitem"])')`));
        await js(c, `document.querySelector('[data-action="more"]')?.focus()`);
        check(w, motion, scene, "teclado: menú «más» enfocable", (await js<string>(c, "document.activeElement?.getAttribute('data-action') ?? ''")) === "more");
      }
      if (scene === "profile-stranger") check(w, motion, scene, "desconocido: AÑADIR AMIGO, sin RETAR", await js<boolean>(c, `!!document.querySelector('[data-action="add"]') && !document.querySelector('[data-action="challenge"]')`));
      if (scene === "profile-sent") check(w, motion, scene, "pendiente: «Solicitud enviada»", await js<boolean>(c, `!!document.querySelector('[data-action="sent"]') || /Solicitud enviada/i.test(document.body.textContent)`));
      if (scene === "profile-blocked") check(w, motion, scene, "bloqueado por mí: solo DESBLOQUEAR", await js<boolean>(c, `!!document.querySelector('[data-action="unblock"]') && !document.querySelector('[data-action="challenge"]') && !document.querySelector('[data-action="add"]')`));
      if (scene.startsWith("compare")) {
        const t = await js<string>(c, `document.querySelector('[data-testid="compare-table"]')?.textContent ?? ''`);
        check(w, motion, scene, "comparar: tabla lado a lado presente", t.length > 0);
        check(w, motion, scene, "comparar: sin puntuación compuesta ni «quién es mejor»", !/\d{1,3}\s?%\s*(mejor|superior)|mejor jugador|gana a|puntuaci[oó]n global/i.test(t));
      }
      if (scene.startsWith("incoming")) {
        const r = await js<{ top: number; bottom: number; vh: number; acc: number; dec: number; label: string; live: string }>(c, `(() => { const s = document.querySelector('[data-testid="incoming-challenge"]'); const b = s.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, vh: window.innerHeight, acc: s.querySelector('[data-action="accept"]').getBoundingClientRect().height, dec: s.querySelector('[data-action="decline"]').getBoundingClientRect().height, label: s.getAttribute('aria-label') || '', live: s.getAttribute('aria-live') || '' }; })()`);
        check(w, motion, scene, "reto recibido dentro de la pantalla", r.top >= 0 && r.bottom <= r.vh, r);
        check(w, motion, scene, "ACEPTAR/RECHAZAR ≥ 44 px", r.acc >= 44 && r.dec >= 44, r);
        check(w, motion, scene, "región con etiqueta y aria-live", r.label.length > 0 && r.live === "polite", r);
        check(w, motion, scene, "dice que es amistoso: sin rating ni colocación", await js<boolean>(c, `/Sin rating ni colocación/.test(document.querySelector('[data-testid="incoming-challenge"]').textContent)`));
        if (scene === "incoming-rematch") check(w, motion, scene, "revancha rotulada como tal", await js<boolean>(c, `/revancha/i.test(document.querySelector('[data-testid="incoming-challenge"]').textContent)`));
        if (motion === "reduced") {
          const tr = await js<string>(c, `getComputedStyle(document.querySelector('[data-testid="incoming-challenge"]')).transform`);
          check(w, motion, scene, "movimiento reducido: aparece sin desplazamiento", tr === "none" || /matrix\(1, 0, 0, 1, 0, 0\)/.test(tr), tr);
        }
      }
      await c.tab.shot(join(SHOTS, `${scene}-${w}-${motion}.png`)).catch(() => null);
    }
  } finally { await c.browser.close(); }
}

const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
async function serve(): Promise<() => void> {
  const { spawn } = await import("node:child_process");
  const port = new URL(BASE).port || "3085";
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", port, "-H", "127.0.0.1"], { env: { ...process.env, NEXUS_QA_HARNESS: "1" }, stdio: "ignore" });
  for (let i = 0; i < 80; i++) { try { if ((await fetch(`${BASE}/design-system/f85`)).status === 200) break; } catch { /* arrancando */ } await sleep(500); }
  return () => child.kill();
}

async function main() {
  const stop = process.argv.includes("--serve") ? await serve() : () => undefined;
  const motions = (arg("--motion") ? [arg("--motion")] : ["normal", "reduced"]) as ("normal" | "reduced")[];
  const widths = arg("--width") ? [Number(arg("--width"))] : [1440, 1024, 390];
  try {
    for (const motion of motions) for (const w of widths) await pass(w, motion);
  } finally { stop(); }
  const failed = checks.filter((c) => !c.ok);
  writeFileSync(join(OUT, `qa-${motions.join("+")}-${widths.join("+")}.json`), JSON.stringify({ base: BASE, at: new Date().toISOString(), total: checks.length, passed: checks.length - failed.length, failed: failed.length, checks }, null, 1));
  console.log(`\nF85 QA: ${checks.length - failed.length}/${checks.length}`);
  process.exitCode = failed.length ? 1 : 0;
}
void main();
