/**
 * APERTURA DE SOBRES · PRUEBA REAL EN EL STACK DE QA AISLADO (instrumento, fuera de CI; 2026-10-15).
 *
 * Corre DENTRO del VPS (`valorosters-i18n-qa`: base de datos, auth y red propias; cuentas sintéticas @example.invalid con
 * créditos sintéticos) contra la build EXACTA de producción servida como `vrqa_app` (BUILD_ID = el desplegado). Se niega a
 * correr contra valorosters.com o :3005. Las credenciales las lee `_i18n-auth-lib` del fichero del stack (QA_ENV), nunca
 * se imprimen.
 *
 *   qa-run.sh run pa <este script> [anchos] [movimientos]
 *
 * Por ancho (390/768/1440) y movimiento (normal/reducido), con la cuenta QA PLAYER iniciada por el FORMULARIO:
 *   1. compra con créditos sintéticos (mismo endpoint de la tienda que usa la app): Sobre Oro y Sobre ICON;
 *   2. abre cada uno por la interfaz normal (`/abrir/<sobre>`): el SERVIDOR del stack decide las cartas;
 *   3. en cada fase: captura + comprobaciones — sala = clase canónica de la carta servida (edición + OVR), nunca la de la
 *      anterior; preparación neutra; sin monigote (<canvas>/walkout) en la apertura; giro 3D no aplanado (sin dorso en
 *      espejo); carta, ficha y botones dentro del viewport sin solaparse; imagen cargada; ATRÁS; resumen con las MISMAS
 *      cartas y 1 sola petición;
 *   4. consola sin errores y ninguna respuesta ≥ 400.
 * Capturas en /work/docs/pack-opening-isolated/ (montado en out/docs del stack); informe en /work/logs/pack-opening-real.json.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { BASE, api, chooseLocale, collect, goto, loginUi, open, sleep, token, waitFor, type Client } from "./_i18n-auth-lib";

if (/valorosters\.com|:3005\b/.test(BASE)) throw new Error("solo contra el stack de QA aislado");
const OUT = "/work/docs/pack-opening-isolated-es";
mkdirSync(OUT, { recursive: true });
const WIDTHS = (process.argv[2] ?? "390,768,1440").split(",").map(Number);
const MOTIONS = (process.argv[3] ?? "normal,reduced").split(",");
const PACKS = ["oro", "icon-single"] as const;

const rows: { scope: string; id: string; ok: boolean; detail: string }[] = [];
const check = (scope: string, id: string, ok: boolean, detail: unknown = "") => {
  const d = typeof detail === "string" ? detail : JSON.stringify(detail);
  rows.push({ scope, id, ok, detail: d.slice(0, 700) });
  console.log(`${ok ? "PASS" : "FAIL"} · ${scope} · ${id}${ok ? "" : ` — ${d.slice(0, 300)}`}`);
};
const opened: { scope: string; pack: string; cards: { id: string; ovr: number; cls: string }[] }[] = [];

/** Oráculo INDEPENDIENTE de la clase (no importa el código de la app): edición del id de carta + OVR servido. */
function expectedClass(cardId: string, ovr: number): string {
  const ed = cardId.split("__")[1] ?? "";
  if (ed === "base") return ovr >= 86 && ovr <= 92 ? "oro" : ovr >= 82 && ovr <= 85 ? "plata" : ovr >= 70 && ovr <= 81 ? "base" : "neutral";
  return ({ "masters-l": "masters", "masters-sdc": "masters", "champions-s": "champions", "future-star": "prime", "record-breaker": "icon", moments: "icon" } as Record<string, string>)[ed] ?? "special";
}

/** Luz de cada clase (la del diseño) para saber si el DORSO anticipa la rareza antes del giro. */
const GLOW: Record<string, string> = { base: "#8b96a3", plata: "#cfd6de", oro: "#ffce4f", masters: "#b48cff", champions: "#ffe08a", prime: "#3aa6ff", icon: "#ffffff", neutral: "#9aa7c7" };
const rgb = (h: string) => `rgb(${parseInt(h.slice(1, 3), 16)}, ${parseInt(h.slice(3, 5), 16)}, ${parseInt(h.slice(5, 7), 16)})`;
const BACK_FILTER = `(document.querySelector('[data-card-back]')?.style.filter ?? "")`;
/** Antes del giro el dorso no puede llevar la luz de la carta que va a salir (si es distinta de la neutra). */
function backAnticipates(filter: string, cls: string): boolean { return cls !== "neutral" && GLOW[cls] !== undefined && GLOW[cls] !== GLOW.neutral && (filter.includes(rgb(GLOW[cls])) || filter.toLowerCase().includes(GLOW[cls])); }

const PHASE = `(document.querySelector('[data-testid="pack-opening"]')?.dataset.phase ?? "")`;
const ATM = `(() => { const a = document.querySelector('[data-testid="reveal-atmosphere"]'); return a ? { key: a.dataset.atmosphere, uid: a.dataset.cardUid, tone: a.dataset.tone,
  layers: [...a.querySelectorAll('[data-layer]')].map((l) => ({ key: l.dataset.layer, op: Number(getComputedStyle(l).opacity) })) } : null; })()`;
type Atm = { key: string; uid: string; tone: string; layers: { key: string; op: number }[] } | null;
const FIGURE = `(() => { const r = document.querySelector('[data-testid="pack-opening"]'); return r ? r.querySelectorAll('canvas, [data-testid^="pack-walkout"], [data-testid^="walkout"]').length : 0; })()`;
const LAYOUT = `(() => {
  const vw = innerWidth, vh = innerHeight;
  const r = (sel) => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); return b.width && b.height ? { x: b.left, y: b.top, r: b.right, b: b.bottom } : null; };
  const card = r('[data-testid="hero-card-box"]') ?? r('[data-testid="spot-card-box"]');
  const info = r('[data-testid="hero-info"]') ?? r('[data-testid="spot-info"]');
  const btns = ['hero-continue', 'rest-continue', 'rest-back'].map((t) => r('[data-testid="' + t + '"]')).filter(Boolean);
  const chrome = [r('[data-testid="pack-skip"]'), r('[data-testid="pack-opening"] > button[aria-label]'), r('[data-testid="rest-pips"]')].filter(Boolean);
  const img = document.querySelector('[data-face="front"] img');
  const flip = document.querySelector('[data-face="front"]')?.parentElement;
  const back = document.querySelector('[data-testid="rest-back"]');
  const L = (c) => { const m = c.match(/[\\d.]+/g).map(Number); return { l: (m[0] + m[1] + m[2]) / 3, a: m.length > 3 ? m[3] : 1 }; };
  return { vw, vh, overflow: document.documentElement.scrollWidth - vw, card, info, btns, chrome,
    img: img ? { ok: img.complete && img.naturalWidth > 0, w: img.naturalWidth } : null,
    flip: flip ? { ts: getComputedStyle(flip).transformStyle, filter: getComputedStyle(flip).filter } : null,
    backBtn: back ? { fg: L(getComputedStyle(back).color).l, bg: L(getComputedStyle(back).backgroundColor).l, a: L(getComputedStyle(back).backgroundColor).a } : null };
})()`;
type Box = { x: number; y: number; r: number; b: number };
const inside = (b: Box, vw: number, vh: number) => b.x >= -1 && b.y >= -1 && b.r <= vw + 1 && b.b <= vh + 1;
const overlap = (a: Box, b: Box) => a.x < b.r - 1 && b.x < a.r - 1 && a.y < b.b - 1 && b.y < a.b - 1;

async function layout(c: Client, S: string, what: string, reduced: boolean, light: boolean) {
  const L = await c.tab.js<any>(LAYOUT);
  const issues: string[] = [];
  if (!L.card || !inside(L.card, L.vw, L.vh)) issues.push(`carta fuera ${JSON.stringify(L.card)}`);
  if (L.info && (!inside(L.info, L.vw, L.vh) || (L.card && overlap(L.info, L.card)))) issues.push("ficha fuera o sobre la carta");
  for (const b of L.btns as Box[]) if (!inside(b, L.vw, L.vh) || (L.card && overlap(b, L.card))) issues.push(`botón fuera o sobre la carta ${JSON.stringify(b)}`);
  for (const k of L.chrome as Box[]) if (L.card && overlap(k, L.card)) issues.push("control sobre la carta");
  if (L.overflow > 1) issues.push(`desborde ${L.overflow}`);
  if (!L.img?.ok) issues.push(`imagen no cargada ${JSON.stringify(L.img)}`);
  if (!reduced && (!L.flip || L.flip.ts !== "preserve-3d" || L.flip.filter !== "none")) issues.push(`giro 3D aplanado (dorso en espejo) ${JSON.stringify(L.flip)}`);
  if (light && L.backBtn && !(L.backBtn.a > 0.5 && Math.abs(L.backBtn.fg - L.backBtn.bg) > 120)) issues.push(`«Anterior» ilegible en sala clara ${JSON.stringify(L.backBtn)}`);
  check(S, `${what} · maquetación (carta, ficha y botones visibles sin solapes; imagen cargada; cara visible${light ? "; «Anterior» legible" : ""})`, issues.length === 0, issues);
}

async function shot(c: Client, name: string) { await c.tab.shot(`${OUT}/${name}.png`); }

async function openPack(c: Client, S: string, tag: string, pack: string, reduced: boolean) {
  const P = `${S} · ${pack}`;
  await goto(c, `/abrir/${pack}`, 1200);
  const ready = await waitFor(c.tab, `!!document.querySelector('[data-testid="pack-open"]')`, 20000);
  check(P, "sobre listo para abrir (la cuenta lo tiene)", ready);
  if (!ready) return;
  await shot(c, `${tag}-${pack}-1-sobre`);
  let figures = await c.tab.js<number>(FIGURE);
  await c.tab.js(`document.querySelector('[data-testid="pack-open"]').click()`);
  // La rotura del sobre (la pide el servidor: hasta que contesta, «requesting»).
  if (await waitFor(c.tab, `${PHASE} === "opening"`, 25000)) { await sleep(reduced ? 200 : 700); await shot(c, `${tag}-${pack}-2-rotura`); }
  if (await waitFor(c.tab, `${PHASE} === "buildup"`, 8000)) {
    await sleep(reduced ? 150 : 450);
    const a = await c.tab.js<Atm>(ATM);
    check(P, "tensión: sala NEUTRA (no anticipa la rareza)", a?.key === "neutral", a);
    const hb = await c.tab.js<{ id: string; ovr: number; filter: string }>(`({ id: document.querySelector('[data-testid="hero-reveal"]')?.dataset.cardId ?? "", ovr: Number(document.querySelector('[data-testid="hero-reveal"]')?.dataset.ovr ?? 0), filter: ${BACK_FILTER} })`);
    const hc = expectedClass(hb.id, hb.ovr);
    check(P, `tensión: el DORSO tampoco anticipa la rareza (sería ${hc})`, !backAnticipates(hb.filter, hc), hb.filter.slice(0, 160));
    await shot(c, `${tag}-${pack}-3-tension`);
  }
  const hold = await waitFor(c.tab, `${PHASE} === "hero_hold"`, 15000);
  await sleep(reduced ? 500 : 1100);
  const hero = await c.tab.js<{ uid: string; id: string; ovr: number } | null>(`(() => { const h = document.querySelector('[data-testid="hero-reveal"]'); return h ? { uid: h.dataset.uid, id: h.dataset.cardId, ovr: Number(h.dataset.ovr) } : null; })()`);
  const cards: { id: string; ovr: number; cls: string }[] = [];
  let a = await c.tab.js<Atm>(ATM);
  if (hold && hero) {
    const want = expectedClass(hero.id, hero.ovr);
    cards.push({ id: hero.id, ovr: hero.ovr, cls: want });
    check(P, `hero ${hero.id} (OVR ${hero.ovr}) → sala ${want}`, a?.key === want && a?.uid === hero.uid, a);
    await layout(c, P, "hero", reduced, a?.tone === "light");
    await shot(c, `${tag}-${pack}-4-hero-${want}`);
  } else check(P, "hero quieta", false, { hold, hero });
  figures = Math.max(figures, await c.tab.js<number>(FIGURE));
  const restCount = await c.tab.js<number>(`Number(document.querySelector('[data-testid="hero-continue"]')?.textContent?.match(/\\d+/)?.[0] ?? 0)`);
  await c.tab.js(`document.querySelector('[data-testid="hero-continue"]')?.click()`);
  let prevKey = a?.key ?? "";
  for (let k = 0; k < restCount; k++) {
    // PREPARACIÓN de la carta k: sala neutra, la anterior ya fuera.
    const prep = await waitFor(c.tab, `(() => { const r = document.querySelector('[data-testid="rest-reveal"]'); return !!r && r.dataset.index === "${k}"; })()`, 6000);
    const ap = await c.tab.js<Atm>(ATM);
    const pb = await c.tab.js<{ id: string; ovr: number; shown: string; filter: string }>(`({ id: document.querySelector('[data-testid="rest-card"]')?.dataset.cardId ?? "", ovr: Number(document.querySelector('[data-testid="rest-card"]')?.dataset.ovr ?? 0), shown: document.querySelector('[data-testid="rest-reveal"]')?.dataset.shown ?? "", filter: ${BACK_FILTER} })`);
    if (pb.shown === "false") {
      const pc = expectedClass(pb.id, pb.ovr);
      check(P, `carta ${k + 2}: en la preparación el DORSO no anticipa la rareza (sería ${pc})`, !backAnticipates(pb.filter, pc), pb.filter.slice(0, 160));
    }
    if (prep && ap && ap.key === "neutral" && k <= 1) await shot(c, `${tag}-${pack}-5-preparacion-${k + 2}`);
    const shown = await waitFor(c.tab, `(() => { const r = document.querySelector('[data-testid="rest-reveal"]'); return !!r && r.dataset.index === "${k}" && r.dataset.shown === "true"; })()`, 6000);
    const card = await c.tab.js<{ uid: string; id: string; ovr: number } | null>(`(() => { const e = document.querySelector('[data-testid="rest-card"]'); return e ? { uid: e.dataset.uid, id: e.dataset.cardId, ovr: Number(e.dataset.ovr) } : null; })()`);
    a = await c.tab.js<Atm>(ATM);
    const want = card ? expectedClass(card.id, card.ovr) : "?";
    if (card) cards.push({ id: card.id, ovr: card.ovr, cls: want });
    const stale = a?.layers.filter((l) => l.key === prevKey && l.key !== want && l.op > 0.05) ?? [];
    check(P, `carta ${k + 2}/${restCount + 1} ${card?.id} (OVR ${card?.ovr}) → sala ${want}`, shown && a?.key === want && a?.uid === card?.uid, a);
    check(P, `carta ${k + 2}: al girar ya no queda la sala de la anterior (${prevKey})`, stale.length === 0, a?.layers);
    await sleep(reduced ? 450 : 800);
    await layout(c, P, `carta ${k + 2}`, reduced, a?.tone === "light");
    await shot(c, `${tag}-${pack}-6-carta-${k + 2}-${want}`);
    figures = Math.max(figures, await c.tab.js<number>(FIGURE));
    if (k === 1) {
      await c.tab.js(`document.querySelector('[data-testid="rest-back"]').click()`);
      const b = await waitFor(c.tab, `(() => { const r = document.querySelector('[data-testid="rest-reveal"]'); return !!r && r.dataset.index === "0" && r.dataset.shown === "true"; })()`, 3000);
      const ab = await c.tab.js<Atm>(ATM);
      check(P, "ATRÁS → la carta anterior, boca arriba y con SU sala", b && ab?.key === cards[1]?.cls, ab);
      await sleep(reduced ? 300 : 700);
      await shot(c, `${tag}-${pack}-7-atras`);
      await c.tab.js(`document.querySelector('[data-testid="rest-continue"]').click()`);
      check(P, "ADELANTE otra vez: lo ya visto sale boca arriba", await waitFor(c.tab, `(() => { const r = document.querySelector('[data-testid="rest-reveal"]'); return !!r && r.dataset.index === "1" && r.dataset.shown === "true"; })()`, 3000));
    }
    prevKey = a?.key ?? prevKey;
    await c.tab.js(`document.querySelector('[data-testid="rest-continue"]')?.click()`);
  }
  if (restCount === 0) await sleep(200);
  const sum = await waitFor(c.tab, `${PHASE} === "summary"`, 8000);
  await sleep(1200);
  const uids = await c.tab.js<string[]>(`[...new Set([...document.querySelectorAll('[data-testid="summary-card"]')].map((e) => e.dataset.uid))]`);
  const req = await c.tab.js<string>(`document.querySelector('[data-testid="pack-opening"]')?.dataset.requests ?? ""`);
  const actions = await c.tab.js<string[]>(`[...document.querySelectorAll('[data-testid="pack-summary"] button, [data-testid="pack-summary"] a')].map((b) => b.textContent.trim()).filter(Boolean).slice(0, 8)`);
  const atmGone = (await c.tab.js<Atm>(ATM))?.key === "none";
  check(P, `resumen: ${uids.length} carta(s), 1 petición al servidor, sala retirada, acciones de siempre`, sum && uids.length === restCount + 1 && req === "1" && atmGone && actions.length > 0, { uids: uids.length, req, atmGone, actions });
  check(P, "sin monigote (walkout / <canvas>) en ninguna fase", figures === 0, figures);
  await shot(c, `${tag}-${pack}-8-resumen`);
  opened.push({ scope: S, pack, cards });
  collect(c, `/abrir/${pack}`);
}

async function run(width: number, motion: string) {
  const S = `${width} · ${motion}`;
  const tag = `${width}-${motion}`;
  const reduced = motion === "reduced";
  const tok = await token("PLAYER");
  // Compra con créditos SINTÉTICOS del stack aislado (mismo endpoint de la tienda que usa la app).
  for (const pack of PACKS) {
    const r = await api(tok.access, "/api/game/store", { action: "checkout", productId: `pack:${pack}`, method: "GAME_CURRENCY", ref: `qa-pa-${tag}-${pack}-${Date.now()}` });
    check(S, `compra (créditos sintéticos) Sobre ${pack}`, r.status === 200, { status: r.status, body: JSON.stringify(r.json).slice(0, 200) });
  }
  const c = await open(width, { reduced });
  const bad: string[] = [];
  await c.tab.send("Network.enable");
  c.tab.on("Network.responseReceived", (p: { response?: { status: number; url: string } }) => { if (p?.response && p.response.status >= 400) bad.push(`${p.response.status} ${new URL(p.response.url).pathname}`); });
  try {
    await goto(c, "/cuenta", 1500);
    check(S, "inicio de sesión por el formulario (cuenta QA sintética)", await loginUi(c, "PLAYER"));
    // La cuenta QA guarda su idioma (lo dejó en japonés la QA i18n): las capturas de entrega, en español.
    check(S, "idioma de la cuenta QA: español", await chooseLocale(c, "es"));
    await c.tab.setStorage("drl:opening-animation:v1", "auto");
    for (const pack of PACKS) await openPack(c, S, tag, pack, reduced);
    const real = bad.filter((b) => !/\/api\/telemetry/.test(b));
    check(S, "sin errores de consola", c.errors.length === 0, c.errors.slice(0, 4));
    check(S, "sin respuestas ≥ 400 (ninguna imagen rota)", real.length === 0, real.slice(0, 6));
  } finally { await c.browser.close(); }
}

(async () => {
  for (const w of WIDTHS) for (const m of MOTIONS) await run(w, m).catch((e) => check(`${w} · ${m}`, "ejecución", false, String(e?.stack ?? e)));
  const fail = rows.filter((r) => !r.ok);
  writeFileSync("/work/logs/pack-opening-real.json", JSON.stringify({ base: BASE, at: new Date().toISOString(), pass: rows.length - fail.length, fail: fail.length, opened, rows }, null, 2));
  console.log(`\n${rows.length - fail.length} PASS · ${fail.length} FAIL`);
  console.log("FIN");
})();
