/**
 * FASE 68 · CLOSED BETA — SESIONES DE JUGADOR por la INTERFAZ real (:3005 → túnel → BD del VPS). Instrumento `_`, fuera de CI.
 * SOLO cuentas QA. Cada sesión = un navegador nuevo (perfil propio) que entra por /cuenta, juega y deja notas en raw/<id>.json:
 * estado inicial/final (lecturas GET del producto), acciones, pantallas, red, errores de consola, fricción y bugs observados.
 *
 *   npx tsx scripts/_fase68-beta.ts <sesión> [--w=1440] [--reduced] [--tag=r1]
 *
 * Sesiones: new (registro + guía completa + primeros 30 min) · return · casual-store · casual-collection · pve · teams ·
 *           explorer · keyboard · slownet · multitab · longsession · switch · errors · auth
 * Ranked (dos navegadores) vive en `_fase68-ranked.ts`.
 */
import {
  api, back, BASE, bodyHas, clickTid, clickText, collectErrors, creds, dblText, forward, goto, loginUi, logoutUi, net, netReset,
  openBrowser, playOneUi, q, registerUi, reload, screen, shot, sleep, snapshot, SPLASH_GONE, token, waitFor, writeRaw, esc,
  type Client, hasCreds, setInput,
} from "./_fase68-lib";
import { playCoach } from "./_fase68-coach2";

/* eslint-disable @typescript-eslint/no-explicit-any */
const argv = process.argv.slice(2);
const SESSION = argv[0];
const PERSONA = argv[1];
const W = Number(argv.find((a) => a.startsWith("--w="))?.slice(4) ?? 1440);
const REDUCED = argv.includes("--reduced");
const TAG = argv.find((a) => a.startsWith("--tag="))?.slice(6) ?? "r1";

interface Note { t: number; kind: "step" | "friction" | "bug" | "check" | "info"; text: string; data?: any }
const notes: Note[] = [];
const T0 = Date.now();
const note = (kind: Note["kind"], text: string, data?: any) => { notes.push({ t: Math.round((Date.now() - T0) / 1000), kind, text, data }); console.log(`[${Math.round((Date.now() - T0) / 1000)}s] ${kind.toUpperCase()} ${text}${data !== undefined ? " " + JSON.stringify(data).slice(0, 300) : ""}`); };
const check = (name: string, ok: boolean, data?: any) => { note("check", `${ok ? "PASS" : "FAIL"} ${name}`, data); return ok; };
const checks = () => notes.filter((n) => n.kind === "check");

async function finish(c: Client | null, id: string, extra: Record<string, unknown> = {}) {
  if (c) await collectErrors(c);
  const network = c ? await net(c) : null;
  const data = {
    id, session: SESSION, persona: PERSONA, tag: TAG, width: W, reduced: REDUCED, at: new Date().toISOString(),
    durationSec: Math.round((Date.now() - T0) / 1000),
    actions: c?.actions ?? 0, screens: c?.screens ?? 0,
    checks: { pass: checks().filter((x) => x.text.startsWith("PASS")).length, fail: checks().filter((x) => x.text.startsWith("FAIL")).map((x) => x.text) },
    consoleErrors: c?.errors ?? [], network, notes, ...extra,
  };
  writeRaw(id, data);
  if (c) await c.browser.close().catch(() => null);
  return data;
}

/* ─────────────────────────── piezas de juego por la interfaz ─────────────────────────── */

/** Abre el sobre en /abrir/… por la interfaz hasta el resumen. `dbl` = doble clic en ABRIR. */
async function openPackUi(c: Client, opts: { dbl?: boolean; reloadMid?: boolean } = {}): Promise<{ ok: boolean; cards: string[]; ms: number }> {
  const t0 = Date.now();
  const ready = await waitFor(c.tab, q("pack-open"), 20000);
  if (!ready) return { ok: false, cards: [], ms: Date.now() - t0 };
  await sleep(400);
  if (opts.dbl) { await c.tab.js(`(() => { const e = document.querySelector('[data-testid="pack-open"]'); e.click(); e.click(); })()`); c.actions += 2; }
  else await clickTid(c, "pack-open");
  if (opts.reloadMid) { await sleep(900); await reload(c, 3000); }
  for (let i = 0; i < 70; i++) {
    if (await c.tab.js<boolean>(q("pack-summary"))) break;
    const clicked = await clickTid(c, "pack-reveal-all") || await clickTid(c, "pack-skip");
    if (!clicked) { await c.tab.js(`document.querySelector('[data-testid="ceremony-pack"]')?.click()`); c.actions++; }
    if (i === 40 && opts.reloadMid) await clickTid(c, "pack-open");
    await sleep(600);
  }
  const ok = await waitFor(c.tab, q("pack-summary"), 15000);
  const cards = await c.tab.js<string[]>(`[...document.querySelectorAll('[data-testid="summary-card"]')].map(e => e.getAttribute('data-card-id'))`).catch(() => []);
  return { ok, cards: cards ?? [], ms: Date.now() - t0 };
}

/** Juega la partida de /duelos/jugar hasta el resultado por la interfaz. Devuelve el desenlace leído del servidor. */
async function playMatchUi(c: Client, t: string, opts: { f5AtTurn?: number; dblAtTurn?: number; hints?: boolean } = {}) {
  const t0 = Date.now();
  let turns = 0, stuck = 0; const log: string[] = [];
  let matchId: string | null = null;
  const RESULT = `!!document.querySelector('[data-scene="result"]') || /Jugar otra|Volver al gauntlet/i.test(document.body.innerText)`;
  let uiOnly = false;
  for (let guard = 0; guard < 40; guard++) {
    const v = (await api(t, "/api/game/duel", { action: "active" })).json?.view;
    if (v?.matchId) matchId = v.matchId;
    // Partidas que `active` no devuelve (Draft Gauntlet): se juega mirando solo la interfaz, como un jugador.
    if (!v && guard === 0 && await c.tab.js<boolean>(`document.querySelectorAll('[aria-label="Tu mano"] button').length > 0`)) uiOnly = true;
    if (uiOnly) { if (await c.tab.js<boolean>(RESULT)) break; }
    else if (!v || v.status !== "IN_PROGRESS") break;
    if (await c.tab.js<boolean>(q("first-match-hint"))) { await clickTid(c, "first-match-hint-ok"); await sleep(300); }
    const r = await playOneUi(c, opts.dblAtTurn === turns);
    log.push(r);
    if (r !== "played") { stuck++; if (stuck > 4) break; await sleep(1000); continue; }
    stuck = 0;
    await waitFor(c.tab, `!!document.querySelector('[data-f61="moment"]')`, 12000);
    await sleep(REDUCED ? 900 : 1500);
    await c.tab.js(`document.querySelector('[data-f61="moment"]')?.click()`); c.actions++;
    turns++;
    if (opts.f5AtTurn === turns) {
      await reload(c, 3000);
      const rec = await waitFor(c.tab, `!!document.querySelector('[data-hud="turno"]') || /Partida recuperada/.test(document.body.innerText)`, 25000);
      check("F5 a mitad de partida recupera la partida", rec);
    }
  }
  for (let i = 0; i < 60; i++) {
    if (await c.tab.js<boolean>(RESULT)) break;
    await c.tab.js(`document.querySelector('[data-scene="match-complete"], [data-scene="tiebreak"], [data-f61="moment"]')?.click()`);
    await sleep(500);
  }
  const shown = await waitFor(c.tab, RESULT, 20000);
  const res = matchId ? (await api(t, "/api/game/duel", { action: "state", matchId })).json : null;
  const view = res?.view ?? null;
  if (uiOnly) {
    const kind = await c.tab.js<string>(`document.querySelector('[data-scene="result"]')?.getAttribute('data-kind') ?? (/VICTORIA/.test(document.body.innerText) ? 'win' : /DERROTA/.test(document.body.innerText) ? 'loss' : /EMPATE/.test(document.body.innerText) ? 'draw' : '')`);
    return { matchId: null, shown, turns, ms: Date.now() - t0, stuck: log.filter((x) => x !== "played").length, status: shown ? "COMPLETED" : null, result: shown ? { winner: kind, you: null, rival: null, decidedBy: null } : null, difficulty: null, uiOnly: true };
  }
  return { matchId, shown, turns, ms: Date.now() - t0, stuck: log.filter((x) => x !== "played").length, status: view?.status ?? null, result: view?.result ? { winner: view.result.winner, you: view.scoreYou, rival: view.scoreRival, decidedBy: view.result.combat?.decidedBy ?? null } : null, difficulty: view?.difficulty ?? null };
}

/** Sigue la GUÍA F63 haciendo solo lo que la interfaz propone (botón principal de cada paso). Devuelve el recorrido. */
async function followGuide(c: Client, t: string, limit = 60) {
  const path: any[] = [];
  let lastKey = "", same = 0, matches = 0, packs = 0;
  let workaround = 0;
  for (let step = 0; step < limit; step++) {
    await waitFor(c.tab, SPLASH_GONE, 6000);
    await sleep(900);
    const where = await c.tab.js<string>("location.pathname");
    const s = await c.tab.js<any>(`(() => { const has = (t) => !!document.querySelector('[data-testid="' + t + '"]'); return {
      welcome: has('onboarding-welcome'), starter: has('onboarding-starter'), openFirst: has('onboarding-open-first'), packOpen: has('pack-open'),
      summary: has('pack-summary'), firstCard: has('onboarding-first-card'), toCollection: has('onboarding-to-collection'), packNext: has('onboarding-pack-next'),
      collection: has('onboarding-collection'), cont: has('onboarding-continue'), team: has('onboarding-team'), cta: has('onboarding-cta'),
      start: /Comenzar duelo/i.test(document.body.innerText) && !!document.querySelector('section[aria-label="Elegir dificultad"]'),
      afterMatch: has('onboarding-after-match'), progress: has('onboarding-progress'), finishBtn: has('onboarding-finish'), mainActions: has('main-actions'),
      error: has('onboarding-error'), hand: document.querySelectorAll('[aria-label="Tu mano"] button').length } })()`);
    const key = where + JSON.stringify(s);
    same = key === lastKey ? same + 1 : 0; lastKey = key;
    if (same >= 2 && where.startsWith("/abrir/") && s.packNext && workaround < 5) {
      // F68-001: el botón de la guía no hace nada. Lo que haría una persona: ir a la portada y seguir desde allí.
      workaround++; note("bug", `F68-001 · «${await c.tab.js<string>(`document.querySelector('[data-testid="onboarding-cta"]')?.innerText ?? ''`)}» no hace nada en ${where}: salida por la portada`);
      await shot(c, `guide-dead-cta-${step}`); await goto(c, "/", 2500); lastKey = ""; same = 0; continue;
    }
    if (same >= 4) { note("friction", `la guía no avanza en ${where}`, s); await shot(c, `guide-stuck-${step}`); break; }
    let did = "";
    if (s.error) { did = "error"; note("bug", `onboarding-error visible en ${where}`, await screen(c)); }
    if (s.welcome) { await clickTid(c, "onboarding-start"); did = "EMPEZAR"; }
    else if (where.startsWith("/abrir/") && s.packOpen && !s.summary) { const r = await openPackUi(c, { reloadMid: packs === 1 }); packs++; did = `abrir sobre (${r.cards.length} cartas, ${r.ms} ms)`; }
    else if (s.firstCard && s.toCollection) { await clickTid(c, "onboarding-to-collection"); did = "ver mi colección"; }
    else if (where === "/duelos/jugar" && s.start) { await clickText(c, "^Comenzar duelo$"); did = "Comenzar duelo"; await sleep(2500); }
    else if (where === "/duelos/jugar" && s.hand > 0) { const m = await playMatchUi(c, t, { f5AtTurn: 3 }); matches++; did = `partida ${JSON.stringify(m.result)} turns=${m.turns}`; path.push({ step, where, did, match: m }); continue; }
    else if (s.afterMatch) { await clickTid(c, "onboarding-see-progress"); did = "ver mi progreso"; }
    else if (s.finishBtn) { await clickTid(c, "onboarding-finish"); did = "SEGUIR JUGANDO (fin guía)"; path.push({ step, where, did }); await sleep(2500); break; }
    else if (s.starter && s.openFirst) { await clickTid(c, "onboarding-open-first"); did = "abrir primer sobre"; }
    else if (s.packNext || s.collection || s.cont || s.team || s.cta) { const ok = await clickTid(c, "onboarding-cta") || await clickTid(c, "onboarding-open-next"); did = ok ? `cta (${await c.tab.js<string>(`document.querySelector('[data-testid="onboarding-cta"]')?.innerText?.trim() ?? ''`).catch(() => "")})` : "cta no clicable"; }
    else if (where === "/" && s.mainActions && !s.cta && !s.cont) { did = "portada sin guía"; path.push({ step, where, did }); break; }
    else { did = "sin acción visible"; note("friction", `sin paso de guía visible en ${where}`, s); }
    path.push({ step, where, did });
    note("step", `${where} → ${did}`);
    await sleep(1200);
  }
  return { path, matches, packs, final: await snapshot(t) };
}

/* ─────────────────────────── SESIONES ─────────────────────────── */

/** PLAYER NUEVO: registro real + guía F63 entera + «primeros 30 minutos» sin guía. */
async function sNew(p: string) {
  const c = await openBrowser(p, W, { reduced: REDUCED, label: `${p}-${TAG}-${SESSION}` });
  const id = `${p}-${TAG}-${SESSION}`;
  try {
    const t0 = Date.now();
    const resume = SESSION === "resume";
    const cr = resume ? creds(p) : await registerUi(c, p);
    if (resume) check("login por formulario", await loginUi(c, p));
    note("info", `cuenta ${cr.userId.slice(0, 8)} ${resume ? "retoma la guía" : "registrada"}`, { ms: Date.now() - t0 });
    const t = await token(p);
    const start = await snapshot(t);
    note("info", "estado inicial", start);
    if ((await c.tab.js<string>("location.pathname")) !== "/") await goto(c, "/", 2500);
    if (!resume) check("bienvenida visible tras registrarse", await waitFor(c.tab, q("onboarding-welcome"), 25000));
    else check("al volver con la guía a medias, la portada la retoma", await waitFor(c.tab, `${q("onboarding-continue")} || ${q("onboarding-cta")}`, 25000));
    await shot(c, "01-bienvenida");
    const guide = await followGuide(c, t);
    const tGuide = Math.round((Date.now() - t0) / 1000);
    note("info", `guía terminada en ${tGuide}s`, { steps: guide.path.length, matches: guide.matches, packs: guide.packs });
    check("la guía acaba (SEGUIR JUGANDO)", guide.path.some((x) => /fin guía/.test(x.did)), guide.path.slice(-3));
    check("onboarding COMPLETED en el servidor", guide.final.onboarding.status === "COMPLETED", guide.final.onboarding);
    check("tiene equipo válido y activo", guide.final.decks.some((d: any) => d.valid) && !!guide.final.activeDeckId, guide.final.decks);
    await shot(c, "02-fin-guia");

    // ── PRIMEROS 30 MINUTOS: sin guía. Qué propone la interfaz y si el jugador puede seguir solo.
    await goto(c, "/", 2500);
    const home = await screen(c);
    check("portada sin guía tras terminar", !home.testids.some((x: string) => x.startsWith("onboarding-")), home.testids);
    note("info", "portada tras la guía", { testids: home.testids, text: home.text.slice(0, 300) });
    await shot(c, "03-portada-libre");
    // 1) Lo que un jugador haría: JUGAR.
    await clickTid(c, "action-play"); await sleep(2500);
    const hub = await screen(c);
    note("info", `JUGAR → ${hub.url}`, { h: hub.h });
    check("JUGAR lleva al hub de modos", /\/jugar/.test(hub.url));
    await clickTid(c, "mode-cta-QUICK"); await sleep(3000);
    const quick = await screen(c);
    note("info", `Partida rápida → ${quick.url}`, { h: quick.h, buttons: quick.buttons.slice(0, 12) });
    if (await waitFor(c.tab, `/Comenzar duelo/i.test(document.body.innerText)`, 20000)) {
      await clickText(c, "^Comenzar duelo$"); await sleep(2500);
      const m = await playMatchUi(c, t);
      note("step", `2.ª partida (sin guía): ${JSON.stringify(m.result)}`, { ms: m.ms });
      check("2.ª partida termina con resultado visible", m.shown && !!m.result, m);
      await shot(c, "04-resultado-2");
      const r = await screen(c);
      check("resultado ofrece siguiente paso (Jugar otra / lobby)", /Jugar otra/i.test(r.text) || r.buttons.some((b: string) => /JUGAR OTRA/i.test(b)), r.buttons.slice(0, 10));
    } else { note("friction", "Partida rápida no muestra «Comenzar duelo»", quick); }
    // 2) Progreso: objetivo y reclamo si hay algo.
    await goto(c, "/", 2500);
    const claimable = await c.tab.js<boolean>(q("home-claimable"));
    note("info", `portada: home-claimable=${claimable}`);
    await clickTid(c, "home-progress-link") || await goto(c, "/progresion", 2500);
    await sleep(2500);
    const prog = await screen(c);
    note("info", "progresión", { h: prog.h, buttons: prog.buttons.slice(0, 10) });
    await shot(c, "05-progresion");
    const s0 = await snapshot(t);
    const claimed = await claimAllUi(c);
    await sleep(3000);
    const s1 = await snapshot(t);
    note("step", `reclamos: ${claimed}`, { credits: [s0.credits, s1.credits], xp: [s0.xp, s1.xp] });
    if (s1.credits !== s0.credits) {
      await clickText(c, "^Seguir$"); await sleep(1500);
      const hud = await c.tab.js<string>(`(document.querySelector('[data-testid="hud-credits"]') || document.querySelector('[title="DRL Credits"] .nx-readout'))?.innerText ?? ''`);
      if (hud) check("HUD al día tras reclamar (sin recargar)", Number(hud.replace(/[^\d]/g, "")) === s1.credits, { hud, server: s1.credits });
      else note("info", "HUD de saldo no visible en este ancho", { width: W });
    }
    // 3) Colección e inventario de sobres.
    await goto(c, "/coleccion", 3000);
    const col = await screen(c);
    check("colección carga con cartas", /POSE[IÍ]DAS|cartas/i.test(col.text), col.h);
    await shot(c, "06-coleccion");
    await goto(c, "/inventario", 2500);
    const inv = await screen(c);
    note("info", "inventario", { h: inv.h });
    // 4) Tienda (mirar).
    await goto(c, "/tienda", 3000);
    const store = await screen(c);
    note("info", "tienda", { h: store.h, buttons: store.buttons.slice(0, 8) });
    await shot(c, "07-tienda");
    const end = await snapshot(t);
    return await finish(c, id, { account: cr.userId.slice(0, 8), start, guide, end, guideSeconds: tGuide });
  } catch (e) { note("bug", `EXCEPCIÓN ${e instanceof Error ? e.message : e}`); await shot(c, "zz-exception"); return finish(c, id); }
}

/** Reclama TODO lo reclamable por la interfaz de /progresion (con doble clic en el primero). */
async function claimAllUi(c: Client): Promise<string> {
  if (!(await c.tab.js<string>("location.pathname")).startsWith("/progresion")) await goto(c, "/progresion", 3000);
  await sleep(1500);
  const n0 = await c.tab.js<number>(`[...document.querySelectorAll('button')].filter(b => /^Reclamar$/i.test((b.innerText||'').trim()) && !b.disabled).length`);
  if (!n0) return "nada que reclamar";
  // Doble clic en el primer RECLAMAR (hábito real).
  await dblText(c, "^Reclamar$");
  await sleep(2500);
  // Luego RECLAMAR TODO si está.
  const all = await clickTid(c, "claim-all") || await clickText(c, "^Reclamar todo$");
  await sleep(3500);
  const n1 = await c.tab.js<number>(`[...document.querySelectorAll('button')].filter(b => /^Reclamar$/i.test((b.innerText||'').trim()) && !b.disabled).length`);
  return `botones reclamar ${n0} → ${n1} (claim-all=${all})`;
}

/** VUELTA: navegador nuevo, login, nada de guía forzada, nada duplicado, CTA coherente. */
async function sReturn(p: string) {
  const c = await openBrowser(p, W, { reduced: REDUCED, label: `${p}-${TAG}-return` });
  const id = `${p}-${TAG}-return`;
  try {
    const t = await token(p);
    const start = await snapshot(t);
    const starterBefore = (await api(t, "/api/game/starter")).json;
    check("login por formulario", await loginUi(c, p));
    await goto(c, "/", 3000);
    const home = await screen(c);
    await shot(c, "01-portada-vuelta");
    check("sin onboarding forzado al volver", !home.testids.some((x: string) => /^onboarding-(welcome|starter)$/.test(x)), home.testids);
    check("HUD con saldo real", home.testids.includes("hud-credits"));
    const hud = await c.tab.js<string>(`(document.querySelector('[data-testid="hud-credits"]') || document.querySelector('[title="DRL Credits"] .nx-readout'))?.innerText ?? ''`);
    const hudNum = Number(String(hud).replace(/[^\d]/g, ""));
    check("HUD = créditos del servidor", hudNum === start.credits, { hud, server: start.credits });
    note("info", "portada al volver", { testids: home.testids, text: home.text.slice(0, 300) });
    const starterAfter = (await api(t, "/api/game/starter")).json;
    check("sin starter duplicado", JSON.stringify(starterBefore) === JSON.stringify(starterAfter), { starterBefore, starterAfter });
    // La acción principal que propone la portada.
    const cta = await c.tab.js<any>(`(() => { const a = document.querySelector('[data-testid="main-actions"] a, [data-testid="main-actions"] button'); return a ? { text: a.innerText.trim(), href: a.getAttribute('href') } : null })()`);
    note("info", "acción principal de la portada", cta);
    for (const p2 of ["/progresion", "/coleccion", "/jugar", "/temporada"]) {
      await goto(c, p2, 2500);
      const s = await screen(c);
      check(`vuelta: ${p2} sin guía forzada`, !s.testids.some((x: string) => /^onboarding-(welcome|starter)$/.test(x)));
    }
    const end = await snapshot(t);
    check("vuelta sin escrituras de juego (solo lectura)", start.credits === end.credits && start.ownedCards === end.ownedCards && start.xp === end.xp, { start, end });
    return await finish(c, id, { start, end, starterBefore, starterAfter });
  } catch (e) { note("bug", `EXCEPCIÓN ${e instanceof Error ? e.message : e}`); return finish(c, id); }
}

/** CASUAL · SOBRES + TIENDA: inventario, apertura con doble clic/F5/atrás, compra con doble clic, saldo insuficiente. */
async function sStore(p: string) {
  const c = await openBrowser(p, W, { reduced: REDUCED, label: `${p}-${TAG}-store` });
  const id = `${p}-${TAG}-store`;
  const ev: any = { opens: [], buys: [] };
  try {
    const t = await token(p);
    const start = await snapshot(t);
    ev.start = start;
    await loginUi(c, p);
    // 1) INVENTARIO → abrir los sobres que haya (hasta 3), con hábitos: doble clic, F5 en ceremonia, atrás.
    for (let i = 0; i < 3; i++) {
      await goto(c, "/inventario", 3000);
      const has = await c.tab.js<boolean>(q("inventory-open-cta"));
      if (!has) { note("info", "inventario sin sobres para abrir"); break; }
      const before = await snapshot(t);
      await clickTid(c, "inventory-open-cta"); await sleep(2500);
      const where = await c.tab.js<string>("location.pathname");
      const r = await openPackUi(c, { dbl: i === 0, reloadMid: i === 1 });
      const after = await snapshot(t);
      const opened = (before.packsOpened ?? 0) - 0;
      ev.opens.push({ i, where, ok: r.ok, cards: r.cards.length, ms: r.ms, packsOpened: [before.packsOpened, after.packsOpened], owned: [before.ownedCards, after.ownedCards] });
      check(`sobre ${i + 1}: se abre una sola vez (packsOpened +1)`, (after.packsOpened ?? 0) - (opened ?? 0) === 1, ev.opens[i]);
      if (i === 0) await shot(c, "01-resumen-sobre");
      if (i === 2) { await back(c, 2500); const s = await screen(c); check("atrás tras abrir no reabre ni rompe", !/Error|500/.test(s.h.join(" ")), s.url); }
    }
    // 2) TIENDA: comprar el sobre más barato con doble clic en «Confirmar».
    await goto(c, "/tienda", 3000);
    await shot(c, "02-tienda");
    const s0 = await snapshot(t);
    const opened = await c.tab.js<boolean>(`(() => { const b = [...document.querySelectorAll('button')].find(x => /^Comprar$/i.test((x.innerText||'').trim()) && !x.disabled); if (!b) return false; b.click(); return true; })()`);
    c.actions++;
    await waitFor(c.tab, q("store-purchase-modal"), 8000);
    const modal = await c.tab.js<string>(`document.querySelector('[data-testid="store-purchase-modal"]')?.innerText ?? ''`);
    note("info", "modal de compra", modal.replace(/\s+/g, " ").slice(0, 400));
    await shot(c, "03-modal-compra");
    const priceTxt = /Confirmar · ([\d.]+)/i.exec(modal)?.[1] ?? null;
    const price = priceTxt ? Number(priceTxt.replace(/\./g, "")) : null;
    const dbl = await dblText(c, "^Confirmar ·");
    await sleep(4000);
    const done = await c.tab.js<string>(`document.querySelector('[data-testid="store-purchase-modal"]')?.innerText ?? ''`);
    const s1 = await snapshot(t);
    ev.buys.push({ opened, price, dbl, credits: [s0.credits, s1.credits], packs: [s0.unopenedPacks, s1.unopenedPacks], modalAfter: done.replace(/\s+/g, " ").slice(0, 200) });
    check("doble clic en comprar cobra UNA vez", price !== null && s0.credits - s1.credits === price, ev.buys[0]);
    const pk0 = Object.values(s0.unopenedPacks ?? {}).reduce((a: number, b: any) => a + Number(b), 0), pk1 = Object.values(s1.unopenedPacks ?? {}).reduce((a: number, b: any) => a + Number(b), 0);
    check("doble clic en comprar añade UN sobre", pk1 - pk0 === 1, { pk0, pk1 });
    check("modal confirma saldo nuevo", /Saldo: ([\d.]+)/.test(done), done.slice(0, 120));
    await shot(c, "04-compra-hecha");
    // «Abrir ahora» desde el modal.
    if (await clickText(c, "^Abrir ahora$")) { await sleep(2500); const r = await openPackUi(c); ev.openNow = r; check("«Abrir ahora» abre el sobre comprado", r.ok); }
    // 3) SALDO INSUFICIENTE: el producto más caro que el saldo (sin gastar el saldo).
    await goto(c, "/tienda", 3000);
    const s2 = await snapshot(t);
    const bigTried = await c.tab.js<any>(`(() => {
      const cards = [...document.querySelectorAll('button')].filter(x => /^Comprar$/i.test((x.innerText||'').trim()) && !x.disabled);
      return cards.length; })()`);
    let insufficient: any = null;
    // Prueba cada producto hasta dar con uno cuyo modal diga «Saldo insuficiente».
    for (let i = 0; i < Math.min(bigTried, 12) && !insufficient; i++) {
      await c.tab.js(`[...document.querySelectorAll('button')].filter(x => /^Comprar$/i.test((x.innerText||'').trim()) && !x.disabled)[${i}]?.click()`);
      await waitFor(c.tab, q("store-purchase-modal"), 5000);
      const txt = await c.tab.js<string>(`document.querySelector('[data-testid="store-purchase-modal"]')?.innerText ?? ''`);
      if (/Saldo insuficiente/i.test(txt)) {
        const disabled = await c.tab.js<boolean>(`(() => { const b = [...document.querySelectorAll('[data-testid="store-purchase-modal"] button')].find(x => /Confirmar/i.test(x.innerText)); return b ? b.disabled : null })()`);
        insufficient = { text: txt.replace(/\s+/g, " ").slice(0, 300), confirmDisabled: disabled };
        await shot(c, "05-saldo-insuficiente");
      }
      await c.tab.js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`); await sleep(500);
    }
    // Si ningún producto de la vitrina supera el saldo, se prueba por la API real con la caja (10 sobres) — misma ruta que la UI.
    if (!insufficient) note("info", "ningún producto de la vitrina supera el saldo", { credits: s2.credits });
    ev.insufficient = insufficient;
    if (insufficient) check("saldo insuficiente: aviso claro y botón desactivado", insufficient.confirmDisabled === true, insufficient);
    const s3 = await snapshot(t);
    check("probar saldo insuficiente no cambia saldo ni inventario", s2.credits === s3.credits && JSON.stringify(s2.unopenedPacks) === JSON.stringify(s3.unopenedPacks));
    // 4) Colección refleja las cartas nuevas (sin estado viejo).
    await goto(c, "/coleccion", 3000);
    const col = await screen(c);
    ev.collectionText = col.text.slice(0, 200);
    const end = await snapshot(t);
    ev.end = end;
    check("saldo nunca negativo", (end.credits ?? 0) >= 0);
    return await finish(c, id, ev);
  } catch (e) { note("bug", `EXCEPCIÓN ${e instanceof Error ? e.message : e}`); await shot(c, "zz-exception"); return finish(c, id, ev); }
}

/** CASUAL · COLECCIÓN: filtros, orden, detalle de carta, progreso, F5 y atrás. */
async function sCollection(p: string) {
  const c = await openBrowser(p, W, { reduced: REDUCED, label: `${p}-${TAG}-collection` });
  const id = `${p}-${TAG}-collection`;
  const ev: any = {};
  try {
    const t = await token(p);
    const start = await snapshot(t);
    await loginUi(c, p);
    const tl = Date.now();
    await goto(c, "/coleccion", 1000);
    await waitFor(c.tab, q("collection-book"), 20000);
    ev.loadMs = Date.now() - tl;
    await shot(c, "01-coleccion");
    // Poseídas.
    ev.owned = await clickText(c, "^Pose[ií]das$"); await sleep(1500);
    ev.visibleOwned = await c.tab.js<number>(`document.querySelectorAll('[data-testid="collection-book"] [data-card-id], [data-testid="collection-book"] a[href*="/coleccion/carta/"]').length`);
    // Orden.
    ev.sort = await c.tab.js<any>(`(() => { const s = document.querySelector('[data-testid="collection-sort"]'); if (!s) return null; if (s.tagName === 'SELECT') { const o = [...s.options].map(x => x.value); s.value = o[o.length - 1]; s.dispatchEvent(new Event('change', { bubbles: true })); return o; } s.click(); return 'button'; })()`);
    await sleep(1200);
    // Filtros.
    ev.filters = await clickTid(c, "collection-filters-toggle"); await sleep(1000);
    await shot(c, "02-filtros");
    // Búsqueda.
    await setInput(c, '[data-testid="collection-search"] input, input[data-testid="collection-search"]', "a"); await sleep(1200);
    // Detalle de carta.
    const href = await c.tab.js<string>(`document.querySelector('a[href*="/coleccion/carta/"]')?.getAttribute('href') ?? null`);
    ev.cardHref = href;
    if (href) {
      await c.tab.js(`document.querySelector('a[href*="/coleccion/carta/"]').click()`); c.actions++;
      await sleep(3000);
      const d = await screen(c);
      ev.detail = { url: d.url, h: d.h };
      check("detalle de carta abre", /\/coleccion\/carta\//.test(d.url), d.url);
      await shot(c, "03-detalle-carta");
      await reload(c, 3000);
      const d2 = await screen(c);
      check("F5 en el detalle de carta conserva la pantalla", d2.url === d.url && !/no existe/i.test(d2.h.join(" ")), d2.h);
      await back(c, 2500);
      const b = await screen(c);
      check("atrás vuelve a la colección", /\/coleccion/.test(b.url), b.url);
    } else note("friction", "la colección no ofrece enlaces a detalle de carta");
    // Progreso de colección (álbum / sets).
    await goto(c, "/coleccion?vista=album", 2500);
    ev.album = (await screen(c)).h;
    const end = await snapshot(t);
    check("colección sin escrituras", start.ownedCards === end.ownedCards && start.credits === end.credits);
    return await finish(c, id, ev);
  } catch (e) { note("bug", `EXCEPCIÓN ${e instanceof Error ? e.message : e}`); await shot(c, "zz-exception"); return finish(c, id, ev); }
}

/** EQUIPOS: crear, autocompletar, cambiar carta, guardar (doble clic), activar, F5, inválido. */
async function sTeams(p: string) {
  const c = await openBrowser(p, W, { reduced: REDUCED, label: `${p}-${TAG}-teams` });
  const id = `${p}-${TAG}-teams`;
  const ev: any = {};
  try {
    const t = await token(p);
    const start = await snapshot(t);
    ev.start = { decks: start.decks, active: start.activeDeckId };
    await loginUi(c, p);
    await goto(c, "/duelos/mazos", 3000);
    await shot(c, "01-mis-equipos");
    // ── NUEVO EQUIPO → dejarlo INCOMPLETO (1 carta) y guardar: ¿se entiende por qué no se puede activar?
    await clickText(c, "^\\+ Nuevo equipo$|^\\+ Crear equipo|^Crear mi primer equipo$"); await sleep(3000);
    const b0 = await screen(c);
    ev.builder = { url: b0.url, testids: b0.testids.filter((x: string) => /save|auto|slot|collection|activate|count|name/.test(x)) };
    note("info", "constructor", ev.builder);
    const tile = `[...document.querySelectorAll('button')].filter(x => x.offsetParent !== null && !x.disabled && /^SH \\d+ GS \\d+ EF \\d+$/.test((x.innerText||'').trim().replace(/\\s+/g, ' ')))`;
    if (!(await c.tab.js<number>(`${tile}.length`))) { await clickTid(c, "open-collection"); await sleep(1500); }
    const added = await c.tab.js<number>(`(() => { const b = ${tile}; if (b[0]) b[0].click(); return b.length; })()`);
    c.actions++;
    await sleep(1200);
    await c.tab.js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await sleep(600);
    const count1 = await c.tab.js<string>(`document.querySelector('[data-testid="deck-count"]')?.innerText ?? ''`);
    ev.partial = { candidates: added, count: count1 };
    await clickTid(c, "save-team"); await sleep(3000);
    const afterPartial = await screen(c);
    const hint = await c.tab.js<string>(`document.querySelector('[data-testid="activate-hint"]')?.innerText ?? ''`);
    const saveErr = await c.tab.js<string>(`document.querySelector('[data-testid="save-error"]')?.innerText ?? ''`);
    ev.invalid = { hint, saveErr, activateDisabled: await c.tab.js<boolean>(`document.querySelector('[data-testid="activate-team"]')?.disabled ?? null`) };
    await shot(c, "02-equipo-incompleto");
    check("equipo incompleto: explica por qué no se puede activar (sin código crudo)", (hint.length > 10 || saveErr.length > 10) && !/[A-Z_]{6,}/.test(hint + saveErr), ev.invalid);
    // ── AUTOCOMPLETAR y guardar (doble clic en guardar).
    const auto = await clickText(c, "^Autocompletar equipo$");
    await sleep(2500);
    const count2 = await c.tab.js<string>(`document.querySelector('[data-testid="deck-count"]')?.innerText ?? ''`);
    ev.auto = { clicked: auto, count: count2, result: await c.tab.js<string>(`document.querySelector('[data-testid="autocomplete-result"]')?.innerText ?? ''`) };
    await shot(c, "03-autocompletado");
    const decksBeforeSave = (await snapshot(t)).decks.length;
    await c.tab.js(`(() => { const e = document.querySelector('[data-testid="save-team"]'); if (e && !e.disabled) { e.click(); e.click(); } })()`); c.actions += 2;
    await sleep(3500);
    const s1 = await snapshot(t);
    ev.afterAutoSave = { decks: s1.decks, saveErr: await c.tab.js<string>(`document.querySelector('[data-testid="save-error"]')?.innerText ?? ''`) };
    check("doble clic en guardar no duplica el equipo", s1.decks.length === decksBeforeSave, { before: decksBeforeSave, after: s1.decks.length });
    const newest = s1.decks.find((d: any) => !start.decks.some((x: any) => x.id === d.id));
    check("equipo autocompletado se guarda válido", !!newest?.valid, newest);
    // ── ACTIVAR.
    const act = await clickTid(c, "activate-team"); await sleep(3000);
    const s2 = await snapshot(t);
    ev.activate = { clicked: act, active: s2.activeDeckId, newest: newest?.id };
    check("activar el nuevo equipo persiste", !!newest && s2.activeDeckId === newest.id, ev.activate);
    // ── CAMBIAR UNA CARTA: quitar un hueco y autocompletar de nuevo → guardar.
    const removed = await clickTid(c, "slot-remove"); await sleep(800);
    const dirty = await c.tab.js<boolean>(q("unsaved"));
    ev.change = { removed, dirty };
    await clickText(c, "^Autocompletar equipo$"); await sleep(2000);
    await clickTid(c, "save-team"); await sleep(3000);
    // ── F5 + volver: persiste.
    await reload(c, 3500);
    await goto(c, "/duelos/mazos", 3000);
    const list = await screen(c);
    await shot(c, "04-mis-equipos-despues");
    const s3 = await snapshot(t);
    check("tras F5 el equipo activo sigue", s3.activeDeckId === s2.activeDeckId, { s2: s2.activeDeckId, s3: s3.activeDeckId });
    check("la lista pinta el equipo activo", list.testids.includes("active-team"));
    ev.end = { decks: s3.decks, active: s3.activeDeckId };
    return await finish(c, id, ev);
  } catch (e) { note("bug", `EXCEPCIÓN ${e instanceof Error ? e.message : e}`); await shot(c, "zz-exception"); return finish(c, id, ev); }
}

/** PvE: Fácil/Normal/Difícil, Jugar otra, cambiar rival/equipo, volver a la portada y re-entrar. */
async function sPve(p: string) {
  const c = await openBrowser(p, W, { reduced: REDUCED, label: `${p}-${TAG}-pve` });
  const id = `${p}-${TAG}-pve`;
  const ev: any = { matches: [] };
  try {
    const t = await token(p);
    const start = await snapshot(t);
    ev.start = start;
    await loginUi(c, p);
    const n = Number(argv.find((a) => a.startsWith("--n="))?.slice(4) ?? 4);
    const plan = ["Fácil", "Normal", "Difícil", "Normal", "Fácil", "Difícil"].slice(0, n);
    for (let i = 0; i < plan.length; i++) {
      const before = await snapshot(t);
      if (i === 0) { await goto(c, "/jugar", 2500); await clickTid(c, "mode-cta-QUICK"); await sleep(3000); }
      else if (i === 1) { await clickText(c, "^Jugar otra"); await sleep(2500); } // Play Again: misma dificultad → luego se cambia
      else if (i === 2) { await clickText(c, "^Cambiar rival o equipo$"); await sleep(2500); }
      else if (i === 3) { await goto(c, "/", 2500); await clickTid(c, "action-play"); await sleep(2500); await clickTid(c, "mode-cta-QUICK"); await sleep(3000); }
      else { await back(c, 2500); await goto(c, "/jugar", 2500); await clickTid(c, "mode-cta-QUICK"); await sleep(3000); }
      // Si estamos en la preparación, elegir dificultad y comenzar.
      if (await waitFor(c.tab, `/Comenzar duelo/i.test(document.body.innerText)`, 8000)) {
        await c.tab.js(`(() => { const s = document.querySelector('section[aria-label="Elegir dificultad"]'); const b = s && [...s.querySelectorAll('button')].find(x => x.innerText.trim().startsWith(${esc(plan[i])})); if (b) b.click(); return !!b; })()`); c.actions++;
        await sleep(400);
        await clickText(c, "^Comenzar duelo$"); await sleep(2500);
      }
      const m = await playMatchUi(c, t, { f5AtTurn: i === 2 ? 5 : undefined, dblAtTurn: i === 1 ? 2 : undefined });
      const after = await snapshot(t);
      const rec = { i, wanted: plan[i], ...m, credits: [before.credits, after.credits], xp: [before.xp, after.xp] };
      ev.matches.push(rec);
      note("step", `PvE ${i + 1} ${plan[i]} → ${m.difficulty} ${JSON.stringify(m.result)} ${m.ms} ms`);
      check(`PvE ${i + 1}: resultado visible`, m.shown && !!m.result, rec);
      if (i === 0) await shot(c, "01-resultado");
      // F5 en el resultado: sin pagar otra vez.
      if (i === 0) {
        await reload(c, 3500);
        const again = await snapshot(t);
        check("F5 en el resultado no paga otra vez", again.credits === after.credits && again.xp === after.xp, { after: [after.credits, after.xp], again: [again.credits, again.xp] });
      }
    }
    const diffs = ev.matches.map((m: any) => m.difficulty);
    check("se jugaron las tres dificultades", ["EASY", "NORMAL", "HARD"].every((d) => diffs.includes(d)), diffs);
    ev.outcomes = ev.matches.map((m: any) => m.result?.winner ?? null);
    // Sin partida colgada.
    const active = (await api(t, "/api/game/duel", { action: "active" })).json?.view;
    check("sin partida PvE viva tras terminar", !active || active.status !== "IN_PROGRESS", active?.status);
    ev.end = await snapshot(t);
    return await finish(c, id, ev);
  } catch (e) { note("bug", `EXCEPCIÓN ${e instanceof Error ? e.message : e}`); await shot(c, "zz-exception"); return finish(c, id, ev); }
}

/** EXPLORADOR: modos secundarios, perfil, navegación (atrás/adelante/URL directa/F5), 404. */
async function sExplorer(p: string) {
  const c = await openBrowser(p, W, { reduced: REDUCED, label: `${p}-${TAG}-explorer` });
  const id = `${p}-${TAG}-explorer`;
  const ev: any = {};
  try {
    const t = await token(p);
    const start = await snapshot(t);
    await loginUi(c, p);
    // ── DRAFT GAUNTLET
    await goto(c, "/jugar", 2500);
    await clickTid(c, "mode-cta-DRAFT_GAUNTLET"); await sleep(3000);
    ev.draft = await draftRun(c, t);
    // ── TACTICAL COACH (Quick Play)
    ev.coach = await playCoach(c, t, `${p}-${TAG}-explorer`);
    check("Coach: partido completo con resultado y guardado en el historial", !!ev.coach.final && ev.coach.historyGrew, { final: ev.coach.final?.slice(0, 120), grew: ev.coach.historyGrew });
    check("Coach: los agentes reales se ven con su arte", ev.coach.agentFaces >= 5, ev.coach.agentFaces);
    // ── PICK'EMS
    await goto(c, "/pickems", 3500);
    const pk = await screen(c);
    ev.pickems = { h: pk.h, buttons: pk.buttons.slice(0, 12) };
    await shot(c, "05-pickems");
    ev.pickems.interaction = await pickemsTry(c, t);
    // ── PERFIL propio y público
    const me = creds(p).userId;
    await goto(c, `/jugador/${me}`, 3500);
    const prof = await screen(c);
    ev.profile = { h: prof.h, testids: prof.testids.filter((x: string) => /profile|showcase|stat|level|season|ranked|achiev/.test(x)), text: prof.text.slice(0, 400) };
    await shot(c, "06-perfil");
    // ── SOCIAL
    await goto(c, "/social", 3000);
    const so = await screen(c);
    ev.social = { h: so.h, buttons: so.buttons.slice(0, 20) };
    await shot(c, "07-social");
    // ── NAVEGACIÓN: atrás/adelante/URL directa/F5/deep links.
    const nav: any[] = [];
    for (const path of ["/temporada", "/competitivo", "/logros", "/coleccion/equipos", "/duelos/competitivo/historial", "/eventos", "/torneos", "/noticias"]) {
      await goto(c, path, 2500);
      const s = await screen(c);
      nav.push({ path, url: s.url, h: s.h.slice(0, 2), broken: s.broken.length, hScroll: s.hScroll });
    }
    await back(c); const b1 = await c.tab.js<string>("location.pathname");
    await back(c); const b2 = await c.tab.js<string>("location.pathname");
    await forward(c); const f1 = await c.tab.js<string>("location.pathname");
    ev.history = { b1, b2, f1 };
    check("atrás/adelante recorre el historial", b1 === "/torneos" && b2 === "/eventos" && f1 === "/torneos", ev.history);
    await reload(c); ev.reloadOn = await c.tab.js<string>("location.pathname");
    ev.nav = nav;
    // 404 + «VOLVER AL JUEGO».
    await goto(c, "/esto-no-existe-f68", 2500);
    await shot(c, "08-404");
    const nf = await screen(c);
    const back404 = await c.tab.js<any>(`(() => { const a = [...document.querySelectorAll('a, button')].find(x => /volver/i.test(x.innerText)); return a ? { text: a.innerText.trim(), href: a.getAttribute('href') } : null })()`);
    ev.notFound = { h: nf.h, back404 };
    if (back404) { await clickText(c, "volver"); await sleep(2500); ev.notFound.after = await c.tab.js<string>("location.pathname"); }
    check("404 con salida al juego", !!back404 && ev.notFound.after && ev.notFound.after !== "/esto-no-existe-f68", ev.notFound);
    // Rutas con id inválido.
    for (const path of ["/duelos/replay/00000000-0000-4000-8000-000000000000", "/jugador/00000000-0000-4000-8000-000000000000", "/coleccion/carta/no-existe", "/abrir/no-existe", "/duelos/competitivo/partida/nope"]) {
      await goto(c, path, 3000);
      const s = await screen(c);
      (ev.invalid ??= []).push({ path, h: s.h.slice(0, 2), text: s.text.slice(0, 160), links: s.links.slice(0, 4) });
    }
    const end = await snapshot(t);
    ev.start = start; ev.end = end;
    return await finish(c, id, ev);
  } catch (e) { note("bug", `EXCEPCIÓN ${e instanceof Error ? e.message : e}`); await shot(c, "zz-exception"); return finish(c, id, ev); }
}

async function draftRun(c: Client, t: string) {
  const out: any = { steps: [] };
  const s0 = await screen(c);
  out.entry = { url: s0.url, h: s0.h, buttons: s0.buttons.slice(0, 8) };
  await shot(c, "01-draft-entrada");
  if (await clickTid(c, "draft-start")) { out.started = "nueva run"; await sleep(3500); }
  else if (await c.tab.js<boolean>(`${q("draft-room")} || ${q("draft-gauntlet")} || ${q("draft-resume-match")}`)) out.started = "retoma la run en curso";
  else if ((await c.tab.js<string>("location.pathname")) === "/duelos/jugar") out.started = "retoma la partida del gauntlet en curso";
  else { note("friction", "draft sin botón de empezar ni run en curso", s0.buttons); return out; }
  for (let i = 0; i < 40; i++) {
    const s = await c.tab.js<any>(`(() => ({ picks: document.querySelectorAll('[data-testid^="draft-pick"], [data-testid="draft-option"]').length, tids: [...new Set([...document.querySelectorAll('[data-testid^="draft"]')].map(e => e.getAttribute('data-testid')))], buttons: [...document.querySelectorAll('button')].filter(b => b.offsetParent !== null && !b.disabled).map(b => b.innerText.trim().replace(/\\s+/g,' ')).slice(0, 15), url: location.pathname }))()`);
    out.steps.push(s);
    if (s.url === "/duelos/jugar") {
      if (await waitFor(c.tab, `/Comenzar duelo/i.test(document.body.innerText) || document.querySelectorAll('[aria-label="Tu mano"] button').length > 0`, 15000)) {
        await clickText(c, "^Comenzar duelo$"); await sleep(2500);
      }
      const m = await playMatchUi(c, t);
      out.match = m;
      await shot(c, "03-draft-resultado");
      const back = await clickText(c, "^Volver al gauntlet$"); await sleep(3000);
      out.backToGauntlet = back;
      out.afterMatch = await screen(c);
      break;
    }
    // Elegir: primera opción de draft disponible, o botón de continuar/jugar.
    const picked = await c.tab.js<boolean>(`(() => { const o = [...document.querySelectorAll('[data-testid="draft-option"]')].map(x => x.tagName === 'BUTTON' ? x : (x.querySelector('button') || x)).find(x => !x.disabled && x.offsetParent !== null); if (o) { o.click(); return true; } return false; })()`);
    c.actions++;
    if (picked) { await sleep(700); await clickTid(c, "draft-confirm"); }
    if (!picked) {
      const next = await clickTid(c, "draft-start-match") || await clickTid(c, "draft-resume-match") || await clickTid(c, "draft-result-back");
      if (!next) { note("friction", "draft: no encuentro la siguiente acción", s); await shot(c, `02-draft-atasco-${i}`); break; }
    }
    if (i === 1) await shot(c, "02-draft-eleccion");
    await sleep(1800);
  }
  const run = (await api(t, "/api/game/draft-gauntlet")).json;
  out.server = run ? { status: run.run?.status ?? run.status ?? null, keys: Object.keys(run).slice(0, 12) } : null;
  return out;
}

async function coachRun(c: Client, t: string) {
  const out: any = {};
  await goto(c, "/entrenador/jugar", 3500);
  const before = (await api(t, "/api/game/coach-matches")).json;
  out.historyBefore = Array.isArray(before?.matches) ? before.matches.length : before ? Object.keys(before) : null;
  for (const a of ["jett", "omen", "sova", "killjoy", "breach"]) { await clickTid(c, `quick-agent-${a}`); await sleep(250); }
  out.count = await c.tab.js<string>(`document.querySelector('[data-testid="quick-count"]')?.innerText ?? ''`);
  out.faces = await c.tab.js<number>(`[...document.querySelectorAll('[data-testid="agent-face"] img, img[src*="/agents/"]')].filter(i => i.complete && i.naturalWidth > 0).length`);
  await clickTid(c, "play-dif-normal");
  await shot(c, "04-coach-composicion");
  await clickTid(c, "quick-save-play"); await sleep(5000);
  const s = await screen(c);
  out.after = { url: s.url, h: s.h, testids: s.testids.filter((x: string) => /match|sim|result|theater|play|map/.test(x)).slice(0, 20) };
  // Esperar al final del partido (el teatro puede tardar): buscar resultado.
  const done = await waitFor(c.tab, `/(Victoria|Derrota|Empate|Resultado|Final del partido)/i.test(document.body.innerText)`, 90000);
  out.resultShown = done;
  await shot(c, "04b-coach-resultado");
  const after = (await api(t, "/api/game/coach-matches")).json;
  out.historyAfter = Array.isArray(after?.matches) ? after.matches.length : after ? Object.keys(after) : null;
  return out;
}

async function pickemsTry(c: Client, t: string) {
  // Solo mirar si hay predicciones abiertas; se hace UNA predicción si la interfaz lo permite (flujo real del jugador).
  const r = await api(t, "/api/pickems");
  const out: any = { apiStatus: r.status, keys: r.json && typeof r.json === "object" ? Object.keys(r.json).slice(0, 10) : null };
  const cta = await clickText(c, "Completar ahora|predicciones pendientes");
  await sleep(2500);
  out.cta = cta;
  out.after = (await screen(c)).h;
  return out;
}

/** TECLADO: navegación con Tab/Enter, modal con Escape, formulario de auth. */
async function sKeyboard(p: string) {
  const c = await openBrowser(p, W, { reduced: REDUCED, label: `${p}-${TAG}-keyboard` });
  const id = `${p}-${TAG}-keyboard`;
  const ev: any = {};
  const key = async (k: string, code = k, shift = false) => {
    const kc: Record<string, number> = { Tab: 9, Enter: 13, Escape: 27, " ": 32 };
    await c.tab.send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: kc[k] ?? 0, modifiers: shift ? 8 : 0, text: k === "Enter" ? "\r" : undefined });
    await c.tab.send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: kc[k] ?? 0, modifiers: shift ? 8 : 0 });
    c.actions++; await sleep(120);
  };
  const focused = () => c.tab.js<any>(`(() => { const a = document.activeElement; if (!a || a === document.body) return null; const cs = getComputedStyle(a); return { tag: a.tagName, text: (a.innerText || a.getAttribute('aria-label') || a.getAttribute('placeholder') || '').trim().slice(0, 40), outline: cs.outlineStyle !== 'none' || cs.boxShadow !== 'none' }; })()`);
  try {
    // AUTH por teclado: tab hasta email, escribir, tab a password, Enter.
    const cr = creds(p);
    await goto(c, "/cuenta", 2500);
    await c.tab.js(`document.querySelector('input[type="email"]')?.focus()`);
    await c.tab.send("Input.insertText", { text: cr.email });
    await key("Tab");
    ev.afterEmailTab = await focused();
    await c.tab.send("Input.insertText", { text: cr.password });
    await key("Enter", "Enter");
    const ok = await waitFor(c.tab, `!document.querySelector('input[type="password"]')`, 20000);
    check("login solo con teclado (Tab + Enter)", ok, ev.afterEmailTab);
    // PORTADA: recorrer con Tab los primeros 15 focos (visibles y con foco marcado).
    await goto(c, "/", 3000);
    const foci: any[] = [];
    for (let i = 0; i < 15; i++) { await key("Tab"); foci.push(await focused()); }
    ev.homeFoci = foci;
    check("portada: el foco recorre elementos con indicador visible", foci.filter(Boolean).length >= 10 && foci.filter((f) => f?.outline).length >= 8, foci.map((f) => f?.text));
    // Activar JUGAR con Enter.
    await c.tab.js(`document.querySelector('[data-testid="action-play"]')?.focus()`);
    await key("Enter", "Enter"); await sleep(2500);
    ev.enterPlay = await c.tab.js<string>("location.pathname");
    check("Enter sobre JUGAR navega", ev.enterPlay === "/jugar", ev.enterPlay);
    // MODAL de tienda: abrir con Enter, Escape cierra y devuelve el foco.
    await goto(c, "/tienda", 3000);
    await c.tab.js(`[...document.querySelectorAll('button')].find(x => /^Comprar$/i.test((x.innerText||'').trim()) && !x.disabled)?.focus()`);
    await key("Enter", "Enter"); await sleep(1200);
    const open = await c.tab.js<boolean>(q("store-purchase-modal"));
    const inModal = await c.tab.js<boolean>(`!!document.activeElement?.closest('[data-testid="store-purchase-modal"]')`);
    for (let i = 0; i < 6; i++) await key("Tab");
    const trapped = await c.tab.js<boolean>(`!!document.activeElement?.closest('[data-testid="store-purchase-modal"]')`);
    await key("Escape", "Escape"); await sleep(600);
    const closed = !(await c.tab.js<boolean>(q("store-purchase-modal")));
    const returned = await c.tab.js<string>(`(document.activeElement?.innerText || '').trim()`);
    ev.modal = { open, inModal, trapped, closed, returned };
    check("modal: foco dentro, atrapado, Escape cierra y devuelve el foco", open && inModal && trapped && closed && /comprar/i.test(returned), ev.modal);
    // COLECCIÓN: búsqueda por teclado.
    await goto(c, "/coleccion", 3000);
    await c.tab.js(`(document.querySelector('[data-testid="collection-search"] input') || document.querySelector('input[data-testid="collection-search"]') || document.querySelector('input[type="search"]'))?.focus()`);
    await c.tab.send("Input.insertText", { text: "jett" }); await sleep(1500);
    ev.collectionSearch = await c.tab.js<string>(`(document.activeElement?.value ?? '')`);
    check("colección: se puede buscar con el teclado", ev.collectionSearch === "jett", ev.collectionSearch);
    // EQUIPOS: tabular hasta el primer botón de la lista.
    await goto(c, "/duelos/mazos", 3000);
    const tf: any[] = [];
    for (let i = 0; i < 12; i++) { await key("Tab"); tf.push(await focused()); }
    ev.teamsFoci = tf.map((f) => f?.text);
    check("equipos: sus acciones son alcanzables con Tab", tf.some((f) => /editar|nuevo|crear/i.test(f?.text ?? "")), ev.teamsFoci);
    return await finish(c, id, ev);
  } catch (e) { note("bug", `EXCEPCIÓN ${e instanceof Error ? e.message : e}`); return finish(c, id, ev); }
}

/** RED MEDIOCRE: latencia 400 ms + 1,5 Mbps. Portada, colección, progreso, un sobre si hay y una partida. */
async function sSlowNet(p: string) {
  const c = await openBrowser(p, W, { reduced: REDUCED, label: `${p}-${TAG}-slownet` });
  const id = `${p}-${TAG}-slownet`;
  const ev: any = { timings: {} };
  try {
    const t = await token(p);
    await loginUi(c, p);
    await c.tab.send("Network.enable");
    await c.tab.send("Network.emulateNetworkConditions", { offline: false, latency: 400, downloadThroughput: 1.5e6 / 8, uploadThroughput: 750e3 / 8 });
    const time = async (name: string, path: string, readyExpr: string) => {
      const t0 = Date.now(); await c.tab.goto(`${BASE}${path}`, 300); c.screens++; c.actions++;
      const loading = await c.tab.js<boolean>(`/Cargando|Leyendo|Preparando/i.test(document.body.innerText) || !!document.querySelector('[aria-busy="true"], [data-loading]')`).catch(() => null);
      const ok = await waitFor(c.tab, readyExpr, 45000);
      ev.timings[name] = { ms: Date.now() - t0, ok, sawLoading: loading };
    };
    await time("home", "/", q("main-actions"));
    await time("coleccion", "/coleccion", q("collection-book"));
    await time("progresion", "/progresion", q("hub-hero"));
    await time("jugar", "/jugar", q("game-modes-hub"));
    await time("tienda", "/tienda", `/Comprar/i.test(document.body.innerText)`);
    await shot(c, "01-lento-tienda");
    // Una partida PvE con red lenta.
    await c.tab.goto(`${BASE}/duelos/jugar`, 1500);
    if (await waitFor(c.tab, `/Comenzar duelo/i.test(document.body.innerText)`, 45000)) {
      await clickText(c, "^Comenzar duelo$"); await sleep(4000);
      const m = await playMatchUi(c, t);
      ev.match = m;
      check("partida completa con red mediocre", m.shown && !!m.result, m);
    }
    await collectErrors(c);
    ev.errorsCount = c.errors.length;
    check("red mediocre: todas las pantallas llegan a cargar", Object.values<any>(ev.timings).every((x) => x.ok), ev.timings);
    await c.tab.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    // CORTE de red breve en la colección: la interfaz se recupera.
    await c.tab.goto(`${BASE}/progresion`, 2500);
    await c.tab.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await c.tab.js(`document.querySelector('a[href="/coleccion"]')?.click()`); await sleep(5000);
    ev.offline = await screen(c).catch(() => null);
    await shot(c, "02-sin-red");
    await c.tab.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await sleep(3000);
    const retry = await clickText(c, "Reintentar|Volver a intentar");
    await sleep(3000);
    await c.tab.goto(`${BASE}/coleccion`, 3000);
    ev.recovered = await waitFor(c.tab, q("collection-book"), 20000);
    ev.retryButton = retry;
    check("tras volver la red la pantalla se recupera", ev.recovered);
    return await finish(c, id, ev);
  } catch (e) { note("bug", `EXCEPCIÓN ${e instanceof Error ? e.message : e}`); return finish(c, id, ev); }
}

/** VARIAS PESTAÑAS: colección y progreso en la 2.ª; en la 1.ª se abre un sobre / se reclama; al volver, ¿refresca? */
async function sMultitab(p: string) {
  const c = await openBrowser(p, W, { reduced: REDUCED, label: `${p}-${TAG}-multitab` });
  const id = `${p}-${TAG}-multitab`;
  const ev: any = {};
  try {
    const t = await token(p);
    await loginUi(c, p);
    // Segunda pestaña en el MISMO navegador (misma sesión en localStorage).
    const { targetId } = await c.tab.send("Target.createTarget", { url: `${BASE}/coleccion` }).catch(() => ({ targetId: null }));
    ev.secondTab = !!targetId;
    // Como el Tab de cdp.ts solo maneja una sesión, la «segunda pestaña» se simula con un segundo navegador con la misma cuenta
    // (misma experiencia para el jugador: otra ventana con su sesión) — y se mide qué ve al volver a ella.
    const c2 = await openBrowser(p, W, { reduced: REDUCED, label: `${p}-${TAG}-multitab2` });
    await loginUi(c2, p);
    await goto(c2, "/coleccion", 3000);
    const cardsText0 = await c2.tab.js<string>(`document.querySelector('[data-testid="collection-hero"]')?.innerText ?? ''`);
    await goto(c2, "/progresion", 3000);
    const hud0 = await c2.tab.js<string>(`(document.querySelector('[data-testid="hud-credits"]') || document.querySelector('[title="DRL Credits"] .nx-readout'))?.innerText ?? ''`);
    // En la 1.ª: comprar y abrir un sobre por la interfaz.
    const s0 = await snapshot(t);
    await goto(c, "/tienda", 3000);
    await c.tab.js(`[...document.querySelectorAll('button')].find(x => /^Comprar$/i.test((x.innerText||'').trim()) && !x.disabled)?.click()`);
    await waitFor(c.tab, q("store-purchase-modal"), 6000);
    await clickText(c, "^Confirmar ·"); await sleep(3500);
    if (await clickText(c, "^Abrir ahora$")) { await sleep(2500); await openPackUi(c); }
    const s1 = await snapshot(t);
    // Volver a la 2.ª: foco/visibilidad → ¿se refresca sola? y tras navegar dentro de la app.
    await c2.tab.send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => null);
    await c2.tab.js(`(() => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus')); })()`);
    await sleep(4000);
    const hud1 = await c2.tab.js<string>(`(document.querySelector('[data-testid="hud-credits"]') || document.querySelector('[title="DRL Credits"] .nx-readout'))?.innerText ?? ''`);
    await c2.tab.js(`document.querySelector('a[href="/coleccion"]')?.click()`); await sleep(3500);
    const cardsText1 = await c2.tab.js<string>(`document.querySelector('[data-testid="collection-hero"]')?.innerText ?? ''`);
    const hud2 = await c2.tab.js<string>(`(document.querySelector('[data-testid="hud-credits"]') || document.querySelector('[title="DRL Credits"] .nx-readout'))?.innerText ?? ''`);
    const num = (s: string) => Number(String(s).replace(/[^\d]/g, ""));
    ev.hud = { before: hud0, afterFocus: hud1, afterNav: hud2, server: [s0.credits, s1.credits] };
    ev.collection = { before: cardsText0.replace(/\s+/g, " ").slice(0, 120), afterNav: cardsText1.replace(/\s+/g, " ").slice(0, 120) };
    check("2.ª pestaña: el saldo se pone al día al volver o al navegar", num(hud1) === s1.credits || num(hud2) === s1.credits, ev.hud);
    await shot(c2, "01-segunda-pestana");
    await collectErrors(c2);
    const e2 = c2.errors;
    await c2.browser.close();
    return await finish(c, id, { ...ev, errorsTab2: e2 });
  } catch (e) { note("bug", `EXCEPCIÓN ${e instanceof Error ? e.message : e}`); return finish(c, id, ev); }
}

/** SESIÓN LARGA: 40 navegaciones + 2 partidas; memoria, oyentes, nodos, sonidos/toasts duplicados, sesión viva. */
async function sLong(p: string) {
  const c = await openBrowser(p, W, { reduced: REDUCED, label: `${p}-${TAG}-long` });
  const id = `${p}-${TAG}-long`;
  const ev: any = { samples: [] };
  try {
    const t = await token(p);
    await loginUi(c, p);
    await c.tab.send("Performance.enable");
    const metric = async () => { const m = await c.tab.send("Performance.getMetrics"); const g = (k: string) => m.metrics.find((x: any) => x.name === k)?.value ?? null; return { heapMB: Math.round(g("JSHeapUsedSize") / 1e5) / 10, listeners: g("JSEventListeners"), nodes: g("Nodes"), docs: g("Documents") }; };
    const route = ["/", "/jugar", "/coleccion", "/progresion", "/temporada", "/competitivo", "/tienda", "/duelos/mazos", "/logros", "/social"];
    // Navegación INTERNA (enlaces de la app, sin recargar) para que la memoria sea de una sola página viva.
    await goto(c, "/", 3000);
    for (let i = 0; i < 40; i++) {
      const target = route[i % route.length];
      const clicked = await c.tab.js<boolean>(`(() => { const a = [...document.querySelectorAll('a[href="${target}"]')].find(x => x.offsetParent !== null); if (a) { a.click(); return true; } return false; })()`);
      if (!clicked) await c.tab.js(`window.next?.router?.push ? window.next.router.push(${esc(target)}) : (location.href = ${esc(target)})`);
      c.actions++; c.screens++;
      await sleep(1700);
      if (i % 10 === 9) { await c.tab.send("HeapProfiler.collectGarbage").catch(() => null); ev.samples.push({ i: i + 1, ...(await metric()) }); }
    }
    // Dos partidas seguidas en la misma página viva.
    await c.tab.js(`document.querySelector('a[href="/jugar"]')?.click()`); await sleep(2500);
    await clickTid(c, "mode-cta-QUICK"); await sleep(3000);
    for (let k = 0; k < 2; k++) {
      if (await waitFor(c.tab, `/Comenzar duelo/i.test(document.body.innerText)`, 10000)) { await clickText(c, "^Comenzar duelo$"); await sleep(2500); }
      const m = await playMatchUi(c, t);
      (ev.matches ??= []).push({ result: m.result, ms: m.ms });
      // Toasts/avisos duplicados en el resultado.
      ev[`toasts${k}`] = await c.tab.js<any>(`(() => { const t = [...document.querySelectorAll('[role="status"], [role="alert"]')].map(e => e.innerText.trim()).filter(Boolean); return { n: t.length, dup: t.length - new Set(t).size, list: t.slice(0, 8) }; })()`);
      if (k === 0) { await clickText(c, "^Jugar otra"); await sleep(2500); }
    }
    await c.tab.send("HeapProfiler.collectGarbage").catch(() => null);
    ev.samples.push({ i: "after-matches", ...(await metric()) });
    // Audio: cuántos <audio>/AudioContext vivos (sonidos duplicados).
    ev.audio = await c.tab.js<any>(`({ audioEls: document.querySelectorAll('audio').length })`);
    // La sesión sigue viva (token refrescado): una lectura autenticada desde la propia página.
    ev.sessionAlive = await c.tab.js<number>(`(async () => { const k = Object.keys(localStorage).find(x => x.includes('auth-token')); const s = k ? JSON.parse(localStorage.getItem(k)) : null; if (!s) return 0; const r = await fetch('/api/game/state', { headers: { authorization: 'Bearer ' + s.access_token } }); return r.status; })()`);
    check("sesión larga: la sesión sigue autenticada", ev.sessionAlive === 200, ev.sessionAlive);
    const first = ev.samples[0], last = ev.samples[ev.samples.length - 1];
    ev.growth = first && last ? { heapMB: +(last.heapMB - first.heapMB).toFixed(1), listeners: last.listeners - first.listeners, nodes: last.nodes - first.nodes } : null;
    check("sesión larga: sin crecimiento desbocado de memoria/oyentes", !!ev.growth && ev.growth.heapMB < 40 && ev.growth.listeners < 1500, ev.growth);
    check("sin avisos duplicados en el resultado", (ev.toasts0?.dup ?? 0) === 0 && (ev.toasts1?.dup ?? 0) === 0, [ev.toasts0, ev.toasts1]);
    return await finish(c, id, ev);
  } catch (e) { note("bug", `EXCEPCIÓN ${e instanceof Error ? e.message : e}`); return finish(c, id, ev); }
}

/** LOGOUT/LOGIN + CAMBIO DE CUENTA en el MISMO navegador: nada del anterior debe verse. */
async function sSwitch(p: string) {
  const other = argv[2];
  const c = await openBrowser(p, W, { reduced: REDUCED, label: `${p}${other}-${TAG}-switch`, userDataDir: undefined });
  const id = `${p}${other}-${TAG}-switch`;
  const ev: any = {};
  try {
    const [ta, tb] = [await token(p), await token(other)];
    const [sa, sb] = [await snapshot(ta), await snapshot(tb)];
    const nameA = creds(p).username ?? "", nameB = creds(other).username ?? "";
    const idA = creds(p).userId, idB = creds(other).userId;
    await loginUi(c, p);
    const look = async () => {
      await goto(c, "/", 3000);
      const hud = await c.tab.js<string>(`(document.querySelector('[data-testid="hud-credits"]') || document.querySelector('[title="DRL Credits"] .nx-readout'))?.innerText ?? ''`);
      await goto(c, "/cuenta", 3000);
      const cuenta = (await screen(c)).text;
      await goto(c, "/duelos/mazos", 3000);
      const teams = (await screen(c)).text;
      await goto(c, "/progresion", 3000);
      const prog = (await screen(c)).text;
      await goto(c, "/inventario", 3000);
      const inv = (await screen(c)).h.join(" ");
      const ls = await c.tab.js<string[]>(`Object.keys(localStorage)`);
      const lsDump = await c.tab.js<string>(`JSON.stringify(Object.fromEntries(Object.keys(localStorage).filter(k => !k.includes('auth-token') && k !== '__f68net').map(k => [k, localStorage.getItem(k)])))`);
      return { hud, cuenta: cuenta.slice(0, 300), teams: teams.slice(0, 300), prog: prog.slice(0, 200), inv, ls, lsDump };
    };
    ev.A = await look();
    check("logout", await logoutUi(c));
    ev.afterLogout = { ls: await c.tab.js<string[]>(`Object.keys(localStorage)`), home: (await (async () => { await goto(c, "/", 3000); return (await screen(c)).text.slice(0, 200); })()) };
    await goto(c, "/", 2500);
    ev.afterLogoutHud = await c.tab.js<string>(`(document.querySelector('[data-testid="hud-credits"]') || document.querySelector('[title="DRL Credits"] .nx-readout'))?.innerText ?? ''`);
    check("tras logout el HUD no enseña el saldo de A", !ev.afterLogoutHud || Number(ev.afterLogoutHud.replace(/[^\d]/g, "")) !== sa.credits, ev.afterLogoutHud);
    await loginUi(c, other);
    ev.B = await look();
    const num = (s: string) => Number(String(s).replace(/[^\d]/g, ""));
    check("HUD cambia al saldo de B", num(ev.B.hud) === sb.credits, { hud: ev.B.hud, sb: sb.credits, sa: sa.credits });
    check("cuenta: el nombre de A no aparece para B", !nameA || !ev.B.cuenta.toLowerCase().includes(nameA.toLowerCase().slice(0, 12)), { nameA, cuentaB: ev.B.cuenta.slice(0, 80) });
    const leakIds = ev.B.lsDump.includes(idA);
    check("localStorage de B no contiene el id de A", !leakIds);
    const teamNamesA = (sa.decks ?? []).map((d: any) => d.name).filter((n: string) => n && !(sb.decks ?? []).some((x: any) => x.name === n));
    check("equipos de A no aparecen en B", teamNamesA.every((n: string) => !ev.B.teams.includes(n)), teamNamesA);
    // Volver a A: también limpio en sentido contrario.
    await logoutUi(c);
    await loginUi(c, p);
    ev.A2 = await look();
    check("de vuelta en A: HUD de A", num(ev.A2.hud) === (await snapshot(await token(p))).credits, ev.A2.hud);
    check("de vuelta en A: nada de B en localStorage", !ev.A2.lsDump.includes(idB));
    ev.sa = { credits: sa.credits, decks: sa.decks.map((d: any) => d.name) }; ev.sb = { credits: sb.credits, decks: sb.decks.map((d: any) => d.name) };
    return await finish(c, id, ev);
  } catch (e) { note("bug", `EXCEPCIÓN ${e instanceof Error ? e.message : e}`); return finish(c, id, ev); }
}

/** ERRORES DE AUTH: contraseña mala, email existente, recuperación con estado no válido. Sin fugas. */
async function sAuth(p: string) {
  const c = await openBrowser(p, W, { reduced: REDUCED, label: `${p}-${TAG}-auth` });
  const id = `${p}-${TAG}-auth`;
  const ev: any = {};
  try {
    const cr = creds(p);
    await goto(c, "/cuenta", 2500);
    await setInput(c, 'input[type="email"]', cr.email); await setInput(c, 'input[type="password"]', "incorrecta-123456");
    await c.tab.js(`document.querySelector('form button[type="submit"]').click()`); c.actions++;
    await sleep(3000);
    ev.wrongPassword = await c.tab.js<string>(`[...document.querySelectorAll('[role="alert"], .text-bad, [data-testid*="error"]')].map(e => e.innerText.trim()).filter(Boolean).join(' | ')`);
    await shot(c, "01-password-mal");
    check("contraseña mala: mensaje útil en español sin fuga", /incorrect|no coincid|credenciales|contrase/i.test(ev.wrongPassword) && !/invalid_grant|AuthApiError|400/.test(ev.wrongPassword), ev.wrongPassword);
    // Email inexistente: mismo mensaje (no enumeración).
    await setInput(c, 'input[type="email"]', `no-existe-${Date.now()}@example.invalid`); await setInput(c, 'input[type="password"]', "incorrecta-123456");
    await c.tab.js(`document.querySelector('form button[type="submit"]').click()`); c.actions++;
    await sleep(3000);
    ev.unknownEmail = await c.tab.js<string>(`[...document.querySelectorAll('[role="alert"], .text-bad, [data-testid*="error"]')].map(e => e.innerText.trim()).filter(Boolean).join(' | ')`);
    check("email inexistente: mismo mensaje (sin enumerar cuentas)", ev.unknownEmail === ev.wrongPassword, { a: ev.wrongPassword, b: ev.unknownEmail });
    // Registro con email existente.
    await clickText(c, "registro", "button"); await sleep(500);
    const user = await c.tab.js<boolean>(`!![...document.querySelectorAll('form input')].find(i => i.type === 'text')`);
    if (user) await c.tab.js(`(() => { const el = [...document.querySelectorAll('form input')].find(i => i.type === 'text'); const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, 'qaf68dup${Date.now() % 100000}'); el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await setInput(c, 'input[type="email"]', cr.email); await setInput(c, 'input[type="password"]', "OtraClave-12345678");
    await c.tab.js(`document.querySelector('form button[type="submit"]').click()`); c.actions++;
    await sleep(4000);
    ev.existingEmail = { text: await c.tab.js<string>(`(document.querySelector('main') || document.body).innerText.replace(/\\s+/g,' ').slice(0, 400)`), url: await c.tab.js<string>("location.pathname"), loggedIn: await c.tab.js<boolean>(`Object.keys(localStorage).some(k => k.includes('auth-token'))`) };
    await shot(c, "02-email-existente");
    check("registro con email existente: no entra en la cuenta ajena", !ev.existingEmail.loggedIn, ev.existingEmail);
    // Recuperación: pedir enlace (Inbucket local; no hay SMTP real) → mensaje genérico.
    await goto(c, "/cuenta", 2500);
    const forgot = await clickText(c, "olvidaste|recuperar", "button, a");
    await sleep(800);
    if (forgot) {
      await setInput(c, 'input[type="email"]', `no-existe-${Date.now()}@example.invalid`);
      await c.tab.js(`document.querySelector('form button[type="submit"]')?.click()`); c.actions++;
      await sleep(3000);
      ev.recovery = await c.tab.js<string>(`(document.querySelector('main') || document.body).innerText.replace(/\\s+/g,' ').slice(0, 300)`);
      await shot(c, "03-recuperacion");
    }
    ev.forgot = forgot;
    // Enlace de recuperación inválido/caducado.
    await goto(c, "/", 2000); // un cambio de SOLO #hash no recarga la página: se sale y se vuelve a entrar con el enlace
    await goto(c, "/cuenta#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired", 3000);
    ev.invalidReset = await c.tab.js<string>(`(document.querySelector('main') || document.body).innerText.replace(/\\s+/g,' ').slice(0, 300)`);
    await shot(c, "04-enlace-caducado");
    return await finish(c, id, ev);
  } catch (e) { note("bug", `EXCEPCIÓN ${e instanceof Error ? e.message : e}`); return finish(c, id, ev); }
}

/** SKIP: un explorador que se salta el tutorial y juega igual. */
async function sSkip(p: string) {
  const c = await openBrowser(p, W, { reduced: REDUCED, label: `${p}-${TAG}-skip` });
  const id = `${p}-${TAG}-skip`;
  const ev: any = {};
  try {
    const cr = await registerUi(c, p);
    const t = await token(p);
    ev.account = cr.userId.slice(0, 8);
    ev.start = await snapshot(t);
    if ((await c.tab.js<string>("location.pathname")) !== "/") await goto(c, "/", 2500);
    await waitFor(c.tab, q("onboarding-welcome"), 25000);
    await clickTid(c, "onboarding-skip"); await waitFor(c.tab, q("onboarding-skip-dialog"), 5000);
    await shot(c, "01-saltar");
    await clickTid(c, "onboarding-skip-confirm"); await sleep(2500);
    const home = await screen(c);
    ev.homeAfterSkip = { testids: home.testids, text: home.text.slice(0, 300) };
    await shot(c, "02-tras-saltar");
    // ¿Sabe qué hacer? JUGAR sin equipo.
    await clickTid(c, "action-play"); await sleep(2500);
    await clickTid(c, "mode-cta-QUICK"); await sleep(3500);
    const q1 = await screen(c);
    ev.quickWithoutTeam = { url: q1.url, h: q1.h, text: q1.text.slice(0, 400), buttons: q1.buttons.slice(0, 10) };
    await shot(c, "03-jugar-sin-equipo");
    const hasWay = /sobre|abrir|equipo|crear/i.test(q1.text);
    check("saltar la guía: JUGAR sin equipo explica qué hacer", hasWay, ev.quickWithoutTeam);
    // Sigue la salida que ofrece la pantalla hasta poder jugar (sin API): inventario → abrir sobres → crear equipo.
    for (let i = 0; i < 8; i++) {
      await goto(c, "/inventario", 3000);
      if (!(await clickTid(c, "inventory-open-cta"))) break;
      await sleep(2500); await openPackUi(c);
    }
    await goto(c, "/duelos/mazos", 3000);
    await clickText(c, "^\\+ Nuevo equipo$|^\\+ Crear equipo|^Crear mi primer equipo$"); await sleep(3000);
    await clickText(c, "^Autocompletar equipo$"); await sleep(2500);
    await clickTid(c, "save-team"); await sleep(3000);
    await clickTid(c, "activate-team"); await sleep(2500);
    const s = await snapshot(t);
    ev.afterSelfGuided = s;
    check("sin guía: el jugador llega a tener equipo válido por la interfaz", s.decks.some((d: any) => d.valid), s.decks);
    await goto(c, "/jugar", 2500); await clickTid(c, "mode-cta-QUICK"); await sleep(3000);
    if (await waitFor(c.tab, `/Comenzar duelo/i.test(document.body.innerText)`, 15000)) { await clickText(c, "^Comenzar duelo$"); await sleep(2500); const m = await playMatchUi(c, t); ev.match = m; check("sin guía: primera partida", m.shown && !!m.result, m); }
    ev.end = await snapshot(t);
    return await finish(c, id, ev);
  } catch (e) { note("bug", `EXCEPCIÓN ${e instanceof Error ? e.message : e}`); await shot(c, "zz-exception"); return finish(c, id, ev); }
}

/** PROGRESIÓN: objetivos, reclamo (doble clic), revisita sin re-pago, temporada, logros, perfil. */
async function sProgress(p: string) {
  const c = await openBrowser(p, W, { reduced: REDUCED, label: `${p}-${TAG}-progress` });
  const id = `${p}-${TAG}-progress`;
  const ev: any = {};
  try {
    const t = await token(p);
    const s0 = await snapshot(t);
    const pr0 = (await api(t, "/api/game/progression", { action: "state" })).json;
    ev.before = { credits: s0.credits, xp: s0.xp, pass: s0.pass };
    await loginUi(c, p);
    await goto(c, "/progresion", 3500);
    await shot(c, "01-progresion");
    ev.hub = (await screen(c)).h;
    ev.claim = await claimAllUi(c);
    await shot(c, "02-tras-reclamar");
    const s1 = await snapshot(t);
    ev.afterClaim = { credits: s1.credits, xp: s1.xp, pass: s1.pass };
    // El diálogo de recompensas se cierra con «Seguir»: el HUD debe enseñar el saldo nuevo sin recargar.
    await sleep(2500);
    ev.dialogClosed = await clickText(c, "^Seguir$"); await sleep(2500);
    ev.hudAfterClaim = await c.tab.js<string>(`(document.querySelector('[data-testid="hud-credits"]') || document.querySelector('[title="DRL Credits"] .nx-readout'))?.innerText ?? ''`);
    await shot(c, "02b-hud-tras-reclamar");
    if (s1.credits !== s0.credits) check("HUD al día tras reclamar (sin recargar)", Number(String(ev.hudAfterClaim).replace(/[^\d]/g, "")) === s1.credits, { hud: ev.hudAfterClaim, server: s1.credits });
    // Revisita: F5 y reclamar otra vez → nada.
    await reload(c, 3500);
    const again = await claimAllUi(c);
    const s2 = await snapshot(t);
    ev.revisit = { again, credits: s2.credits, xp: s2.xp };
    check("revisitar no vuelve a pagar", s2.credits === s1.credits && s2.xp === s1.xp, ev.revisit);
    // API: reclamar de nuevo lo mismo → 409/400 sin pago.
    const pr1 = (await api(t, "/api/game/progression", { action: "state" })).json;
    ev.progressionShape = pr1 ? Object.keys(pr1) : null;
    const claimedMission = (pr1?.missions ?? pr1?.objectives?.all ?? []).find((m: any) => m.claimed || m.status === "CLAIMED");
    if (claimedMission) {
      const r = await api(t, "/api/game/progression", { action: "claimMission", missionId: claimedMission.id });
      const s3 = await snapshot(t);
      ev.reclaimApi = { status: r.status, error: r.json?.error, paid: s3.credits !== s2.credits };
      check("reclamar por API una misión ya cobrada no paga", !ev.reclaimApi.paid && r.status >= 400, ev.reclaimApi);
    }
    // Temporada, logros y perfil.
    await goto(c, "/temporada", 3500);
    ev.season = { h: (await screen(c)).h, level: await c.tab.js<string>(`document.querySelector('[data-testid="hero-level"]')?.innerText ?? ''`), next: await c.tab.js<string>(`document.querySelector('[data-testid="hero-next-reward"]')?.innerText ?? ''`) };
    await shot(c, "03-temporada");
    await goto(c, "/logros", 3500);
    ev.achievements = (await screen(c)).buttons.filter((b: string) => /RECLAMAR|EN CURSO|COMPLETADO|—/.test(b)).length;
    await shot(c, "04-logros");
    await goto(c, `/jugador/${creds(p).userId}`, 3500);
    ev.profile = (await screen(c)).text.slice(0, 500);
    await shot(c, "05-perfil");
    ev.pr0 = pr0 ? { pass: pr0.pass ?? null } : null;
    return await finish(c, id, ev);
  } catch (e) { note("bug", `EXCEPCIÓN ${e instanceof Error ? e.message : e}`); return finish(c, id, ev); }
}

/** DRAFT GAUNTLET solo (entrada, elecciones, partida, resultado, vuelta al gauntlet). */
async function sDraft(p: string) {
  const c = await openBrowser(p, W, { reduced: REDUCED, label: `${p}-${TAG}-draft` });
  const id = `${p}-${TAG}-draft`;
  const ev: any = {};
  try {
    const t = await token(p);
    ev.start = await snapshot(t);
    ev.serverBefore = (await api(t, "/api/game/draft-gauntlet")).json?.run?.status ?? null;
    await loginUi(c, p);
    await goto(c, "/jugar", 2500);
    await clickTid(c, "mode-cta-DRAFT_GAUNTLET"); await sleep(3000);
    for (let k = 0; k < 3; k++) {
      const r = await draftRun(c, t);
      (ev.runs ??= []).push(r);
      if (!r.match) break;
      check(`Draft: partida ${k + 1} con resultado`, r.match.shown && !!r.match.result, r.match.result);
      check(`Draft: «Volver al gauntlet» lleva de vuelta`, !!r.backToGauntlet && /draft-gauntlet/.test(r.afterMatch?.url ?? ""), r.afterMatch?.url);
      if (!(await c.tab.js<boolean>(`[...document.querySelectorAll('button')].some(b => /siguiente|jugar|continuar/i.test(b.innerText) && !b.disabled)`))) break;
    }
    const run = (await api(t, "/api/game/draft-gauntlet")).json;
    ev.serverAfter = { status: run?.run?.status ?? null, lastRun: run?.lastRun ? { status: run.lastRun.status, wins: run.lastRun.wins, losses: run.lastRun.losses } : null, reward: run?.reward ?? null };
    ev.end = await snapshot(t);
    check("Draft sin escrituras económicas (F39: sin recompensas)", ev.start.credits === ev.end.credits, { start: ev.start.credits, end: ev.end.credits });
    return await finish(c, id, ev);
  } catch (e) { note("bug", `EXCEPCIÓN ${e instanceof Error ? e.message : e}`); await shot(c, "zz-exception"); return finish(c, id, ev); }
}

/** PICK'EMS: una predicción real por la interfaz, F5, y su efecto en la misión diaria «Haz una predicción». */
async function sPickems(p: string) {
  const c = await openBrowser(p, W, { reduced: REDUCED, label: `${p}-${TAG}-pickems` });
  const id = `${p}-${TAG}-pickems`;
  const ev: any = {};
  const mission = async (t: string) => ((await api(t, "/api/game/progression", { action: "state" })).json?.missions ?? []).find((m: any) => m.metric === "picks_made" && m.kind === "daily") ?? null;
  try {
    const t = await token(p);
    ev.missionBefore = await mission(t);
    await loginUi(c, p);
    await goto(c, "/pickems", 4000);
    await shot(c, "01-pickems");
    const opt = `[...document.querySelectorAll('[data-state][data-kind] [role="group"] button[aria-pressed="false"]')].filter(b => b.offsetParent !== null && !b.disabled)`;
    ev.options = await c.tab.js<number>(`${opt}.length`);
    ev.label = await c.tab.js<string>(`(() => { const b = ${opt}[0]; return b ? (b.getAttribute('aria-label') || b.innerText).trim().replace(/\s+/g, ' ') : null })()`);
    ev.clicked = await c.tab.js<boolean>(`(() => { const b = ${opt}[0]; if (!b) return false; b.scrollIntoView({ block: 'center' }); b.click(); return true; })()`); c.actions++;
    await sleep(3000);
    ev.feedback = await c.tab.js<string>(`[...document.querySelectorAll('[role="status"], [role="alert"]')].map(e => e.innerText.trim()).filter(Boolean).join(' | ').slice(0, 300)`);
    ev.pressedNow = await c.tab.js<number>(`[...document.querySelectorAll('[data-state][data-kind] [role="group"] button[aria-pressed="true"]')].length`);
    await shot(c, "02-prediccion-hecha");
    await reload(c, 4000);
    ev.pressedAfterF5 = await c.tab.js<number>(`[...document.querySelectorAll('[data-state][data-kind] [role="group"] button[aria-pressed="true"]')].length`);
    check("Pick'ems: la predicción se guarda y sigue marcada tras F5", ev.clicked && ev.pressedAfterF5 >= 1 && ev.pressedAfterF5 >= ev.pressedNow, { now: ev.pressedNow, f5: ev.pressedAfterF5, feedback: ev.feedback });
    ev.missionAfter = await mission(t);
    if (ev.missionBefore && !ev.missionBefore.complete) check("Pick'ems: la misión diaria «Haz una predicción» avanza con la predicción real", (ev.missionAfter?.current ?? 0) > (ev.missionBefore.current ?? 0), { before: ev.missionBefore?.current, after: ev.missionAfter?.current });
    return await finish(c, id, ev);
  } catch (e) { note("bug", `EXCEPCIÓN ${e instanceof Error ? e.message : e}`); await shot(c, "zz-exception"); return finish(c, id, ev); }
}

/** VARIAS PESTAÑAS DEL MISMO NAVEGADOR: la 2.ª se abre con window.open (comparte sesión y localStorage) y se lee desde la 1.ª. */
async function sMultitabSame(p: string) {
  const c = await openBrowser(p, W, { reduced: REDUCED, label: `${p}-${TAG}-multitab-same` });
  const id = `${p}-${TAG}-multitab-same`;
  const ev: any = {};
  const HUD = `(document.querySelector('[data-testid="hud-credits"]') || document.querySelector('[title="DRL Credits"] .nx-readout'))?.innerText ?? ''`;
  const t2 = (expr: string) => c.tab.js<any>(`(() => { const w = window.__t2; if (!w || w.closed) return null; const document = w.document; return (${expr}); })()`);
  try {
    const t = await token(p);
    await loginUi(c, p);
    await goto(c, "/tienda", 3000);
    await c.tab.send("Runtime.evaluate", { expression: `window.__t2 = window.open(location.origin + '/progresion', 'f68tab2'); !!window.__t2`, userGesture: true, returnByValue: true });
    await sleep(6000);
    ev.tab2Before = { url: await t2(`w.location.pathname`), hud: await t2(HUD) };
    const s0 = await snapshot(t);
    await c.tab.js(`[...document.querySelectorAll('button')].find(x => /^Comprar$/i.test((x.innerText||'').trim()) && !x.disabled)?.click()`);
    await waitFor(c.tab, q("store-purchase-modal"), 6000);
    await clickText(c, "^Confirmar ·"); await sleep(3500);
    const s1 = await snapshot(t);
    ev.server = [s0.credits, s1.credits];
    ev.tab1Hud = await c.tab.js<string>(HUD);
    // Volver a la 2.ª pestaña: evento de visibilidad/foco; luego navegar dentro de la app (enlace a /coleccion).
    await t2(`(w.dispatchEvent(new Event('focus')), document.dispatchEvent(new Event('visibilitychange')), true)`);
    await sleep(4000);
    ev.tab2AfterFocus = await t2(HUD);
    await t2(`(document.querySelector('a[href="/coleccion"]')?.click(), true)`);
    await sleep(4000);
    ev.tab2AfterNav = { url: await t2(`w.location.pathname`), hud: await t2(HUD) };
    const num = (x: string) => Number(String(x ?? "").replace(/[^\d]/g, ""));
    check("pestaña 1: HUD al día tras comprar", num(ev.tab1Hud) === s1.credits, { hud: ev.tab1Hud, server: s1.credits });
    check("pestaña 2 (mismo navegador): el saldo se pone al día al volver o al navegar", num(ev.tab2AfterFocus) === s1.credits || num(ev.tab2AfterNav.hud) === s1.credits, ev);
    return await finish(c, id, ev);
  } catch (e) { note("bug", `EXCEPCIÓN ${e instanceof Error ? e.message : e}`); return finish(c, id, ev); }
}

/** SOCIAL: <p> busca a <otra> por su nombre, le envía solicitud; <otra> la acepta; los dos se ven como amigos. */
async function sSocial(p: string) {
  const other = argv[2];
  const c = await openBrowser(p, W, { reduced: REDUCED, label: `${p}${other}-${TAG}-social` });
  const id = `${p}${other}-${TAG}-social`;
  const ev: any = {};
  const nameOther = creds(other).username!, nameMe = creds(p).username!;
  try {
    await loginUi(c, p);
    await goto(c, "/social?tab=buscar", 3000);
    await c.tab.js(`document.querySelector('[data-testid="player-search"] input, input[type="search"]')?.focus()`);
    await c.tab.send("Input.insertText", { text: nameOther.slice(0, 10) });
    await sleep(3000);
    ev.results = await c.tab.js<string>(`document.querySelector('[data-testid="search-results"]')?.innerText?.replace(/\s+/g, ' ').slice(0, 300) ?? ''`);
    ev.sent = await c.tab.js<string>(`(() => { const r = document.querySelector('[data-testid="search-results"]'); const b = r && [...r.querySelectorAll('button')].find(x => /añadir|solicitud|agregar|amigo/i.test(x.innerText) && !x.disabled); if (!b) return ''; b.click(); return b.innerText.trim(); })()`); c.actions++;
    await sleep(2500);
    ev.requestSentShown = await c.tab.js<boolean>(q("request-sent"));
    await shot(c, "01-solicitud-enviada");
    check("social: la búsqueda encuentra al otro jugador y envía la solicitud", !!ev.sent, ev);
    await logoutUi(c);
    await loginUi(c, other);
    await goto(c, "/social?tab=solicitudes", 3500);
    ev.inbox = await c.tab.js<string>(`(document.querySelector('[data-testid="requests"]') || document.querySelector('[data-testid="social-inbox"]'))?.innerText?.replace(/\s+/g, ' ').slice(0, 300) ?? ''`);
    ev.accepted = await c.tab.js<string>(`(() => { const r = document.querySelector('[data-testid="requests"]') || document; const b = [...r.querySelectorAll('button')].find(x => /^aceptar/i.test(x.innerText.trim()) && !x.disabled); if (!b) return ''; b.click(); return b.innerText.trim(); })()`); c.actions++;
    await sleep(2500);
    await shot(c, "02-solicitud-aceptada");
    await goto(c, "/social", 3000);
    ev.friendsOther = await c.tab.js<string>(`document.querySelector('[data-testid="friends-list"]')?.innerText?.replace(/\s+/g, ' ').slice(0, 300) ?? ''`);
    check("social: el otro jugador ve la solicitud y la acepta", !!ev.accepted && ev.friendsOther.toLowerCase().includes(nameMe.toLowerCase().slice(0, 8)), { inbox: ev.inbox.slice(0, 120), accepted: ev.accepted, friends: ev.friendsOther.slice(0, 160) });
    return await finish(c, id, ev);
  } catch (e) { note("bug", `EXCEPCIÓN ${e instanceof Error ? e.message : e}`); await shot(c, "zz-exception"); return finish(c, id, ev); }
}

/** PRESUPUESTO DE PETICIONES + TIEMPOS: las 22 rutas de F64 a 1440, cada una en carga completa (Resource Timing). */
async function sPerf(p: string) {
  const c = await openBrowser(p, W, { reduced: REDUCED, label: `${p}-${TAG}-perf` });
  const id = `${p}-${TAG}-perf`;
  const ev: any = { routes: [] };
  const ROUTES = ["/", "/jugar", "/duelos/jugar", "/competitivo", "/coleccion", "/duelos/mazos", "/duelos/mazos?nuevo=1", "/inventario", "/packs", "/abrir/inicial", "/tienda", "/progresion", "/temporada", "/logros", `/jugador/${creds(p).userId}`, "/jugar/draft-gauntlet", "/jugar/road-to-champions", "/entrenador", "/pickems", "/cuenta", "/como-jugar", "/esta-ruta-no-existe"];
  try {
    await loginUi(c, p);
    for (const r of ROUTES) {
      await c.tab.goto(`${BASE}${r}`, 4500); c.screens++;
      const m = await c.tab.js<any>(`(() => {
        const res = performance.getEntriesByType('resource');
        const api = res.filter(e => { try { return new URL(e.name).pathname.startsWith('/api/'); } catch { return false; } });
        const nav = performance.getEntriesByType('navigation')[0];
        const byPath = {}; for (const e of api) { const k = new URL(e.name).pathname; byPath[k] = Math.max(byPath[k] || 0, Math.round(e.duration)); }
        return { api: api.length, all: res.length, s429: api.filter(e => e.responseStatus === 429).length, s404: res.filter(e => e.responseStatus === 404).length, s5xx: res.filter(e => e.responseStatus >= 500).length,
          domContentLoaded: nav ? Math.round(nav.domContentLoadedEventEnd) : null, load: nav ? Math.round(nav.loadEventEnd) : null, slowestApi: Object.entries(byPath).sort((a, b) => b[1] - a[1]).slice(0, 3) };
      })()`);
      ev.routes.push({ route: r.startsWith("/jugador/") ? "/jugador/me" : r, ...m });
      await collectErrors(c);
    }
    const n = ev.routes.length;
    ev.avgApi = +(ev.routes.reduce((s0: number, x: any) => s0 + x.api, 0) / n).toFixed(1);
    ev.home = ev.routes[0].api;
    ev.totals = { s429: ev.routes.reduce((s0: number, x: any) => s0 + x.s429, 0), s404: ev.routes.reduce((s0: number, x: any) => s0 + x.s404, 0), s5xx: ev.routes.reduce((s0: number, x: any) => s0 + x.s5xx, 0) };
    check("presupuesto de peticiones sin regresión (F64/F67 ≈ 9,5 por pantalla)", ev.avgApi <= 10.5, { avgApi: ev.avgApi, home: ev.home });
    check("sin 429 ni 5xx en las 22 rutas", ev.totals.s429 === 0 && ev.totals.s5xx === 0, ev.totals);
    return await finish(c, id, ev);
  } catch (e) { note("bug", `EXCEPCIÓN ${e instanceof Error ? e.message : e}`); return finish(c, id, ev); }
}

const SESSIONS: Record<string, (p: string) => Promise<unknown>> = {
  perf: sPerf,
  social: sSocial,
  multitabsame: sMultitabSame,
  pickems: sPickems,
  draft: sDraft,
  new: sNew, resume: sNew, return: sReturn, store: sStore, collection: sCollection, teams: sTeams, pve: sPve, explorer: sExplorer,
  keyboard: sKeyboard, slownet: sSlowNet, multitab: sMultitab, long: sLong, switch: sSwitch, auth: sAuth, skip: sSkip, progress: sProgress,
};
const run = SESSIONS[SESSION];
if (!run || !PERSONA) { console.error(`uso: _fase68-beta.ts <${Object.keys(SESSIONS).join("|")}> <persona> [otra] [--w=] [--reduced] [--tag=]`); process.exit(1); }
if (SESSION !== "new" && SESSION !== "skip" && !hasCreds(PERSONA)) { console.error("sin credenciales para", PERSONA); process.exit(1); }
run(PERSONA).then(() => process.exit(0)).catch((e) => { console.error("ERROR", e); process.exit(1); });
