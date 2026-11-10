/**
 * F81.2 · QA EN PRODUCCIÓN de la hidratación (instrumento, fuera de CI) con QA G (`f63-n1b`, la MISMA cuenta en
 * navegador y API). SOLO LECTURA: no compra, no abre, no reclama. Lo único que hace CDP es RETRASAR la respuesta real de
 * `/api/game/state` en el navegador (Fetch.continueRequest tras N ms) para alargar la ventana de hidratación.
 *   1 · recarga en frío / Ctrl+F5 y servidor lento (1 s / 3 s / 5 s) en tienda, colección, inventario, detalle de sobre,
 *       apertura directa por URL y vestíbulo, a 1440/1024/390: NEUTRAL → REAL, nunca demo ni otra cifra;
 *   2 · multipestaña; 3 · logout → visitante (la caché de la cuenta NO queda como demo) → login (neutral → real);
 *   4 · el estado del servidor no cambia (créditos, sobres, cartas).
 * Uso (cwd temporal con .env.local público + tsconfig con paths):  BASE_URL=https://valorosters.com npx tsx scripts/_f812-prod-qa.mts
 */
const lib = await import("file:///C:/NEXUS-CENTRAL/DRLCards/scripts/_fase68-lib.ts");
const { login, QA_FILES } = await import("file:///C:/NEXUS-CENTRAL/DRLCards/scripts/multiplayer/_qa.ts");
const { formatCredits } = await import("file:///C:/NEXUS-CENTRAL/DRLCards/src/lib/format.ts");
const { mkdirSync, writeFileSync } = await import("node:fs");
const { openBrowser, loginUi, logoutUi, sleep, PERSONA_FILES } = lib;
PERSONA_FILES.QG = QA_FILES.G;
const BASE = "https://valorosters.com";
const OUT = "C:/NEXUS-CENTRAL/DRLCards/docs/product/qa/f812-hydration/prod";
mkdirSync(`${OUT}/shots`, { recursive: true });
const rows: { id: string; ok: boolean; detail: string }[] = [];
const check = (id: string, ok: boolean, detail: unknown = "") => {
  const d = typeof detail === "string" ? detail : JSON.stringify(detail);
  rows.push({ id, ok, detail: d.slice(0, 700) });
  console.log(`${ok ? "PASS" : "FAIL"} ${id} ${d.slice(0, 260)}`);
};
const api = async () => {
  const u = await login("G");
  const s = await (await fetch(`${BASE}/api/game/state`, { headers: { authorization: `Bearer ${u.token}` } })).json();
  return { userId: u.userId as string, credits: s.credits as number, unopened: s.unopenedPacks, packsOpened: s.packsOpened, cards: (s.ownedCards as unknown[]).length, xp: s.xp };
};

const s0 = await api();
const REAL_HUD = formatCredits(s0.credits);
const REAL_RAW = String(s0.credits);
console.log(`PRE ${JSON.stringify({ user: s0.userId.slice(0, 8), credits: s0.credits, hud: REAL_HUD, unopened: s0.unopened, packsOpened: s0.packsOpened, cards: s0.cards })}`);
if (s0.credits === 6000) { console.log("ABORT el saldo real coincide con el de la demo: la prueba no distinguiría"); process.exit(1); }

const SAMPLER = `(() => {
  const S = []; window.__f812 = S; const t0 = performance.now();
  const REAL = [${JSON.stringify(REAL_HUD)}, ${JSON.stringify(REAL_RAW)}];
  const snap = () => {
    const b = document.body; if (!b) return;
    const txt = b.innerText || '';
    const hud = [...document.querySelectorAll('[title="DRL Credits"] .nx-readout')].map(e => e.textContent.trim()).join('|');
    const rec = {
      loader: !!document.querySelector('[data-testid="game-loader"]'), skel: !!document.querySelector('[data-testid="daily-skeleton"]'),
      unavailable: !!document.querySelector('[data-testid="economy-unavailable"]'), signin: !!document.querySelector('[data-testid="hud-signin"]'),
      hud, six: /(^|[^0-9.])6\\.?000([^0-9]|$)/.test(hud), realText: REAL.some(r => new RegExp('(^|[^0-9.])' + r.replace('.', '\\\\.') + '([^0-9]|$)').test(txt)),
      demoHomeCredits: /(^|[^0-9.])6000([^0-9]|$)/.test(txt), pack: document.querySelector('[data-testid="pack-opening"]')?.dataset.phase ?? '',
      packStatus: document.querySelector('[data-testid="pack-status"]')?.dataset.kind ?? '',
    };
    const k = JSON.stringify(rec); const last = S[S.length - 1];
    if (!last || last.k !== k) S.push({ t: Math.round(performance.now() - t0), k, ...rec });
  };
  new MutationObserver(snap).observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
  setInterval(snap, 25); document.addEventListener('DOMContentLoaded', snap);
})()`;
type Sample = { t: number; loader: boolean; skel: boolean; unavailable: boolean; signin: boolean; hud: string; six: boolean; realText: boolean; demoHomeCredits: boolean; pack: string; packStatus: string };
const bounded = <T,>(p: Promise<T>, ms = 5000): Promise<T | undefined> => Promise.race([p.catch(() => undefined), sleep(ms).then(() => undefined)]);
const GATED = new Set(["/tienda", "/coleccion", "/inventario", "/packs/estandar", "/abrir/estandar"]);
/*
 * F86 · investigación de las 3 filas históricas «/abrir/estandar · NEUTRAL → REAL»: la cuenta QA G NO tiene sobres
 * estándar (`unopened: {}` en su propio PRE), así que su estado REAL en esa URL es el aviso honesto «No tienes este
 * sobre» (`pack-status`, kind=missing), no la ceremonia. Exigir `pack-opening` era una aserción inaplicable a esta
 * cuenta. Ahora el «real» sale del inventario REAL leído antes (con sobre → ceremonia; sin él → aviso «missing»).
 */
const isReal = (p: string, x: Sample) => p === "/abrir/estandar"
  ? !x.loader && ((s0.unopened?.estandar ?? 0) > 0 ? !!x.pack : x.packStatus === "missing")
  : p === "/" ? x.realText && !x.skel : x.hud === REAL_HUD;

let delay = 0;
async function setup(width: number) {
  const c = await openBrowser("QG", width, { label: `f812-prod-${width}` });
  await c.tab.send("Network.setCacheDisabled", { cacheDisabled: true });
  await c.tab.send("Page.addScriptToEvaluateOnNewDocument", { source: SAMPLER });
  c.tab.on("Fetch.requestPaused", async (p: any) => {
    if (delay > 0) await sleep(delay);
    try { await c.tab.send("Fetch.continueRequest", { requestId: p.requestId }); } catch { /* navegó */ }
  });
  await c.tab.send("Fetch.enable", { patterns: [{ urlPattern: "*/api/game/state*", requestStage: "Request" }] });
  return c;
}
async function visit(c: any, path: string, opts: { reload?: boolean; settle?: number; shots?: number[]; tag?: string } = {}) {
  const t0 = Date.now();
  if (opts.reload) void bounded(c.tab.send("Page.reload", { ignoreCache: true })); else await bounded(c.tab.send("Page.navigate", { url: `${BASE}${path}` }));
  for (const at of opts.shots ?? []) { const w = at - (Date.now() - t0); if (w > 0) await sleep(w); await bounded(c.tab.shot(`${OUT}/shots/${opts.tag}-${at}ms.png`)); }
  const rest = (opts.settle ?? 6000) - (Date.now() - t0); if (rest > 0) await sleep(rest);
  if (opts.tag) await bounded(c.tab.shot(`${OUT}/shots/${opts.tag}-resolved.png`));
  return c.tab.js(`(window.__f812 || []).map(({ k, ...r }) => r)`) as Promise<Sample[]>;
}
function judge(id: string, path: string, s: Sample[]) {
  const iReal = s.findIndex((x) => isReal(path, x));
  const bad = s.filter((x, i) => x.six || (x.hud && x.hud !== "—" && x.hud !== REAL_HUD)
    || (GATED.has(path) && i < iReal && !x.loader && !x.unavailable && !!x.hud && x.hud !== "—")
    || (path === "/" && x.demoHomeCredits)
    || (path === "/abrir/estandar" && i < iReal && !!x.pack));
  const neutral = s.some((x, i) => (iReal < 0 || i < iReal) && (x.loader || x.skel || x.hud === "—"));
  const last = s[s.length - 1];
  const fmt = s.map((x) => `${x.t}:${x.loader ? "L" : ""}${x.skel ? "S" : ""}${x.unavailable ? "E" : ""}${x.signin ? "I" : ""}${x.pack ? "P" : ""}[${x.hud}]`).join(" ");
  check(`${id} · ${path} · nunca demo/otra cifra`, bad.length === 0, bad.length ? bad.slice(0, 3) : fmt);
  check(`${id} · ${path} · NEUTRAL → REAL`, neutral && !!last && isReal(path, last) && !last.unavailable, fmt);
}
const errs: string[] = [];
const takeErrs = (c: any) => { errs.push(...c.tab.takeErrors(), ...(c.errors ?? []).map((e: any) => String(e?.text ?? e))); c.errors = []; };

// 1 · 1440: todas las rutas a 1 s / 3 s / 5 s + Ctrl+F5
{
  const c = await setup(1440);
  try {
    check("LOGIN UI (QA G, sin ralentizar)", await loginUi(c, "QG"));
    for (const d of [1000, 3000, 5000]) {
      delay = d;
      for (const p of ["/tienda", "/coleccion", "/inventario", "/packs/estandar", "/abrir/estandar", "/"]) {
        const shoot = d === 3000 && ["/tienda", "/coleccion", "/"].includes(p);
        judge(`servidor +${d} ms @1440`, p, await visit(c, p, { settle: d + 4500, shots: shoot ? [0, 250, 1000, 3000] : [], tag: shoot ? `1440${p.replace(/\//g, "_")}-d${d}` : undefined }));
      }
    }
    delay = 3000;
    await visit(c, "/tienda", { settle: 7000 });
    await c.tab.js(`(window.__f812.length = 0, true)`);
    judge("Ctrl+F5 (servidor +3 s) @1440", "/tienda", await visit(c, "/tienda", { reload: true, settle: 8000, shots: [250, 1000], tag: "1440-hard-reload" }));
    delay = 0;
    judge("Ctrl+F5 sin ralentizar @1440", "/coleccion", await visit(c, "/coleccion", { settle: 4000 }).then(() => c.tab.js(`(window.__f812.length = 0, true)`)).then(() => visit(c, "/coleccion", { reload: true, settle: 5000 })));
    // 2 · multipestaña: la otra pestaña sigue autenticada; recargar esta.
    await c.tab.js(`(window.open('/coleccion', 'f812-otra'), true)`);
    await sleep(6000);
    delay = 3000;
    judge("MULTIPESTAÑA (otra pestaña abierta) @1440", "/tienda", await visit(c, "/tienda", { settle: 8000 }));
    delay = 0;
    // 3 · logout → visitante → login
    await c.tab.js(`(window.__f812.length = 0, true)`);
    check("LOGOUT UI", await logoutUi(c));
    const so: Sample[] = await c.tab.js(`(window.__f812 || []).map(({ k, ...r }) => r)`);
    const store = await c.tab.js(`(() => { const s = JSON.parse(localStorage.getItem('drl-champions') || '{}').state || {}; return { credits: s.credits, cards: (s.ownedCards || []).length, owner: s.cacheOwner ?? null, session: Object.keys(localStorage).some(k => /^sb-.+-auth-token/.test(k)) }; })()`);
    check("LOGOUT · nunca el saldo de la cuenta como visitante; HUD «Entrar»", so.every((x) => !x.hud || x.hud === "—" || x.hud === REAL_HUD) && so[so.length - 1]?.signin, so.map((x) => `${x.t}:${x.signin ? "I" : ""}[${x.hud}]`).join(" "));
    check("LOGOUT · la caché de la cuenta pasa a la demo de inicio (no se queda como «demo»)", !store.session && store.credits === 6000 && store.cards === 0 && !store.owner, store);
    delay = 3000;
    await c.tab.js(`(window.__f812.length = 0, true)`);
    check("LOGIN de nuevo (servidor +3 s)", await loginUi(c, "QG"));
    await sleep(4000);
    const sl: Sample[] = await c.tab.js(`(window.__f812 || []).map(({ k, ...r }) => r)`);
    // F87.1 · una cuenta con la guía de inicio pendiente aterriza en el VESTÍBULO `/` tras el login: allí el saldo vive en
    // la propia portada (no en el HUD de cabecera). Se juzga el final con la misma regla `isReal` de esa ruta.
    const landed = await c.tab.js<string>("location.pathname");
    check(`LOGIN · nunca la demo (6.000) como saldo de la cuenta; termina en el real (aterriza en ${landed})`, sl.every((x) => !x.six && !(landed === "/" && x.demoHomeCredits) && (!x.hud || x.hud === "—" || x.hud === REAL_HUD)) && !!sl[sl.length - 1] && isReal(landed, sl[sl.length - 1]), sl.map((x) => `${x.t}:${x.signin ? "I" : ""}${x.realText ? "R" : ""}[${x.hud}]`).join(" "));
    delay = 0;
    takeErrs(c);
  } finally { await c.browser.close(); }
}
// 1b · 1024 y 390 con servidor +3 s
for (const w of [1024, 390]) {
  const c = await setup(w);
  try {
    check(`LOGIN UI @${w}`, await loginUi(c, "QG"));
    delay = 3000;
    for (const p of ["/tienda", "/coleccion", "/", ...(w === 390 ? ["/packs/estandar", "/inventario"] : [])]) {
      const shoot = ["/tienda", "/coleccion", "/"].includes(p);
      judge(`servidor +3 s @${w}`, p, await visit(c, p, { settle: 7500, shots: shoot ? [0, 250, 1000, 3000] : [], tag: shoot ? `${w}${p.replace(/\//g, "_")}-d3000` : undefined }));
    }
    await visit(c, "/tienda", { settle: 7000 });
    await c.tab.js(`(window.__f812.length = 0, true)`);
    judge(`Ctrl+F5 (servidor +3 s) @${w}`, "/tienda", await visit(c, "/tienda", { reload: true, settle: 8000 }));
    delay = 0;
    takeErrs(c);
  } finally { await c.browser.close(); }
}
const unexpected = errs.filter((e) => !/net::ERR_ABORTED|status of 401/.test(e));
check("CONSOLA · 0 errores (ni hidratación ni avisos de React)", unexpected.length === 0, unexpected.slice(0, 6));
await sleep(1000);
const s1 = await api();
check("SERVIDOR intacto (solo lectura): créditos, sobres, aperturas y cartas iguales", s1.credits === s0.credits && JSON.stringify(s1.unopened) === JSON.stringify(s0.unopened) && s1.packsOpened === s0.packsOpened && s1.cards === s0.cards, { before: s0, after: s1 });
const fails = rows.filter((r) => !r.ok).length;
writeFileSync(`${OUT}/results.json`, JSON.stringify({ at: new Date().toISOString(), release: "drl-0.1.1-1-dbe08499", user: s0.userId.slice(0, 8), pass: rows.length - fails, fail: fails, rows }, null, 2));
console.log(`\nF81.2 PROD QA: ${rows.length - fails}/${rows.length} PASS`);
process.exit(fails ? 1 : 0);
