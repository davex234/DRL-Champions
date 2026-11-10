/**
 * WALKOUT 0.6 · QA de la BUILD DE PRODUCCIÓN (instrumento local, fuera de CI). UN navegador. Contra un servidor
 * `next start` de la release (contenedor de QA aislado del VPS por túnel SSH, o la web pública para lo que no exige
 * arneses). Comprueba:
 *   · el walkout completo (3D) termina, sin errores de consola ni violaciones de CSP, con los assets servidos por la app;
 *   · movimiento reducido → 2D; sin WebGL → respaldo 2D;
 *   · en producción, `localStorage["drl:walkout3d"]="1"` y el arnés QA NO encienden el walkout en la apertura.
 *
 *   BASE_URL=http://127.0.0.1:3016 npx tsx scripts/_walkout06-prodqa.ts [salida]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { launch, sleep } from "./lib/cdp";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3016";
const OUT = resolve(process.cwd(), process.argv[2] ?? "docs/product/qa/walkout-0.6");
mkdirSync(OUT, { recursive: true });
const rows: string[] = []; let fails = 0;
const check = (id: string, ok: boolean, detail: unknown = "") => {
  const line = `${ok ? "PASS" : "FAIL"} ${id} ${(typeof detail === "string" ? detail : JSON.stringify(detail)).slice(0, 300)}`;
  rows.push(line); console.log(line); if (!ok) fails++;
};

(async () => {
  const b = await launch({ args: ["--mute-audio", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  await b.tab.resize(1280, 720, 1);
  // CSP: cualquier violación queda en window.__csp
  const cspHook = `(() => { window.__csp = []; document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI)); return 1; })()`;
  const state = () => b.tab.js<string>(`JSON.stringify((() => { const d = document.querySelector('[data-testid=walkout]'); const c = document.querySelector('[data-testid=walkout-stage-3d]'); return { stage: d?.dataset.stage, status: d?.dataset.status, card: d?.dataset.identityCard, code: d?.dataset.identityCode, arena: c?.dataset.arenaCode, human: c?.dataset.human, canvases: document.querySelectorAll('canvas').length, csp: window.__csp ?? [] }; })())`).then((s) => JSON.parse(s));

  // 1 · walkout completo en 3D (pieza real del director, carta real: lar0k Future Star · TUR)
  await b.tab.setMedia([{ name: "prefers-reduced-motion", value: "no-preference" }]);
  await b.tab.goto(`${BASE}/design-system/pack-walkout?fx=turkey&reduced=0&autoplay=1`, 1500);
  await b.tab.js(cspHook);
  let s: Record<string, unknown> = {};
  for (let i = 0; i < 120; i++) { s = await state(); if (s.human === "ready") break; await sleep(250); }
  check("3D · persona y arena listas en la build de producción", s.human === "ready" && s.arena === "TUR", s);
  await b.tab.shot(join(OUT, "prod-build-3d-mid.png"));
  const res = JSON.parse(await b.tab.js<string>(`JSON.stringify(performance.getEntriesByType('resource').filter((r) => /\\/walkout\\//.test(r.name)).map((r) => ({ u: r.name.replace(location.origin, ''), s: r.responseStatus, b: r.transferSize })))`)) as { u: string; s: number; b: number }[];
  check("3D · assets del walkout servidos por la app (mismo origen, 200)", res.length >= 5 && res.every((r) => r.u.startsWith("/walkout/") && (r.s === 200 || r.s === 0 || r.s === 304)), res);
  for (let i = 0; i < 160; i++) { s = await state(); if (s.status === "done") break; await sleep(250); }
  check("3D · la animación llega al final", s.status === "done", s);
  await b.tab.shot(join(OUT, "prod-build-3d-end.png"));
  check("3D · sin violaciones de CSP", (s.csp as string[]).length === 0, s.csp);

  // 2 · movimiento reducido → 2D
  await b.tab.setMedia([{ name: "prefers-reduced-motion", value: "reduce" }]);
  await b.tab.goto(`${BASE}/design-system/pack-walkout?fx=japan`, 1500);
  for (let i = 0; i < 40; i++) { s = await state(); if (s.stage) break; await sleep(250); }
  check("reducido · versión 2D, sin lienzo 3D", s.stage === "2d" && s.human === undefined, s);
  await b.tab.shot(join(OUT, "prod-build-reduced.png"));

  // 4 · producción: ni localStorage ni el arnés QA encienden el walkout en la apertura
  await b.tab.goto(`${BASE}/design-system/fase81?scene=w-mega&reset=1`, 1500);
  await b.tab.js(`(() => { localStorage.setItem('drl:walkout3d', '1'); return 1; })()`);
  await b.tab.goto(`${BASE}/design-system/fase81?scene=w-mega&reset=1`, 2500);
  for (let i = 0; i < 80 && (await b.tab.js(`document.querySelector('[data-testid=pack-opening]')?.dataset.phase`)) !== "ready"; i++) await sleep(250);
  await b.tab.js(`document.querySelector('[data-testid=pack-open]')?.click()`);
  let ph: Record<string, unknown> = {};
  for (let i = 0; i < 60; i++) {
    ph = JSON.parse(await b.tab.js<string>(`JSON.stringify({ phase: document.querySelector('[data-testid=pack-opening]')?.dataset.phase, walkouts: document.querySelector('[data-testid=pack-opening]')?.dataset.walkouts, w: !!document.querySelector('[data-testid=pack-walkout]') })`));
    if (ph.phase && ph.phase !== "ready" && ph.phase !== "requesting" && ph.phase !== "opening") break;
    await sleep(250);
  }
  check("producción · localStorage drl:walkout3d=1 + arnés QA → apertura de siempre (0 walkouts)", ph.walkouts === "0" && ph.w === false && ph.phase !== "walkout", ph);
  const chunks = JSON.parse(await b.tab.js<string>(`JSON.stringify(performance.getEntriesByType('resource').map((r) => r.name).filter((n) => /\\/walkout\\/|three/i.test(n)))`)) as string[];
  check("producción · la apertura apagada no descarga modelos 3D", !chunks.some((n) => /\/walkout\//.test(n)), chunks);
  await b.tab.js(`(() => { localStorage.removeItem('drl:walkout3d'); return 1; })()`);

  const errs = b.tab.takeErrors().filter((e) => !/Failed to load resource|503|401|ERR_NAME_NOT_RESOLVED|fetch failed|supabase/i.test(e));
  check("sin errores de consola (salvo la BD, ausente a propósito en el contenedor de QA)", errs.length === 0, errs.slice(0, 5));
  await b.close();

  // 3 · sin WebGL (Chrome con --disable-3d-apis, el navegador anterior ya cerrado) → respaldo 2D
  const g = await launch({ args: ["--mute-audio", "--disable-3d-apis"] });
  await g.tab.resize(1280, 720, 1);
  await g.tab.setMedia([{ name: "prefers-reduced-motion", value: "no-preference" }]);
  await g.tab.goto(`${BASE}/design-system/pack-walkout?fx=usa&reduced=0&autoplay=1`, 2000);
  const gl = await g.tab.js<boolean>(`!!document.createElement('canvas').getContext('webgl2') || !!document.createElement('canvas').getContext('webgl')`);
  let n: Record<string, unknown> = {};
  for (let i = 0; i < 60; i++) { n = JSON.parse(await g.tab.js<string>(`JSON.stringify({ stage: document.querySelector('[data-testid=walkout]')?.dataset.stage, status: document.querySelector('[data-testid=walkout]')?.dataset.status, code: document.querySelector('[data-testid=walkout]')?.dataset.identityCode })`)); if (n.stage === "2d") break; await sleep(250); }
  check("sin WebGL · respaldo 2D automático con la identidad de la carta", !gl && n.stage === "2d" && n.code === "USA", { webgl: gl, ...n });
  await g.tab.shot(join(OUT, "prod-build-nowebgl.png"));
  await g.close();
  writeFileSync(join(OUT, "qa-prod-build.txt"), rows.join("\n") + "\n");
  console.log(fails ? `FALLOS: ${fails}` : "TODO OK");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
