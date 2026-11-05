/**
 * WALKOUT 0.9 · comprobación de la PREVISUALIZACIÓN (instrumento local, fuera de CI): con el túnel a 127.0.0.1:3017,
 * abre la URL de entrega como la abriría el propietario y prueba el panel: las 4 celebraciones, las vistas, pausa,
 * reproducción y el revelado de la carta. UN navegador; capturas en docs/product/qa/walkout-0.9/preview.
 *   npx tsx scripts/_walkout09/preview-check.ts
 */
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { launch, sleep } from "../lib/cdp";

const BASE = process.env.BASE_URL ?? "http://localhost:3017";
const OUT = resolve(process.cwd(), "docs/product/qa/walkout-0.9/preview");
mkdirSync(OUT, { recursive: true });
const LOG = join(OUT, "preview-check.txt"); writeFileSync(LOG, "");
let fails = 0;
const check = (id: string, ok: boolean, d: unknown = "") => { const l = `${ok ? "PASS" : "FAIL"} ${id} ${typeof d === "string" ? d : JSON.stringify(d)}`; console.log(l); appendFileSync(LOG, l + "\n"); if (!ok) fails++; };

(async () => {
  const b = await launch({ args: ["--mute-audio", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const t = b.tab;
  // como el PC del propietario: Windows pide movimiento reducido — la previsualización fuerza el 3D igualmente
  await t.setMedia([{ name: "prefers-reduced-motion", value: "reduce" }]);
  await t.resize(1440, 900, 1);
  const st = async () => JSON.parse(String(await t.js(`JSON.stringify({ panel: !!document.getElementById('pv09'), info: document.querySelector('#pv09 [data-info]')?.textContent ?? '', tt: document.querySelector('#pv09 [data-t]')?.textContent ?? '', t: document.querySelector('[data-testid=walkout]')?.dataset.t ?? null, cele: document.querySelector('[data-testid=walkout]')?.dataset.celebration ?? null, stage: document.querySelector('[data-testid=walkout]')?.dataset.stage ?? null, human: document.querySelector('[data-testid=walkout-stage-3d]')?.dataset.human ?? null, card: !!document.querySelector('[data-testid=walkout-card]') })`)));
  const ready = async () => { for (let i = 0; i < 160; i++) { const s = await st(); if (s.panel && s.human === "ready") return s; await sleep(250); } return st(); };
  const click = (sel: string) => t.js(`document.querySelector(${JSON.stringify(sel)})?.click()`);
  try {
    await t.goto(`${BASE}/`, 3000);
    let s = await ready();
    check("la URL de entrega abre la escena 3D con el panel", s.panel && s.stage === "3d" && s.human === "ready", s);
    await sleep(1500);
    check("panel: build 0.9 y clips nuevos", /drl-0\.1\.1-1-e5db60b6/.test(s.info) || /e5db60b6/.test((await st()).info), (await st()).info);
    // reproducción y pausa
    const t1 = Number((await st()).t); await sleep(1500); const t2 = Number((await st()).t);
    check("se reproduce sola desde el inicio (camina)", t2 > t1 + 0.8, { t1, t2 });
    await t.shot(join(OUT, "01-caminando.png"));
    await click("#pv09 [data-a=pause]"); await sleep(300); const p1 = Number((await st()).t); await sleep(1000); const p2 = Number((await st()).t);
    check("pausa congela el instante", Math.abs(p2 - p1) < 0.02, { p1, p2 });
    await click("#pv09 [data-a=play]"); await sleep(1500);
    const r1 = Number((await st()).t);
    check("reanudar sigue desde ese instante (no vuelve al principio)", r1 > p2 + 0.5 && r1 < p2 + 3, { p2, r1 });
    for (const [cele, label] of [["POINT_SKY", "point"], ["SHUSH", "shush"], ["HYPE_JUMP", "hype"], ["ARMS_CROSSED", "arms"]] as const) {
      await click(`#pv09 [data-cele=${cele}]`); await sleep(2500); s = await ready();
      check(`${cele}: seleccionada y en 3D`, s.cele === cele && s.stage === "3d", { cele: s.cele, stage: s.stage });
      await click("#pv09 [data-a=cele]"); await sleep(400 + 1600);
      await click("#pv09 [data-a=pause]"); await sleep(400);
      await t.shot(join(OUT, `02-${label}-escena.png`));
      for (const v of ["frente", "lateral", "tres"]) {
        await click(`#pv09 [data-view=${v}]`); await sleep(2500); s = await ready(); await sleep(900);
        check(`${cele} vista ${v}: retoma en el mismo instante, en pausa`, Math.abs(Number(s.t) - 9.6) < 0.8 && /en pausa/.test(s.tt), { t: s.t, tt: s.tt });
        await t.shot(join(OUT, `03-${label}-${v}.png`));
      }
      await click(`#pv09 [data-view=escena]`); await sleep(2500); await ready();
    }
    // el revelado de la carta
    await click("#pv09 [data-a=card]"); await sleep(3200);
    s = await st();
    check("ir al revelado: la persona se disuelve y sale la carta", s.card && Number(s.t) > 11, s);
    await t.shot(join(OUT, "04-revelado.png"));
    const errs = t.takeErrors().filter((e) => !/Failed to load resource|503|401|supabase|fetch failed/i.test(e));
    check("sin errores de consola", errs.length === 0, errs.slice(0, 4));
  } finally { await b.close(); }
  console.log(fails ? `${fails} FALLOS` : "TODO OK");
  process.exit(fails ? 1 : 0);
})();
