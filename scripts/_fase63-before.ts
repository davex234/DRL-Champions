/**
 * FASE 63 · PRUEBA CIEGA DEL FTUE ANTERIOR (instrumento `_`, fuera de CI).
 *
 *   npx tsx scripts/_fase63-before.ts <credsFile>
 *
 * Registra una cuenta QA NUEVA por el formulario REAL de `/cuenta` (dominio reservado `@example.invalid`) y recorre la
 * primera sesión como alguien que no sabe nada: dónde aterriza, qué ve, qué botones hay, qué pasa si pulsa JUGAR sin
 * equipo… Solo mira y hace capturas: no abre sobres ni juega (eso se deja a la prueba DESPUÉS con otra cuenta nueva).
 * Credenciales solo en `credsFile` (scratchpad, fuera del repo).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { launch, sleep, type Tab } from "./lib/cdp";

for (const line of readFileSync(join(process.cwd(), ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
/* eslint-disable @typescript-eslint/no-explicit-any */
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3005";
const OUT = join(process.cwd(), "docs/product/qa/fase63-onboarding");
const SHOTS = join(OUT, "screenshots/before");
mkdirSync(SHOTS, { recursive: true });
const credsFile = process.argv[2];
if (!credsFile) { console.error("uso: _fase63-before.ts <credsFile>"); process.exit(1); }
const esc = (s: string) => JSON.stringify(s);
const waitFor = async (tab: Tab, expr: string, ms = 20000) => {
  for (let i = 0; i < ms / 200; i++) { if (await tab.js<boolean>(expr).catch(() => false)) return true; await sleep(200); }
  return false;
};
const TEXT = `(() => { const m = document.querySelector('main') || document.body; return (m.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 1600); })()`;
const CTAS = `JSON.stringify([...document.querySelectorAll('a[href],button')].filter(e => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 && b.bottom > 0 && b.top < innerHeight; }).map(e => (e.innerText || e.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim() + (e.getAttribute('href') ? ' → ' + e.getAttribute('href') : '')).filter(Boolean).slice(0, 40))`;

async function main() {
  const tag = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const email = `qa-f63-before-${tag}@example.invalid`;
  const password = randomBytes(18).toString("base64url");
  const username = `qaf63b${tag.slice(-6)}`;
  const b = await launch({ args: ["--mute-audio", "--in-process-gpu", "--hide-scrollbars"] });
  const rows: any[] = [];
  const step = async (name: string, note: string) => {
    await sleep(600);
    const text = await b.tab.js<string>(TEXT);
    const ctas = JSON.parse(await b.tab.js<string>(CTAS));
    const url = await b.tab.js<string>("location.pathname + location.search");
    await b.tab.shot(join(SHOTS, `${name}.png`));
    const errors = b.tab.takeErrors();
    rows.push({ name, note, url, text, ctas, errors });
    console.log(`· ${name} ${url} errors=${errors.length}`);
  };
  try {
    await b.tab.resize(1440, 900, 1);
    await b.tab.setMedia([{ name: "prefers-reduced-motion", value: "no-preference" }]);
    await b.tab.goto(`${BASE}/`, 3500);
    await step("00-home-sin-sesion", "Primera pantalla de alguien que llega sin cuenta");
    await b.tab.goto(`${BASE}/cuenta`, 3000);
    await b.tab.js(`[...document.querySelectorAll('button')].find(x => /registro/i.test(x.innerText))?.click()`);
    await sleep(500);
    await step("01-registro", "Formulario de registro real");
    await b.tab.js(`(() => {
      const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
      const inputs = [...document.querySelectorAll('form input')];
      const user = inputs.find(i => i.type === 'text'); if (user) set(user, ${esc(username)});
      set(document.querySelector('input[type="email"]'), ${esc(email)}); set(document.querySelector('input[type="password"]'), ${esc(password)});
      document.querySelector('form button[type="submit"]').click(); })()`);
    const signedIn = await waitFor(b.tab, `!document.querySelector('input[type="password"]')`, 25000);
    await sleep(2500);
    await step("02-tras-registro", `Dónde aterriza tras registrarse (sesión=${signedIn})`);
    // El id sale del almacenamiento de la sesión de Supabase (el mismo que usa la app).
    const userId = await b.tab.js<string>(`(() => { for (const k of Object.keys(localStorage)) if (k.includes('auth-token')) { try { return JSON.parse(localStorage.getItem(k)).user.id } catch {} } return '' })()`);
    writeFileSync(credsFile, JSON.stringify({ email, password, userId, username }), { mode: 0o600 });
    for (const [name, path, note] of [
      ["03-home", "/", "La home de una cuenta recién creada"],
      ["04-jugar", "/jugar", "JUGAR (lo primero que pulsaría)"],
      ["05-duelo-sin-equipo", "/duelos/jugar", "Partida rápida sin equipo"],
      ["06-boveda", "/boveda", "INVENTARIO"],
      ["07-coleccion", "/coleccion", "Colección"],
      ["08-equipos", "/duelos/mazos", "Equipos"],
      ["09-tienda", "/tienda", "TIENDA"],
      ["10-inventario", "/inventario", "Mis sobres"],
      ["11-progresion", "/progresion", "Progresión"],
      ["12-perfil", "/cuenta", "Perfil"],
    ] as const) {
      await sleep(1500);
      await b.tab.goto(`${BASE}${path}`, 3500);
      await step(name, note);
    }
    await b.tab.resize(390, 844, 1);
    await b.tab.goto(`${BASE}/`, 3500);
    await step("13-home-390", "La home en móvil");
  } finally { await b.close(); }

  // Estado real de la cuenta por la API (lecturas).
  const creds = JSON.parse(readFileSync(credsFile, "utf8"));
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const { data } = await anon.auth.signInWithPassword({ email: creds.email, password: creds.password });
  const t = data.session?.access_token;
  const api: Record<string, unknown> = {};
  for (const p of ["/api/game/state", "/api/game/starter", "/api/game/daily-loop"]) {
    const r = await fetch(`${BASE}${p}`, { headers: { authorization: `Bearer ${t}` } });
    const j = await r.json().catch(() => ({}));
    api[p] = { status: r.status, body: p === "/api/game/daily-loop" ? { primaryAction: j.primaryAction, journey: j.journey, packs: j.packs } : j };
  }
  const prev = existsSync(join(OUT, "old-ftue-walk.json")) ? JSON.parse(readFileSync(join(OUT, "old-ftue-walk.json"), "utf8")) : null;
  writeFileSync(join(OUT, "old-ftue-walk.json"), JSON.stringify({ at: new Date().toISOString(), account: creds.userId.slice(0, 8), previousRun: prev?.at ?? null, steps: rows, api }, null, 2));
  console.log(`cuenta QA ${creds.userId.slice(0, 8)} · ${rows.length} pantallas`);
}

/** Segunda pasada ANTES: abrir el primer sobre por la interfaz y mirar resumen, colección y constructor. */
async function openPass() {
  const creds = JSON.parse(readFileSync(credsFile, "utf8"));
  const b = await launch({ args: ["--mute-audio", "--in-process-gpu", "--hide-scrollbars"] });
  const rows: any[] = [];
  const step = async (name: string, note: string) => {
    await sleep(700);
    const text = await b.tab.js<string>(TEXT);
    const ctas = JSON.parse(await b.tab.js<string>(CTAS));
    await b.tab.shot(join(SHOTS, `${name}.png`));
    rows.push({ name, note, url: await b.tab.js<string>("location.pathname + location.search"), text, ctas, errors: b.tab.takeErrors() });
    console.log(`· ${name}`);
  };
  try {
    await b.tab.resize(1440, 900, 1);
    await b.tab.setMedia([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await b.tab.goto(`${BASE}/cuenta`, 3000);
    await b.tab.js(`(() => {
      const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
      set(document.querySelector('input[type="email"]'), ${esc(creds.email)}); set(document.querySelector('input[type="password"]'), ${esc(creds.password)});
      document.querySelector('form button[type="submit"]').click(); })()`);
    await waitFor(b.tab, `!document.querySelector('input[type="password"]')`, 25000);
    await sleep(1500);
    await b.tab.goto(`${BASE}/abrir/inicial`, 4000);
    await step("20-sobre-sellado", "El primer sobre, antes de abrir");
    await b.tab.js(`document.querySelector('[data-testid="pack-open"]')?.click()`);
    await waitFor(b.tab, `!!document.querySelector('[data-testid="pack-skip"],[data-testid="pack-reveal-all"]')`, 20000);
    await sleep(800);
    await b.tab.js(`(document.querySelector('[data-testid="pack-reveal-all"]') || document.querySelector('[data-testid="pack-skip"]'))?.click()`);
    await waitFor(b.tab, `!!document.querySelector('[data-testid="pack-summary"]')`, 20000);
    await step("21-resumen-primer-sobre", "Resumen del primer sobre (sin explicación de la carta)");
    await sleep(1500);
    await b.tab.goto(`${BASE}/coleccion`, 4000);
    await step("22-coleccion-con-cartas", "Colección tras el primer sobre");
    await sleep(1500);
    await b.tab.goto(`${BASE}/duelos/mazos?nuevo=1`, 4500);
    await step("23-constructor", "Constructor con 5 cartas");
    await sleep(1500);
    await b.tab.goto(`${BASE}/`, 4000);
    await step("24-home-tras-sobre", "La home no cambia tras el primer sobre");
  } finally { await b.close(); }
  const path = join(OUT, "old-ftue-walk.json");
  const doc = JSON.parse(readFileSync(path, "utf8"));
  doc.openPass = { at: new Date().toISOString(), steps: rows };
  writeFileSync(path, JSON.stringify(doc, null, 2));
}

(process.argv.includes("--open") ? openPass() : main()).catch((e) => { console.error("ERROR", e instanceof Error ? e.stack : e); process.exit(1); });
