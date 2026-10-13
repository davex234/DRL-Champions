/**
 * F79 · QA DE INTERFAZ de NEXUS FORGE 2.0 en Chrome real (headless) contra el build de producción LOCAL — fuera de CI.
 *
 * Sin BD viva y sin credenciales (0061 no está aplicada y no se toca producción):
 *   · SESIÓN SIMULADA inyectada antes de la app (patrón F51: `getSession` de supabase-js no valida contra red).
 *   · Las rutas `/api/game/{forge,crafting,missions,me}` se interceptan (CDP `Fetch`) y las atienden los SERVICIOS
 *     REALES de F73/F79 (`forge.ts`, `crafting.ts`, `missionEngine.ts`) sobre MemSupabase con datos QA claramente
 *     marcados. La interfaz es la real del build; nada se escribe en ninguna BD.
 *
 * Por anchura (1440 · 1024 · 390 con movimiento reducido, como el Chrome del usuario):
 *   HOME (núcleo, XP, maestría, 4 zonas, actividad) → AVANZADO (cadena, receta disponible, AUTO-SELECCIONAR →
 *   «VAS A ENTREGAR / RECIBIRÁS» → el servidor forja → revelación) → receta BLOQUEADA (silueta + pista) → INTERCAMBIO
 *   (protegida marcada y fuera de la auto-selección; confirmación con lo que desaparece; forja) → error legible por
 *   selección caducada → HISTORIAL → PROYECTO con etapas. Teclado (Tab/Enter abre, Escape cierra), sin scroll
 *   horizontal, sin errores de consola (salvo los 401 esperados de rutas NO interceptadas, que se listan aparte).
 *
 *   npx tsx scripts/_f79-ui-qa.ts [base=http://127.0.0.1:3011] [anchuras=1440,1024,390]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { launch, sleep, type Tab } from "./lib/cdp";
import { MemSupabase } from "../src/server/services/testing/memSupabase";
import { craftCard, craftPack, getCraftingState } from "../src/server/services/crafting";
import { claimMission, claimProject, getMissionsState } from "../src/server/services/missionEngine";
import { claimAchievement, claimObjective, forgeCraft, getForgeState } from "../src/server/services/forge";
import { resetF73Cache } from "../src/server/services/f73Config";
import { resetForgeConfigCache } from "../src/server/services/forgeConfig";
import { DEFAULT_FORGE_CONFIG } from "../src/domain/forge/defaults";
import type { ForgeConfig } from "../src/domain/forge/types";
import { CARDS } from "../src/data/catalog";
import { packCardClass, type PackCardClass } from "../src/domain/packs/packClass";

const BASE = process.argv[2] ?? "http://127.0.0.1:3011";
const WIDTHS = (process.argv[3] ?? "1440,1024,390").split(",").map(Number);
const OUT = join(process.cwd(), "docs/product/qa/f79/ui");
mkdirSync(OUT, { recursive: true });
const U = "f7900000-0000-4000-8000-000000000a79";
const results: { id: string; ok: boolean; detail: string }[] = [];
const views: string[] = [];
const check = (id: string, ok: boolean, detail = "") => { results.push({ id, ok, detail: String(detail).slice(0, 500) }); console.log(`${ok ? "PASS" : "FAIL"} ${id} ${String(detail).slice(0, 180)}`); return ok; };

/* ═══════════════ el mundo QA (servidor aislado, datos «QA ·») ═══════════════ */
const of = (cls: PackCardClass) => CARDS.filter((c) => packCardClass(c) === cls && !!c.image).sort((a, b) => a.ovr - b.ovr || a.id.localeCompare(b.id));
function world() {
  resetF73Cache(); resetForgeConfigCache();
  const db = new MemSupabase();
  db.table("profiles").push({ id: U, username: "qa-f79", credits: 5000, xp: 0, level: 1, points: 0, is_admin: false });
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/0059_crafting_missions.sql"), "utf8");
  const v = (s: string) => (s === "null" ? null : s.slice(1, -1));
  for (const m of sql.matchAll(/\('([a-z0-9-]+)',\s*'(PACK|CARD)',\s*'([^']+)',\s*(null|'[a-z]+'),\s*(null|'[a-z]+'),\s*(null|'[a-z]+'),\s*(null|'[a-z]+'),\s*(\d+),\s*'(ACTIVE|DISABLED)',\s*(\d+)\)/g)) {
    db.table("craft_recipes").push({ id: m[1], kind: m[2], name: m[3], input_pack_id: v(m[4]), output_pack_id: v(m[5]), input_class: v(m[6]), output_class: v(m[7]), input_qty: Number(m[8]), status: m[9], sort_order: Number(m[10]), available_from: null, available_to: null, version: 1 });
  }
  // Configuración QA: las plantillas activadas (en producción nacen DRAFT) + un objetivo QA con recompensa pequeña.
  const cfg: ForgeConfig = {
    ...DEFAULT_FORGE_CONFIG,
    recipes: DEFAULT_FORGE_CONFIG.recipes.map((r) => ({ ...r, status: "ACTIVE" })), chains: DEFAULT_FORGE_CONFIG.chains.map((c) => ({ ...c, status: "ACTIVE" })),
    blueprints: DEFAULT_FORGE_CONFIG.blueprints.map((b) => ({ ...b, status: "ACTIVE" })), achievements: DEFAULT_FORGE_CONFIG.achievements.map((a) => ({ ...a, status: "ACTIVE" })),
    objectives: [{ id: "qa-obj-dia", name: "QA · Forja 1 vez hoy", period: "DAILY", metric: "CRAFT_ANY", target: 1, reward: { credits: 100 }, status: "ACTIVE", activeWindows: [{ from: Date.now() - 3_600_000, to: null }] }, { ...DEFAULT_FORGE_CONFIG.objectives[1], status: "ACTIVE", activeWindows: [{ from: Date.now() - 3_600_000, to: null }] }],
    projects: [{ projectId: "qa-proyecto", own: [{ type: "OWN_DISTINCT_PLAYERS", min: 5 }], fabricateRecipeId: "forge-ruta-oro" }],
  };
  db.table("forge_config").push({ id: "main", doc: cfg, version: 1, updated_at: new Date().toISOString() });
  for (const r of cfg.recipes) db.table("craft_recipes").push({ id: r.id, kind: "CARD", name: r.name, input_pack_id: null, output_pack_id: null, input_class: r.consume[0].class, output_class: (r.output as { class: string }).class, input_qty: r.consume.reduce((s, x) => s + x.qty, 0), status: "ACTIVE", sort_order: 1000 + r.sortOrder, available_from: null, available_to: null, version: 1 });
  // Historia: 6 crafteos de sobres ya hechos (nivel 2 de Forja) — son filas del libro mayor, como en producción.
  for (let i = 0; i < 6; i++) db.table("economy_ops").push({ ref: `craft:pack:${U}:qa-hist-${i}`, user_id: U, kind: "craft_pack", result: { recipeId: "pack-estandar-premium", kind: "PACK", inputs: [{ packId: "estandar", qty: 4 }], outputs: [{ packId: "premium", qty: 1 }] }, created_at: new Date(Date.now() - (i + 1) * 86_400_000).toISOString() });
  for (const [pack, qty] of [["estandar", 9], ["premium", 3]] as const) db.table("user_packs").push({ user_id: U, pack_id: pack, qty });
  const give = (cardId: string, n: number) => Array.from({ length: n }, () => { const uid = randomUUID(); db.table("user_cards").push({ uid, user_id: U, card_id: cardId, serial: null, origin: "pack", locked: false, obtained_at: new Date(0).toISOString() }); return uid; });
  const plata = of("plata"), oro = of("oro"), base = of("base");
  give(plata[0].id, 5); give(plata[1].id, 4); give(plata[2].id, 3);
  const fav = plata[3].id; give(fav, 6);
  db.table("user_card_favorites").push({ user_id: U, card_id: fav, created_at: new Date().toISOString() });
  const show = give(plata[4].id, 2);
  db.table("player_profile_customization").push({ user_id: U, showcase_card_uids: [show[0]], featured_achievement_ids: [], version: 1 });
  for (const c of oro.slice(0, 3)) give(c.id, 2);
  for (const c of base.slice(0, 6)) give(c.id, 1);
  const inDeck = give(plata[5].id, 3);
  db.table("duel_decks").push({ id: randomUUID(), user_id: U, name: "QA", card_uids: [inDeck[0]], created_at: new Date(0).toISOString(), updated_at: new Date(0).toISOString() });
  const target = of("prime").sort((a, b) => b.ovr - a.ovr)[0];
  db.table("content_card_projects").push({ id: "qa-proyecto", name: "QA · Proyecto Forja 2.0", description: "Fixture de QA: carta REAL del catálogo.", target_card_id: target.id, status: "ACTIVE", sort_order: 0, available_from: null, available_to: null, version: 1 });
  const mission = (id: string, name: string, condition: object, target: number, over: object = {}) =>
    db.table("content_missions").push({ id, project_id: "qa-proyecto", name, description: "", condition, target, depends_on: [], reward: {}, status: "ACTIVE", sort_order: 0, available_from: null, available_to: null, version: 1, ...over });
  mission("qa-p1", "QA · Abre 1 sobre", { type: "OPEN_PACK" }, 1, { sort_order: 1 });
  mission("qa-p2", "QA · Intercambia 1 carta", { type: "CRAFT_CARD" }, 1, { sort_order: 2, depends_on: ["qa-p1"] });
  db.table("user_mission_progress").push({ user_id: U, mission_id: "qa-p1", progress: 1, completed_at: new Date().toISOString(), claimed_at: null });
  return { db, fav, show: show[0], plataIds: plata.map((c) => c.id) };
}

/* ═══════════════ sesión simulada + interceptación ═══════════════ */
const boot = `(() => {
  const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\\+/g, "-").replace(/\\//g, "_");
  const exp = 4102444800;
  const user = { id: ${JSON.stringify(U)}, aud: "authenticated", role: "authenticated", email: "qa-f79@example.invalid", app_metadata: {}, user_metadata: {} };
  const jwt = b64({ alg: "none", typ: "JWT" }) + "." + b64({ sub: user.id, exp, role: "authenticated", email: user.email }) + ".qa";
  const s = JSON.stringify({ access_token: jwt, token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: "qa-f79", user });
  for (const k of ["sb-127-auth-token", "sb-localhost-auth-token", "sb-valorosters-auth-token"]) { try { localStorage.setItem(k, s); } catch {} }
})();`;

async function intercept(t: Tab, w: ReturnType<typeof world>) {
  const { db } = w;
  await t.send("Fetch.enable", { patterns: ["forge", "crafting", "missions", "me", "telemetry"].map((r) => ({ urlPattern: `*/api/${r === "telemetry" ? "" : "game/"}${r}*`, requestStage: "Request" })) });
  t.on("Fetch.requestPaused", async (p: { requestId: string; request: { url: string; method: string; postData?: string } }) => {
    let status = 200; let body: unknown = {};
    try {
      const b = p.request.postData ? JSON.parse(p.request.postData) : {};
      const send = (r: { ok: boolean; status: number; error?: string; code?: string; data?: unknown }) => { status = r.status; body = r.ok ? r.data : { error: r.error, ...(r.code ? { code: r.code } : {}) }; };
      const u = p.request.url;
      if (u.includes("/api/telemetry")) { status = 204; body = null; }
      else if (u.includes("/api/game/forge")) {
        if (p.request.method === "GET") send(await getForgeState(db.client, U));
        else if (b.action === "craft") send(await forgeCraft(db.client, U, b.recipeId, b.uids, b.ref, b.confirmProtected ?? []));
        else if (b.action === "view") { views.push(String(b.recipeId)); send({ ok: true, status: 200, data: { ok: true } }); }
        else if (b.action === "claimObjective") send(await claimObjective(db.client, U, b.objectiveId));
        else if (b.action === "claimAchievement") send(await claimAchievement(db.client, U, b.achievementId));
        else { status = 400; body = { error: "Acción inválida", code: "BAD_REQUEST" }; }
      } else if (u.includes("/api/game/crafting")) {
        if (p.request.method === "GET") send(await getCraftingState(db.client, U));
        else if (b.action === "craftPack") send(await craftPack(db.client, U, b.recipeId, b.ref));
        else if (b.action === "craftCard") send(await craftCard(db.client, U, b.recipeId, b.uids, b.ref));
      } else if (u.includes("/api/game/missions")) {
        if (p.request.method === "GET") send(await getMissionsState(db.client, U));
        else if (b.action === "claimMission") send(await claimMission(db.client, U, b.missionId));
        else if (b.action === "claimProject") send(await claimProject(db.client, U, b.projectId));
      } else if (u.includes("/api/game/me")) {
        body = { profile: { id: U, username: "qa-f79", avatar: "🎮", level: 3, xp: 0, credits: Number(db.table("profiles")[0].credits), points: 0, region: null, is_admin: false } };
      }
    } catch (e) { status = 500; body = { error: (e as Error).message.slice(0, 120) }; }
    const raw = body === null ? "" : JSON.stringify(body);
    await t.send("Fetch.fulfillRequest", { requestId: p.requestId, responseCode: status, responseHeaders: [{ name: "content-type", value: "application/json" }, { name: "cache-control", value: "no-store" }], body: Buffer.from(raw).toString("base64") }).catch(() => undefined);
  });
}

const J = JSON.stringify;
const has = (tid: string) => `!!document.querySelector('[data-testid="${tid}"]')`;
const click = (sel: string) => `(() => { const e = document.querySelector(${J(sel)}); if (!e || e.disabled) return false; e.scrollIntoView({ block: "center" }); e.click(); return true; })()`;
async function waitFor(t: Tab, expr: string, ms = 15000) { for (let i = 0; i < ms / 200; i++) { if (await t.js<boolean>(expr).catch(() => false)) return true; await sleep(200); } return false; }
const noOverflow = `document.scrollingElement.scrollWidth <= innerWidth + 1`;
const KNOWN_NOISE = /\[sync\]|401|No autenticado|Failed to load resource|favicon|play-status|daily-loop|net::ERR/i;

async function run(width: number) {
  const w = world();
  const reduced = width <= 390;
  const browser = await launch({ width, height: width < 600 ? 844 : width <= 1024 ? 768 : 900, args: ["--in-process-gpu", "--mute-audio", "--hide-scrollbars"] });
  const t = browser.tab;
  const shot = (name: string) => t.shot(join(OUT, `${name}-${width}.png`)).catch(() => undefined);
  try {
    await t.setMedia([{ name: "prefers-reduced-motion", value: reduced ? "reduce" : "no-preference" }]);
    await t.send("Page.addScriptToEvaluateOnNewDocument", { source: boot });
    await intercept(t, w);
    const errs: string[] = [];
    const pageErrors = () => { const e = t.takeErrors(); errs.push(...e); };

    // ── HOME
    await t.goto(`${BASE}/misiones/crafting`, 2500);
    check(`[${width}] HOME · el núcleo de nivel y la XP vienen del servidor`, await waitFor(t, `${has("forge-hero")} && ${has("forge-level-core")}`), "");
    const home = await t.js<{ level: string; tiles: number; entries: string[]; xp: string | null }>(`({ level: document.querySelector('[data-testid="forge-level"]')?.textContent, tiles: document.querySelectorAll('[data-testid="forge-mastery"] li').length, entries: [...document.querySelectorAll('[data-testid^="crafting-entry-"]')].map(e => e.dataset.testid), xp: document.querySelector('[data-testid="forge-xp"]')?.getAttribute('aria-valuenow') })`);
    check(`[${width}] HOME · nivel 2 (6 crafteos × 20 XP; los objetivos activados hace 1 h NO suman el pasado), 4 ramas, 4 zonas`, home.level === "2" && home.tiles === 4 && home.entries.length === 4, J(home));
    check(`[${width}] HOME · sin scroll horizontal`, await t.js<boolean>(noOverflow));
    check(`[${width}] HOME · objetivos y actividad`, await t.js<boolean>(`${has("forge-objectives")} && ${has("forge-activity")} && ${has("forge-active-project")}`));
    await shot("01-home");

    // ── AVANZADO: receta disponible → auto-seleccionar → confirmar → resultado del servidor
    await t.goto(`${BASE}/misiones/crafting/avanzado`, 2500);
    check(`[${width}] AVANZADO · cadena y recetas`, await waitFor(t, `${has("forge-chain")} && document.querySelectorAll('[data-testid="advanced-recipe"]').length === 3`));
    const states = await t.js<Record<string, string>>(`Object.fromEntries([...document.querySelectorAll('[data-testid="advanced-recipe"]')].map(e => [e.dataset.recipe, e.dataset.state]))`);
    check(`[${width}] AVANZADO · estados derivados (paso 1 disponible, 2 y 3 bloqueados)`, states["forge-ruta-oro"] === "AVAILABLE" && states["forge-ruta-masters"] === "LOCKED" && states["forge-ruta-champions"] === "LOCKED", J(states));
    await t.js(click('[data-recipe="forge-ruta-oro"]')); await sleep(400);
    check(`[${width}] ANALÍTICA · abrir una receta envía recipe_view (solo id)`, await (async () => { for (let i = 0; i < 20 && !views.includes("forge-ruta-oro"); i++) await sleep(100); return views.includes("forge-ruta-oro"); })(), J(views));
    check(`[${width}] AVANZADO · sin elegir, FORJAR desactivado`, await t.js<boolean>(`document.querySelector('[data-testid="forge-craft"]')?.disabled === true`));
    await t.js(click('[data-testid="forge-autoselect"]')); await sleep(400);
    const picked = await t.js<{ protectedPicked: number; n: number }>(`({ protectedPicked: [...document.querySelectorAll('[data-testid="material-candidate"][data-protected="true"][data-picked="true"]')].length, n: [...document.querySelectorAll('[data-testid="material-candidate"][data-picked="true"]')].length })`);
    check(`[${width}] AUTO-SELECCIONAR · nunca protegidas`, picked.protectedPicked === 0 && picked.n > 0, J(picked));
    check(`[${width}] AUTO-SELECCIONAR · FORJAR activo`, await waitFor(t, `document.querySelector('[data-testid="forge-craft"]')?.disabled === false`, 3000));
    // Teclado: foco en FORJAR + Enter abre; Escape cierra; se vuelve a abrir con clic.
    await t.js(`document.querySelector('[data-testid="forge-craft"]').focus()`);
    await t.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r", unmodifiedText: "\r" }); await t.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    check(`[${width}] TECLADO · Enter abre la confirmación`, await waitFor(t, has("forge-confirm-dialog"), 3000));
    await t.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }); await t.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    check(`[${width}] TECLADO · Escape cierra sin forjar`, await waitFor(t, `!${has("forge-confirm-dialog")}`, 3000) && w.db.table("economy_ops").filter((o) => o.kind === "craft_card").length === 0);
    await t.js(click('[data-testid="forge-craft"]'));
    await waitFor(t, has("forge-confirm"), 3000);
    const conf = await t.js<{ items: number; text: string }>(`({ items: [...document.querySelectorAll('[data-testid="forge-confirm-item"]')].reduce((s, e) => s + Number(e.dataset.qty), 0), text: document.querySelector('[data-testid="forge-confirm"]')?.innerText ?? "" })`);
    check(`[${width}] CONFIRMACIÓN · «vas a entregar» lista EXACTAMENTE 4 copias y «recibirás» la clase`, conf.items === 4 && /Vas a entregar/i.test(conf.text) && /Recibirás/i.test(conf.text), J({ items: conf.items }));
    await sleep(reduced ? 300 : 900);
    check(`[${width}] CONFIRMACIÓN · el botón CONFIRMAR es alcanzable (visible tras desplazar el diálogo)`, await t.js<boolean>(`(() => { const b = document.querySelector('[data-testid="forge-confirm-button"]'); if (!b) return false; b.scrollIntoView({ block: "nearest" }); const r = b.getBoundingClientRect(); if (!(r.bottom <= innerHeight + 1 && r.top >= 0)) return false; const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!hit && (hit === b || b.contains(hit)); })()`));
    await shot("02-advanced-confirm");
    const before = w.db.table("economy_ops").filter((o) => o.kind === "craft_card").length;
    await t.js(click('[data-testid="forge-confirm-button"]'));
    const shown = await waitFor(t, has("craft-result"), 8000);
    check(`[${width}] FORJA · el resultado aparece DESPUÉS de que el servidor confirma (1 asiento nuevo)`, shown && w.db.table("economy_ops").filter((o) => o.kind === "craft_card").length === before + 1);
    check(`[${width}] FORJA · el diálogo no queda recortado por su contenedor (el centro de su cabecera es suyo)`, await t.js<boolean>(`(() => { const d = document.querySelector('[data-testid="forge-confirm-dialog"]'); if (!d) return false; const r = d.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, Math.min(innerHeight - 10, r.top + 30)); return !!hit && d.contains(hit) && r.left >= 0 && r.right <= innerWidth + 1; })()`));
    await sleep(reduced ? 400 : 1400);
    const outCard = (w.db.table("economy_ops").filter((o) => o.kind === "craft_card").at(-1)?.result as { outputs: { cardId: string }[] } | undefined)?.outputs[0].cardId;
    check(`[${width}] FORJA · la carta revelada es la del servidor`, !!outCard && await t.js<boolean>(`!!document.querySelector('[data-testid="craft-result"]') && document.querySelector('[data-testid="craft-result"]').innerText.length > 5`), outCard ?? "");
    await shot("03-advanced-result");
    await t.js(`[...document.querySelectorAll('[data-testid="forge-confirm-dialog"] button')].find(b => /Continuar/.test(b.textContent))?.click()`); await sleep(1200);
    const after = await t.js<Record<string, string>>(`Object.fromEntries([...document.querySelectorAll('[data-testid="advanced-recipe"]')].map(e => [e.dataset.recipe, e.dataset.state]))`);
    check(`[${width}] CADENA · paso 1 COMPLETED y el paso 2 deja de estar bloqueado`, after["forge-ruta-oro"] === "COMPLETED" && after["forge-ruta-masters"] !== "LOCKED", J(after));
    await t.js(click('[data-recipe="forge-ruta-champions"]')); await sleep(500);
    const locked = await t.js<{ state: string | undefined; text: string }>(`({ state: document.querySelector('[data-testid="advanced-detail"]')?.dataset.state, text: document.querySelector('[data-testid="advanced-detail"]')?.innerText ?? "" })`);
    check(`[${width}] BLOQUEADA · silueta, pista y condiciones; sin revelar materiales ni salida`, locked.state === "LOCKED" && /\?\?\?/.test(locked.text) && /Nivel de Forja|Plano|Completa/.test(locked.text) && !/Entregas/.test(locked.text), locked.text.slice(0, 120));
    await shot("04-advanced-locked");
    check(`[${width}] AVANZADO · sin scroll horizontal`, await t.js<boolean>(noOverflow));

    // ── INTERCAMBIO: protegida marcada; auto-selección sin ella; confirmación; forja
    await t.goto(`${BASE}/misiones/crafting/cartas`, 2500);
    check(`[${width}] INTERCAMBIO · carga desde la Forja`, await waitFor(t, `${has("exchange")} && ${has("card-recipe")}`));
    await t.js(click('[data-recipe="card-plata-oro"]'));
    check(`[${width}] INTERCAMBIO · duplicados Plata elegibles`, await waitFor(t, has("exchange-candidate"), 4000));
    const prot = await t.js<{ protectedCards: string[]; cards: number }>(`({ protectedCards: [...document.querySelectorAll('[data-testid="exchange-candidate"][data-protected="true"]')].map(e => e.dataset.card), cards: document.querySelectorAll('[data-testid="exchange-candidate"]').length })`);
    check(`[${width}] PROTECCIÓN · la favorita y la de la vitrina se ven marcadas`, prot.protectedCards.includes(w.fav), J(prot));
    await t.js(click('[data-testid="forge-autoselect"]')); await sleep(400);
    const exPick = await t.js<{ count: string; protectedPicked: number }>(`({ count: document.querySelector('[data-testid="exchange-count"]')?.innerText ?? "", protectedPicked: [...document.querySelectorAll('[data-testid="exchange-candidate"][data-protected="true"]')].filter(e => e.dataset.picked !== "0").length })`);
    check(`[${width}] AUTO-SELECCIONAR (intercambio) · 3/3 sin protegidas`, /^3\s*\/\s*3/.test(exPick.count.replace(/\s+/g, " ")) && exPick.protectedPicked === 0, J(exPick));
    await shot("05-exchange-picked");
    await t.js(click('[data-testid="exchange-craft"]'));
    await waitFor(t, has("forge-confirm"), 3000);
    check(`[${width}] INTERCAMBIO · confirmación con las 3 copias que desaparecen`, await t.js<boolean>(`[...document.querySelectorAll('[data-testid="forge-confirm-item"]')].reduce((s, e) => s + Number(e.dataset.qty), 0) === 3`));
    // Selección CADUCADA: otra pestaña consume una de esas copias → error legible, nunca JSON.
    // La carta realmente elegida (la que enseña la interfaz) pierde todas sus copias libres en «otra pestaña».
    const pickedCard = await t.js<string>(`[...document.querySelectorAll('[data-testid="exchange-candidate"]')].find(e => e.dataset.picked !== "0")?.dataset.card ?? ""`);
    const gone = (await getForgeState(w.db.client, U)).data!.exchange.find((e) => e.id === "card-plata-oro")!.materials[0].candidates.find((c) => c.cardId === pickedCard)!.free.map((f) => f.uid);
    const opsBefore = w.db.table("economy_ops").length;
    w.db.tables.user_cards = w.db.table("user_cards").filter((c) => !gone.includes(String(c.uid)));
    await t.js(click('[data-testid="card-craft-confirm"]'));
    await waitFor(t, `!!document.querySelector('[data-testid="card-craft-dialog"] [role="alert"]')`, 6000);
    const errText = await t.js<string>(`document.querySelector('[data-testid="card-craft-dialog"] [role="alert"]')?.innerText ?? ""`);
    check(`[${width}] ERROR · selección caducada → frase legible (sin JSON) y nada consumido`, errText.length > 10 && !/[{}]|"error"/.test(errText) && w.db.table("economy_ops").length === opsBefore, errText);
    await shot("06-exchange-error");
    await t.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }); await sleep(600);
    check(`[${width}] INTERCAMBIO · sin scroll horizontal`, await t.js<boolean>(noOverflow));

    // ── REGRESIÓN F73/F74: forja de SOBRES (el diálogo compartido ahora va por portal)
    await t.goto(`${BASE}/misiones/crafting/sobres`, 2500);
    check(`[${width}] SOBRES · la escalera F73 sigue igual`, await waitFor(t, `${has("pack-ladder")} && ${has("pack-recipe-craft")}`));
    await t.js(click('[data-recipe="pack-estandar-premium"] [data-testid="pack-recipe-craft"]'));
    check(`[${width}] SOBRES · diálogo por encima de todo (portal) con CONFIRMAR alcanzable`, await waitFor(t, has("pack-craft-confirm"), 4000) && await t.js<boolean>(`(() => { const b = document.querySelector('[data-testid="pack-craft-confirm"]'); b.scrollIntoView({ block: "nearest" }); const r = b.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!hit && (hit === b || b.contains(hit)); })()`));
    await t.js(click('[data-testid="pack-craft-confirm"]'));
    check(`[${width}] SOBRES · forja de sobres F73 intacta (resultado tras el servidor)`, await waitFor(t, has("craft-result"), 6000) && w.db.table("economy_ops").filter((o) => o.kind === "craft_pack").length === 7);
    await sleep(reduced ? 300 : 1900);
    await shot("09-packs-result");
    await t.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }); await sleep(500);

    // ── HISTORIAL y PROYECTO
    await t.goto(`${BASE}/misiones/crafting/historial`, 2200);
    const hist = await waitFor(t, has("forge-history-entry"));
    const types = await t.js<string[]>(`[...document.querySelectorAll('[data-testid="forge-history-entry"]')].map(e => e.dataset.type)`);
    check(`[${width}] HISTORIAL · desde el libro mayor (avanzada + 7 de sobres)`, hist && types.includes("ADVANCED") && types.filter((x) => x === "PACK").length === 7, J(types));
    check(`[${width}] HISTORIAL · sin scroll horizontal`, await t.js<boolean>(noOverflow));
    await shot("07-history");
    await t.goto(`${BASE}/misiones/crafting/cartas/qa-proyecto`, 2500);
    check(`[${width}] PROYECTO 2.0 · etapas (misiones por profundidad + reúne + fabrica)`, await waitFor(t, `${has("project-stages")} && document.querySelectorAll('[data-testid="project-stage"]').length >= 3`));
    const stageKinds = await t.js<string[]>(`[...document.querySelectorAll('[data-testid="project-stage"]')].map(e => e.dataset.kind + ":" + e.dataset.done)`);
    check(`[${width}] PROYECTO 2.0 · «fabrica» hecha tras la forja avanzada`, stageKinds.includes("FABRICATE:true"), J(stageKinds));
    check(`[${width}] PROYECTO · sin scroll horizontal`, await t.js<boolean>(noOverflow));
    await shot("08-project-stages");

    pageErrors();
    const real = errs.filter((e) => !KNOWN_NOISE.test(e));
    check(`[${width}] CONSOLA · 0 errores propios (401 de rutas no interceptadas aparte: ${errs.length - real.length})`, real.length === 0, J(real.slice(0, 5)));
  } finally { await browser.close(); }
}

(async () => {
  for (const wdt of WIDTHS) await run(wdt);
  const pass = results.filter((r) => r.ok).length;
  writeFileSync(join(OUT, "ui-qa.json"), JSON.stringify({ at: new Date().toISOString(), base: BASE, widths: WIDTHS, note: "sesión simulada + servicios reales F73/F79 sobre MemSupabase (CDP Fetch); build local; nada escrito en ninguna BD", pass, fail: results.length - pass, results }, null, 2));
  console.log(`→ ${pass}/${results.length}`);
  process.exit(results.some((r) => !r.ok) ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(3); });
