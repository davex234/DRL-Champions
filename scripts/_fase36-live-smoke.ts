/**
 * FASE 36 · SMOKE REAL LOCAL (instrumento `_`, fuera de CI).
 *
 *   npx tsx scripts/_fase36-live-smoke.ts <credsFile>
 *
 * App LOCAL (`next start`, :3005) → API real → Supabase del VPS por túnel SSH, con la cuenta QA de la Fase 35.2 y el
 * formulario real de /cuenta. SOLO LECTURA: no juega, no abre sobres, no reclama, no gasta. Comprueba el vestíbulo con
 * datos reales, las rutas del loop y la API `GET /api/game/daily-loop` (seguridad y caché). Nunca imprime correo,
 * contraseña ni tokens. Capturas en docs/product/qa/fase36/real-*.png.
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
const OUT = join(process.cwd(), "docs", "product", "qa", "fase36");
mkdirSync(OUT, { recursive: true });
const [credsFile] = process.argv.slice(2);
const creds = JSON.parse(readFileSync(credsFile, "utf8")) as { email: string; password: string; userId: string };
const PROFILE = join(credsFile, "..", "f36-chrome-profile");
const log = (s: string) => console.log(s);
const esc = (s: string) => JSON.stringify(s);

const waitFor = async (tab: Tab, expr: string, ms = 20000) => {
  for (let i = 0; i < ms / 250; i++) { if (await tab.js<boolean>(expr)) return true; await sleep(250); }
  return false;
};

async function apiToken(): Promise<string> {
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const { data, error } = await anon.auth.signInWithPassword({ email: creds.email, password: creds.password });
  if (error || !data.session) throw new Error("login QA falló");
  return data.session.access_token;
}

async function login(tab: Tab) {
  await tab.goto(`${BASE}/cuenta`, 3500);
  const signedIn = `(() => !document.querySelector('input[type="password"]') && /cerrar sesión|salir/i.test(document.body.innerText))()`;
  if (!(await tab.js<boolean>(signedIn))) {
    const filled = await tab.js<boolean>(`(() => {
      const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
      const e = document.querySelector('input[type="email"]'); const p = document.querySelector('input[type="password"]');
      if (!e || !p) return false; set(e, ${esc(creds.email)}); set(p, ${esc(creds.password)}); return true; })()`);
    log(`login_form_found=${filled}`);
    await tab.js(`document.querySelector('form button[type="submit"]')?.click()`);
    await waitFor(tab, signedIn, 20000);
  }
  log(`session_via_real_form=${await tab.js<boolean>(signedIn)}`);
}

async function secretScan(tab: Tab): Promise<string> {
  const secrets = [process.env.SUPABASE_SERVICE_ROLE_KEY, process.env.SYNC_SECRET].filter((x): x is string => !!x && x.length > 16);
  const urls = await tab.js<string[]>(`[...new Set([location.href, ...performance.getEntriesByType('resource').map(e => e.name)])].filter(u => u.startsWith(location.origin))`);
  let scanned = 0; let leaks = 0;
  for (const u of urls) {
    try { const body = await (await fetch(u)).text(); scanned++; if (secrets.some((s) => body.includes(s))) leaks++; } catch { /* no reutilizable */ }
  }
  return `same_origin_resources=${scanned} secret_leaks=${leaks}`;
}

async function api(token: string | null, path = "/api/game/daily-loop", init: RequestInit = {}) {
  const r = await fetch(`${BASE}${path}`, { ...init, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) } });
  const text = await r.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* no JSON */ }
  return { status: r.status, cache: r.headers.get("cache-control"), json, text };
}

async function main() {
  const token = await apiToken();

  // ── API real
  const t0 = Date.now();
  const me = await api(token);
  log(`api_personal status=${me.status} cache=${me.cache} ms=${Date.now() - t0}`);
  const s = me.json;
  if (s) {
    log(`primary=${s.primaryAction?.id} cta="${s.primaryAction?.cta}" href=${s.primaryAction?.href} title="${s.primaryAction?.title}"`);
    log(`secondary=${(s.secondaryActions ?? []).map((a: any) => `${a.id}→${a.href}`).join(" | ")}`);
    log(`campaign=${JSON.stringify(s.campaign)}`);
    log(`deck=${JSON.stringify(s.deck ? { state: s.deck.state, active: s.deck.active?.name ?? null, size: s.deck.active?.size ?? null } : null)}`);
    log(`competitive=${JSON.stringify(s.competitive)}`);
    log(`packs=${JSON.stringify(s.packs)} collection=${JSON.stringify(s.collection)} achievements=${JSON.stringify(s.achievements && { total: s.achievements.total, claimed: s.achievements.claimed, claimable: s.achievements.claimable })}`);
    log(`player=${JSON.stringify(s.player)} pass=${JSON.stringify(s.season?.pass && { level: s.season.pass.level, xp: s.season.pass.xp, next: s.season.pass.nextReward })}`);
    log(`season=${JSON.stringify(s.season?.current && { name: s.season.current.name, presentation: s.season.current.presentation })} next=${JSON.stringify(s.season?.next)}`);
    log(`objectives=${JSON.stringify(s.objectives && { daily: s.objectives.daily, weekly: s.objectives.weekly, claimable: s.objectives.claimable, rotationPending: s.objectives.rotationPending, near: s.objectives.near?.label ?? null })}`);
    log(`today=${(s.today ?? []).map((i: any) => `${i.id}:${i.status}`).join(", ")}`);
    log(`live=${JSON.stringify(s.live && { featured: s.live.featured && { name: s.live.featured.name, lifecycle: s.live.featured.lifecycle, liveCount: s.live.featured.liveCount }, upcoming: s.live.upcoming?.name ?? null, pickemPending: s.live.pickemPending })}`);
    log(`social=${JSON.stringify(s.social)} ftue=${JSON.stringify(s.ftue?.steps?.map((x: any) => `${x.id}:${x.done}`) ?? null)} unavailable=${JSON.stringify(s.unavailable)}`);
    const leaks = [creds.email, "is_admin", "\"email\"", "\"credits\"", "option_key", "\"state\":{", "\"rng\""].filter((k) => me.text.includes(k));
    log(`api_personal_leaks=${leaks.length === 0 ? "none" : leaks.map((k) => (k === creds.email ? "<own-email>" : k)).join(",")}`);
  }
  const again = await api(token);
  log(`api_second_read status=${again.status} same_primary=${again.json?.primaryAction?.id === s?.primaryAction?.id}`);
  const anon = await api(null);
  log(`api_anonymous status=${anon.status} cache=${anon.cache} primary=${anon.json?.primaryAction?.id} personal_null=${anon.json?.player === null && anon.json?.packs === null}`);
  const withUser = await api(token, `/api/game/daily-loop?userId=${creds.userId}`);
  log(`api_userId_param status=${withUser.status} code=${withUser.json?.code}`);
  const post = await api(token, "/api/game/daily-loop", { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
  log(`api_post status=${post.status}`);
  const badToken = await api("not-a-token");
  log(`api_bad_token status=${badToken.status} primary=${badToken.json?.primaryAction?.id}`);

  // ── Navegador real
  const b = await launch({ width: 1440, height: 900, userDataDir: PROFILE });
  const tab = b.tab;
  try {
    await login(tab);
    for (const [w, h] of [[1440, 900], [1024, 800], [390, 844]] as const) {
      await tab.resize(w, h);
      const started = Date.now();
      await tab.goto(`${BASE}/`, 1500);
      const ready = await waitFor(tab, `!!document.querySelector('[data-testid="daily-hero"]') && document.querySelector('[data-testid="daily-lobby"]')?.getAttribute("data-signed-in") === "true"`, 20000);
      const facts = await tab.js<any>(`(() => {
        const lobby = document.querySelector('[data-testid="daily-lobby"]');
        const hero = document.querySelector('[data-testid="daily-hero"]');
        const cta = document.querySelector('[data-testid="daily-primary-cta"]');
        const small = lobby ? [...lobby.querySelectorAll("a, button")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 43.5; }).length : -1;
        return {
          network: lobby?.getAttribute("data-network"), action: hero?.getAttribute("data-action"), h1: hero?.querySelector("h1")?.textContent,
          cta: cta?.textContent, href: cta?.getAttribute("href"), deck: document.querySelector('[data-testid="daily-deck"]')?.getAttribute("data-state"),
          campaign: document.querySelector('[data-testid="daily-campaign"]')?.textContent?.replace(/\\s+/g, " ").slice(0, 160),
          competitive: document.querySelector('[data-testid="daily-competitive"]')?.textContent?.replace(/\\s+/g, " ").slice(0, 160),
          todayRows: document.querySelectorAll('[data-testid="daily-today"] li').length,
          overflow: Math.max(0, document.documentElement.scrollWidth - window.innerWidth), small,
          liveBadges: [...document.querySelectorAll("[data-badge]")].map((e) => e.getAttribute("data-badge")),
        };
      })()`);
      log(`home_${w} ready=${ready} in=${((Date.now() - started) / 1000).toFixed(1)}s ${JSON.stringify(facts)}`);
      await sleep(3000); // la transición de página del shell (logo NEXUS) se superpone ~2 s
      await tab.shot(join(OUT, `real-01-home-${w}.png`));
      if (w === 1440) {
        await tab.resize(1440, 3200); await sleep(600);
        await tab.shot(join(OUT, "real-02-home-full-1440.png"));
        await tab.resize(1440, 900);
        log(await secretScan(tab));
        log(`storage_keys=${(await tab.js<string[]>("Object.keys(localStorage)")).length}`);
      }
    }
    const routes = ["/jugar", "/temporada", "/duelos/competitivo", "/jugar/road-to-champions", "/torneos", "/coleccion", "/packs", "/inventario", "/jugador/me"];
    let i = 3;
    for (const r of routes) {
      await tab.goto(`${BASE}${r}`, 7000);
      const info = await tab.js<any>(`({ path: location.pathname, title: document.querySelector("h1")?.textContent?.trim().slice(0, 60) ?? null, error: /Error de servidor|Application error|Internal Server Error|No se pudo cargar la página/.test(document.body.innerText.slice(0, 2000)), overflow: Math.max(0, document.documentElement.scrollWidth - window.innerWidth) })`);
      log(`route ${r} → ${JSON.stringify(info)}`);
      await tab.shot(join(OUT, `real-${String(i++).padStart(2, "0")}-${r.replace(/\//g, "_").replace(/^_/, "")}-1440.png`));
    }
    const errs = tab.takeErrors().filter((e) => !/players\/.*\.(png|webp)|404|Failed to load resource/i.test(e));
    log(`console_errors=${errs.length}`);
    for (const e of errs.slice(0, 10)) log(`  ✗ ${e.slice(0, 200)}`);
  } finally {
    await b.close();
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
