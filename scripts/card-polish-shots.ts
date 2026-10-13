/**
 * CAPTURAS Y MÉTRICAS DE LA FASE DE POLISH DE CARTAS. **Herramienta, no CI.**
 *
 *   npx next dev -p 3001 --webpack
 *   npx tsx scripts/card-polish-shots.ts --tag antes
 *
 * Captura (a) el banco de variantes lado a lado, en pequeño y en grande, y (b) las pantallas
 * del producto donde vive una carta. Y MIDE lo que decide si el polish sale caro:
 * nodos, capas con `mix-blend-mode` y elementos animados por framer-motion.
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

const argv = process.argv.slice(2);
const TAG = (() => { const i = argv.indexOf("--tag"); return i >= 0 && argv[i + 1] ? argv[i + 1] : "shot"; })();
const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3001";
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const OUT = join(ROOT, "docs", "product", "qa", "card-polish");

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

/** Muestra del catálogo: una carta por cada tratamiento que SÍ existe como CardDef. */
function sample(): string[] {
  const quiero = ["bronze", "silver", "gold", "emea", "emea-winner", "emea-mvp", "prime", "champions-mvp", "icon-series"];
  return quiero.map((v) => registry.forVariant(v as never)[0]?.id).filter((x): x is string => !!x);
}

/**
 * Lo que decide si el polish sale caro.
 *
 * `mixBlend` cuenta las capas de efecto con mezcla (repintado); `animados` cuenta los nodos
 * que framer-motion está moviendo ahora mismo — que es lo que `animationName` de CSS NO ve,
 * porque framer escribe `transform` en línea.
 */
const MEDIR = `(() => {
  const todos = [...document.querySelectorAll('*')];
  const mixBlend = todos.filter((e) => { const s = getComputedStyle(e); return s.mixBlendMode === 'overlay' || s.mixBlendMode === 'screen'; }).length;
  const animados = todos.filter((e) => e.style && e.style.transform && e.style.transform !== 'none').length;
  return {
    nodos: todos.length,
    mixBlend,
    animados,
    cartas: document.querySelectorAll('[data-card-frame]').length || document.querySelectorAll('[class*="aspect-[5/7]"]').length,
    overflowX: Math.round(document.documentElement.scrollWidth - window.innerWidth),
  };
})()`;

async function main(): Promise<void> {
  if (!CHROME) { console.error("No se encontró Chrome."); process.exit(1); }
  const ping = await fetch(`${BASE}/api/game/state`).catch(() => null);
  if (!ping || ping.status !== 401) { console.error(`❌ No hay servidor en ${BASE}.`); process.exit(1); }

  mkdirSync(OUT, { recursive: true });
  console.log(`# Polish de cartas — tag "${TAG}"\n`);

  const email = `qa-polish-${Date.now()}@example.invalid`;
  const password = ephemeralQaPassword();
  const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { username: "qapol" } });
  if (error || !created.user) throw new Error(error?.message);
  const userId = created.user.id;

  const PROFILE = mkdtempSync(join(tmpdir(), "card-polish-"));
  const PORT = 9700 + Math.floor(Math.random() * 40);
  let chrome: ReturnType<typeof spawn> | undefined;
  const informe: Record<string, unknown> = {};

  try {
    const pub = createClient(URL_, ANON, { auth: { persistSession: false } });
    const { data: signin } = await pub.auth.signInWithPassword({ email, password });
    const session = signin!.session!;
    const ids = sample();
    const { error: gErr } = await admin.rpc("app_grant_cards", {
      p_user: userId, p_instances: [...ids, ...ids.slice(0, 3)].map((cardId) => ({ cardId, serial: null })), p_mint_delta: {}, p_origin: "admin",
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
    /*
     * Chrome headless declara `prefers-reduced-motion: reduce` POR DEFECTO. Sin fijarlo, la
     * medición de «antes» y la de «después» no son comparables: el CardEffects anterior
     * ignoraba la preferencia —animaba igual— y el nuevo la respeta, así que la bajada de
     * bucles saldría inflada por algo que no es la optimización. Se fuerza el caso normal.
     */
    const preferencia = process.env.REDUCED === "1" ? "reduce" : "no-preference";
    await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: preferencia }] });
    console.log(`   (prefers-reduced-motion: ${preferencia})
`);

    const goto = async (path: string, wait = 2800): Promise<void> => {
      const loaded = new Promise<void>((res) => root.on("Page.loadEventFired", () => res()));
      await send("Page.navigate", { url: `${BASE}${path}` });
      await Promise.race([loaded, sleep(15000)]);
      await sleep(wait);
    };
    const js = async (e: string): Promise<any> => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result.value;
    const shot = async (name: string, full = false): Promise<void> => {
      const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: full });
      writeFileSync(join(OUT, `${name}.png`), Buffer.from(r.data, "base64"));
    };

    await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
    await goto("/", 900);
    await js(`localStorage.setItem(${JSON.stringify(storageKey)}, ${JSON.stringify(JSON.stringify(session))}); true`);

    // ── 1 · BANCO DE VARIANTES ──
    await goto("/card-lab", 3200);
    for (const tam of ["sm", "md", "lg"] as const) {
      await js(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='${tam}'); if(b)b.click(); return !!b;})()`);
      await sleep(1700);
      await shot(`${TAG}-lab-${tam}`, true);
      const m = await js(MEDIR);
      informe[`lab-${tam}`] = m;
      console.log(`## Banco (${tam})  nodos ${m.nodos} · mix-blend ${m.mixBlend} · animados ${m.animados}`);
    }

    // ── 2 · PANTALLAS DEL PRODUCTO ──
    const RUTAS: [string, string][] = [["/", "home"], ["/coleccion", "coleccion"], ["/inventario", "inventario"], ["/mercado", "mercado"]];
    for (const [w, h, tag] of [[1440, 900, "1440"], [390, 844, "390"]] as [number, number, string][]) {
      await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: w < 500 });
      console.log(`\n## ${w}×${h}`);
      for (const [ruta, nombre] of RUTAS) {
        await goto(ruta, 3000);
        await shot(`${TAG}-${tag}-${nombre}`);
        const m = await js(MEDIR);
        informe[`${tag}·${nombre}`] = m;
        console.log(`   ${nombre.padEnd(12)} nodos ${String(m.nodos).padStart(5)} · cartas ${String(m.cartas).padStart(3)} · mix-blend ${String(m.mixBlend).padStart(3)} · animados ${String(m.animados).padStart(4)} · overflowX ${m.overflowX}`);
      }
    }

    writeFileSync(join(OUT, `${TAG}-metricas.json`), JSON.stringify(informe, null, 2));
    console.log(`\n→ docs/product/qa/card-polish/${TAG}-*.png`);
    root.close();
  } finally {
    if (chrome) chrome.kill();
    try { rmSync(PROFILE, { recursive: true, force: true }); } catch { /* ya no está */ }
    await admin.auth.admin.deleteUser(userId).catch(() => {});
  }
}

main().catch((e: unknown) => { console.error("\n❌", e instanceof Error ? e.message : e); process.exit(1); });
