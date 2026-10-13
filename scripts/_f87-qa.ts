/**
 * F87 · QA EN NAVEGADOR DE PICK'EMS 2.0 (instrumento, fuera de CI) — arnés `/design-system/f87`.
 *
 *   BASE_URL=http://127.0.0.1:3087 npx tsx scripts/_f87-qa.ts --serve [--width 390] [--motion reduced]
 *
 * Por anchura (1440/1024/390) y movimiento (normal/reducido): desbordamiento de PÁGINA (el cuadro se desplaza por
 * dentro), consola, h1 único, reparto escritorio/móvil, conectores, objetivos táctiles ≥ 44 px, foco visible, pick
 * directo (aria-pressed), PROPAGACIÓN del ganador al siguiente cruce, INVALIDACIÓN solo de descendientes, pestañas
 * del móvil, ✓/✕ con palabras, animación nula en reducido. Capturas en docs/product/qa/pickems-2/shots.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openBrowser, sleep, type Client } from "./_fase68-lib";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3087";
const OUT = join(process.cwd(), "docs/product/qa/pickems-2");
const SHOTS = join(OUT, "shots");
mkdirSync(SHOTS, { recursive: true });
interface Check { w: number; motion: string; scene: string; name: string; ok: boolean; detail?: unknown }
const checks: Check[] = [];
const check = (w: number, motion: string, scene: string, name: string, ok: boolean, detail?: unknown) => { checks.push({ w, motion, scene, name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} [${w} ${motion}] ${scene} · ${name}${ok ? "" : ` ${JSON.stringify(detail)}`}`); };
const js = <T,>(c: Client, s: string) => c.tab.js<T>(s);
const errs = (c: Client) => c.tab.takeErrors().filter((e) => !/Failed to load resource: the server responded with a status of (401|404|503)/.test(e) && !/api\/content\//.test(e));
const SCENES = ["playoffs", "playoffs-anon", "playoffs-progress", "groups", "groups-claimed", "single", "rr", "void"] as const;

async function open(c: Client, scene: string, w: number) {
  c.tab.takeErrors();
  await c.tab.goto(`${BASE}/design-system/f87?scene=${scene}`, 1500);
  for (let i = 0; i < 80; i++) { if (await js<boolean>(c, `document.querySelector('main[data-harness="f87"]')?.dataset.scene === ${JSON.stringify(scene)} && !!document.querySelector('[data-bracket-mode]')`).catch(() => false)) break; await sleep(150); }
  await js(c, "document.fonts && document.fonts.ready").catch(() => null);
  await sleep(w < 600 ? 400 : 700);
}

const card = (id: string) => `document.querySelector('[data-match-id="${id}"]')`;
const pressed = (id: string) => `[...${card(id)}?.querySelectorAll('button[aria-pressed="true"]') ?? []].map(b => b.getAttribute('aria-label'))`;

async function pass(w: number, motion: "normal" | "reduced") {
  const c = await openBrowser("QA", w, { reduced: motion === "reduced", label: `f87-${w}-${motion}` });
  try {
    for (const scene of SCENES) {
      if (motion === "reduced" && !["playoffs", "groups"].includes(scene)) continue;
      await open(c, scene, w);
      const ox = await js<number>(c, "document.documentElement.scrollWidth - window.innerWidth");
      check(w, motion, scene, "sin desbordamiento horizontal de la PÁGINA", ox <= 0, ox);
      const e = errs(c); check(w, motion, scene, "consola limpia", e.length === 0, e);
      check(w, motion, scene, "un solo h1", (await js<number>(c, "document.querySelectorAll('h1').length")) === 1);
      check(w, motion, scene, "toda imagen con alt", (await js<number>(c, "[...document.querySelectorAll('img')].filter(i => !i.hasAttribute('alt')).length")) === 0);
      const mode = await js<string>(c, "document.querySelector('[data-bracket-mode]')?.dataset.bracketMode");
      check(w, motion, scene, `reparto ${w < 768 ? "móvil" : "escritorio"}`, mode === (w < 768 ? "mobile" : "desktop"), mode);
      const small = await js<string[]>(c, `[...document.querySelectorAll('[data-match-id] button, [role="tab"], nav[aria-label="Rondas"] button')].filter(b => b.offsetParent !== null && b.getBoundingClientRect().height < 44).map(b => (b.getAttribute('aria-label') || b.textContent).trim().slice(0, 40))`);
      check(w, motion, scene, "objetivos táctiles ≥ 44 px", small.length === 0, small);
      const unlabeled = await js<number>(c, `[...document.querySelectorAll('[data-match-id] button')].filter(b => !b.getAttribute('aria-label')).length`);
      check(w, motion, scene, "botones de pick con aria-label", unlabeled === 0, unlabeled);
      if (mode === "desktop" && !["rr"].includes(scene)) {
        const lines = await js<number>(c, "[...document.querySelectorAll('svg[data-connectors]')].reduce((s, x) => s + Number(x.dataset.connectors), 0)");
        check(w, motion, scene, "conectores dibujados", lines > 0, lines);
        const inner = await js<{ sw: number; cw: number }>(c, `(() => { const r = document.querySelector('[role="group"][tabindex="0"]'); return r ? { sw: r.scrollWidth, cw: r.clientWidth } : { sw: 0, cw: 0 }; })()`);
        check(w, motion, scene, "el cuadro se desplaza por DENTRO de su área (o cabe)", inner.cw > 0, inner);
      }
      if (motion === "reduced") {
        const dur = await js<string>(c, `(() => { const b = document.querySelector('[data-match-id] button'); if (!b) return '0s'; b.classList.add('nx-pick-pop'); return getComputedStyle(b).animationDuration; })()`);
        check(w, motion, scene, "movimiento reducido: animación del pick ≈ 0", /^(0s|0\.00001s|1e-05s|0\.01ms)$/.test(dur) || parseFloat(dur) <= 0.0001, dur);
      }
      await c.tab.shot(join(SHOTS, `${scene}-${w}-${motion}.png`)).catch(() => null);
      if (w < 768 && motion === "normal") {
        await js(c, `document.querySelector('[data-bracket-mode]').scrollIntoView({ block: 'start' })`); await sleep(300);
        await c.tab.shot(join(SHOTS, `${scene}-${w}-board.png`)).catch(() => null);
        await js(c, "window.scrollTo(0,0)"); await sleep(150);
      }

      if (scene === "playoffs" && motion === "normal") {
        if (mode === "mobile") {
          // Pestañas del móvil: cuadro bajo y vuelta.
          const tabs = await js<string[]>(c, `[...document.querySelectorAll('[role="tab"]')].map(t => t.textContent.trim())`);
          check(w, motion, scene, "móvil: pestañas Cuadro alto / bajo / Gran final", tabs.length === 3, tabs);
          await js(c, `[...document.querySelectorAll('[role="tab"]')].find(t => /bajo/i.test(t.textContent)).click()`); await sleep(250);
          check(w, motion, scene, "móvil: la pestaña del cuadro bajo muestra sus rondas", await js<boolean>(c, `[...document.querySelectorAll('nav[aria-label="Rondas"] button')].some(b => /baja/i.test(b.textContent))`));
          await c.tab.shot(join(SHOTS, `${scene}-${w}-lower.png`)).catch(() => null);
          await js(c, `[...document.querySelectorAll('[role="tab"]')].find(t => /alto/i.test(t.textContent)).click()`); await sleep(250);
          await js(c, `[...document.querySelectorAll('nav[aria-label="Rondas"] button')].find(b => /Cuartos/i.test(b.textContent)).click()`); await sleep(250);
        }
        // Estado inicial del arnés: NRG (uqf 754732), PRX (754733) y NRG en la semi 754735.
        check(w, motion, scene, "pick previo marcado (aria-pressed) en cuartos", (await js<string[]>(c, pressed("754732"))).some((l) => /NRG/.test(l)));
        if (mode === "desktop") check(w, motion, scene, "propagación: NRG y Paper Rex son los participantes predichos de la semi", await js<boolean>(c, `/NRG/i.test(${card("754735")}.textContent) && /Paper Rex/i.test(${card("754735")}.textContent)`));
        // Cambiar cuartos a T1 → la semi deja de tener pick (dependía de NRG) y aparece T1.
        await js(c, `[...${card("754732")}.querySelectorAll('button')].find(b => /^Elegir T1 /.test(b.getAttribute('aria-label'))).click()`); await sleep(300);
        check(w, motion, scene, "pick directo: T1 queda elegido", (await js<string[]>(c, pressed("754732"))).some((l) => /^Quitar T1 /.test(l)));
        check(w, motion, scene, "aviso: «posterior(es) quitada(s)»", await js<boolean>(c, `/quitada/i.test(document.body.textContent)`));
        if (mode === "desktop") {
          check(w, motion, scene, "invalidación: la semi ya no tiene pick", (await js<string[]>(c, pressed("754735"))).length === 0);
          check(w, motion, scene, "propagación: T1 aparece en la semi", await js<boolean>(c, `/T1/.test(${card("754735")}.textContent)`));
          check(w, motion, scene, "independiente intacto: el otro cuarto conserva su pick", (await js<string[]>(c, pressed("754730"))).length === 1);
        }
        // Teclado: el primer botón de pick recibe foco y lleva el anillo del sistema.
        const focus = await js<boolean>(c, `(() => { const b = document.querySelector('[data-match-id] button'); b.focus(); return document.activeElement === b && b.classList.contains('nx-focus'); })()`);
        check(w, motion, scene, "teclado: los picks son enfocables con anillo visible", focus);
        await c.tab.shot(join(SHOTS, `${scene}-${w}-after-change.png`)).catch(() => null);
      }
      if (scene === "groups" && motion === "normal") {
        check(w, motion, scene, "✓ y ✕ con PALABRAS", await js<boolean>(c, `/Acertado/.test(document.body.textContent) && /Fallado/.test(document.body.textContent)`));
        check(w, motion, scene, "reclamo visible al liquidar", await js<boolean>(c, `[...document.querySelectorAll('button')].some(b => /Reclamar/.test(b.textContent))`));
        if (mode === "desktop") {
          const h = await js<number>(c, "document.documentElement.scrollHeight");
          await js(c, `window.scrollTo(0, ${Math.round(h * 0.45)})`); await sleep(300);
          await c.tab.shot(join(SHOTS, `${scene}-${w}-mid.png`)).catch(() => null);
          await js(c, "window.scrollTo(0,0)");
        }
      }
      if (scene === "playoffs-anon") check(w, motion, scene, "anónimo: sin botones de pick", (await js<number>(c, `document.querySelectorAll('[data-match-id] button').length`)) === 0);
      if (scene === "void") check(w, motion, scene, "VOID dicho con texto", await js<boolean>(c, `/Anulado/.test(document.body.textContent)`));
    }
  } finally { await c.browser.close(); }
}

const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
async function serve(): Promise<() => void> {
  const { spawn } = await import("node:child_process");
  const port = new URL(BASE).port || "3087";
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", port, "-H", "127.0.0.1"], { env: { ...process.env, NEXUS_QA_HARNESS: "1" }, stdio: "ignore" });
  for (let i = 0; i < 80; i++) { try { if ((await fetch(`${BASE}/design-system/f87`)).status === 200) break; } catch { /* arrancando */ } await sleep(500); }
  return () => child.kill();
}
async function main() {
  const stop = process.argv.includes("--serve") ? await serve() : () => undefined;
  const motions = (arg("--motion") ? [arg("--motion")] : ["normal", "reduced"]) as ("normal" | "reduced")[];
  const widths = arg("--width") ? [Number(arg("--width"))] : [1440, 1024, 390];
  try { for (const motion of motions) for (const w of widths) await pass(w, motion); } finally { stop(); }
  const failed = checks.filter((c) => !c.ok);
  writeFileSync(join(OUT, `qa-${motions.join("+")}-${widths.join("+")}.json`), JSON.stringify({ base: BASE, at: new Date().toISOString(), total: checks.length, passed: checks.length - failed.length, failed: failed.length, checks }, null, 1));
  console.log(`\nF87 QA: ${checks.length - failed.length}/${checks.length}`);
  process.exitCode = failed.length ? 1 : 0;
}
void main();
