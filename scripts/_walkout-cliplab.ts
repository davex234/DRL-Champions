/**
 * PACK WALKOUT 0.3 · laboratorio de clips (instrumento local, fuera de CI). UN solo navegador: para cada clip candidato,
 * congela la escena en varios instantes tras la llegada (la persona no se disuelve: `qaHold=1`) y compone una hoja.
 *
 *   BASE_URL=http://localhost:3000 npx tsx scripts/_walkout-cliplab.ts <outDir> Clip1,Clip2,…  [cam] [desde] [hasta] [n]
 *   cam por defecto frontal: "0,1.05,3.4,0,1.0,0" (relativa a la persona).  Parámetro de la escena: &idle=<clip>
 *   WALKOUT_Q añade parámetros (p. ej. "&cele=SHUSH").
 */
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { launch, sleep } from "./lib/cdp";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const [outArg = "cliplab", clipsArg = "Idle_FoldArms_Loop", cam = "0,1.05,3.4,0,1.0,0", fromArg = "7.9", toArg = "11", nArg = "8"] = process.argv.slice(2);
const OUT = resolve(process.cwd(), outArg);
mkdirSync(OUT, { recursive: true });

async function run() {
  const b = await launch({ args: ["--mute-audio", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  await b.tab.resize(Number(process.env.WALKOUT_W ?? 640), Number(process.env.WALKOUT_H ?? 640), 1);
  await b.tab.setMedia([{ name: "prefers-reduced-motion", value: "no-preference" }]);
  const from = Number(fromArg), to = Number(toArg), n = Number(nArg);
  for (const clip of clipsArg.split(",")) {
    const idle = clip === "-" ? "" : `&idle=${clip}`;
    await b.tab.goto(`${BASE}/design-system/pack-walkout?fx=${process.env.WALKOUT_FX ?? "champions-s"}&i=${process.env.WALKOUT_I ?? "WALKOUT"}&panel=0&reduced=0&qaHold=1&t=0${idle}&cam=${cam}${process.env.WALKOUT_Q ?? ""}`, 3000);
    for (let i = 0; i < 80; i++) { if ((await b.tab.js(`document.querySelector('[data-testid=walkout-stage-3d]')?.dataset.human`)) === "ready") break; await sleep(250); }
    await sleep(1500);   // el splash del armazón tapa los primeros fotogramas
    // solo la persona: fuera las piezas DOM (bandera, rol, escudo, edición, media, nombre, carta)
    await b.tab.js(`(() => { const s = document.createElement('style'); s.textContent = '[data-testid=walkout-flag],[data-testid=walkout-role],[data-testid=walkout-team],[data-testid=walkout-edition],[data-testid=walkout-ovr],[data-testid=walkout-name],[data-testid=walkout-card]{display:none!important}'; document.head.appendChild(s); return 1; })()`);
    const files: string[] = [];
    for (let k = 0; k < n; k++) {
      const t = from + ((to - from) * k) / Math.max(1, n - 1);
      await b.tab.js(`window.__walkout.seek(${t})`);
      await sleep(350);
      const f = join(OUT, `${clip}-${String(k).padStart(2, "0")}.png`);
      await b.tab.shot(f); files.push(f);
    }
    const r = spawnSync("ffmpeg", ["-loglevel", "error", "-y", ...files.flatMap((f) => ["-i", f]), "-filter_complex", `${files.map((_, i) => `[${i}]`).join("")}hstack=${files.length},scale=${Math.min(2400, 300 * files.length)}:-1`, join(OUT, `sheet-${clip}.png`)]);
    console.log(clip, r.status === 0 ? "hoja ok" : "ffmpeg falló");
  }
  const errs = b.tab.takeErrors().filter((e) => !/Failed to load resource/.test(e));
  if (errs.length) console.log("errores:", errs.slice(0, 5));
  await b.close();
}
run().catch((e) => { console.error(e); process.exit(1); });
