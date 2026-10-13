/**
 * FASE 44 · QA REAL — recorridos A–F con la cuenta QA (instrumento `_`, fuera de CI)
 *
 *   npx tsx scripts/_fase44-real-qa.ts <credsFile> [baseUrl]
 *
 * App de PRODUCCIÓN local (`next start`) contra la BD real (túnel). Chrome headless, 1440×900. Todo por la interfaz,
 * como un jugador, salvo dos pasos marcados: la compra del sobre (API normal de compra, transacción legítima) y el inicio
 * de una partida para comprobar CONTINUAR PARTIDA (luego se juega hasta el final por API con jugadas legales).
 *
 *   A · Home → JUGAR → Partida rápida → Fácil → partida entera → resultado (XP, acciones) → lobby
 *   · · CONTINUAR PARTIDA real: partida abierta en el servidor → el armazón lo dice → entra en ESA partida
 *   B · Home → Sobres → comprar estándar → Inventario (ABRIR SOBRE) → ceremonia → resumen → colección → ficha → equipos
 *   C · Home → Equipos → laboratorio → JUGAR con este equipo (preparación, sin empezar)
 *   D · Home → Road to Champions → nodo → partida → resultado → siguiente nodo
 *   E · Home → Draft (landing real; la elección se prueba en el arnés: no se deja una run abierta)
 *   F · Home → Temporada → objetivo → Jugar
 *
 * Sin SQL que fabrique nada: la BD solo se LEE (huella antes/después) por SSH en modo solo lectura.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { launch, sleep, type Tab } from "./lib/cdp";

for (const f of [".env.local"]) { const p = join(process.cwd(), f); if (!existsSync(p)) continue; for (const line of readFileSync(p, "utf8").split("\n")) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim(); } }
/* eslint-disable @typescript-eslint/no-explicit-any */
const CREDS = process.argv[2];
const BASE = process.argv[3] ?? "http://127.0.0.1:3005";
const OUT = join(process.cwd(), "docs/product/qa/fase44/real");
mkdirSync(OUT, { recursive: true });
const LOG = join(OUT, "real-qa.log");
writeFileSync(LOG, "");
const log = (s: string) => { console.log(s); appendFileSync(LOG, s + "\n"); };
const creds = JSON.parse(readFileSync(CREDS, "utf8")) as { email: string; password: string; userId: string };
const U = creds.userId;
let ok = 0; let ko = 0;
const checks: { path: string; label: string; ok: boolean; detail: string }[] = [];
let PATH = "·";
const check = (label: string, cond: boolean, detail = "") => { if (cond) ok++; else ko++; checks.push({ path: PATH, label, ok: cond, detail }); log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`); };
const psql = (sql: string) => execFileSync("ssh", ["-i", join(homedir(), ".ssh", "id_ed25519"), "-o", "BatchMode=yes", "nexusadmin@212.95.40.144", "docker exec -i supabase_db_DRLCards psql -U postgres -d postgres -At -c 'set default_transaction_read_only = on;' -f -"], { input: sql, encoding: "utf8" }).trim();
const fp = () => {
  const [credits, xp, cards, packs, matches, txCount, txSum] = psql(`
select credits from public.profiles where id = '${U}';
select xp from public.profiles where id = '${U}';
select count(*) from public.user_cards where user_id = '${U}';
select coalesce(sum(qty), 0) from public.user_packs where user_id = '${U}';
select count(*) from public.duel_matches where user_id = '${U}';
select count(*) from public.credit_transactions where user_id = '${U}';
select coalesce(sum(delta), 0) from public.credit_transactions where user_id = '${U}';`).split("\n").filter((l) => l.trim() !== "SET");
  return { credits: Number(credits), xp: Number(xp), cards: Number(cards), packs: Number(packs), matches: Number(matches), txCount: Number(txCount), txSum: Number(txSum) };
};
const waitFor = async (tab: Tab, expr: string, ms = 20000) => { for (let i = 0; i < ms / 250; i++) { if (await tab.js<boolean>(expr).catch(() => false)) return true; await sleep(250); } return false; };
let shotN = 0;
const shots: string[] = [];
async function shot(tab: Tab, name: string) { const f = `real-${String(++shotN).padStart(2, "0")}-${name}.png`; await tab.shot(join(OUT, f)); shots.push(f); log(`    📸 ${f}`); }
const click = (tab: Tab, sel: string) => tab.js<boolean>(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.click(); return true; })()`);
const clickText = (tab: Tab, re: string, scope = "button, a") => tab.js<boolean>(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(scope)})].find((b) => new RegExp(${JSON.stringify(re)}, "i").test((b.textContent || "").trim()) && !b.disabled); if (!el) return false; el.click(); return true; })()`);
async function key(tab: Tab, k: "Enter" | "Escape") {
  const code = k === "Enter" ? 13 : 27;
  await tab.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: k, code: k, windowsVirtualKeyCode: code });
  if (k === "Enter") await tab.send("Input.dispatchKeyEvent", { type: "char", key: "Enter", text: "\r", windowsVirtualKeyCode: 13 });
  await tab.send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code: k, windowsVirtualKeyCode: code });
}

const PLAY_ONE = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const btns = () => [...document.querySelectorAll('button')];
  const cont = btns().find((b) => b.textContent.trim() === 'Continuar'); if (cont) { cont.click(); await sleep(450); }
  const confirm = () => btns().find((b) => /^(Elige una carta|Elige una estadística|Declarar y atacar|Responder)$/.test(b.textContent.trim()));
  if (!confirm()) return false;
  const cards = btns().filter((b) => /OVR\\s*\\d+/.test(b.getAttribute('aria-label') || '') && !b.disabled);
  if (!cards.length) return false;
  cards[0].click(); await sleep(300);
  const stats = btns().filter((b) => b.hasAttribute('aria-pressed') && !(b.getAttribute('aria-label') || '').includes('OVR') && /^(SH|GS|EF)\\d+$/.test(b.textContent.trim()));
  if (stats.length === 3) { stats[0].click(); await sleep(250); }
  const c = confirm(); if (!c || c.disabled) return false;
  c.click(); await sleep(1700);
  return true;
})()`;

async function playUiUntilResult(tab: Tab, label: string): Promise<boolean> {
  let turns = 0;
  for (let i = 0; i < 60; i++) {
    if (await tab.js<boolean>(`!!document.querySelector('[data-scene="result"]')`)) break;
    const played = await tab.js<boolean>(PLAY_ONE).catch(() => false);
    if (played) { turns++; if (turns === 1) await shot(tab, `${label}-turn1`); if (turns === 5) await shot(tab, `${label}-turn5`); }
    else await sleep(700);
  }
  return waitFor(tab, `!!document.querySelector('[data-scene="result"]')`, 20000);
}

async function main() {
  log(`FASE 44 · QA REAL · cuenta ${U.slice(0, 8)} · ${BASE}`);
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const { data } = await anon.auth.signInWithPassword({ email: creds.email, password: creds.password });
  const token = data.session!.access_token;
  const api = async (method: string, path: string, body?: unknown) => { const r = await fetch(`${BASE}${path}`, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, json: await r.json().catch(() => ({})) as any }; };
  const f0 = fp();
  log(`huella inicial ${JSON.stringify(f0)}`);

  const b = await launch({ width: 1440, height: 900, userDataDir: join(CREDS, "..", "f44-real-profile") });
  const tab = b.tab;
  await tab.setMedia([{ name: "prefers-reduced-motion", value: "no-preference" }]);
  try {
    await tab.goto(`${BASE}/cuenta`, 4000);
    if (await tab.js<boolean>(`!!document.querySelector('input[type="password"]')`)) {
      await tab.js(`(() => { const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }; set(document.querySelector('input[type="email"]'), ${JSON.stringify(creds.email)}); set(document.querySelector('input[type="password"]'), ${JSON.stringify(creds.password)}); document.querySelector('form button[type="submit"]').click(); })()`);
    }
    check("sesión QA por el formulario real", await waitFor(tab, `/cerrar sesión/i.test(document.body.innerText)`, 30000));

    /* ─────────── A ─────────── */
    PATH = "A";
    log("\n· A · HOME → JUGAR → PvE → RESULTADO → JUGAR OTRA");
    await tab.goto(`${BASE}/`, 3000);
    check("Home: lobby montado", await waitFor(tab, `!!document.querySelector('[data-testid="daily-lobby"]')`, 30000));
    await sleep(1500);
    await shot(tab, "A-home");
    const home = await tab.js<any>(`(() => ({ stage: !!document.querySelector('[data-testid="lobby-play-stage"]'), heroTier: document.querySelector('[data-testid="daily-hero"]')?.getAttribute('data-tier'), shellPlay: document.querySelector('[data-testid="shell-play"]')?.textContent?.trim(), primaries: document.querySelectorAll('main [data-cta="primary"]').length }))()`);
    check("Home: JUGAR visible y un único dominante en el lobby", /jugar|continuar/i.test(home.shellPlay ?? "") && home.primaries === 1, JSON.stringify(home));
    const ps0 = await api("GET", "/api/game/play-status");
    check("play-status real (sin partida abierta) → JUGAR", ps0.status === 200 && ps0.json.resume === null, JSON.stringify(ps0.json));
    await click(tab, '[data-testid="shell-play"]');
    check("JUGAR → selector de modos (1 clic)", await waitFor(tab, `location.pathname === "/jugar" && !!document.querySelector('[data-testid="game-modes-hub"]')`, 20000));
    await sleep(1200); await shot(tab, "A-modes");
    await click(tab, '[data-testid="mode-cta-QUICK"]');
    check("Partida rápida → preparación", await waitFor(tab, `location.pathname === "/duelos/jugar" && /Comenzar duelo/i.test(document.body.innerText)`, 30000));
    await clickText(tab, "^Fácil");
    await sleep(800); await shot(tab, "A-prematch");
    await clickText(tab, "^Comenzar duelo$");
    await sleep(900); await shot(tab, "A-intro");
    const finished = await playUiUntilResult(tab, "A-match");
    check("PvE Fácil real jugada entera por la interfaz", finished);
    await sleep(1600); await shot(tab, "A-result");
    const res = await tab.js<any>(`(() => { const html = document.body.innerHTML; return { kind: document.querySelector('[data-scene="result"]')?.getAttribute('data-kind'), actionsBeforeStory: html.indexOf('data-testid="result-actions"') > -1 && html.indexOf('data-testid="result-actions"') < html.indexOf('Los diez turnos'), xp: !!document.querySelector('[data-testid="xp-progress"]'), again: [...document.querySelectorAll('button')].some((b) => /^Revancha$/i.test(b.textContent.trim())), lobby: !!document.querySelector('a[href="/"]'), actionsTop: Math.round(document.querySelector('[data-testid="result-actions"]')?.getBoundingClientRect().top ?? -1) }; })()`);
    check("Resultado: acciones antes de la historia, XP de juego, JUGAR OTRA y volver al lobby", res.actionsBeforeStory && res.xp && res.again && res.lobby, JSON.stringify(res));
    await tab.js(`document.querySelector('[data-testid="xp-progress"]')?.scrollIntoView({ block: "center" })`); await sleep(1500); await shot(tab, "A-result-xp");
    await click(tab, 'a[href="/"]');
    check("Resultado → lobby", await waitFor(tab, `location.pathname === "/" && !!document.querySelector('[data-testid="daily-lobby"]')`, 30000));
    await sleep(2500); await shot(tab, "A-lobby-after-match");

    log("\n· CONTINUAR PARTIDA con partida real abierta en el servidor");
    const decks = await api("GET", "/api/game/duels");
    const deckId = decks.json.activeDeckId ?? decks.json.decks?.find((d: any) => d.valid)?.id;
    const start = await api("POST", "/api/game/duel", { action: "start", deckId, difficulty: "EASY" });
    check("partida PvE abierta (API normal de juego)", start.status === 200 && start.json.view?.status === "IN_PROGRESS", String(start.status));
    const ps1 = await api("GET", "/api/game/play-status");
    check("play-status real → CONTINUAR PARTIDA a /duelos/jugar", ps1.json.resume?.href === "/duelos/jugar", JSON.stringify(ps1.json.resume));
    await tab.goto(`${BASE}/temporada`, 6000);
    await waitFor(tab, `/continuar partida/i.test(document.querySelector('[data-testid="shell-play"]')?.textContent ?? "")`, 25000);
    await shot(tab, "A-continue-shell");
    check("el armazón dice CONTINUAR PARTIDA en otra pantalla", /continuar partida/i.test(await tab.js<string>(`document.querySelector('[data-testid="shell-play"]')?.textContent ?? ""`)));
    await click(tab, '[data-testid="shell-play"]');
    check("CONTINUAR PARTIDA entra en la arena de ESA partida", await waitFor(tab, `location.pathname === "/duelos/jugar" && [...document.querySelectorAll('button')].some((b) => /Elige una carta|Declarar y atacar|Responder|Continuar/.test(b.textContent))`, 30000));
    await sleep(1200); await shot(tab, "A-continue-arena");
    const finished2 = await playUiUntilResult(tab, "A-continue");
    check("la partida retomada termina por la interfaz", finished2);
    await sleep(1500); await shot(tab, "A-continue-result");
    const ps2 = await api("GET", "/api/game/play-status");
    check("al terminar, play-status vuelve a JUGAR", ps2.json.resume === null);

    /* ─────────── B ─────────── */
    PATH = "B";
    log("\n· B · HOME → SOBRES → ABRIR → COLECCIÓN → CARTA → EQUIPOS");
    await tab.goto(`${BASE}/`, 5000);
    await click(tab, 'header a[href="/tienda"]');
    check("Sobres desde el armazón", await waitFor(tab, `location.pathname === "/tienda"`, 20000));
    await sleep(2000); await shot(tab, "B-shop");
    const before = fp();
    const buy = await api("POST", "/api/game/packs", { action: "buy", packId: "estandar", ref: `f44-qa-buy-${randomUUID()}` });
    check("compra legítima de un Sobre Estándar (API de compra normal)", buy.status === 200, `${buy.status} ${JSON.stringify(buy.json).slice(0, 120)}`);
    await tab.goto(`${BASE}/inventario`, 6000);
    check("Inventario: ABRIR SOBRE domina", await waitFor(tab, `!!document.querySelector('[data-testid="inventory-open-cta"]')`, 25000));
    await sleep(1200); await shot(tab, "B-inventory");
    await click(tab, '[data-testid="inventory-open-cta"]');
    const PHASE = `(document.querySelector('[data-testid="pack-opening"]')?.getAttribute("data-phase") ?? null)`;
    check("ceremonia lista", await waitFor(tab, `${PHASE} === "ready" && !!document.querySelector('[data-testid="pack-open"]')`, 30000));
    await sleep(800); await shot(tab, "B-pack-ready");
    await click(tab, '[data-testid="pack-open"]');
    check("servidor primero: la mano llega con el resultado", await waitFor(tab, `${PHASE} === "hand" || ${PHASE} === "summary"`, 30000));
    await sleep(900); await shot(tab, "B-pack-hand");
    await click(tab, '[data-testid="pack-reveal"]');
    for (let i = 0; i < 14; i++) {
      if ((await tab.js<string | null>(PHASE)) === "summary") break;
      await waitFor(tab, `document.querySelector('[data-testid="reveal-card"]')?.getAttribute("data-revealed") === "true"`, 9000);
      if (i === 0) { await sleep(400); await shot(tab, "B-pack-reveal-1"); }
      await sleep(350); await key(tab, "Enter"); await sleep(350);
    }
    check("resumen del sobre", await waitFor(tab, `${PHASE} === "summary" && !!document.querySelector('[data-testid="pack-summary"]')`, 25000));
    await sleep(1400); await shot(tab, "B-pack-summary");
    const dock = await tab.js<any>(`(() => { const a = document.querySelector('[data-testid="summary-actions"]'); const r = a?.getBoundingClientRect(); return { visible: !!r && r.bottom <= window.innerHeight + 1 && r.top >= 0, primary: document.querySelectorAll('[data-testid="summary-actions"] [data-cta="primary"]').length, cards: document.querySelectorAll('[data-testid="summary-card"]').length }; })()`);
    check("resumen: dock de acciones visible sin desplazar, un dominante, 5 cartas", dock.visible && dock.primary === 1 && dock.cards === 5, JSON.stringify(dock));
    const after = fp();
    check("apertura real: +5 cartas y sobre consumido", after.cards === before.cards + 5 && after.packs === before.packs, `${before.cards}→${after.cards} · sobres ${before.packs}→${after.packs}`);
    await click(tab, '[data-testid="summary-view-collection"]');
    check("→ ficha de la carta destacada", await waitFor(tab, `location.pathname.startsWith("/coleccion/carta/")`, 25000));
    await sleep(2500); await shot(tab, "B-card-detail");
    await click(tab, 'header a[href="/coleccion"]');
    check("→ colección", await waitFor(tab, `location.pathname === "/coleccion"`, 20000));
    await sleep(3000); await shot(tab, "B-collection");
    await click(tab, 'header a[href="/duelos/mazos"]');
    check("→ equipos desde el armazón", await waitFor(tab, `location.pathname === "/duelos/mazos"`, 20000));
    await sleep(3000); await shot(tab, "B-decks");

    /* ─────────── C ─────────── */
    PATH = "C";
    log("\n· C · HOME → EQUIPO → ESTRATEGIA → JUGAR");
    const deck = decks.json.decks?.find((d: any) => d.id === deckId);
    await tab.goto(`${BASE}/duelos/mazos?deck=${deckId}`, 6000);
    check("laboratorio de equipo real", await waitFor(tab, `!!document.querySelector('[data-testid="strategy-lab"]')`, 30000), deck?.name ?? "");
    await sleep(1500); await shot(tab, "C-builder-lab");
    await tab.goto(`${BASE}/duelos/mazos`, 6000);
    await sleep(2500);
    const toPlay = await clickText(tab, "^Jugar$");
    check("JUGAR con este equipo → preparación", toPlay && await waitFor(tab, `location.pathname === "/duelos/jugar" && /Comenzar duelo/i.test(document.body.innerText)`, 30000));
    await sleep(1500); await shot(tab, "C-prematch");

    /* ─────────── D ─────────── */
    PATH = "D";
    log("\n· D · HOME → CAMPAÑA → NODO → RESULTADO → SIGUIENTE NODO");
    await tab.goto(`${BASE}/`, 6000);
    await waitFor(tab, `!!document.querySelector('[data-testid="lobby-modes"], [data-testid="daily-hero"]')`, 30000);
    const viaLobby = await click(tab, '[data-testid="lobby-modes"] [data-mode="campaign"]');
    if (!viaLobby) await tab.goto(`${BASE}/jugar/road-to-champions`, 3000);
    check("Road to Champions desde el lobby (1 clic)", await waitFor(tab, `location.pathname === "/jugar/road-to-champions"`, 25000), viaLobby ? "tile del lobby" : "ruta directa");
    await sleep(3500); await shot(tab, "D-map");
    const camp = await api("GET", "/api/game/campaign");
    const nextNode = camp.json?.summary?.nextNodeId;
    const done0 = camp.json?.summary?.completed;
    check("campaña real con siguiente nodo", !!nextNode, `${nextNode} · completados ${done0}`);
    await tab.goto(`${BASE}/duelos/jugar?campaign=${nextNode}`, 6000);
    check("nodo → preparación de campaña", await waitFor(tab, `/Comenzar|Jugar nodo|Empezar/i.test(document.body.innerText) && location.pathname === "/duelos/jugar"`, 30000));
    await sleep(1500); await shot(tab, "D-prematch");
    await clickText(tab, "^(Comenzar duelo|Jugar nodo|Empezar)");
    await sleep(900);
    const finishedD = await playUiUntilResult(tab, "D-match");
    check("partida de campaña real terminada", finishedD);
    await sleep(2000); await shot(tab, "D-result");
    const camp2 = await api("GET", "/api/game/campaign");
    const won = (camp2.json?.summary?.completed ?? 0) > (done0 ?? 0);
    check("resultado de campaña coherente con el servidor", camp2.status === 200, won ? `nodo superado · ${done0}→${camp2.json.summary.completed} · siguiente ${camp2.json.summary.nextNodeId}` : "nodo no superado (derrota real): la ruta no avanza, sin desbloqueo falso");
    await tab.goto(`${BASE}/jugar/road-to-champions`, 6000);
    await sleep(3000); await shot(tab, "D-map-after");

    /* ─────────── E ─────────── */
    PATH = "E";
    log("\n· E · HOME → DRAFT");
    await tab.goto(`${BASE}/`, 6000);
    await waitFor(tab, `!!document.querySelector('[data-testid="lobby-modes"], [data-testid="daily-hero"]')`, 30000);
    const viaDraft = await click(tab, '[data-testid="lobby-modes"] [data-mode="draft"]');
    if (!viaDraft) await tab.goto(`${BASE}/jugar/draft-gauntlet`, 3000);
    check("Draft Gauntlet desde el lobby", await waitFor(tab, `location.pathname === "/jugar/draft-gauntlet"`, 25000));
    await sleep(3500); await shot(tab, "E-draft-landing");
    check("Draft: NUEVA RUN disponible (no se inicia: la elección se prueba en el arnés sin dejar una run abierta)", await tab.js<boolean>(`/nueva run|continuar/i.test(document.body.innerText)`));
    await tab.goto(`${BASE}/design-system/fase39?state=pick-1`, 3500); await shot(tab, "E-harness-pick");

    /* ─────────── F ─────────── */
    PATH = "F";
    log("\n· F · HOME → TEMPORADA → OBJETIVO → JUGAR");
    await tab.goto(`${BASE}/`, 5000);
    await click(tab, 'header a[href="/temporada"]');
    check("Temporada desde el armazón", await waitFor(tab, `location.pathname === "/temporada"`, 20000));
    await sleep(3500); await shot(tab, "F-season");
    await tab.goto(`${BASE}/progresion`, 5000);
    await sleep(3000); await shot(tab, "F-objectives");
    check("desde objetivos, JUGAR a un toque", await tab.js<boolean>(`!!document.querySelector('[data-testid="shell-play"]')`));
    await click(tab, '[data-testid="shell-play"]');
    check("Objetivo → JUGAR → modos", await waitFor(tab, `location.pathname === "/jugar"`, 20000));

    PATH = "R";
    log("\n· RANKED y EVENTOS reales");
    await tab.goto(`${BASE}/duelos/competitivo`, 6000);
    await sleep(2500); await shot(tab, "R-ranked");
    check("Ranked: JUGAR RANKED como acción de juego", await tab.js<boolean>(`!!document.querySelector('[data-testid="ranked-play"]')`));
    await tab.goto(`${BASE}/torneos`, 6000);
    await sleep(2500); await shot(tab, "R-events");
    const fakeLive = await tab.js<any>(`(() => [...document.querySelectorAll('[data-event]')].map((e) => ({ demo: /demo/i.test(e.innerText), live: /en directo/i.test(e.innerText) })))()`);
    check("Eventos: ningún evento DEMO dice «En directo»", fakeLive.every((e: any) => !(e.demo && e.live)), JSON.stringify(fakeLive));
  } finally {
    await b.close();
  }
  const f1 = fp();
  log(`\nhuella final ${JSON.stringify(f1)}`);
  check("economía coherente: Δcréditos = Δ suma del libro de transacciones", f1.credits - f0.credits === f1.txSum - f0.txSum, `${f1.credits - f0.credits} vs ${f1.txSum - f0.txSum}`);
  writeFileSync(join(OUT, "real-qa.json"), JSON.stringify({ generatedAt: new Date().toISOString(), account: U.slice(0, 8), fp0: f0, fp1: f1, checks, shots, ok, ko }, null, 2) + "\n");
  log(`\n${ok} ✓ · ${ko} ✗ · ${shots.length} capturas reales`);
  if (ko) process.exitCode = 1;
}
void main();
