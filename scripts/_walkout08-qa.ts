/**
 * WALKOUT 0.8 · QA del NPC 3D en una BUILD DE PRODUCCIÓN (instrumento local, fuera de CI). UN navegador a la vez.
 * Contra el contenedor de QA aislado (sin BD) por túnel: arnés `/design-system/fase81?scene=w-ph` = la apertura REAL
 * (`PackOpeningExperience`) con resultado fijo de cartas reales (Filipinas MEGA → Turquía WALKOUT → Canadá MEGA).
 *
 *   1 movimiento reducido + Automático → 2D (REDUCED_MOTION), SIN descargar three.js ni modelos; «Ver en 3D» → 3D
 *   2 movimiento reducido + Cinemática 3D (1440) → persona 3D que camina y celebra, arena = país de CADA carta
 *   3 sin preferencia del sistema + Automático (390, móvil) → 3D
 *   4 Reducidas → 2D sin three.js
 *   5 sin WebGL + Cinemática → 2D (WEBGL_UNAVAILABLE) y la carta se presenta
 *   6 pérdida de contexto WebGL a mitad → 2D (WEBGL_CONTEXT_LOST) y sigue
 *   7 el modelo no carga → 2D (MODEL_LOAD_FAILED) y sigue
 * En todos: 1 apertura, resumen alcanzado.
 *
 *   BASE_URL=http://127.0.0.1:3016 THREE_CHUNK=<nombre>.js npx tsx scripts/_walkout08-qa.ts
 */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { launch, sleep } from "./lib/cdp";
import { CARDS, getCard, getPlayer } from "../src/data/catalog";
import { buildRevealPlan, toOpenedInstances } from "../src/domain/packs/reveal";
import { packWalkoutQueue } from "../src/domain/walkout/packWalkout";
import { f81Results } from "../src/app/design-system/fase81/fixtures";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3016";
const THREE = process.env.THREE_CHUNK ?? "__sin_chunk__";
const OUT = resolve(process.cwd(), process.env.QA_OUT ?? "docs/product/qa/walkout-0.8");   // 0.9: reutilizable sin pisar la evidencia de 0.8
mkdirSync(OUT, { recursive: true });
const LOG = join(OUT, "qa-prod-build.txt");
if (!process.argv[2]) writeFileSync(LOG, "");
let fails = 0;
const check = (id: string, ok: boolean, d: unknown = "") => {
  const line = `${ok ? "PASS" : "FAIL"} ${id} ${(typeof d === "string" ? d : JSON.stringify(d)).slice(0, 340)}`;
  console.log(line); appendFileSync(LOG, line + "\n"); if (!ok) fails++;
};
// el orden REAL de presentación lo da el plan de revelado (el mismo dominio que la apertura), no el del sobre
const CODE: Record<string, string> = { patmen__record_breaker: "PHL", "patmen__record-breaker": "PHL", "lar0k__future-star": "TUR", "mada__moments": "CAN" };
const EXP = packWalkoutQueue(buildRevealPlan(toOpenedInstances(f81Results("w-ph")), null, { cards: CARDS, getCard, getPlayer }).order).map((q) => ({ card: q.cardId, code: CODE[q.cardId], intensity: q.intensity }));
if (EXP.length !== 3 || EXP.some((e) => !e.code)) throw new Error("cola inesperada: " + JSON.stringify(EXP));
console.log("orden real:", EXP.map((e) => `${e.card}:${e.code}`).join(" → "));

type Opts = { name: string; width: number; reduced: boolean; pref: "auto" | "cinematic" | "reduced" | null; args?: string[]; before?: string; during?: (t: Tab) => Promise<void>; expect: "3d" | "2d"; why?: string; full?: boolean; switchTo3d?: boolean; noThree?: boolean };
type Tab = Awaited<ReturnType<typeof launch>>["tab"];

const ONLY = (process.argv[2] ?? "").split(",").filter(Boolean);
async function scenario(o: Opts) {
  if (ONLY.length && !ONLY.some((k) => o.name.startsWith(k))) return;
  const b = await launch({ args: ["--mute-audio", ...(o.args ?? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])] });
  const t = b.tab;
  await t.resize(o.width, o.width < 600 ? 844 : 900, 1);
  await t.setMedia([{ name: "prefers-reduced-motion", value: o.reduced ? "reduce" : "no-preference" }]);
  await t.goto(`${BASE}/design-system/fase81?scene=w-std`, 1200);
  await t.js(`(() => { ${o.pref ? `localStorage.setItem('drl:opening-animation:v1', '${o.pref}')` : `localStorage.removeItem('drl:opening-animation:v1')`}; return 1; })()`);
  await t.goto(`${BASE}/design-system/fase81?scene=w-ph&reset=1`, 2500);
  if (o.before) await t.js(o.before);
  for (let i = 0; i < 80 && (await t.js(`document.querySelector('[data-testid=pack-opening]')?.dataset.phase`)) !== "ready"; i++) await sleep(250);
  await t.js(`document.querySelector('[data-testid=pack-open]')?.click()`);
  const st = async () => JSON.parse(await t.js<string>(`JSON.stringify((() => { const r = document.querySelector('[data-testid=pack-opening]'); const p = document.querySelector('[data-testid=pack-walkout]'); const d = document.querySelector('[data-testid=walkout]'); const c = document.querySelector('[data-testid=walkout-stage-3d]'); return { phase: r?.dataset.phase, walkouts: r?.dataset.walkouts, opens: sessionStorage.getItem('f81-opens'), idx: p?.dataset.walkoutIndex, card: p?.dataset.walkoutCard, intensity: p?.dataset.walkoutIntensity, done: p?.dataset.walkoutDone, stage: p?.dataset.walkoutStage, why: p?.dataset.walkoutStageWhy, pref: p?.dataset.walkoutPref, code: d?.dataset.identityCode, status: d?.dataset.status, t: d?.dataset.t, cele: d?.dataset.celebration, arena: c?.dataset.arenaCode, human: c?.dataset.human, mode: document.querySelector('[data-testid=pack-walkout-mode]')?.textContent?.trim() ?? null, three: performance.getEntriesByType('resource').filter((e) => e.name.includes('${THREE}') || /\\/walkout\\/human\\//.test(e.name)).length }; })())`)) as Record<string, string | number | null>;
  const wait = async (pred: (s: Record<string, string | number | null>) => boolean, ms: number) => { const t0 = Date.now(); let s = await st(); while (!pred(s) && Date.now() - t0 < ms) { await sleep(200); s = await st(); } return s; };
  const tag = `[${o.name}]`;

  let s = await wait((x) => x.phase === "walkout" && !!x.stage && (x.stage === "2d" || x.human === "ready" || x.human === "failed" || x.human === "timeout"), 40000);
  if (o.during) { await o.during(t); s = await wait((x) => x.stage === "2d", 20000); }
  check(`${tag} 1.ª especial: escenario ${o.expect}${o.why ? ` (${o.why})` : ""}`, s.stage === o.expect && (!o.why || s.why === o.why), s);
  check(`${tag} 1.ª especial = ${EXP[0].card} · ${EXP[0].code}`, s.card === EXP[0].card && s.code === EXP[0].code && s.intensity === EXP[0].intensity && (s.stage === "2d" || s.arena === EXP[0].code), { card: s.card, code: s.code, arena: s.arena, intensity: s.intensity });
  if (o.noThree) check(`${tag} sin descargar three.js ni el modelo`, s.three === 0, { three: s.three });

  if (o.switchTo3d) {
    check(`${tag} el reproductor ofrece «Ver en 3D»`, s.mode === "Ver en 3D", s.mode);
    await t.js(`document.querySelector('[data-testid=pack-walkout-mode]')?.click()`);
    s = await wait((x) => x.stage === "3d" && x.human === "ready", 40000);
    check(`${tag} «Ver en 3D» → persona 3D en la arena de SU país, preferencia guardada (Cinemática)`, s.stage === "3d" && s.human === "ready" && s.arena === EXP[0].code && s.pref === "cinematic" && (await t.js(`localStorage.getItem('drl:opening-animation:v1')`)) === "cinematic", s);
  }
  if (o.full) {
    // la 1.ª carta entera, sin saltar: camina, celebra y revela la carta (capturas a lo largo)
    const shots: string[] = [];
    let celeSeen = "", maxT = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < 60000) {
      s = await st(); maxT = Math.max(maxT, Number(s.t ?? 0));
      if (s.cele) celeSeen = String(s.cele);
      const sec = Math.floor(Number(s.t ?? 0));
      if ([3, 6, 9, 11].includes(sec) && !shots.includes(String(sec))) { shots.push(String(sec)); await t.shot(join(OUT, `${o.name}-w1-t${sec}.png`)); }
      if (s.done === "1") break;
      await sleep(250);
    }
    await t.shot(join(OUT, `${o.name}-w1-final.png`));
    check(`${tag} la persona camina, celebra (${celeSeen || "?"}) y la carta se revela (fin a t=${maxT.toFixed(1)} s)`, s.done === "1" && s.stage === "3d" && !!celeSeen && maxT > 8, { done: s.done, cele: celeSeen, maxT });
    // REPETIR: solo la animación
    await t.js(`document.querySelector('[data-testid=pack-walkout-replay]')?.click()`);
    const r = await wait((x) => x.done === "0", 4000);
    check(`${tag} REPETIR = misma carta, 1 apertura`, r.card === EXP[0].card && r.opens === "1", { card: r.card, opens: r.opens });
    await t.js(`document.querySelector('[data-testid=walkout-skip]')?.click()`);
  }
  // el resto de especiales: cada una con SU país (nunca la anterior)
  for (let k = 0; k < EXP.length; k++) {
    s = await wait((x) => x.idx === String(k) && !!x.stage && (x.stage === "2d" || x.human === "ready"), 40000);
    check(`${tag} especial ${k + 1}/3 = ${EXP[k].card} · ${EXP[k].code}`, s.card === EXP[k].card && s.code === EXP[k].code && s.intensity === EXP[k].intensity && (s.stage === "2d" || s.arena === EXP[k].code), { card: s.card, code: s.code, arena: s.arena, stage: s.stage, why: s.why });
    if (s.done !== "1") { await t.js(`document.querySelector('[data-testid=walkout-skip]')?.click()`); await wait((x) => x.done === "1", 10000); }
    // 0.9: «Continuar» se monta un instante DESPUÉS de done=1 — se reintenta hasta que la especial cambia (carrera del instrumento)
    for (let r = 0; r < 8; r++) {
      await t.js(`document.querySelector('[data-testid=pack-walkout-continue]')?.click()`);
      await sleep(500);
      const n = await st(); if (n.idx !== String(k) || n.phase !== "walkout") break;
    }
  }
  await t.js(`document.querySelector('[data-testid=pack-skip]')?.click()`);
  s = await wait((x) => x.phase === "summary", 15000);
  check(`${tag} resumen alcanzado, 1 sola apertura`, s.phase === "summary" && s.opens === "1", { phase: s.phase, opens: s.opens });
  const errs = t.takeErrors().filter((e) => !/Failed to load resource|503|401|fetch failed|supabase|ERR_NAME_NOT_RESOLVED|QA · modelo bloqueado/i.test(e));
  check(`${tag} consola sin errores (salvo la BD ausente del contenedor de QA)`, errs.length === 0, errs.slice(0, 4));
  await b.close();
}

(async () => {
  const blockModel = `(() => { const f = window.fetch; window.fetch = function (u, ...a) { if (/\\/walkout\\/human\\//.test(String(u && u.url || u))) return Promise.reject(new TypeError('QA · modelo bloqueado')); return f.call(this, u, ...a); }; return 1; })()`;
  const loseCtx = async (t: Tab) => { await t.js(`(() => { const c = document.querySelector('[data-testid=walkout-stage-3d]'); const g = c && (c.getContext('webgl2') || c.getContext('webgl')); g?.getExtension('WEBGL_lose_context')?.loseContext(); return !!g; })()`); };
  await scenario({ name: "s1-reducido-auto-1440", width: 1440, reduced: true, pref: null, expect: "2d", why: "REDUCED_MOTION", noThree: true, switchTo3d: true });
  await scenario({ name: "s2-reducido-cinematica-1440", width: 1440, reduced: true, pref: "cinematic", expect: "3d", why: "WEBGL", full: true });
  await scenario({ name: "s3-nopref-auto-390", width: 390, reduced: false, pref: null, expect: "3d", why: "WEBGL", full: true });
  await scenario({ name: "s4-reducidas-1440", width: 1440, reduced: false, pref: "reduced", expect: "2d", why: "REDUCED_MOTION", noThree: true });
  await scenario({ name: "s5-sinwebgl-cinematica-1440", width: 1440, reduced: false, pref: "cinematic", args: ["--disable-3d-apis"], expect: "2d", why: "WEBGL_UNAVAILABLE" });
  await scenario({ name: "s6-contexto-perdido-1440", width: 1440, reduced: false, pref: "cinematic", during: loseCtx, expect: "2d", why: "WEBGL_CONTEXT_LOST" });
  await scenario({ name: "s7-modelo-falla-1440", width: 1440, reduced: false, pref: "cinematic", before: blockModel, expect: "2d", why: "MODEL_LOAD_FAILED" });
  console.log(fails ? `FALLOS: ${fails}` : "TODO OK");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
