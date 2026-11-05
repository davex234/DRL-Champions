/**
 * WALKOUT 0.7 · verificación PÚBLICA con el interruptor en «all» (instrumento local, fuera de CI). UN navegador, SIN
 * cuenta: el invitado juega en local (motor del navegador), así que no hay servidor, ni cuenta, ni crédito real.
 * Para que salgan especiales se le deja al invitado de ESTE navegador un sobre Icon en su estado local; el walkout lo
 * enciende el interruptor del build (no hay ninguna clave de prueba puesta) y las cartas las sortea el motor real.
 *
 *   BASE_URL=https://valorosters.com npx tsx scripts/_walkout07-public.ts [ancho] [motion|reduced] [packId]
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { launch, sleep } from "./lib/cdp";
import { getCard } from "../src/data/catalog";
import { walkoutIntensityForCard } from "../src/domain/walkout/packWalkout";

const BASE = process.env.BASE_URL ?? "https://valorosters.com";
const width = Number(process.argv[2] ?? 1280), height = width < 600 ? 844 : 720;
const reduced = (process.argv[3] ?? "motion") === "reduced";
const PACK = process.argv[4] ?? "icon";
// WALKOUT 0.8 · preferencia «Animaciones de apertura» del jugador (cinematic | auto | reduced); sin argumento = sin guardar
const PREF = process.argv[5] ?? "";
const OUT = resolve(process.cwd(), process.env.QA_OUT ?? "docs/product/qa/walkout-0.7");
mkdirSync(OUT, { recursive: true });
let fails = 0;
const tag = `${width}${reduced ? "-reduced" : ""}-${PACK}${PREF ? `-${PREF}` : ""}`;
const check = (id: string, ok: boolean, d: unknown = "") => {
  const line = `${ok ? "PASS" : "FAIL"} [${tag}] ${id} ${(typeof d === "string" ? d : JSON.stringify(d)).slice(0, 320)}`;
  console.log(line); appendFileSync(join(OUT, "qa-public-live.txt"), line + "\n"); if (!ok) fails++;
};

(async () => {
  const b = await launch({ args: ["--mute-audio", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  await b.tab.resize(width, height, 1);
  await b.tab.setMedia([{ name: "prefers-reduced-motion", value: reduced ? "reduce" : "no-preference" }]);
  await b.tab.goto(`${BASE}/inventario`, 3000);
  const noKey = await b.tab.js<boolean>(`localStorage.getItem('drl:walkout3d') === null`);
  check("sin ninguna clave de prueba del walkout en el navegador", noKey);
  await b.tab.js(`(() => { const k = 'drl-champions'; const j = JSON.parse(localStorage.getItem(k)); const s = j.state ?? j; s.unopenedPacks = { ...s.unopenedPacks, ${JSON.stringify(PACK)}: 1 }; localStorage.setItem(k, JSON.stringify(j)); ${PREF ? `localStorage.setItem('drl:opening-animation:v1', '${PREF}');` : ""} return 1; })()`);
  await b.tab.goto(`${BASE}/abrir/${PACK}`, 3500);
  const pre = JSON.parse(await b.tab.js<string>(`JSON.stringify({ phase: document.querySelector('[data-testid=pack-opening]')?.dataset.phase, three: performance.getEntriesByType('resource').some((r) => /\\/walkout\\//.test(r.name)) })`));
  check("apertura real lista y sin 3D descargado antes de abrir", pre.phase === "ready" && !pre.three, pre);
  await b.tab.js(`document.querySelector('[data-testid=pack-open]')?.click()`);
  let s: Record<string, string | undefined> = {};
  for (let i = 0; i < 60; i++) {
    s = JSON.parse(await b.tab.js<string>(`JSON.stringify({ phase: document.querySelector('[data-testid=pack-opening]')?.dataset.phase, walkouts: document.querySelector('[data-testid=pack-opening]')?.dataset.walkouts })`));
    if (s.phase && !["ready", "requesting"].includes(s.phase)) break;
    await sleep(250);
  }
  const total = Number(s.walkouts ?? 0);
  const seen: { card?: string; intensity?: string; code?: string; stage?: string; arena?: string }[] = [];
  for (let k = 0; k < total; k++) {
    let w: Record<string, string | undefined> = {};
    for (let i = 0; i < 160; i++) {
      w = JSON.parse(await b.tab.js<string>(`JSON.stringify((() => { const p = document.querySelector('[data-testid=pack-walkout]'); const d = document.querySelector('[data-testid=walkout]'); const c = document.querySelector('[data-testid=walkout-stage-3d]'); return { idx: p?.dataset.walkoutIndex, card: p?.dataset.walkoutCard, intensity: p?.dataset.walkoutIntensity, code: d?.dataset.identityCode, stage: d?.dataset.stage, arena: c?.dataset.arenaCode, human: c?.dataset.human }; })())`));
      if (w.idx === String(k) && (w.stage === "2d" || w.human === "ready")) break;
      await sleep(250);
    }
    seen.push({ card: w.card, intensity: w.intensity, code: w.code, stage: w.stage, arena: w.arena });
    if (k === 0) { await sleep(reduced ? 800 : 3500); await b.tab.shot(join(OUT, `public-live-${tag}-walkout1.png`)); }
    await b.tab.js(`document.querySelector('[data-testid=walkout-skip]')?.click()`);
    for (let i = 0; i < 40 && (await b.tab.js(`document.querySelector('[data-testid=pack-walkout]')?.dataset.walkoutDone`)) !== "1"; i++) await sleep(200);
    if (k === 0) await b.tab.shot(join(OUT, `public-live-${tag}-walkout1-final.png`));
    await b.tab.js(`document.querySelector('[data-testid=pack-walkout-continue]')?.click()`);
    await sleep(500);
  }
  await b.tab.js(`document.querySelector('[data-testid=pack-skip]')?.click()`);
  for (let i = 0; i < 60 && (await b.tab.js(`document.querySelector('[data-testid=pack-opening]')?.dataset.phase`)) !== "summary"; i++) await sleep(250);
  const ids = JSON.parse(await b.tab.js<string>(`JSON.stringify(Object.values(Object.fromEntries([...document.querySelectorAll('[data-testid=summary-card][data-uid]')].map((e) => [e.dataset.uid, e.dataset.cardId]))))`)) as string[];
  await b.tab.shot(join(OUT, `public-live-${tag}-summary.png`));
  const specials = ids.map((id) => getCard(id)).filter((c) => c && walkoutIntensityForCard(c) !== "STANDARD");
  check("resumen con las cartas sorteadas", ids.length > 0, ids);
  check("un walkout por cada especial sorteada (Champions S / Future Star / Record Breaker / Moments)", total === specials.length, { walkouts: total, specials: specials.map((c) => c!.id) });
  check("cada walkout = carta, intensidad e identidad reales", seen.every((w, i) => {
    const c = getCard(w.card ?? ""); return !!c && w.intensity === walkoutIntensityForCard(c) && !!w.code && (w.stage === "2d" || w.arena === w.code) && specials.some((x) => x!.id === c.id) && i >= 0;
  }), seen);
  const want3d = PREF === "cinematic" || (PREF !== "reduced" && !reduced);
  check(want3d ? "→ 3D (persona y arena del país)" : "→ 2D", seen.length === 0 || seen.every((w) => w.stage === (want3d ? "3d" : "2d")), seen.map((w) => w.stage));
  const errs = b.tab.takeErrors();
  check("sin errores de consola", errs.length === 0, errs.slice(0, 5));
  await b.close();
  console.log(fails ? `FALLOS: ${fails}` : "TODO OK");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
