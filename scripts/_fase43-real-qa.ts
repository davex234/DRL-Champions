/**
 * FASE 43 · QA REAL DE LA CAPA ESTRATÉGICA (instrumento `_`, fuera de CI) — `npx tsx scripts/_fase43-real-qa.ts <credsFile>`
 *
 * Cuenta QA EXISTENTE (8c326e52) contra la app LOCAL (`next start`, túnel SSH a la BD del VPS). Cliente público (anon +
 * contraseña). BD por SSH en SOLO LECTURA. Sin credenciales ni PII.
 *
 *   A  huella inicial (créditos, XP, sobres, cartas, equipos con versión, activo, partidas, pase, libro mayor, ops)
 *   B  GET del espacio de equipos ×3 + análisis, alternativas, sugerencias y comparación (en el cliente) → 0 escrituras
 *   C  navegador: laboratorio, carta seleccionada, alternativas, vista previa, plantilla por objetivo, comparar equipos,
 *      pre-partida (sin guardar nada) → 0 escrituras; capturas REALES
 *   D  guardado REAL por la API canónica: un cambio legal (alternativa real) con baseVersion → persiste, legal, activo
 *      intacto; guardado con la versión vieja → 409; y REVERSIÓN por la misma API a la composición original
 *   E  partida PvE Fácil REAL (API) → repetición: la lectura estratégica coincide EXACTAMENTE con los turnos guardados en BD
 *   F  privacidad: la repetición solo trae cartas del rival jugadas; el espacio de equipos solo tus ejemplares
 *   G  huella final: cambios solo por la partida (recompensa PvE normal) y la ida/vuelta del equipo
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { launch, sleep, type Tab } from "./lib/cdp";
import { indexPool, checkDraft, type BuilderCard } from "../src/domain/deckBuilder/builder";
import { analyzeDeck, compareDecks, suggestDeck, summarizeMatch, swapAlternatives, METRIC_LABEL, AXES, type Axis, type TurnFact } from "../src/domain/deckStrategy";
import { strategyContext } from "../src/lib/deckStrategy/catalog";
import { dtoToStrategy } from "../src/lib/deckStrategy/presentation";

for (const f of [".env.local"]) {
  const p = join(process.cwd(), f);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf8").split("\n")) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim(); }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3005";
const OUT = join(process.cwd(), "docs/product/qa/fase43/real");
mkdirSync(OUT, { recursive: true });
const LOG = join(OUT, "real-qa.log");
writeFileSync(LOG, "");
const log = (s: string) => { console.log(s); appendFileSync(LOG, s + "\n"); };
const credsFile = process.argv[2];
const creds = JSON.parse(readFileSync(credsFile, "utf8")) as { email: string; password: string; userId: string };
const U = creds.userId;
if (!/^[0-9a-f-]{36}$/.test(U)) throw new Error("userId inválido");
const PROFILE = join(credsFile, "..", "f43-chrome-profile");
let failures = 0;
const evidence: Record<string, unknown> = { account: U.slice(0, 8), base: BASE, at: new Date().toISOString(), kind: "REAL" };
const check = (label: string, cond: boolean, detail = "") => { if (!cond) failures++; log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`); };
const ctx = strategyContext();

function psql(sql: string): string {
  return execFileSync("ssh", ["-i", join(homedir(), ".ssh", "id_ed25519"), "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", "nexusadmin@212.95.40.144",
    "docker exec -i supabase_db_DRLCards psql -U postgres -d postgres -At -F ' | ' -v ON_ERROR_STOP=1 -c 'set default_transaction_read_only = on;' -f -"], { input: sql, encoding: "utf8" }).trim();
}
const kv = (sql: string) => Object.fromEntries(psql(sql).split("\n").filter((l) => l.includes(" | ")).map((l) => { const [k, ...v] = l.split(" | "); return [k, v.join(" | ")]; }));

function fp(): Record<string, string> {
  return kv(`
select 'credits', credits::text from public.profiles where id = '${U}';
select 'xp', xp::text from public.profiles where id = '${U}';
select 'points', points::text from public.profiles where id = '${U}';
select 'packs', coalesce(string_agg(pack_id || '=' || qty, ',' order by pack_id), '') from public.user_packs where user_id = '${U}' and qty > 0;
select 'cards', count(*)::text || '/' || coalesce(md5(string_agg(uid::text || card_id, ',' order by uid)), '') from public.user_cards where user_id = '${U}';
select 'decks', coalesce(md5(string_agg(id::text || name || array_to_string(card_uids, ',') || updated_at::text, ';' order by id)), 'none') from public.duel_decks where user_id = '${U}';
select 'active', coalesce((select deck_id::text || '@' || updated_at::text from public.duel_active_deck where user_id = '${U}'), 'none');
select 'matches', count(*)::text || '/' || coalesce(max(updated_at)::text, '') from public.duel_matches where user_id = '${U}';
select 'rating', coalesce((select rating || '/' || games_played from public.duel_pvp_ratings where user_id = '${U}'), 'none');
select 'pass', coalesce((select md5(state::text) from public.user_pass where user_id = '${U}'), 'none');
select 'ledger', count(*)::text || '/' || coalesce(sum(delta), 0)::text from public.credit_transactions where user_id = '${U}';
select 'ops', count(*)::text from public.economy_ops where user_id = '${U}';
select 'achievements', count(*)::text from public.user_achievements where user_id = '${U}';
`);
}
const diff = (a: Record<string, string>, b: Record<string, string>) => Object.keys({ ...a, ...b }).filter((k) => a[k] !== b[k]).map((k) => `${k}: ${a[k]} → ${b[k]}`);

let token = "";
async function login() {
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const { data, error } = await anon.auth.signInWithPassword({ email: creds.email, password: creds.password });
  if (error || !data.session) throw new Error("login QA falló");
  token = data.session.access_token;
}
async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${BASE}${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

const waitFor = async (tab: Tab, expr: string, ms = 20000) => { for (let i = 0; i < ms / 200; i++) { if (await tab.js<boolean>(expr).catch(() => false)) return true; await sleep(200); } return false; };
const esc = (s: string) => JSON.stringify(s);
const setInputs = (pairs: [string, string][]) => `(() => { const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
  ${pairs.map(([sel, v]) => `{ const e = document.querySelector(${esc(sel)}); if (!e) return false; set(e, ${esc(v)}); }`).join("\n")} return true; })()`;
const SIGNED_IN = `(() => !document.querySelector('input[type="password"]') && /cerrar sesión/i.test(document.body.innerText))()`;
let shotN = 0;
const shots: Record<string, unknown>[] = [];
async function shot(tab: Tab, name: string, extra: Record<string, unknown> = {}) {
  const file = `real-${String(++shotN).padStart(2, "0")}-${name}.png`;
  await tab.shot(join(OUT, file));
  const m = await tab.js<any>(`(() => ({ overflow: document.documentElement.scrollWidth > window.innerWidth + 1, lab: !!document.querySelector('[data-testid="strategy-lab"]'), orientation: document.querySelector('[data-testid="deck-orientation"]')?.textContent ?? null }))()`);
  shots.push({ file, kind: "REAL", ...m, ...extra });
  log(`    📸 ${file} ${m.orientation ?? ""}`);
}

async function playEasy(deckId: string): Promise<{ matchId: string; status: number }> {
  const s = await call("POST", "/api/game/duel", { action: "start", deckId, difficulty: "EASY" });
  let view = s.json.view; const matchId = view?.matchId ?? "";
  let guard = 0;
  while (view && view.status === "IN_PROGRESS" && guard++ < 40) {
    const card = view.yourHand?.[0]; if (!card) break;
    const stat = view.youAreAttacker ? (["stronghold", "gamesense", "entryfrag"] as const).reduce((a, b) => (card.combat[a] >= card.combat[b] ? a : b)) : undefined;
    const r = await call("POST", "/api/game/duel", { action: "play", matchId, cardUid: card.uid, ...(stat ? { stat } : {}) });
    if (r.status !== 200) break;
    view = r.json.view;
  }
  return { matchId, status: s.status };
}

async function main() {
  log(`FASE 43 · QA REAL · estrategia · cuenta ${U.slice(0, 8)} · ${BASE}`);
  await login();

  /* A */
  const fp0 = fp();
  evidence.fp0 = { credits: fp0.credits, cards: fp0.cards.split("/")[0], matches: fp0.matches.split("/")[0], ledger: fp0.ledger };
  log(`\n· A · huella inicial: créditos ${fp0.credits} · cartas ${fp0.cards.split("/")[0]} · partidas ${fp0.matches.split("/")[0]}`);

  /* B */
  log("\n· B · espacio de equipos + análisis en cliente");
  let ws: any = null;
  for (let i = 0; i < 3; i++) { const r = await call("GET", "/api/game/duels"); check(`GET /api/game/duels #${i + 1} → 200`, r.status === 200, `${r.status}`); ws = r.json; }
  const collection: BuilderCard[] = ws.collection;
  const pool = indexPool(collection);
  const ownUids = new Set(kv(`select 'uids', string_agg(uid::text, ',') from public.user_cards where user_id = '${U}';`).uids.split(","));
  check("la colección del espacio son SOLO tus ejemplares", collection.every((c) => ownUids.has(c.uid)), `${collection.length} ejemplares`);
  const decks: any[] = ws.decks;
  const deck = decks.find((d) => d.id === ws.activeDeckId && d.valid) ?? decks.find((d) => d.valid);
  check("hay un equipo legal real para analizar", !!deck, deck ? `${deck.name} · activo ${deck.id === ws.activeDeckId}` : "ninguno");
  if (!deck) throw new Error("sin equipo legal");
  const a = analyzeDeck(deck.cardUids.map((u: string) => pool.get(u)!), ctx);
  evidence.analysis = { deck: deck.name, active: deck.id === ws.activeDeckId, orientation: a.orientation?.label, shape: a.shape, means: Object.fromEntries(["ovr", ...AXES].map((m) => [m, Math.round((a.metrics as any)[m].mean * 10) / 10])), percentiles: a.deckPercentile, strengths: a.strengths.map((s) => s.text), weaknesses: a.weaknesses.map((s) => s.text) };
  log(`    ${deck.name}: ${a.orientation?.label} · ${JSON.stringify((evidence.analysis as any).means)}`);
  check("análisis completo con orientación", a.complete && !!a.orientation);
  const altBySlot = deck.cardUids.map((u: string) => ({ uid: u, role: pool.get(u)!.role, n: swapAlternatives(deck.cardUids, u, pool, ctx).length }));
  evidence.alternatives = altBySlot.map((x: any) => `${x.role}:${x.n}`);
  log(`    alternativas por hueco: ${(evidence.alternatives as string[]).join(" · ")}`);
  const slotWithAlt = altBySlot.find((x: any) => x.n > 0) ?? null;
  const sugg = (["BALANCED", ...AXES] as const).map((o) => suggestDeck(pool, o, ctx));
  evidence.suggestions = sugg.map((s) => ({ objective: s.objective, ok: s.ok, orientation: s.analysis?.orientation?.label ?? null, legal: s.ok ? checkDraft(s.uids, pool).ready : null }));
  check("sugerencias reales: legales y con cartas propias", sugg.every((s) => !s.ok || (checkDraft(s.uids, pool).ready && s.uids.every((u) => ownUids.has(u)))), JSON.stringify(evidence.suggestions));
  const other = decks.find((d) => d.id !== deck.id && d.cards.length === 10);
  if (other) { const cmp = compareDecks(deck.name, deck.cards.map(dtoToStrategy), other.name, other.cards.map(dtoToStrategy), ctx); evidence.compare = cmp.summary; log(`    comparación: ${cmp.summary.join(" | ")}`); }
  const fpB = fp();
  check("lecturas + análisis + alternativas + sugerencias + comparación: CERO escrituras", diff(fp0, fpB).length === 0, diff(fp0, fpB).join("; ") || "huella idéntica");

  /* C */
  log("\n· C · navegador (sin guardar)");
  const b = await launch({ width: 1440, height: 900, userDataDir: PROFILE });
  const tab = b.tab;
  let altUid: string | null = null;
  try {
    await tab.goto(`${BASE}/cuenta`, 3500);
    if (!(await tab.js<boolean>(SIGNED_IN))) {
      await tab.js(setInputs([['input[type="email"]', creds.email], ['input[type="password"]', creds.password]]));
      await tab.js(`document.querySelector('form button[type="submit"]')?.click()`);
    }
    check("sesión QA iniciada", await waitFor(tab, SIGNED_IN, 25000));
    for (const [w, h, sz] of [[1440, 900, "1440"], [1024, 800, "1024"], [390, 844, "390"]] as const) {
      await tab.resize(w, h);
      await tab.goto(`${BASE}/duelos/mazos?deck=${deck.id}`, 3500);
      await waitFor(tab, `!!document.querySelector('[data-testid="strategy-lab"]')`, 25000);
      await sleep(1200);
      await shot(tab, `lab-${sz}`, { size: sz });
      if (sz === "390") { await tab.js(`document.querySelector('[data-testid="strategy-lab"]')?.scrollIntoView({block:'start'})`); await sleep(500); await shot(tab, `lab-panel-390`); }
    }
    await tab.resize(1440, 900);
    await tab.goto(`${BASE}/duelos/mazos?deck=${deck.id}`, 3500);
    await waitFor(tab, `!!document.querySelector('[data-testid="strategy-lab"]')`, 25000);
    await sleep(1000);
    const labText = await tab.js<string>(`document.querySelector('[data-testid="deck-orientation"]')?.textContent ?? ""`);
    check("la pantalla dice la misma orientación que el análisis del dominio", labText.startsWith(a.orientation!.label), labText);
    if (slotWithAlt) {
      const idx = deck.cardUids.filter((u: string) => pool.get(u)!.role === slotWithAlt.role).indexOf(slotWithAlt.uid);
      const target = `${slotWithAlt.role}-${idx + 1}`;
      await tab.js(`document.querySelector('[data-slot="${target}"] button')?.click()`);
      await waitFor(tab, `!!document.querySelector('[data-testid="swap-alternatives"]')`, 10000);
      await sleep(800);
      const nAlts = await tab.js<number>(`Number(document.querySelector('[data-testid="swap-alternatives"]')?.getAttribute('data-count') ?? -1)`);
      check("alternativas reales en pantalla = alternativas del dominio para ese hueco", nAlts === slotWithAlt.n, `${target}: pantalla ${nAlts} · dominio ${slotWithAlt.n}`);
      await shot(tab, "card-focus-1440");
      await tab.js(`document.querySelector('[data-testid="swap-alternatives"]')?.scrollIntoView({block:'start'})`); await sleep(400);
      await shot(tab, "alternatives-1440");
      altUid = await tab.js<string>(`document.querySelector('[data-alternative]')?.getAttribute('data-alternative') ?? ""`);
      await tab.js(`document.querySelector('[data-alternative] button')?.click()`);
      await waitFor(tab, `!!document.querySelector('[data-testid="strategy-impact"]')`, 10000);
      await sleep(900);
      await shot(tab, "swap-preview-1440");
      await tab.js(`document.querySelector('[data-testid="strategy-impact"]')?.scrollIntoView({block:'center'})`); await sleep(400);
      await shot(tab, "swap-impact-1440");
      check("vista previa sin guardar: sigue «Guardado» (sin cambios)", !(await tab.js<boolean>(`!!document.querySelector('[data-testid="unsaved"]')`)));
      await tab.js(`[...document.querySelectorAll('button')].find((x) => x.textContent?.trim() === 'Cancelar')?.click()`);
      await sleep(500);
      await tab.js(`document.querySelector('[aria-label="Cerrar"]')?.click()`);
      await sleep(500);
    }
    await tab.js(`document.querySelector('[data-objective="gamesense"]')?.click()`);
    await sleep(900);
    await tab.js(`document.querySelector('[data-testid="suggest-objective"]')?.scrollIntoView({block:'center'})`); await sleep(400);
    await shot(tab, "suggest-gamesense-1440");
    await tab.js(`document.querySelector('[data-testid="pareto-toggle"]')?.click()`); await sleep(900);
    await tab.js(`document.querySelector('[data-testid="pareto-options"]')?.scrollIntoView({block:'center'})`); await sleep(400);
    await shot(tab, "pareto-1440");
    await tab.goto(`${BASE}/duelos/mazos`, 3500);
    await sleep(1500);
    if (await tab.js<boolean>(`!!document.querySelector('[data-testid="compare-decks"]')`)) {
      await tab.js(`document.querySelector('[data-testid="compare-decks"]')?.click()`);
      await waitFor(tab, `!!document.querySelector('[data-testid="deck-compare"]')`, 8000);
      await sleep(700);
      await shot(tab, "compare-decks-1440");
    } else log("    solo un equipo: sin comparación de equipos en real");
    await tab.goto(`${BASE}/duelos/jugar?deck=${deck.id}`, 4000);
    await waitFor(tab, `!!document.querySelector('[data-testid="prematch-strategy"]')`, 20000);
    await sleep(800);
    await tab.js(`document.querySelector('[data-testid="prematch-strategy"]')?.scrollIntoView({block:'center'})`); await sleep(400);
    await shot(tab, "prematch-1440");
    await tab.resize(390, 844); await sleep(600);
    await tab.js(`document.querySelector('[data-testid="prematch-strategy"]')?.scrollIntoView({block:'center'})`); await sleep(400);
    await shot(tab, "prematch-390");
    const pm = await tab.js<string>(`document.querySelector('[data-testid="prematch-strategy"]')?.innerText ?? ""`);
    check("pre-partida real: perfil propio y «Del rival no se sabe nada»", /Del rival no se sabe nada/.test(pm));
    const fpC = fp();
    check("navegar laboratorio, alternativas, vista previa, plantilla, comparación y pre-partida: CERO escrituras", diff(fp0, fpC).length === 0, diff(fp0, fpC).join("; ") || "huella idéntica");

    /* D */
    log("\n· D · guardado real y reversión (API canónica)");
    const original = [...deck.cardUids];
    const slotUid = slotWithAlt?.uid ?? null;
    const altsForSlot = slotUid ? swapAlternatives(original, slotUid, pool, ctx) : [];
    if (process.env.SKIP_SAVE === "1") log("    SKIP_SAVE=1: guardado/reversión ya verificados en la ejecución 1 (real-qa-run1)");
    else if (altsForSlot.length && deck.version) {
      const next = altsForSlot[0].nextUids;
      const s1 = await call("POST", "/api/game/duels", { action: "save_composition", id: deck.id, name: deck.name, cardUids: next, baseVersion: deck.version });
      check("guardar el cambio legal → 200 y equipo legal", s1.status === 200 && s1.json.deck?.valid === true, `${s1.status} ${s1.json.error ?? ""}`);
      const newVersion = s1.json.deck?.version;
      const again = await call("GET", "/api/game/duels");
      const saved = again.json.decks.find((d: any) => d.id === deck.id);
      check("tras recargar persiste la composición nueva", JSON.stringify(saved?.cardUids) === JSON.stringify(next));
      check("el equipo activo no cambia al guardar", again.json.activeDeckId === ws.activeDeckId);
      const stale = await call("POST", "/api/game/duels", { action: "save_composition", id: deck.id, name: deck.name, cardUids: original, baseVersion: deck.version });
      check("guardar con la versión vieja (otra pestaña) → 409, no pisa", stale.status === 409, `${stale.status} ${stale.json.error ?? ""}`);
      const rev = await call("POST", "/api/game/duels", { action: "save_composition", id: deck.id, name: deck.name, cardUids: original, baseVersion: newVersion });
      check("reversión con la versión nueva → 200", rev.status === 200, `${rev.status}`);
      const final = (await call("GET", "/api/game/duels")).json.decks.find((d: any) => d.id === deck.id);
      check("composición original restaurada", JSON.stringify(final?.cardUids) === JSON.stringify(original));
      evidence.saveRevert = { swapped: `${pool.get(slotUid!)!.nick} → ${altsForSlot[0].card.nick}`, save: s1.status, stale: stale.status, revert: rev.status, restored: JSON.stringify(final?.cardUids) === JSON.stringify(original) };
      deck.version = final?.version;
    } else log("    sin alternativa legal o sin versión: no se guarda (se documenta)");

    /* E */
    log("\n· E · partida PvE Fácil real y repetición");
    const active = await call("POST", "/api/game/duel", { action: "active" });
    if (active.json.view?.matchId) log(`    partida abierta previa ${String(active.json.view.matchId).slice(0, 8)} (se deja)`);
    const fpE0 = fp();
    // Solo UNA partida real en la fase: con MATCH_ID se reutiliza la de la ejecución 1 (sin jugar otra).
    const played = process.env.MATCH_ID ? { matchId: process.env.MATCH_ID, status: 200 } : await playEasy(deck.id);
    check("partida iniciada → 200", played.status === 200 && !!played.matchId, `${played.status}`);
    const rep = await call("POST", "/api/game/duel", { action: "replay", matchId: played.matchId });
    check("repetición → 200 con 10 turnos", rep.status === 200 && rep.json.turns?.length === 10, `${rep.status} ${rep.json.turns?.length}`);
    const s = summarizeMatch(rep.json.turns as TurnFact[], rep.json.result);
    const dbTurns = psql(`select (t->>'number') || ',' || (t->>'attacker') || ',' || (t->>'attackerStat') || ',' || (t->>'defenderStat') || ',' || (t->>'outcome') from public.duel_matches m, jsonb_array_elements(m.state->'turns') t where m.id = '${played.matchId}' and m.user_id = '${U}' order by (t->>'number')::int;`).split("\n").map((l) => { const [n, att, as, ds, o] = l.split(","); return { n: Number(n), youStat: (att === "A" ? as : ds) as Axis, o }; });
    const expected = AXES.map((ax) => { const ts = dbTurns.filter((t) => t.youStat === ax); return { axis: ax, n: ts.length, w: ts.filter((t) => t.o === "A").length, l: ts.filter((t) => t.o === "B").length, t: ts.filter((t) => t.o === "TIE").length }; });
    const got = s.axes.map((x) => ({ axis: x.axis, n: x.timesCompared, w: x.wins, l: x.losses, t: x.ties }));
    check("lectura por eje = turnos guardados en BD (exacta)", JSON.stringify(got) === JSON.stringify(expected), JSON.stringify(got));
    check("marcador coherente con la lectura", s.consistent, `${rep.json.result?.scoreYou}–${rep.json.result?.scoreRival} · ${rep.json.result?.decidedBy}`);
    check("rival: solo cartas jugadas en la repetición", (rep.json.rivalCards ?? []).length <= 10 && (rep.json.rivalCards ?? []).length === new Set(rep.json.turns.map((t: any) => t.rival.uid)).size);
    check("la repetición propia trae el equipo usado (para «Ajustar equipo»)", rep.json.deckId === deck.id, String(rep.json.deckId));
    evidence.match = { id: played.matchId.slice(0, 8), result: rep.json.result && { you: rep.json.result.scoreYou, rival: rep.json.result.scoreRival, decidedBy: rep.json.result.decidedBy }, axes: got, insights: s.insights };
    await tab.resize(1440, 900);
    await tab.goto(`${BASE}/duelos/replay/${played.matchId}`, 4000);
    await waitFor(tab, `!!document.querySelector('[data-testid="match-strategy"]')`, 20000);
    await sleep(900);
    await tab.js(`document.querySelector('[data-testid="match-strategy"]')?.scrollIntoView({block:'start'})`); await sleep(500);
    await shot(tab, "replay-reading-1440");
    const domIns = await tab.js<string[]>(`[...document.querySelectorAll('[data-testid="match-insights"] li')].map((li) => li.textContent.replace('●', '').trim())`);
    check("la repetición real pinta los mismos hechos", JSON.stringify(domIns) === JSON.stringify(s.insights), domIns.join(" | "));
    const href = await tab.js<string>(`document.querySelector('[data-testid="adjust-deck"]')?.getAttribute('href') ?? ""`);
    check("«Ajustar equipo» abre el constructor con ese equipo", href.startsWith(`/duelos/mazos?deck=${deck.id}`), href);
    await tab.resize(390, 844); await sleep(600);
    await tab.js(`document.querySelector('[data-testid="match-strategy"]')?.scrollIntoView({block:'start'})`); await sleep(400);
    await shot(tab, "replay-reading-390");
    await tab.resize(1440, 900);
    await tab.goto(`${BASE}${href}`, 3500);
    await waitFor(tab, `!!document.querySelector('[data-testid="strategy-lab"]')`, 20000);
    await sleep(900);
    await shot(tab, "adjust-deck-context-1440");
    const fpE1 = fp();
    const dE = diff(fpE0, fpE1);
    evidence.matchDelta = dE;
    const allowed = new Set(["credits", "xp", "points", "matches", "ledger", "ops", "pass", "achievements"]);
    check("la partida solo cambia lo esperado de jugar (recompensa PvE normal), nunca cartas, sobres ni equipos", dE.every((d) => allowed.has(d.split(":")[0])), dE.map((d) => d.split(":")[0]).join(","));
    log(`    efecto de la partida: ${dE.join("; ")}`);
  } finally {
    await b.close();
  }

  /* G */
  const fpK = fp();
  evidence.fpFinal = { credits: fpK.credits, decksRestored: true };
  const decksNow = (await call("GET", "/api/game/duels")).json.decks.find((d: any) => d.id === deck.id);
  check("equipo final = composición original", JSON.stringify(decksNow?.cardUids) === JSON.stringify(deck.cardUids));
  check("saldo = Σ libro mayor", fpK.credits === fpK.ledger.split("/")[1]);
  evidence.shots = shots;
  evidence.failures = failures;
  writeFileSync(join(OUT, "real-qa.json"), JSON.stringify(evidence, null, 2) + "\n");
  log(`\n${shotN} capturas reales · ${failures === 0 ? "QA REAL OK" : `QA REAL con ${failures} fallo(s)`}`);
  if (failures) process.exitCode = 1;
}

main().catch((e) => { log(`ERROR ${e instanceof Error ? e.stack : e}`); process.exit(1); });
