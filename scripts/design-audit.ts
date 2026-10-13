/**
 * AUDITORÍA VISUAL GLOBAL — **solo lectura. No modifica producto.**
 *
 *   npx next dev -p 3001 --webpack
 *   npx tsx scripts/design-audit.ts
 *
 * Recorre las pantallas de jugador de NEXUS y hace dos cosas:
 *
 *   1. CAPTURA cada una en los seis anchos del encargo.
 *   2. MIDE su vocabulario visual — cuántos fondos, radios, sombras, tipos y tamaños
 *      DISTINTOS usa cada pantalla, y cuántos elementos hablan la geometría NEXUS
 *      (`clip-path`, el chaflán) frente a cuántos hablan la genérica (`border-radius`).
 *
 * Lo segundo es lo que convierte «esto no parece el mismo producto» en un dato. Si una
 * pantalla usa 40 fondos distintos y otra 6, no comparten sistema; si una tiene 90 esquinas
 * redondeadas y 2 chaflanes, no habla el idioma de la casa. Eso no se ve mirando: se cuenta.
 */
import { ephemeralQaPassword } from "./lib/qaCredentials";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { CardRegistry } from "@/collection/registry";
import { DUEL_ROLES } from "@/domain/cardgame";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
for (const f of [".env.local", ".env"]) {
  const p = join(ROOT, f);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const argv = process.argv.slice(2);
const TAG = (() => { const i = argv.indexOf("--tag"); return i >= 0 && argv[i + 1] ? argv[i + 1] : "antes"; })();
const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3001";
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const OUT = join(ROOT, "docs", "product", "qa", "design-audit");

const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });
const registry = new CardRegistry();
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const storageKey = `sb-${new URL(URL_).hostname.split(".")[0]}-auth-token`;

const CHROME = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
].find((p) => existsSync(p));

function connect(url: string) {
  const ws = new WebSocket(url);
  let id = 0;
  const pending = new Map<number, { res: (v: any) => void; rej: (e: Error) => void }>();
  const events = new Map<string, ((p: any) => void)[]>();
  ws.addEventListener("message", (ev: MessageEvent) => {
    const m = JSON.parse(ev.data as string);
    if (m.id && pending.has(m.id)) {
      const e = pending.get(m.id)!; pending.delete(m.id);
      if (m.error) e.rej(new Error(m.error.message)); else e.res(m.result);
    } else if (m.method) for (const fn of events.get(m.method) ?? []) fn(m.params);
  });
  return {
    ready: new Promise<void>((res, rej) => { ws.addEventListener("open", () => res()); ws.addEventListener("error", () => rej(new Error("ws"))); }),
    send: (method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<any> =>
      new Promise((res, rej) => { const n = ++id; pending.set(n, { res, rej }); ws.send(JSON.stringify({ id: n, method, params, sessionId })); }),
    on: (method: string, fn: (p: any) => void) => events.set(method, [...(events.get(method) ?? []), fn]),
    close: () => ws.close(),
  };
}

function deckCardIds(): string[] {
  const ids: string[] = [];
  for (const role of DUEL_ROLES) {
    const best = new Map<string, { id: string; ovr: number }>();
    for (const c of registry.forRole(role)) {
      if (!c.combat) continue;
      const p = best.get(c.playerId);
      if (!p || c.ovr > p.ovr) best.set(c.playerId, { id: c.id, ovr: c.ovr });
    }
    const arr = [...best.values()].sort((a, b) => b.ovr - a.ovr || a.id.localeCompare(b.id));
    ids.push(arr[0].id, arr[1].id);
  }
  return ids;
}

/** Las pantallas de JUGADOR. Admin queda fuera: no forma parte de la identidad del juego. */
const RUTAS: [string, string][] = [
  ["/", "00-lobby"],
  ["/duelos", "01-duelos"],
  ["/duelos/mazos", "02-mazos"],
  ["/coleccion", "03-coleccion"],
  ["/colecciones", "04-colecciones"],
  ["/inventario", "05-inventario"],
  ["/tienda", "06-tienda"],
  ["/mercado", "07-mercado"],
  ["/torneos", "08-torneos"],
  ["/pickems", "09-pickems"],
  ["/eventos", "10-eventos"],
  ["/recompensas", "11-recompensas"],
  ["/logros", "12-logros"],
  ["/ranking", "13-ranking"],
  ["/cuenta", "14-perfil"],
  ["/mundo", "15-mundo"],
  ["/entrenador", "16-entrenador"],
  ["/carrera", "17-carrera"],
  ["/noticias", "18-noticias"],
  ["/manager", "19-manager"],
];

const ANCHOS: [number, number, string][] = [
  [1440, 900, "1440"], [1366, 768, "1366"], [1280, 720, "1280"],
  [1024, 768, "1024"], [768, 1024, "768"], [390, 844, "390"],
];

/**
 * EL VOCABULARIO VISUAL DE UNA PANTALLA.
 *
 * Se miran solo elementos con superficie real (>= 40×24 px y visibles): un sistema se juzga
 * por sus planos, no por sus `span` de texto.
 */
const VOCABULARIO = `(() => {
  const vis = [...document.querySelectorAll('*')].filter((e) => {
    const r = e.getBoundingClientRect();
    if (r.width < 40 || r.height < 24) return false;
    const s = getComputedStyle(e);
    return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
  });
  const set = (fn) => { const s = new Set(); for (const e of vis) { const v = fn(getComputedStyle(e), e); if (v) s.add(v); } return s; };

  const fondos = set((s) => {
    const bg = s.backgroundColor;
    const img = s.backgroundImage;
    const partes = [];
    if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') partes.push(bg);
    if (img && img !== 'none') partes.push(img.slice(0, 120));
    return partes.length ? partes.join(' | ') : null;
  });
  const radios = set((s) => (s.borderRadius && s.borderRadius !== '0px' ? s.borderRadius : null));
  const sombras = set((s) => (s.boxShadow && s.boxShadow !== 'none' ? s.boxShadow.slice(0, 90) : null));
  const fuentes = set((s) => s.fontFamily.split(',')[0].replace(/["']/g, ''));
  const tamanos = set((s) => s.fontSize);
  const bordes = set((s) => (s.borderTopWidth !== '0px' ? s.borderTopWidth + ' ' + s.borderTopColor : null));

  /* La geometría de la casa frente a la genérica. */
  const chaflan = vis.filter((e) => getComputedStyle(e).clipPath !== 'none').length;
  const redondeado = vis.filter((e) => { const r = getComputedStyle(e).borderRadius; return r && r !== '0px'; }).length;

  return {
    superficies: vis.length,
    fondos: fondos.size,
    radios: radios.size,
    radiosLista: [...radios].sort().slice(0, 14),
    sombras: sombras.size,
    fuentes: [...fuentes],
    tamanos: tamanos.size,
    tamanosLista: [...tamanos].map((t) => parseFloat(t)).sort((a, b) => a - b),
    bordes: bordes.size,
    chaflan,
    redondeado,
    nodos: document.querySelectorAll('*').length,
    overflowX: Math.round(document.documentElement.scrollWidth - window.innerWidth),
    alto: document.documentElement.scrollHeight,
  };
})()`;

async function main(): Promise<void> {
  if (!CHROME) { console.error("No se encontró Chrome."); process.exit(1); }
  const ping = await fetch(`${BASE}/api/game/state`).catch(() => null);
  if (!ping || ping.status !== 401) { console.error(`❌ No hay servidor en ${BASE}.`); process.exit(1); }

  mkdirSync(OUT, { recursive: true });
  console.log(`# Auditoría visual global — ${BASE} · tag "${TAG}"\n`);

  const email = `qa-design-${Date.now()}@example.invalid`;
  const password = ephemeralQaPassword();
  const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { username: "qadesign" } });
  if (error || !created.user) throw new Error(error?.message);
  const userId = created.user.id;

  const PROFILE = mkdtempSync(join(tmpdir(), "design-audit-"));
  const PORT = 9640 + Math.floor(Math.random() * 40);
  let chrome: ReturnType<typeof spawn> | undefined;
  const informe: Record<string, unknown> = {};

  try {
    const pub = createClient(URL_, ANON, { auth: { persistSession: false } });
    const { data: signin } = await pub.auth.signInWithPassword({ email, password });
    const session = signin!.session!;
    await admin.rpc("app_grant_cards", {
      p_user: userId, p_instances: deckCardIds().map((cardId) => ({ cardId, serial: null })), p_mint_delta: {}, p_origin: "admin",
    });

    chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-first-run", `--remote-debugging-port=${PORT}`, "--user-data-dir=" + PROFILE, "about:blank"], { stdio: "ignore" });
    let wsUrl: string | undefined;
    for (let i = 0; i < 80; i++) {
      try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) { wsUrl = (await r.json()).webSocketDebuggerUrl; break; } } catch { /* arrancando */ }
      await sleep(250);
    }
    const root = connect(wsUrl!);
    await root.ready;
    const { targetId } = await root.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await root.send("Target.attachToTarget", { targetId, flatten: true });
    const send = (m: string, p: Record<string, unknown> = {}) => root.send(m, p, sessionId);
    await send("Page.enable"); await send("Runtime.enable");
    await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });

    const goto = async (path: string, wait = 2600): Promise<void> => {
      const loaded = new Promise<void>((res) => root.on("Page.loadEventFired", () => res()));
      await send("Page.navigate", { url: `${BASE}${path}` });
      await Promise.race([loaded, sleep(15000)]);
      await sleep(wait);
    };
    const js = async (e: string): Promise<any> => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result.value;
    const shot = async (name: string): Promise<void> => {
      const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      writeFileSync(join(OUT, `${name}.png`), Buffer.from(r.data, "base64"));
    };

    await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await goto("/", 900);
    await js(`localStorage.setItem(${JSON.stringify(storageKey)}, ${JSON.stringify(JSON.stringify(session))}); true`);

    // ── 1440: TODAS las pantallas + vocabulario ──
    console.log("## 1440×900 · vocabulario visual por pantalla\n");
    console.log(`${"pantalla".padEnd(16)} ${"sup".padStart(4)} ${"fondos".padStart(6)} ${"radios".padStart(6)} ${"somb".padStart(5)} ${"tam".padStart(4)} ${"chaflán".padStart(7)} ${"redond".padStart(6)} ${"nodos".padStart(6)} ovfX`);
    for (const [ruta, nombre] of RUTAS) {
      await goto(ruta, 2800);
      await shot(`${TAG}-1440-${nombre}`);
      const v = await js(VOCABULARIO);
      informe[`1440·${nombre}`] = v;
      console.log(
        `${nombre.padEnd(16)} ${String(v.superficies).padStart(4)} ${String(v.fondos).padStart(6)} ${String(v.radios).padStart(6)} ` +
        `${String(v.sombras).padStart(5)} ${String(v.tamanos).padStart(4)} ${String(v.chaflan).padStart(7)} ${String(v.redondeado).padStart(6)} ` +
        `${String(v.nodos).padStart(6)} ${v.overflowX}`,
      );
    }

    // ── Los otros cinco anchos, sobre las pantallas clave ──
    const CLAVE = RUTAS.filter(([, n]) => /lobby|coleccion|tienda|torneos|perfil|entrenador|duelos$/.test(n));
    for (const [w, h, tag] of ANCHOS.slice(1)) {
      await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: w < 500 });
      console.log(`\n## ${w}×${h}`);
      for (const [ruta, nombre] of CLAVE) {
        await goto(ruta, 2600);
        await shot(`${TAG}-${tag}-${nombre}`);
        const v = await js(VOCABULARIO);
        informe[`${tag}·${nombre}`] = v;
        console.log(`   ${nombre.padEnd(16)} nodos ${String(v.nodos).padStart(5)} · overflowX ${String(v.overflowX).padStart(4)} · alto ${v.alto}`);
      }
    }

    writeFileSync(join(OUT, `${TAG}-vocabulario.json`), JSON.stringify(informe, null, 2));
    console.log(`\n→ docs/product/qa/design-audit/${TAG}-*.png`);
    root.close();
  } finally {
    if (chrome) chrome.kill();
    try { rmSync(PROFILE, { recursive: true, force: true }); } catch { /* ya no está */ }
    await admin.from("duel_decks").delete().eq("user_id", userId);
    await admin.auth.admin.deleteUser(userId).catch(() => {});
  }
}

main().catch((e: unknown) => { console.error("\n❌", e instanceof Error ? e.message : e); process.exit(1); });
