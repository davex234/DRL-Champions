/**
 * WALKOUT 0.9 · coste por fotograma de las celebraciones en Chrome (solo CPU: la pose, sin pintar). Instrumento local.
 *   npx tsx scripts/_walkout09/perf.ts   (con serve.mjs en marcha)
 */
import { launch, sleep } from "../lib/cdp";
(async () => {
  const b = await launch({ args: ["--mute-audio", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  try {
    await b.tab.goto("http://127.0.0.1:3019/", 1500);
    for (let i = 0; i < 120; i++) { if (await b.tab.js(`window.lab && window.lab.ready`)) break; await sleep(250); }
    const r = await b.tab.js(`(() => { const out = {}; for (const id of ["IDLE", "POINT_SKY", "SHUSH", "HYPE_JUMP", "ARMS_CROSSED"]) { for (let i = 0; i < 30; i++) window.lab.pose(id, i / 60); const N = 600, t0 = performance.now(); for (let i = 0; i < N; i++) window.lab.pose(id, (i % 150) / 60); out[id] = +((performance.now() - t0) / N).toFixed(3); } return JSON.stringify(out); })()`);
    console.log("ms por fotograma (pose):", r);
  } finally { await b.close(); }
})();
