/**
 * FASE 61 · E2E REAL contra la app local (:3005) → túnel → BD del VPS, SOLO con cuentas QA (instrumento `_`, fuera de CI).
 *
 *   npx tsx scripts/_fase61-live.ts probe                     lectura: mazos, partida activa, rating, créditos (A y B)
 *   npx tsx scripts/_fase61-live.ts pve                       A en Chrome: JUGAR → entrada → turnos → F5 → doble clic →
 *                                                             Atrás → final → recarga del resultado → Jugar otra → Abandonar
 *   npx tsx scripts/_fase61-live.ts pvp                       A en Chrome (ranked) contra B por API: cola → rival encontrado →
 *                                                             equipo → turnos → final; compara lo que ve A con lo que ve B
 *
 * Credenciales: ficheros del scratchpad de sesiones anteriores (NUNCA en el repo). A = QA-1ff2c0ef, B = QA-8c326e52.
 * Evidencia: `docs/product/qa/fase61-match/live/*.json` + capturas en `screenshots/live/`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
const CREDS = {
  A: join(TMP, "claude/C--NEXUS-CENTRAL-DRLCards/287155d6-0740-47dd-baa7-edb43491b4e3/scratchpad/f45-qa-creds.json"),
  B: join(TMP, "claude/C--NEXUS-CENTRAL-DRLCards/738eeaef-6ef7-4f65-abd1-2ca435caa596/scratchpad/qa352-creds.json"),
};
const OUT = join(process.cwd(), "docs/product/qa/fase61-match/live");
const SHOTS = join(process.cwd(), "docs/product/qa/fase61-match/screenshots/live");
mkdirSync(OUT, { recursive: true });
mkdirSync(SHOTS, { recursive: true });
const PROFILE = join(TMP, "claude/C--NEXUS-CENTRAL-DRLCards/a346e3be-edd2-4788-bcfb-c41bedb10579/scratchpad/f61-chrome-A");

type Who = "A" | "B";
const creds = (w: Who) => JSON.parse(readFileSync(CREDS[w], "utf8")) as { email: string; password: string; userId: string };
const log = (s: string) => console.log(s);
const esc = (s: string) => JSON.stringify(s);

async function token(w: Who): Promise<string> {
  const c = creds(w);
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const { data, error } = await anon.auth.signInWithPassword({ email: c.email, password: c.password });
  if (error || !data.session) throw new Error(`login QA ${w} falló: ${error?.message}`);
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

async function probe() {
  const out: Record<string, unknown> = {};
  for (const w of ["A", "B"] as Who[]) {
    const t = await token(w);
    const decks = await api(t, "/api/game/duels");
    const active = await api(t, "/api/game/duel", { action: "active" });
    const state = await api(t, "/api/game/state");
    const pos = await api(t, "/api/game/competitive?position=1");
    const q = await api(t, "/api/game/duel/matchmaking");
    out[w] = {
      userId: creds(w).userId,
      decks: (decks.json.decks ?? []).map((d: any) => ({ id: d.id, name: d.name, valid: d.valid, sumOvr: d.sumOvr })),
      activeDeckId: decks.json.activeDeckId ?? null,
      activeMatch: active.json.view ? { id: active.json.view.matchId, status: active.json.view.status, turn: active.json.view.turn } : null,
      credits: state.json.credits ?? null, xp: state.json.xp ?? null,
      position: pos.json, queue: q.json,
    };
  }
  writeFileSync(join(OUT, "probe.json"), JSON.stringify({ at: new Date().toISOString(), ...out }, null, 2));
  log(JSON.stringify(out, null, 2).slice(0, 4000));
}

/* ───────────── navegador ───────────── */

const waitFor = async (tab: Tab, expr: string, ms = 20000) => {
  for (let i = 0; i < ms / 200; i++) { if (await tab.js<boolean>(expr).catch(() => false)) return true; await sleep(200); }
  return false;
};
const clickText = (tab: Tab, re: string) => tab.js<boolean>(`(() => { const b = [...document.querySelectorAll('button, a')].find(x => new RegExp(${esc(re)}, 'i').test((x.textContent||'').trim()) && !x.disabled); if (!b) return false; b.click(); return true; })()`);

async function login(tab: Tab, w: Who) {
  const c = creds(w);
  await tab.goto(`${BASE}/cuenta`, 3000);
  const needs = await tab.js<boolean>(`!!document.querySelector('input[type="password"]')`);
  if (needs) {
    await tab.js(`(() => {
      const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
      set(document.querySelector('input[type="email"]'), ${esc(c.email)}); set(document.querySelector('input[type="password"]'), ${esc(c.password)});
      document.querySelector('form button[type="submit"]').click(); })()`);
    await waitFor(tab, `!document.querySelector('input[type="password"]')`, 20000);
  }
  log(`login ${w}: formulario=${needs} sesión=${!(await tab.js<boolean>(`!!document.querySelector('input[type="password"]')`))}`);
}

/** Lee la mesa: turno, marcador, rol, fase y overlays presentes. */
const MESA = `(() => {
  const q = (s) => document.querySelector(s);
  const scene = [...document.querySelectorAll('[data-scene]')].map((e) => e.getAttribute('data-scene'));
  return {
    scenes: scene, beat: q('[data-scene="intro"]')?.getAttribute('data-beat') ?? null,
    role: q('[data-testid="role-banner"]')?.getAttribute('data-role') ?? q('[data-hud="turno"]')?.getAttribute('data-role') ?? null,
    turn: q('[data-testid="turn-label"]')?.textContent?.trim() ?? null,
    moment: q('[data-f61="moment"]') ? { outcome: q('[data-f61="moment"]').getAttribute('data-outcome'), climax: q('[data-f61="moment"]').getAttribute('data-climax'), axis: q('[data-testid="moment-axis"]')?.textContent?.trim() ?? null } : null,
    tiebreak: q('[data-scene="tiebreak"]')?.getAttribute('data-decided') ?? null,
    complete: q('[data-scene="match-complete"]')?.getAttribute('data-verdict') ?? null,
    result: q('[data-scene="result"]')?.getAttribute('data-kind') ?? null,
    recovered: /Partida recuperada desde el servidor/.test(document.body.innerText),
    leave: !!q('[data-testid="leave-dialog"]'),
    hand: document.querySelectorAll('[aria-label="Tu mano"] button').length,
  };
})()`;

async function shot(tab: Tab, name: string) { await tab.shot(join(SHOTS, `${name}.png`)); }

/** Juega UN turno por la interfaz: elige la primera carta disponible y, si atacas, el primer eje; confirma. */
async function playOne(tab: Tab, dbl = false): Promise<boolean> {
  const ok = await waitFor(tab, `(() => { const b = [...document.querySelectorAll('[aria-label="Tu mano"] button')].filter(x => !x.disabled); return b.length > 0 && !document.querySelector('[data-scene="intro"]') && !document.querySelector('[data-f61="moment"]'); })()`, 25000);
  if (!ok) return false;
  await tab.js(`[...document.querySelectorAll('[aria-label="Tu mano"] button')].filter(x => !x.disabled)[0].click()`);
  await sleep(250);
  // Atacando: un eje (botones SH/GS/EF sin aria-label, texto exacto).
  await tab.js(`(() => { const s = [...document.querySelectorAll('button')].find(b => /^(SH|GS|EF)\\s*\\d/.test((b.textContent||'').trim()) && !b.disabled); if (s) s.click(); return !!s; })()`);
  await sleep(250);
  const click = `(() => { const b = [...document.querySelectorAll('button')].find(x => /^(Declarar y atacar|Responder)$/i.test((x.textContent||'').trim()) && !x.disabled); if (!b) return false; b.click(); return true; })()`;
  const a = await tab.js<boolean>(click);
  if (dbl) await tab.js(`(() => { const b = [...document.querySelectorAll('button')].find(x => /^(Declarar y atacar|Responder|Resolviendo…|Enviando…)$/i.test((x.textContent||'').trim())); if (b) { b.click(); b.click(); } return !!b; })()`);
  return a;
}

async function pve() {
  const ev: Record<string, unknown> = { at: new Date().toISOString(), account: creds("A").userId };
  const t = await token("A");
  const before = await api(t, "/api/game/state");
  ev.before = { credits: before.json.credits, xp: before.json.xp };
  const pre = await api(t, "/api/game/duel", { action: "active" });
  if (pre.json.view) { ev.preexisting = pre.json.view.matchId; await api(t, "/api/game/duel", { action: "abandon", matchId: pre.json.view.matchId }); }

  const b = await launch({ userDataDir: PROFILE, args: ["--mute-audio", "--in-process-gpu"] });
  const tab = b.tab;
  try {
    await tab.resize(1440, 900, 1);
    await tab.setMedia([{ name: "prefers-reduced-motion", value: process.argv.includes("--reduced") ? "reduce" : "no-preference" }]);
    await login(tab, "A");

    // JUGAR (lobby) → la arena.
    await tab.goto(`${BASE}/duelos/jugar`, 2500);
    await waitFor(tab, `/Comenzar duelo/i.test(document.body.innerText)`, 30000);
    await shot(tab, "pve-01-prematch");
    await clickText(tab, "^Comenzar duelo$");
    const beats: string[] = [];
    for (let i = 0; i < 40; i++) {
      const m = await tab.js<any>(MESA);
      if (m.beat && beats[beats.length - 1] !== m.beat) { beats.push(m.beat); await shot(tab, `pve-02-intro-${m.beat.toLowerCase()}`); }
      if (!m.beat && beats.length && m.role) break;
      await sleep(150);
    }
    ev.introBeats = beats;
    await sleep(600);
    await shot(tab, "pve-03-field");
    const turns: unknown[] = [];

    // Turno 1 con DOBLE CLIC en confirmar: debe avanzar UN turno.
    const t0 = (await api(t, "/api/game/duel", { action: "active" })).json.view;
    await playOne(tab, true);
    await waitFor(tab, `!!document.querySelector('[data-f61="moment"]')`, 15000);
    await sleep(700);
    const m1 = await tab.js<any>(MESA);
    await shot(tab, "pve-04-stat-reveal");
    await sleep(1600);
    await shot(tab, "pve-05-turn-result");
    const t1 = (await api(t, "/api/game/duel", { action: "active" })).json.view;
    ev.doubleClick = { historyBefore: t0?.history?.length ?? null, historyAfter: t1?.history?.length ?? null, turnAfter: t1?.turn ?? null };
    turns.push(m1);
    await tab.js(`document.querySelector('[data-f61="moment"]')?.click()`);

    // Turnos 2–4.
    for (let k = 2; k <= 4; k++) {
      await playOne(tab);
      await waitFor(tab, `!!document.querySelector('[data-f61="moment"]')`, 15000);
      await sleep(1800);
      turns.push(await tab.js<any>(MESA));
      await tab.js(`document.querySelector('[data-f61="moment"]')?.click()`);
    }

    // F5 A MITAD DE PARTIDA: la mesa vuelve con el mismo turno y marcador, sin intro.
    const srvMid = (await api(t, "/api/game/duel", { action: "active" })).json.view;
    await tab.goto(await tab.js<string>(`location.href`), 2500); // F5: la MISMA URL
    await waitFor(tab, `!!document.querySelector('[data-hud="turno"]') || /Partida recuperada/.test(document.body.innerText)`, 30000);
    await sleep(800);
    const afterF5 = await tab.js<any>(MESA);
    await shot(tab, "pve-06-f5-recovered");
    ev.refreshMid = { server: { turn: srvMid.turn, score: [srvMid.scoreYou, srvMid.scoreRival], history: srvMid.history.length }, screen: afterF5 };

    // ATRÁS: abre el diálogo; «Seguir jugando» vuelve a la mesa.
    await tab.js(`history.back()`);
    await sleep(900);
    const back = await tab.js<any>(MESA);
    await shot(tab, "pve-07-back-dialog");
    await clickText(tab, "^Seguir jugando$");
    await sleep(500);
    ev.backButton = { dialog: back.leave, url: await tab.js<string>(`location.pathname`), stillInMatch: !!(await tab.js<boolean>(`!!document.querySelector('[data-hud="turno"]')`)) };

    // Hasta el final.
    let guard = 0;
    while (guard++ < 12) {
      const v = (await api(t, "/api/game/duel", { action: "active" })).json.view;
      if (!v || v.status !== "IN_PROGRESS") break;
      await playOne(tab);
      await waitFor(tab, `!!document.querySelector('[data-f61="moment"]')`, 15000);
      const late = await tab.js<any>(MESA);
      if (late.moment?.climax && late.moment.climax !== "NORMAL") await shot(tab, `pve-08-climax-${late.moment.climax.toLowerCase()}`);
      await sleep(1500);
      turns.push(late);
      await tab.js(`document.querySelector('[data-f61="moment"]')?.click()`);
    }
    ev.turns = turns;
    const endSeen: string[] = [];
    for (let i = 0; i < 40; i++) {
      const m = await tab.js<any>(MESA);
      const tag = m.tiebreak ? `tiebreak:${m.tiebreak}` : m.complete ? `complete:${m.complete}` : m.result ? `result:${m.result}` : null;
      if (tag && endSeen[endSeen.length - 1] !== tag) { endSeen.push(tag); await shot(tab, `pve-09-end-${tag.replace(":", "-").toLowerCase()}`); }
      if (m.result && !m.complete && !m.tiebreak) break;
      await sleep(250);
    }
    ev.endSequence = endSeen;
    await sleep(1500);
    await shot(tab, "pve-10-result");
    const replay = await api(t, "/api/game/duels?replays=1");
    const last = (replay.json.matches ?? replay.json.replays ?? [])[0] ?? null;
    ev.lastMatch = last;

    // RECARGA SOBRE EL RESULTADO: resultado directo, sin golpe final ni desempate; créditos iguales.
    const mid = await api(t, "/api/game/state");
    const urlAtResult = await tab.js<string>(`location.href`);
    await tab.goto(urlAtResult, 3000); // F5: la MISMA URL
    await waitFor(tab, `!!document.querySelector('[data-scene="result"]') || /Comenzar duelo/i.test(document.body.innerText)`, 20000);
    await sleep(1500);
    const reload = await tab.js<any>(MESA);
    await shot(tab, "pve-11-result-reload");
    const after = await api(t, "/api/game/state");
    ev.resultReload = { url: urlAtResult.replace(BASE, ""), screen: reload, creditsAfterFinish: mid.json.credits, creditsAfterReload: after.json.credits };
    ev.after = { credits: after.json.credits, xp: after.json.xp };

    // JUGAR OTRA → partida nueva con entrada → Salir → diálogo → Abandonar (descarta: no cuenta ni paga).
    const again = await clickText(tab, "Jugar otra");
    await waitFor(tab, `!!document.querySelector('[data-scene="intro"]') || !!document.querySelector('[data-hud="turno"]')`, 20000);
    const againView = (await api(t, "/api/game/duel", { action: "active" })).json.view;
    await sleep(3800);
    await clickText(tab, "^Salir$");
    await sleep(500);
    await shot(tab, "pve-12-leave-dialog");
    const dialog = await tab.js<any>(MESA);
    await tab.js(`document.querySelector('[data-testid="leave-abandon"]')?.click()`);
    await waitFor(tab, `/Comenzar duelo/i.test(document.body.innerText)`, 20000);
    const gone = (await api(t, "/api/game/duel", { action: "active" })).json.view;
    const afterAbandon = await api(t, "/api/game/state");
    ev.playAgainAndAbandon = { clicked: again, newMatch: againView?.matchId ?? null, freshTurn: againView?.turn ?? null, dialog: dialog.leave, activeAfterAbandon: gone?.matchId ?? null, creditsAfterAbandon: afterAbandon.json.credits };
    ev.consoleErrors = tab.takeErrors();
  } finally {
    await b.close();
  }
  writeFileSync(join(OUT, "pve.json"), JSON.stringify(ev, null, 2));
  log(JSON.stringify(ev, null, 2).slice(0, 6000));
}

/* ───────────── PvP con dos cuentas ───────────── */

async function pvpFetch(t: string, matchId: string) { return api(t, `/api/game/duel/pvp?matchId=${matchId}`); }

/** B juega por API: si le toca, primera carta no usada (y eje si ataca), con actionId y la versión que ve. */
async function botMove(t: string, matchId: string): Promise<string> {
  const r = await pvpFetch(t, matchId);
  const s = r.json.snapshot;
  if (!s || !s.isYourTurn) return "not-your-turn";
  const side = s.yourSide as "A" | "B";
  const m = s.match;
  const mine = side === "A" ? m.snapshotA : m.snapshotB;
  const used = new Set<string>(side === "A" ? m.usedA : m.usedB);
  const card = (mine?.cards ?? []).find((c: any) => !used.has(c.uid));
  const body: any = { action: "play", matchId, actionId: crypto.randomUUID(), expectedVersion: s.stateVersion, cardUid: card?.uid };
  if (m.attacker === side) body.stat = "gamesense";
  const res = await api(t, "/api/game/duel/pvp", body);
  return `${res.status}${res.json.error ? ` ${res.json.error}` : ""}`;
}

async function pvp() {
  const ev: Record<string, unknown> = { at: new Date().toISOString(), A: creds("A").userId, B: creds("B").userId };
  const tA = await token("A");
  const tB = await token("B");
  const decksA = (await api(tA, "/api/game/duels")).json;
  const decksB = (await api(tB, "/api/game/duels")).json;
  const dA = decksA.decks.find((d: any) => d.valid);
  const dB = decksB.decks.find((d: any) => d.valid);
  ev.decks = { A: dA?.name ?? null, B: dB?.name ?? null };
  if (!dA || !dB) throw new Error("falta un mazo legal");
  const posA0 = (await api(tA, "/api/game/competitive?position=1")).json;
  const posB0 = (await api(tB, "/api/game/competitive?position=1")).json;
  ev.ratingBefore = { A: posA0, B: posB0 };

  const b = await launch({ userDataDir: PROFILE, args: ["--mute-audio", "--in-process-gpu"] });
  const tab = b.tab;
  try {
    await tab.resize(1440, 900, 1);
    await tab.setMedia([{ name: "prefers-reduced-motion", value: "no-preference" }]);
    await login(tab, "A");
    // A entra en cola desde JUGAR COMPETITIVO (`?buscar=`); B se encola por API.
    await tab.goto(`${BASE}/duelos/pvp?buscar=${dA.id}`, 3000);
    await waitFor(tab, `/Buscando|en cola|Rival encontrado/i.test(document.body.innerText)`, 20000);
    await shot(tab, "pvp-01-search");
    const qB = await api(tB, "/api/game/duel/matchmaking", { action: "enqueue", deckId: dB.id });
    ev.enqueueB = { status: qB.status, state: qB.json?.entry?.state ?? qB.json?.state ?? null };
    const found = await waitFor(tab, `!!document.querySelector('[data-testid="ranked-match-found"]')`, 30000);
    ev.matchFound = found;
    if (found) { await sleep(700); await shot(tab, "pvp-02-match-found"); }
    await waitFor(tab, `!!document.querySelector('[data-scene="intro"]') || !!document.querySelector('[data-scene="pvp-arena"]')`, 20000);
    const intro = await tab.js<any>(MESA);
    ev.introFrom = intro.beat;
    if (intro.beat) await shot(tab, "pvp-03-lineup");
    const qA = await api(tA, "/api/game/duel/matchmaking");
    const matchId: string = qA.json?.entry?.matchId ?? qA.json?.matchId ?? (await tab.js<string>(`new URL(location.href).searchParams.get('match') || ''`));
    ev.matchId = matchId;

    const consistency: unknown[] = [];
    for (let i = 0; i < 60; i++) {
      const sA = (await pvpFetch(tA, matchId)).json.snapshot;
      const sB = (await pvpFetch(tB, matchId)).json.snapshot;
      if (!sA || !sB) break;
      const turnsA = sA.match.turns?.length ?? 0;
      const turnsB = sB.match.turns?.length ?? 0;
      const score = (s: any) => [s.match.scoreA, s.match.scoreB];
      consistency.push({ i, lifecycle: [sA.lifecycle, sB.lifecycle], sides: [sA.yourSide, sB.yourSide], turn: [sA.match.currentTurn, sB.match.currentTurn], turns: [turnsA, turnsB], score: [score(sA), score(sB)], yourTurn: [sA.isYourTurn, sB.isYourTurn], version: [sA.stateVersion, sB.stateVersion] });
      if (["FINISHED", "ABANDONED", "EXPIRED"].includes(sA.lifecycle)) break;
      if (sB.isYourTurn) { consistency.push({ bMove: await botMove(tB, matchId) }); await sleep(900); continue; }
      if (sA.isYourTurn) {
        await playOne(tab);
        await sleep(2600);
        const m = await tab.js<any>(MESA);
        if (m.moment && !ev.pvpMoment) { ev.pvpMoment = m.moment; await shot(tab, "pvp-04-turn-reveal"); }
        await tab.js(`document.querySelector('[data-f61="moment"]')?.click()`);
        continue;
      }
      await sleep(1200);
    }
    ev.consistency = consistency;
    const endSeen: string[] = [];
    for (let i = 0; i < 50; i++) {
      const m = await tab.js<any>(MESA);
      const tag = m.moment ? "last-turn" : m.tiebreak ? `tiebreak:${m.tiebreak}` : m.complete ? `complete:${m.complete}` : /Victoria|Derrota|Empate/i.test(await tab.js<string>(`document.body.innerText.slice(0,400)`)) ? "outcome" : null;
      if (tag && endSeen[endSeen.length - 1] !== tag) { endSeen.push(tag); await shot(tab, `pvp-05-end-${tag.replace(":", "-").toLowerCase()}`); }
      if (tag === "outcome" && !m.complete && !m.moment && !m.tiebreak) break;
      if (m.moment) await tab.js(`document.querySelector('[data-f61="moment"]')?.click()`);
      await sleep(300);
    }
    ev.endSequenceA = endSeen;
    await sleep(2500);
    await shot(tab, "pvp-06-outcome");
    const finA = (await pvpFetch(tA, matchId)).json;
    const finB = (await pvpFetch(tB, matchId)).json;
    const res = (s: any) => s?.snapshot?.match?.result ? { lifecycle: s.snapshot.lifecycle, winner: s.snapshot.match.result.winner, isDraw: s.snapshot.match.result.isDraw, decidedBy: s.snapshot.match.result.combat?.decidedBy, score: [s.snapshot.match.scoreA, s.snapshot.match.scoreB], yourSide: s.snapshot.yourSide } : { lifecycle: s?.snapshot?.lifecycle ?? null };
    ev.final = { A: res(finA), B: res(finB), ratingEventA: finA.rating ?? finA.outcome ?? null, ratingEventB: finB.rating ?? finB.outcome ?? null };
    ev.ratingAfter = { A: (await api(tA, "/api/game/competitive?position=1")).json, B: (await api(tB, "/api/game/competitive?position=1")).json };
    // Recarga sobre el resultado: A vuelve a ver el resultado y el rating NO se mueve otra vez.
    await tab.goto(`${BASE}/duelos/pvp?match=${matchId}`, 3500);
    await sleep(2500);
    await shot(tab, "pvp-07-outcome-reload");
    ev.reload = { screen: await tab.js<any>(MESA), ratingAfterReload: (await api(tA, "/api/game/competitive?position=1")).json };
    ev.consoleErrors = tab.takeErrors();
  } finally {
    await b.close();
  }
  writeFileSync(join(OUT, "pvp.json"), JSON.stringify(ev, null, 2));
  log(JSON.stringify(ev, null, 2).slice(0, 8000));
}

const phase = process.argv[2];
(phase === "probe" ? probe() : phase === "pve" ? pve() : phase === "pvp" ? pvp() : Promise.reject(new Error("fase: probe|pve|pvp")))
  .catch((e) => { console.error(e); process.exitCode = 1; });
void existsSync;
