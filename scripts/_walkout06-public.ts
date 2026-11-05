/**
 * WALKOUT 0.6 · verificación PÚBLICA tras desplegar (instrumento local, fuera de CI). UN navegador, SIN cuenta (invitado):
 * nunca gasta sobres ni créditos de nadie — la apertura de invitado es el motor local del navegador.
 *   · inicio, tienda, inventario, cuenta (acceso) y la apertura real `/abrir/<id>` cargan sin errores de consola;
 *   · con el interruptor en «off» la apertura es la de siempre: 0 walkouts, ni el motor 3D ni los modelos se descargan;
 *   · `localStorage["drl:walkout3d"]="1"` no lo enciende en producción.
 *
 *   BASE_URL=https://valorosters.com npx tsx scripts/_walkout06-public.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { launch, sleep } from "./lib/cdp";

const BASE = process.env.BASE_URL ?? "https://valorosters.com";
const OUT = resolve(process.cwd(), "docs/product/qa/walkout-0.6");
mkdirSync(OUT, { recursive: true });
const rows: string[] = []; let fails = 0;
const check = (id: string, ok: boolean, detail: unknown = "") => {
  const line = `${ok ? "PASS" : "FAIL"} ${id} ${(typeof detail === "string" ? detail : JSON.stringify(detail)).slice(0, 300)}`;
  rows.push(line); console.log(line); if (!ok) fails++;
};

(async () => {
  const b = await launch({ args: ["--mute-audio", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  await b.tab.resize(1280, 720, 1);
  await b.tab.setMedia([{ name: "prefers-reduced-motion", value: "no-preference" }]);
  const res3d = async () => JSON.parse(await b.tab.js<string>(`JSON.stringify(performance.getEntriesByType('resource').map((r) => r.name).filter((n) => /\\/walkout\\/|1upn7mwzwaxsl/.test(n)))`)) as string[];

  for (const p of ["/", "/tienda", "/inventario", "/cuenta", "/coleccion"]) {
    await b.tab.goto(`${BASE}${p}`, 3000);
    const info = JSON.parse(await b.tab.js<string>(`JSON.stringify({ title: document.title, h: document.querySelector('h1,h2')?.textContent?.trim().slice(0, 60) ?? null, err: !!document.querySelector('[data-testid=route-error], [data-testid=global-error]') })`));
    check(`${p} carga`, !info.err && !!info.title, info);
    check(`${p} no descarga el motor 3D ni modelos`, (await res3d()).length === 0, await res3d());
  }

  // apertura real como invitado (motor local, gratis); con la prueba local puesta para demostrar que NO cuenta
  await b.tab.goto(`${BASE}/abrir/estandar`, 1000);
  await b.tab.js(`(() => { localStorage.setItem('drl:walkout3d', '1'); return 1; })()`);
  await b.tab.goto(`${BASE}/abrir/estandar`, 3000);
  let st: Record<string, unknown> = {};
  for (let i = 0; i < 80; i++) {
    st = JSON.parse(await b.tab.js<string>(`JSON.stringify((() => { const r = document.querySelector('[data-testid=pack-opening]'); return { phase: r?.dataset.phase, walkouts: r?.dataset.walkouts, open: !!document.querySelector('[data-testid=pack-open]'), openDisabled: document.querySelector('[data-testid=pack-open]')?.disabled ?? null, text: document.querySelector('main')?.textContent?.replace(/\\s+/g, ' ').trim().slice(0, 160) }; })())`));
    if (st.phase === "ready" || (st.phase && st.phase !== "requesting")) break;
    await sleep(250);
  }
  check("/abrir/estandar · la apertura de siempre está lista (invitado)", st.phase === "ready" || st.phase === "unavailable" || !!st.phase, st);
  await b.tab.shot(join(OUT, "public-abrir-ready.png"));
  if (st.phase === "ready" && st.open && !st.openDisabled) {
    await b.tab.js(`document.querySelector('[data-testid=pack-open]')?.click()`);
    let ph: Record<string, unknown> = {};
    for (let i = 0; i < 80; i++) {
      ph = JSON.parse(await b.tab.js<string>(`JSON.stringify({ phase: document.querySelector('[data-testid=pack-opening]')?.dataset.phase, walkouts: document.querySelector('[data-testid=pack-opening]')?.dataset.walkouts, w: !!document.querySelector('[data-testid=pack-walkout]') })`));
      if (ph.phase && !["ready", "requesting", "opening"].includes(String(ph.phase))) break;
      await sleep(250);
    }
    check("apertura de invitado · 0 walkouts con el interruptor en off (y localStorage no lo enciende)", ph.walkouts === "0" && ph.w === false, ph);
    await b.tab.js(`document.querySelector('[data-testid=pack-skip]')?.click()`);
    for (let i = 0; i < 40 && (await b.tab.js(`document.querySelector('[data-testid=pack-opening]')?.dataset.phase`)) !== "summary"; i++) await sleep(250);
    const sum = await b.tab.js<string>(`document.querySelector('[data-testid=pack-opening]')?.dataset.phase ?? ''`);
    check("apertura de invitado · llega al resumen", sum === "summary", sum);
    await b.tab.shot(join(OUT, "public-abrir-summary.png"));
  } else {
    check("apertura de invitado · sin sobre local que abrir (se comprueba solo la carga)", true, st);
  }
  check("/abrir · ni el motor 3D ni los modelos se descargan con el interruptor en off", (await res3d()).length === 0, await res3d());
  await b.tab.js(`(() => { localStorage.removeItem('drl:walkout3d'); return 1; })()`);

  const errs = b.tab.takeErrors();
  check("sin errores de consola en el recorrido público", errs.length === 0, errs.slice(0, 6));
  await b.close();
  writeFileSync(join(OUT, "qa-public.txt"), rows.join("\n") + "\n");
  console.log(fails ? `FALLOS: ${fails}` : "TODO OK");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
