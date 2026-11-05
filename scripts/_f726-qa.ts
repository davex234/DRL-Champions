/**
 * F72.6 · QA REAL DEL COLOR DE LAS PISTAS (fuera de CI) — Chrome real contra :3005, cuenta QA.
 *
 * Por anchura (1440 / 1024 / 390): JUGAR → DUELOS → PARTIDA RÁPIDA → tablero; busca (reintentando partidas reales, sin
 * inventar nada) una mano rival con ≥ 3 banderas distintas y ≥ 1 logo. Para CADA pista: captura del rectángulo de la
 * imagen a escala 4, y en la propia página dibuja el asset ORIGINAL al mismo tamaño (contain) y compara píxel a píxel
 * en las zonas uniformes del original (fuera de bordes y antialias, que dependen de la rotación del abanico): por
 * color del original, su media renderizada y la desviación máxima. Deja un «original | render» por pista.
 * Además: capa superior en el centro y en el borde derecho de cada pista (elementsFromPoint) = la propia pista.
 * Abandona lo que abre.
 *
 *   npx tsx scripts/_f726-qa.ts [persona=A] [anchuras=1440,1024,390]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openBrowser, loginUi, goto, sleep, waitFor, token, api, type Client } from "./_fase68-lib";

const P = process.argv[2] ?? "A";
const WIDTHS = (process.argv[3] ?? "1440,1024,390").split(",").map(Number);
const TAG = process.env.F726_TAG ?? "despues";
const OUT = join(process.cwd(), "docs/product/qa/fase72-6", TAG);
const SHOTS = join(OUT, "shots");
mkdirSync(SHOTS, { recursive: true });
const SCALE = 4;

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

const READ = `(() => [...document.querySelectorAll('[data-hint-art]')].map((a, i) => {
  const r = a.getBoundingClientRect(); const src = (a.style.backgroundImage || '').replace(/^url\\("?|"?\\)$/g, '');
  const top = (x, y) => document.elementFromPoint(x, y) === a;
  return { i, shape: a.getAttribute('data-hint-art'), src, text: (a.closest('[data-testid="rival-hint"]').innerText || '').trim(),
    rect: { x: r.left, y: r.top, width: r.width, height: r.height },
    topCenter: top(r.left + r.width / 2, r.top + r.height / 2), topRightEdge: top(r.right - 2, r.top + r.height / 2), topLeftEdge: top(r.left + 2, r.top + r.height / 2) };
}))()`;

/** Compara, en la página, la captura (dataURL) con el asset original dibujado al mismo tamaño. */
const COMPARE = (shot: string, src: string, margin: number) => `(async () => {
  const load = (u) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = u; });
  const [R, O] = await Promise.all([load(${JSON.stringify(shot)}), load(${JSON.stringify(src)})]);
  const W = R.naturalWidth, H = R.naturalHeight;
  const cv = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const cr = cv(W, H), co = cv(W, H); const xr = cr.getContext('2d'), xo = co.getContext('2d');
  xr.drawImage(R, 0, 0);
  const ow = O.naturalWidth || W, oh = O.naturalHeight || H; const s = Math.min(W / ow, H / oh); const dw = ow * s, dh = oh * s;
  xo.drawImage(O, (W - dw) / 2, (H - dh) / 2, dw, dh);
  const r = xr.getImageData(0, 0, W, H).data, o = xo.getImageData(0, 0, W, H).data;
  const RAD = Math.max(1, Math.round(Math.min(W, H) / 32)), M = ${margin}; const at = (x, y) => (y * W + x) * 4;
  // 1 · Zonas uniformes del ORIGINAL (fuera de bordes y antialias).
  const pts = [];
  for (let y = M; y < H - M; y += 2) for (let x = M; x < W - M; x += 2) {
    const k = at(x, y); if (o[k + 3] < 255) continue;
    let uni = true;
    for (let dy = -RAD; dy <= RAD && uni; dy++) for (let dx = -RAD; dx <= RAD && uni; dx++) { const q = at(x + dx, y + dy);
      if (o[q + 3] < 255 || Math.abs(o[q] - o[k]) > 4 || Math.abs(o[q + 1] - o[k + 1]) > 4 || Math.abs(o[q + 2] - o[k + 2]) > 4) uni = false; }
    if (uni) pts.push([x, y]);
  }
  // 2 · Registro: la caja de una carta girada es algo mayor que la imagen; se busca el desplazamiento (±2 px CSS) que
  //     mejor alinea. Solo mueve DÓNDE se mira: un tinte desplaza el color en todas las posiciones y no se compensa así.
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
    const g = groups[hex] || (groups[hex] = { n: 0, o: [0, 0, 0], rs: [[], [], []], max: 0 });
    g.n++; for (let c = 0; c < 3; c++) { g.o[c] += o[k + c]; g.rs[c].push(r[q + c]); } g.max = Math.max(g.max, d);
  }
  diffs.sort((a, b) => a - b);
  const hx = (a) => '#' + a.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
  const med = (a) => { const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
  const colors = Object.values(groups).filter(g => g.n >= 8).sort((a, b) => b.n - a.n).slice(0, 6).map(g => { const o3 = g.o.map(v => v / g.n), r3 = g.rs.map(med);
    return { original: hx(o3), rendered: hx(r3), shift: Math.max(...o3.map((v, c) => Math.abs(v - r3[c]))), max: g.max, px: g.n }; });
  // Composición «original | render» para mirarla.
  const side = cv(W * 2 + 12, H); const xs = side.getContext('2d'); xs.fillStyle = '#808080'; xs.fillRect(0, 0, side.width, H);
  xs.drawImage(co, 0, 0); xs.drawImage(cr, W + 12, 0);
  return { W, H, n, offset: best, p50: diffs[Math.floor(n * 0.5)] ?? null, p95: diffs[Math.floor(n * 0.95)] ?? null, max: diffs[n - 1] ?? null, colors, side: side.toDataURL('image/png') };
})()`;

(async () => {
  const t = await token(P);
  const duel = (body: any) => api(t, "/api/game/duel", body);
  const report: any = { at: new Date().toISOString(), persona: P, scale: SCALE, byWidth: {} };
  let ok = true;
  for (const width of WIDTHS) {
    const stale = (await duel({ action: "active" })).json?.view?.matchId;
    if (stale) await duel({ action: "abandon", matchId: stale });
    const c = await openBrowser(P, width, { label: "f726" });
    const out: any = { width, attempts: [] };
    try {
      await loginUi(c, P);
      let hints: any[] = [];
      for (let attempt = 0; attempt < 8; attempt++) {
        await reachBoard(c); await sleep(1500);
        hints = await c.tab.js<any[]>(READ);
        const flags = new Set(hints.filter((h) => h.shape === "flag").map((h) => h.src));
        const logos = hints.filter((h) => h.shape === "logo").length;
        const wanted = ["/flags/jp.svg", "/flags/tr.svg", "/flags/cn.svg"].filter((u) => flags.has(u)).length;
        out.attempts.push(hints.map((h) => h.src.split("/").pop()).join(","));
        if (flags.size >= 3 && logos >= 1 && (wanted >= 2 || attempt >= 5)) break;
        const v = (await duel({ action: "active" })).json?.view;
        if (v?.matchId) await duel({ action: "abandon", matchId: v.matchId });
      }
      const errors = c.tab.takeErrors();
      await c.tab.shot(join(SHOTS, `tablero-${width}.png`)).catch(() => null);
      const hand = await c.tab.js<any>(`(() => { const r = document.querySelector('[data-testid="rival-hand"]').getBoundingClientRect(); return { x: r.left - 8, y: r.top - 8, width: r.width + 16, height: r.height + 16 }; })()`);
      const hs = await c.tab.send("Page.captureScreenshot", { format: "png", clip: { ...hand, scale: SCALE } });
      writeFileSync(join(SHOTS, `mano-rival-${width}.png`), Buffer.from(hs.data, "base64"));
      const measure = async (list: any[], tag: string) => {
        const res: any[] = []; const seen = new Set<string>();
        for (const h of list) {
          const s = await c.tab.send("Page.captureScreenshot", { format: "png", clip: { ...h.rect, scale: SCALE } });
          const cmp = await c.tab.js<any>(COMPARE(`data:image/png;base64,${s.data}`, h.src, h.shape === "flag" ? 2 * SCALE : SCALE));
          const name = h.src.split("/").pop().replace(/\.(svg|png)$/, "");
          if (!seen.has(name)) { writeFileSync(join(SHOTS, `${tag}-${width}-${name}.png`), Buffer.from(cmp.side.split(",")[1], "base64")); seen.add(name); }
          // Un tinte, un blend o una sombra encima DESPLAZAN la mediana de cada color; la rotación del abanico solo desalinea bordes finos.
          const pass = h.topCenter && h.topRightEdge && h.topLeftEdge && h.text === "" && cmp.n >= 20 && cmp.p50 <= 1 && cmp.colors.length > 0 && cmp.colors.every((x: any) => x.shift <= 3);
          ok &&= pass;
          delete cmp.side;
          res.push({ i: h.i, asset: name, shape: h.shape, hasRightNeighbour: h.i < list.length - 1 || tag === "sustituida", size: `${Math.round(h.rect.width)}x${Math.round(h.rect.height)}`, top: [h.topLeftEdge, h.topCenter, h.topRightEdge], ...cmp, pass });
          console.log(`${pass ? "PASS" : "FAIL"} [${width}] ${tag} #${h.i} ${name} ${res.at(-1).size} off=${cmp.offset} p50=${cmp.p50} p95=${cmp.p95} n=${cmp.n} top=${[h.topLeftEdge, h.topCenter, h.topRightEdge]} ${cmp.colors.map((x: any) => `${x.original}→${x.rendered}(Δ${Math.round(x.shift)})`).join(" ")}`);
        }
        return res;
      };
      out.hints = await measure(hints, "pista");
      // SUSTITUCIÓN DECLARADA: el reparto determinista de estas partidas no trae Japón ni Turquía. En el MISMO tablero
      // real (mismas capas, mismo CSS) se cambia solo el fichero de pistas que tienen vecino a la derecha (el peor caso
      // del bug) por otros assets locales, y se miden igual. No es una pista real de partida: se informa aparte.
      const n = hints.length;
      const flagSlots = hints.filter((h) => h.shape === "flag" && h.i < n - 1).map((h) => h.i);
      const logoSlots = hints.filter((h) => h.shape === "logo" && h.i < n - 1).map((h) => h.i);
      const SUB_FLAGS = ["jp", "tr", "cn", "id", "pl", "kr"].map((x) => `/flags/${x}.svg`);
      const SUB_LOGOS = ["fnatic", "c9", "g2", "sentinels"].map((x) => `/hints/teams/${x}.png`);
      const plan = [...flagSlots.slice(0, SUB_FLAGS.length).map((i, k) => [i, SUB_FLAGS[k]]), ...logoSlots.slice(0, SUB_LOGOS.length).map((i, k) => [i, SUB_LOGOS[k]])] as [number, string][];
      await c.tab.js(`Promise.all(${JSON.stringify(plan)}.map(([i, u]) => new Promise(res => { const im = new Image(); im.onload = im.onerror = res; im.src = u;
        document.querySelectorAll('[data-hint-art]')[i].style.backgroundImage = 'url("' + u + '")'; })))`);
      await sleep(600);
      const subbed = (await c.tab.js<any[]>(READ)).filter((h) => plan.some(([i]) => i === h.i));
      out.substituted = await measure(subbed, "sustituida");
      const flagsSeen = new Set(out.hints.filter((h: any) => h.shape === "flag").map((h: any) => h.asset));
      out.flagsDistinct = [...flagsSeen]; out.logos = [...new Set(out.hints.filter((h: any) => h.shape === "logo").map((h: any) => h.asset))];
      out.errors = [...errors, ...c.tab.takeErrors()];
      if (flagsSeen.size < 3 || out.logos.length < 1 || out.errors.length) ok = false;
      console.log(`[${width}] banderas=${out.flagsDistinct.join(",")} logos=${out.logos.join(",")} errores=${out.errors.length}`);
    } finally {
      await c.browser.close().catch(() => null);
      const left = (await duel({ action: "active" })).json?.view?.matchId;
      if (left) await duel({ action: "abandon", matchId: left });
    }
    report.byWidth[width] = out;
  }
  report.pass = ok;
  writeFileSync(join(OUT, "color-qa.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(`f72.6 color: ${ok ? "PASS" : "FAIL"}`);
  process.exit(ok ? 0 : 1);
})();
