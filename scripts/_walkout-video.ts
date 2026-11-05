/**
 * PACK WALKOUT 0.1/0.2 · vídeo de revisión por fotogramas deterministas (instrumento local, fuera de CI).
 * Congela cada instante con `window.__walkout.seek(t)` (misma timeline que la reproducción real) y une con ffmpeg.
 *   BASE_URL=http://127.0.0.1:3011 npx tsx scripts/_walkout-video.ts [fx] [intensity] [width] [reduced]
 * 0.2: espera a la persona 3D (`data-human`), y admite WALKOUT_OUT · WALKOUT_FPS · WALKOUT_FROM/TO (s) · WALKOUT_CAM
 *      (cámara libre de QA) · WALKOUT_TAG (sufijo del fichero).
 */
import { mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { launch, sleep } from "./lib/cdp";
import { buildTimeline, type WalkoutIntensity } from "../src/domain/walkout/timeline";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3011";
const [fx = "future-star", intensity = "WALKOUT", w = "1280", red = "0"] = process.argv.slice(2);
const width = Number(w), height = width < 600 ? 844 : 720, reduced = red === "1";
const FPS = Number(process.env.WALKOUT_FPS ?? 24);
const OUT = resolve(process.cwd(), process.env.WALKOUT_OUT ?? "docs/product/qa/walkout-0.1");
mkdirSync(OUT, { recursive: true });
const tmp = join(process.env.TEMP ?? ".", `walkout-frames-${fx}-${intensity}-${width}-${red}`);
rmSync(tmp, { recursive: true, force: true }); mkdirSync(tmp, { recursive: true });

async function run() {
  const tl = buildTimeline(intensity as WalkoutIntensity, { reduced });
  const b = await launch({ args: ["--mute-audio", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  await b.tab.resize(width, height, 1);
  await b.tab.setMedia([{ name: "prefers-reduced-motion", value: reduced ? "reduce" : "no-preference" }]);
  const cam = process.env.WALKOUT_CAM ? `&cam=${process.env.WALKOUT_CAM}` : "";
  await b.tab.goto(`${BASE}/design-system/pack-walkout?fx=${fx}&i=${intensity}&panel=0&reduced=${reduced ? 1 : 0}&t=0${cam}${process.env.WALKOUT_Q ?? ""}`, 3500);
  for (let i = 0; i < 60; i++) {
    const h = await b.tab.js(`document.querySelector('[data-testid=walkout-stage-3d]')?.dataset.human ?? document.querySelector('[data-testid=walkout]')?.dataset.stage ?? ''`);
    if (h === "ready" || h === "failed" || h === "2d") break;
    await sleep(250);
  }
  await sleep(800);
  const from = Number(process.env.WALKOUT_FROM ?? 0), to = Math.min(tl.duration, Number(process.env.WALKOUT_TO ?? tl.duration));
  const total = Math.ceil((to - from + (process.env.WALKOUT_TO ? 0 : 1.2)) * FPS);           // + 1,2 s quieto en el final
  for (let i = 0; i < total; i++) {
    const t = Math.min(to, from + i / FPS);
    await b.tab.js(`window.__walkout.seek(${t})`);
    await sleep(45);
    await b.tab.shot(join(tmp, `f${String(i).padStart(4, "0")}.png`));
  }
  await b.close();
  const file = join(OUT, `video-${fx}-${intensity}-${reduced ? "reduced" : "motion"}-${width}${process.env.WALKOUT_TAG ?? ""}.mp4`);
  const r = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", join(tmp, "f%04d.png"), "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "23", file], { stdio: "inherit" });
  rmSync(tmp, { recursive: true, force: true });
  console.log(r.status === 0 ? `vídeo: ${file}` : "ffmpeg falló");
}
run().catch((e) => { console.error(e); process.exit(1); });
