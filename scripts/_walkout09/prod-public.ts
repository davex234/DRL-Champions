/**
 * WALKOUT 0.9 · verificación PÚBLICA en producción (instrumento local, fuera de CI). Igual que `_walkout07-public.ts`:
 * invitado SIN cuenta, motor local del navegador (ni servidor, ni cuenta, ni crédito real); se deja un sobre en el
 * estado local de ESTE navegador. Además: el PRIMER walkout se deja correr entero (sin Omitir) para medir la
 * celebración, el final y «Continuar»; el resto se omite.
 *
 *   BASE_URL=https://valorosters.com npx tsx scripts/_walkout09/prod-public.ts [ancho] [packId] [pref]
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { launch, sleep } from "../lib/cdp";
import { getCard, getPlayer } from "../../src/data/catalog";
import { walkoutIntensityForCard } from "../../src/domain/walkout/packWalkout";
import { walkoutIdentityFromCard } from "../../src/domain/walkout/input";

const BASE = process.env.BASE_URL ?? "https://valorosters.com";
const width = Number(process.argv[2] ?? 1280), height = width < 600 ? 844 : 720;
const PACK = process.argv[3] ?? "icon";
const PREF = process.argv[4] ?? "cinematic";
const OUT = resolve(process.cwd(), process.env.QA_OUT ?? "docs/product/qa/walkout-0.9-prod");
mkdirSync(OUT, { recursive: true });
let fails = 0;
const tag = `${width}-${PACK}-${PREF}`;
const check = (id: string, ok: boolean, d: unknown = "") => {
  const line = `${ok ? "PASS" : "FAIL"} [${tag}] ${id} ${(typeof d === "string" ? d : JSON.stringify(d)).slice(0, 400)}`;
  console.log(line); appendFileSync(join(OUT, "qa-prod.txt"), line + "\n"); if (!ok) fails++;
};
const J = <T>(s: string) => JSON.parse(s) as T;

(async () => {
  const b = await launch({ args: ["--mute-audio", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  await b.tab.resize(width, height, 1);
  await b.tab.setMedia([{ name: "prefers-reduced-motion", value: "no-preference" }]);
  await b.tab.goto(`${BASE}/inventario`, 3000);
  await b.tab.js(`(() => { const k = 'drl-champions'; const j = JSON.parse(localStorage.getItem(k)); const s = j.state ?? j; s.unopenedPacks = { ...s.unopenedPacks, ${JSON.stringify(PACK)}: 1 }; localStorage.setItem(k, JSON.stringify(j)); localStorage.setItem('drl:opening-animation:v1', '${PREF}'); return 1; })()`);
  await b.tab.goto(`${BASE}/abrir/${PACK}`, 3500);
  const net0 = await b.tab.js<number>(`performance.getEntriesByType('resource').filter((r) => /\\/api\\/game\\//.test(r.name)).length`);
  await b.tab.js(`document.querySelector('[data-testid=pack-open]')?.click()`);
  let s: Record<string, string | undefined> = {};
  for (let i = 0; i < 60; i++) {
    s = J(await b.tab.js<string>(`JSON.stringify({ phase: document.querySelector('[data-testid=pack-opening]')?.dataset.phase, walkouts: document.querySelector('[data-testid=pack-opening]')?.dataset.walkouts })`));
    if (s.phase && !["ready", "requesting"].includes(s.phase)) break;
    await sleep(250);
  }
  const total = Number(s.walkouts ?? 0);
  check("hay al menos un walkout en el sobre", total > 0, s);
  const seen: Record<string, unknown>[] = [];
  for (let k = 0; k < total; k++) {
    let w: Record<string, string | undefined> = {};
    for (let i = 0; i < 200; i++) {
      w = J(await b.tab.js<string>(`JSON.stringify((() => { const p = document.querySelector('[data-testid=pack-walkout]'); const d = document.querySelector('[data-testid=walkout]'); const c = document.querySelector('[data-testid=walkout-stage-3d]'); return { idx: p?.dataset.walkoutIndex, card: p?.dataset.walkoutCard, intensity: p?.dataset.walkoutIntensity, code: d?.dataset.identityCode, team: d?.dataset.identityTeam, stage: d?.dataset.stage, cele: d?.dataset.celebration, human: c?.dataset.human, humanMs: c?.dataset.humanMs }; })())`));
      if (w.idx === String(k) && (w.stage === "2d" || w.human === "ready")) break;
      await sleep(250);
    }
    const card = getCard(w.card ?? "");
    const want = card ? walkoutIdentityFromCard(card, getPlayer(card.playerId)) : undefined;
    check(`walkout ${k + 1}: persona 3D cargada`, w.stage === "3d" && w.human === "ready", w);
    check(`walkout ${k + 1}: bandera = nacionalidad real de la carta`, !!want && w.code === (want.nationality.code ?? ""), { got: w.code, want: want?.nationality.code });
    check(`walkout ${k + 1}: escudo = equipo de la carta`, !!want && w.team === want.team.tag, { got: w.team, want: want?.team.tag });
    if (k === 0) {
      // Se deja correr entero: muestreo de t/estado/celebración y capturas en la caminata, la celebración y el final.
      const trace: string[] = []; let shotWalk = false, shotCele = false, end: Record<string, string | undefined> = {};
      for (let i = 0; i < 160; i++) {
        end = J(await b.tab.js<string>(`JSON.stringify((() => { const d = document.querySelector('[data-testid=walkout]'); const p = document.querySelector('[data-testid=pack-walkout]'); return { t: d?.dataset.t, status: d?.dataset.status, cele: d?.dataset.celebration, done: p?.dataset.walkoutDone, cont: !!document.querySelector('[data-testid=pack-walkout-continue]') }; })())`));
        trace.push(`${end.t}:${end.status}`);
        const t = Number(end.t ?? 0);
        if (!shotWalk && t > 2.2) { await b.tab.shot(join(OUT, `prod-${tag}-1-caminata.png`)); shotWalk = true; }
        if (!shotCele && t > 7.5) { await b.tab.shot(join(OUT, `prod-${tag}-2-celebracion-${end.cele}.png`)); shotCele = true; }
        if (end.done === "1" || end.status === "done") break;
        await sleep(250);
      }
      await b.tab.shot(join(OUT, `prod-${tag}-3-final.png`));
      check("walkout 1 completo sin Omitir: termina y ofrece Continuar", (end.done === "1" || end.status === "done") && end.cele !== undefined, { end, muestras: trace.length, ultimo: trace.at(-1) });
      check("celebración de 0.9 elegida", ["POINT_SKY", "SHUSH", "HYPE_JUMP", "ARMS_CROSSED", ""].includes(end.cele ?? "?"), end.cele);
      seen.push({ ...w, cele: end.cele });
    } else {
      // «Omitir» solo existe con el walkout en `playing` (WalkoutDirector): esperar a que aparezca antes de pulsarlo.
      for (let i = 0; i < 40 && !(await b.tab.js<boolean>(`!!document.querySelector('[data-testid=walkout-skip]')`)); i++) await sleep(150);
      await b.tab.js(`document.querySelector('[data-testid=walkout-skip]')?.click()`);
      for (let i = 0; i < 40 && (await b.tab.js(`document.querySelector('[data-testid=pack-walkout]')?.dataset.walkoutDone`)) !== "1"; i++) await sleep(200);
      check(`walkout ${k + 1}: Omitir lleva al final`, (await b.tab.js(`document.querySelector('[data-testid=pack-walkout]')?.dataset.walkoutDone`)) === "1");
      seen.push(w);
    }
    for (let i = 0; i < 20 && !(await b.tab.js<boolean>(`!!document.querySelector('[data-testid=pack-walkout-continue]')`)); i++) await sleep(150);
    await b.tab.js(`document.querySelector('[data-testid=pack-walkout-continue]')?.click()`);
    await sleep(600);
  }
  await b.tab.js(`document.querySelector('[data-testid=pack-skip]')?.click()`);
  for (let i = 0; i < 60 && (await b.tab.js(`document.querySelector('[data-testid=pack-opening]')?.dataset.phase`)) !== "summary"; i++) await sleep(250);
  const ids = J<string[]>(await b.tab.js<string>(`JSON.stringify(Object.values(Object.fromEntries([...document.querySelectorAll('[data-testid=summary-card][data-uid]')].map((e) => [e.dataset.uid, e.dataset.cardId]))))`));
  await b.tab.shot(join(OUT, `prod-${tag}-4-resumen.png`));
  const specials = ids.map((id) => getCard(id)).filter((c) => c && walkoutIntensityForCard(c) !== "STANDARD");
  check("Continuar llega al resumen con las cartas sorteadas", ids.length > 0, ids);
  check("cada walkout revela una carta sorteada de ese sobre (y uno por especial)", total === specials.length && seen.every((w) => ids.includes(String(w.card))), { walkouts: seen.map((w) => w.card), specials: specials.map((c) => c!.id) });
  const asset = await b.tab.js<string>(`JSON.stringify(performance.getEntriesByType('resource').filter((r) => /\\/walkout\\/human\\//.test(r.name)).map((r) => r.name.split('/').pop()))`);
  check("asset 3D de 0.9 descargado", /rocketbox-player\.gltf/.test(asset) && /rocketbox-player\.bin/.test(asset), asset);
  const net1 = await b.tab.js<number>(`performance.getEntriesByType('resource').filter((r) => /\\/api\\/game\\//.test(r.name)).length`);
  check("invitado: ninguna llamada nueva a /api/game durante la apertura (motor local)", net1 === net0, { antes: net0, despues: net1 });
  const errs = b.tab.takeErrors();
  check("sin errores de consola ni CSP", errs.length === 0, errs.slice(0, 5));
  await b.close();
  console.log(fails ? `FALLOS: ${fails}` : "TODO OK");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
