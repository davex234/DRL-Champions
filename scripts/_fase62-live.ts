/**
 * FASE 62 · QA REAL de progresión contra :3005 → túnel → BD del VPS, SOLO con cuentas QA (instrumento `_`, fuera de CI).
 *
 *   npx tsx scripts/_fase62-live.ts shots <out> [ruta,ruta…]   capturas logueado como QA A a 1440/1024/390 (+ medida)
 *   npx tsx scripts/_fase62-live.ts probe                      lecturas: meta, daily-loop, perfil, progresión (sin escrituras)
 *   npx tsx scripts/_fase62-live.ts play                       una partida PvE real por la interfaz y la progresión post-partida
 *
 * Credenciales: scratchpads de sesiones anteriores (nunca en el repo). A = QA-1ff2c0ef.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { launch, sleep, type Tab } from "./lib/cdp";

for (const line of readFileSync(join(process.cwd(), ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3005";
const TMP = process.env.TEMP ?? "C:/Users/david/AppData/Local/Temp";
const CREDS_A = join(TMP, "claude/C--NEXUS-CENTRAL-DRLCards/287155d6-0740-47dd-baa7-edb43491b4e3/scratchpad/f45-qa-creds.json");
const Q = join(process.cwd(), "docs/product/qa/fase62-progression");
const PROFILE = join(TMP, "claude/C--NEXUS-CENTRAL-DRLCards/a346e3be-edd2-4788-bcfb-c41bedb10579/scratchpad/f62-chrome-A");
mkdirSync(join(Q, "live"), { recursive: true });
const creds = JSON.parse(readFileSync(CREDS_A, "utf8")) as { email: string; password: string; userId: string };
const log = (s: string) => console.log(s);
const esc = (s: string) => JSON.stringify(s);

export async function token(): Promise<string> {
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const { data, error } = await anon.auth.signInWithPassword({ email: creds.email, password: creds.password });
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
async function login(tab: Tab) {
  await tab.goto(`${BASE}/cuenta`, 3000);
  if (await tab.js<boolean>(`!!document.querySelector('input[type="password"]')`)) {
    await tab.js(`(() => {
      const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
      set(document.querySelector('input[type="email"]'), ${esc(creds.email)}); set(document.querySelector('input[type="password"]'), ${esc(creds.password)});
      document.querySelector('form button[type="submit"]').click(); })()`);
    await waitFor(tab, `!document.querySelector('input[type="password"]')`, 20000);
  }
}
const MEASURE = `(() => {
  const W = innerWidth; let over = 0; const list = [];
  for (const e of document.querySelectorAll('body *')) {
    const b = e.getBoundingClientRect(); if (!b.width || !b.height) continue;
    if (b.right > W + 1 || b.left < -1) {
      let skip = !!e.closest('[aria-hidden="true"]');
      for (let a = e; !skip && a && a !== document.body; a = a.parentElement) { const cs = getComputedStyle(a); if (Number(cs.opacity) === 0) skip = true; else if (a !== e && cs.overflowX !== 'visible') { const r = a.getBoundingClientRect(); if (r.left >= -1 && r.right <= W + 1) skip = true; } }
      if (!skip) { over++; if (list.length < 6) list.push((e.getAttribute('data-testid') || e.tagName) + ' ' + Math.round(b.left) + '..' + Math.round(b.right)); }
    }
  }
  const imgs = [...document.images];
  return JSON.stringify({ docScrollW: document.documentElement.scrollWidth, W, over, list, images: imgs.length, broken: imgs.filter(i => i.complete && i.naturalWidth === 0).map(i => i.currentSrc || i.src) });
})()`;

async function shots(out: string, routes: string[]) {
  const dir = join(Q, "screenshots", out);
  mkdirSync(dir, { recursive: true });
  const b = await launch({ userDataDir: PROFILE, args: ["--mute-audio", "--in-process-gpu", "--hide-scrollbars"] });
  const rows: unknown[] = [];
  try {
    await b.tab.resize(1440, 900, 1);
    await login(b.tab);
    for (const [w, h] of [[1440, 900], [1024, 768], [390, 844]] as const) {
      await b.tab.resize(w, h, 1);
      for (const r of routes) {
        const reduced = r.endsWith("#reduced");
        const path = r.replace("#reduced", "");
        await b.tab.setMedia([{ name: "prefers-reduced-motion", value: reduced ? "reduce" : "no-preference" }]);
        b.tab.takeErrors();
        await sleep(1500); // no disparar el limitador de peticiones al navegar seguido (429)
        await b.tab.goto(`${BASE}${path}`, 2500);
        await sleep(2500);
        const name = `${path.replace(/[/?=&]+/g, "_").replace(/^_/, "") || "home"}-${w}${reduced ? "-reduced" : ""}`;
        const m = JSON.parse(await b.tab.js<string>(MEASURE));
        await b.tab.shot(join(dir, `${name}.png`));
        const errors = b.tab.takeErrors();
        rows.push({ name, path, w, h, reduced, measure: m, errors });
        log(`  ${name} over=${m.over} broken=${m.broken.length} errors=${errors.length}`);
        if (process.argv.includes("--full")) {
          await b.tab.send("Emulation.setDeviceMetricsOverride", { width: w, height: await b.tab.js<number>(`Math.min(document.documentElement.scrollHeight, 6000)`), deviceScaleFactor: 1, mobile: w < 600 });
          await b.tab.shot(join(dir, `${name}-full.png`));
          await b.tab.resize(w, h, 1);
        }
      }
    }
  } finally { await b.close(); }
  writeFileSync(join(dir, "shots.json"), JSON.stringify({ at: new Date().toISOString(), rows }, null, 2));
}

async function probe() {
  const t = await token();
  const out: Record<string, unknown> = { at: new Date().toISOString(), account: creds.userId };
  for (const p of ["/api/game/meta", "/api/game/daily-loop", "/api/game/season", "/api/game/state", "/api/game/play-status"]) {
    const r = await api(t, p);
    out[p] = { status: r.status, keys: Object.keys(r.json ?? {}), body: r.json };
  }
  writeFileSync(join(Q, "live", "probe.json"), JSON.stringify(out, null, 2));
  log(JSON.stringify(out).slice(0, 3000));
}

/* ───────────── QA funcional real ───────────── */

async function playOne(tab: Tab): Promise<boolean> {
  const ok = await waitFor(tab, `(() => { const b = [...document.querySelectorAll('[aria-label="Tu mano"] button')].filter(x => !x.disabled); return b.length > 0 && !document.querySelector('[data-scene="intro"]') && !document.querySelector('[data-f61="moment"]'); })()`, 25000);
  if (!ok) return false;
  await tab.js(`[...document.querySelectorAll('[aria-label="Tu mano"] button')].filter(x => !x.disabled)[0].click()`);
  await sleep(250);
  await tab.js(`(() => { const s = [...document.querySelectorAll('button')].find(b => /^(SH|GS|EF)\\s*\\d/.test((b.textContent||'').trim()) && !b.disabled); if (s) s.click(); return !!s; })()`);
  await sleep(250);
  return tab.js<boolean>(`(() => { const b = [...document.querySelectorAll('button')].find(x => /^(Declarar y atacar|Responder)$/i.test((x.textContent||'').trim()) && !x.disabled); if (!b) return false; b.click(); return true; })()`);
}

type Snap = { account: { xp: number; credits: number }; season: { level: number; xpIntoLevel: number }; pass: { xp: number; level: number; missions: any[]; tracks: any; achievements: any[] }; ledger: any[] };
const pending = (s: Snap) => [
  ...s.pass.missions.filter((m: any) => m.complete && !m.claimed && (m.expiresAt === null || m.expiresAt > Date.now())).map((m: any) => ({ key: `mission:${m.id}`, credits: m.rewardCredits, seasonXp: m.xp, pack: m.packId })),
  ...s.pass.tracks.free.filter((l: any) => l.claimable && !l.claimed).map((l: any) => ({ key: `level:${l.level}`, credits: l.reward.credits ?? 0, seasonXp: 0, pack: l.reward.packId ?? null })),
  ...s.pass.achievements.filter((a: any) => a.complete && !a.claimed).map((a: any) => ({ key: `achievement:${a.id}`, credits: a.reward, seasonXp: 0, pack: null })),
];

async function play() {
  const t = await token();
  const ev: Record<string, unknown> = { at: new Date().toISOString(), account: creds.userId };
  const meta = async (): Promise<Snap> => (await api(t, "/api/game/meta")).json;
  const s0 = await meta();
  ev.before = { xp: s0.account.xp, credits: s0.account.credits, seasonLevel: s0.season.level, passXp: s0.pass.xp, pending: pending(s0) };
  const pre = await api(t, "/api/game/duel", { action: "active" });
  if (pre.json.view) await api(t, "/api/game/duel", { action: "abandon", matchId: pre.json.view.matchId });

  const dir = join(Q, "screenshots", "live");
  mkdirSync(dir, { recursive: true });
  const b = await launch({ userDataDir: PROFILE, args: ["--mute-audio", "--in-process-gpu", "--hide-scrollbars"] });
  const tab = b.tab;
  try {
    await tab.resize(1440, 900, 1);
    await tab.setMedia([{ name: "prefers-reduced-motion", value: "reduce" }]); // lo que ve el usuario en su PC
    await login(tab);
    tab.takeErrors();

    // 1 · PARTIDA REAL
    await tab.goto(`${BASE}/duelos/jugar`, 2500);
    await waitFor(tab, `/Comenzar duelo/i.test(document.body.innerText)`, 30000);
    await tab.js(`[...document.querySelectorAll('button')].find(b => /^Comenzar duelo$/i.test(b.textContent.trim()))?.click()`);
    // La partida la crea el servidor: se espera a la mesa (mano jugable) antes de consultar la partida activa.
    await waitFor(tab, `[...document.querySelectorAll('[aria-label="Tu mano"] button')].some(x => !x.disabled) && !document.querySelector('[data-scene="intro"]')`, 30000);
    for (let k = 0; k < 12; k++) {
      const v = (await api(t, "/api/game/duel", { action: "active" })).json.view;
      if (!v || v.status !== "IN_PROGRESS") break;
      await playOne(tab);
      await waitFor(tab, `!!document.querySelector('[data-f61="moment"]')`, 15000);
      await sleep(900);
      await tab.js(`document.querySelector('[data-f61="moment"]')?.click()`);
    }
    await waitFor(tab, `!!document.querySelector('[data-scene="result"]')`, 30000);
    for (let i = 0; i < 20 && await tab.js<boolean>(`!!document.querySelector('[data-scene="match-complete"],[data-scene="tiebreak"]')`); i++) { await tab.js(`document.querySelector('[data-scene="match-complete"],[data-scene="tiebreak"]')?.click()`); await sleep(400); }
    await waitFor(tab, `!!document.querySelector('[data-postmatch]')`, 20000);
    await sleep(800);
    const post = await tab.js<any>(`(() => { const p = document.querySelector('[data-postmatch]'); return { state: p?.getAttribute('data-postmatch'), sections: p?.getAttribute('data-sections'), completed: [...document.querySelectorAll('[data-objective-complete]')].map(e => e.getAttribute('data-objective-complete')), claimButtons: document.querySelectorAll('[data-testid="postmatch-claim"]').length, levelUp: document.querySelector('[data-levelup]')?.getAttribute('data-levelup') ?? null, beforeActions: (() => { const a = document.querySelector('[data-testid="result-actions"]'); return p && a ? !!(p.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING) : null; })() }; })()`);
    await tab.js(`document.querySelector('[data-postmatch]')?.scrollIntoView({ block: 'center' })`);
    await sleep(500);
    await tab.shot(join(dir, "result-progress.png"));
    const s1 = await meta();
    const duelRow = s1.ledger.find((l: any) => String(l.ref).startsWith("duel:"));
    ev.match = { post, accountXpDelta: s1.account.xp - s0.account.xp, creditsDelta: s1.account.credits - s0.account.credits, ledgerDuel: duelRow };

    // 2 · RECLAMAR EN EL RESULTADO (doble clic)
    if (post.claimButtons > 0) {
      await tab.js(`(() => { const b = document.querySelector('[data-testid="postmatch-claim"]'); b?.click(); b?.click(); })()`);
      await waitFor(tab, `!!document.querySelector('[data-testid="reward-reveal"]')`, 15000);
      await sleep(400);
      await tab.shot(join(dir, "result-claim-reveal.png"));
      await sleep(1500);
      const s2 = await meta();
      ev.postmatchClaim = { passXpDelta: s2.pass.xp - s1.pass.xp, creditsDelta: s2.account.credits - s1.account.credits, season: [s1.season.level, s2.season.level], sectionsAfter: await tab.js<string>(`document.querySelector('[data-postmatch]')?.getAttribute('data-sections')`) };
      await tab.shot(join(dir, "result-after-claim.png"));
    }

    // 3 · HUB: reclamar todo (doble clic)
    const s3 = await meta();
    const want = pending(s3);
    await tab.goto(`${BASE}/progresion`, 2500);
    await waitFor(tab, `!!document.querySelector('[data-testid="claim-center"]')`, 20000);
    await sleep(800);
    await tab.shot(join(dir, "hub-before-claim.png"));
    const hubCount = Number(await tab.js<string>(`document.querySelector('[data-testid="claim-center"]').getAttribute('data-count')`));
    if (hubCount > 0) {
      await tab.js(`(() => { const b = document.querySelector('[data-testid="claim-all"]'); b?.click(); b?.click(); })()`);
      await waitFor(tab, `!!document.querySelector('[data-testid="reward-reveal"]')`, 30000);
      await sleep(600);
      await tab.shot(join(dir, "hub-claim-reveal.png"));
      await sleep(3000);
    }
    const s4 = await meta();
    ev.hubClaimAll = {
      offered: hubCount, serverPending: want.length, keys: want.map((w) => w.key),
      creditsDelta: s4.account.credits - s3.account.credits, expectedCredits: want.reduce((a, c) => a + (c.credits || 0), 0),
      passXpDelta: s4.pass.xp - s3.pass.xp, expectedSeasonXp: want.reduce((a, c) => a + (c.seasonXp || 0), 0),
      season: [s3.season.level, s4.season.level], pendingAfter: pending(s4).map((p) => p.key),
    };
    await tab.goto(`${BASE}/progresion`, 2500);
    await waitFor(tab, `!!document.querySelector('[data-testid="claim-center"]')`, 20000);
    await sleep(800);
    await tab.shot(join(dir, "hub-after-claim.png"));
    const again = Number(await tab.js<string>(`document.querySelector('[data-testid="claim-center"]').getAttribute('data-count')`));
    if (again > 0) {
      const w2 = pending(await meta());
      await tab.js(`document.querySelector('[data-testid="claim-all"]')?.click()`);
      await waitFor(tab, `!!document.querySelector('[data-testid="reward-reveal"]')`, 30000);
      await sleep(600);
      await tab.shot(join(dir, "hub-claim-levels.png"));
      await sleep(3000);
      const s5 = await meta();
      ev.hubLevels = { offered: again, keys: w2.map((w) => w.key), expectedCredits: w2.reduce((a, c) => a + (c.credits || 0), 0), creditsDelta: s5.account.credits - s4.account.credits, pendingAfter: pending(s5).map((p) => p.key), season: s5.season.level };
      await tab.goto(`${BASE}/progresion`, 2500);
      await sleep(2000);
      await tab.shot(join(dir, "hub-final.png"));
    }

    // 4 · RELEER ×3: nada reaparece
    const counts: number[] = [];
    for (let i = 0; i < 3; i++) { await tab.goto(`${BASE}/progresion`, 2500); await waitFor(tab, `!!document.querySelector('[data-testid="claim-center"]')`, 20000); counts.push(Number(await tab.js<string>(`document.querySelector('[data-testid="claim-center"]').getAttribute('data-count')`))); }
    ev.refreshCounts = counts;

    // 5 · PORTADA
    await tab.goto(`${BASE}/`, 3500);
    await waitFor(tab, `!!document.querySelector('[data-testid="home-progress"]')`, 20000);
    await sleep(800);
    ev.home = await tab.js<any>(`(() => ({ dock: !!document.querySelector('[data-testid="home-progress"]'), claimable: document.querySelector('[data-testid="home-claimable"]')?.textContent ?? null, near: document.querySelector('[data-testid="home-near"]')?.textContent ?? null, season: document.querySelector('[data-testid="home-season"]')?.textContent ?? null }))()`);
    await tab.shot(join(dir, "home.png"));
    ev.consoleErrors = tab.takeErrors();
  } finally { await b.close(); }
  const sf = await meta();
  ev.after = { xp: sf.account.xp, credits: sf.account.credits, seasonLevel: sf.season.level, passXp: sf.pass.xp, pending: pending(sf).map((p) => p.key) };
  writeFileSync(join(Q, "live", "play.json"), JSON.stringify(ev, null, 2));
  log(JSON.stringify(ev, null, 2).slice(0, 7000));
}

const [phase, ...rest] = process.argv.slice(2);
(phase === "shots" ? shots(rest[0] ?? "before", (rest[1] ?? "/,/progresion,/temporada,/logros,/recompensas,/jugador/me").split(",")) : phase === "probe" ? probe() : phase === "play" ? play() : Promise.reject(new Error("fase: shots|probe|play")))
  .catch((e) => { console.error(e); process.exitCode = 1; });
