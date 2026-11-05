/**
 * WALKOUT 0.5 · vídeo de la APERTURA INTEGRADA en tiempo real (instrumento local, fuera de CI). UN navegador: arnés
 * `/design-system/fase81?scene=…` (ceremonia real, resultado fijo de cartas reales), pulsa ABRIR, deja correr la
 * ceremonia tal cual (walkouts con su CONTINUAR, hero, resto) y captura fotogramas hasta el resumen. Render por
 * software (SwiftShader): pocos fotogramas por segundo; el ritmo es el real, la fluidez NO es la de una GPU.
 *
 *   BASE_URL=http://localhost:3000 npx tsx scripts/_walkout05-video.ts <escena> [ancho] [salida.mp4]
 */
import { mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { launch, sleep } from "./lib/cdp";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const [scene = "w-us", w = "1280", outArg] = process.argv.slice(2);
const width = Number(w), height = width < 600 ? 844 : 720;
const OUT = resolve(process.cwd(), outArg ?? `docs/product/qa/walkout-0.5/video-${scene}-${width}.mp4`);
const tmp = join(process.env.TEMP ?? ".", `w05-frames-${scene}-${width}`);
rmSync(tmp, { recursive: true, force: true }); mkdirSync(tmp, { recursive: true });

(async () => {
  const b = await launch({ args: ["--mute-audio", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  await b.tab.resize(width, height, 1);
  await b.tab.setMedia([{ name: "prefers-reduced-motion", value: "no-preference" }]);
  await b.tab.goto(`${BASE}/design-system/fase81?scene=${scene}&reset=1`, 2500);
  for (let i = 0; i < 120 && (await b.tab.js(`document.querySelector('[data-testid=pack-opening]')?.dataset.phase`)) !== "ready"; i++) await sleep(250);
  // oculta el indicador de Next en desarrollo (no es del juego)
  await b.tab.js(`(() => { const s = document.createElement('style'); s.textContent = 'nextjs-portal{display:none!important}'; document.head.appendChild(s); return 1; })()`);
  let k = 0; const t0 = Date.now(); const stamps: number[] = [];
  const grab = async () => { await b.tab.shot(join(tmp, `f${String(k++).padStart(5, "0")}.png`)); stamps.push(Date.now() - t0); };
  for (let i = 0; i < 6; i++) { await grab(); await sleep(80); }
  await b.tab.js(`document.querySelector('[data-testid=pack-open]')?.click()`);
  let holdDone = 0;
  while (Date.now() - t0 < 150_000) {
    await grab();
    const s = JSON.parse(await b.tab.js<string>(`JSON.stringify({ phase: document.querySelector('[data-testid=pack-opening]')?.dataset.phase, done: document.querySelector('[data-testid=pack-walkout]')?.dataset.walkoutDone })`));
    if (s.phase === "walkout" && s.done === "1") {
      // el jugador mira la carta un momento y pulsa CONTINUAR
      if (++holdDone > 8) { await b.tab.js(`document.querySelector('[data-testid=pack-walkout-continue]')?.click()`); holdDone = 0; }
    } else holdDone = 0;
    // la hero quieta: el foco está en su CONTINUAR (lo pone la apertura); el jugador lo pulsa
    if (s.phase === "hero_hold") { for (let i = 0; i < 6; i++) { await grab(); await sleep(120); } await b.tab.js(`(document.activeElement instanceof HTMLButtonElement ? document.activeElement : null)?.click()`); }
    if (s.phase === "summary") { for (let i = 0; i < 10; i++) { await grab(); await sleep(100); } break; }
  }
  await b.close();
  const secs = stamps[stamps.length - 1] / 1000, fps = Math.max(2, Math.round(k / Math.max(1, secs)));
  // fotogramas al ritmo medido (la duración del vídeo ≈ la real)
  const r = spawnSync("ffmpeg", ["-loglevel", "error", "-y", "-framerate", String(fps), "-i", join(tmp, "f%05d.png"), "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p", "-c:v", "libx264", "-crf", "24", OUT]);
  console.log(r.status === 0 ? `vídeo: ${OUT} · ${k} fotogramas en ${secs.toFixed(1)} s (≈${fps} fps, render por software)` : `ffmpeg falló: ${r.stderr}`);
  rmSync(tmp, { recursive: true, force: true });
})().catch((e) => { console.error(e); process.exit(1); });
