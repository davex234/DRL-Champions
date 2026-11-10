/**
 * WALKOUT 0.9 · QA de las celebraciones en la ESCENA REAL (arena, cámara de la timeline, reflejo, luces) sobre una BUILD DE
 * PRODUCCIÓN (contenedor de QA aislado, por túnel). Instrumento local, fuera de CI. UN navegador.
 * Página interna `/design-system/pack-walkout` (abierta solo con NEXUS_QA_HARNESS=1): misma escena que la apertura.
 *
 *   BASE_URL=http://127.0.0.1:3016 npx tsx scripts/_walkout09/stage-qa.ts <outDir> [W×H] [intensidad]
 * Por celebración: capturas a +0,3 / +0,8 / +1,3 / +1,9 / +2,6 s del beat, estado de la persona y errores de consola.
 */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { launch, sleep } from "../lib/cdp";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3016";
const [outArg = "docs/product/qa/walkout-0.9/stage", size = "1440x900", intensity = "WALKOUT"] = process.argv.slice(2);
const [W, H] = size.split("x").map(Number);
const OUT = resolve(process.cwd(), outArg);
mkdirSync(OUT, { recursive: true });
const LOG = join(OUT, `qa-stage-${size}-${intensity}.txt`);
writeFileSync(LOG, "");
let fails = 0;
const check = (id: string, ok: boolean, d: unknown = "") => { const l = `${ok ? "PASS" : "FAIL"} ${id} ${typeof d === "string" ? d : JSON.stringify(d)}`; console.log(l); appendFileSync(LOG, l + "\n"); if (!ok) fails++; };

async function run() {
  const b = await launch({ args: ["--mute-audio", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  try {
    await b.tab.resize(W, H, 1);
    await b.tab.setMedia([{ name: "prefers-reduced-motion", value: "no-preference" }]);
    for (const cele of ["POINT_SKY", "SHUSH", "HYPE_JUMP", "ARMS_CROSSED"]) {
      await b.tab.goto(`${BASE}/design-system/pack-walkout?fx=${process.env.WALKOUT_FX ?? "turkey"}&i=${intensity}&panel=0&reduced=0&qaHold=1&t=0&cele=${cele}`, 3000);
      let human = "";
      for (let i = 0; i < 120; i++) { human = String(await b.tab.js(`document.querySelector('[data-testid=walkout-stage-3d]')?.dataset.human ?? ''`)); if (human === "ready" || human === "failed") break; await sleep(250); }
      check(`${cele} persona cargada`, human === "ready", human);
      await sleep(1500);
      const info = JSON.parse(String(await b.tab.js(`JSON.stringify({ at: window.__walkoutStage?.opts?.celebrateAt ?? null, cele: document.querySelector('[data-testid=walkout]')?.dataset.celebration ?? null, stage: document.querySelector('[data-testid=walkout]')?.dataset.stage ?? null })`)));
      check(`${cele} escena 3D con la celebración pedida`, info.stage === "3d" && info.cele === (intensity === "RARE" ? "ARMS_CROSSED" : cele) && typeof info.at === "number", info);
      const files: string[] = [];
      for (const dt of [0.3, 0.8, 1.3, 1.9, 2.6]) {
        await b.tab.js(`window.__walkout.seek(${(info.at ?? 8.3) + dt})`);
        await sleep(450);
        const f = join(OUT, `${cele}-${size}-${intensity}-${dt.toFixed(1)}.png`);
        await b.tab.shot(f); files.push(f);
      }
      const sheet = join(OUT, `sheet-${cele}-${size}-${intensity}.png`);
      const ok = spawnSync("ffmpeg", ["-loglevel", "error", "-y", ...files.flatMap((f) => ["-i", f]), "-filter_complex", `${files.map((_, i) => `[${i}]`).join("")}hstack=${files.length},scale=${Math.min(2400, files.length * (W > H ? 480 : 240))}:-1`, sheet]).status === 0;
      check(`${cele} hoja`, ok, sheet.replace(/\\/g, "/").replace(/^.*docs\//, "docs/"));
    }
    const errs = b.tab.takeErrors().filter((e) => !/Failed to load resource|telemetry/i.test(e));
    check("sin errores de consola", errs.length === 0, errs.slice(0, 5));
  } finally { await b.close(); }
  console.log(fails ? `${fails} FALLOS` : "TODO OK");
  process.exit(fails ? 1 : 0);
}
run().catch((e) => { console.error(e); process.exit(1); });
