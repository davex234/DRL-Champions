/**
 * PACK WALKOUT 0.4 · render del audio SIN altavoces (instrumento local, fuera de CI). UN navegador: la página interna
 * renderiza la mezcla entera con OfflineAudioContext (`window.__walkoutAudioRender`), con los mismos parámetros que la
 * escena, y aquí se guarda el WAV y se miden niveles. Medir no es escuchar: el informe lo dice.
 *   BASE_URL=http://localhost:3000 npx tsx scripts/_walkout-audio.ts [outDir]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { launch, sleep } from "./lib/cdp";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = resolve(process.cwd(), process.argv[2] ?? "docs/product/qa/walkout-0.4/audio");
mkdirSync(OUT, { recursive: true });
const CASES: [string, string, string][] = [["turkey", "WALKOUT", "SHUSH"], ["turkey", "WALKOUT", "HYPE_JUMP"]];
(async () => {
  const b = await launch({ args: ["--mute-audio", "--autoplay-policy=no-user-gesture-required"] });
  await b.tab.goto(`${BASE}/design-system/pack-walkout?fx=turkey&panel=0&reduced=1&t=0`, 3000);
  for (let i = 0; i < 60 && !(await b.tab.js(`typeof window.__walkoutAudioRender === "function"`)); i++) await sleep(250);
  const report: Record<string, unknown> = {};
  for (const [fx, i, cel] of CASES) {
    const r = JSON.parse(await b.tab.js(`window.__walkoutAudioRender(${JSON.stringify(i)}, ${JSON.stringify(cel)}, ${JSON.stringify(fx)}).then((x) => JSON.stringify(x))`) as string);
    const file = join(OUT, `walkout-${fx}-${i}-${cel}.wav`);
    writeFileSync(file, Buffer.from(r.wav, "base64"));
    const db = (v: number) => (v > 0 ? +(20 * Math.log10(v)).toFixed(1) : -120);
    const silent = r.rms.map((v: number, k: number) => [k / 2, v] as const).filter(([, v]: readonly [number, number]) => v < 1e-4).map(([t]: readonly [number, number]) => t);
    const info = { seconds: r.seconds, peak: r.peak, peakDbfs: db(r.peak), clipping: r.peak >= 0.999, rmsDbfsPorMedioSegundo: r.rms.map(db), cues: r.cues, tramosEnSilencio: silent };
    report[`${fx}-${i}-${cel}`] = info;
    console.log(`${cel}: ${r.seconds} s · pico ${info.peakDbfs} dBFS${info.clipping ? " (¡SATURA!)" : ""} · cues ${r.cues.map((c: { beat: string; at: number }) => `${c.beat}@${c.at}`).join(" ")}`);
    console.log(`  RMS dBFS (cada 0,5 s): ${info.rmsDbfsPorMedioSegundo.join(" ")}`);
  }
  writeFileSync(join(OUT, "audio-report.json"), JSON.stringify(report, null, 2));
  const errs = b.tab.takeErrors().filter((e) => !/Failed to load resource/.test(e));
  if (errs.length) console.log("errores:", errs.slice(0, 5));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
