/**
 * FASE 66 · E2E DE DOS CLIENTES REALES (instrumento `_`, fuera de CI). Dos Chrome independientes (dos perfiles, dos
 * sesiones) juegan RANKED por la INTERFAZ contra la app real :3005 → túnel → Postgres del VPS. SOLO cuentas QA.
 *
 *   npx tsx scripts/multiplayer/_fase66-e2e.ts [--matches=5]
 *
 * Partida 1 = PARTIDA CAOS en el cliente A: latencia 0/100/300/800/1500 ms rotando por turno, doble clic, F5 en el
 * turno 3 (B), F5 con la acción EN VUELO (A), desconexión temporal de A (offline 20 s), pestaña vieja por API, y el
 * resultado recargado. Partidas 2…N = «Buscar otro rival» en los dos clientes (Play Again) y juego normal.
 * Tras CADA turno se comparan los hechos públicos de A y B (servidor) y lo que pinta cada interfaz.
 * Capturas: A a 1440, B a 390. Red: peticiones por partida y por ruta (CDP). Fugas: métricas de rendimiento entre partidas.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep, type Tab } from "../lib/cdp";
import { api, creds, login, mm, pvpGet, publicFacts, recomputeFromHistory, rating, uuid, validDeck, type Who } from "./_qa";

/* eslint-disable @typescript-eslint/no-explicit-any */
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3005";
const OUT = join(process.cwd(), "docs/product/qa/fase66-multiplayer");
const SHOTS = join(OUT, "screenshots");
mkdirSync(SHOTS, { recursive: true });
const MATCHES = Number(process.argv.find((a) => a.startsWith("--matches="))?.slice(10) ?? 5);
const OUTFILE = process.argv.find((a) => a.startsWith("--out="))?.slice(6) ?? "e2e-two-clients.json";
const esc = (s: string) => JSON.stringify(s);
const LAT = [0, 100, 300, 800, 1500];

interface Client { name: "A" | "B"; tab: Tab; who: Who; close: () => Promise<void>; reqs: Map<string, number>; statuses: Map<number, number>; notFound: string[] }

async function openClient(name: "A" | "B", width: number, height: number): Promise<Client> {
  const b = await launch({ args: ["--mute-audio", "--in-process-gpu"] });
  const tab = b.tab;
  await tab.resize(width, height, 1);
  await tab.setMedia([{ name: "prefers-reduced-motion", value: name === "B" ? "reduce" : "no-preference" }]);
  await tab.send("Network.enable");
  await tab.send("Performance.enable");
  const reqs = new Map<string, number>(); const statuses = new Map<number, number>(); const notFound: string[] = [];
  // Cuenta peticiones de API por ruta (sin query) y códigos de respuesta: detecta tormentas y 404.
  const root = (tab as any);
  void root;
  const c: Client = { name, tab, who: await login(name), close: b.close, reqs, statuses, notFound };
  await wireNetwork(c);
  const cr = creds(name);
  await tab.goto(`${BASE}/cuenta`, 2500);
  if (await tab.js<boolean>(`!!document.querySelector('input[type="password"]')`)) {
    await tab.js(`(() => { const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
      set(document.querySelector('input[type="email"]'), ${esc(cr.email)}); set(document.querySelector('input[type="password"]'), ${esc(cr.password)}); document.querySelector('form button[type="submit"]').click(); })()`);
    await waitFor(tab, `!document.querySelector('input[type="password"]')`, 20000);
  }
  return c;
}

/** Escucha la red del cliente por CDP (Network.*) a través del propio `send` de la pestaña. */
async function wireNetwork(c: Client) {
  // El Tab expone `send` pero no `on`; se sondea el registro de rendimiento del navegador en su lugar (sin tocar cdp.ts).
  await c.tab.js(`(() => { window.__nx = { n: {}, s: {}, nf: [] };
    const obs = new PerformanceObserver((l) => { for (const e of l.getEntries()) { if (!/\\/api\\//.test(e.name)) continue; const p = new URL(e.name).pathname; window.__nx.n[p] = (window.__nx.n[p] || 0) + 1; const st = e.responseStatus || 0; window.__nx.s[st] = (window.__nx.s[st] || 0) + 1; if (st === 404) window.__nx.nf.push(p); } });
    obs.observe({ type: 'resource', buffered: true }); })()`).catch(() => null);
}
async function netSnapshot(c: Client) { return c.tab.js<any>(`window.__nx || null`).catch(() => null); }

const waitFor = async (tab: Tab, expr: string, ms = 20000) => {
  for (let i = 0; i < ms / 200; i++) { if (await tab.js<boolean>(expr).catch(() => false)) return true; await sleep(200); }
  return false;
};

const MESA = `(() => { const q = (s) => document.querySelector(s); return {
  arena: !!q('[data-scene="pvp-arena"]'), intro: !!q('[data-scene="intro"]'), moment: !!q('[data-f61="moment"]'),
  turn: q('[data-testid="turn-label"]')?.textContent?.trim() ?? null,
  hand: [...document.querySelectorAll('[aria-label="Tu mano"] button')].filter(x => !x.disabled).length,
  outcome: /Victoria|Derrota|Empate/i.test(document.body.innerText.slice(0, 1500)) && !q('[data-scene="pvp-arena"]'),
  syncing: /Sincronizando|Reconectando|Recuperando/i.test(document.body.innerText),
  text: document.body.innerText.slice(0, 160).replace(/\\s+/g, ' '),
}; })()`;

async function shot(c: Client, name: string) { await c.tab.shot(join(SHOTS, `${name}-${c.name === "A" ? "1440" : "390"}.png`)); }

/** Juega su turno por la interfaz si le toca: carta → eje (si ataca) → confirmar. `dbl` = doble clic en confirmar. */
async function playIfTurn(c: Client, snap: any, opts: { dbl?: boolean; reloadInFlight?: boolean } = {}): Promise<string> {
  if (!snap?.isYourTurn) return "no-turn";
  const tab = c.tab;
  // Cerrar el momento de revelación si tapa la mano.
  await tab.js(`document.querySelector('[data-f61="moment"]')?.click()`).catch(() => null);
  const ready = await waitFor(tab, `(() => [...document.querySelectorAll('[aria-label="Tu mano"] button')].filter(x => !x.disabled).length > 0 && !document.querySelector('[data-scene="intro"]'))()`, 20000);
  if (!ready) {
    const dump = await tab.js<any>(`({ url: location.pathname + location.search, scenes: [...document.querySelectorAll('[data-scene]')].map(e => e.getAttribute('data-scene')), hand: document.querySelectorAll('[aria-label="Tu mano"] button').length, buttons: [...document.querySelectorAll('button')].map(x => (x.textContent||'').trim()).filter(Boolean).slice(0, 12), text: document.body.innerText.slice(0, 240).replace(/\s+/g, ' ') })`).catch(() => null);
    await tab.shot(join(SHOTS, `diag-hand-not-ready-${c.name}-${Date.now()}.png`)).catch(() => null);
    return `hand-not-ready ${JSON.stringify(dump)}`;
  }
  await tab.js(`[...document.querySelectorAll('[aria-label="Tu mano"] button')].filter(x => !x.disabled)[0].click()`);
  await sleep(200);
  await tab.js(`(() => { const s = [...document.querySelectorAll('button')].find(b => /^(SH|GS|EF)\\s*\\d/.test((b.textContent||'').trim()) && !b.disabled); if (s) s.click(); })()`);
  await sleep(200);
  const t0 = Date.now();
  const clicked = await tab.js<boolean>(`(() => { const b = [...document.querySelectorAll('button')].find(x => /^(Declarar y atacar|Responder)$/i.test((x.textContent||'').trim()) && !x.disabled); if (!b) return false; b.click(); ${opts.dbl ? "b.click(); b.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));" : ""} return true; })()`);
  if (!clicked) return "no-confirm";
  // Feedback inmediato: el botón queda bloqueado/«enviando» antes de la respuesta (sin ganador optimista).
  const fb = await tab.js<any>(`(() => { const b = [...document.querySelectorAll('button')].find(x => /(Declarar y atacar|Responder|Enviando|Resolviendo)/i.test((x.textContent||'').trim())); return { disabled: b ? b.disabled || b.getAttribute('aria-busy') === 'true' : null, text: b ? b.textContent.trim() : null, winnerShown: /Victoria|Derrota/i.test(document.body.innerText.slice(0, 600)) }; })()`);
  if (opts.reloadInFlight) { await tab.send("Page.reload", { ignoreCache: false }); await sleep(3500); await wireNetwork(c); return `reload-in-flight fb=${JSON.stringify(fb)} ${Date.now() - t0}ms`; }
  return `played fb=${JSON.stringify(fb)}`;
}

async function playMatch(A: Client, B: Client, idx: number, chaos: boolean, ev: any) {
  const m: any = { idx, chaos, turns: [], chaosLog: [] };
  const [dA, dB] = await Promise.all([validDeck(A.who), validDeck(B.who)]);
  const r0 = { A: await rating(A.who), B: await rating(B.who) };
  // Cola desde la interfaz: el primer partido con ?buscar=; los siguientes con «Buscar otro rival» (Play Again).
  if (idx === 1) {
    await Promise.all([A.tab.goto(`${BASE}/duelos/pvp?buscar=${dA!.id}`, 2500), B.tab.goto(`${BASE}/duelos/pvp?buscar=${dB!.id}`, 2500)]);
    await Promise.all([wireNetwork(A), wireNetwork(B)]);
    await shot(A, "01-queue"); await shot(B, "01-queue");
  } else {
    const again = await Promise.all([A, B].map((c) => c.tab.js<boolean>(`(() => { const b = [...document.querySelectorAll('button, a')].find(x => /Buscar otro rival/i.test(x.textContent||'') && !x.disabled); if (!b) return false; b.click(); return true; })()`)));
    m.playAgainClicked = again;
    if (!again.every(Boolean)) {
      await Promise.all([A.tab.goto(`${BASE}/duelos/pvp?buscar=${dA!.id}`, 2500), B.tab.goto(`${BASE}/duelos/pvp?buscar=${dB!.id}`, 2500)]);
    }
  }
  // F5 en la cola (cliente B) en el partido caos: no crea otra entrada.
  if (chaos) {
    const e1 = (await mm(B.who)).json?.entry?.entryId;
    await B.tab.send("Page.reload", {}); await sleep(3000); await wireNetwork(B);
    const e2 = (await mm(B.who)).json?.entry?.entryId;
    m.chaosLog.push({ queueF5: { before: e1?.slice(0, 8) ?? null, after: e2?.slice(0, 8) ?? null, same: !e1 || e1 === e2 } });
  }
  let matchId: string | null = null;
  for (let i = 0; i < 40 && !matchId; i++) {
    /*
     * Solo se sondea la cola de A y cada 2 s: el instrumento comparte la cubeta `mm_status` (90/min) con la página de
     * cada cliente, y sondear a los dos cada segundo la agotaba (falso «cliente atascado» en la 1.ª corrida). B se
     * confirma por la partida (otra cubeta). Solo una partida NUEVA: tras «Buscar otro rival» la cola aún puede
     * devolver la entrada MATCHED anterior.
     */
    const a = await mm(A.who);
    const cand = a.json?.entry?.state === "MATCHED" ? a.json.entry.matchId : null;
    if (cand && !(ev.matchIds as string[]).includes(cand) && (await pvpGet(B.who, cand)).status === 200) matchId = cand;
    else await sleep(2000);
  }
  if (!matchId) throw new Error(`partida ${idx}: sin emparejamiento`);
  m.matchId = matchId.slice(0, 8);
  m.newMatchId = !(ev.matchIds as string[]).includes(matchId);
  (ev.matchIds as string[]).push(matchId);
  if (idx === 1) { await waitFor(A.tab, `!!document.querySelector('[data-testid="ranked-match-found"]') || !!document.querySelector('[data-scene="intro"]') || !!document.querySelector('[data-scene="pvp-arena"]')`, 15000); await shot(A, "02-match-found"); await shot(B, "02-match-found"); }

  let turnNo = 0, offlineDone = false, staleDone = false, reloadDone = false, pendingReloadDone = false;
  for (let guard = 0; guard < 200; guard++) {
    const [sa, sb] = await Promise.all([pvpGet(A.who, matchId), pvpGet(B.who, matchId)]);
    const A_ = sa.json.snapshot, B_ = sb.json.snapshot;
    const fa = publicFacts(A_), fb = publicFacts(B_);
    const turnsNow = A_.match.turns.length;
    if (turnsNow !== turnNo) {
      turnNo = turnsNow;
      const ui = { A: await A.tab.js<any>(MESA).catch(() => null), B: await B.tab.js<any>(MESA).catch(() => null) };
      m.turns.push({ turn: turnNo, sameServerFacts: JSON.stringify(fa) === JSON.stringify(fb), version: fa?.version, score: `${fa?.scoreA}-${fa?.scoreB}`, uiTurn: [ui.A?.turn, ui.B?.turn] });
      if (chaos && turnNo === 1) { await shot(A, "03-playing"); await shot(B, "03-waiting"); }
    }
    if (["FINISHED", "ABANDONED", "EXPIRED"].includes(A_.lifecycle)) break;
    const actor = A_.isYourTurn ? A : B_.isYourTurn ? B : null;
    if (!actor) { await sleep(400); continue; }
    const snap = actor === A ? A_ : B_;
    // ── caos en el partido 1 ──
    if (chaos) {
      await A.tab.send("Network.emulateNetworkConditions", { offline: false, latency: LAT[turnNo % LAT.length], downloadThroughput: -1, uploadThroughput: -1 });
      if (!reloadDone && turnNo === 3) { reloadDone = true; await B.tab.send("Page.reload", {}); await sleep(3500); await wireNetwork(B); m.chaosLog.push({ f5B: await B.tab.js<any>(MESA) }); await shot(B, "04-after-f5"); continue; }
      if (!offlineDone && turnNo >= 6 && actor === B) {
        offlineDone = true;
        await A.tab.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
        const res = await playIfTurn(B, snap); // el rival juega mientras A está sin red
        await sleep(15000);
        const whileOff = await A.tab.js<any>(MESA);
        await shot(A, "05-offline");
        await A.tab.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
        const recovered = await waitFor(A.tab, `!/Reconectando|Sincronizando/i.test(document.body.innerText)`, 30000);
        await shot(A, "06-reconnected");
        m.chaosLog.push({ tempDisconnect: { rivalPlayed: res, whileOffline: { syncing: whileOff?.syncing, text: whileOff?.text }, recovered } });
        continue;
      }
      if (!staleDone && turnNo >= 8 && actor === A) {
        staleDone = true;
        const stale = await api(A.who, "/api/game/duel/pvp", { action: "play", matchId, actionId: uuid(), expectedVersion: snap.stateVersion - 1, cardUid: uuid(), stat: "stronghold" });
        m.chaosLog.push({ staleTab: { status: stale.status, resync: stale.json?.sync?.stateVersion ?? null } });
      }
      if (!pendingReloadDone && turnNo >= 4 && actor === A) {
        pendingReloadDone = true;
        const r = await playIfTurn(A, snap, { reloadInFlight: true });
        const after = (await pvpGet(A.who, matchId)).json.snapshot;
        m.chaosLog.push({ pendingActionF5: { r, versionBefore: snap.stateVersion, versionAfter: after.stateVersion, appliedAtMostOnce: after.stateVersion - snap.stateVersion <= 1 } });
        await shot(A, "07-after-pending-f5");
        continue;
      }
      const res = await playIfTurn(actor, snap, { dbl: turnNo === 1 || turnNo === 2 });
      m.chaosLog.push({ turn: turnNo + 1, actor: actor.name, latencyA: LAT[turnNo % LAT.length], res });
    } else {
      const res = await playIfTurn(actor, snap);
      if (res.startsWith("hand-not-ready") || res === "no-confirm") m.chaosLog.push({ turn: turnNo + 1, actor: actor.name, res });
    }
    await sleep(900);
  }
  if (chaos) await A.tab.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  // Resultado en las dos interfaces.
  await Promise.all([A, B].map((c) => waitFor(c.tab, `(() => { document.querySelector('[data-f61="moment"]')?.click(); return /Victoria|Derrota|Empate/i.test(document.body.innerText) && !document.querySelector('[data-scene="pvp-arena"]'); })()`, 40000)));
  await sleep(1500);
  if (chaos) { await shot(A, "08-result"); await shot(B, "08-result"); }
  const [fa, fb] = await Promise.all([pvpGet(A.who, matchId, "&outcome=1"), pvpGet(B.who, matchId, "&outcome=1")]);
  const res = fa.json.snapshot.match.result;
  const r1 = { A: await rating(A.who), B: await rating(B.who) };
  m.final = {
    lifecycle: fa.json.snapshot.lifecycle, sameFacts: JSON.stringify(publicFacts(fa.json.snapshot)) === JSON.stringify(publicFacts(fb.json.snapshot)),
    result: res ? { winner: res.winner, score: `${res.scoreA}-${res.scoreB}`, decidedBy: res.combat?.decidedBy } : null,
    recomputed: recomputeFromHistory(res), turnsPlayed: fa.json.snapshot.match.turns.length,
    elo: { before: r0, after: r1, outcomeA: fa.json.outcome, outcomeB: fb.json.outcome,
      once: fa.json.outcome && fb.json.outcome ? r1.A.rating - r0.A.rating === fa.json.outcome.delta && r1.B.rating - r0.B.rating === fb.json.outcome.delta && r1.A.games === r0.A.games! + 1 : null },
  };
  // Recarga del resultado: nada se mueve otra vez.
  if (chaos) {
    await A.tab.send("Page.reload", {}); await sleep(3500); await wireNetwork(A);
    const r2 = await rating(A.who);
    m.resultF5 = { ratingUnchanged: r2.rating === r1.A.rating && r2.games === r1.A.games, screen: await A.tab.js<any>(MESA) };
    await shot(A, "09-result-f5");
  }
  m.allTurnsConsistent = m.turns.every((t: any) => t.sameServerFacts);
  return m;
}

(async () => {
  const ev: any = { at: new Date().toISOString(), base: BASE, matchIds: [] as string[], matches: [] as any[] };
  const [A, B] = [await openClient("A", 1440, 900), await openClient("B", 390, 844)];
  ev.accounts = { A: A.who.userId.slice(0, 8), B: B.who.userId.slice(0, 8) };
  try {
    // Estado limpio: fuera de colas y sin PvP vivo.
    for (const c of [A, B]) {
      await mm(c.who, { action: "cancel" });
      const e = (await mm(c.who)).json?.entry;
      if (e?.state === "MATCHED" && e.matchId) { const s = (await pvpGet(c.who, e.matchId)).json?.snapshot; if (s && !["FINISHED", "ABANDONED", "EXPIRED"].includes(s.lifecycle)) await api(c.who, "/api/game/duel/pvp", { action: "abandon", matchId: e.matchId }); }
    }
    const perf: any[] = [];
    for (let i = 1; i <= MATCHES; i++) {
      const before = { A: await netSnapshot(A), B: await netSnapshot(B) };
      const m = await playMatch(A, B, i, i === 1, ev);
      const after = { A: await netSnapshot(A), B: await netSnapshot(B) };
      m.network = { A: diffNet(before.A, after.A), B: diffNet(before.B, after.B) };
      const metrics = await A.tab.send("Performance.getMetrics").catch(async () => { await A.tab.send("Performance.enable"); return A.tab.send("Performance.getMetrics"); });
      const pick = (k: string) => metrics?.metrics?.find((x: any) => x.name === k)?.value ?? null;
      perf.push({ match: i, listeners: pick("JSEventListeners"), nodes: pick("Nodes"), heapMB: pick("JSHeapUsedSize") ? Math.round(pick("JSHeapUsedSize") / 1e5) / 10 : null });
      // Silencio tras terminar: sin sondeos vivos en la pantalla de resultado durante 8 s.
      const q0 = await netSnapshot(A); await new Promise((r) => setTimeout(r, 8000)); const q1 = await netSnapshot(A);
      m.idleAfterResult = diffNet(q0, q1);
      ev.matches.push(m);
      console.log(`partida ${i}: ${m.final.result?.score} ${m.final.result?.decidedBy} consistente=${m.allTurnsConsistent} elo1vez=${m.final.elo.once}`);
    }
    ev.perf = perf;
    ev.consoleErrors = { A: A.tab.takeErrors(), B: B.tab.takeErrors() };
  } finally {
    await A.close(); await B.close();
  }
  writeFileSync(join(OUT, OUTFILE), JSON.stringify(ev, null, 2));
  console.log(JSON.stringify({ matches: ev.matches.map((m: any) => ({ idx: m.idx, consistent: m.allTurnsConsistent, eloOnce: m.final.elo.once, recomputed: m.final.recomputed?.agrees, turns: m.final.turnsPlayed })), perf: ev.perf, errors: ev.consoleErrors }, null, 2));
})().catch((e) => { console.error("E2E FALLÓ:", e); process.exit(1); });

function diffNet(a: any, b: any) {
  if (!a || !b) return null;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(b.n ?? {})) { const d = (v as number) - ((a.n ?? {})[k] ?? 0); if (d) out[k] = d; }
  const st: Record<string, number> = {};
  for (const [k, v] of Object.entries(b.s ?? {})) { const d = (v as number) - ((a.s ?? {})[k] ?? 0); if (d) st[k] = d; }
  return { byPath: out, total: Object.values(out).reduce((s, x) => s + x, 0), byStatus: st, notFound: (b.nf ?? []).slice((a.nf ?? []).length) };
}
