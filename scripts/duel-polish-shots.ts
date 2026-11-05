/**
 * CAPTURAS DE POLISH — Duelos. **Herramienta de iteración, no de CI.**
 *
 *   npm run dev            (otra terminal, puerto 3001)
 *   npx tsx scripts/duel-polish-shots.ts --tag antes
 *
 * Recorre los SEIS momentos que deciden si esto parece un videojuego o una web, y captura
 * cada uno en 1440×900 y 390×844:
 *
 *   1. inicio          · el tablero recién abierto
 *   2. seleccionada    · una carta elegida en la mano
 *   3. entrando        · la carta cayendo en su posición (captura a mitad de animación)
 *   4. clash           · la revelación del enfrentamiento
 *   5. mesa            · varios turnos jugados, cartas acumuladas
 *   6. resultado       · la pantalla final
 *
 * Además MIDE lo que un PNG no dice: overflow horizontal, si la mano cabe sin scroll y
 * cuántos nodos animados hay vivos (el polish no puede convertirse en un coste de repintado).
 *
 * Crea su propio usuario y lo borra al terminar.
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
const arg = (k: string, d: string): string => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

const TAG = arg("tag", "shot");
const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3001";
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const OUT = join(ROOT, "docs", "product", "qa", "polish");

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

const VIEWPORTS: [number, number, string][] = [[1440, 900, "1440"], [390, 844, "390"]];

/** Lo que un PNG no cuenta. */
const MEDIR = `(() => {
  const R = (s) => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), b: Math.round(r.bottom) }; };
  return {
    overflowX: Math.round(document.documentElement.scrollWidth - window.innerWidth),
    scrollY: Math.round(document.documentElement.scrollHeight - window.innerHeight),
    mesa: R('[data-arena="mesa"]'),
    mano: R('[data-arena="mano"]'),
    manoVisible: (() => { const m = R('[data-arena="mano"]'); return m ? m.b <= window.innerHeight + 2 : null; })(),
    cartasMano: document.querySelectorAll('[role="group"][aria-label="Tu mano"] button').length,
    huecos: document.querySelectorAll('[data-slot]').length,
    /* Coste de pintado: nodos con transición/animación viva. */
    animando: [...document.querySelectorAll('*')].filter((e) => {
      const s = getComputedStyle(e);
      return s.animationName !== 'none' || (s.transitionProperty !== 'none' && s.transitionProperty !== 'all' && s.transitionDuration !== '0s');
    }).length,
    nodos: document.querySelectorAll('*').length,
  };
})()`;

async function main(): Promise<void> {
  if (!CHROME) { console.error("No se encontró Chrome."); process.exit(1); }
  const ping = await fetch(`${BASE}/api/game/state`).catch(() => null);
  if (!ping || ping.status !== 401) { console.error(`❌ No hay servidor NEXUS en ${BASE} (status ${ping?.status}).`); process.exit(1); }

  mkdirSync(OUT, { recursive: true });
  console.log(`# Capturas de polish — ${BASE} · tag "${TAG}"\n`);

  const email = `qa-polish-${Date.now()}@example.invalid`;
  const password = ephemeralQaPassword();
  const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { username: "qapolish" } });
  if (error || !created.user) throw new Error(error?.message);
  const userId = created.user.id;

  const PROFILE = mkdtempSync(join(tmpdir(), "duel-polish-"));
  const PORT = 9820 + Math.floor(Math.random() * 40);
  let chrome: ReturnType<typeof spawn> | undefined;
  const informe: Record<string, unknown> = {};

  try {
    const pub = createClient(URL_, ANON, { auth: { persistSession: false } });
    const { data: signin } = await pub.auth.signInWithPassword({ email, password });
    const session = signin!.session!;
    const { error: gErr } = await admin.rpc("app_grant_cards", {
      p_user: userId, p_instances: deckCardIds().map((cardId) => ({ cardId, serial: null })), p_mint_delta: {}, p_origin: "admin",
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
    await send("Page.enable"); await send("Runtime.enable"); await send("Log.enable");

    const consola: string[] = [];
    root.on("Runtime.consoleAPICalled", (p: any) => {
      if (p.type === "error") consola.push(`error: ${(p.args ?? []).map((a: any) => a.value ?? a.description ?? "").join(" ").slice(0, 160)}`);
    });
    root.on("Runtime.exceptionThrown", (p: any) => consola.push(`exception: ${p.exceptionDetails?.exception?.description?.slice(0, 180)}`));

    const goto = async (path: string, wait = 2400): Promise<void> => {
      const loaded = new Promise<void>((res) => root.on("Page.loadEventFired", () => res()));
      await send("Page.navigate", { url: `${BASE}${path}` });
      await Promise.race([loaded, sleep(12000)]);
      await sleep(wait);
    };
    const js = async (e: string): Promise<any> => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result.value;
    const shot = async (name: string): Promise<void> => {
      const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      writeFileSync(join(OUT, `${name}.png`), Buffer.from(r.data, "base64"));
    };

    await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await goto("/", 800);
    await js(`localStorage.setItem(${JSON.stringify(storageKey)}, ${JSON.stringify(JSON.stringify(session))}); true`);

    // Un mazo, una vez.
    await goto("/duelos/mazos", 2800);
    await js(`(async()=>{const s=ms=>new Promise(r=>setTimeout(r,ms));const B=()=>[...document.querySelectorAll('button')];
      B().find(x=>/Crear mi primer mazo|\\+ Nuevo mazo/i.test(x.textContent)).click(); await s(1100);
      const c=()=>B().filter(b=>/OVR \\d+$/.test(b.getAttribute('aria-label')||''));
      for(let i=0;i<20;i++){const x=c().find(b=>b.getAttribute('aria-pressed')==='false'); if(!x)break; x.click(); await s(70);} await s(500);
      B().find(b=>/Guardar mazo/i.test(b.textContent)).click(); await s(2800);})()`);

    const elegirCarta = `(async()=>{const s=ms=>new Promise(r=>setTimeout(r,ms));const B=()=>[...document.querySelectorAll('button')];
      const cards=B().filter(b=>/OVR \\d+$/.test(b.getAttribute('aria-label')||''));
      if(cards.length){cards[0].click(); await s(420);}
      const st=B().filter(b=>!b.getAttribute('aria-label')&&/^(SH|GS|EF)/.test(b.textContent.trim()));
      if(st.length===3){st[0].click(); await s(380);} return true;})()`;

    const confirmar = `(()=>{const B=[...document.querySelectorAll('button')];
      const c=B.find(b=>/^(Declarar y atacar|Responder)$/.test(b.textContent.trim()));
      if(c&&!c.disabled){c.click(); return true;} return false;})()`;

    const cerrarReveal = `(async()=>{const s=ms=>new Promise(r=>setTimeout(r,ms));
      const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Continuar');
      if(b){b.click(); await s(500);} return true;})()`;

    for (const [w, h, tag] of VIEWPORTS) {
      await admin.from("duel_matches").delete().eq("user_id", userId);
      await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: w < 500 });
      await goto("/duelos/jugar", 2600);
      await js(`(async()=>{const s=ms=>new Promise(r=>setTimeout(r,ms));const B=()=>[...document.querySelectorAll('button')];
        const d=B().find(b=>/^Normal/i.test(b.textContent.trim())); if(d){d.click(); await s(300);}
        B().find(b=>/Comenzar duelo/i.test(b.textContent)).click(); await s(3000);})()`);

      // 1 · INICIO
      await shot(`${TAG}-${tag}-1-inicio`);
      const m1 = await js(MEDIR);

      // 2 · CARTA SELECCIONADA
      await js(elegirCarta);
      await shot(`${TAG}-${tag}-2-seleccionada`);
      const m2 = await js(MEDIR);

      // 3 · CARTA ENTRANDO — captura A MITAD de la animación de colocación.
      await js(confirmar);
      await sleep(260);
      await shot(`${TAG}-${tag}-3-entrando`);

      // 4 · CLASH — la revelación.
      await sleep(900);
      await shot(`${TAG}-${tag}-4-clash`);

      // 5 · MESA CON VARIAS CARTAS
      await js(cerrarReveal);
      for (let i = 0; i < 3; i++) {
        await js(elegirCarta);
        await js(confirmar);
        await sleep(2100);
        await js(cerrarReveal);
      }
      await shot(`${TAG}-${tag}-5-mesa`);
      const m5 = await js(MEDIR);

      // 6 · RESULTADO — se termina la partida.
      await js(`(async()=>{const s=ms=>new Promise(r=>setTimeout(r,ms));const B=()=>[...document.querySelectorAll('button')];
        const cont=()=>B().find(b=>b.textContent.trim()==='Continuar');
        const conf=()=>B().find(b=>/^(Elige una carta|Elige una estadística|Declarar y atacar|Responder)$/.test(b.textContent.trim()));
        const cards=()=>B().filter(b=>/OVR \\d+$/.test(b.getAttribute('aria-label')||''));
        for(let i=0;i<14;i++){ const c0=cont(); if(c0){c0.click(); await s(400);} if(!conf()) break;
          const l=cards(); if(!l.length) break; l[0].click(); await s(240);
          const st=B().filter(b=>!b.getAttribute('aria-label')&&/^(SH|GS|EF)/.test(b.textContent.trim()));
          if(st.length===3){st[0].click(); await s(240);} const c=conf(); if(!c||c.disabled) break; c.click(); await s(2000);}
        const c1=cont(); if(c1){c1.click(); await s(1200);} })()`);
      await shot(`${TAG}-${tag}-6-resultado`);
      const m6 = await js(MEDIR);

      informe[tag] = { inicio: m1, seleccionada: m2, mesa: m5, resultado: m6 };
      console.log(`## ${tag}px`);
      console.log(`   overflowX ${m1.overflowX} · scrollY ${m1.scrollY} · mano visible ${m1.manoVisible} · cartas en mano ${m1.cartasMano} · huecos ${m1.huecos}`);
      console.log(`   nodos ${m1.nodos} → mesa con cartas ${m5.nodos} · animando ${m1.animando} → ${m5.animando}`);
      console.log("");
    }

    console.log(`## Consola\n   ${consola.length} errores`);
    for (const c of consola.slice(0, 8)) console.log(`     · ${c}`);
    (informe as any).consola = consola;
    writeFileSync(join(OUT, `${TAG}-metricas.json`), JSON.stringify(informe, null, 2));
    console.log(`\n→ docs/product/qa/polish/${TAG}-*.png`);
    root.close();
  } finally {
    if (chrome) chrome.kill();
    try { rmSync(PROFILE, { recursive: true, force: true }); } catch { /* ya no está */ }
    await admin.from("duel_matches").delete().eq("user_id", userId);
    await admin.from("duel_decks").delete().eq("user_id", userId);
    await admin.auth.admin.deleteUser(userId).catch(() => {});
  }
}

main().catch((e: unknown) => { console.error("\n❌", e instanceof Error ? e.message : e); process.exit(1); });
