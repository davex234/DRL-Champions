/**
 * F83 · QA EN NAVEGADOR DE LA RUTA DE TEMPORADA (instrumento, fuera de CI) — arnés `/design-system/fase83`.
 *
 *   BASE_URL=http://127.0.0.1:3083 npx tsx scripts/_f83-qa.ts --serve [--width 390]
 *
 * Por anchura (1440/1024/390) y movimiento (normal/reducido): activa, reclamable, nueva, máximo, gracia, programada,
 * sin temporada, post-partida, subida de nivel (una y varias). Desbordamiento de PÁGINA (el carril sí se desplaza por
 * dentro), consola, h1, botones de reclamo = reclamables, carril con teclado, diálogo con foco y Escape, táctil ≥ 44 px.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openBrowser, sleep, type Client } from "./_fase68-lib";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3083";
const OUT = join(process.cwd(), "docs/product/qa/f83-season-track");
const SHOTS = join(OUT, "shots");
mkdirSync(SHOTS, { recursive: true });
interface Check { w: number; motion: string; scene: string; name: string; ok: boolean; detail?: unknown }
const checks: Check[] = [];
const check = (w: number, motion: string, scene: string, name: string, ok: boolean, detail?: unknown) => { checks.push({ w, motion, scene, name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} [${w} ${motion}] ${scene} · ${name}${ok ? "" : ` ${JSON.stringify(detail)}`}`); };
const js = <T,>(c: Client, s: string) => c.tab.js<T>(s);
const errs = (c: Client) => c.tab.takeErrors().filter((e) => !/Failed to load resource: the server responded with a status of (401|503)/.test(e) && !/api\/content\//.test(e));
const SCENES = ["active", "claim", "fresh", "max", "grace", "scheduled", "none", "postmatch", "levelup", "multilevel"] as const;

async function open(c: Client, scene: string) {
  c.tab.takeErrors();
  await c.tab.goto(`${BASE}/design-system/fase83?scene=${scene}`, 1500);
  for (let i = 0; i < 60; i++) { if (await js<boolean>(c, `document.querySelector('main[data-harness="fase83"]')?.dataset.scene === ${JSON.stringify(scene)}`).catch(() => false)) break; await sleep(150); }
  await js(c, "document.fonts && document.fonts.ready").catch(() => null);
  await sleep(500);
}

async function pass(w: number, motion: "normal" | "reduced") {
  const c = await openBrowser("QA", w, { reduced: motion === "reduced", label: `f83-${w}-${motion}` });
  try {
    for (const scene of SCENES) {
      if (motion === "reduced" && !["active", "levelup", "multilevel"].includes(scene)) continue;
      await open(c, scene);
      const ox = await js<number>(c, "document.documentElement.scrollWidth - window.innerWidth");
      check(w, motion, scene, "sin desbordamiento horizontal de la página", ox <= 0, ox);
      const e = errs(c); check(w, motion, scene, "consola limpia", e.length === 0, e);
      const noAlt = await js<number>(c, "[...document.querySelectorAll('img')].filter(i => !i.hasAttribute('alt')).length");
      check(w, motion, scene, "toda imagen con alt", noAlt === 0, noAlt);
      if (["active", "claim", "fresh", "max", "grace", "scheduled"].includes(scene)) {
        check(w, motion, scene, "un solo h1", (await js<number>(c, "document.querySelectorAll('h1').length")) === 1);
        const rail = await js<{ sw: number; cw: number; focusable: boolean; nodes: number }>(c, `(() => { const r = document.querySelector('[data-testid="season-track"] [role="region"]'); return { sw: r.scrollWidth, cw: r.clientWidth, focusable: r.tabIndex === 0, nodes: r.querySelectorAll('li[data-level]').length }; })()`);
        check(w, motion, scene, "carril: 40 niveles, se desplaza por DENTRO y es enfocable", rail.nodes === 40 && rail.sw > rail.cw && rail.focusable, rail);
        const claims = await js<number>(c, `document.querySelectorAll('[data-action="claim"]').length`);
        const avail = await js<number>(c, `document.querySelectorAll('li[data-state="AVAILABLE"]').length`);
        check(w, motion, scene, "un botón RECLAMAR por nivel disponible", claims === avail, { claims, avail });
        const small = await js<string[]>(c, `[...document.querySelectorAll('[data-action="claim"], [data-testid="claimable-banner"]')].filter(b => b.getBoundingClientRect().height < 44).map(b => b.textContent.trim())`);
        check(w, motion, scene, "objetivos táctiles ≥ 44 px", small.length === 0, small);
        if (scene === "claim" && motion === "normal") {
          await js(c, `document.querySelector('[data-action="claim"]').click()`); await sleep(150);
          check(w, motion, scene, "reclamar: estado «Reclamando…» y botones bloqueados (sin doble clic)", await js<boolean>(c, `[...document.querySelectorAll('[data-action="claim"]')].every(b => b.disabled) && document.body.textContent.includes('Reclamando')`));
          await sleep(900);
        }
        if (scene === "active") {
          const cur = await js<boolean>(c, `(() => { const r = document.querySelector('[data-testid="season-track"] [role="region"]'); const n = r.querySelector('li[data-current="1"]'); const a = r.getBoundingClientRect(), b = n.getBoundingClientRect(); return b.left >= a.left - 1 && b.right <= a.right + 1; })()`);
          check(w, motion, scene, "el nivel actual queda visible dentro del carril", cur);
        }
      }
      if (scene === "levelup" || scene === "multilevel") {
        await sleep(300);
        const dlg = await js<boolean>(c, `!!document.querySelector('[role="dialog"][aria-modal="true"]')`);
        check(w, motion, scene, "subida de nivel: un diálogo", dlg && (await js<number>(c, `document.querySelectorAll('[data-testid="season-levelup"]').length`)) === 1);
        if (dlg) {
          check(w, motion, scene, "foco dentro del diálogo", await js<boolean>(c, `!!document.activeElement?.closest('[role="dialog"]')`));
          if (scene === "multilevel") check(w, motion, scene, "varios niveles: «+3 niveles» en UNA celebración", await js<boolean>(c, `document.querySelector('[data-testid="season-levelup"]').textContent.includes('+3 niveles')`));
          await c.tab.shot(join(SHOTS, `${scene}-${w}-${motion}.png`)).catch(() => null);
          await c.tab.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
          await c.tab.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
          await sleep(300);
          check(w, motion, scene, "Escape cierra", !(await js<boolean>(c, `!!document.querySelector('[data-testid="season-levelup"]')`)));
        }
      }
      if (!["levelup", "multilevel"].includes(scene) || motion === "normal") {
        await c.tab.shot(join(SHOTS, `${scene}-${w}-${motion}.png`)).catch(() => null);
        if (["active", "claim"].includes(scene) && motion === "normal") {
          const h = await js<number>(c, "document.documentElement.scrollHeight");
          await js(c, `window.scrollTo(0, ${Math.round(h * 0.5)})`); await sleep(300);
          await c.tab.shot(join(SHOTS, `${scene}-${w}-${motion}-mid.png`)).catch(() => null);
          await js(c, "window.scrollTo(0,0)");
        }
      }
    }
  } finally { await c.browser.close(); }
}

const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
async function serve(): Promise<() => void> {
  const { spawn } = await import("node:child_process");
  const port = new URL(BASE).port || "3083";
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", port, "-H", "127.0.0.1"], { env: { ...process.env, NEXUS_QA_HARNESS: "1" }, stdio: "ignore" });
  for (let i = 0; i < 80; i++) { try { if ((await fetch(`${BASE}/design-system/fase83`)).status === 200) break; } catch { /* arrancando */ } await sleep(500); }
  return () => child.kill();
}
async function main() {
  const stop = process.argv.includes("--serve") ? await serve() : () => undefined;
  const motions = (arg("--motion") ? [arg("--motion")] : ["normal", "reduced"]) as ("normal" | "reduced")[];
  const widths = arg("--width") ? [Number(arg("--width"))] : [1440, 1024, 390];
  try { for (const motion of motions) for (const w of widths) await pass(w, motion); } finally { stop(); }
  const failed = checks.filter((c) => !c.ok);
  writeFileSync(join(OUT, `qa-${motions.join("+")}-${widths.join("+")}.json`), JSON.stringify({ base: BASE, at: new Date().toISOString(), total: checks.length, passed: checks.length - failed.length, failed: failed.length, checks }, null, 1));
  console.log(`\nF83 QA: ${checks.length - failed.length}/${checks.length}`);
  process.exitCode = failed.length ? 1 : 0;
}
void main();
