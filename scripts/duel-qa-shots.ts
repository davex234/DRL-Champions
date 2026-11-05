/**
 * CAPTURAS DE QA — Duelos (Fase 8.5).
 *
 *   npm run dev            (en otra terminal)
 *   npm run duel:shots
 *
 * Recorre las pantallas de Duelos en tres anchos (390 / 768 / 1440) y guarda un PNG de cada una en
 * `docs/product/qa/`. Sirve para juzgar lo que un test no puede: legibilidad, tamaño de las zonas
 * táctiles, si el marcador se lee de un vistazo y si las cartas siguen siendo reconocibles en móvil.
 *
 * Va en headless a propósito: una pestaña en segundo plano estrangula temporizadores y animaciones,
 * así que ni el reveal ni los tiempos serían representativos.
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

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3001";
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const OUT = join(ROOT, "docs", "product", "qa");

const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });
const registry = new CardRegistry();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
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

const VIEWPORTS: [number, number, string][] = [[1440, 900, "1440"], [768, 1024, "768"], [390, 844, "390"]];

async function main() {
  if (!CHROME) { console.error("No se encontró Chrome."); process.exit(1); }
  const ping = await fetch(`${BASE}/api/game/state`).catch(() => null);
  if (!ping || ping.status !== 401) { console.error(`❌ No hay servidor NEXUS en ${BASE}.`); process.exit(1); }

  mkdirSync(OUT, { recursive: true });
  console.log(`# Capturas de QA — ${BASE} → docs/product/qa/\n`);

  const email = `qa-shot-${Date.now()}@example.invalid`;
  const password = ephemeralQaPassword();
  const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { username: "qashot" } });
  if (error || !created.user) throw new Error(error?.message);
  const userId = created.user.id;

  const PROFILE = mkdtempSync(join(tmpdir(), "duel-shot-"));
  const PORT = 9960 + Math.floor(Math.random() * 30);
  let chrome: ReturnType<typeof spawn> | undefined;

  try {
    const pub = createClient(URL_, ANON, { auth: { persistSession: false } });
    const { data: signin } = await pub.auth.signInWithPassword({ email, password });
    const session = signin!.session!;

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

    const goto = async (path: string, wait = 2400) => {
      const loaded = new Promise<void>((res) => root.on("Page.loadEventFired", () => res()));
      await send("Page.navigate", { url: `${BASE}${path}` });
      await Promise.race([loaded, sleep(9000)]);
      await sleep(wait);
    };
    const js = async (e: string): Promise<any> => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result.value;
    const shot = async (name: string) => {
      const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      writeFileSync(join(OUT, `${name}.png`), Buffer.from(r.data, "base64"));
      console.log(`  ✓ ${name}.png`);
    };

    await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await goto("/", 600);
    await js(`localStorage.setItem(${JSON.stringify(storageKey)}, ${JSON.stringify(JSON.stringify(session))}); true`);

    // ── 1 · Estados vacíos: lo PRIMERO que ve alguien sin cartas ──
    console.log("## Primer usuario (sin cartas, sin mazos)");
    await goto("/duelos", 2600);
    await shot("01-hub-sin-mazos-1440");
    console.log("     texto: " + String(await js("document.body.innerText.split('EL MUNDO')[1].replace(/\\n+/g,' | ').slice(0,220)")));
    await goto("/duelos/mazos", 2600);
    await js(`(async()=>{const b=[...document.querySelectorAll('button')].find(x=>/Crear mi primer mazo/i.test(x.textContent)); if(b){b.click(); await new Promise(r=>setTimeout(r,1200));} })()`);
    await shot("02-constructor-sin-cartas-1440");
    console.log("     texto: " + String(await js("document.body.innerText.split('EL MUNDO')[1].replace(/\\n+/g,' | ').slice(0,220)")));
    await goto("/duelos/jugar", 2600);
    await shot("03-lobby-sin-mazo-1440");
    console.log("     texto: " + String(await js("document.body.innerText.split('EL MUNDO')[1].replace(/\\n+/g,' | ').slice(0,220)")));

    // ── 2 · Con cartas ──
    const { error: gErr } = await admin.rpc("app_grant_cards", {
      p_user: userId, p_instances: deckCardIds().map((cardId) => ({ cardId, serial: null })), p_mint_delta: {}, p_origin: "admin",
    });
    if (gErr) throw new Error(gErr.message);

    console.log("\n## Constructor y mazos");
    await goto("/duelos/mazos", 2600);
    await js(`(async()=>{const s=ms=>new Promise(r=>setTimeout(r,ms));const B=()=>[...document.querySelectorAll('button')];
      B().find(x=>/Crear mi primer mazo|\\+ Nuevo mazo/i.test(x.textContent)).click(); await s(1000);})()`);
    await shot("04-constructor-vacio-1440");
    await js(`(async()=>{const s=ms=>new Promise(r=>setTimeout(r,ms));const B=()=>[...document.querySelectorAll('button')];
      const c=()=>B().filter(b=>/OVR \\d+$/.test(b.getAttribute('aria-label')||''));
      for(let i=0;i<6;i++){const x=c().find(b=>b.getAttribute('aria-pressed')==='false'); if(!x)break; x.click(); await s(80);} await s(400);})()`);
    await shot("05-constructor-a-medias-1440");
    await js(`(async()=>{const s=ms=>new Promise(r=>setTimeout(r,ms));const B=()=>[...document.querySelectorAll('button')];
      const c=()=>B().filter(b=>/OVR \\d+$/.test(b.getAttribute('aria-label')||''));
      for(let i=0;i<20;i++){const x=c().find(b=>b.getAttribute('aria-pressed')==='false'); if(!x)break; x.click(); await s(80);} await s(500);
      B().find(b=>/Guardar mazo/i.test(b.textContent)).click(); await s(2600);})()`);
    await shot("06-mis-mazos-1440");

    // ── 3 · El duelo, en los tres anchos ──
    console.log("\n## El duelo");
    for (const [w, h, tag] of VIEWPORTS) {
      await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: w < 500 });
      await goto("/duelos/jugar", 2600);
      await shot(`10-preparacion-${tag}`);

      // Empezar en Difícil: es la dificultad que mejor demuestra el juego.
      await js(`(async()=>{const s=ms=>new Promise(r=>setTimeout(r,ms));const B=()=>[...document.querySelectorAll('button')];
        const d=B().find(b=>/^Difícil/i.test(b.textContent.trim())); if(d){d.click(); await s(300);}
        B().find(b=>/Comenzar duelo/i.test(b.textContent)).click(); await s(2800);})()`);
      await shot(`11-duelo-turno1-${tag}`);

      // Avanzar hasta un turno DEFENDIENDO, que es donde está la decisión difícil de leer.
      const fase = await js(`(async()=>{
        const s=ms=>new Promise(r=>setTimeout(r,ms));const B=()=>[...document.querySelectorAll('button')];const T=()=>document.body.innerText;
        const cont=()=>B().find(b=>b.textContent.trim()==='Continuar');
        const conf=()=>B().find(b=>/^(Elige una carta|Elige una estadística|Declarar y atacar|Responder)$/.test(b.textContent.trim()));
        const cards=()=>B().filter(b=>/OVR \\d+$/.test(b.getAttribute('aria-label')||''));
        for(let i=0;i<6;i++){
          const c0=cont(); if(c0){c0.click(); await s(400);}
          if(/obligado a responder con/i.test(T())) return 'defendiendo';
          if(!conf()) break;
          cards()[0].click(); await s(250);
          const st=B().filter(b=>!b.getAttribute('aria-label')&&/^(SH|GS|EF)/.test(b.textContent.trim()));
          if(st.length===3){st[0].click(); await s(250);}
          const c=conf(); if(!c||c.disabled) break; c.click(); await s(2200);
        }
        return 'no llegó a defender';})()`);
      await shot(`12-duelo-defendiendo-${tag}`);
      console.log(`     ${tag}px · ${fase}`);

      // Un reveal: se captura ANTES de que se cierre solo.
      await js(`(async()=>{const s=ms=>new Promise(r=>setTimeout(r,ms));const B=()=>[...document.querySelectorAll('button')];
        const conf=()=>B().find(b=>/^(Elige una carta|Elige una estadística|Declarar y atacar|Responder)$/.test(b.textContent.trim()));
        const cards=()=>B().filter(b=>/OVR \\d+$/.test(b.getAttribute('aria-label')||''));
        const c0=B().find(b=>b.textContent.trim()==='Continuar'); if(c0){c0.click(); await s(400);}
        if(conf()){ cards()[0].click(); await s(250);
          const st=B().filter(b=>!b.getAttribute('aria-label')&&/^(SH|GS|EF)/.test(b.textContent.trim()));
          if(st.length===3){st[0].click(); await s(250);} conf().click(); await s(900);} })()`);
      await shot(`13-reveal-${tag}`);

      /*
       * MEDIA PARTIDA. La captura que cuenta el rediseño: con varios turnos jugados, las
       * cartas gastadas siguen SOBRE la mesa —las tuyas abajo, las del rival arriba, cada
       * una con la marca de lo que pasó en su turno— y el tablero cuenta la partida solo.
       * Antes esta captura habría sido idéntica a la del turno 1.
       */
      const acumulado = await js(`(async()=>{const s=ms=>new Promise(r=>setTimeout(r,ms));const B=()=>[...document.querySelectorAll('button')];
        const cont=()=>B().find(b=>b.textContent.trim()==='Continuar');
        const conf=()=>B().find(b=>/^(Elige una carta|Elige una estadística|Declarar y atacar|Responder)$/.test(b.textContent.trim()));
        const cards=()=>B().filter(b=>/OVR \d+$/.test(b.getAttribute('aria-label')||''));
        for(let i=0;i<3;i++){ const c0=cont(); if(c0){c0.click(); await s(420);} if(!conf()) break;
          const l=cards(); if(!l.length) break; l[0].click(); await s(240);
          const st=B().filter(b=>!b.getAttribute('aria-label')&&/^(SH|GS|EF)/.test(b.textContent.trim()));
          if(st.length===3){st[0].click(); await s(240);} const c=conf(); if(!c||c.disabled) break; c.click(); await s(2000);}
        const c1=cont(); if(c1){c1.click(); await s(700);}
        const filas=[...document.querySelectorAll('[role="list"]')].map(l=>({
          zona:l.getAttribute('aria-label'), cartas:l.querySelectorAll('[role="listitem"]').length}));
        return JSON.stringify(filas);})()`);
      await shot(`13b-arena-media-partida-${tag}`);
      console.log(`     ${tag}px · cartas en la mesa: ${acumulado}`);

      // Terminar y capturar resultado + replay.
      await js(`(async()=>{const s=ms=>new Promise(r=>setTimeout(r,ms));const B=()=>[...document.querySelectorAll('button')];const T=()=>document.body.innerText;
        const cont=()=>B().find(b=>b.textContent.trim()==='Continuar');
        const conf=()=>B().find(b=>/^(Elige una carta|Elige una estadística|Declarar y atacar|Responder)$/.test(b.textContent.trim()));
        const cards=()=>B().filter(b=>/OVR \\d+$/.test(b.getAttribute('aria-label')||''));
        for(let i=0;i<14;i++){ const c0=cont(); if(c0){c0.click(); await s(380);} if(!conf()) break;
          cards()[0].click(); await s(240);
          const st=B().filter(b=>!b.getAttribute('aria-label')&&/^(SH|GS|EF)/.test(b.textContent.trim()));
          if(st.length===3){st[0].click(); await s(240);} const c=conf(); if(!c||c.disabled) break; c.click(); await s(1900);}
        const c1=cont(); if(c1){c1.click(); await s(1100);} })()`);
      await shot(`14-resultado-${tag}`);
      await js(`(async()=>{const s=ms=>new Promise(r=>setTimeout(r,ms));
        const b=[...document.querySelectorAll('button')].find(x=>/VER LA PARTIDA/i.test(x.textContent)); if(b){b.click(); await s(2600);} })()`);
      await shot(`15-replay-${tag}`);
    }

    // ── 4 · Zonas táctiles a 390 px ──
    console.log("\n## Zonas táctiles a 390 px");
    await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await goto("/duelos/jugar", 2600);
    const tactil = await js(`(() => {
      const b = [...document.querySelectorAll('button, a')].filter(x => x.offsetParent !== null);
      const chicos = b.map(x => ({ t: (x.getAttribute('aria-label') || x.textContent.trim()).slice(0, 26), h: Math.round(x.getBoundingClientRect().height), w: Math.round(x.getBoundingClientRect().width) }))
                      .filter(x => x.h > 0 && (x.h < 32 || x.w < 32));
      return { total: b.length, pequenos: chicos.length, ejemplos: chicos.slice(0, 6) };
    })()`);
    console.log(`     ${tactil.total} elementos interactivos · ${tactil.pequenos} por debajo de 32 px`);
    for (const e of tactil.ejemplos ?? []) console.log(`       · "${e.t}" ${e.w}×${e.h}`);

    root.close();
  } finally {
    if (chrome) chrome.kill();
    try { rmSync(PROFILE, { recursive: true, force: true }); } catch { /* ya no está */ }
    await admin.from("duel_matches").delete().eq("user_id", userId);
    await admin.from("duel_decks").delete().eq("user_id", userId);
    await admin.auth.admin.deleteUser(userId).catch(() => {});
  }
  console.log("\nListo.");
}

main().catch((e: unknown) => { console.error("\n❌", e instanceof Error ? e.message : e); process.exit(1); });
