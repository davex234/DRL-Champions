/**
 * FASE 39 · RECUPERACIÓN Y ABANDONO REALES (instrumento `_`, fuera de CI).
 *
 *   npx tsx scripts/_fase39-real-recovery.ts <credsFile> <fingerprintSqlFile>
 *
 * Continúa la run REAL que dejó `_fase39-real-e2e.ts` (READY en la etapa 2, tras ganar la 01 sin manipular nada):
 * lanza el combate 02 desde la interfaz, juega 2 turnos, RECARGA la arena (misma partida, mismos turnos), vuelve al
 * gauntlet («Retomar combate»), repite `start_match` por API (mismo combate) y ABANDONA la run con la confirmación
 * de la interfaz. Comprueba en BD: run ABANDONED con cierre, combate 02 ABANDONED sin partida, historial conservado
 * (el combate 01 sigue SETTLED/WIN) y huella económica idéntica. Capturas en docs/product/qa/fase39/real/.
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
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
const [credsFile, fingerprintFile] = process.argv.slice(2);
const creds = JSON.parse(readFileSync(credsFile, "utf8")) as { email: string; password: string; userId: string };
if (!/^[0-9a-f-]{36}$/.test(creds.userId)) throw new Error("userId QA no válido");
const U = creds.userId;
const PROFILE = join(credsFile, "..", "f39-chrome-profile");
const esc = (s: string) => JSON.stringify(s);
let failures = 0;
const check = (label: string, cond: boolean, detail = "") => { if (!cond) failures++; console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`); };
let shotN = 40;
const shot = async (tab: Tab, name: string) => { await tab.shot(join(OUT, `real-${String(++shotN).padStart(2, "0")}-${name}.png`)); };

function psql(sql: string): string {
  return execFileSync("ssh", ["-i", join(homedir(), ".ssh", "id_ed25519"), "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", "nexusadmin@212.95.40.144",
    "docker exec -i supabase_db_DRLCards psql -U postgres -d postgres -At -F ' | ' -v ON_ERROR_STOP=1"], { input: sql, encoding: "utf8" }).trim();
}
const fingerprint = (): Record<string, string> => Object.fromEntries(psql(readFileSync(fingerprintFile, "utf8")).split("\n").map((l) => { const [k, ...v] = l.split(" | "); return [k, v.join(" | ")]; }));
const runRow = (id: string) => {
  const [status, stage, version, match, completed] = psql(`select status, stage, version, coalesce(current_match_id::text, ''), completed_at is not null from public.draft_runs where id = '${id}';`).split(" | ");
  return { status, stage: Number(stage), version: Number(version), matchId: match || null, completed: completed === "t" };
};
const waitFor = async (tab: Tab, expr: string, ms = 20000) => {
  for (let i = 0; i < ms / 200; i++) { if (await tab.js<boolean>(expr)) return true; await sleep(200); }
  return false;
};
async function call(path: string, token: string, body: unknown) {
  const r = await fetch(`${BASE}${path}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
  let json: any = null; try { json = await r.json(); } catch { /* sin JSON */ }
  return { status: r.status, json };
}

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

const PLAY_ONE = `(async () => {
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
})()`;

async function main() {
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const { data } = await anon.auth.signInWithPassword({ email: creds.email, password: creds.password });
  const token = data.session?.access_token;
  if (!token) throw new Error("login QA falló");

  const active = psql(`select id from public.draft_runs where user_id = '${U}' and status in ('DRAFTING','READY','IN_MATCH') limit 1;`);
  if (!active) throw new Error("no hay run activa que continuar");
  const runId = active;
  const pre = fingerprint();
  const r0 = runRow(runId);
  check("run de partida: READY en la etapa 2 (tras ganar la 01)", r0.status === "READY" && r0.stage === 2, `${r0.status} s${r0.stage} v${r0.version}`);

  const b = await launch({ width: 1440, height: 900, userDataDir: PROFILE });
  const tab = b.tab;
  const evidence: Record<string, unknown> = { runId: runId.slice(0, 8) };
  try {
    check("login por el formulario real", await login(tab));
    await tab.goto(`${BASE}/jugar/draft-gauntlet`, 3500);
    check("mapa: 01 superado, 02 siguiente", await waitFor(tab, `(() => { const s = [...document.querySelectorAll('[data-testid="gauntlet-node"]')].map((n) => n.getAttribute('data-state')); return s[0] === 'WON' && s[1] === 'CURRENT'; })()`, 15000));
    await shot(tab, "stage2-ready");

    // ── combate 02 desde la interfaz
    await tab.js(`document.querySelector('[data-testid="draft-start-match"]')?.click()`);
    check("start_match (02) → arena", await waitFor(tab, `location.pathname === "/duelos/jugar" && location.search.includes("draft=1")`, 20000));
    await sleep(2500);
    const r1 = runRow(runId);
    check("BD: IN_MATCH en la etapa 2 con partida", r1.status === "IN_MATCH" && r1.stage === 2 && !!r1.matchId);
    const matchId = r1.matchId!;
    const [mode, difficulty] = psql(`select mode, difficulty from public.duel_matches where id = '${matchId}';`).split(" | ");
    check("partida 02: DRAFT_GAUNTLET · NORMAL", mode === "DRAFT_GAUNTLET" && difficulty === "NORMAL", `${mode} ${difficulty}`);
    await tab.js(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Saltar')?.click()`);
    await sleep(1500);
    let played = 0;
    for (let i = 0; i < 12 && played < 2; i++) { if (await tab.js<boolean>(PLAY_ONE)) played++; else await sleep(700); }
    const turnsBefore = Number(psql(`select jsonb_array_length(state->'turns') from public.duel_matches where id = '${matchId}';`));
    check("2 turnos jugados por la interfaz", played === 2 && turnsBefore === 2, `ui=${played} bd=${turnsBefore}`);

    // ── recarga en pleno combate
    await tab.goto(`${BASE}/duelos/jugar?draft=1`, 4000);
    await tab.js(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Saltar')?.click()`);
    await sleep(1500);
    await shot(tab, "stage2-after-refresh");
    const active2 = await call("/api/game/duel", token, { action: "active" });
    const r2 = runRow(runId);
    const turnsAfter = Number(psql(`select jsonb_array_length(state->'turns') from public.duel_matches where id = '${matchId}';`));
    check("recarga: misma partida, mismos turnos, run intacta", r2.matchId === matchId && r2.version === r1.version && turnsAfter === turnsBefore, `turnos ${turnsAfter}`);
    check("la partida rápida NO retoma el combate del draft", active2.status === 200 && (active2.json?.view?.matchId ?? null) !== matchId);
    const state = await call("/api/game/duel", token, { action: "state", matchId });
    check("la arena recupera la vista redactada del combate (sin mano rival)", state.status === 200 && state.json?.view?.matchId === matchId && !JSON.stringify(state.json).includes('"snapshotB"') && !("rivalHand" in (state.json?.view ?? {})));
    const again = await call("/api/game/draft-gauntlet", token, { action: "start_match", actionId: randomUUID(), expectedVersion: r1.version });
    check("start_match repetido en combate → MISMA partida", again.status === 200 && again.json?.matchId === matchId);

    // ── volver al gauntlet y abandonar con confirmación
    await tab.goto(`${BASE}/jugar/draft-gauntlet`, 3500);
    check("gauntlet: RETOMAR COMBATE", await waitFor(tab, `!!document.querySelector('[data-testid="draft-resume-match"]')`, 15000));
    await shot(tab, "stage2-resume");
    await tab.js(`document.querySelector('[data-testid="draft-abandon"]')?.click()`);
    check("abandonar pide confirmación", await waitFor(tab, `!!document.querySelector('[data-testid="draft-abandon-confirm"]')`, 5000));
    check("sin confirmar, la run sigue igual", runRow(runId).status === "IN_MATCH");
    await shot(tab, "abandon-confirm");
    await tab.js(`document.querySelector('[data-testid="draft-abandon-yes"]')?.click()`);
    check("tras confirmar: portada con la última run ABANDONADA", await waitFor(tab, `document.querySelector('[data-testid="draft-last-run"]')?.getAttribute('data-status') === 'ABANDONED'`, 20000));
    await sleep(800);
    await shot(tab, "abandoned-landing");

    const r3 = runRow(runId);
    check("BD: run ABANDONED con completed_at, sin partida actual", r3.status === "ABANDONED" && r3.completed && !r3.matchId);
    const stages = psql(`select stage || ':' || status || ':' || coalesce(result, '') || ':' || coalesce(match_id::text, 'null') from public.draft_run_matches where run_id = '${runId}' order by stage;`).split("\n");
    check("historial conservado: 01 SETTLED/WIN, 02 ABANDONED sin partida", stages[0]?.startsWith("1:SETTLED:WIN:") && stages[1] === "2:ABANDONED::null", stages.map((s) => s.split(":").slice(0, 3).join(":")).join(" · "));
    check("la partida 02 en curso se borró; la 01 terminada se conserva", psql(`select count(*) from public.duel_matches where id = '${matchId}';`) === "0" && psql(`select count(*) from public.duel_matches where user_id = '${U}' and mode = 'DRAFT_GAUNTLET';`) === "1");
    const pickAfter = await call("/api/game/draft-gauntlet", token, { action: "pick", actionId: randomUUID(), expectedVersion: r3.version, choiceId: "tenz__base" });
    check("run abandonada: no se puede elegir (404 NO_RUN)", pickAfter.status === 404 && pickAfter.json?.code === "NO_RUN");
    const matchAfter = await call("/api/game/draft-gauntlet", token, { action: "start_match", actionId: randomUUID(), expectedVersion: r3.version });
    check("run abandonada: no se puede jugar (404 NO_RUN)", matchAfter.status === 404 && matchAfter.json?.code === "NO_RUN");
    check("portada: NUEVA RUN disponible", await tab.js<boolean>(`/nueva run/i.test(document.querySelector('[data-testid="draft-start"]')?.innerText ?? '')`));
    evidence.stages = stages.map((s) => s.split(":").slice(0, 3).join(":"));
    evidence.turnsBeforeAbandon = turnsAfter;

    for (const [w, h, name] of [[390, 844, "mobile"], [1024, 800, "tablet"]] as const) {
      await tab.resize(w, h);
      await tab.goto(`${BASE}/jugar/draft-gauntlet`, 3000);
      await sleep(900);
      await shot(tab, `abandoned-${name}`);
    }
    const post = fingerprint();
    for (const k of Object.keys(pre)) check(`huella ${k} idéntica`, post[k] === pre[k]);
  } finally {
    await b.close();
  }
  writeFileSync(join(OUT, "evidence-recovery.json"), JSON.stringify(evidence, null, 2));
  console.log(`\n${failures === 0 ? "✓" : "✗"} recuperación y abandono reales — ${failures} fallos`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
