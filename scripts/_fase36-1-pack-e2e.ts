/**
 * FASE 36.1 · E2E REAL DEL CONTADOR DE SOBRES (instrumento `_`, fuera de CI).
 *
 *   npx tsx scripts/_fase36-1-pack-e2e.ts <credsFile>
 *
 * App LOCAL (`next start`, :3005) → API real → Supabase del VPS por túnel · cuenta QA de la Fase 35.2 · login por el
 * formulario real. Recorrido: objetivos antes → COMPRAR un sobre (API real, créditos QA) → objetivos (sin cambio) →
 * inventario con el sobre → ABRIR en `/abrir/estandar` (flujo real) → objetivos (+1) → recarga (persiste).
 * No reclama nada. No imprime correo, contraseña ni tokens. Capturas en docs/product/qa/fase36-1/.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
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
const OUT = join(process.cwd(), "docs", "product", "qa", "fase36-1");
mkdirSync(OUT, { recursive: true });
const [credsFile] = process.argv.slice(2);
const creds = JSON.parse(readFileSync(credsFile, "utf8")) as { email: string; password: string; userId: string };
const PROFILE = join(credsFile, "..", "f361-chrome-profile");
const log = (s: string) => console.log(s);
const esc = (s: string) => JSON.stringify(s);
const waitFor = async (tab: Tab, expr: string, ms = 25000) => {
  for (let i = 0; i < ms / 250; i++) { if (await tab.js<boolean>(expr)) return true; await sleep(250); }
  return false;
};

async function token(): Promise<string> {
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const { data, error } = await anon.auth.signInWithPassword({ email: creds.email, password: creds.password });
  if (error || !data.session) throw new Error("login QA falló");
  return data.session.access_token;
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
  log(`session_via_real_form=${await tab.js<boolean>(signedIn)}`);
}

/** Lee las tarjetas de objetivos de sobres en /progresion (lo que ve el jugador). */
async function objectives(tab: Tab, shot: string, reload = true): Promise<Record<string, { status: string; progress: string } | null>> {
  if (reload) await tab.goto(`${BASE}/progresion`, 2500);
  const ready = await waitFor(tab, `!!document.querySelector('[data-objective="d-abrir-1"]')`, 25000);
  await tab.js(`document.querySelector('#objetivos')?.scrollIntoView({ block: 'start' }); window.scrollBy(0, -80)`);
  await sleep(1200);
  const read = await tab.js<any>(`(() => {
    const out = {};
    for (const id of ["d-abrir-1", "w-sobres-10"]) {
      const el = document.querySelector('[data-objective="' + id + '"]');
      out[id] = el ? { status: el.getAttribute("data-status"), progress: (el.querySelector(".nx-readout")?.textContent || "").trim() } : null;
    }
    return out;
  })()`);
  await tab.shot(join(OUT, shot));
  log(`${shot} ready=${ready} ${JSON.stringify(read)}`);
  return read;
}

async function api(t: string, path: string, body?: unknown) {
  const r = await fetch(`${BASE}${path}`, { method: body ? "POST" : "GET", headers: { authorization: `Bearer ${t}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const json: any = await r.json().catch(() => null);
  return { status: r.status, json };
}

async function dailyLoopPackRows(t: string) {
  const r = await api(t, "/api/game/daily-loop");
  const rows = (r.json?.today ?? []).filter((i: any) => /d-abrir-1|w-sobres-10/.test(i.id)).map((i: any) => `${i.id}:${i.status}:${i.progress?.label ?? "-"}`);
  return `daily_loop status=${r.status} claimable=${r.json?.objectives?.claimable} primary=${r.json?.primaryAction?.id} rows=[${rows.join(", ")}]`;
}

const phase = process.argv[3] ?? "all";

async function main() {
  const t = await token();
  const b = await launch({ width: 1440, height: 900, userDataDir: PROFILE });
  const tab = b.tab;
  try {
    await login(tab);
    if (phase === "open") return await openPhase(tab, t);

    const before = await objectives(tab, "01-objective-before.png");
    log(await dailyLoopPackRows(t));

    // ── COMPRAR (canónico, créditos de la cuenta QA)
    const buy = await api(t, "/api/game/packs", { action: "buy", packId: "estandar", ref: `f361-buy-${randomUUID()}` });
    log(`buy status=${buy.status} credits=${buy.json?.credits ?? "-"} error=${buy.json?.error ?? "-"}`);

    await tab.goto(`${BASE}/inventario`, 3000);
    await waitFor(tab, `/Sobre Estándar|Estándar/i.test(document.body.innerText)`, 15000);
    await tab.js(`[...document.querySelectorAll('a[href="/abrir/estandar"]')][0]?.scrollIntoView({ block: 'center' })`);
    await sleep(800);
    const owned = await tab.js<string>(`([...document.querySelectorAll('a[href="/abrir/estandar"]')][0]?.textContent || '').replace(/\\s+/g, ' ').trim()`);
    await tab.shot(join(OUT, "02-pack-owned.png"));
    log(`02-pack-owned.png card="${owned}"`);

    const afterBuy = await objectives(tab, "03-objective-after-purchase.png");
    log(await dailyLoopPackRows(t));
    log(`purchase_changed_progress=${JSON.stringify(before) !== JSON.stringify(afterBuy)}`);
    if (phase === "buy") return;
    await openPhase(tab, t);
  } finally {
    await b.close();
  }
}

async function openPhase(tab: Tab, t: string) {
  {
    // ── ABRIR (flujo real de /abrir/estandar; sin gesto disponible, el mismo endpoint con clave de servidor)
    await tab.goto(`${BASE}/abrir/estandar`, 3000);
    const hasButton = await waitFor(tab, `[...document.querySelectorAll('button')].some((x) => /^Abrir sobre$/i.test((x.textContent || '').trim()) && !x.disabled)`, 15000);
    let openedVia = "ui";
    if (hasButton) {
      await tab.js(`[...document.querySelectorAll('button')].find((x) => /^Abrir sobre$/i.test((x.textContent || '').trim()) && !x.disabled).click()`);
      await sleep(1500);
      await tab.shot(join(OUT, "04-pack-opening.png"));
      await sleep(6000);
      await tab.shot(join(OUT, "04b-pack-opened-result.png"));
    } else {
      openedVia = "api";
      await tab.shot(join(OUT, "04-pack-opening.png"));
      const open = await api(t, "/api/game/packs", { action: "open", packId: "estandar", ref: `f361-open-${randomUUID()}` });
      log(`open(api) status=${open.status} cards=${open.json?.opened?.length ?? "-"}`);
    }
    log(`open_via=${openedVia}`);
    await sleep(2500);

    const afterOpen = await objectives(tab, "05-objective-after-open.png");
    log(await dailyLoopPackRows(t));
    await tab.js(`location.reload()`);
    await sleep(3000);
    await objectives(tab, "06-objective-after-refresh.png", false);
    log(await dailyLoopPackRows(t));
    log(`summary afterOpen=${JSON.stringify(afterOpen)}`);
    const errs = tab.takeErrors().filter((e) => !/players\/.*\.(png|webp)|404|Failed to load resource/i.test(e));
    log(`console_errors=${errs.length}`);
    for (const e of errs.slice(0, 8)) log(`  ✗ ${e.slice(0, 180)}`);
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
