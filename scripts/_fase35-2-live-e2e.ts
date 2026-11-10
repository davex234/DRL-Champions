/**
 * FASE 35.2 · E2E REAL EN NAVEGADOR (instrumento `_`, fuera de CI).
 *
 *   npx tsx scripts/_fase35-2-live-e2e.ts <credsFile> <fase> [args]
 *
 * App LOCAL real (BASE, :3005) → API real → Supabase del VPS por túnel. Chrome headless con perfil PERSISTENTE
 * en el scratchpad: la sesión la crea el formulario real de /cuenta (signInWithPassword del SDK) y sobrevive
 * entre fases. Nada de fixtures, mocks, sesiones fabricadas ni resultados forzados.
 *
 * Fases:
 *   login                 formulario real + comprobación de que ningún JS/HTML servido contiene secretos
 *   deck                  Constructor real: «Crear mi primer equipo» → «Autocompletar» → «Guardar equipo» → «Activar»
 *   hub                   /jugar
 *   map <shotPrefix>      /jugar/road-to-champions (+ detalle de c1-n1)
 *   play <nodeId> <tag>   pre-partida de campaña → partida completa con clics legales → resultado + banner
 *   doubleclick <nodeId>  dos clics seguidos en «Jugar/Rejugar nodo» (una sola partida esperada)
 *
 * Decisiones de juego: se lee la vista REDACTADA propia (`POST /api/game/duel {action:"active"}`, la misma que
 * pinta la arena) y se hace clic en la carta/estadística en la interfaz. Voraz y legal; sin información oculta.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
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
const OUT = join(process.cwd(), "docs", "product", "qa", "fase35-2");
mkdirSync(OUT, { recursive: true });
const [credsFile, phase, ...args] = process.argv.slice(2);
const creds = JSON.parse(readFileSync(credsFile, "utf8")) as { email: string; password: string; userId: string };
const PROFILE = join(credsFile, "..", "f352-chrome-profile");

const log = (s: string) => console.log(s);
const esc = (s: string) => JSON.stringify(s);

async function apiToken(): Promise<string> {
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const { data, error } = await anon.auth.signInWithPassword({ email: creds.email, password: creds.password });
  if (error || !data.session) throw new Error(`login QA falló: ${error?.message}`);
  return data.session.access_token;
}
async function duel(t: string, body: unknown): Promise<any> {
  const r = await fetch(`${BASE}/api/game/duel`, { method: "POST", headers: { authorization: `Bearer ${t}`, "content-type": "application/json" }, body: JSON.stringify(body) });
  return r.json();
}

const text = (tab: Tab) => tab.js<string>("document.body.innerText");
const clickText = (tab: Tab, re: string) => tab.js<boolean>(`(() => { const b = [...document.querySelectorAll('button, a')].find(x => new RegExp(${esc(re)}, 'i').test((x.textContent||'').trim()) && !x.disabled); if (!b) return false; b.click(); return true; })()`);
const waitFor = async (tab: Tab, expr: string, ms = 20000) => {
  for (let i = 0; i < ms / 250; i++) { if (await tab.js<boolean>(expr)) return true; await sleep(250); }
  return false;
};

async function secretScan(tab: Tab): Promise<string> {
  const secrets = [process.env.SUPABASE_SERVICE_ROLE_KEY, process.env.SYNC_SECRET].filter((x): x is string => !!x && x.length > 16);
  const urls = await tab.js<string[]>(`[...new Set([location.href, ...performance.getEntriesByType('resource').map(e => e.name)])].filter(u => u.startsWith(location.origin))`);
  let scanned = 0; let leaks = 0;
  for (const u of urls) {
    try {
      const body = await (await fetch(u)).text();
      scanned++;
      if (secrets.some((s) => body.includes(s))) leaks++;
    } catch { /* recurso no reutilizable */ }
  }
  const storageKeys = await tab.js<string[]>(`Object.keys(localStorage)`);
  const storageLeak = await tab.js<boolean>(`Object.values(localStorage).some(v => ${JSON.stringify(secrets)}.some(s => v.includes(s)))`);
  return `same-origin resources scanned=${scanned} secret_leaks=${leaks} localStorage_keys=[${storageKeys.join(",")}] secret_in_storage=${storageLeak}`;
}

async function login(tab: Tab) {
  await tab.goto(`${BASE}/cuenta`, 3500);
  const already = await tab.js<boolean>(`/qa_campaign_352/i.test(document.body.innerText)`);
  if (!already) {
    await tab.shot(join(OUT, "01-login.png"));
    const filled = await tab.js<boolean>(`(() => {
      const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
      const e = document.querySelector('input[type="email"]'); const p = document.querySelector('input[type="password"]');
      if (!e || !p) return false; set(e, ${esc(creds.email)}); set(p, ${esc(creds.password)}); return true; })()`);
    log(`login form found=${filled}`);
    await tab.js(`document.querySelector('form button[type="submit"]').click()`);
    await waitFor(tab, `/qa_campaign_352/i.test(document.body.innerText)`, 20000);
  }
  const ok = await tab.js<boolean>(`/qa_campaign_352/i.test(document.body.innerText)`);
  const admin = await tab.js<boolean>(`/Panel de administración|\\/admin/i.test([...document.querySelectorAll('a')].map(a=>a.getAttribute('href')||'').join(' '))`);
  log(`session_via_real_form=${ok} admin_links_visible=${admin}`);
  if (!already) await tab.shot(join(OUT, "01b-logged-in-account.png"));
  log(await secretScan(tab));
}

async function deck(tab: Tab) {
  await tab.goto(`${BASE}/duelos/mazos`, 6000);
  await waitFor(tab, `[...document.querySelectorAll('button, a')].some(x => /^(Crear mi primer equipo|Crear equipo|\\+ Nuevo equipo)$/i.test((x.textContent||'').trim()))`, 20000);
  const created = await clickText(tab, "^(Crear mi primer equipo|Crear equipo|\\+ Nuevo equipo)$");
  await waitFor(tab, `[...document.querySelectorAll('button')].some(x => /^Autocompletar equipo$/i.test((x.textContent||'').trim()))`, 20000);
  const auto = await clickText(tab, "^Autocompletar equipo$");
  await sleep(2000);
  await tab.shot(join(OUT, "00-deck-builder-autocomplete.png"));
  const saved = await clickText(tab, "^Guardar equipo$");
  await sleep(3500);
  // «Activar» vive en la tarjeta del equipo, en el hub de equipos.
  await tab.goto(`${BASE}/duelos/mazos`, 6000);
  await waitFor(tab, `[...document.querySelectorAll('button')].some(x => /^Activar$/i.test((x.textContent||'').trim()))`, 20000);
  const activated = await clickText(tab, "^Activar$");
  await sleep(3000);
  await tab.shot(join(OUT, "00-deck-active.png"));
  log(`deck create=${created} autocomplete=${auto} save=${saved} activate=${activated}`);
  log(`page_mentions_active=${/Activo/i.test(await text(tab))}`);
}

async function hub(tab: Tab) {
  await tab.goto(`${BASE}/jugar`, 6000);
  const t = await text(tab);
  log(`hub modes: rtc=${/Road to Champions/i.test(t)} rapida=${/Partida rápida/i.test(t)} competitivo=${/Competitivo/i.test(t)} amigo=${/Retar a un amigo/i.test(t)} statuses=${(t.match(/DISPONIBLE|EN PARTIDA|EQUIPO NO VÁLIDO|PROVISIONAL|NO DISPONIBLE|INICIA SESIÓN|COMPLETADA/g) ?? []).join(",")}`);
  await tab.shot(join(OUT, "02-game-modes.png"));
}

async function map(tab: Tab, prefix: string) {
  await tab.goto(`${BASE}/jugar/road-to-champions`, 7000);
  const t = await text(tab);
  const nodes = await tab.js<string>(`[...document.querySelectorAll('[data-node][data-status]')].filter(e => e.offsetParent !== null).map(e => e.getAttribute('data-node') + '=' + e.getAttribute('data-status')).join(' ')`);
  log(`map migration_pending=${/TODAVÍA NO DISPONIBLE|MIGRATION_PENDING/i.test(t)} progress="${(t.match(/\d+\s*\/\s*15 nodos/i) ?? [""])[0]}" nodes=${nodes}`);
  await tab.shot(join(OUT, `${prefix}-map.png`));
  const sel = args[1] ?? "c1-n1";
  await tab.goto(`${BASE}/jugar/road-to-champions?node=${sel}`, 6000);
  const sheet = await text(tab);
  const cta = await tab.js<string | null>(`document.querySelector('[data-testid="node-cta"]')?.getAttribute('data-cta') ?? null`);
  log(`node ${sel}: sheet=${await tab.js<boolean>(`!!document.querySelector('[data-testid="node-sheet"]')`)} rival="${(sheet.match(/RIVAL\s*\n?([^\n]+)/i) ?? ["", ""])[1]}" difficulty="${(sheet.match(/DIFICULTAD\s*\n?([^\n]+)/i) ?? ["", ""])[1]}" reward="${(sheet.match(/PRIMERA VICTORIA\s*\n?([^\n]+)/i) ?? ["", ""])[1]}" team="${(sheet.match(/TU EQUIPO\s*\n?([^\n]+)/i) ?? ["", ""])[1]}" cta=${cta}`);
  await tab.shot(join(OUT, `${prefix}-node-detail.png`));
}

/** Elige la jugada con la vista propia: voraz y legal. */
function decide(v: any): { nick: string; stat?: "stronghold" | "gamesense" | "entryfrag" } | null {
  const hand = v.yourHand as any[];
  if (!hand?.length) return null;
  const stats = ["stronghold", "gamesense", "entryfrag"] as const;
  if (v.youAreAttacker && v.phase === "ATTACKER_CARD") {
    let best = { nick: hand[0].nick, stat: "stronghold" as (typeof stats)[number], val: -1 };
    for (const c of hand) for (const s of stats) if (c.combat[s] > best.val) best = { nick: c.nick, stat: s, val: c.combat[s] };
    return { nick: best.nick, stat: best.stat };
  }
  if (!v.youAreAttacker && v.phase === "DEFENDER_CARD" && v.requiredStat) {
    const need = v.pendingRival?.value ?? 0;
    const req = v.requiredStat as (typeof stats)[number];
    const sorted = [...hand].sort((a, b) => a.combat[req] - b.combat[req]);
    const winner = sorted.find((c) => c.combat[req] > need);
    return { nick: (winner ?? sorted[0]).nick };
  }
  return null;
}

async function play(tab: Tab, nodeId: string, tag: string) {
  const t = await apiToken();
  const before = await duel(t, { action: "active" });
  if (before.view) log(`WARNING active match exists before start ${String(before.view.matchId).slice(0, 8)}`);
  await tab.goto(`${BASE}/duelos/jugar?campaign=${nodeId}`, 8000);
  const pre = await text(tab);
  log(`prematch: context=${/ROAD TO CHAMPIONS/i.test(pre)} chapter=${/CAPÍTULO \d/i.test(pre)} node=${/NODO \d-\d/i.test(pre)} rival_shown=${/Bot · /i.test(pre)} no_difficulty_selector=${!/Comenzar duelo/i.test(pre)}`);
  await tab.shot(join(OUT, `${tag}-prematch.png`));
  const started = await tab.js<boolean>(`(() => { const b = document.querySelector('[data-testid="campaign-start"]'); if (!b || b.disabled) return false; b.click(); return true; })()`);
  log(`start_clicked=${started}`);
  if (!started) {
    // Partida de campaña ya en curso: la arena la retoma (reconexión) en lugar de ofrecer «Jugar nodo».
    const resumed = await tab.js<boolean>(`!!document.querySelector('[data-phase]')`);
    log(`resumed_existing_match=${resumed}`);
    if (!resumed) { log(`prematch_text=${pre.slice(0, 400).replace(/\n/g, " | ")}`); return; }
  }
  await sleep(3500);
  await clickText(tab, "^Saltar$");
  await sleep(1500);
  let shotMatch = false; let turns = 0; let lastHistory = -1; let stuck = 0;
  for (let guard = 0; guard < 90; guard++) {
    const a = await duel(t, { action: "active" });
    const v = a.view;
    if (!v) break;
    if (v.status !== "IN_PROGRESS") break;
    if (v.history.length !== lastHistory) { lastHistory = v.history.length; stuck = 0; } else stuck++;
    const move = decide(v);
    // «Elige una carta» está DESHABILITADO hasta elegir carta: listo = botón de decisión presente (no «Resolviendo…»/«Esperando…»)
    // y alguna carta de la mano pulsable.
    const ready = await tab.js<boolean>(`[...document.querySelectorAll('button')].some(b => /^(Elige una carta|Elige una estadística|Declarar y atacar|Responder)$/.test((b.textContent||'').trim()))
      && [...document.querySelectorAll('button[aria-label]')].some(b => /, OVR \\d+$/.test(b.getAttribute('aria-label')||'') && !b.disabled)`);
    if (!move || !ready) { await clickText(tab, "^(Continuar|Cerrar)$"); await sleep(900); if (stuck > 40) { log("STUCK waiting for board"); break; } continue; }
    const picked = await tab.js<boolean>(`(() => { const b = [...document.querySelectorAll('button[aria-label]')].find(x => (x.getAttribute('aria-label')||'').startsWith(${esc(move.nick + ",")})); if (!b || b.disabled) return false; b.click(); return true; })()`);
    await sleep(350);
    if (move.stat) {
      const abbr = { stronghold: 0, gamesense: 1, entryfrag: 2 }[move.stat];
      await tab.js(`(() => { const g = document.querySelector('[role="group"][aria-label="¿Con qué peleas?"]'); const bs = g ? [...g.querySelectorAll('button')] : []; if (bs[${abbr}]) bs[${abbr}].click(); })()`);
      await sleep(350);
    }
    const confirmed = await tab.js<boolean>(`(() => { const b = [...document.querySelectorAll('button')].find(x => /^(Declarar y atacar|Responder)$/.test((x.textContent||'').trim())); if (!b || b.disabled) return false; b.click(); return true; })()`);
    if (picked && confirmed) {
      turns++;
      log(`turn ${v.turn}/${v.totalTurns} ${v.youAreAttacker ? "ATK" : "DEF"} ${move.nick}${move.stat ? ":" + move.stat : ""} score ${v.scoreYou}-${v.scoreRival}`);
      if (!shotMatch && v.turn >= 3) { await sleep(700); await tab.shot(join(OUT, `${tag}-match.png`)); shotMatch = true; }
    }
    await sleep(3600);
  }
  // Resultado: la arena pasa a «result» al cerrar la última revelación.
  await waitFor(tab, `!!document.querySelector('[data-scene="result"]')`, 25000);
  await sleep(4000);
  const final = await duel(t, { action: "active" });
  const res = await tab.js<string>(`document.querySelector('[data-scene="result"]')?.innerText ?? ''`);
  const tone = await tab.js<string | null>(`document.querySelector('[data-testid="campaign-result"]')?.getAttribute('data-tone') ?? null`);
  const banner = await tab.js<string>(`document.querySelector('[data-testid="campaign-result"]')?.innerText ?? ''`);
  log(`result_scene=${!!res} ui_outcome=${/VICTORIA/i.test(res) ? "VICTORIA" : /DERROTA/i.test(res) ? "DERROTA" : /EMPATE/i.test(res) ? "EMPATE" : "?"} active_after=${final.view ? final.view.status : "none"} campaign_banner_tone=${tone} banner="${banner.replace(/\n/g, " | ").slice(0, 200)}"`);
  await tab.js(`window.scrollTo(0, 0)`);
  await tab.shot(join(OUT, `${tag}-result.png`));
  await tab.js(`document.querySelector('[data-testid="campaign-result"]')?.scrollIntoView({ block: "center" })`);
  await sleep(500);
  await tab.shot(join(OUT, `${tag}-campaign-banner.png`));
}

async function diag(tab: Tab, path: string) {
  await tab.goto(`${BASE}${path}`, 9000);
  await clickText(tab, "^Saltar$");
  await sleep(2500);
  await tab.shot(join(OUT, "diag-arena.png"));
  const info = await tab.js<string>(`JSON.stringify({
    phase: document.querySelector('[data-phase]')?.getAttribute('data-phase') ?? null,
    scene: document.querySelector('[data-scene]')?.getAttribute('data-scene') ?? null,
    buttons: [...document.querySelectorAll('button')].filter(b => b.offsetParent !== null).map(b => ((b.getAttribute('aria-label') || '') + ' | ' + (b.textContent||'').trim()).slice(0, 60) + (b.disabled ? ' [disabled]' : '')).slice(0, 60),
    dialogs: [...document.querySelectorAll('[role="dialog"]')].map(d => (d.textContent||'').trim().slice(0, 80)),
  })`);
  log(info);
}

async function doubleclick(tab: Tab, nodeId: string) {
  await tab.goto(`${BASE}/duelos/jugar?campaign=${nodeId}`, 8000);
  const pre = await text(tab);
  log(`prematch: context=${/ROAD TO CHAMPIONS/i.test(pre)} chapter=${/CAPÍTULO \d/i.test(pre)} node=${/NODO \d-\d/i.test(pre)} rival_shown=${/Bot · /i.test(pre)} replay_cta=${/Rejugar nodo/i.test(pre)} active_team=${/Activo/i.test(pre)}`);
  await tab.shot(join(OUT, `${args[1] ?? "dbl"}-prematch.png`));
  const r = await tab.js<string>(`(() => { const b = document.querySelector('[data-testid="campaign-start"]'); if (!b || b.disabled) return 'no-button'; b.click(); b.click(); return 'double-clicked'; })()`);
  log(`doubleclick=${r}`);
  await sleep(6000);
  log(`after_doubleclick_scene=${await tab.js<string>(`document.querySelector('[data-scene]')?.getAttribute('data-scene') ?? (document.querySelector('[data-phase]') ? 'match' : 'none')`)}`);
}

async function main() {
  mkdirSync(PROFILE, { recursive: true });
  const b = await launch({ width: 1440, height: 900, userDataDir: PROFILE });
  const tab = b.tab;
  try {
    await tab.setMedia([{ name: "prefers-reduced-motion", value: "reduce" }]);
    // Matar Chrome al terminar no garantiza que localStorage llegue a disco: cada ejecución vuelve a pasar por el
    // formulario real de /cuenta (idempotente si la sesión sigue viva) antes de sus fases.
    await login(tab);
    for (const p of phase.split(",")) {
      switch (p) {
        case "login": break;
        case "deck": await deck(tab); break;
        case "hub": await hub(tab); break;
        case "map": await map(tab, args[0] ?? "03"); break;
        case "play": await play(tab, args[0], args[1] ?? "run"); break;
        case "doubleclick": await doubleclick(tab, args[0]); break;
        case "diag": await diag(tab, args[0] ?? "/duelos/jugar"); break;
        case "prematch": {
          // Solo lectura: pre-partida de campaña sin pulsar «Jugar nodo».
          await tab.goto(`${BASE}/duelos/jugar?campaign=${args[0]}`, 9000);
          const pre = await text(tab);
          const deckButtons = await tab.js<string>(`[...document.querySelectorAll('[aria-label="Elegir equipo"] button[aria-pressed]')].map(b => (b.textContent||'').replace(/\\s+/g,' ').trim() + (b.getAttribute('aria-pressed') === 'true' ? ' [SELECTED]' : '')).join(' || ')`);
          log(`prematch ${args[0]}: context=${/ROAD TO CHAMPIONS/i.test(pre)} chapter=${/CAPÍTULO \\d/i.test(pre)} node=${/NODO \\d-\\d/i.test(pre)} rival_bot=${/Bot · /i.test(pre)} cta=${/Rejugar nodo/i.test(pre) ? "REJUGAR" : /Jugar nodo/i.test(pre) ? "JUGAR" : "?"} teams=${deckButtons}`);
          await tab.shot(join(OUT, `${args[1] ?? "prematch"}.png`));
          break;
        }
        default: throw new Error("fase desconocida");
      }
    }
    const errs = tab.takeErrors().filter((e) => !/players\/.*\.(png|webp)|Failed to load resource: the server responded with a status of 404/i.test(e));
    log(`console_errors(own)=${errs.length}${errs.length ? " :: " + errs.slice(0, 5).join(" || ").slice(0, 600) : ""}`);
  } finally {
    await b.close();
  }
}

main().catch((e) => { console.error("ERROR", e instanceof Error ? e.message : e); process.exit(1); });
