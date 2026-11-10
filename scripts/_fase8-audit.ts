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
const OUT = process.env.SHOT_DIR!;
const ETIQUETA = process.argv[2] ?? "antes";

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

const TODOS: [number, number, string][] = [[1440,900,"1440"],[1366,768,"1366"],[1280,720,"1280"],[1024,768,"1024"],[768,1024,"768"],[390,844,"390"]];
const VIEWPORTS: [number, number, string][] = process.env.SOLO
  ? TODOS.filter((v) => process.env.SOLO!.split(",").includes(v[2]))
  : TODOS;

/* ══════════ helpers de juego, en el navegador ══════════ */
const JS = {
  s: `const s=ms=>new Promise(r=>setTimeout(r,ms));`,
  B: `const B=()=>[...document.querySelectorAll('button')];`,
  cards: `const cards=()=>B().filter(b=>/OVR \\d+$/.test(b.getAttribute('aria-label')||''));`,
  conf: `const conf=()=>B().find(b=>/^(Elige una carta|Elige una estadística|Declarar y atacar|Responder)$/.test(b.textContent.trim()));`,
  cont: `const cont=()=>B().find(b=>b.textContent.trim()==='Continuar');`,
  stats: `const stats=()=>B().filter(b=>!b.getAttribute('aria-label')&&/^(SH|GS|EF)/.test(b.textContent.trim()));`,
};
const P = Object.values(JS).join("");

/** Radiografía vertical: qué ocupa la pantalla y cuánta mano se ve. */
const RADIOGRAFIA = `(() => {
  const d=document.documentElement, vp=innerHeight;
  const r=(el)=>{ if(!el) return null; const q=el.getBoundingClientRect(); return {top:Math.round(q.top),alto:Math.round(q.height),bot:Math.round(q.bottom)}; };
  const mano=document.querySelector('[aria-label="Tu mano"]');
  const cartas=mano?[...mano.querySelectorAll('button')]:[];
  const dentro=(q)=>q.top>=0&&q.bottom<=vp&&q.width>20;
  const boton=[...document.querySelectorAll('button')].find(x=>/^(Elige una carta|Elige una estadística|Declarar y atacar|Responder)$/.test(x.textContent.trim()));
  return {
    vp, pagina:d.scrollHeight, exceso:d.scrollHeight-vp,
    overflowX:d.scrollWidth-d.clientWidth,
    barra:r(document.querySelector('header.nx-chrome')),
    controles:r(document.querySelector('[data-arena="controles"]')),
    manoRect:r(mano),
    cartas:cartas.length,
    visibles:cartas.filter(c=>dentro(c.getBoundingClientRect())).length,
    botonVisible:boton?dentro(boton.getBoundingClientRect()):false,
    anchoCarta:cartas[0]?Math.round(cartas[0].getBoundingClientRect().width):0,
    altoCarta:cartas[0]?Math.round(cartas[0].getBoundingClientRect().height):0,
  };})()`;

/** Métricas de coste visual. */
const METRICAS = `(() => {
  const all=[...document.querySelectorAll('*')], cs=e=>getComputedStyle(e);
  const html=document.documentElement.outerHTML;
  return {
    dom:all.length,
    anim:all.filter(e=>cs(e).animationName!=='none').length,
    sombras:all.filter(e=>cs(e).boxShadow!=='none').length,
    filtros:all.filter(e=>cs(e).filter!=='none').length,
    capas:all.filter(e=>{const t=cs(e).transform; return t&&t!=='none';}).length,
    mixBlend:all.filter(e=>cs(e).mixBlendMode!=='normal').length,
    rounded:(html.match(/rounded-(?!full)/g)||[]).length,
    roundedFull:(html.match(/rounded-full/g)||[]).length,
    textoPx:(html.match(/text-\\[\\d+px\\]/g)||[]).length,
    shadowClase:(html.match(/shadow-/g)||[]).length,
    hex:(html.match(/#[0-9a-fA-F]{6}\\b/g)||[]).length,
    zArb:(html.match(/z-\\[\\d+\\]/g)||[]).length,
    bgInline:(html.match(/style="[^"]*background/g)||[]).length,
  };})()`;


/** Desglose vertical del tablero: cada bloque, su alto y su nombre. */
const DESGLOSE = `(() => {
  const nom=(el)=>{
    if(!el) return '?';
    const a=el.getAttribute('aria-label'); if(a) return a.slice(0,26);
    const d=el.getAttribute('data-arena'); if(d) return 'data:'+d;
    const c=(el.className&&el.className.baseVal!==undefined?el.className.baseVal:el.className)||'';
    return el.tagName.toLowerCase()+'.'+String(c).split(' ').slice(0,2).join('.');
  };
  const col=[...document.querySelectorAll('div')].find(e=>e.style && e.style.getPropertyValue('--pos'))||document.body;
  const out=[];
  const walk=(el,d)=>{
    for(const ch of el.children){
      const q=ch.getBoundingClientRect();
      if(q.height<2) continue;
      out.push({d, n:nom(ch), alto:Math.round(q.height), top:Math.round(q.top)});
      if(d<2) walk(ch,d+1);
    }
  };
  if(col) walk(col,0);
  return {pos:getComputedStyle(document.documentElement).getPropertyValue('--pos')||'',
    colAlto: col?Math.round(col.getBoundingClientRect().height):0,
    vp:innerHeight, pagina:document.documentElement.scrollHeight, bloques:out};})()`;


/** Mide dónde acaba la mano tras aplicar una regla CSS. Presentación pura, en vivo. */
const MEDIR = `(() => {
  const mano=document.querySelector('[aria-label="Tu mano"]');
  const q=mano?mano.getBoundingClientRect():null;
  const d=document.documentElement;
  const cartas=mano?[...mano.querySelectorAll('button')]:[];
  const dentro=(r)=>r.top>=0&&r.bottom<=innerHeight&&r.width>20;
  return {bottom:q?Math.round(q.bottom):0, top:q?Math.round(q.top):0,
    exceso:d.scrollHeight-innerHeight, visibles:cartas.filter(c=>dentro(c.getBoundingClientRect())).length,
    anchoCarta:cartas[0]?Math.round(cartas[0].getBoundingClientRect().width):0,
    slot:(()=>{const s=document.querySelector('[aria-label="Tus cartas en la mesa"] > *'); const r=s?s.getBoundingClientRect():null; return r?Math.round(r.width)+'x'+Math.round(r.height):'-';})()};})()`;

const EXPERIMENTOS: [string, string][] = [
  ["A · trail en UNA fila", `.nx-posiciones{grid-template-columns:repeat(var(--pos-cols),minmax(0,1fr))!important}`],
  ["B · A + sin abanico rival", `.nx-posiciones{grid-template-columns:repeat(var(--pos-cols),minmax(0,1fr))!important}[aria-label^="El rival tiene"]{display:none!important}`],
  ["C · A + controles en fila", `.nx-posiciones{grid-template-columns:repeat(var(--pos-cols),minmax(0,1fr))!important}[data-arena="controles"]{flex-direction:row!important;align-items:center!important;gap:12px!important}`],
  ["D · solo controles en fila", `[data-arena="controles"]{flex-direction:row!important;align-items:center!important;gap:12px!important}`],
  ["E · solo sin abanico rival", `[aria-label^="El rival tiene"]{display:none!important}`],
  ["F · A + sin banner móvil del clash", `.nx-posiciones{grid-template-columns:repeat(var(--pos-cols),minmax(0,1fr))!important}[data-arena="clash-movil"]{display:none!important}`],
];

async function main() {
  if (!CHROME) { console.error("No se encontró Chrome."); process.exit(1); }
  const ping = await fetch(`${BASE}/api/game/state`).catch(() => null);
  if (!ping || ping.status !== 401) { console.error(`❌ No hay servidor NEXUS en ${BASE}.`); process.exit(1); }
  mkdirSync(OUT, { recursive: true });
  console.log(`# AUDITORÍA DUELOS (${ETIQUETA}) — ${BASE}\n`);

  const email = `f8-audit-${Date.now()}@example.invalid`;
  const password = ephemeralQaPassword();
  const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { username: "f8audit" } });
  if (error || !created.user) throw new Error(error?.message);
  const userId = created.user.id;

  const PROFILE = mkdtempSync(join(tmpdir(), "f8-audit-"));
  const PORT = 9820 + Math.floor(Math.random() * 60);
  let chrome: ReturnType<typeof spawn> | undefined;
  const errores: string[] = [];

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
    root.on("Runtime.consoleAPICalled", (p: any) => {
      if (p.type === "error") {
        const t = (p.args ?? []).map((a: any) => a.value ?? a.description ?? "").join(" ");
        if (t.trim() && !/404|favicon|manifest/i.test(t)) errores.push(t.slice(0, 160));
      }
    });
    root.on("Runtime.exceptionThrown", (p: any) => errores.push(`exception: ${p.exceptionDetails?.exception?.description?.slice(0, 160) ?? "?"}`));

    const goto = async (path: string, wait = 2400) => {
      const loaded = new Promise<void>((res) => root.on("Page.loadEventFired", () => res()));
      await send("Page.navigate", { url: `${BASE}${path}` });
      await Promise.race([loaded, sleep(9000)]);
      await sleep(wait);
    };
    const js = async (e: string): Promise<any> => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result.value;
    const shot = async (name: string) => {
      const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      writeFileSync(join(OUT, `${ETIQUETA}-${name}.png`), Buffer.from(r.data, "base64"));
    };
    const vp = async (w: number, h: number) => send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: w < 500 });

    await vp(1440, 900);
    await goto("/", 600);
    await js(`localStorage.setItem(${JSON.stringify(storageKey)}, ${JSON.stringify(JSON.stringify(session))}); true`);

    if (process.env.MODO === "mesa") {
      const { error: gE } = await admin.rpc("app_grant_cards", {
        p_user: userId, p_instances: deckCardIds().map((cardId) => ({ cardId, serial: null })), p_mint_delta: {}, p_origin: "admin",
      });
      if (gE) throw new Error(gE.message);
      await goto("/duelos/mazos", 2600);
      await js(`(async()=>{${P}B().find(x=>/Crear mi primer mazo|\+ Nuevo mazo/i.test(x.textContent)).click(); await s(1000);})()`);
      await js(`(async()=>{${P}for(let i=0;i<20;i++){const x=cards().find(b=>b.getAttribute('aria-pressed')==='false'); if(!x)break; x.click(); await s(80);} await s(500);
        B().find(b=>/Guardar mazo/i.test(b.textContent)).click(); await s(2600);})()`);
      for (const [w, h, tag] of [[390,844,"390"],[1280,720,"1280"],[1440,900,"1440"]] as [number,number,string][]) {
        await vp(w, h);
        await goto("/duelos/jugar", 2400);
        await js(`(async()=>{${P}B().find(b=>/Comenzar duelo/i.test(b.textContent)).click(); await s(2800);})()`);
        const txt = await js(`document.body.innerText.replace(/\n+/g,' | ').slice(0,180)`);
        console.log(`   [${tag}] ${txt}`);
        const g = await js(DESGLOSE);
        console.log(`
### ${tag} — vp ${g.vp} · página ${g.pagina} · columna ${g.colAlto} · --pos "${g.pos.trim()}"`);
        for (const b of g.bloques) console.log(`   ${"  ".repeat(b.d)}${String(b.alto).padStart(4)}px  top ${String(b.top).padStart(4)}  ${b.n}`);
      }
      root.close();
      return;
    }

    /* ── 1 · Entrada sin nada ── */
    console.log("## Estados vacíos");
    await goto("/duelos", 2600);
    await shot("01-hub-sin-mazos-1440");
    await goto("/duelos/jugar", 2600);
    await shot("02-lobby-sin-mazo-1440");

    /* ── 2 · Con cartas ── */
    const { error: gErr } = await admin.rpc("app_grant_cards", {
      p_user: userId, p_instances: deckCardIds().map((cardId) => ({ cardId, serial: null })), p_mint_delta: {}, p_origin: "admin",
    });
    if (gErr) throw new Error(gErr.message);

    console.log("## Mazo");
    await goto("/duelos/mazos", 2600);
    await js(`(async()=>{${P}B().find(x=>/Crear mi primer mazo|\\+ Nuevo mazo/i.test(x.textContent)).click(); await s(1000);})()`);
    await js(`(async()=>{${P}for(let i=0;i<6;i++){const x=cards().find(b=>b.getAttribute('aria-pressed')==='false'); if(!x)break; x.click(); await s(80);} await s(400);})()`);
    await shot("03-mazo-incompleto-1440");
    await js(`(async()=>{${P}for(let i=0;i<20;i++){const x=cards().find(b=>b.getAttribute('aria-pressed')==='false'); if(!x)break; x.click(); await s(80);} await s(500);
      B().find(b=>/Guardar mazo/i.test(b.textContent)).click(); await s(2600);})()`);
    await shot("04-mis-mazos-1440");
    await goto("/duelos", 2600);
    await shot("05-hub-con-mazo-1440");

    /* ── 3 · La partida, en los seis anchos ── */
    for (const [w, h, tag] of VIEWPORTS) {
      console.log(`\n## ${w}×${h}`);
      await vp(w, h);
      await goto("/duelos/jugar", 2600);
      await shot(`06-preparacion-${tag}`);
      const prep = await js(RADIOGRAFIA);
      console.log(`   preparación: página ${prep.pagina} / vp ${prep.vp} · exceso ${prep.exceso} · overflowX ${prep.overflowX}`);

      await js(`(async()=>{${P}const d=B().find(b=>/^Difícil/i.test(b.textContent.trim())); if(d){d.click(); await s(300);}
        B().find(b=>/Comenzar duelo/i.test(b.textContent)).click(); await s(2800);})()`);
      await shot(`07-turno1-${tag}`);
      const idle = await js(RADIOGRAFIA);
      console.log(`   turno 1: página ${idle.pagina} / vp ${idle.vp} · exceso ${idle.exceso} · overflowX ${idle.overflowX}`);
      console.log(`     mano ${idle.visibles}/${idle.cartas} visibles · carta ${idle.anchoCarta}×${idle.altoCarta} · botón ${idle.botonVisible ? "visible" : "FUERA"}`);
      console.log(`     barra ${JSON.stringify(idle.barra)} · controles ${JSON.stringify(idle.controles)} · mano ${JSON.stringify(idle.manoRect)}`);
      if (tag === "1440" || tag === "390") console.log(`   MET idle ${tag}: ${JSON.stringify(await js(METRICAS))}`);
      if (process.env.EXP && tag === "390") {
        const base = await js(MEDIR);
        console.log(`   EXPERIMENTO base: mano ${base.top}–${base.bottom} · exceso ${base.exceso} · visibles ${base.visibles} · slot ${base.slot}`);
        for (const [nombre, css] of EXPERIMENTOS) {
          await js(`(()=>{let e=document.getElementById('exp');if(!e){e=document.createElement('style');e.id='exp';document.head.appendChild(e);}e.textContent=${JSON.stringify(css)};return true;})()`);
          await js(`new Promise(r=>setTimeout(r,420))`);
          const m = await js(MEDIR);
          console.log(`     ${nombre.padEnd(34)} mano ${String(m.top).padStart(4)}–${String(m.bottom).padStart(4)} · exceso ${String(m.exceso).padStart(4)} · visibles ${m.visibles}/10 · slot ${m.slot}`);
        }
        await js(`(()=>{const e=document.getElementById('exp'); if(e) e.textContent=''; return true;})()`);
      }
      if (process.env.DESGLOSE) {
        const g = await js(DESGLOSE);
        console.log(`   DESGLOSE ${tag} — columna ${g.colAlto}px · --pos "${String(g.pos).trim()}"`);
        for (const b of g.bloques) console.log(`     ${"  ".repeat(b.d)}${String(b.alto).padStart(4)}px top ${String(b.top).padStart(4)}  ${b.n}`);
      }

      await js(`(async()=>{${P}cards()[0].click(); await s(500);})()`);
      await shot(`08-carta-elegida-${tag}`);
      const sel = await js(RADIOGRAFIA);
      console.log(`   carta elegida: mano ${sel.visibles}/${sel.cartas} · exceso ${sel.exceso}`);

      await js(`(async()=>{${P}const st=stats(); if(st.length===3){st[0].click(); await s(400);}})()`);
      await shot(`09-stat-declarada-${tag}`);
      await js(`(async()=>{${P}const c=conf(); if(c&&!c.disabled){c.click(); await s(560);}})()`);
      await shot(`10-clash-${tag}`);
      if (tag === "1440" || tag === "390") console.log(`   MET clash ${tag}: ${JSON.stringify(await js(METRICAS))}`);
      await js(`(async()=>{${P}const c0=cont(); if(c0){c0.click(); await s(700);}})()`);
      await shot(`11-tras-clash-${tag}`);

      const fase = await js(`(async()=>{${P}
        for(let i=0;i<6;i++){ const c0=cont(); if(c0){c0.click(); await s(420);}
          if(/obligado a responder con/i.test(document.body.innerText)) return 'defendiendo';
          if(!conf()) break; const l=cards(); if(!l.length) break; l[0].click(); await s(240);
          const st=stats(); if(st.length===3){st[0].click(); await s(240);}
          const c=conf(); if(!c||c.disabled) break; c.click(); await s(2000);}
        return 'no llegó a defender';})()`);
      await shot(`12-defendiendo-${tag}`);
      console.log(`   ${fase}`);

      await js(`(async()=>{${P}for(let i=0;i<14;i++){
          const c0=cont(); if(c0){c0.click(); await s(380);} if(!conf()) break;
          const l=cards(); if(!l.length) break; l[0].click(); await s(240);
          const st=stats(); if(st.length===3){st[0].click(); await s(240);}
          const c=conf(); if(!c||c.disabled) break; c.click(); await s(1900);}
        const c1=cont(); if(c1){c1.click(); await s(1100);}})()`);
      await shot(`13-resultado-${tag}`);
      const res = await js(`(()=>{const t=document.body.innerText.replace(/\\n+/g,' | ');
        return {texto:t.slice(0,320), botones:[...document.querySelectorAll('button,a')].filter(b=>b.offsetParent).map(b=>b.textContent.trim()).filter(Boolean).slice(0,12)};})()`);
      console.log(`   resultado: ${res.texto.slice(0, 240)}`);
      console.log(`   acciones: ${JSON.stringify(res.botones)}`);
      if (tag === "1440" || tag === "390") console.log(`   MET resultado ${tag}: ${JSON.stringify(await js(METRICAS))}`);
    }

    /* ── 4 · Zonas táctiles a 390 ── */
    console.log("\n## Accesibilidad a 390");
    await vp(390, 844);
    await goto("/duelos/jugar", 2600);
    const a11y = await js(`(() => {
      const b=[...document.querySelectorAll('button, a')].filter(x=>x.offsetParent!==null);
      const chicos=b.map(x=>({t:(x.getAttribute('aria-label')||x.textContent.trim()).slice(0,26),h:Math.round(x.getBoundingClientRect().height),w:Math.round(x.getBoundingClientRect().width)}))
        .filter(x=>x.h>0&&(x.h<32||x.w<32));
      return {total:b.length, pequenos:chicos.length, ejemplos:chicos.slice(0,8)};})()`);
    console.log(`   ${a11y.total} interactivos · ${a11y.pequenos} por debajo de 32 px`);
    for (const e of a11y.ejemplos ?? []) console.log(`     · "${e.t}" ${e.w}×${e.h}`);

    console.log(`\n## Errores de consola: ${errores.length}`);
    for (const e of errores.slice(0, 8)) console.log(`   · ${e}`);

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
