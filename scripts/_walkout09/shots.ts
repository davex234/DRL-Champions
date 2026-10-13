/**
 * WALKOUT 0.9 · capturas y vídeos del laboratorio de celebraciones (instrumento local, fuera de CI). UN navegador
 * headless (render por software: SwiftShader) contra `serve.mjs`.
 *
 *   npx tsx scripts/_walkout09/shots.ts <outDir> sheet <CELE> <cam1,cam2…> <t1,t2…>      hoja (filas = cámaras)
 *   npx tsx scripts/_walkout09/shots.ts <outDir> video <CELE> <cam> <desde> <hasta> [fps]  vídeo mp4
 *   npx tsx scripts/_walkout09/shots.ts <outDir> clip  <Clip> <cam1,…> <t1,…>              un clip tal cual
 *   npx tsx scripts/_walkout09/shots.ts <outDir> probe <CELE> <t1,…>                        huesos (JSON)
 *   CELE puede ser IDLE. Tiempos en segundos desde el beat de la celebración.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { launch, sleep } from "../lib/cdp";

const [outArg, mode, what, a3 = "front", a4 = "0", a5 = "", a6 = "30"] = process.argv.slice(2);
const OUT = resolve(process.cwd(), outArg);
mkdirSync(OUT, { recursive: true });
const ff = (args: string[]) => spawnSync("ffmpeg", ["-loglevel", "error", "-y", ...args]).status === 0;

async function run() {
  const S = Number(process.env.LAB_SIZE ?? 900);
  const b = await launch({ args: ["--mute-audio", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  try {
    await b.tab.resize(S, S, 1);
    await b.tab.goto(`http://127.0.0.1:3019/${process.env.LAB_ASSET ? `?asset=${process.env.LAB_ASSET}` : ""}`, 1500);
    for (let i = 0; i < 120; i++) { const r = await b.tab.js(`window.lab && (window.lab.ready || window.lab.error)`); if (r) break; await sleep(250); }
    const err = await b.tab.js(`window.lab.error`); if (err) throw new Error(String(err));
    const set = (t: number) => mode === "clip" ? `window.lab.clip(${JSON.stringify(what)}, ${t})` : `window.lab.pose(${JSON.stringify(what)}, ${t})`;
    const setP = (t: number) => mode === "probe" && process.env.PROBE_CLIP ? `window.lab.clip(${JSON.stringify(what)}, ${t})` : set(t);
    if (mode === "probe") {
      const names = (process.env.BONES ?? "Bip01_Head,Bip01_R_Clavicle,Bip01_R_UpperArm,Bip01_R_Forearm,Bip01_R_Hand,Bip01_R_Finger1,Bip01_R_Finger11,Bip01_R_Finger12,Bip01_R_Finger2,Bip01_R_Finger22,Bip01_Spine2,Bip01_Neck,Bip01_L_Foot,Bip01_R_Foot").split(",");
      const out: Record<string, unknown> = {};
      for (const t of a3.split(",").map(Number)) { await b.tab.js(setP(t)); out[t] = await b.tab.js(`window.lab.bones(${JSON.stringify(names)})`); }
      writeFileSync(join(OUT, `probe-${what}.json`), JSON.stringify(out, null, 1)); console.log(JSON.stringify(out));
      return;
    }
    if (mode === "video") {
      const from = Number(a4), to = Number(a5), fps = Number(a6);
      const dir = join(OUT, `v-${what}-${a3}`); mkdirSync(dir, { recursive: true });
      let k = 0;
      for (let t = from; t <= to + 1e-6; t += 1 / fps, k++) {
        await b.tab.js(`(${set(t)}, window.lab.cam(${JSON.stringify(a3)}), 1)`);
        await b.tab.shot(join(dir, `f${String(k).padStart(4, "0")}.png`));
      }
      const mp4 = join(OUT, `${what}-${a3}.mp4`);
      console.log(mp4, ff(["-framerate", String(fps), "-i", join(dir, "f%04d.png"), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", mp4]) ? "ok" : "ffmpeg falló");
      return;
    }
    const cams = a3.split(","), times = a4.split(",").map(Number);
    const rows: string[] = [];
    for (const c of cams) {
      const files: string[] = [];
      for (const t of times) {
        await b.tab.js(`(${set(t)}, window.lab.cam(${JSON.stringify(c)}), 1)`);
        const f = join(OUT, `${what}-${c}-${t.toFixed(2)}.png`); await b.tab.shot(f); files.push(f);
      }
      const row = join(OUT, `row-${what}-${c}.png`);
      if (files.length > 1) ff([...files.flatMap((f) => ["-i", f]), "-filter_complex", `${files.map((_, i) => `[${i}]`).join("")}hstack=${files.length}`, row]); else ff(["-i", files[0], row]);
      rows.push(row);
    }
    const sheet = join(OUT, `sheet-${what}-${cams.join("_")}.png`);
    const w = Math.min(2400, 300 * times.length);
    const ok = rows.length > 1 ? ff([...rows.flatMap((f) => ["-i", f]), "-filter_complex", `${rows.map((_, i) => `[${i}]`).join("")}vstack=${rows.length},scale=${w}:-1`, sheet]) : ff(["-i", rows[0], "-vf", `scale=${w}:-1`, sheet]);
    console.log(sheet, ok ? "ok" : "ffmpeg falló");
  } finally { await b.close(); }
}
run().catch((e) => { console.error(e); process.exit(1); });
