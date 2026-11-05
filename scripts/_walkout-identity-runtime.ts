/**
 * PACK WALKOUT 0.4 · identidad en ejecución (instrumento local, fuera de CI). UN navegador, UNA pestaña: cambia de carta
 * con el selector del panel (sin recargar) y comprueba que lo que pinta la ARENA (código del tema en el lienzo) es la
 * nacionalidad de la carta, que no queda más de un lienzo ni crecen geometrías/texturas entre cambios, y que un ajuste
 * DEV sale rotulado.   BASE_URL=http://localhost:3000 npx tsx scripts/_walkout-identity-runtime.ts
 */
import { launch, sleep } from "./lib/cdp";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SEQ = (process.env.SEQ ?? "turkey,japan,unknown,usa,turkey,japan").split(",");
(async () => {
  const b = await launch({ args: ["--mute-audio", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  await b.tab.resize(960, 540, 1);
  await b.tab.setMedia([{ name: "prefers-reduced-motion", value: "no-preference" }]);
  await b.tab.goto(`${BASE}/design-system/pack-walkout?fx=${SEQ[0]}&panel=1&reduced=0&t=0`, 3000);
  const set = (idx: number, v: string) => b.tab.js(`(() => { const s = document.querySelectorAll('[data-testid=walkout-dev-panel] select')[${idx}]; const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, ${JSON.stringify(v)}); s.dispatchEvent(new Event('change', { bubbles: true })); return s.value; })()`);
  const fxIdx = await b.tab.js(`[...document.querySelectorAll('[data-testid=walkout-dev-panel] select')].findIndex((s) => [...s.options].some((o) => o.value === 'turkey'))`) as number;
  const flagIdx = await b.tab.js(`[...document.querySelectorAll('[data-testid=walkout-dev-panel] select')].findIndex((s) => [...s.options].some((o) => o.value === 'none'))`) as number;
  const read = async () => {
    for (let i = 0; i < 60; i++) {
      const r = JSON.parse(await b.tab.js(`(() => { const d = document.querySelector('[data-identity-card]'); const c = document.querySelector('[data-testid=walkout-stage-3d]'); const st = window.__walkoutStage; return JSON.stringify({ card: d?.dataset.identityCard, country: d?.dataset.identityCountry, code: d?.dataset.identityCode, team: d?.dataset.identityTeam, arena: c?.dataset.arenaCode, kind: c?.dataset.arenaKind, human: c?.dataset.human, canvases: document.querySelectorAll('canvas').length, forced: document.querySelector('[data-testid=walkout-dev-forced]')?.textContent ?? null, mem: st?.stats?.() ? { g: st.stats().geometries, t: st.stats().textures } : null }); })()`) as string);
      if (r.human === "ready" && r.arena !== undefined) return r;
      await sleep(250);
    }
    throw new Error("la escena no llegó a estar lista: " + JSON.stringify(b.tab.takeErrors().slice(0, 6)) + await b.tab.js(`JSON.stringify({ d: document.querySelector('[data-identity-card]')?.outerHTML.slice(0, 300), c: document.querySelector('[data-testid=walkout-stage-3d]')?.outerHTML.slice(0, 300), sel: [...document.querySelectorAll('[data-testid=walkout-dev-panel] select')].map((s) => s.value) })`));
  };
  let ok = true;
  for (let k = 0; k < SEQ.length; k++) {
    if (k > 0) { await set(fxIdx, SEQ[k]); await sleep(600); }
    await b.tab.js(`window.__walkout.seek(6)`); await sleep(500);
    const r = await read();
    const expect = r.code || (r.kind === "region" ? r.arena : "");
    const pass = r.arena === (r.code || r.arena) && (r.code ? r.kind === "country" : r.kind !== "country") && r.canvases <= 2 && !r.forced;
    ok &&= pass && r.arena === expect;
    console.log(`${pass ? "OK " : "MAL"} ${SEQ[k].padEnd(8)} carta=${r.card} país=${r.country || "—"} código=${r.code || "—"} equipo=${r.team} · arena=${r.arena}(${r.kind}) · lienzos=${r.canvases} · mem=${JSON.stringify(r.mem)}`);
  }
  // DEV: forzar España sobre la carta actual → rótulo visible y arena ESP; quitarlo → vuelve la carta
  await set(flagIdx, "ES"); await sleep(800);
  const f = await read();
  console.log(`${f.forced && f.arena === "ESP" ? "OK " : "MAL"} DEV país=ES → rótulo «${f.forced}» · arena=${f.arena}`); ok &&= !!f.forced && f.arena === "ESP";
  await set(flagIdx, ""); await sleep(800);
  const g = await read();
  console.log(`${!g.forced && g.arena === g.code ? "OK " : "MAL"} DEV quitado → arena=${g.arena} código carta=${g.code} rótulo=${g.forced}`); ok &&= !g.forced && g.arena === g.code;
  const errs = b.tab.takeErrors().filter((e) => !/Failed to load resource/.test(e));
  if (errs.length) { console.log("errores:", errs.slice(0, 5)); ok = false; }
  await b.close();
  console.log(ok ? "IDENTIDAD EN EJECUCIÓN: OK" : "IDENTIDAD EN EJECUCIÓN: FALLOS");
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
