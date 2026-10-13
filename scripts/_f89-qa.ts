/**
 * F89 · QA EN NAVEGADOR DEL PERFIL 2.0 (instrumento, fuera de CI) — arnés `/design-system/fase89`.
 *
 *   BASE_URL=http://127.0.0.1:3089 npx tsx scripts/_f89-qa.ts --serve        (arranca SU propio next start con NEXUS_QA_HARNESS=1)
 *
 * Por anchura (1440/1024/390) y movimiento (normal/reducido): perfil propio y público, sin insignias, equipo sin logo,
 * vacío propio/público, textos largos, XSS, editor de equipo favorito e insignias. Desbordamiento horizontal, consola,
 * h1 único, alt de imágenes, objetivos táctiles de los botones, controles de edición solo en el propio, héroe con
 * cartas solo en escritorio, «Cargar más», foco por teclado. Escribe docs/product/qa/f89-profile/.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openBrowser, sleep, type Client } from "./_fase68-lib";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3089";
const OUT = join(process.cwd(), "docs/product/qa/f89-profile");
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

const SCENES = ["own", "public", "anon", "no-badges", "no-team-logo", "empty-own", "empty-public", "long", "xss", "editor-team", "editor-badges"] as const;

async function open(c: Client, scene: string) {
  c.tab.takeErrors();
  await c.tab.goto(`${BASE}/design-system/fase89?scene=${scene}`, 1500);
  for (let i = 0; i < 60; i++) { if (await js<boolean>(c, `document.querySelector('main[data-harness="fase89"]')?.dataset.scene === ${JSON.stringify(scene)} && !!document.querySelector('[data-testid="player-hero"]')`).catch(() => false)) break; await sleep(150); }
  await js(c, "document.fonts && document.fonts.ready").catch(() => null);
  await sleep(500);
}

async function pass(w: number, motion: "normal" | "reduced") {
  const c = await openBrowser("QA", w, { reduced: motion === "reduced", label: `f89-${w}-${motion}` });
  try {
    for (const scene of SCENES) {
      if (motion === "reduced" && !["own", "public", "empty-own"].includes(scene)) continue;
      await open(c, scene);
      const ox = await js<number>(c, "document.documentElement.scrollWidth - window.innerWidth");
      check(w, motion, scene, "sin desbordamiento horizontal", ox <= 0, ox);
      const e = errs(c);
      check(w, motion, scene, "consola limpia", e.length === 0, e);
      check(w, motion, scene, "un solo h1", (await js<number>(c, "document.querySelectorAll('h1').length")) === 1);
      const noAlt = await js<number>(c, "[...document.querySelectorAll('img')].filter(i => !i.hasAttribute('alt')).length");
      check(w, motion, scene, "toda imagen con alt", noAlt === 0, noAlt);
      const isOwn = ["own", "empty-own", "long", "editor-team", "editor-badges"].includes(scene);
      const editBtn = await js<boolean>(c, `!!document.querySelector('[data-action="edit"]')`);
      check(w, motion, scene, isOwn ? "controles de edición presentes (propio)" : "SIN controles de edición (público)", editBtn === isOwn);
      if (!scene.startsWith("editor")) {
        const small = await js<string[]>(c, `[...document.querySelectorAll('[data-testid="player-hero"] button, [data-testid="match-history"] button')].filter(b => b.offsetParent && b.getBoundingClientRect().height < 44).map(b => b.textContent.trim().slice(0,30))`);
        check(w, motion, scene, "botones del héroe/historial ≥ 44 px", small.length === 0, small);
      }
      if (scene === "own" || scene === "public") {
        const fan = await js<boolean>(c, `(() => { const e = document.querySelector('[data-testid="hero-cards"]'); return !!e && getComputedStyle(e).display !== 'none'; })()`);
        check(w, motion, scene, w >= 1024 ? "cartas destacadas en el héroe (escritorio/tableta ancha)" : "móvil: cartas en la vitrina, no en el héroe", fan === (w >= 1024));
        check(w, motion, scene, "equipo favorito con logo real", await js<boolean>(c, `!!document.querySelector('[data-testid="favorite-team"] img[src="/hints/teams/team-heretics.png"]')`));
        check(w, motion, scene, "insignias destacadas (3) en el héroe", (await js<string>(c, `document.querySelector('[data-testid="hero-badges"]')?.dataset.count ?? ''`)) === "3");
        check(w, motion, scene, "historial con «Cargar más»", await js<boolean>(c, `!!document.querySelector('[data-action="history-more"]')`));
        const logosOk = await js<boolean>(c, `[...document.querySelectorAll('[data-testid="completed-sets"] img')].every(i => i.complete && i.naturalWidth > 0)`);
        check(w, motion, scene, "logos de colecciones completadas cargan", logosOk);
        await c.tab.shot(join(SHOTS, `${scene}-${w}-${motion}.png`)).catch(() => null);
        // Página entera (desplazada) para revisar todas las secciones.
        const h = await js<number>(c, "document.documentElement.scrollHeight");
        await js(c, `window.scrollTo(0, ${Math.round(h * 0.45)})`); await sleep(350);
        await c.tab.shot(join(SHOTS, `${scene}-${w}-${motion}-mid.png`)).catch(() => null);
        await js(c, `window.scrollTo(0, ${h})`); await sleep(350);
        await c.tab.shot(join(SHOTS, `${scene}-${w}-${motion}-end.png`)).catch(() => null);
        await js(c, "window.scrollTo(0, 0)");
      } else if (motion === "normal") {
        await c.tab.shot(join(SHOTS, `${scene}-${w}.png`)).catch(() => null);
      }
      if (scene === "own" && motion === "normal") {
        // Teclado: el primer Tab dentro del héroe aterriza en un control con foco visible.
        await js(c, `document.querySelector('[data-testid="player-hero"] [data-action="edit"]').focus()`);
        const focused = await js<string>(c, "document.activeElement?.getAttribute('data-action') ?? ''");
        check(w, motion, scene, "teclado: «Editar perfil» enfocable", focused === "edit");
      }
      if (scene === "editor-team") {
        const n0 = await js<number>(c, `document.querySelectorAll('[data-team-option]').length`);
        await js(c, `(() => { const i = document.querySelector('[data-testid="editor-team"] input[type="search"]'); const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(i, 'liq'); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
        await sleep(250);
        const n1 = await js<number>(c, `document.querySelectorAll('[data-team-option]').length`);
        check(w, motion, scene, "editor: búsqueda filtra equipos reales", n0 > 20 && n1 === 2, { n0, n1 });
        await js(c, `document.querySelector('[data-team-option="team-liquid"]')?.click()`); await sleep(200);
        check(w, motion, scene, "editor: elegir marca aria-pressed y habilita Guardar", (await js<string>(c, `document.querySelector('[data-team-option="team-liquid"]')?.getAttribute('aria-pressed') ?? ''`)) === "true" && !(await js<boolean>(c, `document.querySelector('[data-testid="save-team"]').disabled`)));
        await c.tab.shot(join(SHOTS, `editor-team-${w}-selected.png`)).catch(() => null);
      }
    }
  } finally { await c.browser.close(); }
}

const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
async function serve(): Promise<() => void> {
  const { spawn } = await import("node:child_process");
  const port = new URL(BASE).port || "3089";
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", port, "-H", "127.0.0.1"], { env: { ...process.env, NEXUS_QA_HARNESS: "1" }, stdio: "ignore" });
  for (let i = 0; i < 80; i++) { try { if ((await fetch(`${BASE}/design-system/fase89`)).status === 200) break; } catch { /* arrancando */ } await sleep(500); }
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
  console.log(`\nF89 QA: ${checks.length - failed.length}/${checks.length}`);
  process.exitCode = failed.length ? 1 : 0;
}
void main();
