/**
 * PACK WALKOUT 0.2 · ¿PATINAN LOS PIES? (instrumento local, fuera de CI). Recorre el paseo a 60 fps con `seek` y lee la
 * posición en el MUNDO de los huesos del pie (`window.__walkoutStage.qaProbe()`). Mientras un pie está apoyado (su bola
 * cerca de la altura mínima), su Z no debería moverse: se mide cuánto se desliza por apoyo y si atraviesa el suelo.
 *
 *   BASE_URL=http://localhost:3000 npx tsx scripts/_walkout-footslide.ts [fx] [intensity]
 */
import { launch, sleep } from "./lib/cdp";
import { buildTimeline, type WalkoutIntensity } from "../src/domain/walkout/timeline";
import { WALK_CLIP, walkAt } from "../src/domain/walkout/walk";

/* eslint-disable @typescript-eslint/no-explicit-any */
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const [fx = "champions-s", intensity = "WALKOUT"] = process.argv.slice(2);

async function run() {
  const tl = buildTimeline(intensity as WalkoutIntensity);
  const human = tl.beats.find((b) => b.id === "human");
  if (!human) throw new Error("esta intensidad no tiene persona");
  const b = await launch({ args: ["--mute-audio", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  await b.tab.resize(960, 600, 1);
  await b.tab.setMedia([{ name: "prefers-reduced-motion", value: "no-preference" }]);
  await b.tab.goto(`${BASE}/design-system/pack-walkout?fx=${fx}&i=${intensity}&panel=0&reduced=0&t=0${process.env.WALKOUT_Q ?? ""}`, 3500);
  for (let i = 0; i < 80; i++) { if ((await b.tab.js(`document.querySelector('[data-testid=walkout-stage-3d]')?.dataset.human`)) === "ready") break; await sleep(250); }
  const rows: { t: number; p: Record<string, [number, number, number]> }[] = [];
  const tTo = Number(process.env.WALKOUT_TO ?? human.at + human.dur + 0.3);
  for (let t = Number(process.env.WALKOUT_FROM ?? human.at); t <= tTo; t += 1 / 60) {
    const p = await b.tab.js(`(window.__walkout.seek(${t}), new Promise((r) => requestAnimationFrame(() => r(window.__walkoutStage?.qaProbe() ?? null))))`);
    if (p) rows.push({ t, p });
  }
  await b.close();
  const report: Record<string, unknown> = { samples: rows.length };
  // fase del ciclo → pies respecto a la pelvis (para elegir en qué fase acabar el paseo)
  if (process.env.WALKOUT_PHASES) {
    for (const r of rows) {
      const st = walkAt(r.t - human.at, human.dur); if (st.walkWeight < 1 || st.distance < 0.5) continue;
      const ph = ((st.walkTime / WALK_CLIP.cycle) % 1).toFixed(3);
      console.log(ph, (r.p.ball_l[2] - r.p.pelvis[2]).toFixed(3), (r.p.ball_r[2] - r.p.pelvis[2]).toFixed(3), r.p.ball_l[1].toFixed(3), r.p.ball_r[1].toFixed(3));
    }
  }
  if (process.env.WALKOUT_TRACE) for (const r of rows.filter((q) => q.t >= Number(process.env.WALKOUT_TRACE))) {
    const st = walkAt(r.t - human.at, human.dur);
    console.log(r.t.toFixed(2), st.walkWeight.toFixed(2), "L", r.p.ball_l.map((x) => x.toFixed(3)).join(","), "R", r.p.ball_r.map((x) => x.toFixed(3)).join(","), "P", r.p.pelvis.map((x) => x.toFixed(3)).join(","));
  }
  const cruising = rows.filter((r) => walkAt(r.t - human.at, human.dur).walkWeight >= 1);
  for (const side of ["l", "r"]) {
    const ys = cruising.map((r) => r.p[`ball_${side}`][1]);
    const floor = Math.min(...ys);
    const contacts: { from: number; to: number; slide: number; maxSpeed: number }[] = [];
    let cur: { from: number; z0: number; zs: number[]; ts: number[] } | null = null;
    rows.forEach((r, i) => {
      const planted = r.p[`ball_${side}`][1] < floor + 0.012 && r.p[`foot_${side}`][1] < Math.min(...rows.map((q) => q.p[`foot_${side}`][1])) + 0.05;
      if (planted) { cur ??= { from: r.t, z0: r.p[`ball_${side}`][2], zs: [], ts: [] }; cur.zs.push(r.p[`ball_${side}`][2]); cur.ts.push(r.t); }
      if ((!planted || i === rows.length - 1) && cur) {
        let maxSpeed = 0; for (let k = 1; k < cur.zs.length; k++) maxSpeed = Math.max(maxSpeed, Math.abs(cur.zs[k] - cur.zs[k - 1]) / (cur.ts[k] - cur.ts[k - 1]));
        if (cur.zs.length >= 4) contacts.push({ from: +cur.from.toFixed(2), to: +cur.ts[cur.ts.length - 1].toFixed(2), slide: +(Math.max(...cur.zs) - Math.min(...cur.zs)).toFixed(4), maxSpeed: +maxSpeed.toFixed(3) });
        cur = null;
      }
    });
    report[side] = { ballMinY: +floor.toFixed(4), contacts };
  }
  const pel = rows.map((r) => r.p.pelvis[2]); const speeds = pel.slice(1).map((z, i) => (z - pel[i]) * 60);
  report.pelvisMaxSpeed = +Math.max(...speeds).toFixed(3);
  report.pelvisMaxSpeedAt = +rows[speeds.indexOf(Math.max(...speeds)) + 1].t.toFixed(2);
  console.log(JSON.stringify(report, null, 1));
}
run().catch((e) => { console.error(e); process.exit(1); });
