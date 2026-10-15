/**
 * APERTURA DE SOBRES · SALA POR RAREZA (instrumento, fuera de CI; 2026-10-15) — arnés `/design-system/fase81` (cartas
 * REALES con resultado FIJO: no abre sobres reales, no toca servidor, créditos ni inventario).
 *
 *   BASE_URL=http://127.0.0.1:3019 npx tsx scripts/_pack-atmosphere-qa.ts     (servidor local con NEXUS_QA_HARNESS=1)
 *
 * Por ancho (390/768/1440) y movimiento (normal/reducido):
 *   · r-mixed (las 7 clases): sobre → hero → resto carta a carta → resumen. En cada revelado la sala es la de ESA carta
 *     (clave y uid), la de la carta anterior ya no está en pantalla, sin monigote (ni walkout ni <canvas>) en ninguna
 *     fase; ATRÁS vuelve a una carta vista (boca arriba) y a la hero; el resumen trae las MISMAS cartas y 1 apertura.
 *   · r-masters / r-icon / r-gold: la hero con sala lila / marfil / dorada; ficha legible (tinta oscura en marfil).
 *   · maquetación: carta, ficha y botones dentro del viewport sin solaparse; sin desborde horizontal; imagen cargada.
 *   · CERRAR a mitad del resto → /packs; OMITIR en la tensión → resumen.
 *   · consola sin errores y ninguna respuesta ≥ 400 (los 503 de /api/content sin BD local se anotan aparte).
 * Capturas en docs/product/qa/pack-atmosphere-2026-10-15/, informe en logs/pack-atmosphere-qa/report.json.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep, type Tab } from "./lib/cdp";
import { CARDS, getCard, getPlayer } from "../src/data/catalog";
import { buildRevealPlan, toOpenedInstances } from "../src/domain/packs/reveal";
import { atmosphereForCard } from "../src/domain/packs/atmosphere";
import { f81Results, type F81Scene } from "../src/app/design-system/fase81/fixtures";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3019";
if (/valorosters\.com|:3005\b/.test(BASE)) throw new Error("solo contra un servidor local de QA");
const SHOTS = join(process.cwd(), "docs/product/qa/pack-atmosphere-2026-10-15");
const LOGS = join(process.cwd(), "logs/pack-atmosphere-qa");
mkdirSync(SHOTS, { recursive: true }); mkdirSync(LOGS, { recursive: true });
const CAT = { cards: CARDS, getCard, getPlayer };
const WIDTHS = (process.env.QA_WIDTHS ?? "390,768,1440").split(",").map(Number);
const MOTIONS = (process.env.QA_MOTIONS ?? "normal,reduced").split(",");
const H: Record<number, number> = { 390: 844, 768: 1024, 1440: 900 };

const rows: { scope: string; id: string; ok: boolean; detail: string }[] = [];
const check = (scope: string, id: string, ok: boolean, detail: unknown = "") => {
  const d = typeof detail === "string" ? detail : JSON.stringify(detail);
  rows.push({ scope, id, ok, detail: d.slice(0, 600) });
  console.log(`${ok ? "PASS" : "FAIL"} · ${scope} · ${id}${ok ? "" : ` — ${d.slice(0, 300)}`}`);
};
const noise = (e: string) => !/favicon|ERR_ABORTED|React DevTools|GPU stall|WebGL|GL Driver|swiftshader/i.test(e);
const envOnly = (r: string) => /^503 \/api\/content\//.test(r);

function expected(scene: F81Scene) {
  const res = f81Results(scene);
  const plan = buildRevealPlan(toOpenedInstances(res), null, CAT);
  const hero = plan.hero.ok ? plan.hero.hero : null;
  const rest = plan.order.filter((i) => i.uid !== hero?.uid);
  return { res, hero, rest, key: (uid: string) => atmosphereForCard(res.find((r) => r.uid === uid)!.card).key };
}

const waitFor = async (tab: Tab, expr: string, ms: number) => {
  for (const t0 = Date.now(); Date.now() - t0 < ms; await sleep(50)) if (await tab.js<boolean>(expr).catch(() => false)) return true;
  return false;
};
const click = (tab: Tab, tid: string) => tab.js<boolean>(`(() => { const b = document.querySelector('[data-testid="${tid}"]'); if (!b) return false; b.click(); return true; })()`);
const ATM = `(() => { const a = document.querySelector('[data-testid="reveal-atmosphere"]'); return a ? { key: a.dataset.atmosphere, uid: a.dataset.cardUid, tone: a.dataset.tone,
  layers: [...a.querySelectorAll('[data-layer]')].map((l) => ({ key: l.dataset.layer, op: Number(getComputedStyle(l).opacity) })) } : null; })()`;
type Atm = { key: string; uid: string; tone: string; layers: { key: string; op: number }[] } | null;
/** Monigote: ni walkout ni escena 3D en la apertura. */
const FIGURE = `(() => { const r = document.querySelector('[data-testid="pack-opening"]'); if (!r) return 0;
  return r.querySelectorAll('canvas, [data-testid^="pack-walkout"], [data-testid^="walkout"], [data-testid="admin-walkout-stage"]').length; })()`;
/** Cajas de lo que no puede salirse del viewport ni pisarse. */
const LAYOUT = `(() => {
  const vw = innerWidth, vh = innerHeight;
  const r = (sel) => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); return b.width && b.height ? { x: b.left, y: b.top, r: b.right, b: b.bottom } : null; };
  const card = r('[data-testid="hero-card-box"]') ?? r('[data-testid="spot-card-box"]');
  const info = r('[data-testid="hero-info"]') ?? r('[data-testid="spot-info"]');
  const btns = ['hero-continue', 'rest-continue', 'rest-back'].map((t) => r('[data-testid="' + t + '"]')).filter(Boolean);
  const chrome = [r('[data-testid="pack-skip"]'), r('[aria-label="' + (document.querySelector('[data-testid="pack-opening"] button[aria-label]')?.getAttribute('aria-label') ?? '') + '"]'), r('[data-testid="rest-pips"]')].filter(Boolean);
  const img = document.querySelector('[data-face="front"] img');
  const flip = document.querySelector('[data-face="front"]')?.parentElement;
  const flipCss = flip ? { ts: getComputedStyle(flip).transformStyle, filter: getComputedStyle(flip).filter } : null;
  return { vw, vh, overflow: document.documentElement.scrollWidth - vw, card, info, btns, chrome, img: img ? { ok: img.complete && img.naturalWidth > 0, src: img.getAttribute('src') } : null, flipCss };
})()`;
type Box = { x: number; y: number; r: number; b: number };
const inside = (b: Box, vw: number, vh: number) => b.x >= -1 && b.y >= -1 && b.r <= vw + 1 && b.b <= vh + 1;
const overlap = (a: Box, b: Box) => a.x < b.r - 1 && b.x < a.r - 1 && a.y < b.b - 1 && b.y < a.b - 1;

async function layoutOk(tab: Tab, S: string, what: string) {
  const L = await tab.js<{ vw: number; vh: number; overflow: number; card: Box | null; info: Box | null; btns: Box[]; chrome: Box[]; img: { ok: boolean; src: string } | null; flipCss: { ts: string; filter: string } | null }>(LAYOUT);
  const issues: string[] = [];
  if (!L.card || !inside(L.card, L.vw, L.vh)) issues.push(`carta fuera ${JSON.stringify(L.card)}`);
  if (L.info && !inside(L.info, L.vw, L.vh)) issues.push("ficha fuera");
  if (L.info && L.card && overlap(L.info, L.card)) issues.push("ficha pisa la carta");
  for (const b of L.btns) { if (!inside(b, L.vw, L.vh)) issues.push(`botón fuera ${JSON.stringify(b)}`); if (L.card && overlap(b, L.card)) issues.push("botón pisa la carta"); }
  for (const c of L.chrome) if (L.card && overlap(c, L.card)) issues.push(`control pisa la carta ${JSON.stringify(c)}`);
  if (L.overflow > 1) issues.push(`desborde ${L.overflow}`);
  if (!L.img?.ok) issues.push(`imagen de la carta no cargada ${JSON.stringify(L.img)}`);
  // La cara solo se ve tras el giro si el contexto 3D no está aplanado (un `filter` lo aplana: dorso espejado).
  if (!L.flipCss || L.flipCss.ts !== "preserve-3d" || L.flipCss.filter !== "none") issues.push(`giro 3D aplanado ${JSON.stringify(L.flipCss)}`);
  check(S, `${what} · maquetación (carta, ficha y botones visibles, sin solapes ni desborde; imagen cargada; cara visible)`, issues.length === 0, issues);
}

async function open(tab: Tab, scene: F81Scene) {
  await tab.goto(`${BASE}/design-system/fase81?scene=${scene}&reset=1`, 800);
  await waitFor(tab, `!!document.querySelector('[data-testid="pack-open"]')`, 30000);
  await waitFor(tab, `!document.querySelector('div.fixed.inset-0[class~="z-[100]"]')`, 10000); // splash del armazón
  await sleep(300);
  return click(tab, "pack-open");
}

async function mixed(tab: Tab, S: string, shots: boolean) {
  const E = expected("r-mixed");
  check(S, "mixed · abrir", await open(tab, "r-mixed"));
  // Hasta la hero quieta, muestreando la sala y el monigote en cada fase.
  const phases: string[] = []; const atmByPhase: Record<string, string[]> = {}; let figures = 0;
  for (const t0 = Date.now(); Date.now() - t0 < 20000;) {
    // Fase y sala en la MISMA evaluación (dos llamadas podrían caer a ambos lados de un cambio de fase).
    const { ph, a } = await tab.js<{ ph: string; a: Atm }>(`({ ph: document.querySelector('[data-testid="pack-opening"]')?.dataset.phase ?? "", a: ${ATM} })`);
    figures = Math.max(figures, await tab.js<number>(FIGURE));
    if (phases[phases.length - 1] !== ph) phases.push(ph);
    (atmByPhase[ph] ??= []).includes(a?.key ?? "") || atmByPhase[ph].push(a?.key ?? "");
    if (ph === "hero_hold") break;
    await sleep(40);
  }
  check(S, "mixed · fases sobre → rotura → tensión → hero (sin walkout)", phases.includes("hero_hold") && !phases.includes("walkout"), phases);
  check(S, "mixed · tensión con luz NEUTRA (no anticipa la rareza)", !atmByPhase.buildup || atmByPhase.buildup.every((k) => k === "neutral"), atmByPhase);
  check(S, "mixed · sin sala con el sobre cerrado ni en la rotura", ["ready", "requesting", "opening"].every((p) => !atmByPhase[p] || atmByPhase[p].every((k) => k === "none")), atmByPhase);
  await sleep(700);
  let a = await tab.js<Atm>(ATM);
  check(S, `mixed · hero ${E.hero!.cardId} → sala ${E.key(E.hero!.uid)}`, a?.key === E.key(E.hero!.uid) && a?.uid === E.hero!.uid, a);
  await layoutOk(tab, S, "mixed hero");
  if (shots) await tab.shot(join(SHOTS, `${S.replace(/ · /g, "-")}-mixed-0-hero-${a?.key}.png`));
  await click(tab, "hero-continue");

  for (let k = 0; k < E.rest.length; k++) {
    const it = E.rest[k];
    const ok = await waitFor(tab, `(() => { const r = document.querySelector('[data-testid="rest-reveal"]'); return r && r.dataset.index === "${k}" && r.dataset.shown === "true"; })()`, 8000);
    a = await tab.js<Atm>(ATM);
    const prevKey = k === 0 ? E.key(E.hero!.uid) : E.key(E.rest[k - 1].uid);
    const stale = a?.layers.filter((l) => l.key === prevKey && l.key !== E.key(it.uid) && l.op > 0.05) ?? [];
    check(S, `mixed · carta ${k + 2}/${E.rest.length + 1} ${it.cardId} → sala ${E.key(it.uid)}`, ok && a?.key === E.key(it.uid) && a?.uid === it.uid, a);
    check(S, `mixed · carta ${k + 2}: al girar ya no queda la sala de la anterior (${prevKey})`, stale.length === 0, a?.layers);
    figures = Math.max(figures, await tab.js<number>(FIGURE));
    await sleep(650);
    if (k === 0 || k === E.rest.length - 1) await layoutOk(tab, S, `mixed carta ${k + 2}`);
    if (shots) await tab.shot(join(SHOTS, `${S.replace(/ · /g, "-")}-mixed-${k + 1}-${E.key(it.uid)}.png`));
    if (k === 1) {
      // ATRÁS: la anterior, boca arriba y con SU sala; otra vez atrás → la hero; y de vuelta adelante sin girar lo ya visto.
      await click(tab, "rest-back");
      const b1 = await waitFor(tab, `(() => { const r = document.querySelector('[data-testid="rest-reveal"]'); return r && r.dataset.index === "0" && r.dataset.shown === "true"; })()`, 3000);
      const ab = await tab.js<Atm>(ATM);
      check(S, "mixed · ATRÁS → la carta anterior, boca arriba, con su sala", b1 && ab?.uid === E.rest[0].uid && ab?.key === E.key(E.rest[0].uid), ab);
      await click(tab, "rest-back");
      const b2 = await waitFor(tab, `document.querySelector('[data-testid="pack-opening"]')?.dataset.phase === "hero_hold"`, 3000);
      const ah = await tab.js<Atm>(ATM);
      check(S, "mixed · ATRÁS desde la primera → la hero quieta, con su sala", b2 && ah?.uid === E.hero!.uid, ah);
      await click(tab, "hero-continue");
      await waitFor(tab, `document.querySelector('[data-testid="rest-reveal"]')?.dataset.shown === "true"`, 3000);
      await click(tab, "rest-continue");
      const f = await waitFor(tab, `(() => { const r = document.querySelector('[data-testid="rest-reveal"]'); return r && r.dataset.index === "1" && r.dataset.shown === "true"; })()`, 3000);
      check(S, "mixed · ADELANTE otra vez: lo ya visto sale boca arriba", f);
    }
    await click(tab, "rest-continue");
  }
  const sum = await waitFor(tab, `document.querySelector('[data-testid="pack-opening"]')?.dataset.phase === "summary"`, 6000);
  await sleep(800);
  a = await tab.js<Atm>(ATM);
  const uids = await tab.js<string[]>(`[...new Set([...document.querySelectorAll('[data-testid="summary-card"]')].map((e) => e.dataset.uid))]`);
  const opens = await tab.js<number>(`Number(sessionStorage.getItem('f81-opens') ?? '0')`);
  check(S, "mixed · resumen con las MISMAS cartas, 1 sola apertura y la sala retirada", sum && [...uids].sort().join() === E.res.map((r) => r.uid).sort().join() && opens === 1 && a?.key === "none", { uids: uids.length, opens, atm: a?.key });
  check(S, "mixed · sin monigote (walkout / <canvas>) en ninguna fase", figures === 0, figures);
  if (shots) await tab.shot(join(SHOTS, `${S.replace(/ · /g, "-")}-mixed-9-resumen.png`));
}

async function heroScene(tab: Tab, S: string, scene: F81Scene, want: string, shots: boolean) {
  const E = expected(scene);
  await open(tab, scene);
  const ok = await waitFor(tab, `document.querySelector('[data-testid="pack-opening"]')?.dataset.phase === "hero_hold"`, 20000);
  await sleep(900);
  const a = await tab.js<Atm>(ATM);
  check(S, `${scene} · hero ${E.hero!.cardId} → sala ${want}`, ok && a?.key === want && a?.uid === E.hero!.uid, a);
  const bg = await tab.js<string>(`(() => { const e = document.querySelector('[data-testid="reveal-atmosphere"] [data-layer="${want}"] > div'); return e ? getComputedStyle(e).backgroundImage : ""; })()`);
  check(S, `${scene} · el fondo pinta el color de la clase`, /radial-gradient/.test(bg), bg.slice(0, 120));
  if (want === "icon") {
    const ink = await tab.js<number>(`(() => { const e = document.querySelector('[data-testid="spot-line"] b'); if (!e) return 999; const m = getComputedStyle(e).color.match(/\\d+/g).map(Number); return (m[0] + m[1] + m[2]) / 3; })()`);
    check(S, `${scene} · ficha legible sobre marfil (tinta oscura)`, ink < 80, ink);
  }
  await layoutOk(tab, S, scene);
  if (shots) await tab.shot(join(SHOTS, `${S.replace(/ · /g, "-")}-${scene}.png`));
}

async function closeAndSkip(tab: Tab, S: string) {
  await open(tab, "r-mixed");
  await waitFor(tab, `document.querySelector('[data-testid="pack-opening"]')?.dataset.phase === "buildup"`, 15000);
  check(S, "OMITIR en la tensión → resumen", (await click(tab, "pack-skip")) && await waitFor(tab, `document.querySelector('[data-testid="pack-opening"]')?.dataset.phase === "summary"`, 4000));
  await open(tab, "r-mixed");
  await waitFor(tab, `document.querySelector('[data-testid="pack-opening"]')?.dataset.phase === "hero_hold"`, 20000);
  await click(tab, "hero-continue");
  await waitFor(tab, `document.querySelector('[data-testid="rest-reveal"]')?.dataset.shown === "true"`, 5000);
  await tab.js(`document.querySelector('[data-testid="pack-opening"] > button[aria-label]').click()`);
  check(S, "CERRAR a mitad del resto → /packs (lo abierto ya estaba guardado)", await waitFor(tab, `location.pathname === "/packs"`, 8000));
}

async function run(width: number, motion: string) {
  const S = `${width} · ${motion}`;
  const b = await launch({ args: ["--mute-audio", "--hide-scrollbars"] });
  const tab = b.tab;
  const bad: string[] = [];
  await tab.send("Network.enable");
  tab.on("Network.responseReceived", (p: any) => { if (p?.response?.status >= 400) bad.push(`${p.response.status} ${new URL(p.response.url).pathname}`); });
  await tab.resize(width, H[width] ?? 900, 1);
  await tab.setMedia([{ name: "prefers-reduced-motion", value: motion === "reduced" ? "reduce" : "no-preference" }]);
  try {
    const shots = true;
    await mixed(tab, S, shots && (width === 1440 || motion === "normal"));
    await heroScene(tab, S, "r-masters", "masters", shots);
    await heroScene(tab, S, "r-icon", "icon", shots);
    await heroScene(tab, S, "r-gold", "oro", shots);
    if (width === 390) await closeAndSkip(tab, S);
    const env = bad.filter(envOnly), real = bad.filter((r) => !envOnly(r));
    let budget = env.length;
    const errors = tab.takeErrors().filter(noise).filter((e) => !(/status of 503/.test(e) && budget-- > 0));
    check(S, "sin errores de consola", errors.length === 0, errors.slice(0, 4));
    check(S, "sin respuestas ≥ 400 (ninguna imagen rota)", real.length === 0, real.slice(0, 6));
    check(S, "entorno · 503 de /api/content sin BD local (informativo)", true, `${env.length}`);
  } finally { await b.close(); }
}

(async () => {
  for (const w of WIDTHS) for (const m of MOTIONS) await run(w, m).catch((e) => check(`${w} · ${m}`, "ejecución", false, String(e?.stack ?? e)));
  const fail = rows.filter((r) => !r.ok);
  writeFileSync(join(LOGS, "report.json"), JSON.stringify({ base: BASE, at: new Date().toISOString(), pass: rows.length - fail.length, fail: fail.length, rows }, null, 2));
  console.log(`\n${rows.length - fail.length} PASS · ${fail.length} FAIL`);
  process.exit(fail.length ? 1 : 0);
})();
