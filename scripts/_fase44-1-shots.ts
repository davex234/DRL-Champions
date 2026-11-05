/**
 * FASE 44.1 · CAPTURAS AFTER POR LOTES (instrumento `_`, fuera de CI, SOLO LECTURA)
 *
 *   npx tsx scripts/_fase44-1-shots.ts <credsFile> [baseUrl] [--batch=20] [--only=home,collection] [--status]
 *
 * UNA invocación = UN lote (≤ 25 capturas pendientes) con UN Chrome sin cabeza que se cierra al terminar. El estado vive
 * en `after/checkpoint.json` (captura, ruta, viewport, build, hora, clasificación, PASS/RETRY, intentos), así que una
 * ejecución cortada continúa donde quedó. Cada lote registra memoria y PIDs en `after/memory-log.json`.
 *
 * Por qué así (presión de memoria medida): el runner anterior ya usaba un solo Chrome, pero cuando el proceso de Node
 * moría (el sistema lo mata con poca RAM) su Chrome sin cabeza quedaba huérfano; se encontraron 11 procesos colgando
 * del perfil de QA. Ahora: lotes cortos, limpieza al empezar y al acabar de los Chrome de ESTE perfil (por línea de
 * comandos, nunca otros Chrome del usuario) y parada si la RAM libre baja de 2 GB.
 *
 * Clasificación: VALID · INVALID_BACKEND (BD/túnel caído, 5xx) · INVALID_AUTH (401, sin sesión en pantalla real) ·
 * INVALID_RENDER (esqueleto, sin conexión, desbordamiento, texto técnico, página incompleta, sin ambiente) ·
 * INVALID_BUILD (hecha con otra build) · OTHER (429 persistente, fallo de captura). Los 404 de fotos son el fallback.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { freemem, totalmem } from "node:os";
import { createConnection } from "node:net";
import { dirname, join } from "node:path";
import { launch, sleep, type Browser, type Tab } from "./lib/cdp";

/* eslint-disable @typescript-eslint/no-explicit-any */
const CREDS = process.argv[2];
const BASE = process.argv.find((a) => a.startsWith("http")) ?? "http://127.0.0.1:3005";
const ONLY = process.argv.find((a) => a.startsWith("--only="))?.slice(7).split(",");
const BATCH = Math.min(25, Math.max(1, Number(process.argv.find((a) => a.startsWith("--batch="))?.slice(8) ?? 20)));
const STATUS_ONLY = process.argv.includes("--status");
/** Vuelve a poner a cero los intentos de las capturas agotadas (p. ej. 429 por ritmo de la QA). */
const RESET_FAILED = process.argv.includes("--reset-failed");
const ROOT = process.cwd();
const OUT = process.env.F441_OUT ?? join(ROOT, "docs/product/qa/fase44-1/after");
mkdirSync(OUT, { recursive: true });
const CHECKPOINT = join(OUT, "checkpoint.json");
const MEMLOG = join(OUT, "memory-log.json");
const PROFILE = join(CREDS ? dirname(CREDS) : ROOT, "f441-shots-profile");
const MIN_FREE_MB = 2048;
const MAX_ATTEMPTS = 3;
/** Margen para lanzar un lote: el Chrome propio llega a ~1 GB a 2560 px (medido por PIDs del perfil). */
const START_FREE_MB = 3072;
/** Chrome con poca memoria: sin caché atrás/adelante (guardaba las páginas anteriores vivas), un renderer, sin extras. */
const LEAN_ARGS = [
  "--renderer-process-limit=1", "--disable-extensions", "--disable-background-networking", "--disable-component-update",
  "--disable-default-apps", "--disable-sync", "--mute-audio", "--no-pings",
  "--disable-features=BackForwardCache,Translate,OptimizationHints,MediaRouter,AutofillServerCommunication",
  // El proceso de GPU dentro del navegador (un proceso menos) y cachés y montón de JS acotados.
  "--in-process-gpu", "--disk-cache-size=1", "--media-cache-size=1",
];

const SIZES = { "390": [390, 844, 2], "768": [768, 1024, 2], "1024": [1024, 800, 1], "1440": [1440, 900, 1], "1920": [1920, 1080, 1], "2560": [2560, 1440, 1] } as const;
type Size = keyof typeof SIZES;
const ALL: Size[] = ["390", "768", "1024", "1440", "1920", "2560"];
interface Shot { group: string; id: string; path: string; size: Size; scrollY?: number; hover?: string; reduced?: boolean }

const shots: Shot[] = [];
const add = (group: string, id: string, path: string, sizes: Size[], o: Partial<Shot> = {}) => { for (const size of sizes) shots.push({ group, id, path, size, ...o }); };
const H = "/design-system/fase44-1?scene=";

// HOME (≥ 20)
add("home", "home", "/", ALL);
add("home", "home-mid", "/", ["1440", "1920"], { scrollY: 900 });
add("home", "home-low", "/", ["1440", "1920"], { scrollY: 1800 });
add("home", "home-mobile-mid", "/", ["390"], { scrollY: 900 });
add("home", "home-mobile-low", "/", ["390"], { scrollY: 2000 });
for (const m of ["quick", "campaign", "ranked", "draft"]) add("home", `home-hover-${m}`, "/", ["1440", "1920"], { hover: `[data-mode="${m}"]` });
for (const s of ["lobby", "lobby-focus-quick", "lobby-focus-ranked", "lobby-focus-campaign", "lobby-focus-draft"]) add("home", `harness-${s}`, `${H}${s}`, ["1440"]);
// COLLECTION (≥ 20)
add("collection", "collection", "/coleccion", ALL);
for (const y of [700, 1400, 2400]) add("collection", `collection-y${y}`, "/coleccion", ["1440"], { scrollY: y });
for (const y of [900, 1800]) add("collection", `collection-wide-y${y}`, "/coleccion", ["1920"], { scrollY: y });
for (const y of [800, 1800]) add("collection", `collection-mobile-y${y}`, "/coleccion", ["390"], { scrollY: y });
add("collection", "collection-2560-y", "/coleccion", ["2560"], { scrollY: 1000 });
for (const r of ["legendary", "epic", "rare"]) add("collection", `harness-vault-${r}`, `${H}vault-${r}`, ["1440", "390"]);
// PACKS (≥ 20)
add("packs", "shop", "/tienda", ALL);
for (const y of [700, 1400]) add("packs", `shop-y${y}`, "/tienda", ["1440"], { scrollY: y });
for (const y of [800, 1600]) add("packs", `shop-mobile-y${y}`, "/tienda", ["390"], { scrollY: y });
add("packs", "inventory", "/inventario", ALL);
for (const s of ["chamber", "chamber-dim"]) add("packs", `harness-${s}`, `${H}${s}`, ["1440", "390"]);
add("packs", "ceremony-legendary", "/design-system/fase38?scene=stage-hand-legendary", ["1440", "390"]);
// DECKS / STRATEGY (≥ 15)
add("decks", "decks", "/duelos/mazos", ALL);
for (const y of [700, 1400]) add("decks", `decks-y${y}`, "/duelos/mazos", ["1440"], { scrollY: y });
for (const y of [800, 1600]) add("decks", `decks-mobile-y${y}`, "/duelos/mazos", ["390"], { scrollY: y });
add("decks", "strategy-lab", "/design-system/fase43?scene=legal-balanced", ["1440", "390"]);
add("decks", "harness-loadout", `${H}loadout`, ["1440", "390"]);
add("decks", "decks-2560-y", "/duelos/mazos", ["1920"], { scrollY: 800 });
// CAMPAIGN (≥ 15)
add("campaign", "campaign", "/jugar/road-to-champions", ALL);
for (const y of [700, 1400, 2200]) add("campaign", `campaign-y${y}`, "/jugar/road-to-champions", ["1440"], { scrollY: y });
for (const y of [800, 1800, 2800]) add("campaign", `campaign-mobile-y${y}`, "/jugar/road-to-champions", ["390"], { scrollY: y });
add("campaign", "harness-campaign", `${H}campaign`, ["1440", "390"]);
add("campaign", "campaign-wide-y", "/jugar/road-to-champions", ["1920"], { scrollY: 900 });
// DRAFT (≥ 10)
add("draft", "draft", "/jugar/draft-gauntlet", ALL);
for (const y of [600, 1200]) add("draft", `draft-y${y}`, "/jugar/draft-gauntlet", ["1440"], { scrollY: y });
add("draft", "draft-mobile-y", "/jugar/draft-gauntlet", ["390"], { scrollY: 900 });
add("draft", "harness-draft", `${H}draft`, ["1440"]);
// RANKED (≥ 10)
add("ranked", "ranked", "/duelos/competitivo", ALL);
for (const y of [600, 1200]) add("ranked", `ranked-y${y}`, "/duelos/competitivo", ["1440"], { scrollY: y });
add("ranked", "ranked-mobile-y", "/duelos/competitivo", ["390"], { scrollY: 900 });
add("ranked", "harness-ranked", `${H}ranked`, ["1440"]);
// SEASON (≥ 10)
add("season", "season", "/temporada", ALL);
for (const y of [700, 1400]) add("season", `season-y${y}`, "/temporada", ["1440"], { scrollY: y });
add("season", "season-mobile-y", "/temporada", ["390"], { scrollY: 900 });
add("season", "harness-season", `${H}season`, ["1440"]);
// RESPONSIVE / REDUCED (≥ 30)
for (const [id, p] of [["home", "/"], ["collection", "/coleccion"], ["shop", "/tienda"], ["decks", "/duelos/mazos"], ["campaign", "/jugar/road-to-champions"], ["draft", "/jugar/draft-gauntlet"], ["ranked", "/duelos/competitivo"], ["season", "/temporada"], ["profile", "/jugador/me"], ["achievements", "/logros"]] as const) {
  add("reduced", `${id}-reduced`, p, ["1440", "390"], { reduced: true });
}
add("responsive", "profile", "/jugador/me", ALL);
add("responsive", "achievements", "/logros", ["390", "768", "1440", "1920"]);
// ARNÉS: mundos, música, efectos, scroll
for (const v of ["lobby", "collection", "packs", "loadout", "campaign", "draft", "ranked", "season", "match", "events", "profile", "world"]) add("worlds", `world-${v}`, `${H}world-${v}`, ["1440"]);
for (const s of ["music", "sfx", "scroll", "reduced"]) add("harness", `harness-${s}`, `${H}${s}`, ["1440"], s === "reduced" ? { reduced: true } : {});

type Status = "PENDING" | "VALID" | "INVALID_BACKEND" | "INVALID_AUTH" | "INVALID_RENDER" | "INVALID_BUILD" | "OTHER";
interface Entry extends Shot { key: string; file: string; status: Status; result: "PASS" | "RETRY" | "PENDING"; attempts: number; build: string | null; at: string | null; reasons: string[]; metrics: any }

const keyOf = (s: Shot) => `${s.group}|${s.id}|${s.size}|${s.reduced ? "r" : "n"}`;
const fileOf = (s: Shot, i: number) => `${String(i + 1).padStart(3, "0")}-${s.group}-${s.id}-${s.size}${s.reduced ? "-reduced" : ""}.png`;

/** Huella de la build servida: el manifiesto de la build de producción en disco (cambia con cada `next build`). */
function buildHash(): string {
  const parts = [".next/BUILD_ID", ".next/build-manifest.json", ".next/app-build-manifest.json", ".next/routes-manifest.json"]
    .filter((p) => existsSync(join(ROOT, p))).map((p) => readFileSync(join(ROOT, p), "utf8"));
  return createHash("sha1").update(parts.join("\n")).digest("hex").slice(0, 12);
}

const freeMb = () => Math.round(freemem() / 1048576);

/** PIDs de Chrome lanzados con NUESTRO perfil (nunca otros Chrome del usuario). */
function myChromePids(): number[] {
  try {
    const needle = PROFILE.replace(/'/g, "''");
    const out = execFileSync("powershell", ["-NoProfile", "-Command", `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('${needle}') } | ForEach-Object { $_.ProcessId }`], { encoding: "utf8" });
    return out.split(/\s+/).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  } catch { return []; }
}
/** Memoria de trabajo (MB) de NUESTROS procesos Chrome. */
function myChromeMb(): number {
  try {
    const needle = PROFILE.replace(/'/g, "''");
    const out = execFileSync("powershell", ["-NoProfile", "-Command", `(Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('${needle}') } | Measure-Object WorkingSetSize -Sum).Sum`], { encoding: "utf8" });
    return Math.round((Number(out.trim()) || 0) / 1048576);
  } catch { return -1; }
}
function killMyChrome(): number[] {
  const pids = myChromePids();
  for (const pid of pids) { try { process.kill(pid); } catch { /* ya no existe */ } }
  return pids;
}

function loadCheckpoint(build: string): Entry[] {
  const prev: Record<string, Entry> = {};
  if (existsSync(CHECKPOINT)) for (const e of JSON.parse(readFileSync(CHECKPOINT, "utf8")).entries as Entry[]) prev[e.key] = e;
  return shots.map((s, i) => {
    const p = prev[keyOf(s)];
    const base: Entry = { ...s, key: keyOf(s), file: fileOf(s, i), status: "PENDING", result: "PENDING", attempts: 0, build: null, at: null, reasons: [], metrics: null };
    if (!p) return base;
    const e = { ...base, status: p.status, result: p.result, attempts: p.attempts, build: p.build, at: p.at, reasons: p.reasons, metrics: p.metrics };
    if (e.status === "VALID" && e.build !== build) { e.status = "INVALID_BUILD"; e.result = "RETRY"; e.reasons = [`build ${e.build} ≠ ${build}`]; }
    if (e.status === "VALID" && !existsSync(join(OUT, e.file))) { e.status = "OTHER"; e.result = "RETRY"; e.reasons = ["falta el PNG"]; }
    return e;
  });
}
function saveCheckpoint(entries: Entry[], build: string) {
  const count: Record<string, number> = {};
  for (const e of entries) count[e.status] = (count[e.status] ?? 0) + 1;
  writeFileSync(CHECKPOINT, JSON.stringify({ updatedAt: new Date().toISOString(), base: BASE, build, total: entries.length, count, entries }, null, 2) + "\n");
  // Resumen compatible con el verificador (solo las VÁLIDAS de esta build cuentan como capturas AFTER).
  const rows = entries.filter((e) => e.status === "VALID" && e.build === build).map((e) => ({ file: e.file, group: e.group, id: e.id, path: e.path, size: e.size, reduced: !!e.reduced, scrollY: e.scrollY ?? 0, hover: e.hover ?? null, build: e.build, at: e.at, ...e.metrics }));
  const by: Record<string, number> = {};
  for (const r of rows) by[r.group] = (by[r.group] ?? 0) + 1;
  writeFileSync(join(OUT, "shots.json"), JSON.stringify({ generatedAt: new Date().toISOString(), base: BASE, build, count: rows.length, total: entries.length, byGroup: by, rows }, null, 2) + "\n");
}

const tcpOpen = (port: number) => new Promise<boolean>((res) => { const s = createConnection({ host: "127.0.0.1", port }); s.once("connect", () => { s.destroy(); res(true); }); s.once("error", () => res(false)); s.setTimeout(2000, () => { s.destroy(); res(false); }); });

const METRICS = `(() => {
  const vw = innerWidth;
  const text = document.body.innerText || '';
  const technical = (text.match(/(TypeError|ReferenceError|undefined is not|Cannot read properties|stack trace|ECONNREFUSED|500 Internal|Application error)/g) || []).slice(0, 3);
  const env = document.querySelector('[data-environment]');
  const visible = (sel) => [...document.querySelectorAll(sel)].some((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
  const session = Object.keys(localStorage).some((k) => /^sb-.*-auth-token$/.test(k));
  return {
    overflow: document.documentElement.scrollWidth > vw + 1, technical,
    environment: env ? env.getAttribute('data-environment') : null, motion: env ? env.getAttribute('data-motion') : null,
    docHeight: document.documentElement.scrollHeight, y: Math.round(scrollY), textLength: text.length,
    skeleton: visible('[data-testid="daily-skeleton"], [data-testid="game-loader"], [data-testid="draft-loading"], .nx-skel'),
    offline: visible('[data-testid="game-offline"], [data-testid="collection-offline"], [data-testid="draft-offline"], [data-network="offline"]'),
    gameError: visible('[data-testid="game-error"]'), session,
    stale: !!document.querySelector('[data-stale="true"], [data-network="error"], [data-testid="daily-partial"]') || /SIN RESPUESTA|El servidor no ha respondido|servidor tarda demasiado/i.test(text),
  };
})()`;

function classify(s: Shot, m: any, errors: string[]): { status: Status; reasons: string[]; retry429: boolean } {
  const real = !s.path.startsWith("/design-system");
  const reasons: string[] = [];
  if (!m || typeof m !== "object") return { status: "OTHER", reasons: ["la página no devolvió métricas"], retry429: false };
  if (errors.some((e) => /ERR_CONNECTION_REFUSED/.test(e))) reasons.push("BD/túnel inaccesible");
  if (errors.some((e) => /status of 5\d\d/.test(e))) reasons.push("error 5xx de API");
  if (m.stale) reasons.push("respuesta del servidor caducada/parcial (foto vieja)");
  if (reasons.length) return { status: "INVALID_BACKEND", reasons, retry429: false };
  if (errors.some((e) => /status of 401|No autenticado/.test(e)) || (real && !m.session)) return { status: "INVALID_AUTH", reasons: ["sin sesión o 401"], retry429: false };
  if (m.skeleton) reasons.push("esqueleto permanente");
  if (m.offline) reasons.push("estado sin conexión");
  if (m.gameError) reasons.push("pantalla de error");
  if (m.overflow) reasons.push("desbordamiento horizontal");
  if (m.technical.length) reasons.push(`texto técnico: ${m.technical}`);
  if (m.textLength < 60) reasons.push("página incompleta");
  if (real && !m.environment) reasons.push("sin ambiente");
  if (reasons.length) return { status: "INVALID_RENDER", reasons, retry429: false };
  if (errors.some((e) => /status of 429/.test(e))) return { status: "OTHER", reasons: ["429 (ritmo)"], retry429: true };
  return { status: "VALID", reasons: [], retry429: false };
}

async function login(tab: Tab): Promise<boolean> {
  const creds = CREDS && existsSync(CREDS) ? JSON.parse(readFileSync(CREDS, "utf8")) : null;
  if (!creds) return false;
  await tab.goto(`${BASE}/cuenta`, 4000);
  if (await tab.js<boolean>(`!!document.querySelector('input[type="password"]')`)) {
    await tab.js(`(() => { const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }; set(document.querySelector('input[type="email"]'), ${JSON.stringify(creds.email)}); set(document.querySelector('input[type="password"]'), ${JSON.stringify(creds.password)}); document.querySelector('form button[type="submit"]').click(); })()`);
  }
  for (let i = 0; i < 60; i++) { if (await tab.js<boolean>(`/cerrar sesión/i.test(document.body.innerText)`).catch(() => false)) return true; await sleep(500); }
  return false;
}

async function main() {
  const build = buildHash();
  const entries = loadCheckpoint(build);
  if (RESET_FAILED) for (const e of entries) if (e.status !== "VALID") e.attempts = 0;
  const pending = entries.filter((e) => e.status !== "VALID" && e.attempts < MAX_ATTEMPTS && (!ONLY || ONLY.includes(e.group)));
  const count = (st: Status) => entries.filter((e) => e.status === st).length;
  console.log(`build ${build} · válidas ${count("VALID")}/${entries.length} · pendientes ${pending.length} · RAM libre ${freeMb()} MB`);
  if (STATUS_ONLY) { saveCheckpoint(entries, build); return; }
  if (pending.length === 0) { saveCheckpoint(entries, build); console.log("NADA PENDIENTE"); return; }

  const orphans = killMyChrome();
  if (orphans.length) console.log(`huérfanos de este perfil eliminados: ${orphans.join(",")}`);
  // Espera (hasta 3 min) a tener margen antes de lanzar Chrome; si no llega, sale sin tocar nada.
  for (let i = 0; i < 36 && freeMb() < START_FREE_MB; i++) await sleep(5000);
  const ramBefore = freeMb();
  if (ramBefore < START_FREE_MB) { console.log(`ESPERA: RAM libre ${ramBefore} MB < ${START_FREE_MB} MB para lanzar un lote`); process.exitCode = 3; return; }
  if (!(await tcpOpen(54521))) { console.log("PARADA: túnel 54521 cerrado"); process.exitCode = 4; return; }
  const ping = await fetch(`${BASE}/api/game/play-status`).then((r) => r.status).catch(() => 0);
  if (ping !== 200) { console.log(`PARADA: ${BASE} no responde (${ping})`); process.exitCode = 4; return; }

  // Con poca memoria libre, primero las ventanas pequeñas (el renderer a 2560 px cuesta ~3× más que a 390 px).
  const area = (e: Entry) => SIZES[e.size][0] * SIZES[e.size][1] * SIZES[e.size][2] ** 2;
  if (ramBefore < 4096) pending.sort((a1, b1) => area(a1) - area(b1));
  const batch = pending.slice(0, BATCH);
  const t0 = Date.now();
  let browser: Browser | null = null;
  let peakPids = 0;
  let peakChromeMb = 0;
  let minFree = ramBefore;
  const done: string[] = [];
  const retried: string[] = [];
  const onExit = () => { killMyChrome(); };
  process.once("SIGINT", onExit); process.once("SIGTERM", onExit);
  try {
    browser = await launch({ width: 1440, height: 900, userDataDir: PROFILE, args: LEAN_ARGS });
    const tab = browser.tab;
    if (!(await login(tab))) { console.log("PARADA: login QA no confirmado"); process.exitCode = 5; return; }
    for (const e of batch) {
      if (freeMb() < MIN_FREE_MB) { console.log(`PARADA a mitad de lote: RAM libre ${freeMb()} MB`); process.exitCode = 3; break; }
      const [w, h, dpr] = SIZES[e.size];
      await tab.resize(w, h, dpr);
      await tab.setMedia([{ name: "prefers-reduced-motion", value: e.reduced ? "reduce" : "no-preference" }]);
      // Suelta la página anterior antes de la siguiente (sin bfcache no queda viva en memoria).
      await tab.send("Page.navigate", { url: "about:blank" }).catch(() => null);
      await sleep(300);
      tab.takeErrors();
      e.attempts++;
      try {
        await tab.goto(`${BASE}${e.path}`, 6500);
        if (e.scrollY) { await tab.js(`window.scrollTo(0, ${e.scrollY})`); await sleep(900); }
        if (e.hover) {
          const box = await tab.js<any>(`(() => { const r = document.querySelector(${JSON.stringify(e.hover)})?.getBoundingClientRect(); return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; })()`);
          if (box) { await tab.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x, y: box.y }); await sleep(600); }
        } else {
          await tab.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: Math.round(w * 0.62), y: Math.round(h * 0.4) });
          await sleep(200);
        }
        await tab.shot(join(OUT, e.file)); // el PNG va directo a disco; no se guarda en memoria
        const m = await tab.js<any>(METRICS);
        const errors = tab.takeErrors().filter((x) => !/favicon|DevTools/i.test(x));
        const c = classify(e, m, errors);
        e.status = c.status; e.reasons = c.reasons; e.build = build; e.at = new Date().toISOString();
        e.metrics = { ...m, errors404: errors.filter((x) => /status of 404/.test(x)).length, errors429: errors.filter((x) => /status of 429/.test(x)).length };
        e.result = c.status === "VALID" ? "PASS" : "RETRY";
        if (c.status !== "VALID") retried.push(e.file);
        if (c.retry429) await sleep(15000);
      } catch (err) {
        e.status = "OTHER"; e.result = "RETRY"; e.reasons = [String(err).slice(0, 160)]; e.build = build; e.at = new Date().toISOString();
        retried.push(e.file);
      }
      done.push(e.file);
      peakPids = Math.max(peakPids, myChromePids().length);
      const wsMb = myChromeMb();
      peakChromeMb = Math.max(peakChromeMb, wsMb);
      minFree = Math.min(minFree, freeMb());
      (e.metrics ??= {}).chromeMb = wsMb;
      console.log(`  ${e.file} · ${e.status} · Chrome ${wsMb} MB · libre ${freeMb()} MB${e.reasons.length ? ` · ${e.reasons.join("; ")}` : ""}`);
      saveCheckpoint(entries, build);
      await sleep(800);
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    await sleep(2500);
    const leftover = killMyChrome();
    const ramAfter = freeMb();
    const log = existsSync(MEMLOG) ? JSON.parse(readFileSync(MEMLOG, "utf8")) : { batches: [] };
    const row = {
      batch: log.batches.length + 1, at: new Date().toISOString(), build, screenshots: done.length, retried, chromePidsPeak: peakPids,
      leftoverPidsKilled: leftover, ramFreeBeforeMb: ramBefore, ramFreeMinMb: minFree, ramFreeAfterMb: ramAfter, chromeMbPeak: peakChromeMb, ramTotalMb: Math.round(totalmem() / 1048576),
      durationS: Math.round((Date.now() - t0) / 1000), valid: entries.filter((e) => e.status === "VALID").length,
    };
    log.batches.push(row);
    writeFileSync(MEMLOG, JSON.stringify(log, null, 2) + "\n");
    saveCheckpoint(entries, build);
    console.log(`lote ${row.batch}: ${done.length} capturas · reintentar ${retried.length} · Chrome pico ${peakPids} PIDs · huérfanos tras cerrar ${leftover.length} · Chrome propio pico ${peakChromeMb} MB · RAM libre ${ramBefore}→mín ${minFree}→${ramAfter} MB · ${row.durationS} s · válidas ${row.valid}/${entries.length}`);
  }
}
void main();
