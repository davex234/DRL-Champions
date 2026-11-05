/**
 * F72.8 · QA DEL COLOR REAL DE LAS PISTAS (fuera de CI) — Chrome real contra :3005 (build de producción), cuenta QA.
 *
 * Por anchura (1440 / 1024 / 390):
 *
 *   1 · ARNÉS CONTROLADO «ORIGINAL | IN-GAME». En una pestaña sobre `:3005/offline.html` (mismo origen, página estática;
 *       no se crea ninguna ruta) se inyecta el marcado REAL de `RivalHand` —renderizado aquí desde el componente, el
 *       mismo que pinta el tablero— con el CSS de la build servida, dentro de la plataforma rival de la arena. Diez
 *       dorsos consecutivos: US KR CN TR JP ID + Fnatic C9 G2 GiantX. Debajo, cada fichero ORIGINAL a su tamaño exacto.
 *       (España no tiene bandera local: ninguna carta del catálogo es ES.)
 *   2 · PARTIDA REAL. JUGAR → DUELOS → PARTIDA RÁPIDA: las pistas que reparta el servidor, tal cual.
 *
 * En los dos: captura de cada pista a escala 4 y comparación píxel a píxel con el fichero original dibujado al mismo
 * tamaño, en las zonas uniformes del original, por color (mediana). Y la capa superior en el centro y los bordes.
 *
 *   npx tsx scripts/_f728-color-qa.ts [persona=A] [anchuras=1440,1024,390]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { openBrowser, loginUi, goto, sleep, waitFor, token, api, type Client } from "./_fase68-lib";
import { RivalHand } from "../src/components/duel/arena/HandFan";
import type { RivalCardHint } from "../src/lib/duel/types";

const P = process.argv[2] ?? "A";
const WIDTHS = (process.argv[3] ?? "1440,1024,390").split(",").map(Number);
const OUT = join(process.cwd(), process.env.F728_OUT ?? "docs/product/qa/fase72-8/color");
mkdirSync(OUT, { recursive: true });
const SCALE = 4;

const HARNESS_HINTS: RivalCardHint[] = [
  { type: "COUNTRY", value: "US" }, { type: "COUNTRY", value: "KR" }, { type: "TEAM", value: "fnatic" }, { type: "COUNTRY", value: "CN" },
  { type: "COUNTRY", value: "TR" }, { type: "TEAM", value: "c9" }, { type: "COUNTRY", value: "JP" }, { type: "COUNTRY", value: "ID" },
  { type: "TEAM", value: "g2" }, { type: "TEAM", value: "giantx" },
];

async function reachBoard(c: Client): Promise<boolean> {
  await goto(c, "/jugar", 2500);
  await c.tab.js(`document.querySelector('[data-testid="play-area-cta-DUELS"]')?.click()`);
  await waitFor(c.tab, `location.pathname === '/duelos' && !!document.querySelector('[data-testid="duel-mode-cta-QUICK"]')`, 15000);
  await c.tab.js(`document.querySelector('[data-testid="duel-mode-cta-QUICK"]')?.click()`);
  await sleep(3500);
  if (await c.tab.js<boolean>(`/Comenzar duelo/i.test(document.body.innerText)`)) {
    await c.tab.js(`[...document.querySelectorAll('button')].find(b => /^Comenzar duelo$/i.test((b.innerText||'').trim()))?.click()`);
    await sleep(3000);
  }
  return waitFor(c.tab, `(() => { document.querySelector('[data-f61="moment"]')?.click(); return document.querySelectorAll('[data-testid="rival-hint"]').length > 0 && !document.querySelector('[data-scene="intro"]'); })()`, 30000);
}

/** Las pistas pintadas: rectángulo del <img>, fichero, y quién está encima en el centro y los bordes. */
const READ = `(() => [...document.querySelectorAll('img[data-hint-art]')].map((a, i) => {
  const r = a.getBoundingClientRect(); const top = (x, y) => document.elementFromPoint(x, y) === a; const cs = getComputedStyle(a);
  return { i, shape: a.getAttribute('data-hint-art'), src: a.getAttribute('src'), loaded: a.complete && a.naturalWidth > 0,
    style: { filter: cs.filter, blend: cs.mixBlendMode, opacity: cs.opacity, transform: cs.transform, fit: cs.objectFit },
    text: (a.closest('[data-testid="rival-hint"]').innerText || '').trim(),
    rect: { x: r.left, y: r.top, width: r.width, height: r.height },
    top: [top(r.left + 1.5, r.top + r.height / 2), top(r.left + r.width / 2, r.top + r.height / 2), top(r.right - 1.5, r.top + r.height / 2)] };
}))()`;

/** Compara, en la página, la captura (dataURL) con el fichero original dibujado al mismo tamaño. */
const COMPARE = (shot: string, src: string, margin: number) => `(async () => {
  const load = (u) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = u; });
  const [R, O] = await Promise.all([load(${JSON.stringify(shot)}), load(${JSON.stringify(src)})]);
  const W = R.naturalWidth, H = R.naturalHeight;
  const cv = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const cr = cv(W, H), co = cv(W, H); const xr = cr.getContext('2d'), xo = co.getContext('2d');
  xr.drawImage(R, 0, 0);
  xo.fillStyle = '#0b0c12'; xo.fillRect(0, 0, W, H);
  const ow = O.naturalWidth || W, oh = O.naturalHeight || H; const s = Math.min(W / ow, H / oh); const dw = ow * s, dh = oh * s;
  xo.drawImage(O, (W - dw) / 2, (H - dh) / 2, dw, dh);
  const probe = cv(W, H).getContext('2d'); probe.drawImage(O, (W - dw) / 2, (H - dh) / 2, dw, dh);
  const alpha = probe.getImageData(0, 0, W, H).data;
  const r = xr.getImageData(0, 0, W, H).data, o = xo.getImageData(0, 0, W, H).data;
  const RAD = Math.max(1, Math.round(Math.min(W, H) / 32)), M = ${margin}; const at = (x, y) => (y * W + x) * 4;
  const pts = [];
  for (let y = M; y < H - M; y += 2) for (let x = M; x < W - M; x += 2) {
    const k = at(x, y); if (alpha[k + 3] < 255) continue;
    let uni = true;
    for (let dy = -RAD; dy <= RAD && uni; dy++) for (let dx = -RAD; dx <= RAD && uni; dx++) { const q = at(x + dx, y + dy);
      if (alpha[q + 3] < 255 || Math.abs(o[q] - o[k]) > 4 || Math.abs(o[q + 1] - o[k + 1]) > 4 || Math.abs(o[q + 2] - o[k + 2]) > 4) uni = false; }
    if (uni) pts.push([x, y]);
  }
  const R2 = 2 * ${SCALE}; let best = [0, 0], bestCost = Infinity;
  for (let oy = -R2; oy <= R2; oy += 2) for (let ox = -R2; ox <= R2; ox += 2) { let cost = 0, m = 0;
    for (let i = 0; i < pts.length; i += 3) { const [x, y] = pts[i]; const xx = x + ox, yy = y + oy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      const k = at(x, y), q = at(xx, yy); cost += Math.abs(r[q] - o[k]) + Math.abs(r[q + 1] - o[k + 1]) + Math.abs(r[q + 2] - o[k + 2]); m++; }
    if (m && cost / m < bestCost) { bestCost = cost / m; best = [ox, oy]; } }
  const groups = {}; let n = 0; const diffs = [];
  for (const [x, y] of pts) {
    const xx = x + best[0], yy = y + best[1]; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
    const k = at(x, y), q = at(xx, yy);
    const d = Math.max(Math.abs(r[q] - o[k]), Math.abs(r[q + 1] - o[k + 1]), Math.abs(r[q + 2] - o[k + 2]));
    diffs.push(d); n++;
    const hex = '#' + [o[k], o[k + 1], o[k + 2]].map(v => (v >> 3 << 3).toString(16).padStart(2, '0')).join('');
    const g = groups[hex] || (groups[hex] = { n: 0, o: [0, 0, 0], rs: [[], [], []] });
    g.n++; for (let c = 0; c < 3; c++) { g.o[c] += o[k + c]; g.rs[c].push(r[q + c]); }
  }
  diffs.sort((a, b) => a - b);
  const hx = (a) => '#' + a.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
  const med = (a) => { const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
  const colors = Object.values(groups).filter(g => g.n >= 8).sort((a, b) => b.n - a.n).slice(0, 6).map(g => { const o3 = g.o.map(v => v / g.n), r3 = g.rs.map(med);
    return { original: hx(o3), rendered: hx(r3), shift: Math.max(...o3.map((v, c) => Math.abs(v - r3[c]))), px: g.n }; });
  const exact = diffs.filter(d => d <= 1).length;
  // Respaldo para diseños sin zonas uniformes a este tamaño (franjas de 1 px): error medio de TODOS los píxeles opacos.
  //          Con su propio registro (±2 px CSS), igual que la medida por zonas: mide color, no desalineación.
  let allMean = null;
  for (let oy = -R2; oy <= R2; oy++) for (let ox = -R2; ox <= R2; ox++) { let sum = 0, cnt = 0;
    for (let y = M; y < H - M; y += 1) for (let x = M; x < W - M; x += 1) { const k = at(x, y); if (alpha[k + 3] < 255) continue;
      const xx = x + ox, yy = y + oy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue; const q = at(xx, yy);
      sum += (Math.abs(r[q] - o[k]) + Math.abs(r[q + 1] - o[k + 1]) + Math.abs(r[q + 2] - o[k + 2])) / 3; cnt++; }
    if (cnt && (allMean === null || sum / cnt < allMean)) allMean = +(sum / cnt).toFixed(2); }
  const side = cv(W * 2 + 12, H); const xs = side.getContext('2d'); xs.fillStyle = '#808080'; xs.fillRect(0, 0, side.width, H);
  xs.drawImage(co, 0, 0); xs.drawImage(cr, W + 12, 0);
  // Color MEDIO de la superficie (rendered vs original, mismo recorte interior): el re-muestreo conserva el área y no lo
  // mueve; un tinte, un velo o una sombra encima, sí. Es la medida válida cuando el diseño no tiene zonas uniformes.
  const mean = (d) => { const acc = [0, 0, 0]; let c = 0; for (let y = M; y < H - M; y++) for (let x = M; x < W - M; x++) { const k = at(x, y); if (alpha[k + 3] < 255) continue; acc[0] += d[k]; acc[1] += d[k + 1]; acc[2] += d[k + 2]; c++; } return c ? acc.map(v => v / c) : null; };
  const mr = mean(r), mo = mean(o);
  const areaShift = mr && mo ? +Math.max(...mr.map((v, c) => Math.abs(v - mo[c]))).toFixed(2) : null;
  return { W, H, n, allMean, areaShift, areaOriginal: mo && hx(mo), areaRendered: mr && hx(mr), offset: best, exactShare: n ? +(exact / n).toFixed(4) : null, p50: diffs[Math.floor(n * 0.5)] ?? null, p95: diffs[Math.floor(n * 0.95)] ?? null, colors, side: side.toDataURL('image/png') };
})()`;

async function measure(c: Client, tag: string, width: number, out: any[]): Promise<boolean> {
  let ok = true;
  const hints = await c.tab.js<any[]>(READ);
  const seen = new Set<string>();
  for (const h of hints) {
    const s = await c.tab.send("Page.captureScreenshot", { format: "png", clip: { ...h.rect, scale: SCALE } });
    const cmp = await c.tab.js<any>(COMPARE(`data:image/png;base64,${s.data}`, h.src, h.shape === "flag" ? SCALE : SCALE));
    const name = h.src.split("/").pop().replace(/\.(svg|png)$/, "");
    if (!seen.has(name)) { writeFileSync(join(OUT, `${tag}-${width}-${name}.png`), Buffer.from(cmp.side.split(",")[1], "base64")); seen.add(name); }
    const clean = h.style.filter === "none" && h.style.blend === "normal" && h.style.opacity === "1" && h.style.transform === "none" && h.style.fit === "contain";
    /*
     * Sin zonas uniformes a este tamaño (EE. UU. a 390: 13 franjas en 14 px), la comparación píxel a píxel mide la FASE
     * con la que se rasterizan las franjas, no el color. Ese caso NO se da por bueno ni por malo: queda «NO MEDIBLE» y
     * se revisa a ojo en la composición original | render (el color medio va en el informe, como dato).
     */
    const measurable = cmp.n >= 20;
    const colorOk = measurable && cmp.p50 <= 1 && cmp.colors.length > 0 && cmp.colors.every((x: any) => x.shift <= 3);
    const structural = h.loaded && clean && h.top.every(Boolean) && h.text === "";
    const pass = structural && colorOk;
    const verdict = !structural ? "FAIL" : !measurable ? "NO MEDIBLE" : pass ? "PASS" : "FAIL";
    if (verdict === "FAIL") ok = false;
    delete cmp.side;
    out.push({ tag, i: h.i, asset: name, shape: h.shape, size: `${Math.round(h.rect.width)}x${Math.round(h.rect.height)}`, clean, top: h.top, ...cmp, verdict });
    console.log(`${verdict} [${width}] ${tag} #${h.i} ${name} ${Math.round(h.rect.width)}x${Math.round(h.rect.height)} limpio=${clean} off=${cmp.offset} exacto=${cmp.exactShare} medio=${cmp.allMean} area=${cmp.areaOriginal}→${cmp.areaRendered}(Δ${cmp.areaShift}) p50=${cmp.p50} p95=${cmp.p95} ${cmp.colors.map((x: any) => `${x.original}→${x.rendered}(Δ${Math.round(x.shift)})`).join(" ")}`);
  }
  return ok;
}

(async () => {
  const t = await token(P);
  const duel = (body: any) => api(t, "/api/game/duel", body);
  const handHtml = renderToStaticMarkup(createElement(RivalHand, { count: HARNESS_HINTS.length, hints: HARNESS_HINTS }));
  const report: any = { at: new Date().toISOString(), persona: P, scale: SCALE, byWidth: {} };
  let ok = true;
  for (const width of WIDTHS) {
    const stale = (await duel({ action: "active" })).json?.view?.matchId;
    if (stale) await duel({ action: "abandon", matchId: stale });
    const c = await openBrowser(P, width, { label: "f728-color", reduced: true });
    const out: any = { width, harness: [], game: [] };
    try {
      await loginUi(c, P);
      // ── 1 · ARNÉS: el CSS de la build servida y el marcado real del componente, sobre una página estática del origen.
      await goto(c, "/jugar", 2000);
      const css = await c.tab.js<string[]>(`[...document.querySelectorAll('link[rel="stylesheet"]')].map(l => l.href)`);
      await goto(c, "/offline.html", 800);
      await c.tab.js(`(() => {
        document.head.querySelectorAll('style,link[rel="stylesheet"]').forEach(n => n.remove());
        for (const h of ${JSON.stringify(css)}) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = h; document.head.appendChild(l); }
        document.body.className = ''; document.body.style.cssText = 'margin:0;background:#06070d;';
        document.body.innerHTML = '<main style="padding:24px 16px;display:grid;gap:20px;justify-items:center">'
          + '<p style="color:#fff;font:600 13px system-ui">F72.8 · IN-GAME (marcado real de RivalHand, CSS de la build)</p>'
          + '<section class="nx-a50-zone relative" data-side="rival" style="width:min(100%,760px);padding:14px 10px"><span aria-hidden class="nx-a50-plate"></span>'
          + ${JSON.stringify(handHtml)} + '</section>'
          + '<p style="color:#fff;font:600 13px system-ui">ORIGINAL (el fichero, mismo tamaño, sobre gris neutro)</p>'
          + '<div id="orig" style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center;background:#808080;padding:10px"></div></main>';
      })()`);
      await sleep(1500);
      await c.tab.js(`(() => { const o = document.getElementById('orig'); for (const a of document.querySelectorAll('img[data-hint-art]')) { const r = a.getBoundingClientRect();
        const i = document.createElement('img'); i.src = a.getAttribute('src'); i.style.cssText = 'width:' + r.width + 'px;height:' + r.height + 'px;object-fit:contain;display:block'; o.appendChild(i); } })()`);
      await sleep(800);
      const harness = await c.tab.js<any>(`(() => { const m = document.querySelector('main').getBoundingClientRect(); return { x: 0, y: 0, width: innerWidth, height: Math.ceil(m.bottom) + 8 }; })()`);
      const hs = await c.tab.send("Page.captureScreenshot", { format: "png", clip: { ...harness, scale: 2 } });
      writeFileSync(join(OUT, `arnes-original-vs-ingame-${width}.png`), Buffer.from(hs.data, "base64"));
      ok = (await measure(c, "arnes", width, out.harness)) && ok;
      // ── 2 · PARTIDA REAL.
      if (!(await reachBoard(c))) throw new Error("sin tablero");
      await sleep(1500);
      await c.tab.shot(join(OUT, `tablero-${width}.png`)).catch(() => null);
      const hand = await c.tab.js<any>(`(() => { const r = document.querySelector('[data-testid="rival-hand"]').getBoundingClientRect(); return { x: r.left - 10, y: r.top - 8, width: r.width + 20, height: r.height + 16 }; })()`);
      const hh = await c.tab.send("Page.captureScreenshot", { format: "png", clip: { ...hand, scale: SCALE } });
      writeFileSync(join(OUT, `mano-rival-${width}.png`), Buffer.from(hh.data, "base64"));
      ok = (await measure(c, "partida", width, out.game)) && ok;
      out.errors = c.tab.takeErrors();
      if (out.errors.length) ok = false;
      console.log(`[${width}] errores de consola=${out.errors.length}`);
    } finally {
      await c.browser.close().catch(() => null);
      const left = (await duel({ action: "active" })).json?.view?.matchId;
      if (left) await duel({ action: "abandon", matchId: left });
    }
    report.byWidth[width] = out;
  }
  report.pass = ok;
  writeFileSync(join(OUT, "color-qa.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(`f72.8 color: ${ok ? "PASS" : "FAIL"}`);
  process.exit(ok ? 0 : 1);
})();
