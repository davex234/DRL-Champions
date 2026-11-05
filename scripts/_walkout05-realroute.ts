/**
 * WALKOUT 0.5 · la RUTA REAL `/abrir/[packId]` en `next dev` (instrumento local, fuera de CI). UN navegador, INVITADO
 * (sin cuenta, sin servidor, sin créditos): mete un sobre en el store LOCAL de ese navegador, enciende el walkout SOLO
 * para él (`localStorage["drl:walkout3d"]="1"`, inexistente en producción) y abre como un jugador.
 *   BASE_URL=http://localhost:3000 npx tsx scripts/_walkout05-realroute.ts [packId] [outDir]
 */
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { launch, sleep } from "./lib/cdp";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const pack = process.argv[2] ?? "icon";
const OUT = resolve(process.cwd(), process.argv[3] ?? "docs/product/qa/walkout-0.5");
mkdirSync(OUT, { recursive: true });
(async () => {
  const b = await launch({ args: ["--mute-audio", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  await b.tab.resize(1280, 720, 1);
  await b.tab.setMedia([{ name: "prefers-reduced-motion", value: "no-preference" }]);
  await b.tab.goto(`${BASE}/abrir/${pack}`, 3000);
  await b.tab.js(`(() => { const k = 'drl-champions'; const raw = localStorage.getItem(k); const j = raw ? JSON.parse(raw) : { state: {}, version: 0 }; j.state.unopenedPacks = { ...(j.state.unopenedPacks || {}), ${JSON.stringify(pack)}: 1 }; localStorage.setItem(k, JSON.stringify(j)); localStorage.setItem('drl:walkout3d', '1'); return 1; })()`);
  await b.tab.goto(`${BASE}/abrir/${pack}`, 4000);
  const st = () => b.tab.js<string>(`JSON.stringify({ phase: document.querySelector('[data-testid=pack-opening]')?.dataset.phase, walkouts: document.querySelector('[data-testid=pack-opening]')?.dataset.walkouts, card: document.querySelector('[data-testid=pack-walkout]')?.dataset.walkoutCard, intensity: document.querySelector('[data-testid=pack-walkout]')?.dataset.walkoutIntensity, code: document.querySelector('[data-testid=walkout]')?.dataset.identityCode, arena: document.querySelector('[data-testid=walkout-stage-3d]')?.dataset.arenaCode, dev: !!document.querySelector('[data-testid=walkout-dev-forced], [data-testid=walkout-dev-panel]') })`).then((x) => JSON.parse(x));
  for (let i = 0; i < 80 && (await st()).phase !== "ready"; i++) await sleep(250);
  console.log("antes de abrir:", JSON.stringify(await st()));
  await b.tab.js(`document.querySelector('[data-testid=pack-open]')?.click()`);
  for (let i = 0; i < 160; i++) { const s = await st(); if (s.phase === "walkout" && s.arena) break; await sleep(250); }
  await sleep(3500);
  const s = await st();
  console.log("walkout en la ruta real:", JSON.stringify(s));
  await b.tab.shot(join(OUT, `real-route-abrir-${pack}-1280.png`));
  const errs = b.tab.takeErrors().filter((e) => !/Failed to load resource|503/.test(e));
  if (errs.length) console.log("errores:", errs.slice(0, 4));
  // limpieza: el navegador de QA es temporal; aun así se quita la clave
  await b.tab.js(`localStorage.removeItem('drl:walkout3d')`);
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
