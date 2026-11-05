/**
 * FASE 43 · CAPTURAS REALES COMPLEMENTARIAS (instrumento `_`, SOLO LECTURA) — `npx tsx scripts/_fase43-real-shots.ts <creds> <matchId>`
 *
 * Misma cuenta QA y app local. No guarda, no juega, no compra: navega y captura. Vuelve a comprobar, con el texto
 * normalizado (sin el punto decorativo «●»), que la repetición real pinta los mismos hechos que `summarizeMatch` sobre
 * los turnos que devuelve el servidor. Huella de BD antes/después: debe ser idéntica.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { launch, sleep, type Tab } from "./lib/cdp";
import { summarizeMatch, type TurnFact } from "../src/domain/deckStrategy";

for (const f of [".env.local"]) { const p = join(process.cwd(), f); if (!existsSync(p)) continue; for (const line of readFileSync(p, "utf8").split("\n")) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim(); } }
/* eslint-disable @typescript-eslint/no-explicit-any */
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3005";
const OUT = join(process.cwd(), "docs/product/qa/fase43/real");
const LOG = join(OUT, "real-shots.log");
writeFileSync(LOG, "");
const log = (s: string) => { console.log(s); appendFileSync(LOG, s + "\n"); };
const creds = JSON.parse(readFileSync(process.argv[2], "utf8")) as { email: string; password: string; userId: string };
const MATCH = process.argv[3];
const U = creds.userId;
const PROFILE = join(process.argv[2], "..", "f43-chrome-profile");
let failures = 0;
const check = (label: string, cond: boolean, detail = "") => { if (!cond) failures++; log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`); };
const psql = (sql: string) => execFileSync("ssh", ["-i", join(homedir(), ".ssh", "id_ed25519"), "-o", "BatchMode=yes", "nexusadmin@212.95.40.144", "docker exec -i supabase_db_DRLCards psql -U postgres -d postgres -At -c 'set default_transaction_read_only = on;' -f -"], { input: sql, encoding: "utf8" }).trim();
const fp = () => psql(`
select credits, xp from public.profiles where id = '${U}';
select count(*) from public.user_cards where user_id = '${U}';
select coalesce(md5(string_agg(id::text || array_to_string(card_uids, ',') || updated_at::text, ';' order by id)), '') from public.duel_decks where user_id = '${U}';
select count(*), coalesce(max(updated_at)::text, '') from public.duel_matches where user_id = '${U}';
select count(*), coalesce(sum(delta), 0) from public.credit_transactions where user_id = '${U}';
select coalesce((select md5(state::text) from public.user_pass where user_id = '${U}'), '');`);
const waitFor = async (tab: Tab, expr: string, ms = 20000) => { for (let i = 0; i < ms / 200; i++) { if (await tab.js<boolean>(expr).catch(() => false)) return true; await sleep(200); } return false; };
const esc = (s: string) => JSON.stringify(s);
const SIGNED_IN = `(() => !document.querySelector('input[type="password"]') && /cerrar sesión/i.test(document.body.innerText))()`;
let n = 16;
const rows: Record<string, unknown>[] = [];
async function shot(tab: Tab, name: string) {
  const file = `real-${String(++n).padStart(2, "0")}-${name}.png`;
  await tab.shot(join(OUT, file));
  const overflow = await tab.js<boolean>(`document.documentElement.scrollWidth > window.innerWidth + 1`);
  rows.push({ file, kind: "REAL", overflow });
  log(`    📸 ${file}${overflow ? " (desborda)" : ""}`);
}

async function main() {
  log(`FASE 43 · capturas REALES complementarias · cuenta ${U.slice(0, 8)} · partida ${MATCH.slice(0, 8)}`);
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const { data } = await anon.auth.signInWithPassword({ email: creds.email, password: creds.password });
  const token = data.session!.access_token;
  const api = async (method: string, path: string, body?: unknown) => (await fetch(`${BASE}${path}`, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined })).json() as Promise<any>;
  const f0 = fp();
  const ws = await api("GET", "/api/game/duels");
  const deck = ws.decks.find((d: any) => d.id === ws.activeDeckId) ?? ws.decks[0];
  const inDeck = new Set<string>(deck.cardUids);
  const notInDeck = ws.collection.find((c: any) => !inDeck.has(c.uid));
  const rep = await api("POST", "/api/game/duel", { action: "replay", matchId: MATCH });
  const s = summarizeMatch(rep.turns as TurnFact[], rep.result);
  const b = await launch({ width: 1440, height: 900, userDataDir: PROFILE });
  const tab = b.tab;
  try {
    await tab.goto(`${BASE}/cuenta`, 3500);
    if (!(await tab.js<boolean>(SIGNED_IN))) {
      await tab.js(`(() => { const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }; set(document.querySelector('input[type="email"]'), ${esc(creds.email)}); set(document.querySelector('input[type="password"]'), ${esc(creds.password)}); document.querySelector('form button[type="submit"]').click(); })()`);
    }
    check("sesión QA", await waitFor(tab, SIGNED_IN, 25000));

    // Repetición real: hechos iguales (texto normalizado).
    for (const [w, h, sz] of [[1024, 800, "1024"], [1440, 900, "1440"]] as const) {
      await tab.resize(w, h);
      await tab.goto(`${BASE}/duelos/replay/${MATCH}`, 4000);
      await waitFor(tab, `!!document.querySelector('[data-testid="match-strategy"]')`, 20000);
      await sleep(900);
      await tab.js(`document.querySelector('[data-testid="match-strategy"]')?.scrollIntoView({block:'start'})`); await sleep(400);
      await shot(tab, `replay-reading-${sz}`);
    }
    const dom = await tab.js<string[]>(`[...document.querySelectorAll('[data-testid="match-insights"] li')].map((li) => li.textContent.replace('●', '').trim())`);
    check("repetición real: mismos hechos que la lectura de los turnos del servidor", JSON.stringify(dom) === JSON.stringify(s.insights), dom.join(" | "));
    await tab.js(`document.querySelector('[data-testid="card-performance"]')?.setAttribute('open',''); document.querySelector('[data-testid="card-performance"]')?.scrollIntoView({block:'center'})`); await sleep(500);
    await shot(tab, "replay-cards-1440");
    const rowsDom = await tab.js<number>(`document.querySelectorAll('[data-testid="card-performance"] tbody tr').length`);
    check("10 cartas propias en «turno a turno»", rowsDom === 10, String(rowsDom));

    // Alternativas y vista previa en móvil.
    await tab.resize(390, 844);
    await tab.goto(`${BASE}/duelos/mazos?deck=${deck.id}`, 3500);
    await waitFor(tab, `!!document.querySelector('[data-testid="strategy-lab"]')`, 20000);
    await sleep(1000);
    await tab.js(`document.querySelector('[data-slot="Duelista-1"] button')?.click()`);
    await waitFor(tab, `!!document.querySelector('[data-testid="swap-alternatives"]')`, 10000);
    await sleep(700);
    await shot(tab, "card-focus-390");
    await tab.js(`document.querySelector('[data-testid="swap-alternatives"]')?.scrollIntoView({block:'start'})`); await sleep(400);
    await shot(tab, "alternatives-390");
    await tab.js(`document.querySelector('[data-alternative] button')?.click()`);
    await waitFor(tab, `!!document.querySelector('[data-testid="strategy-impact"]')`, 10000);
    await sleep(700);
    await tab.js(`document.querySelector('[data-testid="strategy-impact"]')?.scrollIntoView({block:'center'})`); await sleep(400);
    await shot(tab, "swap-impact-390");
    check("vista previa en móvil sin guardar", !(await tab.js<boolean>(`!!document.querySelector('[data-testid="unsaved"]')`)));

    // Plantilla equilibrada en móvil.
    await tab.goto(`${BASE}/duelos/mazos?deck=${deck.id}`, 3500);
    await waitFor(tab, `!!document.querySelector('[data-testid="suggest-objective"]')`, 20000);
    await tab.js(`document.querySelector('[data-objective="BALANCED"]')?.click()`); await sleep(900);
    await tab.js(`document.querySelector('[data-testid="suggest-objective"]')?.scrollIntoView({block:'start'})`); await sleep(400);
    await shot(tab, "suggest-balanced-390");

    // Ficha de colección: «Comparar para equipo» (propia, fuera del equipo) y «Comparar con mi equipo» (no poseída).
    await tab.resize(1440, 900);
    if (notInDeck) {
      await tab.goto(`${BASE}/coleccion/carta/${notInDeck.cardId}`, 4000);
      await waitFor(tab, `!!document.querySelector('[data-testid="card-actions"]')`, 20000);
      await sleep(1500);
      await shot(tab, "card-detail-owned-1440");
      const href = await tab.js<string>(`document.querySelector('[data-testid="card-team-compare"]')?.getAttribute('href') ?? ""`);
      check("ficha propia fuera del equipo: «Comparar para equipo» accionable", href.includes(`deck=${ws.activeDeckId}`) && href.includes("add="), href);
      if (href) { await tab.goto(`${BASE}${href}`, 3500); await sleep(1500); await shot(tab, "card-detail-to-builder-1440"); }
    }
    const ownedIds = new Set(ws.collection.map((c: any) => c.cardId));
    const unownedId = "lysoar__gold";
    if (!ownedIds.has(unownedId)) {
      await tab.goto(`${BASE}/coleccion/carta/${unownedId}`, 4000);
      await waitFor(tab, `!!document.querySelector('[data-testid="card-actions"]')`, 20000);
      await sleep(1500);
      const actionable = await tab.js<string>(`document.querySelector('[data-testid="card-team-compare"]')?.getAttribute('data-actionable') ?? ""`);
      check("ficha NO poseída: comparación solo informativa", actionable === "false", actionable);
      const href = await tab.js<string>(`document.querySelector('[data-testid="card-team-compare"]')?.getAttribute('href') ?? ""`);
      if (href) { await tab.goto(`${BASE}${href}`, 3500); await waitFor(tab, `!!document.querySelector('[data-testid="explore-card"]')`, 15000); await sleep(800); await shot(tab, "unowned-informative-1440"); check("comparación informativa sin «Confirmar»", !(await tab.js<boolean>(`!!document.querySelector('[data-testid="explore-card"] [data-testid="compare-confirm"]')`))); }
    }
    await tab.resize(390, 844);
    await tab.goto(`${BASE}/duelos/mazos`, 3500); await sleep(1500);
    if (await tab.js<boolean>(`!!document.querySelector('[data-testid="compare-decks"]')`)) { await tab.js(`document.querySelector('[data-testid="compare-decks"]')?.click()`); await sleep(900); await shot(tab, "compare-decks-390"); }
  } finally {
    await b.close();
  }
  const f1 = fp();
  check("capturas complementarias: CERO escrituras", f0 === f1);
  writeFileSync(join(OUT, "real-shots.json"), JSON.stringify({ account: U.slice(0, 8), match: MATCH.slice(0, 8), rows, insights: s.insights, failures }, null, 2) + "\n");
  log(`\n${rows.length} capturas complementarias · ${failures === 0 ? "OK" : `${failures} fallo(s)`}`);
  if (failures) process.exitCode = 1;
}
void main();
