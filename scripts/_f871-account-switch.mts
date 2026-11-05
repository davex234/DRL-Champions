/**
 * F87.1 · E2E DE CAMBIO DE CUENTA EN PICK'EMS 2.0 (instrumento, fuera de CI). Producción REAL para todo salvo la API de
 * cuadros: Chrome real, login/logout REALES por /cuenta con dos cuentas QA (K = «A», L = «B»), misma app desplegada.
 * La API `/api/game/pickem-brackets` se sirve desde un FIXTURE por token (CDP Fetch en CADA pestaña): un Pick'em QA
 * `qa-f871-switch` que NO existe en la BD → no se publica nada. El fixture es un servidor fiel: picks por `sub` del JWT,
 * revisión con STALE, invalidación con el MISMO dominio (`invalidatedBy`), vista con el MISMO `makeView` del arnés F87.
 *
 *   QA_CREDS_DIR=… QA_SB=https://valorosters.com QA_ANON=… npx tsx scripts/_f871-account-switch.mts   (cwd = prodqa)
 *
 * Recorrido: A elige 3 → F5 → navegación directa → 2.ª pestaña del MISMO perfil ve lo de A y elige otro → la 1.ª con
 * revisión vieja recibe STALE y muestra lo del servidor → logout en la 1.ª: la 2.ª se vacía sola → login B (servidor
 * lento): ninguna pestaña pinta NUNCA un pick de A; almacenamiento sin rastro de A → B elige 1 → logout B, login A:
 * A recupera EXACTAMENTE lo suyo del servidor (sin el de B) → F5. Además, contra el servidor REAL: el borrador real no se
 * ve y la lista pública de cuadros no tiene ninguno publicado.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import snapshot from "../src/domain/pickems/fixtures/vlr-2766-champions-2026.snapshot.json" with { type: "json" };
import { makeView, scene, TEST_ADMIN_EDGES } from "../src/app/design-system/f87/fixtures";
import { contextOfView } from "../src/lib/pickems/bracketClient";
import { invalidatedBy } from "../src/domain/pickems/prediction";
import type { StageRow } from "../src/domain/pickems/format";

/* eslint-disable @typescript-eslint/no-explicit-any */
const BASE = "https://valorosters.com";
const SLUG = "qa-f871-switch";
const SB = process.env.QA_SB!, ANON = process.env.QA_ANON!, DIR = process.env.QA_CREDS_DIR!;
const REAL = ["2f86cbe8", "3befce61", "b7ccff02"];
const OUT = process.env.SWITCH_OUT ?? "C:/NEXUS-CENTRAL/DRLCards/docs/product/qa/pickems-2/f871/account-switch";
mkdirSync(OUT, { recursive: true });
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rows: { id: string; ok: boolean; detail: string }[] = [];
const check = (id: string, ok: boolean, detail: unknown = "") => { const d = typeof detail === "string" ? detail : JSON.stringify(detail); rows.push({ id, ok, detail: d.slice(0, 600) }); console.log(`${ok ? "PASS" : "FAIL"} ${id} ${d.slice(0, 240)}`); };
const credsOf = (p: string) => { const c = JSON.parse(readFileSync(join(DIR, `${p}.json`), "utf8")); if (REAL.some((x) => String(c.userId).startsWith(x))) throw new Error("CUENTA REAL: abortado"); return c as { email: string; password: string; userId: string; username: string }; };
const KA = credsOf("K"), KB = credsOf("L");
const short = (id: string | null) => (id ? id.slice(0, 8) : "anon");

// ── servidor de cuadros FIXTURE (por usuario) ─────────────────────────────────────────────────────────────────────
const P = (snapshot.stages as StageRow[]).find((s) => s.kind === "playoff")!;
const MATCHES = scene("playoffs")!.view.matches; // partidos reales de los playoffs con horas desplazadas al futuro
const store = new Map<string, { revision: number; picks: Record<string, string> }>();
const log: { tab: string; method: string; who: string; action?: string; status: number }[] = [];
let slowGetMs = 0;
const viewFor = (uid: string | null) => {
  const st = uid ? store.get(uid) ?? { revision: 0, picks: {} } : null;
  const v = makeView({ title: "QA F87.1 · cambio de cuenta (fixture, no publicado)", slug: SLUG, stages: [P], matches: MATCHES, adminEdges: TEST_ADMIN_EDGES, picks: st?.picks ?? {}, signedIn: !!uid }).view;
  if (v.me && st) v.me.revision = st.revision;
  return v;
};
const subOf = (auth: string | undefined): string | null => {
  const t = /^Bearer (.+)$/.exec(auth ?? "")?.[1]; if (!t) return null;
  try { return JSON.parse(Buffer.from(t.split(".")[1], "base64url").toString()).sub ?? null; } catch { return null; }
};
function serve(method: string, uid: string | null, body: any): { status: number; json: unknown } {
  if (method === "GET") return { status: 200, json: viewFor(uid) };
  if (!uid) return { status: 401, json: { error: "Inicia sesión", code: "AUTH" } };
  if (body?.action !== "pick" || body?.slug !== SLUG) return { status: 400, json: { error: "Petición no válida" } };
  const st = store.get(uid) ?? { revision: 0, picks: {} };
  if (body.revision !== st.revision) return { status: 409, json: { error: "Revisión vieja", code: "STALE", state: st } };
  const v = viewFor(uid);
  const locked = new Set(v.nodes.filter((n) => n.locked).map((n) => n.matchId));
  const r = invalidatedBy(contextOfView(v), st.picks, body.matchId, body.teamId ?? null, (id) => !locked.has(id));
  const next = { revision: st.revision + 1, picks: r.next };
  store.set(uid, next);
  return { status: 200, json: { ...next, cleared: r.cleared } };
}

// ── CDP mínimo con varias pestañas del MISMO perfil ──────────────────────────────────────────────────────────────
const port = 9600 + Math.floor(Math.random() * 150);
const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--mute-audio", `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "f871-switch-"))}`, "about:blank"], { stdio: "ignore" });
let ws: WebSocket | null = null;
for (let i = 0; i < 80 && !ws; i++) { try { const j = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); ws = new WebSocket(j.webSocketDebuggerUrl); } catch { await sleep(250); } }
if (!ws) throw new Error("Chrome sin puerto de depuración");
await new Promise((r) => ws!.addEventListener("open", r));
let seq = 0;
const pending = new Map<number, (m: any) => void>();
const handlers: ((m: any) => void)[] = [];
ws.addEventListener("message", (ev) => { const m = JSON.parse(String(ev.data)); if (m.id && pending.has(m.id)) { pending.get(m.id)!(m); pending.delete(m.id); } else handlers.forEach((h) => h(m)); });
const send = (method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<any> => new Promise((res, rej) => { const id = ++seq; pending.set(id, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result))); ws!.send(JSON.stringify({ id, method, params, sessionId })); });

const SAMPLER = `(() => { const S = { maxPressed: 0, firstUid: null, seen: [] }; window.__sw = S;
  const uid = () => { for (const k of Object.keys(localStorage)) if (/^sb-.+-auth-token$/.test(k)) { try { return JSON.parse(localStorage.getItem(k)).user.id } catch {} } return null; };
  const snap = () => { const n = document.querySelectorAll('[data-bracket-mode] [aria-pressed="true"]').length; const u = uid(); S.maxPressed = Math.max(S.maxPressed, n);
    const k = (u || 'anon').slice(0, 8) + ':' + n; if (S.seen[S.seen.length - 1] !== k) S.seen.push(k); };
  new MutationObserver(snap).observe(document, { subtree: true, childList: true, attributes: true }); setInterval(snap, 50); })()`;

interface Tab { name: string; sid: string; js: <T = any>(e: string) => Promise<T>; goto: (p: string, settle?: number) => Promise<void>; reload: (settle?: number) => Promise<void> }
async function newTab(name: string): Promise<Tab> {
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId: sid } = await send("Target.attachToTarget", { targetId, flatten: true });
  await send("Page.enable", {}, sid); await send("Runtime.enable", {}, sid);
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sid);
  await send("Page.addScriptToEvaluateOnNewDocument", { source: SAMPLER }, sid);
  await send("Fetch.enable", { patterns: [{ urlPattern: "*/api/game/pickem-brackets*", requestStage: "Request" }] }, sid);
  const js = async <T,>(expression: string): Promise<T> => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sid)).result?.value as T;
  return {
    name, sid, js,
    goto: async (p, settle = 3500) => { await send("Page.navigate", { url: `${BASE}${p}` }, sid); await sleep(settle); },
    reload: async (settle = 3500) => { await send("Page.reload", { ignoreCache: true }, sid); await sleep(settle); },
  };
}
const tabs = new Map<string, string>();
handlers.push(async (m) => {
  if (m.method !== "Fetch.requestPaused") return;
  const p = m.params; const sid = m.sessionId as string;
  const uid = subOf(p.request.headers?.authorization ?? p.request.headers?.Authorization);
  const body = p.request.postData ? JSON.parse(p.request.postData) : null;
  if (p.request.method === "GET" && slowGetMs) await sleep(slowGetMs);
  const r = serve(p.request.method, uid, body);
  log.push({ tab: tabs.get(sid) ?? "?", method: p.request.method, who: short(uid), action: body?.action, status: r.status });
  await send("Fetch.fulfillRequest", { requestId: p.requestId, responseCode: r.status, responseHeaders: [{ name: "content-type", value: "application/json" }, { name: "cache-control", value: "private, no-store" }], body: Buffer.from(JSON.stringify(r.json)).toString("base64") }, sid).catch(() => null);
});

const setVal = (sel: string, v: string) => `(() => { const el = document.querySelector(${JSON.stringify(sel)}); const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, ${JSON.stringify(v)}); el.dispatchEvent(new Event('input', { bubbles: true })); })()`;
async function waitFor(t: Tab, expr: string, ms = 20000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await t.js<boolean>(expr).catch(() => false)) return true; await sleep(200); } return false; }
async function loginUi(t: Tab, c: { email: string; password: string }) {
  await t.goto("/cuenta", 3000);
  if (!(await t.js<boolean>(`!!document.querySelector('input[type="password"]')`))) return false;
  await t.js(setVal('input[type="email"]', c.email)); await t.js(setVal('input[type="password"]', c.password));
  await t.js(`document.querySelector('form button[type="submit"]').click()`);
  const ok = await waitFor(t, `!document.querySelector('input[type="password"]')`, 25000); await sleep(1500); return ok;
}
async function logoutUi(t: Tab) {
  await t.goto("/cuenta", 3000);
  const ok = await t.js<boolean>(`(() => { const b = [...document.querySelectorAll('button')].find(b => /^(Cerrar sesi[oó]n|Salir)$/i.test(b.innerText.trim())); if (!b) return false; b.click(); return true; })()`);
  await sleep(2500); return ok && await waitFor(t, `!!document.querySelector('input[type="password"]') || /Entrar|Iniciar sesi/i.test(document.body.innerText)`, 15000);
}
const pressed = (t: Tab) => t.js<string[]>(`[...document.querySelectorAll('[data-bracket-mode] [aria-pressed="true"]')].map(b => b.getAttribute('aria-label'))`);
const sessionUid = (t: Tab) => t.js<string | null>(`(() => { for (const k of Object.keys(localStorage)) if (/^sb-.+-auth-token$/.test(k)) { try { return JSON.parse(localStorage.getItem(k)).user.id } catch {} } return null })()`);
const sampler = (t: Tab) => t.js<{ maxPressed: number; seen: string[] }>(`({ maxPressed: window.__sw?.maxPressed ?? -1, seen: window.__sw?.seen ?? [] })`);
async function pickNth(t: Tab, n: number, side = 0) {
  // Un partido = ronda + pareja (dos botones). Se elige el n-ésimo partido SIN pick (nunca el rival del ya elegido).
  const label = await t.js<string | null>(`(() => {
    const key = (l) => { const m = /^(?:Elegir|Quitar) (.+) como ganador de (.+) frente a (.+)$/.exec(l || ''); return m ? m[2] + '|' + [m[1], m[3]].sort().join('/') : null; };
    const all = [...document.querySelectorAll('[data-bracket-mode] button[aria-label]')];
    const taken = new Set(all.filter(b => b.getAttribute('aria-pressed') === 'true').map(b => key(b.getAttribute('aria-label'))));
    const seen = new Set(); const free = [];
    const pairs = new Map(); for (const b of all) { const l = b.getAttribute('aria-label'); if (!/^Elegir /.test(l) || b.disabled) continue; const k = key(l); if (!k || taken.has(k)) continue; if (!pairs.has(k)) pairs.set(k, []); pairs.get(k).push(b); }
    for (const bs of pairs.values()) { if (!seen.has(bs)) { seen.add(bs); free.push(bs[${side}] ?? bs[0]); } }
    const b = free[${n}]; if (!b) return null; b.click(); return b.getAttribute('aria-label'); })()`);
  await waitFor(t, `/Guardado|cambiaron en otra pestaña/.test(document.body.innerText)`, 10000); await sleep(600);
  return label;
}
const bracketReady = (t: Tab) => waitFor(t, `!!document.querySelector('[data-bracket-mode]')`, 25000);
const storageHas = (t: Tab, needle: string) => t.js<boolean>(`(() => { const all = []; for (const s of [localStorage, sessionStorage]) for (const k of Object.keys(s)) all.push(k + '=' + s.getItem(k)); return all.join('\\n').includes(${JSON.stringify(needle)}); })()`);

try {
  const t1 = await newTab("t1"); tabs.set(t1.sid, "t1");
  // 0 · servidor REAL (sin fixture): nada publicado y el borrador real invisible.
  const list = await (await fetch(`${BASE}/api/game/pickem-brackets`)).json() as { brackets?: unknown[] };
  check("REAL · lista pública de cuadros: 0 publicados", Array.isArray(list.brackets) && list.brackets.length === 0, list);
  const draft = await fetch(`${BASE}/api/game/pickem-brackets?slug=champions-2026-playoffs`);
  check("REAL · el borrador de Champions no se ve (404)", draft.status === 404, draft.status);
  const qa = await fetch(`${BASE}/api/game/pickem-brackets?slug=${SLUG}`);
  check("REAL · el Pick'em QA del fixture NO existe en producción (404)", qa.status === 404, qa.status);

  // 1 · A elige 3
  check("A · login REAL por /cuenta", await loginUi(t1, KA));
  check("A · la sesión es la de A", (await sessionUid(t1)) === KA.userId, short(await sessionUid(t1)));
  await t1.goto(`/pickems/cuadro/${SLUG}`, 3000);
  check("A · cuadro cargado (fixture)", await bracketReady(t1));
  const a1 = [await pickNth(t1, 0), await pickNth(t1, 0), await pickNth(t1, 0)];
  const sa = store.get(KA.userId);
  check("A · 3 picks guardados en el servidor (revisión 3)", sa?.revision === 3 && Object.keys(sa.picks).length === 3, { rev: sa?.revision, n: Object.keys(sa?.picks ?? {}).length, labels: a1 });
  check("A · la pantalla muestra exactamente sus 3", (await pressed(t1)).length === 3, await pressed(t1));
  // 2 · F5 y navegación directa
  await t1.reload(4000); await bracketReady(t1);
  check("A · F5: recupera sus 3 del servidor", (await pressed(t1)).length === 3);
  await t1.goto("/pickems", 2500); await t1.goto(`/pickems/cuadro/${SLUG}`, 3500); await bracketReady(t1);
  check("A · navegación directa por URL: sus 3", (await pressed(t1)).length === 3);
  // 3 · segunda pestaña del MISMO perfil
  const t2 = await newTab("t2"); tabs.set(t2.sid, "t2");
  await t2.goto(`/pickems/cuadro/${SLUG}`, 4000); await bracketReady(t2);
  check("A · 2.ª pestaña (mismo perfil, misma sesión) ve sus 3", (await pressed(t2)).length === 3 && (await sessionUid(t2)) === KA.userId);
  await pickNth(t2, 0);
  check("A · 2.ª pestaña guarda un 4.º (revisión 4)", store.get(KA.userId)?.revision === 4);
  await pickNth(t1, 0); // la 1.ª pestaña sigue en la revisión 3 → STALE
  const stale = log.filter((l) => l.tab === "t1" && l.status === 409).length;
  check("A · 1.ª pestaña con revisión vieja → STALE y muestra lo del servidor", stale === 1 && (await t1.js<boolean>(`/cambiaron en otra pestaña/.test(document.body.innerText)`)) && (await pressed(t1)).length === 4, { stale, shown: (await pressed(t1)).length });
  const aPicks = { ...store.get(KA.userId)!.picks };
  // 4 · logout en la 1.ª: la 2.ª se vacía sola
  check("A · logout REAL en la 1.ª pestaña", await logoutUi(t1));
  const t2Cleared = await waitFor(t2, `document.querySelectorAll('[data-bracket-mode] [aria-pressed="true"]').length === 0`, 15000);
  check("logout cruzado · la 2.ª pestaña (sin recargar) deja de mostrar los picks de A", t2Cleared, await pressed(t2));
  check("logout · ningún token de A queda en el almacenamiento", !(await storageHas(t1, KA.userId)));
  // 5 · B entra con el servidor LENTO
  slowGetMs = 2500;
  await t1.js(`(window.__sw && (window.__sw.maxPressed = 0, window.__sw.seen = []), true)`);
  check("B · login REAL en la 1.ª pestaña", await loginUi(t1, KB));
  check("B · la sesión es la de B", (await sessionUid(t1)) === KB.userId, short(await sessionUid(t1)));
  await t1.goto(`/pickems/cuadro/${SLUG}`, 1200);
  const midLoad = await sampler(t1);
  await bracketReady(t1); await sleep(3000);
  const s1 = await sampler(t1);
  check("B · durante la carga lenta y después: NUNCA un pick pintado (0 desde la navegación)", s1.maxPressed === 0 && (await pressed(t1)).length === 0, { midLoad, s1 });
  await t2.reload(5000); await bracketReady(t2);
  const s2 = await sampler(t2);
  check("B · la 2.ª pestaña (ya con la sesión de B) tampoco pinta nada de A", s2.maxPressed === 0 && (await sessionUid(t2)) === KB.userId, s2);
  const afterB = log.slice(log.findIndex((l) => l.who === short(KB.userId)));
  check("B · todas las peticiones con la sesión de B llevan SU token (ninguna de A)", afterB.length > 0 && afterB.every((l) => l.who === short(KB.userId) || l.who === "anon"), afterB.map((l) => `${l.tab}:${l.method}:${l.who}`).join(" "));
  check("B · almacenamiento sin rastro de A (ni id ni sesión)", !(await storageHas(t1, KA.userId)));
  slowGetMs = 0;
  // B elige el equipo CONTRARIO al de A en el primer cuarto (la contaminación más visible posible).
  const bLabel = await pickNth(t1, 0, 1);
  check("B · elige 1 → guardado en SU estado (A intacta)", store.get(KB.userId)?.revision === 1 && JSON.stringify(store.get(KA.userId)!.picks) === JSON.stringify(aPicks), { b: bLabel });
  const bPick = Object.entries(store.get(KB.userId)!.picks)[0];
  // 6 · B sale, A vuelve
  check("B · logout REAL", await logoutUi(t1));
  await t1.js(`(window.__sw && (window.__sw.maxPressed = 0, window.__sw.seen = []), true)`);
  check("A · login de nuevo", await loginUi(t1, KA));
  await t1.goto(`/pickems/cuadro/${SLUG}`, 3500); await bracketReady(t1); await sleep(1500);
  const back = await pressed(t1);
  const s3 = await sampler(t1);
  check("A · recupera EXACTAMENTE sus 4 del servidor", back.length === Object.keys(aPicks).length && s3.maxPressed === Object.keys(aPicks).length, { shown: back.length, server: Object.keys(aPicks).length, s3 });
  check("A · el pick de B (rival contrario en el mismo cuarto) no aparece en la vista de A", !!bPick && aPicks[bPick[0]] !== bPick[1] && !back.includes(String(bLabel).replace(/^Elegir/, "Quitar")), { bLabel, aShown: back });
  await t1.reload(4000); await bracketReady(t1);
  check("A · F5 final: sus 4", (await pressed(t1)).length === Object.keys(aPicks).length);
  await send("Page.captureScreenshot", { format: "png" }, t1.sid).then((r) => writeFileSync(`${OUT}/a-back-1440.png`, Buffer.from(r.data, "base64"))).catch(() => null);
} finally {
  writeFileSync(`${OUT}/account-switch.json`, JSON.stringify({ at: new Date().toISOString(), base: BASE, fixtureSlug: SLUG, a: short(KA.userId), b: short(KB.userId), total: rows.length, pass: rows.filter((r) => r.ok).length, rows, requests: log }, null, 1));
  console.log(`\nF87.1 ACCOUNT SWITCH: ${rows.filter((r) => r.ok).length}/${rows.length}`);
  ws.close(); proc.kill();
}
