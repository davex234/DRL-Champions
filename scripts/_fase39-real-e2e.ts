/**
 * FASE 39 · E2E REAL DE DRAFT GAUNTLET (instrumento `_`, fuera de CI).
 *
 *   npx tsx scripts/_fase39-real-e2e.ts <credsFile> <fingerprintSqlFile>
 *
 * Chrome → app local (`next start` :3005) → `/api/game/draft-gauntlet` y `/api/game/duel` → servicios → PostgreSQL del
 * VPS (túnel SSH), con la cuenta QA existente y el formulario real de /cuenta. Recorre: /jugar → Draft Gauntlet →
 * empezar (doble clic) → 10 elecciones reales (teclado y ratón; recarga a mitad; doble confirmación; 409 por versión
 * vieja vía API) → plantilla completa → combate 01 en la arena canónica (turnos por la interfaz; si un selector no
 * aparece, la MISMA ruta `/api/game/duel`) → resultado → evidencia en BD (elecciones, mazos exactos, turnos,
 * liquidación) → huella económica idéntica. No abandona la run.
 *
 * La BD se lee por SSH (solo lectura). Nunca imprime correo, contraseña, tokens ni el id completo.
 * Capturas en docs/product/qa/fase39/real/.
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { launch, sleep, type Tab } from "./lib/cdp";

for (const f of [".env.local"]) {
  const p = join(process.cwd(), f);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3005";
const OUT = join(process.cwd(), "docs", "product", "qa", "fase39", "real");
mkdirSync(OUT, { recursive: true });
const [credsFile, fingerprintFile] = process.argv.slice(2);
const creds = JSON.parse(readFileSync(credsFile, "utf8")) as { email: string; password: string; userId: string };
if (!/^[0-9a-f-]{36}$/.test(creds.userId)) throw new Error("userId QA no válido");
const U = creds.userId;
const PROFILE = join(credsFile, "..", "f39-chrome-profile");
const log = (s: string) => console.log(s);
const esc = (s: string) => JSON.stringify(s);
let failures = 0;
const evidence: Record<string, unknown> = {};
const check = (label: string, cond: boolean, detail = "") => { if (!cond) failures++; log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`); };
let shotN = 0;
const shot = async (tab: Tab, name: string) => { await tab.shot(join(OUT, `real-${String(++shotN).padStart(2, "0")}-${name}.png`)); };

function psql(sql: string): string {
  return execFileSync("ssh", ["-i", join(homedir(), ".ssh", "id_ed25519"), "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", "nexusadmin@212.95.40.144",
    "docker exec -i supabase_db_DRLCards psql -U postgres -d postgres -At -F ' | ' -v ON_ERROR_STOP=1"], { input: sql, encoding: "utf8" }).trim();
}
const fingerprint = (): Record<string, string> => Object.fromEntries(psql(readFileSync(fingerprintFile, "utf8")).split("\n").map((l) => { const [k, ...v] = l.split(" | "); return [k, v.join(" | ")]; }));
const activeRun = () => {
  const out = psql(`select id, version, status, stage, coalesce(current_match_id::text, ''), state::text from public.draft_runs where user_id = '${U}' and status in ('DRAFTING','READY','IN_MATCH') limit 1;`);
  if (!out) return null;
  const [id, version, status, stage, match, ...state] = out.split(" | ");
  return { id, version: Number(version), status, stage: Number(stage), matchId: match || null, state: JSON.parse(state.join(" | ")) as { picks: string[]; offers: string[][]; rivals: { cardIds: string[]; name: string; difficulty: string }[] | null } };
};

async function apiToken(): Promise<string> {
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const { data, error } = await anon.auth.signInWithPassword({ email: creds.email, password: creds.password });
  if (error || !data.session) throw new Error("login QA falló");
  return data.session.access_token;
}
async function call(path: string, token: string | null, body?: unknown) {
  const r = await fetch(`${BASE}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* sin JSON */ }
  return { status: r.status, json };
}

const waitFor = async (tab: Tab, expr: string, ms = 20000) => {
  for (let i = 0; i < ms / 200; i++) { if (await tab.js<boolean>(expr)) return true; await sleep(200); }
  return false;
};
const key = async (tab: Tab, k: string) => {
  const code = /^\d$/.test(k) ? `Digit${k}` : k;
  const vk = k === "Enter" ? 13 : k === "Escape" ? 27 : k.charCodeAt(0);
  await tab.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: k, code, windowsVirtualKeyCode: vk });
  await tab.send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk });
};

async function login(tab: Tab) {
  await tab.goto(`${BASE}/cuenta`, 3500);
  const signedIn = `(() => !document.querySelector('input[type="password"]') && /cerrar sesión|salir/i.test(document.body.innerText))()`;
  if (!(await tab.js<boolean>(signedIn))) {
    await tab.js<boolean>(`(() => {
      const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
      const e = document.querySelector('input[type="email"]'); const p = document.querySelector('input[type="password"]');
      if (!e || !p) return false; set(e, ${esc(creds.email)}); set(p, ${esc(creds.password)}); return true; })()`);
    await tab.js(`document.querySelector('form button[type="submit"]')?.click()`);
    await waitFor(tab, signedIn, 20000);
  }
  return tab.js<boolean>(signedIn);
}

const OFFER = `[...document.querySelectorAll('[data-testid="draft-option"]')].map((e) => e.getAttribute('data-card-id'))`;
const PICK_ATTR = `(document.querySelector('[data-testid="draft-room"]')?.getAttribute('data-pick') ?? null)`;

async function playTurnApi(token: string, matchId: string): Promise<boolean> {
  const st = await call("/api/game/duel", token, { action: "state", matchId });
  const v = st.json?.view;
  if (!v || v.status !== "IN_PROGRESS") return false;
  const card = v.yourHand?.[0];
  if (!card) return false;
  const body: any = { action: "play", matchId, cardUid: card.uid };
  if (v.youAreAttacker) {
    const stats = ["stronghold", "gamesense", "entryfrag"];
    body.stat = stats.reduce((a, b) => (card.combat[b] > card.combat[a] ? b : a), stats[0]);
  }
  const r = await call("/api/game/duel", token, body);
  return r.status === 200;
}

async function main() {
  const token = await apiToken();
  const pre = fingerprint();
  log(`pre ${JSON.stringify({ cards: pre.user_cards?.split(":")[0], credit_tx: pre.credit_tx, achievements: pre.achievements, campaign: pre.campaign?.split(":").slice(0, 2).join(":"), pve: pre.pve_matches, favorites: pre.favorites })}`);
  const existing = activeRun();
  log(`run activa previa: ${existing ? `${existing.status} v${existing.version}` : "ninguna"}`);

  // Seguridad de la ruta sin mutar nada.
  check("GET sin sesión → 401", (await call("/api/game/draft-gauntlet", null)).status === 401);
  check("POST con campo de autoridad (seed) → 400", (await call("/api/game/draft-gauntlet", token, { action: "start", actionId: randomUUID(), seed: 1 })).status === 400);
  check("POST abandon sin confirmación → 400", (await call("/api/game/draft-gauntlet", token, { action: "abandon", actionId: randomUUID(), expectedVersion: 1 })).status === 400);

  const b = await launch({ width: 1440, height: 900, userDataDir: PROFILE });
  const tab = b.tab;
  const chosen: string[] = [];
  try {
    check("login por el formulario real", await login(tab));

    // ── A · hub de modos
    await tab.goto(`${BASE}/jugar`, 4000);
    check("hub: tarjeta DRAFT GAUNTLET", await waitFor(tab, `!!document.querySelector('[data-mode="DRAFT_GAUNTLET"]')`, 15000));
    const hubText = await tab.js<string>(`document.querySelector('[data-mode="DRAFT_GAUNTLET"]')?.innerText ?? ""`);
    check("hub: línea del modo", /Construye una plantilla carta a carta y supera cinco rivales/i.test(hubText));
    await shot(tab, "hub-jugar");

    // ── B · portada
    await tab.js(`document.querySelector('[data-testid="mode-cta-DRAFT_GAUNTLET"]')?.click()`);
    check("navega a /jugar/draft-gauntlet", await waitFor(tab, `location.pathname === "/jugar/draft-gauntlet" && !!document.querySelector('[data-testid="draft-screen"]') && !document.querySelector('[data-testid="draft-loading"]')`, 20000));
    await sleep(800);
    await shot(tab, "draft-landing");

    // ── C · empezar (doble clic: una sola run)
    if (!existing) {
      await tab.js(`(() => { const b = document.querySelector('[data-testid="draft-start"]'); b?.click(); b?.click(); })()`);
      check("empezar run → sala de draft", await waitFor(tab, `!!document.querySelector('[data-testid="draft-room"]')`, 20000));
      const count = Number(psql(`select count(*) from public.draft_runs where user_id = '${U}' and status in ('DRAFTING','READY','IN_MATCH');`));
      check("doble clic en EMPEZAR: exactamente 1 run activa", count === 1, String(count));
    }
    let run = activeRun();
    check("BD: run DRAFTING con reglas draft-gauntlet-1", !!run && (existing ? true : run.status === "DRAFTING" && run.version === 1));
    evidence.runId = run?.id.slice(0, 8);
    await sleep(700);
    await shot(tab, "draft-pick-1");

    // ── D · 10 elecciones
    for (let i = run ? run.state.picks.length : 0; i < 10; i++) {
      run = activeRun()!;
      if (run.status !== "DRAFTING") break;
      await waitFor(tab, `!!document.querySelector('[data-testid="draft-room"]') && ${PICK_ATTR} === "${i}"`, 15000);
      let offer = await tab.js<string[]>(OFFER);
      check(`pick ${i + 1}: la oferta en pantalla = la oferta persistida`, JSON.stringify(offer) === JSON.stringify(run.state.offers[i]));

      if (i === 1) {
        await tab.goto(`${BASE}/jugar/draft-gauntlet`, 3500);
        await waitFor(tab, `!!document.querySelector('[data-testid="draft-room"]')`, 15000);
        const again = await tab.js<string[]>(OFFER);
        const after = activeRun()!;
        check("recarga durante el draft: MISMAS opciones y misma versión", JSON.stringify(again) === JSON.stringify(offer) && after.version === run.version);
        await shot(tab, "draft-after-refresh");
        offer = again;
      }

      if (i === 3) {
        const stale = await call("/api/game/draft-gauntlet", token, { action: "pick", actionId: randomUUID(), expectedVersion: run.version - 1, choiceId: offer[0] });
        check("versión vieja vía API → 409 STALE_VERSION con foto", stale.status === 409 && stale.json?.code === "STALE_VERSION" && !!stale.json?.snapshot);
        check("409: la BD no cambió", activeRun()!.version === run.version);
        const alien = await call("/api/game/draft-gauntlet", token, { action: "pick", actionId: randomUUID(), expectedVersion: run.version, choiceId: "nadie__gold" });
        check("carta fuera de la oferta → 409 INVALID_PICK", alien.status === 409 && alien.json?.code === "INVALID_PICK");
      }

      const idx = i % 3;
      const useKeyboard = i % 2 === 0;
      if (useKeyboard) await key(tab, String(idx + 1));
      else await tab.js(`document.querySelectorAll('[data-testid="draft-option"] button')[${idx}]?.click()`);
      check(`pick ${i + 1}: vista previa abierta (${useKeyboard ? "teclado" : "ratón"})`, await waitFor(tab, `!!document.querySelector('[data-testid="draft-preview"]')`, 5000));
      check(`pick ${i + 1}: sin confirmar todavía`, activeRun()!.version === run.version);
      if (i === 0 || i === 4 || i === 9) { await sleep(500); await shot(tab, `draft-preview-pick-${i + 1}`); }

      if (i === 2) {
        await tab.js(`(() => { const b = document.querySelector('[data-testid="draft-confirm"]'); b?.click(); b?.click(); b?.click(); })()`);
      } else if (useKeyboard) {
        await key(tab, "Enter");
      } else {
        await tab.js(`document.querySelector('[data-testid="draft-confirm"]')?.click()`);
      }
      chosen.push(offer[idx]);
      for (let w = 0; w < 50; w++) { const r = activeRun(); if (r && r.version > run.version) break; await sleep(300); }
      const after = activeRun()!;
      check(`pick ${i + 1}: +1 versión y +1 carta exacta`, after.version === run.version + 1 && after.state.picks.length === i + 1 && after.state.picks[i] === offer[idx], `v${run.version}→v${after.version}`);
      if (i === 2) {
        await sleep(1500);
        const later = activeRun()!;
        check("doble/triple confirmación: una sola elección", later.version === run.version + 1 && later.state.picks.length === 3);
      }
    }

    run = activeRun()!;
    check("10 elecciones → READY en la etapa 1", run.status === "READY" && run.stage === 1 && run.state.picks.length === 10);
    check("elecciones en BD = elecciones hechas en la interfaz", JSON.stringify(run.state.picks) === JSON.stringify(chosen), `${chosen.length} cartas`);
    check("rivales fijados en servidor (5)", run.state.rivals?.length === 5);
    evidence.picks = run.state.picks;
    await tab.goto(`${BASE}/jugar/draft-gauntlet`, 3000);
    check("PLANTILLA COMPLETA en pantalla", await waitFor(tab, `!!document.querySelector('[data-testid="draft-complete"]')`, 15000));
    await sleep(700);
    await shot(tab, "draft-complete-map");
    const mid = fingerprint();
    check("user_cards sin cambios tras el draft (las cartas del draft no se conceden)", mid.user_cards === pre.user_cards, mid.user_cards?.split(":")[0]);

    // ── E · combate 01 en la arena canónica
    const vBefore = run.version;
    await tab.js(`document.querySelector('[data-testid="draft-start-match"]')?.click()`);
    check("start_match → arena en contexto de draft", await waitFor(tab, `location.pathname === "/duelos/jugar" && location.search.includes("draft=1")`, 20000));
    await sleep(2500);
    await shot(tab, "arena-intro");
    run = activeRun()!;
    check("BD: run IN_MATCH con combate enlazado", run.status === "IN_MATCH" && !!run.matchId);
    const matchId = run.matchId!;
    const again = await call("/api/game/draft-gauntlet", token, { action: "start_match", actionId: randomUUID(), expectedVersion: vBefore });
    check("start_match repetido devuelve el MISMO combate", again.status === 200 && again.json?.matchId === matchId);
    check("BD: un solo combate de draft", Number(psql(`select count(*) from public.duel_matches where user_id = '${U}' and mode = 'DRAFT_GAUNTLET';`)) === 1);

    const rowOut = psql(`select mode, coalesce(deck_id::text,'null'), coalesce(player_b_id::text,'null'), difficulty, rules_version, state->>'orchestratorVersion', (select string_agg(c->>'cardId', ',' order by ord) from jsonb_array_elements(state->'snapshotA'->'cards') with ordinality as t(c, ord)), (select string_agg(c->>'cardId', ',' order by ord) from jsonb_array_elements(state->'snapshotB'->'cards') with ordinality as t(c, ord)), (select count(*) from jsonb_array_elements(state->'snapshotA'->'cards') c where c->>'serial' is not null and c->>'serial' <> 'null') from public.duel_matches where id = '${matchId}';`);
    const [mode, deckId, playerB, difficulty, rules, orchestrator, cardsA, cardsB, serials] = rowOut.split(" | ");
    check("partida: mode DRAFT_GAUNTLET, sin equipo guardado ni jugador B", mode === "DRAFT_GAUNTLET" && deckId === "null" && playerB === "null");
    check("partida: dificultad del combate 01 (EASY)", difficulty === "EASY");
    check("partida: reglas canónicas duel-combat-2 / duel-turns-2", rules === "duel-combat-2" && orchestrator === "duel-turns-2", `${rules} / ${orchestrator}`);
    check("mazo del jugador en la partida = las 10 elecciones", [...cardsA.split(",")].sort().join(",") === [...run.state.picks].sort().join(","));
    check("mazo del rival en la partida = rival fijado de la etapa 1", [...cardsB.split(",")].sort().join(",") === [...run.state.rivals![0].cardIds].sort().join(","));
    check("sin seriales en la plantilla temporal", Number(serials) === 0);

    // Intro → tablero
    await tab.js(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Saltar')?.click()`);
    await sleep(1500);
    await shot(tab, "arena-match-start");
    let uiTurns = 0; let apiTurns = 0;
    for (let step = 0; step < 60; step++) {
      const status = psql(`select status from public.duel_matches where id = '${matchId}';`);
      if (status !== "IN_PROGRESS") break;
      const played = await tab.js<boolean>(`(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const btns = () => [...document.querySelectorAll('button')];
        const cont = btns().find((b) => b.textContent.trim() === 'Continuar'); if (cont) { cont.click(); await sleep(450); }
        const confirm = () => btns().find((b) => /^(Elige una carta|Elige una estadística|Declarar y atacar|Responder)$/.test(b.textContent.trim()));
        if (!confirm()) return false;
        const cards = btns().filter((b) => /OVR \\d+/.test(b.getAttribute('aria-label') || '') && !b.disabled);
        if (!cards.length) return false;
        cards[0].click(); await sleep(300);
        const stats = btns().filter((b) => b.hasAttribute('aria-pressed') && /^(SH|GS|EF)/.test(b.textContent.trim()));
        if (stats.length === 3) { stats[0].click(); await sleep(250); }
        const c = confirm(); if (!c || c.disabled) return false;
        c.click(); await sleep(1600);
        return true;
      })()`);
      if (played) { uiTurns++; if (uiTurns === 3) await shot(tab, "arena-turn"); continue; }
      await sleep(900);
      const retry = await tab.js<boolean>(`!![...document.querySelectorAll('button')].find((b) => /^(Elige una carta|Declarar y atacar|Responder|Continuar)$/.test(b.textContent.trim()))`);
      if (!retry) { if (await playTurnApi(token, matchId)) { apiTurns++; await tab.goto(`${BASE}/duelos/jugar?draft=1`, 3000); } }
    }
    log(`  · turnos por la interfaz: ${uiTurns} · por la misma ruta API: ${apiTurns}`);
    await tab.js(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Continuar')?.click()`);
    await sleep(2500);
    const finalStatus = psql(`select status from public.duel_matches where id = '${matchId}';`);
    check("el combate terminó con el motor", finalStatus !== "IN_PROGRESS", finalStatus);
    await waitFor(tab, `!!document.querySelector('[data-testid="draft-result"]') && document.querySelector('[data-testid="draft-result"]').getAttribute('data-tone') !== 'pending'`, 15000);
    await sleep(800);
    await shot(tab, "arena-result");

    // ── F · liquidación desde la partida persistida
    const res = psql(`select state->'result'->>'winner', state->'result'->>'isDraw', state->'result'->>'scoreA', state->'result'->>'scoreB', jsonb_array_length(state->'turns') from public.duel_matches where id = '${matchId}';`).split(" | ");
    const [winner, isDraw, scoreA, scoreB, turns] = res;
    const expected = isDraw === "true" || winner === "" ? "DRAW" : winner === "A" ? "WIN" : "LOSS";
    check("10 turnos persistidos", Number(turns) === 10, turns);
    const stageRow = psql(`select status, result, score_you, score_rival, coalesce(match_id::text,'') from public.draft_run_matches where run_id = '${evidence.runId ? run.id : ""}' and stage = 1;`).split(" | ");
    check("combate 01 liquidado con el resultado del motor", stageRow[0] === "SETTLED" && stageRow[1] === expected && stageRow[2] === scoreA && stageRow[3] === scoreB && stageRow[4] === matchId, `${expected} ${scoreA}-${scoreB}`);
    const runAfter = psql(`select status, stage, coalesce(current_match_id::text,''), completed_at is not null from public.draft_runs where id = '${run.id}';`).split(" | ");
    if (expected === "WIN") check("victoria → run READY en la etapa 2", runAfter[0] === "READY" && runAfter[1] === "2" && runAfter[2] === "");
    else check(`${expected} → run FAILED con cierre`, runAfter[0] === "FAILED" && runAfter[3] === "t");
    evidence.result = { expected, scoreA, scoreB, uiTurns, apiTurns, runStatus: runAfter[0] };

    await tab.goto(`${BASE}/jugar/draft-gauntlet`, 3500);
    await sleep(1200);
    await shot(tab, expected === "WIN" ? "map-after-win" : "summary-after-run");
    const nodeStates = await tab.js<string[]>(`[...document.querySelectorAll('[data-testid="gauntlet-node"]')].map((n) => n.getAttribute('data-state'))`);
    check("mapa tras el combate refleja la BD", expected === "WIN" ? nodeStates[0] === "WON" && nodeStates[1] === "CURRENT" : nodeStates[0] === (expected === "LOSS" ? "LOST" : "DRAW"), nodeStates.join(","));

    for (const [w, h, name] of [[390, 844, "mobile"], [1024, 800, "tablet"]] as const) {
      await tab.resize(w, h);
      await tab.goto(`${BASE}/jugar/draft-gauntlet`, 3000);
      await sleep(900);
      await shot(tab, `draft-${name}`);
    }
    await tab.resize(1440, 900);

    // ── G · huella económica
    const post = fingerprint();
    for (const k of Object.keys(pre)) check(`huella ${k} idéntica`, post[k] === pre[k]);
  } finally {
    await b.close();
  }
  writeFileSync(join(OUT, "evidence.json"), JSON.stringify(evidence, null, 2));
  log(`\n${failures === 0 ? "✓" : "✗"} E2E real Draft Gauntlet — ${failures} fallos`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
