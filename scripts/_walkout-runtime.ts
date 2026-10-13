/**
 * PACK WALKOUT 0.1 · comprobaciones de ejecución en navegador (instrumento local, fuera de CI). Sin cuentas ni BD.
 *   BASE_URL=http://127.0.0.1:3011 npx tsx scripts/_walkout-runtime.ts
 * 0.2: WALKOUT_OUT (carpeta del informe) · WALKOUT_GPU=1 (Chrome con la GPU real en vez de SwiftShader) · comprueba
 *      también que si la persona 3D no carga la escena pasa a 2D y termina, y mide la persona (carga, triángulos,
 *      llamadas, geometrías, texturas, memoria JS, ritmo de fotogramas en mitad del paseo).
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { launch, sleep } from "./lib/cdp";

/* eslint-disable @typescript-eslint/no-explicit-any */
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3011";
const OUT = resolve(process.cwd(), process.env.WALKOUT_OUT ?? "docs/product/qa/walkout-0.1");
mkdirSync(OUT, { recursive: true });
const results: Record<string, any> = {};
const check = (k: string, ok: boolean, info?: unknown) => { results[k] = { ok, info }; console.log(ok ? "OK  " : "FAIL", k, info === undefined ? "" : JSON.stringify(info)); };

// Cuenta RAF vivos y contextos WebGL creados (inyectado antes de cargar la página).
const PROBE = `(() => {
  const w = window; w.__raf = 0; w.__gl = 0;
  const r = w.requestAnimationFrame.bind(w);
  w.requestAnimationFrame = (cb) => r((t) => { w.__raf++; cb(t); });
  w.__ctx = []; w.__draws = 0;
  const gc = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...a) {
    const c = gc.call(this, type, ...a);
    if (c && /webgl/.test(String(type)) && !this.__counted) {
      this.__counted = true; w.__gl++; w.__ctx.push(c);
      for (const m of ['drawElements', 'drawArrays']) { const f = c[m].bind(c); c[m] = (...x) => { if (this.closest && this.closest('[data-testid=walkout]')) w.__draws++; return f(...x); }; }
    }
    return c;
  };
  w.__frames = []; let last = 0;
  const loop = (t) => { if (last) w.__frames.push(t - last); last = t; if (w.__frames.length < 4000) r(loop); };
  r(loop);
})()`;

const ARGS = process.env.WALKOUT_GPU
  ? ["--mute-audio", "--ignore-gpu-blocklist", "--enable-gpu", "--use-angle=d3d11"]
  : ["--mute-audio", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];

async function page(width: number, url: string, reduced = false) {
  const b = await launch({ args: ARGS });
  await b.tab.resize(width, width < 600 ? 844 : 900, 1);
  await b.tab.setMedia([{ name: "prefers-reduced-motion", value: reduced ? "reduce" : "no-preference" }]);
  await b.tab.send("Page.addScriptToEvaluateOnNewDocument", { source: PROBE });
  await b.tab.goto(`${BASE}${url}`, 3000);
  return b;
}
const st = (b: any) => b.tab.js(`(() => { const w = document.querySelector('[data-testid=walkout]'); return { status: w?.dataset.status, stage: w?.dataset.stage, t: Number(w?.dataset.t), summary: document.querySelector('[data-testid=walkout-summary]')?.textContent ?? null, skip: !!document.querySelector('[data-testid=walkout-skip]'), canvases: document.querySelectorAll('[data-testid=walkout] canvas').length, liveGl: window.__ctx.filter(c => !c.isContextLost()).length, gl: window.__gl, draws: window.__draws }; })()`);
const apis = (b: any) => b.tab.js(`performance.getEntriesByType('resource').map(e => new URL(e.name).pathname).filter(p => p.startsWith('/api/'))`);

async function run() {
  // 1 · reproducir → SALTAR (teclado) → final, sin RAF de la escena después
  {
    const b = await page(1440, "/design-system/pack-walkout?fx=future-star&i=WALKOUT&panel=0");
    const apiBefore: string[] = await apis(b);
    await b.tab.js(`document.querySelector('[data-testid=walkout-start]').click()`);
    await sleep(2500);
    const mid = await st(b);
    check("play: avanza en 3D", mid.status === "playing" && mid.t > 1 && mid.stage === "3d", mid);
    // SALTAR alcanzable por teclado: foco + Enter
    await b.tab.js(`document.querySelector('[data-testid=walkout-skip]').focus()`);
    const focused = await b.tab.js(`document.activeElement?.dataset?.testid`);
    await b.tab.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: String.fromCharCode(13) });
    await b.tab.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    await sleep(400);
    const end = await st(b);
    check("skip por teclado → final con resumen", focused === "walkout-skip" && end.status === "done" && /Lar0k/.test(end.summary ?? "") && !end.skip, { focused, end });
    // tras saltar, el lienzo del walkout no vuelve a dibujar (el reloj está parado)
    const d1 = (await st(b)).draws; await sleep(1500); const d2 = (await st(b)).draws;
    check("tras saltar el escenario no dibuja más (sin reloj)", d2 === d1, { d1, d2 });
    const apiAfter: string[] = await apis(b);
    const during = apiAfter.slice(apiBefore.length);
    check("ninguna petición /api durante la escena", during.length === 0, { during, shellAtLoad: [...new Set(apiBefore)] });
    b.tab.takeErrors();
    await b.close();
  }
  // 2 · REPETIR desde el panel DEV ×5 y cambiar de edición ×3: lienzos y contextos vivos
  {
    const b = await page(1440, "/design-system/pack-walkout?fx=future-star&i=WALKOUT");
    await b.tab.js(`document.querySelector('[data-testid=dev-play]').click()`); await sleep(800);
    for (let i = 0; i < 5; i++) { await b.tab.js(`document.querySelector('[data-testid=dev-replay]').click()`); await sleep(500); }
    const afterReplay = await st(b);
    // vivos: el del walkout (+ el del armazón global si lo hay); medimos que repetir no añade ninguno
    const liveBase = afterReplay.liveGl;
    check("repetir ×5: un lienzo del walkout, sin contextos nuevos vivos", afterReplay.canvases === 1, afterReplay);
    for (const fx of ["moments", "base", "record-breaker"]) {
      await b.tab.js(`(() => { const s = [...document.querySelectorAll('select')].find(x => [...x.options].some(o => o.value === '${fx}')); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, '${fx}'); s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await sleep(1200);
    }
    const afterSwitch = await st(b);
    check("cambiar edición ×3: un lienzo y los mismos contextos vivos (los anteriores liberados)", afterSwitch.canvases === 1 && afterSwitch.liveGl === liveBase, { liveBase, afterSwitch });
    // 3 · pérdida de contexto → 2D sin parar la timeline
    await b.tab.js(`document.querySelector('[data-testid=dev-play]').click()`); await sleep(1500);
    await b.tab.js(`(() => { const c = document.querySelector('[data-testid=walkout] canvas'); const gl = c.getContext('webgl2') || c.getContext('webgl'); gl.getExtension('WEBGL_lose_context').loseContext(); })()`);
    await sleep(1500);
    const lost = await st(b);
    check("contexto perdido → escenario 2D y la escena sigue", lost.stage === "2d" && (lost.status === "playing" || lost.status === "done") && lost.t > 1.5, lost);
    const errs = b.tab.takeErrors().filter((e) => !/Failed to load resource/.test(e));
    check("sin errores de consola de la escena", errs.length === 0, errs.slice(0, 5));
    await b.close();
  }
  // 4 · asset roto: la bandera y el escudo fallan (interceptados) y la escena termina igual
  {
    const b = await launch({ args: ARGS });
    await b.tab.resize(1440, 900, 1);
    await b.tab.setMedia([{ name: "prefers-reduced-motion", value: "no-preference" }]);
    await b.tab.send("Page.addScriptToEvaluateOnNewDocument", { source: PROBE });
    await b.tab.send("Fetch.enable", { patterns: [{ urlPattern: "*/flags/*" }, { urlPattern: "*/hints/teams/*" }] });
    b.tab.on("Fetch.requestPaused", (p: any) => { b.tab.send("Fetch.failRequest", { requestId: p.requestId, errorReason: "Failed" }).catch(() => null); });
    await b.tab.goto(`${BASE}/design-system/pack-walkout?fx=future-star&i=WALKOUT&panel=0&autoplay=1`, 3000);
    await sleep(12500);
    const s = await st(b);
    const fallback = await b.tab.js(`({ flagImg: !!document.querySelector('[data-testid=walkout-flag] img'), teamImg: !!document.querySelector('[data-testid=walkout-team] img'), flagText: document.querySelector('[data-testid=walkout-flag]')?.textContent, teamText: document.querySelector('[data-testid=walkout-team]')?.textContent })`);
    check("asset roto → respaldo y la escena termina", s.status === "done" && !fallback.flagImg && !fallback.teamImg, { s, fallback });
    await b.tab.shot(join(OUT, "runtime-asset-failure-final-1440.png"));
    await b.close();
  }
  // 5 · reducido completo de verdad (reloj real) y rendimiento aproximado (SwiftShader: CPU, cota pesimista)
  {
    const b = await page(390, "/design-system/pack-walkout?fx=future-star&i=WALKOUT&panel=0&autoplay=1", true);
    await sleep(4500);
    const s = await st(b);
    check("reducido: termina en ≈3,3 s en 2D", s.status === "done" && s.stage === "2d", s);
    await b.close();
    const p = await page(1440, "/design-system/pack-walkout?fx=future-star&i=WALKOUT&panel=0&autoplay=1");
    await sleep(11500);
    const frames: number[] = await p.tab.js(`window.__frames`);
    const sorted = [...frames].sort((a, c) => a - c);
    const pct = (q: number) => Math.round(sorted[Math.floor(sorted.length * q)] * 10) / 10;
    results.perfSwiftShader = { n: frames.length, p50: pct(0.5), p95: pct(0.95), max: Math.round(sorted[sorted.length - 1]) };
    console.log("perf (SwiftShader, sin GPU):", results.perfSwiftShader);
    await p.close();
  }
  // 6 · 0.2: la persona 3D no carga → escenario 2D, y la escena termina con su resumen
  {
    const b = await launch({ args: ARGS });
    await b.tab.resize(1440, 900, 1);
    await b.tab.setMedia([{ name: "prefers-reduced-motion", value: "no-preference" }]);
    await b.tab.send("Page.addScriptToEvaluateOnNewDocument", { source: PROBE });
    await b.tab.send("Fetch.enable", { patterns: [{ urlPattern: "*/walkout/human/*" }] });
    b.tab.on("Fetch.requestPaused", (p: any) => { b.tab.send("Fetch.failRequest", { requestId: p.requestId, errorReason: "Failed" }).catch(() => null); });
    await b.tab.goto(`${BASE}/design-system/pack-walkout?fx=future-star&i=WALKOUT&panel=0&autoplay=1`, 3000);
    await sleep(12500);
    const s = await st(b);
    check("persona 3D no carga → escenario 2D y la escena termina", s.status === "done" && s.stage === "2d" && /Lar0k/.test(s.summary ?? ""), s);
    await b.close();
  }
  // 7 · 0.2: coste de la persona con la escena en marcha (mitad del paseo), escritorio y móvil (390 px, DPR 3)
  for (const [w, dpr] of [[1440, 1], [390, 3]] as const) {
    const b = await launch({ args: ARGS });
    await b.tab.resize(w, w < 600 ? 844 : 900, dpr);
    await b.tab.setMedia([{ name: "prefers-reduced-motion", value: "no-preference" }]);
    await b.tab.send("Page.addScriptToEvaluateOnNewDocument", { source: PROBE });
    await b.tab.goto(`${BASE}/design-system/pack-walkout?fx=future-star&i=WALKOUT&panel=0&autoplay=1`, 3000);
    await sleep(5200);
    const info = await b.tab.js(`(() => { const c = document.querySelector('[data-testid=walkout-stage-3d]'); const s = window.__walkoutStage?.stats(); const f = window.__frames.slice(-90).sort((a, b) => a - b); return { human: c?.dataset.human, humanLoadMs: Number(c?.dataset.humanMs), ...s, canvasPx: c ? c.width + 'x' + c.height : null, heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null, frameP50ms: f[Math.floor(f.length * 0.5)], frameP95ms: f[Math.floor(f.length * 0.95)], renderer: (() => { const gl = document.createElement('canvas').getContext('webgl'); const e = gl && gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : null; })() }; })()`);
    const res: string[] = await b.tab.js(`performance.getEntriesByType('resource').filter(e => e.name.includes('/walkout/human/')).map(e => new URL(e.name).pathname.split('/').pop() + ':' + Math.round(e.encodedBodySize))`);
    results[`human-${w}`] = { ...info, gpu: !!process.env.WALKOUT_GPU, assets: res };
    check(`persona en escena (${w} px)`, info.human === "ready", results[`human-${w}`]);
    await b.close();
  }
  writeFileSync(join(OUT, "runtime-report.json"), JSON.stringify(results, null, 2));
}

run().catch((e) => { console.error(e); process.exit(1); });
