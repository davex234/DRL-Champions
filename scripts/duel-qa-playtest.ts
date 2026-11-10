/**
 * QA DE EXPERIENCIA DE JUEGO — Duelos (Fase 8.5).
 *
 *   npm run dev            (en otra terminal)
 *   npm run duel:playtest
 *
 * QUÉ ES: seis partidas COMPLETAS jugadas con clics reales en un navegador de verdad, dos por cada
 * dificultad y con dos mazos distintos. No comprueba que el motor funcione —eso ya lo hacen los
 * tests— sino cómo se SIENTE jugar: qué ve el jugador en cada turno, si sabe qué tiene que hacer,
 * cuánto tarda un turno, y si las tres dificultades se notan distintas.
 *
 * POR QUÉ EN HEADLESS Y NO EN LA VENTANA: una pestaña en segundo plano estrangula `setTimeout` y
 * `requestAnimationFrame`, así que el reveal no se cierra y los tiempos no significan nada. En
 * headless la página se trata como visible y los tiempos son reales.
 *
 * Crea su propio usuario y lo borra al terminar: no toca la cuenta de demostración.
 */
import { ephemeralQaPassword } from "./lib/qaCredentials";
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
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });
const registry = new CardRegistry();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const storageKey = `sb-${new URL(URL_).hostname.split(".")[0]}-auth-token`;

const CHROME = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].find((p) => existsSync(p));

function connect(url: string) {
  const ws = new WebSocket(url);
  let id = 0;
  const pending = new Map<number, { res: (v: any) => void; rej: (e: Error) => void }>();
  const events = new Map<string, ((p: any) => void)[]>();
  ws.addEventListener("message", (ev: MessageEvent) => {
    const m = JSON.parse(ev.data as string);
    if (m.id && pending.has(m.id)) {
      const e = pending.get(m.id)!;
      pending.delete(m.id);
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

/** Dos mazos legales DISTINTOS: bloques 0 y 1 del catálogo por rol. */
function twoDecks(): string[][] {
  const out: string[][] = [[], []];
  for (const role of DUEL_ROLES) {
    const best = new Map<string, { id: string; ovr: number }>();
    for (const c of registry.forRole(role)) {
      if (!c.combat) continue;
      const p = best.get(c.playerId);
      if (!p || c.ovr > p.ovr) best.set(c.playerId, { id: c.id, ovr: c.ovr });
    }
    const arr = [...best.values()].sort((a, b) => b.ovr - a.ovr || a.id.localeCompare(b.id));
    out[0].push(arr[0].id, arr[1].id);
    out[1].push(arr[2].id, arr[3].id);
  }
  return out;
}

interface TurnRecord {
  turno: number; atacas: boolean; instruccion: string | null; obligado: string | null;
  carta: string; eje: string | null; veredicto: string | null; marcador: string | null; ms: number;
}
interface GameRecord {
  dificultad: string; mazo: string; calidad: string;
  resultado: string; marcador: string; motivo: string;
  segundos: number; msPorTurno: number; turnos: TurnRecord[];
}

async function main() {
  console.log(`# QA de experiencia de juego — Duelos · ${BASE}\n`);
  if (!CHROME) { console.error("No se encontró Chrome."); process.exit(1); }

  const ping = await fetch(`${BASE}/api/game/state`).catch(() => null);
  if (!ping || ping.status !== 401) { console.error(`❌ No hay servidor NEXUS en ${BASE}.`); process.exit(1); }

  const email = `qa-play-${Date.now()}@example.invalid`;
  const password = ephemeralQaPassword();
  const { data: created, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { username: "qaplay" },
  });
  if (error || !created.user) throw new Error(error?.message);
  const userId = created.user.id;

  const PROFILE = mkdtempSync(join(tmpdir(), "duel-qa-"));
  const PORT = 9800 + Math.floor(Math.random() * 150);
  let chrome: ReturnType<typeof spawn> | undefined;

  try {
    // Cartas para DOS mazos distintos, por la RPC real.
    const decks = twoDecks();
    const { error: gErr } = await admin.rpc("app_grant_cards", {
      p_user: userId,
      p_instances: decks.flat().map((cardId) => ({ cardId, serial: null })),
      p_mint_delta: {}, p_origin: "admin",
    });
    if (gErr) throw new Error(gErr.message);

    const pub = createClient(URL_, ANON, { auth: { persistSession: false } });
    const { data: signin } = await pub.auth.signInWithPassword({ email, password });
    const session = signin!.session!;

    chrome = spawn(CHROME, [
      "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
      `--remote-debugging-port=${PORT}`, "--user-data-dir=" + PROFILE, "about:blank",
    ], { stdio: "ignore" });

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

    await send("Page.enable");
    await send("Runtime.enable");
    await send("Network.enable");
    await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

    const consoleErrors: string[] = [];
    let apiCalls = 0;
    root.on("Runtime.consoleAPICalled", (p: any) => {
      if (p.type !== "error" && p.type !== "warning") return;
      const t = (p.args ?? []).map((a: any) => a.value ?? a.description ?? "").join(" ");
      if (t.trim() && !/metadataBase|DevTools|HMR|Fast Refresh|Reduced Motion|favicon/.test(t)) consoleErrors.push(t.slice(0, 160));
    });
    root.on("Runtime.exceptionThrown", (p: any) => consoleErrors.push("excepción: " + (p.exceptionDetails?.exception?.description ?? "?").slice(0, 160)));
    root.on("Network.requestWillBeSent", (p: any) => { if (p.request.url.includes("/api/game/duel")) apiCalls++; });

    const goto = async (path: string, wait = 2200) => {
      const loaded = new Promise<void>((res) => root.on("Page.loadEventFired", () => res()));
      await send("Page.navigate", { url: `${BASE}${path}` });
      await Promise.race([loaded, sleep(9000)]);
      await sleep(wait);
    };
    const js = async (expression: string): Promise<any> => {
      const { result, exceptionDetails } = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (exceptionDetails) throw new Error(exceptionDetails.exception?.description?.slice(0, 200) ?? "error");
      return result.value;
    };

    await goto("/", 500);
    await js(`localStorage.setItem(${JSON.stringify(storageKey)}, ${JSON.stringify(JSON.stringify(session))}); true`);

    // ── Dos mazos ──
    await goto("/duelos/mazos", 2500);
    for (let d = 0; d < 2; d++) {
      const ok = await js(`(async () => {
        const s = ms => new Promise(r => setTimeout(r, ms));
        const B = () => [...document.querySelectorAll('button')];
        B().find(b => /Crear mi primer mazo|\\+ Nuevo mazo/i.test(b.textContent)).click(); await s(900);
        const cards = () => B().filter(b => /OVR \\d+$/.test(b.getAttribute('aria-label') || ''));
        for (let i = 0; i < 20; i++) {
          const c = cards().find(b => b.getAttribute('aria-pressed') === 'false');
          if (!c) break; c.click(); await s(70);
        }
        await s(400);
        const name = document.querySelector('#deck-name');
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(name, 'Mazo QA ${d + 1}');
        name.dispatchEvent(new Event('input', { bubbles: true }));
        await s(300);
        const save = B().find(b => /Guardar mazo/i.test(b.textContent));
        if (!save || save.disabled) return 'guardar bloqueado';
        save.click(); await s(2600);
        return document.body.innerText;
      })()`);
      console.log(`  mazo ${d + 1}: ${/LISTO PARA DUELO/i.test(String(ok)) ? "✓ válido" : "✕ " + String(ok).slice(0, 60)}`);
    }

    // ── Seis partidas ──
    const PLAN: [string, number, string][] = [
      ["Fácil", 0, "buena"], ["Fácil", 1, "descuidada"],
      ["Normal", 0, "buena"], ["Normal", 1, "descuidada"],
      ["Difícil", 0, "buena"], ["Difícil", 1, "descuidada"],
    ];

    const games: GameRecord[] = [];
    for (const [dif, deckIdx, calidad] of PLAN) {
      await goto("/duelos/jugar", 2600);
      const rec: GameRecord = await js(`(async () => {
        const s = ms => new Promise(r => setTimeout(r, ms));
        const B = () => [...document.querySelectorAll('button')];
        const T = () => document.body.innerText;
        const t0 = performance.now();

        // Elegir el mazo (los mazos válidos se listan en orden) y la dificultad.
        const decks = B().filter(b => /Mazo QA/.test(b.textContent));
        if (decks[${deckIdx}]) { decks[${deckIdx}].click(); await s(300); }
        const dif = B().find(b => /^${dif}/i.test(b.textContent.trim()));
        if (dif) { dif.click(); await s(300); }
        const start = B().find(b => /Comenzar duelo/i.test(b.textContent));
        if (!start || start.disabled) return { error: 'no arranca' };
        start.click(); await s(2600);

        const cardBtns = () => B().filter(b => /OVR \\d+$/.test(b.getAttribute('aria-label') || ''));
        const conf = () => B().find(b => /^(Elige una carta|Elige una estadística|Declarar y atacar|Responder)$/.test(b.textContent.trim()));
        const cont = () => B().find(b => b.textContent.trim() === 'Continuar');
        const stats = b => { const n = (b.innerText.match(/SH\\s*(\\d+)\\s*GS\\s*(\\d+)\\s*EF\\s*(\\d+)/) || []).slice(1).map(Number); return n.length === 3 ? { stronghold: n[0], gamesense: n[1], entryfrag: n[2] } : null; };

        const turnos = [];
        for (let i = 0; i < 14; i++) {
          const c0 = cont(); if (c0) { c0.click(); await s(380); }
          if (!conf()) break;
          const tA = performance.now();
          const txt = T();
          const turno = +(txt.match(/TURNO\\s*\\n?\\s*(\\d+) \\/ 10/) || [])[1] || 0;
          const atacas = /ATACAS TÚ/.test(txt);
          const instruccion = (txt.match(/\\n(Elige tu carta|Responde con una carta)\\n/) || [])[1] || null;
          const obligado = (txt.match(/responder con\\s*\\n?\\s*(\\w+)/) || [])[1] || null;
          const forz = { Stronghold: 'stronghold', Gamesense: 'gamesense', Entryfrag: 'entryfrag' }[obligado] || null;

          const lista = cardBtns(); if (!lista.length) break;
          const punt = b => { const st = stats(b); if (!st) return 0; return forz ? st[forz] : Math.max(st.stronghold, st.gamesense, st.entryfrag); };
          const ord = [...lista].sort((a, b) => punt(b) - punt(a));
          const carta = '${calidad}' === 'buena' ? ord[0] : ord[ord.length - 1];
          const nombre = (carta.getAttribute('aria-label') || '').split(',')[0];
          carta.click(); await s(260);

          let eje = null;
          const st3 = B().filter(b => !b.getAttribute('aria-label') && /^(SH|GS|EF)/.test(b.textContent.trim()));
          if (st3.length === 3) {
            const v = b => +(b.innerText.match(/(\\d+)\\s*$/) || [0, 0])[1];
            const so = [...st3].sort((a, b) => v(b) - v(a));
            const pick = '${calidad}' === 'buena' ? so[0] : so[2];
            eje = pick.innerText.trim().replace(/\\s+/g, ' ');
            pick.click(); await s(260);
          }
          const c = conf(); if (!c || c.disabled) { turnos.push({ turno, error: 'confirm bloqueado' }); break; }
          c.click();

          let veredicto = null, marcador = null;
          for (let k = 0; k < 30; k++) {
            await s(150);
            const t = T();
            if (cont()) {
              veredicto = (t.match(/(GANAS EL TURNO|PIERDES EL TURNO|EMPATE)/) || [])[1] || null;
              marcador = (t.match(/(\\d+) – (\\d+)\\s*\\n\\s*CONTINUAR/) || []).slice(1).join('–') || null;
              break;
            }
            if (/VICTORIA|DERROTA/.test(t)) break;
          }
          turnos.push({ turno, atacas, instruccion, obligado, carta: nombre, eje, veredicto, marcador, ms: Math.round(performance.now() - tA) });
        }
        const c = cont(); if (c) { c.click(); await s(1100); }
        const t = T();
        const seg = +((performance.now() - t0) / 1000).toFixed(1);
        return {
          dificultad: '${dif}', mazo: 'Mazo QA ${deckIdx + 1}', calidad: '${calidad}',
          resultado: (t.match(/\\n(VICTORIA|DERROTA|EMPATE)\\n/) || [])[1] || '?',
          marcador: (t.match(/\\n(?:VICTORIA|DERROTA|EMPATE)\\n(\\d+)\\n–\\n(\\d+)/) || []).slice(1).join('–'),
          motivo: (t.match(/\\n([^\\n]*(?:Ganó más|desempate|Empate en|El rival ganó)[^\\n]*)\\n/) || [])[1] || '',
          segundos: seg, msPorTurno: Math.round(turnos.reduce((a, x) => a + (x.ms || 0), 0) / Math.max(1, turnos.length)),
          turnos,
        };
      })()`);
      games.push(rec);
      const r = rec as GameRecord & { error?: string };
      console.log(`  ${String(rec.dificultad).padEnd(8)} ${String(rec.mazo).padEnd(10)} ${String(rec.calidad).padEnd(11)} → ${String(rec.resultado).padEnd(9)} ${rec.marcador ?? ""}  ${rec.segundos ?? "?"}s  (${r.error ?? rec.turnos?.length + " turnos"})`);
    }

    console.log("\n## Ritmo");
    for (const g of games) {
      if (!g.turnos) continue;
      const ms = g.turnos.map((t) => t.ms).filter(Boolean);
      console.log(`  ${g.dificultad.padEnd(8)} turno medio ${g.msPorTurno} ms · más lento ${Math.max(...ms)} ms · partida ${g.segundos}s`);
    }

    console.log("\n## Claridad: ¿el jugador sabe siempre qué hacer?");
    let sinInstruccion = 0, defSinObligado = 0, total = 0;
    for (const g of games) for (const t of g.turnos ?? []) {
      total++;
      if (!t.instruccion) sinInstruccion++;
      if (!t.atacas && !t.obligado) defSinObligado++;
    }
    console.log(`  turnos analizados: ${total}`);
    console.log(`  ${sinInstruccion === 0 ? "✓" : "✕"} todos los turnos muestran una instrucción explícita (${sinInstruccion} sin ella)`);
    console.log(`  ${defSinObligado === 0 ? "✓" : "✕"} defendiendo siempre se dice con qué estadística responder (${defSinObligado} sin ella)`);

    console.log("\n## Dificultad: ¿se nota la diferencia?");
    for (const dif of ["Fácil", "Normal", "Difícil"]) {
      const g = games.filter((x) => x.dificultad === dif && x.turnos);
      const buenas = g.filter((x) => x.calidad === "buena");
      const malas = g.filter((x) => x.calidad === "descuidada");
      console.log(`  ${dif.padEnd(8)} jugando bien: ${buenas.map((x) => `${x.resultado} ${x.marcador}`).join(", ") || "—"} · jugando mal: ${malas.map((x) => `${x.resultado} ${x.marcador}`).join(", ") || "—"}`);
    }

    console.log("\n## Salud");
    console.log(`  ${consoleErrors.length === 0 ? "✓" : "✕"} errores de consola: ${consoleErrors.length}${consoleErrors.length ? " · " + consoleErrors.slice(0, 2).join(" | ") : ""}`);
    const turnosTot = games.reduce((a, g) => a + (g.turnos?.length ?? 0), 0);
    console.log(`  peticiones a la API: ${apiCalls} para ${turnosTot} turnos + 6 partidas (${(apiCalls / Math.max(1, turnosTot)).toFixed(2)} por turno)`);

    console.log("\n## Detalle del primer duelo (lo que ve el jugador turno a turno)");
    for (const t of (games[0].turnos ?? []).slice(0, 10)) {
      console.log(`  T${String(t.turno).padStart(2)} ${t.atacas ? "atacas " : "defiendes"} · ${String(t.instruccion ?? "—").padEnd(24)} · ${t.obligado ? "obligado: " + t.obligado.padEnd(11) : "eje libre".padEnd(21)} · ${String(t.carta).padEnd(10)} ${String(t.eje ?? "").padEnd(26)} → ${String(t.veredicto ?? "?").padEnd(16)} ${t.marcador ?? ""}`);
    }

    root.close();
  } finally {
    if (chrome) chrome.kill();
    try { rmSync(PROFILE, { recursive: true, force: true }); } catch { /* ya no está */ }
    await admin.from("duel_matches").delete().eq("user_id", userId);
    await admin.from("duel_decks").delete().eq("user_id", userId);
    await admin.auth.admin.deleteUser(userId).catch(() => {});
  }
}

main().catch((e: unknown) => {
  console.error("\n❌ Error:", e instanceof Error ? e.message : e);
  process.exit(1);
});
