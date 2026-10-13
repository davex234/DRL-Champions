/**
 * F84 · QA EN NAVEGADOR DEL RANKED 2.0 (instrumento, fuera de CI) — arnés `/design-system/f84` (QA SYNTHETIC).
 *
 *   BASE_URL=http://127.0.0.1:3184 npx tsx scripts/_f84-qa.ts --serve [--width 390] [--motion reduced]
 *
 * Por anchura (1440/1024/390) y movimiento (normal/reducido): centro competitivo en cada estado (sin clasificar,
 * colocación, bajo, medio, alto, Cumbre, fuera del Top, clasificación vacía, nombre largo, tu zona), resultados (colocación,
 * rango obtenido, ascenso de división / tier / a la Cumbre, descenso, misma división, tope de pareja), clasificación,
 * emblemas, leyenda y perfil. Comprueba desbordamiento de PÁGINA, consola, h1, textos clave, foco por teclado, objetivos
 * táctiles y que la ceremonia anima (normal) o NO anima (reducido) con la misma información.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openBrowser, sleep, type Client } from "./_fase68-lib";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3184";
const OUT = join(process.cwd(), "docs/product/qa/f84-ranked");
const SHOTS = join(OUT, "shots");
mkdirSync(SHOTS, { recursive: true });
interface Check { w: number; motion: string; scene: string; name: string; ok: boolean; detail?: unknown }
const checks: Check[] = [];
const check = (w: number, motion: string, scene: string, name: string, ok: boolean, detail?: unknown) => { checks.push({ w, motion, scene, name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} [${w} ${motion}] ${scene} · ${name}${ok ? "" : ` ${JSON.stringify(detail)}`}`); };
const js = <T,>(c: Client, s: string) => c.tab.js<T>(s);
const errs = (c: Client) => c.tab.takeErrors().filter((e) => !/Failed to load resource: the server responded with a status of (401|503)/.test(e) && !/api\/content\//.test(e));

/** Escena → textos que DEBEN verse (textContent, no innerText: el text-transform pone mayúsculas). */
const SCENES: Record<string, string[]> = {
  "hub-unranked": ["Sin clasificar", "Juega 5 partidas ranked"],
  "hub-placement-4": ["Colocación", "4 / 5", "Te falta 1 partida"],
  "hub-low": ["Cantera", "Clasificación · Top 500"],
  "hub-mid": ["Titular", "#212", "de rating para Titular I"],
  "hub-high": ["Estrella", "#18"],
  "hub-cumbre": ["Cumbre", "Top 500 · #3", "Estás en la Cumbre"],
  "hub-stale": ["Veterano", "Para entrar en el Top 500"],
  "hub-empty": ["Todavía no hay nadie en el Top esta temporada"],
  "hub-long-name": ["QA_Nombre_De_Jugador_Larguisimo_Extremo"],
  "hub-around": ["Tu zona", "Tú: #124"],
  "result-placement-1": ["Colocación", "1 / 5"],
  "result-placement-4": ["4 / 5", "Una partida más y se revela tu rango"],
  "result-reveal": ["Rango obtenido", "Veterano II"],
  "result-promotion": ["Ascenso", "Titular I", "desde Titular II"],
  "result-promotion-tier": ["Ascenso", "Estrella III", "desde Capitán I"],
  "result-promotion-cumbre": ["Ascenso", "Cumbre"],
  "result-demotion": ["Descenso", "Promesa I"],
  "result-same": ["Titular II", "+8"],
  "result-same-loss": ["Titular II", "-12"],
  "result-pair-cap": ["Partida contada sin cambio de rating"],
  "ladder-top": ["Clasificación · Top 500"],
  "ladder-around": ["Tu zona"],
  "emblems": ["Cantera III", "Cumbre", "Colocación 3/5", "Sin clasificar"],
  "legend": ["Cómo funcionan los rangos", "≥ 1310"],
  "profile-own": ["Rango", "Rating"],
  "profile-ranked": ["Cumbre", "Mejor rango · temporada"],
  "profile-placement": ["Colocación 3/5"],
};
const REDUCED = ["hub-mid", "hub-cumbre", "result-reveal", "result-promotion-tier", "result-demotion", "profile-ranked"];

async function open(c: Client, scene: string, extra = "") {
  c.tab.takeErrors();
  await c.tab.goto(`${BASE}/design-system/f84?scene=${scene}${extra}`, 1200);
  for (let i = 0; i < 60; i++) { if (await js<boolean>(c, `document.querySelector('[data-qa-scene]')?.getAttribute('data-qa-scene') === ${JSON.stringify(scene)}`).catch(() => false)) break; await sleep(150); }
  await js(c, "document.fonts && document.fonts.ready").catch(() => null);
  await sleep(450);
}

async function pass(w: number, motion: "normal" | "reduced") {
  const c = await openBrowser("QA", w, { reduced: motion === "reduced", label: `f84-${w}-${motion}` });
  try {
    for (const [scene, must] of Object.entries(SCENES)) {
      if (motion === "reduced" && !REDUCED.includes(scene)) continue;
      await open(c, scene, motion === "reduced" ? "&reduced=1" : "");
      const ox = await js<number>(c, "document.documentElement.scrollWidth - window.innerWidth");
      check(w, motion, scene, "sin desbordamiento horizontal de la página", ox <= 0, ox);
      const e = errs(c); check(w, motion, scene, "consola limpia", e.length === 0, e);
      const txt = await js<string>(c, "document.body.textContent.replace(/\\s+/g, ' ')");
      const missing = must.filter((m) => !txt.includes(m));
      check(w, motion, scene, "textos clave visibles", missing.length === 0, missing);
      check(w, motion, scene, "sin correos en pantalla", !/@[a-z0-9-]+\.[a-z]{2,}/i.test(txt));
      if (scene.startsWith("hub-")) {
        check(w, motion, scene, "un solo h1", (await js<number>(c, "document.querySelectorAll('h1').length")) === 1);
        const emb = await js<string | null>(c, `document.querySelector('[data-scene="ranked-hero"] [data-testid="competitive-emblem"]')?.getAttribute('aria-label') ?? null`);
        check(w, motion, scene, "emblema del héroe con nombre accesible", !!emb, emb);
        const cta = await js<{ h: number; n: number } | null>(c, `(() => { const b = document.querySelectorAll('[data-scene="ranked-center"] [data-cta="primary"]'); return b.length ? { h: b[0].getBoundingClientRect().height, n: b.length } : null; })()`);
        check(w, motion, scene, "un CTA de juego, táctil ≥ 44 px", !!cta && cta.n === 1 && cta.h >= 44, cta);
        const nameOverflow = await js<number>(c, `[...document.querySelectorAll('[data-testid="ranked-ladder"] a')].filter(a => a.scrollWidth > a.clientWidth + 1 && !a.querySelector('.truncate')).length`);
        check(w, motion, scene, "nombres largos truncados dentro de su fila", nameOverflow === 0, nameOverflow);
      }
      if (scene === "legend") {
        await js(c, `document.querySelector('[data-testid="rank-legend"] summary').focus()`);
        check(w, motion, scene, "leyenda enfocable por teclado (summary)", await js<boolean>(c, `document.activeElement?.tagName === 'SUMMARY'`));
      }
      if (scene.startsWith("result-") && scene !== "result-placement-1") {
        const kind = await js<string | null>(c, `document.querySelector('[data-testid="rank-change"]')?.getAttribute('data-kind') ?? null`);
        check(w, motion, scene, "bloque de cambio de rango presente", !!kind, kind);
        if (motion === "reduced") check(w, motion, scene, "movimiento reducido: sin animar, misma información", await js<string | null>(c, `document.querySelector('[data-testid="rank-change"]')?.getAttribute('data-animated') ?? null`) === "false");
      }
      await c.tab.shot(join(SHOTS, `${scene}-${w}-${motion}.png`)).catch(() => null);
    }
    // Ceremonias animadas (solo normal): fotogramas y estado final idénticos al estático.
    if (motion === "normal") {
      for (const scene of ["result-promotion-tier", "result-reveal"]) {
        await open(c, scene, "&animate=1");
        const animated = await js<string | null>(c, `document.querySelector('[data-testid="rank-change"]')?.getAttribute('data-animated') ?? null`);
        check(w, motion, scene, "ceremonia: se anima la primera vez", animated === "true", animated);
        await sleep(250); await c.tab.shot(join(SHOTS, `${scene}-${w}-anim-1.png`)).catch(() => null);
        await sleep(900); await c.tab.shot(join(SHOTS, `${scene}-${w}-anim-2.png`)).catch(() => null);
        await sleep(2600);
        await c.tab.shot(join(SHOTS, `${scene}-${w}-anim-3.png`)).catch(() => null);
        const label = await js<string>(c, `document.querySelector('[data-field="rank-label"]')?.textContent ?? ''`);
        check(w, motion, scene, "ceremonia termina en el rango final (≤ 4 s)", label === (scene === "result-reveal" ? "Veterano II" : "Estrella III"), label);
      }
    }
  } finally { await c.browser.close(); }
}

const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
async function serve(): Promise<() => void> {
  const { spawn } = await import("node:child_process");
  const port = new URL(BASE).port || "3184";
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", port, "-H", "127.0.0.1"], { env: { ...process.env, NEXUS_QA_HARNESS: "1" }, stdio: "ignore" });
  for (let i = 0; i < 80; i++) { try { if ((await fetch(`${BASE}/design-system/f84`)).status === 200) break; } catch { /* arrancando */ } await sleep(500); }
  return () => child.kill();
}
async function main() {
  const stop = process.argv.includes("--serve") ? await serve() : () => undefined;
  const motions = (arg("--motion") ? [arg("--motion")] : ["normal", "reduced"]) as ("normal" | "reduced")[];
  const widths = arg("--width") ? [Number(arg("--width"))] : [1440, 1024, 390];
  try { for (const motion of motions) for (const w of widths) await pass(w, motion); } finally { stop(); }
  const failed = checks.filter((c) => !c.ok);
  writeFileSync(join(OUT, `qa-${motions.join("+")}-${widths.join("+")}.json`), JSON.stringify({ base: BASE, at: new Date().toISOString(), total: checks.length, passed: checks.length - failed.length, failed: failed.length, checks }, null, 1));
  console.log(`\nF84 QA: ${checks.length - failed.length}/${checks.length}`);
  process.exitCode = failed.length ? 1 : 0;
}
void main();
