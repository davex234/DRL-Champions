/**
 * F81 · QA EN NAVEGADOR DE LA APERTURA CINEMÁTICA (instrumento, fuera de CI) — arnés `/design-system/fase81`.
 *
 *   BASE_URL=http://127.0.0.1:3081 npx tsx scripts/_f81-qa.ts            (servidor con NEXUS_QA_HARNESS=1)
 *
 * Por anchura (1440/1024/390) y movimiento (normal/reducido): flujo completo PACK → ABRIR → INTRO → TENSIÓN → HERO →
 * CONTINUAR → RESTO → RESUMEN, con la hero esperada (calculada aquí con el mismo dominio), tiempos, viewport, botones,
 * overflow y consola; omitir rápido; doble clic en ABRIR/CONTINUAR/OMITIR; F5 en la intro y con la hero; empates,
 * todas iguales, duplicado, una carta y OVR corrupto. Escribe docs/product/qa/f81-hero-reveal/.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openBrowser, sleep, type Client } from "./_fase68-lib";
import { CARDS, getCard, getPlayer } from "../src/data/catalog";
import { buildRevealPlan, toOpenedInstances, restRevealMs } from "../src/domain/packs/reveal";
import { f81Results, type F81Scene } from "../src/app/design-system/fase81/fixtures";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3081";
const OUT = join(process.cwd(), "docs/product/qa/f81-hero-reveal");
const SHOTS = join(OUT, "shots");
mkdirSync(SHOTS, { recursive: true });
const CAT = { cards: CARDS, getCard, getPlayer };
const rows: { w: number; motion: string; id: string; ok: boolean; detail: string }[] = [];
let fails = 0;
const check = (w: number, motion: string, id: string, ok: boolean, detail: unknown = "") => {
  const d = typeof detail === "string" ? detail : JSON.stringify(detail);
  rows.push({ w, motion, id, ok, detail: d.slice(0, 400) }); if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} [${w} ${motion}] ${id} ${d.slice(0, 200)}`);
};
const expected = (scene: F81Scene) => {
  const plan = buildRevealPlan(toOpenedInstances(f81Results(scene)), null, CAT);
  return { hero: plan.hero.ok ? plan.hero.hero.uid : null, order: plan.order.map((i) => i.uid), count: f81Results(scene).length, tied: plan.hero.ok ? plan.hero.tied.length : 0 };
};
const phase = (c: Client) => c.tab.js<string>(`document.querySelector('[data-testid="pack-opening"]')?.dataset.phase ?? ""`);
const opens = (c: Client) => c.tab.js<number>(`Number(sessionStorage.getItem('f81-opens') ?? '0')`);
async function load(c: Client, scene: F81Scene, reset = true) {
  await c.tab.goto(`${BASE}/design-system/fase81?scene=${scene}${reset ? "&reset=1" : ""}`, 1200);
  for (let i = 0; i < 60; i++) { if (await c.tab.js<boolean>(`!!document.querySelector('[data-testid="pack-opening"]')`)) break; await sleep(150); }
  await sleep(400);
}
async function waitPhase(c: Client, want: string[], ms: number): Promise<{ phase: string; t: number; seen: string[] }> {
  const t0 = Date.now(); const seen: string[] = [];
  while (Date.now() - t0 < ms) {
    const p = await phase(c);
    if (seen[seen.length - 1] !== p) seen.push(p);
    if (want.includes(p)) return { phase: p, t: Date.now() - t0, seen };
    await sleep(60);
  }
  return { phase: await phase(c), t: Date.now() - t0, seen };
}
const click = (c: Client, tid: string) => c.tab.js<boolean>(`(() => { const b = document.querySelector('[data-testid="${tid}"]'); if (!b) return false; b.click(); return true; })()`);
const dbl = (c: Client, tid: string) => c.tab.js<boolean>(`(() => { const b = document.querySelector('[data-testid="${tid}"]'); if (!b) return false; b.click(); b.click(); return true; })()`);
const layout = (c: Client) => c.tab.js<any>(`(() => {
  const vw = innerWidth, vh = innerHeight, r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { l: Math.round(b.left), t: Math.round(b.top), r: Math.round(b.right), b: Math.round(b.bottom), w: Math.round(b.width), h: Math.round(b.height) }; };
  return { vw, vh, overflowX: document.documentElement.scrollWidth - vw, card: r('[data-testid="hero-card-box"]'), cont: r('[data-testid="hero-continue"]'), skip: r('[data-testid="pack-skip"]'),
    info: document.querySelector('[data-testid="hero-info"]')?.innerText?.replace(/\\s+/g, ' ') ?? '', img: (() => { const i = document.querySelector('[data-testid="hero-reveal"] img[data-card-art]'); return i ? { complete: i.complete, nw: i.naturalWidth, src: i.getAttribute('src') } : null; })(),
    energy: !!document.querySelector('[data-testid="hero-energy"]'), still: !!document.querySelector('[data-testid="hero-still-glow"]'), nodes: document.querySelectorAll('[data-testid="pack-opening"] *').length };
})()`);
const inView = (b: any, vw: number, vh: number) => !!b && b.l >= -1 && b.t >= -1 && b.r <= vw + 1 && b.b <= vh + 1;
const summaryUids = (c: Client) => c.tab.js<string[]>(`[...document.querySelectorAll('[data-testid="summary-card"]')].map(e => e.dataset.uid)`);
const summaryHero = (c: Client) => c.tab.js<string>(`document.querySelector('[data-testid="summary-card"][data-hero="true"]')?.dataset.uid ?? ''`);
const hydration = (errs: string[]) => errs.filter((e) => /hydrat|did not match|server rendered HTML/i.test(e));
/**
 * El servidor LOCAL del arnés no tiene base de datos alcanzable: la sincronización de contenido del CMS (F60,
 * `/api/content/{agents,packs}`) responde 503 en CUALQUIER página. Es entorno, no F81: se descuenta exactamente una
 * línea «Failed to load resource … 503» por cada 503 de esas rutas capturado por CDP. Todo lo demás cuenta.
 */
const env503 = new WeakMap<Client, string[]>();
async function watchNet(c: Client) {
  const list: string[] = []; env503.set(c, list);
  await c.tab.send("Network.enable");
  c.tab.on("Network.responseReceived", (p: { response: { status: number; url: string } }) => { if (p.response.status >= 400) list.push(`${p.response.status} ${p.response.url}`); });
}
function realErrors(c: Client): string[] {
  const errs = c.tab.takeErrors();
  const net = env503.get(c) ?? [];
  const allowed = net.filter((u) => /^503 .*\/api\/content\/(agents|packs)$/.test(u)).length;
  const other = net.filter((u) => !/^503 .*\/api\/content\/(agents|packs)$/.test(u));
  net.length = 0;
  let skip = allowed;
  const out = errs.filter((e) => { if (skip > 0 && /Failed to load resource: the server responded with a status of 503/.test(e)) { skip--; return false; } return true; });
  return [...out, ...other.map((u) => `HTTP ${u}`)];
}
async function reload(c: Client) { await c.tab.send("Page.reload", { ignoreCache: false }); await sleep(2200); }

async function fullFlow(c: Client, w: number, motion: string, scene: F81Scene, shots: boolean) {
  const exp = expected(scene);
  await load(c, scene);
  realErrors(c);
  if (shots) await c.tab.shot(join(SHOTS, `${scene}-${w}-${motion}-0-ready.png`));
  const t0 = Date.now();
  await click(c, "pack-open");
  const intro = await waitPhase(c, ["buildup"], 6000);
  if (shots) await c.tab.shot(join(SHOTS, `${scene}-${w}-${motion}-1-buildup.png`));
  const hero = await waitPhase(c, ["hero_hold"], 8000);
  const toHold = Date.now() - t0;
  const heroUid = await c.tab.js<string>(`document.querySelector('[data-testid="hero-reveal"]')?.dataset.uid ?? ''`);
  const L = await layout(c);
  if (shots) await c.tab.shot(join(SHOTS, `${scene}-${w}-${motion}-2-hero.png`));
  check(w, motion, `${scene} · fases intro→tensión→hero en orden`, ["opening", "buildup", "hero", "hero_hold"].every((p) => [...intro.seen, ...hero.seen].includes(p)) && hero.phase === "hero_hold", [...intro.seen, ...hero.seen]);
  check(w, motion, `${scene} · hero = la esperada (mayor OVR; desempate fijo)`, heroUid === exp.hero, { heroUid, expected: exp.hero, tied: exp.tied });
  check(w, motion, `${scene} · abrir → hero quieta ≤ 4,5 s (intro+tensión ≤ 4 s + giro)`, toHold <= 4500, `${toHold} ms`);
  check(w, motion, `${scene} · hero entera en pantalla, CONTINUAR accesible (≥44 px), sin overflow`, inView(L.card, L.vw, L.vh) && inView(L.cont, L.vw, L.vh) && L.cont.h >= 44 && L.overflowX <= 0, { card: L.card, cont: L.cont, vw: L.vw, vh: L.vh, ox: L.overflowX });
  check(w, motion, `${scene} · ficha legible (OVR, jugador) y arte real cargado`, /OVR/.test(L.info) && !!L.img?.complete && L.img.nw > 0 && /\/cards\//.test(L.img.src), { info: L.info.slice(0, 120), img: L.img });
  check(w, motion, `${scene} · movimiento ${motion}: ${motion === "reduced" ? "sin energía/zoom; halo quieto" : "energía en la tensión"}`, motion === "reduced" ? !L.energy && L.still : true, { energy: L.energy, still: L.still });
  check(w, motion, `${scene} · DOM acotado`, L.nodes < 1500, `${L.nodes} nodos`);
  // CONTINUAR con doble clic: va al resto (no se salta las cartas).
  await dbl(c, "hero-continue");
  await sleep(150);
  const afterDbl = await phase(c);
  if (exp.count > 1) {
    check(w, motion, `${scene} · doble clic en CONTINUAR → resto (no encadena al resumen)`, afterDbl === "rest", afterDbl);
    await sleep(Math.min(900, restRevealMs(exp.count - 1, motion === "reduced")));
    const restUids = await c.tab.js<string[]>(`[...document.querySelectorAll('[data-testid="rest-card"]')].map(e => e.dataset.uid)`);
    const restOvr = await c.tab.js<number[]>(`[...document.querySelectorAll('[data-testid="rest-card"]')].map(e => Number(e.dataset.ovr))`);
    if (shots) await c.tab.shot(join(SHOTS, `${scene}-${w}-${motion}-3-rest.png`));
    const ox = await c.tab.js<number>(`document.documentElement.scrollWidth - innerWidth`);
    check(w, motion, `${scene} · resto = el sobre sin la hero, por OVR descendente, sin overflow`, JSON.stringify(restUids) === JSON.stringify(exp.order.slice(1)) && restOvr.every((o, i) => i === 0 || restOvr[i - 1] >= o) && ox <= 0, { restUids: restUids.length, ox });
  } else {
    check(w, motion, `${scene} · una carta: CONTINUAR → resumen directo`, afterDbl === "summary", afterDbl);
  }
  const sum = await waitPhase(c, ["summary"], restRevealMs(exp.count, motion === "reduced") + 3000);
  await sleep(500);
  const uids = await summaryUids(c);
  const sh = await summaryHero(c);
  if (shots) await c.tab.shot(join(SHOTS, `${scene}-${w}-${motion}-4-summary.png`));
  const ox = await c.tab.js<number>(`document.documentElement.scrollWidth - innerWidth`);
  check(w, motion, `${scene} · resumen: TODAS las cartas, hero primero y marcada, orden de presentación`, sum.phase === "summary" && JSON.stringify(uids) === JSON.stringify(exp.order) && sh === exp.hero && ox <= 0, { n: uids.length, hero: sh, ox });
  check(w, motion, `${scene} · una sola apertura`, (await opens(c)) === 1, await opens(c));
  // F5 en el resumen: la MISMA hero, sin reabrir.
  await reload(c); // F5 REAL (Page.reload): desde F40 un resumen ya visto solo vuelve al RECARGAR, no al navegar
  check(w, motion, `${scene} · F5 en el resumen: mismas cartas y misma hero, sin reabrir`, (await phase(c)) === "summary" && (await summaryHero(c)) === exp.hero && (await opens(c)) === 1, { phase: await phase(c), hero: await summaryHero(c), opens: await opens(c) });
  const errs = realErrors(c);
  check(w, motion, `${scene} · 0 errores de consola / hidratación`, errs.length === 0 && hydration(errs).length === 0, errs.slice(0, 3));
}

async function edgeCases(c: Client, w: number, motion: string) {
  // OMITIR inmediato: mismo resultado que el flujo completo.
  const exp = expected("tie2");
  await load(c, "tie2");
  realErrors(c);
  await click(c, "pack-open");
  await waitPhase(c, ["opening"], 4000);
  await dbl(c, "pack-skip"); await click(c, "pack-skip");
  await waitPhase(c, ["summary"], 3000); await sleep(400);
  check(w, motion, "OMITIR inmediato (×3): resumen con las MISMAS cartas y la MISMA hero; una apertura", JSON.stringify(await summaryUids(c)) === JSON.stringify(exp.order) && (await summaryHero(c)) === exp.hero && (await opens(c)) === 1, { hero: await summaryHero(c), opens: await opens(c) });
  // Doble clic en ABRIR: una sola petición.
  await load(c, "normal");
  await dbl(c, "pack-open");
  await sleep(300);
  const req = await c.tab.js<string>(`document.querySelector('[data-testid="pack-opening"]')?.dataset.requests ?? ''`);
  check(w, motion, "doble clic en ABRIR: una petición, una apertura", req === "1" && (await opens(c)) === 1, { requests: req, opens: await opens(c) });
  // F5 durante la INTRO: recupera el resultado guardado (sin segunda apertura) con la misma hero.
  await waitPhase(c, ["opening"], 3000);
  await reload(c);
  check(w, motion, "F5 durante la intro: resumen recuperado, misma hero, 0 aperturas nuevas", (await phase(c)) === "summary" && (await summaryHero(c)) === expected("normal").hero && (await opens(c)) === 1, { phase: await phase(c), opens: await opens(c) });
  // F5 con la hero en pantalla (empate): la MISMA de las empatadas.
  await load(c, "tie2");
  await click(c, "pack-open");
  await waitPhase(c, ["hero_hold"], 8000);
  const before = await c.tab.js<string>(`document.querySelector('[data-testid="hero-reveal"]')?.dataset.uid ?? ''`);
  await reload(c);
  check(w, motion, "F5 con la hero (empate): la misma de las empatadas, sin reabrir", before === exp.hero && (await summaryHero(c)) === before && (await opens(c)) === 1, { before, after: await summaryHero(c), opens: await opens(c) });
  // Toque en la intro → HERO (no al resumen); ENTER con la hero quieta → resto.
  await load(c, "normal");
  await click(c, "pack-open");
  await waitPhase(c, ["opening"], 3000);
  await click(c, "intro-advance");
  await sleep(120);
  const p1 = await phase(c);
  check(w, motion, "toque en la intro adelanta a la HERO, no al resumen", p1 === "hero" || p1 === "hero_hold", p1);
  const errs = realErrors(c);
  check(w, motion, "casos límite · 0 errores de consola", errs.length === 0, errs.slice(0, 3));
}

async function invalidScene(c: Client, w: number, motion: string) {
  await load(c, "invalid");
  realErrors(c);
  await click(c, "pack-open");
  const r = await waitPhase(c, ["summary"], 4000);
  await sleep(400);
  const notice = await c.tab.js<boolean>(`!!document.querySelector('[data-testid="summary-no-cinematic"]')`);
  const n = (await summaryUids(c)).length;
  const errs = realErrors(c);
  const noticeText = await c.tab.js<string>(`document.querySelector('[data-testid="summary-no-cinematic"]')?.innerText ?? ''`);
  check(w, motion, "carta corrupta (fuera del catálogo): sin cinemática, resumen de las resolubles, aviso con el recuento y error registrado", r.phase === "summary" && !r.seen.includes("hero") && notice && n === 2 && /Una carta no se pudo mostrar/.test(noticeText) && errs.some((e) => /hero no presentable/.test(e)) && errs.length === 1, { seen: r.seen, notice: noticeText.slice(0, 120), n, errs });
}

/** `--motion normal|reduced --width 1440|1024|390` limitan la pasada; `--serve` arranca SU propio `next start` (hijo). */
const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
async function serve(): Promise<() => void> {
  const { spawn } = await import("node:child_process");
  const port = new URL(BASE).port || "3081";
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", port, "-H", "127.0.0.1"], { env: { ...process.env, NEXUS_QA_HARNESS: "1" }, stdio: "ignore" });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${BASE}/design-system/fase81`)).status === 200) break; } catch { /* arrancando */ } await sleep(500); }
  return () => child.kill();
}
async function main() {
  const t0 = Date.now();
  const stop = process.argv.includes("--serve") ? await serve() : () => undefined;
  const motions = (arg("--motion") ? [arg("--motion")] : ["normal", "reduced"]) as ("normal" | "reduced")[];
  const widths = arg("--width") ? [Number(arg("--width"))] : [1440, 1024, 390];
  try {
  for (const motion of motions) {
    for (const w of widths) {
      const c = await openBrowser("A", w, { reduced: motion === "reduced", label: `f81-${motion}` });
      await watchNet(c);
      try {
        for (const scene of (motion === "normal" ? ["normal", "high", "tie2", "tieall", "dup", "single"] : ["normal", "tie2", "high"]) as F81Scene[]) {
          await fullFlow(c, w, motion, scene, scene === "normal" || scene === "high" || (scene === "tie2" && w === 390));
        }
        await edgeCases(c, w, motion);
        if (motion === "normal") await invalidScene(c, w, motion);
      } finally { await c.browser.close(); }
    }
  }
  } finally { stop(); }
  const tag = `${motions.join("+")}-${widths.join("+")}`;
  writeFileSync(join(OUT, `browser-qa-${tag}.json`), JSON.stringify({ at: new Date().toISOString(), base: BASE, seconds: Math.round((Date.now() - t0) / 1000), fails, rows }, null, 1) + "\n");
  console.log(`f81 browser QA: ${rows.length - fails}/${rows.length} (${Math.round((Date.now() - t0) / 1000)} s)`);
  process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
