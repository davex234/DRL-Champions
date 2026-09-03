/**
 * E2E DE NAVEGADOR — el recorrido completo de Duelos contra el sistema REAL (Fase 8).
 *
 *   npm run dev                                     (en otra terminal)
 *   npm run duel:e2e                                (usa http://127.0.0.1:3001)
 *   E2E_BASE_URL=http://127.0.0.1:3000 npm run duel:e2e
 *
 * QUÉ HACE, y por qué no es una prueba de humo:
 *   Crea un usuario real, le concede cartas por la RPC del servidor, abre Chrome de verdad, INICIA
 *   SESIÓN de verdad y recorre con clics reales: Duelos → Mis mazos → Constructor → Preparación →
 *   los diez turnos → Resultado → Repetición → vuelta a Duelos.
 *
 *   Por el camino vigila lo que un HTTP 200 no ve: errores de consola, avisos de hidratación,
 *   desbordamiento horizontal a 390 px y a 1440 px, y que no haya ráfagas de peticiones.
 *
 * Limpia el usuario y todo lo que creó.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !ANON || !SERVICE) {
  console.error("Faltan las variables de Supabase en .env.local");
  process.exit(1);
}

let failures = 0;
const check = (l: string, c: boolean, d = "") => {
  console.log(`  ${c ? "✓" : "✕"} ${l}${d ? ` — ${d}` : ""}`);
  if (!c) failures++;
};

const admin = createClient(URL_!, SERVICE!, { auth: { persistSession: false } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Clave con la que el SDK de Supabase guarda la sesión: `sb-<primer segmento del host>-auth-token`. */
const storageKey = `sb-${new URL(URL_!).hostname.split(".")[0]}-auth-token`;

// ───────────────────────────── cliente mínimo del protocolo DevTools ─────────────────────────────

function connect(url: string) {
  const ws = new WebSocket(url);
  let id = 0;
  const pending = new Map<number, { res: (v: any) => void; rej: (e: Error) => void }>();
  const events = new Map<string, ((p: any) => void)[]>();
  ws.addEventListener("message", (ev: MessageEvent) => {
    const m = JSON.parse(ev.data as string);
    if (m.id && pending.has(m.id)) {
      const entry = pending.get(m.id)!;
      pending.delete(m.id);
      if (m.error) entry.rej(new Error(m.error.message)); else entry.res(m.result);
    } else if (m.method) {
      for (const fn of events.get(m.method) ?? []) fn(m.params);
    }
  });
  return {
    ready: new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); }),
    send: (method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<any> =>
      new Promise((res, rej) => { const n = ++id; pending.set(n, { res, rej }); ws.send(JSON.stringify({ id: n, method, params, sessionId })); }),
    on: (method: string, fn: (p: any) => void) => events.set(method, [...(events.get(method) ?? []), fn]),
    close: () => ws.close(),
  };
}

const CHROME = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome", "/usr/bin/chromium",
].find((p) => existsSync(p));

async function main() {
  console.log(`# E2E de navegador — Duelos · ${BASE}\n`);

  // ── El servidor tiene que ser EL NUESTRO ──
  try {
    const ping = await fetch(`${BASE}/api/game/state`);
    const body = await ping.json().catch(() => ({}));
    const ours = ping.status === 401 && body?.error === "No autenticado";
    check("el servidor responde y es esta aplicación", ours, ours ? "" : `status=${ping.status}`);
    if (!ours) {
      console.error(`\n❌ ${BASE} no es DRL Champions. Arranca \`npm run dev\` y pasa el puerto correcto:`);
      console.error("   E2E_BASE_URL=http://127.0.0.1:3001 node scripts/duel-e2e-browser.mjs");
      process.exit(1);
    }
  } catch {
    console.error(`\n❌ No hay servidor en ${BASE}.`);
    process.exit(1);
  }
  if (!CHROME) { console.error("No se encontró Chrome ni Edge."); process.exit(1); }

  // ── Usuario real con cartas reales ──
  const email = `duel-e2e-${Date.now()}@example.invalid`;
  const password = "Test-1234-duel";
  const { data: created, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { username: "duele2e" },
  });
  if (error || !created.user) throw new Error(error?.message);
  const userId = created.user.id;

  const PROFILE = mkdtempSync(join(tmpdir(), "duel-e2e-"));
  const PORT = 9700 + Math.floor(Math.random() * 200);
  let chrome: ReturnType<typeof spawn> | undefined;

  try {
    // Cartas por la MISMA RPC del juego, no insertando filas a mano.
    const cardIds = duelReadyCardIds();
    const { error: grantErr } = await admin.rpc("app_grant_cards", {
      p_user: userId, p_instances: cardIds.map((cardId) => ({ cardId, serial: null })),
      p_mint_delta: {}, p_origin: "admin",
    });
    check("se conceden 10 cartas legales por la RPC del servidor", !grantErr, grantErr?.message);

    // Sesión real: el mismo `signInWithPassword` que usa la pantalla de acceso.
    const pub = createClient(URL_!, ANON!, { auth: { persistSession: false } });
    const { data: signin, error: signErr } = await pub.auth.signInWithPassword({ email, password });
    if (signErr || !signin.session) throw new Error(signErr?.message ?? "no hay sesión");
    check("el usuario inicia sesión de verdad", Boolean(signin.session.access_token));

    // ── Chrome ──
    chrome = spawn(CHROME, [
      "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
      `--remote-debugging-port=${PORT}`, "--user-data-dir=" + PROFILE, "about:blank",
    ], { stdio: "ignore" });

    let wsUrl: string | undefined;
    for (let i = 0; i < 80; i++) {
      try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) { wsUrl = (await r.json()).webSocketDebuggerUrl; break; } } catch { /* arrancando */ }
      await sleep(250);
    }
    if (!wsUrl) throw new Error("Chrome no abrió el puerto de depuración");

    const root = connect(wsUrl!);
    await root.ready;
    const { targetId } = await root.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await root.send("Target.attachToTarget", { targetId, flatten: true });
    const send = (m: string, p: Record<string, unknown> = {}) => root.send(m, p, sessionId);

    await send("Page.enable");
    await send("Runtime.enable");
    await send("Log.enable");
    await send("Network.enable");

    // Vigilancia: errores de consola y peticiones a la API de duelos.
    const consoleErrors: string[] = [];
    const requests: string[] = [];
    root.on("Runtime.consoleAPICalled", (p: any) => {
      if (p.type === "error" || p.type === "warning") {
        const text = (p.args ?? []).map((a: any) => a.value ?? a.description ?? "").join(" ");
        if (text.trim()) consoleErrors.push(`${p.type}: ${text.slice(0, 200)}`);
      }
    });
    root.on("Runtime.exceptionThrown", (p: any) => {
      consoleErrors.push(`exception: ${p.exceptionDetails?.exception?.description?.slice(0, 200) ?? "?"}`);
    });
    root.on("Network.requestWillBeSent", (p: any) => {
      if (p.request.url.includes("/api/game/duel")) requests.push(p.request.url.replace(BASE, ""));
    });

    const goto = async (path: string, wait = 1600) => {
      const loaded = new Promise<void>((res) => root.on("Page.loadEventFired", () => res()));
      await send("Page.navigate", { url: `${BASE}${path}` });
      await Promise.race([loaded, sleep(8000)]);
      await sleep(wait);
    };
    const evalJs = async (expression: string): Promise<any> => {
      const { result, exceptionDetails } = await send("Runtime.evaluate", {
        expression, returnByValue: true, awaitPromise: true,
      });
      if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? "error en la página");
      return result.value;
    };

    // Sesión en el almacenamiento del navegador, igual que la deja el SDK tras iniciar sesión.
    await goto("/", 400);
    await evalJs(`localStorage.setItem(${JSON.stringify(storageKey)}, ${JSON.stringify(JSON.stringify(signin.session))}); true`);

    // ═══════════════ 1 · Duelos ═══════════════
    console.log("\n## Recorrido");
    await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await goto("/duelos", 2500);
    let text = await evalJs("document.body.innerText");
    check("1 · /duelos carga con sesión iniciada", /Duelos/.test(text) && !/Necesitas una cuenta|Inicia sesión/i.test(text));

    // ═══════════════ 2 · Constructor ═══════════════
    await goto("/duelos/mazos", 2500);
    text = await evalJs("document.body.innerText");
    check("2 · /duelos/mazos ofrece crear el primer mazo", /Crear mi primer mazo|Nuevo mazo/i.test(text));

    const built = await evalJs(`(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const btns = () => [...document.querySelectorAll('button')];
      const create = btns().find(b => /Crear mi primer mazo|\\+ Nuevo mazo/i.test(b.textContent));
      if (!create) return 'sin-boton-crear';
      create.click(); await sleep(900);
      const cards = btns().filter(b => /OVR \\d+$/.test(b.getAttribute('aria-label') || ''));
      if (cards.length < 10) return 'pocas-cartas:' + cards.length;
      for (const c of cards) { if (!c.disabled) c.click(); await sleep(60); }
      await sleep(400);
      const save = btns().find(b => /Guardar mazo/i.test(b.textContent));
      if (!save || save.disabled) return 'guardar-bloqueado';
      save.click(); await sleep(2200);
      return document.body.innerText;
    })()`);
    check("3 · se construye y guarda un mazo de 10 cartas", typeof built === "string" && /LISTO PARA DUELO|Listo para duelo/i.test(built),
      typeof built === "string" ? "" : String(built));

    // ═══════════════ 3 · Preparación ═══════════════
    await goto("/duelos/jugar", 2500);
    text = await evalJs("document.body.innerText");
    check("4 · la preparación muestra mazo, rival y reglas",
      /Preparación/.test(text) && /Fácil/.test(text) && /Normal/.test(text) && /Difícil/.test(text) && /Comenzar duelo/i.test(text));
    check("5 · se explica que ningún nivel ve las cartas ocultas", /Ningún nivel ve las cartas que no has jugado/i.test(text));

    const started = await evalJs(`(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const b = [...document.querySelectorAll('button')].find(x => /Comenzar duelo/i.test(x.textContent));
      if (!b || b.disabled) return 'boton-bloqueado';
      b.click(); await sleep(2600);
      return document.body.innerText;
    })()`);
    check("6 · el duelo empieza en el turno 1 de 10", typeof started === "string" && /1 \/ 10/.test(started), String(started).slice(0, 80));

    // ═══════════════ 4 · Los diez turnos ═══════════════
    const playAll = await evalJs(`(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const btns = () => [...document.querySelectorAll('button')];
      const log = [];
      for (let t = 0; t < 14; t++) {
        const cont = btns().find(b => b.textContent.trim() === 'Continuar');
        if (cont) { cont.click(); await sleep(420); }
        const confirm = () => btns().find(b => /^(Elige una carta|Elige una estadística|Declarar y atacar|Responder)$/.test(b.textContent.trim()));
        if (!confirm()) break;
        const cards = btns().filter(b => /OVR \\d+$/.test(b.getAttribute('aria-label') || ''));
        if (!cards.length) break;
        cards[0].click(); await sleep(260);
        const stats = btns().filter(b => !b.getAttribute('aria-label') && /^(SH|GS|EF)/.test(b.textContent.trim()));
        if (stats.length === 3) { stats[0].click(); await sleep(260); }
        const c = confirm();
        if (!c || c.disabled) { log.push('bloqueado'); break; }
        c.click(); await sleep(1500);
        const m = document.body.innerText.match(/(\\d+) \\/ 10/);
        log.push(m ? m[1] : '?');
      }
      const cont2 = btns().find(b => b.textContent.trim() === 'Continuar');
      if (cont2) { cont2.click(); await sleep(900); }
      return { log, text: document.body.innerText };
    })()`);
    check("7 · se juegan los diez turnos con clics reales", (playAll.log ?? []).length >= 10, `turnos: ${(playAll.log ?? []).join(",")}`);

    // ═══════════════ 5 · Resultado ═══════════════
    const res = playAll.text ?? "";
    const outcome = /VICTORIA/.test(res) ? "VICTORIA" : /DERROTA/.test(res) ? "DERROTA" : /EMPATE/.test(res) ? "EMPATE" : null;
    check("8 · aparece el resultado final", Boolean(outcome), outcome ?? res.slice(0, 120));
    check("9 · el resultado explica por qué terminó así",
      /Ganó más enfrentamientos|desempate|Empate en/i.test(res));
    check("10 · el resumen trae turnos, empates y estadística total",
      /TURNOS GANADOS/i.test(res) && /TURNOS EMPATADOS/i.test(res) && /ESTADÍSTICA TOTAL/i.test(res));
    check("11 · ofrece volver a jugar, ver la partida y mis mazos",
      /VOLVER A JUGAR/i.test(res) && /VER LA PARTIDA/i.test(res) && /MIS MAZOS/i.test(res));

    // ═══════════════ 6 · Repetición ═══════════════
    const replay = await evalJs(`(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const b = [...document.querySelectorAll('button')].find(x => /VER LA PARTIDA/i.test(x.textContent));
      if (!b) return 'sin-boton';
      b.click(); await sleep(2600);
      const next = [...document.querySelectorAll('button')].find(x => x.getAttribute('aria-label') === 'Turno siguiente');
      if (next) { next.click(); await sleep(400); next.click(); await sleep(400); }
      const prev = [...document.querySelectorAll('button')].find(x => x.getAttribute('aria-label') === 'Turno anterior');
      if (prev) { prev.click(); await sleep(400); }
      const reglas = [...document.querySelectorAll('[title]')].map(e => e.getAttribute('title')).join(' | ');
      return { url: location.href, text: document.body.innerText, reglas };
    })()`);
    check("12 · la repetición se abre en su ruta", /\/duelos\/replay\//.test(replay.url ?? ""), replay.url ?? String(replay));
    check("13 · la repetición recorre turnos hacia delante y hacia atrás",
      /TURNO \d+ DE 10/.test(replay.text ?? "") && /2 \/ 10/.test(replay.text ?? ""));
    // El jugador ve un texto suyo; la versión interna del reglamento sigue disponible para soporte,
    // pero no se le enseña como jerga.
    check("14 · la repetición nombra las reglas en lenguaje de jugador",
      /Reglas del duelo/.test(replay.text ?? "") && !/duel-combat-\d/.test(replay.text ?? ""));
    check("14b · la versión interna del reglamento sigue siendo trazable",
      /duel-combat-2/.test(replay.reglas ?? ""), replay.reglas ?? "");

    // ═══════════════ 7 · Vuelta a Duelos ═══════════════
    const back = await evalJs(`(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const b = [...document.querySelectorAll('button')].find(x => /‹ Volver/i.test(x.textContent));
      if (b) { b.click(); await sleep(2600); }
      return { url: location.href, text: document.body.innerText };
    })()`);
    check("15 · se vuelve a Duelos y la partida aparece en repeticiones",
      /\/duelos$/.test(back.url ?? "") && /Repeticiones/i.test(back.text ?? ""), back.url ?? "");

    // ═══════════════ 8 · Pulido de la demo ═══════════════
    console.log("\n## Pulido de la demo (Fase 8.5)");
    {
      // Ningún identificador interno debe asomar en las pantallas del jugador.
      const jerga: string[] = [];
      const bannerEn: string[] = [];
      for (const path of ["/duelos", "/duelos/mazos", "/duelos/jugar"]) {
        await goto(path, 2200);
        const t = String(await evalJs("document.body.innerText"));
        if (/(EASY|NORMAL|HARD)/.test(t)) jerga.push(path);
        if (/INSTALAR DRL CHAMPIONS/.test(t)) bannerEn.push(path);
      }
      check("las dificultades se nombran en español, sin códigos internos", jerga.length === 0, jerga.join(", "));
      check("el aviso de instalación no aparece dentro de Duelos", bannerEn.length === 0, bannerEn.join(", "));

      // «Guardar mazo» no puede invitar a guardar un mazo vacío.
      await goto("/duelos/mazos", 2400);
      const guardar = await evalJs(`(async () => {
        const s = ms => new Promise(r => setTimeout(r, ms));
        const B = () => [...document.querySelectorAll('button')];
        const abrir = B().find(b => /Crear mi primer mazo|Nuevo mazo/i.test(b.textContent));
        if (!abrir) return { error: 'sin acceso al constructor' };
        abrir.click(); await s(1200);
        const g = () => B().find(b => /Guardar mazo/i.test(b.textContent));
        const conCero = g() ? g().disabled : null;
        const c = B().filter(b => /OVR \\d+$/.test(b.getAttribute('aria-label') || ''))[0];
        if (c) { c.click(); await s(600); }
        return { conCero, conUna: g() ? g().disabled : null };
      })()`);
      check("«Guardar mazo» está deshabilitado con 0 cartas", guardar.conCero === true, JSON.stringify(guardar));
      check("y se habilita en cuanto hay una carta", guardar.conUna === false, JSON.stringify(guardar));
    }

    // ═══════════════ 9 · Calidad ═══════════════
    console.log("\n## Calidad de la interfaz");
    const realErrors = consoleErrors.filter((e: string) =>
      // Se descartan los avisos que NO son defectos de la aplicación: herramientas de Next en
      // desarrollo, imágenes de jugador que aún no existen, y el aviso de framer-motion sobre el
      // "movimiento reducido" del sistema —que en un navegador headless está siempre activo—.
      !/metadataBase|React DevTools|HMR|Fast Refresh|favicon|players\/|teams\/|Reduced Motion/.test(e));
    check("sin errores de consola durante todo el recorrido", realErrors.length === 0, realErrors.slice(0, 3).join(" | "));
    check("sin avisos de hidratación", !consoleErrors.some((e: string) => /hydrat/i.test(e)));

    // Peticiones: han de ser proporcionales a las acciones, no una ráfaga.
    check("sin ráfagas de peticiones a la API de duelos", requests.length < 80, `${requests.length} peticiones`);

    // Responsive: ninguna de las pantallas puede desbordar a lo ancho.
    const VIEWPORTS: [number, number, string][] = [[390, 844, "móvil 390px"], [768, 1024, "tableta 768px"], [1440, 900, "escritorio 1440px"]];
    for (const [w, h, label] of VIEWPORTS) {
      await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: w < 500 });
      const overflow: string[] = [];
      for (const path of ["/duelos", "/duelos/mazos", "/duelos/jugar"]) {
        await goto(path, 2200);
        const over = await evalJs(`(() => {
          const de = document.documentElement;
          const scroll = de.scrollWidth, client = de.clientWidth;
          let worst = null;
          if (scroll > client + 2) {
            for (const el of document.querySelectorAll('*')) {
              const r = el.getBoundingClientRect();
              if (r.width > 0 && r.right > client + 2) { worst = el.tagName + '.' + String(el.className).split(' ')[0] + ' +' + Math.round(r.right - client) + 'px'; break; }
            }
          }
          return { over: scroll - client, worst };
        })()`);
        if (over.over > 2) overflow.push(`${path}: +${over.over}px (${over.worst ?? "?"})`);
      }
      check(`sin desbordamiento horizontal en ${label}`, overflow.length === 0, overflow.join(" · "));
    }

    root.close();
  } finally {
    if (chrome) chrome.kill();
    try { rmSync(PROFILE, { recursive: true, force: true }); } catch { /* ya no está */ }
    await admin.from("duel_matches").delete().eq("user_id", userId);
    await admin.from("duel_decks").delete().eq("user_id", userId);
    await admin.auth.admin.deleteUser(userId).catch(() => {});
  }

  console.log(`\n${failures === 0 ? "✅ TODAS LAS COMPROBACIONES PASAN" : `❌ ${failures} COMPROBACIÓN(ES) FALLARON`}`);
  process.exit(failures === 0 ? 0 : 1);
}

/** Diez cartas legales del catálogo: dos jugadores DISTINTOS por rol. */
function duelReadyCardIds(): string[] {
  const registry = new CardRegistry();
  const ids: string[] = [];
  for (const role of DUEL_ROLES) {
    const best = new Map<string, { id: string; ovr: number }>();
    for (const c of registry.forRole(role)) {
      if (!c.combat) continue;
      const prev = best.get(c.playerId);
      if (!prev || c.ovr > prev.ovr) best.set(c.playerId, { id: c.id, ovr: c.ovr });
    }
    const arr = [...best.values()].sort((a, b) => b.ovr - a.ovr || a.id.localeCompare(b.id));
    ids.push(arr[0].id, arr[1].id);
  }
  return ids;
}

main().catch((e: unknown) => {
  console.error("\n❌ Error inesperado:", e instanceof Error ? e.message : e);
  process.exit(1);
});
