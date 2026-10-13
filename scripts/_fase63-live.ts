/**
 * FASE 63 · QA REAL DEL ONBOARDING (instrumento `_`, fuera de CI) contra :3005 → túnel → BD del VPS. SOLO cuentas QA.
 *
 *   npx tsx scripts/_fase63-live.ts flow <credsFile> [--reduced] [--w=1440]   cuenta NUEVA por /cuenta y la guía entera por la UI
 *   npx tsx scripts/_fase63-live.ts probes <credsFile>                          seguridad, idempotencia y dos pestañas (API real)
 *   npx tsx scripts/_fase63-live.ts existing <credsFile>                        cuenta EXISTENTE: sin guía, sin escrituras
 *
 * Credenciales: solo en `credsFile` (scratchpad). La cuenta del usuario NO se usa nunca.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { launch, sleep, type Tab } from "./lib/cdp";

for (const line of readFileSync(join(process.cwd(), ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
/* eslint-disable @typescript-eslint/no-explicit-any */
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3005";
const OUT = join(process.cwd(), "docs/product/qa/fase63-onboarding");
const mode = process.argv[2];
const credsFile = process.argv[3];
const REDUCED = process.argv.includes("--reduced");
const DIRECT = process.argv.includes("--direct");
const W0 = Number(process.argv.find((a) => a.startsWith("--w="))?.slice(4) ?? 1440);
const TAG = REDUCED ? `reduced-${W0}` : `${W0}`;
const SHOTS = join(OUT, "screenshots", `after-${TAG}`);
mkdirSync(SHOTS, { recursive: true });
const esc = (s: string) => JSON.stringify(s);
const log = (s: string) => console.log(s);

const anon = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
async function token(c: { email: string; password: string }): Promise<string> {
  const { data, error } = await anon().auth.signInWithPassword({ email: c.email, password: c.password });
  if (error || !data.session) throw new Error(`login QA falló: ${error?.message}`);
  return data.session.access_token;
}
async function api(t: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const r = await fetch(`${BASE}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { authorization: `Bearer ${t}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, json: await r.json().catch(() => ({})) };
}
const waitFor = async (tab: Tab, expr: string, ms = 20000) => {
  for (let i = 0; i < ms / 200; i++) { if (await tab.js<boolean>(expr).catch(() => false)) return true; await sleep(200); }
  return false;
};
const q = (tid: string) => `!!document.querySelector('[data-testid="${tid}"]')`;
const click = (tab: Tab, tid: string) => tab.js<boolean>(`(() => { const e = document.querySelector('[data-testid="${tid}"]'); if (!e || e.disabled) return false; e.click(); return true; })()`);
const clickText = (tab: Tab, re: string) => tab.js<boolean>(`(() => { const b = [...document.querySelectorAll('button, a')].find(x => new RegExp(${esc(re)}, 'i').test((x.textContent||'').trim()) && !x.disabled); if (!b) return false; b.click(); return true; })()`);

const MEASURE = `(() => {
  const W = innerWidth; let over = 0; const list = [];
  for (const e of document.querySelectorAll('body *')) {
    const b = e.getBoundingClientRect(); if (!b.width || !b.height) continue;
    if (b.right > W + 1 || b.left < -1) {
      let skip = !!e.closest('[aria-hidden="true"]') || !!e.closest('[data-testid="nexus-hall"]');
      for (let a = e; !skip && a && a !== document.body; a = a.parentElement) { const cs = getComputedStyle(a); if (Number(cs.opacity) === 0) skip = true; else if (a !== e && cs.overflowX !== 'visible') { const r = a.getBoundingClientRect(); if (r.left >= -1 && r.right <= W + 1) skip = true; } }
      if (!skip) { over++; if (list.length < 6) list.push((e.getAttribute('data-testid') || e.tagName) + ' ' + Math.round(b.left) + '..' + Math.round(b.right)); }
    }
  }
  const imgs = [...document.images];
  return JSON.stringify({ docScrollW: document.documentElement.scrollWidth, W, hScroll: document.documentElement.scrollWidth > W + 1, over, list, images: imgs.length, broken: imgs.filter(i => i.complete && i.naturalWidth === 0).map(i => i.currentSrc || i.src) });
})()`;

type Creds = { email: string; password: string; userId: string; username?: string };
const rows: any[] = [];
const ev: Record<string, any> = {};

/** Captura una etapa al ancho de la pasada y, en la pasada principal, también a 1024 y 390 (mismo estado). */
const SPLASH = `!document.querySelector('[class*="z-[100]"][class*="bg-base-900"]')`;
async function stage(tab: Tab, name: string, extraWidths = true) {
  await waitFor(tab, SPLASH, 6000); // el splash de la PWA tapa ~1,3 s tras una carga completa
  await sleep(700);
  const widths = !REDUCED && W0 === 1440 && extraWidths ? [1440, 1024, 390] : [W0];
  for (const w of widths) {
    if (w !== W0) { await tab.resize(w, w < 600 ? 844 : w === 1024 ? 768 : 900, 1); await sleep(900); }
    const m = JSON.parse(await tab.js<string>(MEASURE));
    await tab.shot(join(SHOTS, `${name}-${w}.png`));
    rows.push({ name, w, reduced: REDUCED, url: await tab.js<string>("location.pathname + location.search"), measure: m, errors: tab.takeErrors() });
    log(`  · ${name}@${w} over=${m.over} hScroll=${m.hScroll} broken=${m.broken.length}`);
  }
  if (widths.length > 1) { await tab.resize(W0, W0 < 600 ? 844 : 900, 1); await sleep(600); }
}

async function register(tab: Tab): Promise<Creds> {
  const tag = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const c: Creds = { email: `qa-f63-${REDUCED ? "r" : "n"}${W0}-${tag}@example.invalid`, password: randomBytes(18).toString("base64url"), userId: "", username: `qaf63${REDUCED ? "r" : "n"}${tag.slice(-6)}` };
  await tab.goto(`${BASE}/cuenta`, 3000);
  await tab.js(`[...document.querySelectorAll('button')].find(x => /registro/i.test(x.innerText))?.click()`);
  await sleep(400);
  await tab.js(`(() => {
    const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
    const user = [...document.querySelectorAll('form input')].find(i => i.type === 'text'); if (user) set(user, ${esc(c.username!)});
    set(document.querySelector('input[type="email"]'), ${esc(c.email)}); set(document.querySelector('input[type="password"]'), ${esc(c.password)});
    document.querySelector('form button[type="submit"]').click(); })()`);
  await waitFor(tab, `location.pathname === '/' || !document.querySelector('input[type="password"]')`, 25000);
  await sleep(1500);
  c.userId = await tab.js<string>(`(() => { for (const k of Object.keys(localStorage)) if (k.includes('auth-token')) { try { return JSON.parse(localStorage.getItem(k)).user.id } catch {} } return '' })()`);
  writeFileSync(credsFile, JSON.stringify(c), { mode: 0o600 });
  return c;
}

async function snapshotApi(t: string) {
  const [ob, st, decks] = await Promise.all([api(t, "/api/game/onboarding"), api(t, "/api/game/state"), api(t, "/api/game/duels")]);
  return {
    onboarding: { status: ob.json.status, reason: ob.json.reason, current: ob.json.current, progress: ob.json.progress?.label, next: ob.json.next ? { cta: ob.json.next.cta, href: ob.json.next.href, command: ob.json.next.command } : null, context: ob.json.context },
    credits: st.json.credits, xp: st.json.xp, packsOpened: st.json.packsOpened, unopenedPacks: st.json.unopenedPacks, ownedCards: (st.json.ownedCards ?? []).length,
    decks: (decks.json.decks ?? []).map((d: any) => ({ id: d.id, name: d.name, valid: d.valid, cards: d.cards?.length, sumOvr: d.sumOvr })), activeDeckId: decks.json.activeDeckId ?? null,
  };
}

/** Abre el sobre de la pantalla (ya en /abrir/…) por la interfaz y espera el resumen. `reloadMid` = F5 en plena ceremonia. */
async function openPackUi(tab: Tab, label: string, reloadMid = false) {
  await waitFor(tab, q("pack-open"), 20000);
  await sleep(500);
  if (label) await stage(tab, `${label}-sellado`, false);
  await click(tab, "pack-open");
  if (reloadMid) {
    await sleep(900);
    await tab.goto(await tab.js<string>("location.href"), 3000);
  }
  for (let i = 0; i < 60; i++) {
    if (await tab.js<boolean>(q("pack-summary"))) break;
    const clicked = await click(tab, "pack-reveal-all") || await click(tab, "pack-skip");
    if (!clicked) await tab.js(`document.querySelector('[data-testid="ceremony-pack"]')?.click()`);
    await sleep(700);
  }
  return waitFor(tab, q("pack-summary"), 15000);
}

async function playOne(tab: Tab): Promise<boolean> {
  const ok = await waitFor(tab, `(() => { const b = [...document.querySelectorAll('[aria-label="Tu mano"] button')].filter(x => !x.disabled); return b.length > 0 && !document.querySelector('[data-scene="intro"]') && !document.querySelector('[data-f61="moment"]'); })()`, 30000);
  if (!ok) return false;
  await tab.js(`[...document.querySelectorAll('[aria-label="Tu mano"] button')].filter(x => !x.disabled)[0].click()`);
  await sleep(250);
  await tab.js(`(() => { const s = [...document.querySelectorAll('button')].find(b => /^(SH|GS|EF)\\s*\\d/.test((b.textContent||'').trim()) && !b.disabled); if (s) s.click(); return !!s; })()`);
  await sleep(250);
  return tab.js<boolean>(`(() => { const b = [...document.querySelectorAll('button')].find(x => /^(Declarar y atacar|Responder)$/i.test((x.textContent||'').trim()) && !x.disabled); if (!b) return false; b.click(); return true; })()`);
}

async function flow() {
  const b = await launch({ args: ["--mute-audio", "--in-process-gpu", "--hide-scrollbars"] });
  const tab = b.tab;
  const t0 = Date.now();
  const timeline: { at: number; step: string }[] = [];
  const mark = (step: string) => { timeline.push({ at: Math.round((Date.now() - t0) / 1000), step }); log(`[${Math.round((Date.now() - t0) / 1000)}s] ${step}`); };
  try {
    await tab.resize(W0, W0 < 600 ? 844 : 900, 1);
    await tab.setMedia([{ name: "prefers-reduced-motion", value: REDUCED ? "reduce" : "no-preference" }]);
    const c = await register(tab);
    mark("registro enviado");
    const t = await token(c);
    ev.account = c.userId.slice(0, 8);
    ev.landingAfterRegister = await tab.js<string>("location.pathname");
    ev.initial = await snapshotApi(t);

    // 0 · URL DIRECTAS antes de empezar (spec 71): nada se rompe y la franja «Tu inicio» da el contexto.
    if (DIRECT) {
      ev.direct = {};
      for (const p of ["/jugar", "/duelos/mazos", "/coleccion", "/progresion", "/tienda"]) {
        await sleep(1500);
        await tab.goto(`${BASE}${p}`, 3500);
        await waitFor(tab, SPLASH, 6000);
        await sleep(1200);
        ev.direct[p] = { rail: await tab.js<boolean>(q("onboarding-rail")), railCta: await tab.js<string>(`document.querySelector('[data-testid="onboarding-rail-cta"]')?.getAttribute('href') ?? null`), errors: tab.takeErrors().length, text: (await tab.js<string>(`(document.querySelector('main')||document.body).innerText.replace(/\\s+/g,' ').slice(0,160)`)) };
        await stage(tab, `00-directo${p.replace(/\//g, "-")}`, false);
      }
      await tab.goto(`${BASE}/`, 3000);
    }

    // 1 · BIENVENIDA
    if (ev.landingAfterRegister !== "/") await tab.goto(`${BASE}/`, 3000);
    ev.welcomeShown = await waitFor(tab, q("onboarding-welcome"), 25000);
    await stage(tab, "01-bienvenida");
    // F5 en la bienvenida: sigue ahí (nada hecho).
    await tab.goto(`${BASE}/`, 3000);
    ev.welcomeAfterF5 = await waitFor(tab, q("onboarding-welcome"), 20000);
    await click(tab, "onboarding-start");
    mark("EMPEZAR");
    ev.starterShown = await waitFor(tab, q("onboarding-starter"), 20000);
    await stage(tab, "02-recursos");
    ev.afterStart = await snapshotApi(t);
    // F5 en recursos: vuelve a recursos (el acuse está en el servidor), no a la bienvenida.
    await tab.goto(`${BASE}/`, 3000);
    ev.starterAfterF5 = await waitFor(tab, q("onboarding-starter"), 20000) && !(await tab.js<boolean>(q("onboarding-welcome")));

    // 2 · PRIMER SOBRE (el que propone la guía) + TU PRIMERA CARTA
    await click(tab, "onboarding-open-first");
    await waitFor(tab, `location.pathname.startsWith('/abrir/')`, 15000);
    ev.firstPackRoute = await tab.js<string>("location.pathname");
    mark(`primer sobre ${ev.firstPackRoute}`);
    await openPackUi(tab, "03-primer-sobre");
    ev.firstCardShown = await waitFor(tab, q("onboarding-first-card"), 20000);
    await tab.js(`document.querySelector('[data-testid="onboarding-first-card"]')?.scrollIntoView({ block: 'start' })`);
    await stage(tab, "04-primera-carta");
    ev.firstCard = await tab.js<string>(`document.querySelector('[data-testid="onboarding-first-card"]')?.getAttribute('data-card-id')`);
    ev.firstCardInSummary = await tab.js<boolean>(`[...document.querySelectorAll('[data-testid="summary-card"]')].some(e => e.getAttribute('data-card-id') === ${esc(String(ev.firstCard))})`);
    ev.afterFirstPack = await snapshotApi(t);

    // 3 · COLECCIÓN
    await click(tab, "onboarding-to-collection");
    await waitFor(tab, `location.pathname === '/coleccion'`, 15000);
    ev.collectionCoach = await waitFor(tab, q("onboarding-collection"), 25000);
    await stage(tab, "05-coleccion");
    mark("colección");

    // 4 · RESTO DE SOBRES (el segundo con F5 a mitad de ceremonia)
    let n = 0;
    for (; n < 12; n++) {
      const s = await snapshotApi(t);
      if (s.onboarding.current !== "collection") break;
      const href = s.onboarding.next?.href as string;
      await sleep(1200);
      await tab.goto(`${BASE}${href}`, 3000);
      if (href.startsWith("/packs/")) { ev.freeStarterNeeded = (ev.freeStarterNeeded ?? 0) + 1; break; }
      const cardsBefore = s.ownedCards;
      await openPackUi(tab, n === 0 ? "06-siguiente-sobre" : "", n === 0);
      const after = await snapshotApi(t);
      if (n === 0) ev.reloadDuringOpening = { cardsBefore, cardsAfter: after.ownedCards, packsOpened: after.packsOpened, duplicated: after.ownedCards - cardsBefore > 6 };
      await waitFor(tab, q("onboarding-pack-next"), 15000);
      if (n === 0) await stage(tab, "07-resumen-siguiente", false);
    }
    ev.packsLoop = n;
    ev.afterPacks = await snapshotApi(t);
    mark("colección completa");

    // 5 · PRIMER EQUIPO (desde el resumen del último sobre → «Crear mi primer equipo»)
    await tab.goto(`${BASE}/`, 3500);
    await waitFor(tab, q("onboarding-continue"), 20000);
    await stage(tab, "08-crear-equipo");
    await click(tab, "onboarding-cta");
    ev.teamReady = await waitFor(tab, q("onboarding-team"), 25000);
    mark("equipo creado");
    await stage(tab, "09-equipo-listo");
    ev.afterTeam = await snapshotApi(t);
    await tab.goto(`${BASE}/`, 3500); // F5 tras crear: no hay segundo equipo
    await waitFor(tab, q("onboarding-team"), 20000);
    ev.afterTeamF5 = { decks: (await snapshotApi(t)).decks.length };

    // 6 · PRIMERA PARTIDA (bot Fácil real, F61)
    await click(tab, "onboarding-cta");
    await waitFor(tab, `location.pathname === '/duelos/jugar'`, 15000);
    await waitFor(tab, `/Comenzar duelo/i.test(document.body.innerText)`, 30000);
    await stage(tab, "10-preparacion", false);
    await clickText(tab, "^Comenzar duelo$");
    mark("partida empieza");
    await waitFor(tab, `!!document.querySelector('[data-scene="intro"]')`, 10000);
    await sleep(500);
    await stage(tab, "11-intro", false);
    ev.hints = [] as string[];
    await waitFor(tab, q("first-match-hint"), 30000);
    const h1 = await tab.js<string>(`document.querySelector('[data-testid="first-match-hint"]')?.getAttribute('data-hint')`);
    ev.hints.push(h1);
    await stage(tab, "12-ayuda-turno-1");
    const view0 = (await api(t, "/api/game/duel", { action: "active" })).json.view;
    ev.match = { id: view0?.matchId, difficulty: view0?.difficulty, rival: view0?.rivalLabel ?? null };
    let turns = 0; let f5Done = false;
    while (turns < 14) {
      const v = (await api(t, "/api/game/duel", { action: "active" })).json.view;
      if (!v || v.status !== "IN_PROGRESS") break;
      if (await tab.js<boolean>(q("first-match-hint"))) {
        const h = await tab.js<string>(`document.querySelector('[data-testid="first-match-hint"]')?.getAttribute('data-hint')`);
        if (h && !ev.hints.includes(h)) { ev.hints.push(h); await stage(tab, `13-ayuda-${h}`, false); }
        await click(tab, "first-match-hint-ok");
      }
      await playOne(tab);
      await waitFor(tab, `!!document.querySelector('[data-f61="moment"]')`, 15000);
      await sleep(REDUCED ? 1200 : 1700);
      if (turns === 0) await stage(tab, "14-comparacion", false);
      await tab.js(`document.querySelector('[data-f61="moment"]')?.click()`);
      turns++;
      if (turns === 3 && !f5Done) {
        f5Done = true;
        await tab.goto(await tab.js<string>("location.href"), 3000);
        await waitFor(tab, `!!document.querySelector('[data-hud="turno"]') || /Partida recuperada/.test(document.body.innerText)`, 30000);
        ev.midMatchF5 = { recovered: await tab.js<boolean>(`/Partida recuperada/.test(document.body.innerText)`), hintRepeated: await tab.js<boolean>(q("first-match-hint")) };
      }
    }
    for (let i = 0; i < 60; i++) {
      if (await tab.js<boolean>(q("onboarding-after-match"))) break;
      await tab.js(`document.querySelector('[data-scene="match-complete"], [data-scene="tiebreak"]')?.click()`);
      await sleep(500);
    }
    const done = (await api(t, "/api/game/duel", { action: "active" })).json.view;
    ev.matchTurns = turns;
    ev.afterMatchShown = await waitFor(tab, q("onboarding-after-match"), 20000);
    mark("resultado");
    await tab.js(`document.querySelector('[data-testid="onboarding-after-match"]')?.scrollIntoView({ block: 'center' })`);
    await stage(tab, "15-resultado");
    ev.result = await tab.js<any>(`(() => { const r = document.querySelector('[data-scene="result"]'); return r ? { kind: r.getAttribute('data-kind'), text: r.innerText.replace(/\\s+/g, ' ').slice(0, 600) } : null })()`);
    ev.afterMatch = await snapshotApi(t);
    ev.matchStillActive = !!done && done.status === "IN_PROGRESS";
    // F5 sobre el resultado: mismo resultado, sin XP ni créditos duplicados, la guía sigue en «Ver mi progreso».
    await tab.goto(await tab.js<string>("location.href"), 3500);
    ev.resultAfterF5 = { shown: await waitFor(tab, q("onboarding-after-match"), 25000), url: await tab.js<string>("location.pathname + location.search") };
    const afterF5 = await snapshotApi(t);
    ev.resultAfterF5.noDuplicate = afterF5.xp === ev.afterMatch.xp && afterF5.credits === ev.afterMatch.credits;

    // 7 · PROGRESO (F62) Y FIN
    await click(tab, "onboarding-see-progress");
    await waitFor(tab, `location.pathname === '/progresion'`, 15000);
    ev.progressCoach = await waitFor(tab, q("onboarding-progress"), 25000);
    await stage(tab, "16-progreso");
    await tab.js(`document.querySelector('[data-testid="onboarding-complete"]')?.scrollIntoView({ block: 'center' })`);
    await stage(tab, "17-ya-estas-listo");
    await click(tab, "onboarding-finish");
    await waitFor(tab, `location.pathname === '/jugar'`, 20000);
    mark("SEGUIR JUGANDO");
    await stage(tab, "18-libre-jugar", false);
    ev.final = await snapshotApi(t);
    await tab.goto(`${BASE}/`, 3500);
    await waitFor(tab, q("main-actions"), 20000);
    ev.homeAfter = { onboardingShown: await tab.js<boolean>(`!!document.querySelector('[data-testid^="onboarding-"]')`), progressDock: await tab.js<boolean>(q("home-progress")) };
    await stage(tab, "19-portada-normal", false);
    ev.timeline = timeline;
    ev.secondsToFirstMatch = timeline.find((x) => x.step === "partida empieza")?.at ?? null;
  } finally {
    await b.close();
  }
  const file = join(OUT, `new-user-e2e${REDUCED ? "-reduced" : ""}-${W0}.json`);
  writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), base: BASE, reduced: REDUCED, width: W0, evidence: ev, captures: rows }, null, 2));
  log(`→ ${file}`);
}

/* ───────────── sondas: seguridad, idempotencia, dos pestañas ───────────── */

async function probes() {
  const c = JSON.parse(readFileSync(credsFile, "utf8")) as Creds;
  const t = await token(c);
  const out: Record<string, any> = { at: new Date().toISOString(), account: c.userId.slice(0, 8) };
  const before = await snapshotApi(t);
  out.before = { status: before.onboarding.status, current: before.onboarding.current, credits: before.credits, packs: before.unopenedPacks, cards: before.ownedCards, decks: before.decks.length };
  // Cuerpos no válidos / órdenes inventadas.
  out.badBodies = [];
  for (const body of [{ action: "grant" }, { action: "start", userId: "00000000-0000-4000-8000-000000000000" }, { action: "finish", finishedAt: 1 }, { action: "claim-starter" }, [], "start"]) {
    const r = await api(t, "/api/game/onboarding", body);
    out.badBodies.push({ body, status: r.status });
  }
  out.getWithParam = (await fetch(`${BASE}/api/game/onboarding?userId=x`, { headers: { authorization: `Bearer ${t}` } })).status;
  out.noToken = (await fetch(`${BASE}/api/game/onboarding`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "start" }) })).status;
  // «Marcar completado a mano» desde el cliente: user_metadata SÍ lo puede escribir el cliente; la guía no lo lee.
  const sb = anon();
  await sb.auth.signInWithPassword({ email: c.email, password: c.password });
  const fake = await sb.auth.updateUser({ data: { nx_onboarding: { v: 1, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString() } } });
  const t2 = (await sb.auth.getSession()).data.session!.access_token;
  const afterFake = await api(t2, "/api/game/onboarding");
  out.clientFakeCompletion = { updateUserError: fake.error?.message ?? null, statusAfter: afterFake.json.status, reason: afterFake.json.reason };
  // Reclamar el starter otra vez: la única vía es la compra del Sobre Inicial (F41), que la política decide.
  const starter = await api(t, "/api/game/starter");
  const buyFree = await api(t, "/api/game/packs", { action: "buy", packId: "inicial" });
  out.claimStarterAgain = { starterEligibility: starter.json, buyInicialStatus: buyFree.status, buyInicialError: buyFree.json.error ?? null };
  // Terminar sin partida (si aún no la hay): 409.
  out.finishNow = (await api(t, "/api/game/onboarding", { action: "finish" })).status;
  // Hasta el paso del equipo por la vía real (abrir sus sobres por la API del juego, la misma que usa la pantalla).
  out.openedViaApi = [];
  for (let i = 0; i < 8; i++) {
    const s = await snapshotApi(t);
    if (s.onboarding.current !== "open" && s.onboarding.current !== "collection") break;
    const pack = Object.entries(s.unopenedPacks ?? {}).find(([, n]) => (n as number) > 0)?.[0];
    if (!pack) break;
    const r = await api(t, "/api/game/packs", { action: "open", packId: pack, ref: `f63-probe-${Date.now()}-${i}` });
    out.openedViaApi.push({ pack, status: r.status });
    await sleep(400);
  }
  // Dos pestañas: EMPEZAR ×10 en paralelo + primer equipo ×6 en paralelo (si procede).
  const par = await Promise.all(Array.from({ length: 10 }, () => api(t, "/api/game/onboarding", { action: "start" })));
  out.parallelStart = par.map((r) => r.status);
  const s1 = await snapshotApi(t);
  if (s1.onboarding.current === "deck" || s1.onboarding.current === "collection") {
    const teams = await Promise.all(Array.from({ length: 6 }, () => api(t, "/api/game/onboarding", { action: "first-team" })));
    out.parallelFirstTeam = { statuses: teams.map((r) => r.status), deckIds: [...new Set(teams.map((r) => r.json.team?.deck?.id).filter(Boolean))] };
  }
  const after = await snapshotApi(t);
  out.after = { status: after.onboarding.status, current: after.onboarding.current, credits: after.credits, packs: after.unopenedPacks, cards: after.ownedCards, decks: after.decks.length };
  // El inventario solo cambia por los sobres abiertos a propósito: ni créditos ni sobres de más por ninguna orden de la guía.
  out.creditsUnchanged = before.credits === after.credits;
  out.packsOnlyDecreased = Object.entries(after.unopenedPacks ?? {}).every(([k, v]) => (v as number) <= ((before.unopenedPacks ?? {})[k] ?? 0));
  writeFileSync(join(OUT, "security-live.json"), JSON.stringify(out, null, 2));
  log(JSON.stringify(out, null, 2).slice(0, 4000));
}

/* ───────────── cuenta existente ───────────── */

async function existing() {
  const c = JSON.parse(readFileSync(credsFile, "utf8")) as Creds;
  const t = await token(c);
  const before = await snapshotApi(t);
  const b = await launch({ args: ["--mute-audio", "--in-process-gpu", "--hide-scrollbars"] });
  const shots: any = {};
  try {
    await b.tab.resize(1440, 900, 1);
    await b.tab.goto(`${BASE}/cuenta`, 3000);
    await b.tab.js(`(() => {
      const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
      set(document.querySelector('input[type="email"]'), ${esc(c.email)}); set(document.querySelector('input[type="password"]'), ${esc(c.password)});
      document.querySelector('form button[type="submit"]').click(); })()`);
    await waitFor(b.tab, `!document.querySelector('input[type="password"]')`, 25000);
    await sleep(2500);
    shots.landing = await b.tab.js<string>("location.pathname");
    for (const p of ["/", "/coleccion", "/jugar", "/progresion"]) {
      await sleep(1500);
      await b.tab.goto(`${BASE}${p}`, 3500);
      await sleep(1500);
      shots[p] = { onboardingUi: await b.tab.js<boolean>(`!!document.querySelector('[data-testid^="onboarding-"]')`), errors: b.tab.takeErrors().length };
      await b.tab.shot(join(SHOTS, `existing-${p.replace(/\//g, "_") || "home"}.png`));
    }
  } finally { await b.close(); }
  const after = await snapshotApi(t);
  const out = {
    at: new Date().toISOString(), account: c.userId.slice(0, 8),
    onboarding: before.onboarding,
    screens: shots,
    unchanged: before.credits === after.credits && before.ownedCards === after.ownedCards && before.decks.length === after.decks.length && before.xp === after.xp,
    before: { credits: before.credits, xp: before.xp, cards: before.ownedCards, decks: before.decks.length },
    after: { credits: after.credits, xp: after.xp, cards: after.ownedCards, decks: after.decks.length },
  };
  writeFileSync(join(OUT, "existing-user-live.json"), JSON.stringify(out, null, 2));
  log(JSON.stringify(out, null, 2));
}

/* ───────────── saltar y retomar ───────────── */

async function skip() {
  const b = await launch({ args: ["--mute-audio", "--in-process-gpu", "--hide-scrollbars"] });
  const tab = b.tab;
  try {
    await tab.resize(W0, W0 < 600 ? 844 : 900, 1);
    await tab.setMedia([{ name: "prefers-reduced-motion", value: REDUCED ? "reduce" : "no-preference" }]);
    const c = await register(tab);
    const t = await token(c);
    ev.account = c.userId.slice(0, 8);
    ev.initial = await snapshotApi(t);
    if ((await tab.js<string>("location.pathname")) !== "/") await tab.goto(`${BASE}/`, 3000);
    await waitFor(tab, q("onboarding-welcome"), 25000);
    await click(tab, "onboarding-skip");
    await waitFor(tab, q("onboarding-skip-dialog"), 5000);
    await stage(tab, "20-saltar-confirmacion", false);
    ev.dialogFocus = await tab.js<string>(`document.activeElement?.textContent?.trim() ?? null`);
    await click(tab, "onboarding-skip-confirm");
    await waitFor(tab, q("main-actions"), 15000);
    await stage(tab, "21-tras-saltar", false);
    ev.afterSkip = await snapshotApi(t);
    ev.homeAfterSkip = { onboardingUi: await tab.js<boolean>(`!!document.querySelector('[data-testid^="onboarding-"]')`) };
    // La cuenta sigue siendo usable: sus sobres siguen ahí y se pueden abrir por la vía normal.
    ev.inventoryUnchanged = ev.initial.credits === ev.afterSkip.credits && JSON.stringify(ev.initial.unopenedPacks) === JSON.stringify(ev.afterSkip.unopenedPacks);
    await sleep(1500);
    await tab.goto(`${BASE}/jugar`, 3500);
    ev.railAfterSkip = await tab.js<boolean>(q("onboarding-rail"));
    await sleep(1500);
    await tab.goto(`${BASE}/como-jugar`, 3500);
    await waitFor(tab, q("guide-resume"), 15000);
    await stage(tab, "22-como-jugar-retomar", false);
    await click(tab, "guide-resume-cta");
    await waitFor(tab, `location.pathname === '/'`, 15000);
    await waitFor(tab, q("onboarding-starter"), 20000);
    await stage(tab, "23-retomado", false);
    ev.afterResume = await snapshotApi(t);
  } finally { await b.close(); }
  writeFileSync(join(OUT, `skip-live-${W0}.json`), JSON.stringify({ at: new Date().toISOString(), evidence: ev, captures: rows }, null, 2));
  log(JSON.stringify(ev, null, 2).slice(0, 3000));
}

/* ───────────── carrera REAL de «crear mi primer equipo» (dos pestañas) ───────────── */

async function race() {
  const c = JSON.parse(readFileSync(credsFile, "utf8")) as Creds;
  const t = await token(c);
  const out: Record<string, any> = { at: new Date().toISOString(), account: c.userId.slice(0, 8) };
  const ws = await api(t, "/api/game/duels");
  // Deja la cuenta SIN equipo con la acción normal del jugador (borrar, confirmando el activo).
  for (const d of ws.json.decks ?? []) {
    const r = await api(t, "/api/game/duels", { action: "delete", id: d.id, baseVersion: d.version, confirmActive: true });
    out.deleted = [...(out.deleted ?? []), { id: d.id.slice(0, 8), status: r.status }];
  }
  log("esperando 65 s a que se vacíe la ventana del limitador…");
  await sleep(65_000);
  const n = 5;
  const res = await Promise.all(Array.from({ length: n }, () => api(t, "/api/game/onboarding", { action: "first-team" })));
  out.parallel = res.map((r) => ({ status: r.status, deck: r.json.team?.deck?.id?.slice(0, 8) ?? null, created: r.json.team?.created ?? null }));
  const after = await api(t, "/api/game/duels");
  out.decksAfter = (after.json.decks ?? []).map((d: any) => ({ id: d.id.slice(0, 8), name: d.name, valid: d.valid, active: d.active }));
  out.activeDeckId = after.json.activeDeckId?.slice(0, 8) ?? null;
  out.oneTeam = out.decksAfter.length === 1;
  writeFileSync(join(OUT, "multitab-race-live.json"), JSON.stringify(out, null, 2));
  log(JSON.stringify(out, null, 2));
}

const run = mode === "flow" ? flow : mode === "probes" ? probes : mode === "existing" ? existing : mode === "skip" ? skip : mode === "race" ? race : null;
if (!run || !credsFile) { console.error("uso: _fase63-live.ts flow|probes|existing <credsFile> [--reduced] [--w=390]"); process.exit(1); }
if (mode !== "flow" && mode !== "skip" && !existsSync(credsFile)) { console.error("no existe credsFile"); process.exit(1); }
run().catch((e) => { console.error("ERROR", e instanceof Error ? e.stack : e); process.exit(1); });
