/**
 * F79.1 · QA DE NAVEGADOR de /admin/crafting → «Forge 2.0» contra el build de producción LOCAL — fuera de CI.
 *
 * Sin BD viva: sesión simulada (patrón F51/F79) y `/api/admin/*` interceptado por CDP y atendido por los HANDLERS
 * REALES (`forgeCmsHandlers`, `craftingCmsHandlers`: runAdmin + lista blanca + validación + versión + auditoría) sobre
 * MemSupabase. `/api/admin/session` responde como la ruta real (`verifyAdmin` → 200 admin / 401). Nada se escribe en
 * ninguna BD real y no se publica contenido.
 *
 *   npx tsx scripts/_f79-1-admin-qa.ts [base=http://127.0.0.1:3011] [anchuras=1440,1024,390]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep, type Tab } from "./lib/cdp";
import { MemSupabase } from "../src/server/services/testing/memSupabase";
import { craftingCmsHandlers, forgeCmsHandlers } from "../src/server/cms/handlers";
import { resetF73Cache } from "../src/server/services/f73Config";
import { resetForgeConfigCache } from "../src/server/services/forgeConfig";
import { DEFAULT_FORGE_CONFIG } from "../src/domain/forge/defaults";
import type { AdminDeps } from "../src/server/admin/http";

const BASE = process.argv[2] ?? "http://127.0.0.1:3011";
const WIDTHS = (process.argv[3] ?? "1440,1024,390").split(",").map(Number);
const OUT = join(process.cwd(), "docs/product/qa/f79-1/admin");
mkdirSync(OUT, { recursive: true });
const ADMIN = "f7910000-0000-4000-8000-0000000ad001";
const USER = "f7910000-0000-4000-8000-0000000ad002";
const PLAYER = "f7910000-0000-4000-8000-0000000ad003";
const results: { id: string; ok: boolean; detail: string }[] = [];
const check = (id: string, ok: boolean, detail = "") => { results.push({ id, ok, detail: String(detail).slice(0, 400) }); console.log(`${ok ? "PASS" : "FAIL"} ${id} ${String(detail).slice(0, 160)}`); return ok; };
const J = JSON.stringify;

function world() {
  resetF73Cache(); resetForgeConfigCache();
  const db = new MemSupabase();
  db.table("profiles").push({ id: ADMIN, username: "qa-admin", credits: 0, xp: 0, level: 1, points: 0, is_admin: true });
  db.table("profiles").push({ id: USER, username: "qa-user", credits: 0, xp: 0, level: 1, points: 0, is_admin: false });
  db.table("profiles").push({ id: PLAYER, username: "qa-player", credits: 0, xp: 0, level: 1, points: 0, is_admin: false });
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/0059_crafting_missions.sql"), "utf8");
  const v = (s: string) => (s === "null" ? null : s.slice(1, -1));
  for (const m of sql.matchAll(/\('([a-z0-9-]+)',\s*'(PACK|CARD)',\s*'([^']+)',\s*(null|'[a-z]+'),\s*(null|'[a-z]+'),\s*(null|'[a-z]+'),\s*(null|'[a-z]+'),\s*(\d+),\s*'(ACTIVE|DISABLED)',\s*(\d+)\)/g)) {
    db.table("craft_recipes").push({ id: m[1], kind: m[2], name: m[3], input_pack_id: v(m[4]), output_pack_id: v(m[5]), input_class: v(m[6]), output_class: v(m[7]), input_qty: Number(m[8]), status: m[9], sort_order: Number(m[10]), available_from: null, available_to: null, version: 1 });
  }
  // El documento vigente (versión 1, todo DRAFT) y un jugador con historial real: 5 crafteos de sobres = nivel 2.
  db.table("forge_config").push({ id: "main", doc: DEFAULT_FORGE_CONFIG, version: 1, updated_at: new Date().toISOString() });
  for (let i = 0; i < 5; i++) db.table("economy_ops").push({ ref: `craft:pack:${PLAYER}:qa-${i}`, user_id: PLAYER, kind: "craft_pack", result: { recipeId: "pack-estandar-premium", kind: "PACK", inputs: [], outputs: [] }, created_at: new Date(Date.now() - (i + 1) * 3_600_000).toISOString() });
  return db;
}

const tokenSub = (h: string | null) => { try { return JSON.parse(Buffer.from(String(h ?? "").replace(/^Bearer /, "").split(".")[1], "base64url").toString()).sub as string; } catch { return null; } };
const boot = (sub: string) => `(() => {
  const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\\+/g, "-").replace(/\\//g, "_");
  const exp = 4102444800;
  const user = { id: ${J(sub)}, aud: "authenticated", role: "authenticated", email: "qa-f791@example.invalid", app_metadata: {}, user_metadata: {} };
  const jwt = b64({ alg: "none", typ: "JWT" }) + "." + b64({ sub: user.id, exp, role: "authenticated", email: user.email }) + ".qa";
  const s = JSON.stringify({ access_token: jwt, token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: "qa-f791", user });
  for (const k of ["sb-127-auth-token", "sb-localhost-auth-token", "sb-valorosters-auth-token"]) { try { localStorage.setItem(k, s); } catch {} }
})();`;

async function intercept(t: Tab, db: MemSupabase, log: { saves: number; impacts: number; responses: string[] }) {
  const deps: AdminDeps = { verify: async (req) => { const sub = tokenSub(req.headers.get("authorization")); return sub && db.table("profiles").some((p) => p.id === sub && p.is_admin) ? { userId: sub } : null; }, db: () => db.client };
  const forge = forgeCmsHandlers(deps), crafting = craftingCmsHandlers(deps);
  await t.send("Fetch.enable", { patterns: [{ urlPattern: "*/api/admin/*", requestStage: "Request" }, { urlPattern: "*/api/game/*", requestStage: "Request" }, { urlPattern: "*/api/telemetry*", requestStage: "Request" }] });
  t.on("Fetch.requestPaused", async (p: { requestId: string; request: { url: string; method: string; postData?: string; headers: Record<string, string> } }) => {
    const u = new URL(p.request.url);
    const auth = p.request.headers.Authorization ?? p.request.headers.authorization ?? null;
    const req = new Request(u.toString(), { method: p.request.method, headers: { ...(auth ? { authorization: auth } : {}), "content-type": "application/json" }, ...(p.request.postData ? { body: p.request.postData } : {}) });
    let res: Response;
    try {
      if (u.pathname === "/api/admin/session") { const ok = await deps.verify(req); res = Response.json(ok ? { admin: true, userId: ok.userId } : { admin: false }, { status: ok ? 200 : 401 }); }
      else if (u.pathname === "/api/admin/cms/forge") {
        if (p.request.method === "POST") { const a = JSON.parse(p.request.postData ?? "{}").action; if (a === "save") log.saves++; if (a === "impact") log.impacts++; }
        res = await (p.request.method === "GET" ? forge.GET(req) : forge.POST(req));
      }
      else if (u.pathname === "/api/admin/cms/crafting") res = await (p.request.method === "GET" ? crafting.GET(req) : crafting.POST(req));
      else if (u.pathname === "/api/admin/system") res = (await deps.verify(req)) ? Response.json({ overall: "HEALTHY", environment: "qa", version: "f79.1-qa" }) : Response.json({ error: "No autorizado" }, { status: 401 });
      else if (u.pathname.startsWith("/api/telemetry")) res = new Response(null, { status: 204 });
      // Como la ruta real (F69): el perfil PROPIO del token (incluye is_admin), nunca otro.
      else if (u.pathname === "/api/game/me") { const sub = tokenSub(auth); const prof = db.table("profiles").find((x) => x.id === sub); res = prof ? Response.json({ profile: prof }) : Response.json({ error: "No autenticado" }, { status: 401 }); }
      else res = Response.json({ error: "No autenticado" }, { status: 401 });
    } catch (e) { res = Response.json({ error: String(e) }, { status: 500 }); }
    const raw = res.status === 204 ? "" : await res.text();
    if (u.pathname.startsWith("/api/admin/cms/forge")) log.responses.push(`${p.request.method} ${res.status} ${raw.slice(0, 200)}`);
    await t.send("Fetch.fulfillRequest", { requestId: p.requestId, responseCode: res.status, responseHeaders: [{ name: "content-type", value: "application/json" }, { name: "cache-control", value: "no-store" }], ...(raw ? { body: Buffer.from(raw).toString("base64") } : {}) }).catch(() => undefined);
  });
}

const has = (tid: string) => `!!document.querySelector('[data-testid="${tid}"]')`;
async function waitFor(t: Tab, expr: string, ms = 15000) { for (let i = 0; i < ms / 200; i++) { if (await t.js<boolean>(expr).catch(() => false)) return true; await sleep(200); } return false; }
const noOverflow = `document.scrollingElement.scrollWidth <= innerWidth + 1`;
const setValue = (sel: string, value: string) => `(() => { const el = document.querySelector(${J(sel)}); if (!el) return false; const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ${J(value)}); el.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`;
const clickText = (text: string) => `(() => { const b = [...document.querySelectorAll('button')].find(e => e.textContent.trim().toUpperCase().startsWith(${J(text.toUpperCase())})); if (!b || b.disabled) return false; b.scrollIntoView({ block: "center" }); b.click(); return true; })()`;
const clickTid = (tid: string) => `(() => { const b = document.querySelector('[data-testid="${tid}"]'); if (!b || b.disabled) return false; b.scrollIntoView({ block: "center" }); b.click(); return true; })()`;
const TEXTAREA = 'textarea[aria-label="Configuración de la Forja (JSON)"]';
const SECRETS = /service_role|SUPABASE_SERVICE|eyJ[A-Za-z0-9_-]{20,}|sb_secret|re_[A-Za-z0-9]{10}|password/i;

async function runAdmin(width: number) {
  const db = world();
  const log = { saves: 0, impacts: 0, responses: [] as string[] };
  const browser = await launch({ width, height: width < 600 ? 844 : width <= 1024 ? 768 : 900, args: ["--in-process-gpu", "--mute-audio", "--hide-scrollbars"] });
  const t = browser.tab;
  const shot = (name: string) => t.shot(join(OUT, `${name}-${width}.png`)).catch(() => undefined);
  const doc = () => db.table("forge_config")[0] as { version: number; doc: typeof DEFAULT_FORGE_CONFIG };
  try {
    await t.setMedia([{ name: "prefers-reduced-motion", value: width <= 390 ? "reduce" : "no-preference" }]);
    await t.send("Page.addScriptToEvaluateOnNewDocument", { source: boot(ADMIN) });
    await intercept(t, db, log);
    await t.goto(`${BASE}/admin/crafting`, 2500);
    check(`[${width}] ADMIN · el panel de crafteo carga (servidor confirma admin)`, await waitFor(t, `[...document.querySelectorAll('[role=tab]')].some(e => /forge/i.test(e.textContent))`, 20000));
    await t.js(`[...document.querySelectorAll('[role=tab]')].find(e => /forge/i.test(e.textContent)).click()`);
    check(`[${width}] CARGA · la configuración existente (versión 1) aparece`, await waitFor(t, `${has("admin-forge")} && /Versión 1/i.test(document.body.innerText) && document.querySelector(${J(TEXTAREA)})?.value.includes('"recipes"')`));
    const drafts = await t.js<{ draft: number; active: number }>(`(() => { const pills = [...document.querySelectorAll('[data-testid="admin-forge"] li span')].map(e => e.textContent.trim()); return { draft: pills.filter(x => x === "DRAFT").length, active: pills.filter(x => x === "ACTIVE").length }; })()`);
    check(`[${width}] ESTADO · todo el contenido nuevo se ve en DRAFT (nada ACTIVO) y el pity desactivado`, drafts.draft >= 14 && drafts.active === 0 && /Pity desactivado/i.test(await t.js<string>(`document.body.innerText`)), J(drafts));
    check(`[${width}] POLÍTICA · el panel explica qué cambios bajarían la progresión`, await t.js<boolean>(has("admin-forge-policy")));
    check(`[${width}] SIN scroll horizontal`, await t.js<boolean>(noOverflow));
    await shot("01-loaded");

    // JSON inválido: no se puede ni revisar ni guardar; nada llega al servidor.
    await t.js(setValue(TEXTAREA, '{ "recipes": [ nope'));
    await sleep(300);
    const bad = await t.js<{ alert: boolean; disabled: boolean }>(`({ alert: [...document.querySelectorAll('[role=alert]')].some(e => /JSON|Unexpected|token|position/i.test(e.textContent)), disabled: document.querySelector('[data-testid="admin-forge-save"]')?.disabled === true })`);
    check(`[${width}] JSON INVÁLIDO · aviso legible y GUARDAR desactivado`, bad.alert && bad.disabled, J(bad));
    await t.js(setValue(TEXTAREA, "[1,2,3]"));
    await sleep(300);
    check(`[${width}] JSON que no es un objeto · también bloqueado`, await t.js<boolean>(`document.querySelector('[data-testid="admin-forge-save"]')?.disabled === true && /objeto JSON/i.test(document.body.innerText)`));
    check(`[${width}] JSON inválido · el servidor no recibió nada y el documento sigue en la versión 1`, log.saves === 0 && log.impacts === 0 && doc().version === 1, J({ saves: log.saves, v: doc().version }));
    await shot("02-invalid-json");

    // Documento con problemas de validación: el servidor los explica; no se guarda.
    await t.js(setValue(TEXTAREA, J({ ...DEFAULT_FORGE_CONFIG, curve: { base: 100, growth: 9, maxLevel: 40 } }, null, 2)));
    await sleep(200);
    await t.js(clickTid("admin-forge-save"));
    check(`[${width}] VALIDACIÓN · errores comprensibles (ruta + motivo), sin guardar`, await waitFor(t, `${has("admin-forge-problems")} && /curve\\.growth/.test(document.querySelector('[data-testid="admin-forge-problems"]').innerText)`, 8000) && doc().version === 1 && log.saves === 0, log.responses.at(-1));
    await shot("03-validation");

    // Cambio REGRESIVO: el servidor lo para, el panel enseña el impacto REAL y exige acción explícita.
    await t.js(setValue(TEXTAREA, J({ ...DEFAULT_FORGE_CONFIG, curve: { ...DEFAULT_FORGE_CONFIG.curve, base: 500 } }, null, 2)));
    await sleep(200);
    await t.js(clickTid("admin-forge-save"));
    check(`[${width}] REGRESIVO · aviso de que BAJARÍA la progresión, con el impacto real (1 de 1 jugador)`, await waitFor(t, `${has("admin-forge-regression")} && /1<\\/b> de 1 jugadores|\\b1 de 1 jugadores/.test(document.querySelector('[data-testid="admin-forge-impact"]').innerHTML.replace(/<b>/g,""))`, 8000), await t.js<string>(`document.querySelector('[data-testid="admin-forge-impact"]')?.innerText ?? ""`));
    check(`[${width}] REGRESIVO · RECALCULAR desactivado sin la palabra y el motivo; nada guardado`, await t.js<boolean>(`document.querySelector('[data-testid="admin-forge-recalc"]')?.disabled === true`) && doc().version === 1 && log.saves === 0);
    await shot("04-regression");
    await t.js(setValue('[data-testid="admin-forge-confirm-word"]', "RECALCULAR"));
    await sleep(150);
    check(`[${width}] REGRESIVO · con la palabra pero SIN motivo, sigue desactivado`, await t.js<boolean>(`document.querySelector('[data-testid="admin-forge-recalc"]')?.disabled === true`));
    await t.js(setValue("#forge-reason", "QA F79.1 · rebalanceo de prueba"));
    await sleep(150);
    await t.js(clickTid("admin-forge-recalc"));
    check(`[${width}] REGRESIVO · confirmado: guardado (versión 2) y AUDITADO como recálculo con su impacto`, await waitFor(t, `/Guardado · versión 2/.test(document.body.innerText)`, 8000) && doc().version === 2 && db.table("content_audit_log").some((a) => a.action === "f79_forge_progression_recalc"), J(db.table("content_audit_log").map((a) => a.action)));
    await shot("05-recalc-saved");

    // Cambio MONÓTONO: se guarda directamente, sin pasos extra.
    await waitFor(t, `document.querySelector(${J(TEXTAREA)})?.value.includes('"base": 500')`, 8000);
    await t.js(setValue(TEXTAREA, J({ ...doc().doc, xp: { ...doc().doc.xp, craftPack: 30 } }, null, 2)));
    await sleep(200);
    await t.js(clickTid("admin-forge-save"));
    check(`[${width}] MONÓTONO · más XP se guarda sin confirmación extra (versión 3)`, await waitFor(t, `/Guardado · versión 3/.test(document.body.innerText)`, 8000) && doc().version === 3 && !(await t.js<boolean>(has("admin-forge-regression"))));
    check(`[${width}] NADA PUBLICADO · después de todo, ninguna receta/cadena/objetivo/logro ACTIVO`, ["recipes", "chains", "blueprints", "objectives", "achievements"].every((k) => ((doc().doc as unknown as Record<string, { status: string }[]>)[k]).every((x) => x.status !== "ACTIVE")) && !db.table("craft_recipes").some((r) => String(r.id).startsWith("forge-") && r.status === "ACTIVE"));
    const html = await t.js<string>(`document.documentElement.outerHTML`);
    check(`[${width}] SECRETOS · ni claves ni tokens ni contraseñas en la página`, !SECRETS.test(html.replace(/qa-f791@example\.invalid/g, "")), (html.match(SECRETS) ?? [""])[0]);
    check(`[${width}] SIN scroll horizontal (tras guardar)`, await t.js<boolean>(noOverflow));
    // Teclado: el textarea, el motivo y el botón son alcanzables con Tab y tienen foco visible.
    await t.js(`document.querySelector(${J(TEXTAREA)}).focus()`);
    for (let i = 0; i < 3; i++) await t.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 }).then(() => t.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 }));
    check(`[${width}] TECLADO · Tab recorre motivo → acciones del documento`, await t.js<boolean>(`!!document.activeElement && ["INPUT","BUTTON"].includes(document.activeElement.tagName)`), await t.js<string>(`document.activeElement?.outerHTML.slice(0, 80) ?? ""`));
  } finally { await browser.close(); }
}

async function runNonAdmin(width: number) {
  const db = world();
  const log = { saves: 0, impacts: 0, responses: [] as string[] };
  const browser = await launch({ width, height: width < 600 ? 844 : 900, args: ["--in-process-gpu", "--mute-audio", "--hide-scrollbars"] });
  const t = browser.tab;
  try {
    await t.send("Page.addScriptToEvaluateOnNewDocument", { source: boot(USER) });
    await intercept(t, db, log);
    await t.goto(`${BASE}/admin/crafting`, 2500);
    check(`[${width}] NO ADMIN · «Acceso restringido» y ningún panel`, await waitFor(t, `/Acceso restringido/i.test(document.body.innerText)`, 15000) && !(await t.js<boolean>(has("admin-forge"))));
    const direct = await t.js<{ g: number; p: number; body: string }>(`(async () => {
      const tok = JSON.parse(localStorage.getItem("sb-127-auth-token")).access_token;
      const g = await fetch("/api/admin/cms/forge", { headers: { authorization: "Bearer " + tok } });
      const p = await fetch("/api/admin/cms/forge", { method: "POST", headers: { authorization: "Bearer " + tok, "content-type": "application/json" }, body: JSON.stringify({ action: "save", doc: {}, expectedVersion: 1 }) });
      return { g: g.status, p: p.status, body: await g.text() };
    })()`);
    check(`[${width}] NO ADMIN · la API devuelve 401 idéntico a anónimo (sin oráculo) y no escribe`, direct.g === 401 && direct.p === 401 && /No autorizado/.test(direct.body) && (db.table("forge_config")[0] as { version: number }).version === 1, J(direct));
    await t.shot(join(OUT, `06-non-admin-${width}.png`)).catch(() => undefined);
  } finally { await browser.close(); }
}

(async () => {
  for (const w of WIDTHS) { await runAdmin(w); }
  await runNonAdmin(390);
  const ok = results.filter((r) => r.ok).length;
  console.log(`\n→ ${ok}/${results.length}`);
  writeFileSync(join(OUT, "admin-qa.json"), JSON.stringify({ at: new Date().toISOString(), base: BASE, results }, null, 2));
  process.exit(ok === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
