/**
 * CAPTURAS DE AUDITORÍA — la carta a lo largo de TODO NEXUS. **Solo lectura.**
 *
 *   npx next dev -p 3001 --webpack     (otra terminal)
 *   npx tsx scripts/card-audit-shots.ts
 *
 * Recorre las pantallas donde aparece una carta y captura cada una en 1440×900 y 390×844.
 * No modifica nada del producto: crea un usuario de usar y tirar, le concede cartas de
 * rarezas MUY distintas —para poder comparar el tratamiento entre ellas— y lo borra al
 * terminar. No toca el catálogo, ni la economía, ni datos reales.
 *
 * Además MIDE lo que un PNG no dice: nodos del DOM, cuántos elementos tienen animación viva
 * y cuántas cartas hay en pantalla. Es lo que hace falta para juzgar §16 (rendimiento).
 */
import { ephemeralQaPassword } from "./lib/qaCredentials";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { CardRegistry } from "@/collection/registry";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
for (const f of [".env.local", ".env"]) {
  const p = join(ROOT, f);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3001";
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const OUT = join(ROOT, "docs", "product", "qa", "card-audit");

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

/**
 * Cartas para la auditoría: una por cada TRATAMIENTO visual distinto que existe, para poder
 * compararlos lado a lado. No se eligen por jugador: se eligen por variante.
 */
function auditCardIds(): { id: string; variantId: string; nick: string }[] {
  const quiero = [
    "bronze", "silver", "gold", "emea", "emea-winner", "emea-mvp",
    "prime", "clutch", "top-acs", "top-rating", "champion-edition", "icon-series", "mythic",
  ];
  const out: { id: string; variantId: string; nick: string }[] = [];
  for (const v of quiero) {
    const c = registry.forVariant(v as never)[0];
    if (c) out.push({ id: c.id, variantId: v, nick: c.playerId });
  }
  return out;
}

const VIEWPORTS: [number, number, string][] = [[1440, 900, "1440"], [390, 844, "390"]];

const MEDIR = `(() => {
  const cartas = document.querySelectorAll('[class*="aspect-[5/7]"], [style*="aspect-ratio: 5 / 7"]').length;
  /*
   * framer-motion no usa animaciones CSS: mueve transform/opacity por JS, asi que
   * animationName sale 'none' aunque haya cincuenta bucles vivos. Lo que si se puede
   * contar son las CAPAS de efecto de rareza (CardEffects), que son las que cuestan:
   * todas llevan mix-blend-mode.
   */
  const capasEfecto = [...document.querySelectorAll('*')].filter((e) => {
    const s = getComputedStyle(e);
    return s.mixBlendMode === 'overlay' || s.mixBlendMode === 'screen';
  }).length;
  return {
    nodos: document.querySelectorAll('*').length,
    cartas,
    capasEfecto,
    overflowX: Math.round(document.documentElement.scrollWidth - window.innerWidth),
    alto: document.documentElement.scrollHeight,
  };
})()`;

async function main(): Promise<void> {
  if (!CHROME) { console.error("No se encontró Chrome."); process.exit(1); }
  const ping = await fetch(`${BASE}/api/game/state`).catch(() => null);
  if (!ping || ping.status !== 401) { console.error(`❌ No hay servidor NEXUS en ${BASE} (status ${ping?.status}).`); process.exit(1); }

  mkdirSync(OUT, { recursive: true });
  const cartas = auditCardIds();
  console.log(`# Auditoría visual de cartas — ${BASE}\n`);
  console.log(`Cartas de muestra (una por tratamiento): ${cartas.length}`);
  for (const c of cartas) console.log(`   ${c.variantId.padEnd(18)} ${c.nick}`);

  const email = `qa-cards-${Date.now()}@example.invalid`;
  const password = ephemeralQaPassword();
  const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { username: "qacards" } });
  if (error || !created.user) throw new Error(error?.message);
  const userId = created.user.id;

  const PROFILE = mkdtempSync(join(tmpdir(), "card-audit-"));
  const PORT = 9760 + Math.floor(Math.random() * 40);
  let chrome: ReturnType<typeof spawn> | undefined;
  const informe: Record<string, unknown> = {};

  try {
    const pub = createClient(URL_, ANON, { auth: { persistSession: false } });
    const { data: signin } = await pub.auth.signInWithPassword({ email, password });
    const session = signin!.session!;

    /* Se conceden por duplicado a propósito: así se ve cómo se marca una repetida. */
    const instancias = [...cartas, ...cartas.slice(0, 4)].map((c) => ({ cardId: c.id, serial: null }));
    const { error: gErr } = await admin.rpc("app_grant_cards", {
      p_user: userId, p_instances: instancias, p_mint_delta: {}, p_origin: "admin",
    });
    if (gErr) throw new Error(gErr.message);

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

    const goto = async (path: string, wait = 2600): Promise<void> => {
      const loaded = new Promise<void>((res) => root.on("Page.loadEventFired", () => res()));
      await send("Page.navigate", { url: `${BASE}${path}` });
      await Promise.race([loaded, sleep(14000)]);
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

    /** Las pantallas donde vive una carta, en el orden del recorrido del encargo. */
    const RUTAS: [string, string, number][] = [
      ["/", "00-vestibulo", 3000],
      ["/coleccion", "01-coleccion", 3400],
      ["/inventario", "02-inventario", 3200],
      ["/mercado", "03-mercado", 3200],
      ["/duelos/mazos", "04-mazos", 3200],
      ["/cuenta", "05-perfil", 3200],
      ["/tienda", "06-tienda-sobres", 3000],
      ["/abrir/icon", "08-abrir-sobre", 3400],
      ["/colecciones", "09-colecciones", 3000],
    ];

    for (const [w, h, tag] of VIEWPORTS) {
      await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: w < 500 });
      console.log(`\n## ${w}×${h}`);
      for (const [ruta, nombre, espera] of RUTAS) {
        await goto(ruta, espera);
        await shot(`${tag}-${nombre}`);
        const m = await js(MEDIR);
        informe[`${tag}·${nombre}`] = m;
        console.log(`   ${nombre.padEnd(20)} nodos ${String(m.nodos).padStart(5)} · cartas ${String(m.cartas).padStart(3)} · capas de efecto ${String(m.capasEfecto).padStart(3)} · overflowX ${m.overflowX}`);
      }

      /* DETALLE — se abre la primera carta de la colección. */
      await goto("/coleccion", 3200);
      const abierto = await js(`(async()=>{const s=ms=>new Promise(r=>setTimeout(r,ms));
        const c=[...document.querySelectorAll('button')].find(x=>/^Ver /.test(x.getAttribute('aria-label')||''));
        if(c){c.click(); await s(1400); return document.querySelectorAll('[role="dialog"]').length>0;} return false;})()`);
      await shot(`${tag}-07-detalle`);
      const md = await js(MEDIR);
      informe[`${tag}·07-detalle`] = md;
      console.log(`   ${"07-detalle".padEnd(20)} nodos ${String(md.nodos).padStart(5)} · cartas ${String(md.cartas).padStart(3)} · capas de efecto ${String(md.capasEfecto).padStart(3)} · ¿se abrió? ${abierto}`);
    }

    writeFileSync(join(OUT, "metricas.json"), JSON.stringify(informe, null, 2));
    console.log(`\n→ docs/product/qa/card-audit/*.png`);
    root.close();
  } finally {
    if (chrome) chrome.kill();
    try { rmSync(PROFILE, { recursive: true, force: true }); } catch { /* ya no está */ }
    await admin.from("duel_decks").delete().eq("user_id", userId);
    await admin.auth.admin.deleteUser(userId).catch(() => {});
  }
}

main().catch((e: unknown) => { console.error("\n❌", e instanceof Error ? e.message : e); process.exit(1); });
