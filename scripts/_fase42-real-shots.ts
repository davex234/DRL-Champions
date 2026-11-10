/**
 * FASE 42 · CAPTURAS REALES DEL VESTÍBULO (instrumento `_`, fuera de CI) — `npx tsx scripts/_fase42-real-shots.ts <credsFile>`
 *
 * Chrome → app local (:3005) → túnel SSH → BD del VPS, con la cuenta QA existente (login por el formulario de
 * `/cuenta`). Home a 1440/1024/390 (héroe, hoy/semana, caducidades, temporada, directo), Logros, Temporada, Pick'ems y
 * el evento real con Pick'em abierto. Mide en el DOM lo que pinta el live service y comprueba en BD (solo lectura) que
 * visitar y dejar abierta la home 70 s (refresco automático) no escribe nada. Sin PII en capturas ni registros.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { launch, sleep, type Tab } from "./lib/cdp";

/* eslint-disable @typescript-eslint/no-explicit-any */
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3005";
const OUT = join(process.cwd(), "docs", "product", "qa", "fase42", "real");
mkdirSync(OUT, { recursive: true });
const credsFile = process.argv[2];
const creds = JSON.parse(readFileSync(credsFile, "utf8")) as { email: string; password: string; userId: string };
const U = creds.userId;
const PROFILE = join(credsFile, "..", "f42-chrome-profile");
const LOG = join(OUT, "real-shots.log");
writeFileSync(LOG, "");
const log = (s: string) => { console.log(s); appendFileSync(LOG, s + "\n"); };
let failures = 0;
const check = (label: string, cond: boolean, detail = "") => { if (!cond) failures++; log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`); };
const esc = (s: string) => JSON.stringify(s);
let n = 0;
const rows: Record<string, unknown>[] = [];

function fp(): string {
  const sql = `
select 'credits', credits::text from public.profiles where id = '${U}';
select 'xp', xp::text from public.profiles where id = '${U}';
select 'packs', coalesce(string_agg(pack_id || '=' || qty, ',' order by pack_id), '') from public.user_packs where user_id = '${U}';
select 'cards', count(*)::text from public.user_cards where user_id = '${U}';
select 'matches', count(*)::text || '/' || coalesce(max(updated_at)::text, '') from public.duel_matches where user_id = '${U}';
select 'rating', coalesce((select rating || '/' || games_played || '/' || updated_at from public.duel_pvp_ratings where user_id = '${U}'), 'none');
select 'pass', coalesce((select md5(state::text) || '/' || updated_at from public.user_pass where user_id = '${U}'), 'none');
select 'ledger', count(*)::text || '/' || coalesce(sum(delta), 0) from public.credit_transactions where user_id = '${U}';
select 'ops', count(*)::text from public.economy_ops where user_id = '${U}';
select 'achievements', count(*)::text from public.user_achievements where user_id = '${U}';
select 'draft', count(*)::text from public.draft_runs where user_id = '${U}';
select 'campaign', count(*)::text from public.campaign_progress where user_id = '${U}';
`;
  return execFileSync("ssh", ["-i", join(homedir(), ".ssh", "id_ed25519"), "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", "nexusadmin@212.95.40.144",
    "docker exec -i supabase_db_DRLCards psql -U postgres -d postgres -At -F ' | ' -v ON_ERROR_STOP=1 -c 'set default_transaction_read_only = on;' -f -"], { input: sql, encoding: "utf8" }).trim();
}

const waitFor = async (tab: Tab, expr: string, ms = 20000) => {
  for (let i = 0; i < ms / 200; i++) { if (await tab.js<boolean>(expr).catch(() => false)) return true; await sleep(200); }
  return false;
};
const setInputs = (pairs: [string, string][]) => `(() => {
  const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
  ${pairs.map(([sel, v]) => `{ const e = document.querySelector(${esc(sel)}); if (!e) return false; set(e, ${esc(v)}); }`).join("\n")}
  return true; })()`;
const SIGNED_IN = `(() => !document.querySelector('input[type="password"]') && /cerrar sesión/i.test(document.body.innerText))()`;
const LOBBY = `(() => {
  const q = (s) => document.querySelector(s); const t = (s) => q(s)?.textContent?.trim() ?? null;
  const vw = window.innerWidth;
  const sec = (id) => { const el = q('[data-testid="' + id + '"]'); return el ? { done: el.getAttribute('data-done'), rows: [...el.querySelectorAll('li a')].map((a) => a.getAttribute('data-status')), reset: t('[data-testid="' + id + '-reset"]') } : null; };
  const small = [...document.querySelectorAll('[data-testid="daily-lobby"] a[href], [data-testid="daily-lobby"] button')].filter((el) => { const r = el.getBoundingClientRect(); return r.height > 0 && r.height < 44 && r.width > 0; }).length;
  return {
    hero: q('[data-testid="daily-hero"]')?.getAttribute('data-action') ?? null, heroReason: t('[data-testid="daily-hero-reason"]'), heroDeadline: t('[data-testid="daily-hero-deadline"]'),
    daily: sec('daily-today-daily'), weekly: sec('daily-today-weekly'),
    expiring: [...document.querySelectorAll('[data-testid="daily-expiring"] a')].map((a) => a.getAttribute('data-urgency') + ':' + a.textContent.trim()),
    returning: q('[data-testid="daily-returning"]') ? [...document.querySelectorAll('[data-testid="daily-returning"] li')].map((li) => li.textContent.trim()) : null,
    recent: document.querySelectorAll('[data-testid="daily-recent"] li').length,
    claimAll: /reclamar todo/i.test(document.body.innerText), streak: /racha/i.test(document.body.innerText), market: /mercado/i.test(q('[data-testid="daily-lobby"]')?.innerText ?? ''),
    liveCta: /ver en directo/i.test(q('[data-testid="daily-lobby"]')?.innerText ?? ''),
    overflow: document.documentElement.scrollWidth > vw + 1, small,
  }; })()`;

async function shot(tab: Tab, name: string, extra: Record<string, unknown> = {}) {
  const file = `real-${String(++n).padStart(2, "0")}-${name}.png`;
  await tab.shot(join(OUT, file));
  rows.push({ file, kind: "REAL", ...extra });
  log(`    📸 ${file}`);
}

async function home(tab: Tab) {
  await tab.goto(`${BASE}/`, 3000);
  await waitFor(tab, `!!document.querySelector('[data-testid="daily-lobby"]') && !document.querySelector('[aria-busy="true"]')`, 25000);
  await sleep(1500);
  return tab.js<any>(LOBBY);
}

async function main() {
  log(`FASE 42 · capturas REALES · cuenta ${U.slice(0, 8)} · ${BASE}`);
  const b = await launch({ width: 1440, height: 900, userDataDir: PROFILE });
  const tab = b.tab;
  try {
    await tab.goto(`${BASE}/cuenta`, 3500);
    if (!(await tab.js<boolean>(SIGNED_IN))) {
      await tab.js(setInputs([['input[type="email"]', creds.email], ['input[type="password"]', creds.password]]));
      await tab.js(`document.querySelector('form button[type="submit"]')?.click()`);
    }
    check("sesión QA iniciada por el formulario", await waitFor(tab, SIGNED_IN, 25000));

    const f0 = fp();
    log("\n· HOME REAL");
    for (const [w, h, name] of [[1440, 900, "home-1440"], [1024, 800, "home-1024"], [390, 844, "home-390"]] as const) {
      await tab.resize(w, h);
      const m = await home(tab);
      log(`    ${name}: ${JSON.stringify(m)}`);
      await shot(tab, name, { size: `${w}x${h}`, ...m });
      check(`${name}: héroe con razón`, !!m.hero && !!m.heroReason, `${m.hero} · ${m.heroReason}`);
      check(`${name}: hoy y semana separados con cuenta atrás de reset`, !!m.daily?.reset && !!m.weekly?.reset, `${m.daily?.reset} · ${m.weekly?.reset}`);
      check(`${name}: sin «Reclamar todo», racha ni mercado`, !m.claimAll && !m.streak && !m.market);
      check(`${name}: sin «Ver en directo» de un evento demo`, !m.liveCta);
      check(`${name}: sin desbordamiento horizontal`, !m.overflow);
      for (const [sel, tag] of [['[data-testid="daily-today-daily"]', "today"], ['[data-testid="daily-expiring"]', "expiring"], ['#season, [data-testid="daily-recent"]', "season"], ['#live', "live"]] as const) {
        const found = await tab.js<boolean>(`(() => { const e = document.querySelector(${esc(sel)}); if (!e) return false; e.scrollIntoView({ block: "center" }); return true; })()`);
        if (found) { await sleep(500); await shot(tab, `${name}-${tag}`, { size: `${w}x${h}` }); }
      }
    }
    await tab.resize(1440, 900);
    await home(tab);
    log("    home abierta 70 s (refresco automático de 60 s)…");
    await sleep(70_000);
    const m2 = await tab.js<any>(LOBBY);
    await shot(tab, "home-after-refresh-1440", m2);
    const f1 = fp();
    check("visitar la home (×4) y dejarla abierta 70 s con refresco: CERO escrituras en BD", f0 === f1, f0 === f1 ? "huella idéntica" : "cambió");

    log("\n· PANTALLAS DEL BUCLE");
    for (const [path, name] of [["/logros", "logros"], ["/temporada", "temporada"], ["/pickems", "pickems"], ["/torneos/vlr-2766", "evento-champions"], ["/torneos", "torneos"]] as const) {
      for (const [w, h] of [[1440, 900], [390, 844]] as const) {
        await tab.resize(w, h);
        await tab.goto(`${BASE}${path}`, 3500);
        await sleep(2500);
        const leak = await tab.js<boolean>(`/correct_option|respuesta correcta:/i.test(document.documentElement.innerHTML)`);
        await shot(tab, `${name}-${w}`, { path, size: `${w}x${h}` });
        if (name === "pickems" || name === "evento-champions") check(`${path} ${w}: sin fuga de respuestas`, !leak);
      }
    }
    const f2 = fp();
    check("navegar Logros/Temporada/Pick'ems/eventos sin actuar: CERO escrituras", f1 === f2);
  } finally {
    await b.close();
  }
  writeFileSync(join(OUT, "real-shots.json"), JSON.stringify({ account: U.slice(0, 8), at: new Date().toISOString(), rows, failures }, null, 2) + "\n");
  log(`\n${n} capturas reales · ${failures === 0 ? "OK" : `${failures} fallo(s)`}`);
  if (failures) process.exitCode = 1;
}

void main();
