/**
 * PACK WALKOUT 0.4 · hoja de la secuencia con la CÁMARA REAL de la escena (instrumento local, fuera de CI). UN navegador:
 * congela los instantes pedidos y compone una hoja.
 *   BASE_URL=http://localhost:3000 npx tsx scripts/_walkout-seq.ts <prefijo> "2.6,5,7.4,9.6"
 *   FX (fixture, turkey) · Q (parámetros extra, p. ej. "&cele=SHUSH") · W/H (960×540) · COLS (3)
 *   LIGHTS_OFF=key,portalLight — apaga esas luces (diagnóstico de brillos)
 */
import { launch, sleep } from "./lib/cdp";
import { spawnSync } from "node:child_process";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const out = process.argv[2]; const times = (process.argv[3] ?? "3,5,7,9,10.4").split(",").map(Number);
(async () => {
  const b = await launch({ args: ["--mute-audio", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  await b.tab.resize(Number(process.env.W ?? 960), Number(process.env.H ?? 540), 1);
  await b.tab.setMedia([{ name: "prefers-reduced-motion", value: "no-preference" }]);
  await b.tab.goto(`${BASE}/design-system/pack-walkout?fx=${process.env.FX ?? "turkey"}&panel=0&reduced=0&t=0${process.env.Q ?? ""}`, 3000);
  for (let i = 0; i < 80; i++) { if ((await b.tab.js(`document.querySelector('[data-testid=walkout-stage-3d]')?.dataset.human`)) === "ready") break; await sleep(250); }
  await sleep(1500);
  if (process.env.LIGHTS_OFF) await b.tab.js(`(() => { const s = window.__walkoutStage; for (const k of ("${process.env.LIGHTS_OFF}").split(",")) Object.defineProperty(s[k], "intensity", { get: () => 0, set() {} }); return 1; })()`);
  const files: string[] = [];
  for (const t of times) { await b.tab.js(`window.__walkout.seek(${t})`); await sleep(450); const f = `${out}-${t}.png`; await b.tab.shot(f); files.push(f); }
  await b.close();
  const cols = Number(process.env.COLS ?? 3);
  spawnSync("ffmpeg", ["-loglevel", "error", "-y", ...files.flatMap((f) => ["-i", f]), "-filter_complex", `${files.map((_, i) => `[${i}]scale=640:-1[s${i}]`).join(";")};${files.map((_, i) => `[s${i}]`).join("")}xstack=inputs=${files.length}:layout=${files.map((_, i) => `${(i % cols) ? Array.from({ length: i % cols }, () => "w0").join("+") : "0"}_${Math.floor(i / cols) ? Array.from({ length: Math.floor(i / cols) }, () => "h0").join("+") : "0"}`).join("|")}:fill=black`, `${out}-sheet.png`]);

})().catch((e) => { console.error(e); process.exit(1); });
