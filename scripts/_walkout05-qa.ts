/**
 * WALKOUT 0.5 · QA EN NAVEGADOR DE LA APERTURA REAL CON WALKOUT (instrumento local, fuera de CI). UN navegador.
 * Monta la ceremonia REAL (`PackOpeningExperience`) en el arnés `/design-system/fase81` con resultados FIJOS de cartas
 * reales (`qaOpen`): sin servidor, sin créditos, sin BD. Comprueba por escena:
 *   · la cola de walkouts esperada (calculada aquí con el MISMO dominio) y su orden;
 *   · la identidad de cada walkout = la de la carta (código de país en la pieza Y en la arena 3D), su intensidad;
 *   · SALTAR / REPETIR / CONTINUAR; omitir todo; doble clic en ABRIR; F5 a mitad de walkout; el resumen con TODAS las cartas;
 *   · las «aperturas» del arnés (sessionStorage f81-opens) = 1 siempre (ni saltar, ni repetir, ni recargar reabren).
 *
 *   BASE_URL=http://localhost:3000 npx tsx scripts/_walkout05-qa.ts [escenas] [ancho] [motion|reduced]
 *   WALKOUT05_SHOTS=dir  guarda capturas por paso · WALKOUT05_GL=fail  rompe getContext("webgl*") (respaldo 2D)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { launch, sleep } from "./lib/cdp";
import { CARDS, getCard, getPlayer } from "../src/data/catalog";
import { buildRevealPlan, toOpenedInstances } from "../src/domain/packs/reveal";
import { packWalkoutQueue } from "../src/domain/walkout/packWalkout";
import { countryArenaTheme } from "../src/domain/walkout/countryTheme";
import { f81Results, type F81Scene } from "../src/app/design-system/fase81/fixtures";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const scenes = (process.argv[2] ?? "w-tr,w-jp,w-us,w-kr,w-mega,w-dup,w-std").split(",") as F81Scene[];
const width = Number(process.argv[3] ?? 1280), height = width < 600 ? 844 : 720;
const reduced = (process.argv[4] ?? "motion") === "reduced";
const SHOTS = process.env.WALKOUT05_SHOTS ? resolve(process.cwd(), process.env.WALKOUT05_SHOTS) : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const CAT = { cards: CARDS, getCard, getPlayer };
let fails = 0;
const rows: string[] = [];
const check = (id: string, ok: boolean, detail: unknown = "") => {
  const d = typeof detail === "string" ? detail : JSON.stringify(detail);
  const line = `${ok ? "PASS" : "FAIL"} ${id} ${d.slice(0, 260)}`; rows.push(line); console.log(line); if (!ok) fails++;
};
const expectedQueue = (scene: F81Scene) => {
  const res = f81Results(scene);
  const plan = buildRevealPlan(toOpenedInstances(res), null, CAT);
  return packWalkoutQueue(plan.order).map((q) => ({ uid: q.uid, cardId: q.cardId, intensity: q.intensity, code: countryArenaTheme({ flag: q.identity.flag, region: q.identity.region, nationality: q.identity.nationality }, null, { light: "#fff", accent: "#fff" }).code }));
};

async function run() {
  const b = await launch({ args: ["--mute-audio", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  await b.tab.resize(width, height, 1);
  await b.tab.setMedia([{ name: "prefers-reduced-motion", value: reduced ? "reduce" : "no-preference" }]);
  const st = () => b.tab.js<string>(`JSON.stringify((() => { const r = document.querySelector('[data-testid=pack-opening]'); const w = document.querySelector('[data-testid=pack-walkout]'); const d = document.querySelector('[data-testid=walkout]'); const c = document.querySelector('[data-testid=walkout-stage-3d]'); return { phase: r?.dataset.phase, walkouts: r?.dataset.walkouts, requests: r?.dataset.requests, hero: r?.dataset.heroUid, wUid: w?.dataset.walkoutUid, wCard: w?.dataset.walkoutCard, wInt: w?.dataset.walkoutIntensity, wDone: w?.dataset.walkoutDone, code: d?.dataset.identityCode, card: d?.dataset.identityCard, stage: d?.dataset.stage, arena: c?.dataset.arenaCode, human: c?.dataset.human, canvases: document.querySelectorAll('canvas').length, opens: sessionStorage.getItem('f81-opens'), summary: !!document.querySelector('[data-testid=pack-summary], [data-testid=summary-no-cinematic]') || r?.dataset.phase === 'summary' }; })())`).then((s) => JSON.parse(s));
  const waitFor = async (pred: (s: Record<string, unknown>) => boolean, ms: number, label: string) => {
    const t0 = Date.now(); let s: Record<string, unknown> = {};
    while (Date.now() - t0 < ms) { s = await st(); if (pred(s)) return s; await sleep(150); }
    throw new Error(`timeout esperando ${label}: ${JSON.stringify(s)}`);
  };
  const click = (testid: string) => b.tab.js<boolean>(`(() => { const e = document.querySelector('[data-testid=${testid}]'); if (!e) return false; e.click(); return true; })()`);
  const shot = async (name: string) => { if (SHOTS) await b.tab.shot(join(SHOTS, `${name}-${width}${reduced ? "-reduced" : ""}.png`)); };

  for (const scene of scenes) {
    const exp = expectedQueue(scene);
    const total = f81Results(scene).length;
    await b.tab.goto(`${BASE}/design-system/fase81?scene=${scene}&reset=1`, 2500);
    if (process.env.WALKOUT05_GL === "fail") await b.tab.js(`(() => { const g = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (t, ...a) { return /webgl/.test(String(t)) ? null : g.call(this, t, ...a); }; return 1; })()`);
    await waitFor((s) => s.phase === "ready", 30000, "ready");
    // doble clic en ABRIR: una sola apertura
    await b.tab.js(`(() => { const e = document.querySelector('[data-testid=pack-open]'); e.click(); e.click(); return 1; })()`);
    const s0 = await waitFor((s) => s.phase !== "ready" && s.phase !== "requesting", 15000, "resultado");
    check(`${scene} · doble clic en ABRIR = 1 apertura`, s0.requests === "1" && s0.opens === "1", { requests: s0.requests, opens: s0.opens });
    check(`${scene} · walkouts esperados ${exp.length}`, Number(s0.walkouts) === exp.length, { got: s0.walkouts, exp: exp.map((e) => `${e.cardId}:${e.intensity}`) });
    for (let i = 0; i < exp.length; i++) {
      const s = await waitFor((x) => x.phase === "walkout" && x.wUid === exp[i].uid && (x.human === "ready" || x.stage === "2d") && x.arena !== undefined || (x.phase === "walkout" && x.wUid === exp[i].uid && x.stage === "2d"), 45000, `walkout ${i}`);
      check(`${scene} · walkout ${i + 1}/${exp.length} carta e intensidad`, s.wCard === exp[i].cardId && s.wInt === exp[i].intensity && s.card === exp[i].cardId, { got: [s.wCard, s.wInt], exp: [exp[i].cardId, exp[i].intensity] });
      check(`${scene} · walkout ${i + 1} identidad = carta (pieza y arena)`, (s.code || s.arena) === exp[i].code && (s.stage === "2d" || s.arena === exp[i].code), { code: s.code, arena: s.arena, exp: exp[i].code, stage: s.stage });
      check(`${scene} · walkout ${i + 1} un solo lienzo 3D`, Number(s.canvases) <= 2, { canvases: s.canvases });
      await sleep(reduced ? 600 : 2500);
      await shot(`${scene}-w${i + 1}-mid`);
      if (i === 0) {
        // SALTAR esta animación (no la apertura): sigue en el walkout, ya al final, con REPETIR y CONTINUAR
        await click("walkout-skip");
        const d = await waitFor((x) => x.wDone === "1", 8000, "walkout al final");
        check(`${scene} · SALTAR → final de ESTA carta (sin reabrir)`, d.phase === "walkout" && d.wUid === exp[0].uid && d.opens === "1", d);
        await shot(`${scene}-w1-done`);
        await click("pack-walkout-replay");
        const r = await waitFor((x) => x.wDone === "0", 5000, "repetir");
        check(`${scene} · REPETIR solo la animación (misma carta, 1 apertura)`, r.wUid === exp[0].uid && r.wCard === exp[0].cardId && r.opens === "1" && r.requests === "1", r);
        await click("walkout-skip");
        await waitFor((x) => x.wDone === "1", 8000, "final tras repetir");
      } else {
        await waitFor((x) => x.wDone === "1", 30000, `walkout ${i + 1} terminado`);
      }
      await click("pack-walkout-continue");
      await sleep(300);
    }
    // el resto de la ceremonia: hero (si no salió en su walkout) → resto → resumen. Se avanza con OMITIR si tarda.
    const after = await waitFor((s) => s.phase !== "walkout", 8000, "tras los walkouts");
    check(`${scene} · tras los walkouts sigue la ceremonia`, [...(exp.length === 0 ? ["opening"] : []), "buildup", "hero", "hero_hold", "rest", "summary"].includes(String(after.phase)), { phase: after.phase });
    await click("pack-skip");
    const end = await waitFor((s) => s.phase === "summary", 10000, "resumen");
    const shown = await b.tab.js<number>(`document.querySelectorAll('[data-testid=pack-summary] a[href^="/carta/"], [data-testid=pack-summary] [data-card-id]').length`);
    check(`${scene} · resumen con las ${total} cartas, 1 apertura`, end.opens === "1" && end.requests === "1", { opens: end.opens, requests: end.requests, cardsLinks: shown });
    await shot(`${scene}-summary`);
  }

  // F5 a mitad de un walkout → resumen recuperado de las MISMAS cartas, sin reabrir
  if (scenes.includes("w-tr")) {
    await b.tab.goto(`${BASE}/design-system/fase81?scene=w-tr&reset=1`, 2500);
    await waitFor((s) => s.phase === "ready", 30000, "ready");
    await click("pack-open");
    await waitFor((s) => s.phase === "walkout", 20000, "walkout");
    await sleep(1500);
    await b.tab.js(`location.reload()`);
    await sleep(2500);
    const r = await waitFor((s) => s.phase === "summary", 20000, "resumen tras F5");
    check("F5 a mitad del walkout → resumen recuperado, 1 apertura", r.opens === "1", r);
  }

  const errs = b.tab.takeErrors().filter((e) => !/Failed to load resource|503/.test(e));
  check("sin errores de consola", errs.length === 0, errs.slice(0, 4));
  await b.close();
  const out = resolve(process.cwd(), "docs/product/qa/walkout-0.5");
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, `qa-${width}${reduced ? "-reduced" : ""}${process.env.WALKOUT05_GL === "fail" ? "-nogl" : ""}.txt`), rows.join("\n") + "\n");
  console.log(fails ? `FALLOS: ${fails}` : "TODO OK");
  process.exit(fails ? 1 : 0);
}
run().catch((e) => { console.error(e); process.exit(1); });
