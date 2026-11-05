/**
 * F79 · NEXUS FORGE 2.0 en los servicios REALES sobre MemSupabase (cada RPC es atómica y se revierte si lanza, como la
 * transacción de Postgres; el `await` entre leer y escribir es el hueco real de producción).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { CARDS } from "@/data/catalog";
import { packCardClass, type PackCardClass } from "@/domain/packs/packClass";
import { DEFAULT_FORGE_CONFIG } from "@/domain/forge/defaults";
import type { ForgeConfig } from "@/domain/forge/types";
import { MemSupabase } from "./testing/memSupabase";
import { craftCard, craftPack } from "./crafting";
import { claimProject } from "./missionEngine";
import { resetF73Cache } from "./f73Config";
import { resetForgeConfigCache } from "./forgeConfig";
import { claimObjective, forgeCraft, getForgeState } from "./forge";
import { salvageCards } from "./economy";
import { getForgeAdmin, saveForgeConfig } from "@/server/cms/forge";
import { forgeCmsHandlers } from "@/server/cms/handlers";
import type { AdminDeps } from "@/server/admin/http";
import { saveRecipe } from "@/server/cms/crafting";

const A = "aaaaaaaa-0000-4000-8000-0000000079aa";
const B = "bbbbbbbb-0000-4000-8000-0000000079bb";
const ADMIN = "cccccccc-0000-4000-8000-0000000079cc";

function seedRecipes(db: MemSupabase) {
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/0059_crafting_missions.sql"), "utf8");
  const v = (s: string) => (s === "null" ? null : s.slice(1, -1));
  for (const m of sql.matchAll(/\('([a-z0-9-]+)',\s*'(PACK|CARD)',\s*'([^']+)',\s*(null|'[a-z]+'),\s*(null|'[a-z]+'),\s*(null|'[a-z]+'),\s*(null|'[a-z]+'),\s*(\d+),\s*'(ACTIVE|DISABLED)',\s*(\d+)\)/g)) {
    db.table("craft_recipes").push({ id: m[1], kind: m[2], name: m[3], input_pack_id: v(m[4]), output_pack_id: v(m[5]), input_class: v(m[6]), output_class: v(m[7]), input_qty: Number(m[8]), status: m[9], sort_order: Number(m[10]), available_from: null, available_to: null, version: 1 });
  }
}
function fresh(): MemSupabase {
  resetF73Cache(); resetForgeConfigCache();
  const db = new MemSupabase();
  for (const u of [A, B]) db.table("profiles").push({ id: u, username: u.slice(0, 6), credits: 10_000, xp: 0, level: 1, points: 0, is_admin: false });
  db.table("profiles").push({ id: ADMIN, username: "admin", credits: 0, xp: 0, level: 1, points: 0, is_admin: true });
  seedRecipes(db);
  return db;
}
const of = (cls: PackCardClass) => CARDS.filter((c) => packCardClass(c) === cls).sort((a, b) => a.id.localeCompare(b.id));
function give(db: MemSupabase, user: string, cardId: string, n: number, locked = false): string[] {
  return Array.from({ length: n }, () => { const uid = randomUUID(); db.table("user_cards").push({ uid, user_id: user, card_id: cardId, serial: null, origin: "pack", locked, obtained_at: new Date(0).toISOString() }); return uid; });
}
const copiesOf = (db: MemSupabase, user: string, cardId: string) => db.table("user_cards").filter((c) => c.user_id === user && c.card_id === cardId).length;
const credits = (db: MemSupabase, user: string) => Number(db.table("profiles").find((p) => p.id === user)?.credits ?? 0);
const activeCfg = (cfg: ForgeConfig = DEFAULT_FORGE_CONFIG): ForgeConfig => ({
  ...cfg,
  recipes: cfg.recipes.map((r) => ({ ...r, status: "ACTIVE" })), chains: cfg.chains.map((c) => ({ ...c, status: "ACTIVE" })),
  blueprints: cfg.blueprints.map((b) => ({ ...b, status: "ACTIVE" })), objectives: cfg.objectives.map((o) => ({ ...o, status: "ACTIVE" })),
  achievements: cfg.achievements.map((a) => ({ ...a, status: "ACTIVE" })),
});
async function publish(db: MemSupabase, cfg: ForgeConfig): Promise<void> {
  const cur = await getForgeAdmin(db.client);
  const version = (cur as { data?: { version: number } }).data?.version ?? 0;
  const r = await saveForgeConfig(db.client, ADMIN, { doc: cfg, expectedVersion: version, reason: "test" });
  assert.ok(r.ok, (r as { error?: string }).error);
}
async function levelUp(db: MemSupabase, user: string, crafts: number) {
  db.table("user_packs").push({ user_id: user, pack_id: "estandar", qty: crafts * 4 });
  for (let i = 0; i < crafts; i++) assert.ok((await craftPack(db.client, user, "pack-estandar-premium", `lvl-${user.slice(0, 4)}-${i}-0000`)).ok);
}
const PLATA = of("plata")[0].id;

/* ═══════════════════ foto y XP ═══════════════════ */

test("F79 F1 · foto inicial: nivel 1, sin contenido DRAFT a la vista, intercambio F73 presente, sin escrituras", async () => {
  const db = fresh();
  const w0 = db.writes;
  const r = await getForgeState(db.client, A);
  assert.ok(r.ok, r.error);
  const s = r.data!;
  assert.equal(s.core.level.level, 1); assert.equal(s.core.xp.total, 0);
  assert.deepEqual(s.core.recipes, [], "las plantillas nacen DRAFT: nadie las ve");
  assert.deepEqual(s.core.objectives, []); assert.deepEqual(s.core.achievements, []);
  assert.ok(s.exchange.some((e) => e.id === "card-plata-oro"), "el intercambio F73 sigue ahí");
  assert.ok(!s.exchange.some((e) => e.id.startsWith("forge-")));
  assert.equal(db.writes, w0, "leer la Forja no escribe nada");
});

test("F79 F2 · la XP sale del libro mayor: sobre + intercambio; un reintento (misma ref) NO suma", async () => {
  const db = fresh();
  db.table("user_packs").push({ user_id: A, pack_id: "estandar", qty: 4 });
  const uids = give(db, A, PLATA, 4);
  assert.ok((await craftPack(db.client, A, "pack-estandar-premium", "gesto-f2-pack-000")).ok);
  const r1 = await forgeCraft(db.client, A, "card-plata-oro", uids.slice(0, 3), "gesto-f2-card-000", []);
  assert.ok(r1.ok, r1.error);
  const again = await forgeCraft(db.client, A, "card-plata-oro", uids.slice(0, 3), "gesto-f2-card-000", []);
  assert.equal(again.data!.repeated, true);
  const s = (await getForgeState(db.client, A)).data!;
  assert.equal(s.core.xp.crafts, DEFAULT_FORGE_CONFIG.xp.craftPack + DEFAULT_FORGE_CONFIG.xp.craftCard);
  assert.equal(s.history.length, 2);
  assert.equal(copiesOf(db, A, PLATA), 1, "se entregaron 3 una sola vez");
});

/* ═══════════════════ desbloqueo, cadena, POSEER vs CONSUMIR ═══════════════════ */

test("F79 F3 · receta avanzada bloqueada: la Forja la rechaza (LOCKED) y el intercambio F73 nunca la acepta", async () => {
  const db = fresh();
  await publish(db, activeCfg());
  const uids = give(db, A, PLATA, 5);
  const r = await forgeCraft(db.client, A, "forge-ruta-oro", uids.slice(0, 4), "gesto-f3-0000000", []);
  assert.equal(r.ok, false); assert.equal(r.code, "RECIPE_LOCKED");
  const old = await craftCard(db.client, A, "forge-ruta-oro", uids.slice(0, 4), "gesto-f3-old-0000");
  assert.equal(old.ok, false); assert.equal(old.code, "USE_FORGE", "el intercambio F73 no salta desbloqueos");
  assert.equal(copiesOf(db, A, PLATA), 5, "nada se consumió");
});

test("F79 F4 · cadena: nivel 2 abre el paso 1; hecho el 1 se abre el 2; un paso no repetible no se repite", async () => {
  const db = fresh();
  await publish(db, activeCfg());
  await levelUp(db, A, 5); // 5 × 20 XP = nivel 2
  const s0 = (await getForgeState(db.client, A)).data!;
  assert.equal(s0.core.level.level, 2);
  const uids = give(db, A, PLATA, 9);
  const r = await forgeCraft(db.client, A, "forge-ruta-oro", uids.slice(0, 4), "gesto-f4-0000000", []);
  assert.ok(r.ok, r.error); assert.equal(r.data!.advanced, true);
  assert.equal(packCardClass(CARDS.find((c) => c.id === r.data!.outputs[0].cardId)!), "oro", "sale una carta REAL de la clase");
  const s1 = (await getForgeState(db.client, A)).data!;
  assert.equal(s1.core.recipes.find((x) => x.id === "forge-ruta-oro")!.state, "COMPLETED");
  assert.notEqual(s1.core.recipes.find((x) => x.id === "forge-ruta-masters")!.state, "LOCKED", "el paso 2 se desbloqueó");
  assert.equal(s1.core.chains[0].done, 1);
  const again = await forgeCraft(db.client, A, "forge-ruta-oro", uids.slice(4, 8), "gesto-f4-b-000000", []);
  assert.ok(again.ok && again.data!.repeated, "no repetible: otro gesto recibe la forja ya hecha (misma clave del libro mayor)");
  assert.equal(again.data!.outputs[0].uid, r.data!.outputs[0].uid);
  assert.equal(copiesOf(db, A, PLATA), 5, "y no consume nada más");
});

test("F79 F5 · POSEER no se consume y se exige; CONSUMIR solo lo de los huecos", async () => {
  const db = fresh();
  await publish(db, activeCfg());
  await levelUp(db, A, 5);
  const p = give(db, A, PLATA, 5);
  const step1 = await forgeCraft(db.client, A, "forge-ruta-oro", p.slice(0, 4), "gesto-f5-a-000000", []);
  assert.ok(step1.ok, step1.error);
  const step1Out = step1.data!.outputs[0].cardId; // aleatoria (Oro): puede coincidir con una de las de abajo
  const oro = of("oro").slice(0, 5);
  const oroUids = oro.flatMap((c) => give(db, A, c.id, 3).slice(0, 2)); // 5 cartas × 2 entregables = 10
  const noOwn = await forgeCraft(db.client, A, "forge-ruta-masters", oroUids, "gesto-f5-b-000000", []);
  assert.equal(noOwn.code, "OWN_UNMET", "pide POSEER una carta Masters L");
  const ml = CARDS.find((c) => c.variantId === "masters-l")!;
  give(db, A, ml.id, 1);
  const ok = await forgeCraft(db.client, A, "forge-ruta-masters", oroUids, "gesto-f5-c-000000", []);
  assert.ok(ok.ok, ok.error);
  assert.equal(copiesOf(db, A, ml.id), 1, "la Masters L que se pedía POSEER sigue ahí");
  assert.ok(oro.every((c) => copiesOf(db, A, c.id) === 1 + (c.id === step1Out ? 1 : 0)), "de cada Oro entregada queda una copia");
});

/* ═══════════════════ protección, última copia, concurrencia ═══════════════════ */

test("F79 F6 · favorita/vitrina: hay que confirmarla copia a copia; el intercambio F73 (sin confirmación) la rechaza", async () => {
  const db = fresh();
  const fav = of("plata")[1].id;
  const u = give(db, A, fav, 4);
  db.table("user_card_favorites").push({ user_id: A, card_id: fav, created_at: new Date().toISOString() });
  const no = await forgeCraft(db.client, A, "card-plata-oro", u.slice(0, 3), "gesto-f6-a-000000", []);
  assert.equal(no.code, "PROTECTED_COPY");
  const old = await craftCard(db.client, A, "card-plata-oro", u.slice(0, 3), "gesto-f6-b-000000");
  assert.equal(old.code, "PROTECTED_COPY");
  assert.equal(copiesOf(db, A, fav), 4);
  const yes = await forgeCraft(db.client, A, "card-plata-oro", u.slice(0, 3), "gesto-f6-c-000000", u.slice(0, 3));
  assert.ok(yes.ok, yes.error); assert.equal(yes.data!.protectedUsed.length, 3);
  assert.equal(copiesOf(db, A, fav), 1, "confirmada: se entrega, y la última copia se conserva igual");
  const show = give(db, B, PLATA, 4);
  db.table("player_profile_customization").push({ user_id: B, showcase_card_uids: [show[0]], featured_achievement_ids: [], version: 1 });
  assert.equal((await forgeCraft(db.client, B, "card-plata-oro", show.slice(0, 3), "gesto-f6-d-000000", [])).code, "PROTECTED_COPY", "la copia de la vitrina también");
});

test("F79 F7 · última copia: nunca, ni con la copia en venta del mercado contando como «la que conservas»", async () => {
  const db = fresh();
  const u = give(db, A, PLATA, 3);
  give(db, A, PLATA, 1, true); // en venta
  const r = await forgeCraft(db.client, A, "card-plata-oro", u, "gesto-f7-0000000", []);
  assert.equal(r.code, "LAST_COPY");
  assert.equal(copiesOf(db, A, PLATA), 4);
  // Y la propia RPC (0061) lo impone aunque Node se equivocara.
  const rpc = await db.client.rpc("app_craft_card", { p_user: A, p_recipe: "card-plata-oro", p_uids: u, p_expected: Object.fromEntries(u.map((x) => [x, PLATA])), p_output_card_id: of("oro")[0].id, p_ref: "rpc-f7" });
  assert.match(String(rpc.error?.message), /LAST_COPY/);
});

test("F79 F8 · dos pestañas (misma ref) = una forja; 10 forjas simultáneas con material para una = 1 y nunca negativo", async () => {
  const db = fresh();
  const u = give(db, A, PLATA, 4);
  const [x, y] = await Promise.all([forgeCraft(db.client, A, "card-plata-oro", u.slice(0, 3), "gesto-f8-same-0000", []), forgeCraft(db.client, A, "card-plata-oro", u.slice(0, 3), "gesto-f8-same-0000", [])]);
  assert.ok(x.ok && y.ok);
  assert.equal(db.table("economy_ops").filter((o) => o.kind === "craft_card").length, 1);
  assert.equal(copiesOf(db, A, PLATA), 1);
  const db2 = fresh();
  const v = give(db2, A, PLATA, 4);
  const all = await Promise.all(Array.from({ length: 10 }, (_, i) => forgeCraft(db2.client, A, "card-plata-oro", v.slice(0, 3), `gesto-f8-${i}-00000000`, [])));
  assert.equal(all.filter((r) => r.ok).length, 1, "material para una sola");
  assert.ok(all.filter((r) => !r.ok).every((r) => ["NOT_ELIGIBLE", "LAST_COPY"].includes(String(r.code))), "los demás fallan por inventario, sin 500");
  assert.equal(copiesOf(db2, A, PLATA), 1);
  assert.ok(db2.table("user_cards").filter((c) => c.user_id === A).length >= 0);
});

test("F79 F8b · paso de cadena NO repetible desde dos pestañas (gestos distintos, material para dos): UNA forja, el otro recibe la misma", async () => {
  const db = fresh();
  await publish(db, activeCfg());
  await levelUp(db, A, 5);
  const p = give(db, A, PLATA, 9);
  const rs = await Promise.all([
    forgeCraft(db.client, A, "forge-ruta-oro", p.slice(0, 4), "gesto-f8b-tab1-000", []),
    forgeCraft(db.client, A, "forge-ruta-oro", p.slice(4, 8), "gesto-f8b-tab2-000", []),
  ]);
  const applied = db.table("economy_ops").filter((o) => o.kind === "craft_card" && (o.result as { recipeId?: string }).recipeId === "forge-ruta-oro");
  assert.equal(applied.length, 1, "un paso no repetible se forja UNA vez aunque lleguen dos pestañas a la vez");
  assert.equal(copiesOf(db, A, PLATA), 5, "solo se entregaron 4 copias");
  assert.ok(rs.every((r) => r.ok), JSON.stringify(rs.map((r) => r.code)));
  assert.equal(rs.filter((r) => r.data!.repeated).length, 1, "una aplica y la otra recibe la suya");
  const outs = rs.map((r) => r.data!.outputs[0].uid);
  assert.equal(outs[0], outs[1], "las dos pestañas enseñan la MISMA carta (la del servidor)");
  const later = await forgeCraft(db.client, A, "forge-ruta-oro", p.slice(4, 8), "gesto-f8b-tab3-000", []);
  assert.ok(later.ok && later.data!.repeated && later.data!.outputs[0].uid === outs[0], "una pestaña rezagada recibe el MISMO resultado, sin consumir");
  assert.equal(copiesOf(db, A, PLATA), 5);
});

test("F79 F9 · desguace + forja de la misma carta a la vez: jamás 0 copias", async () => {
  const db = fresh();
  const u = give(db, A, PLATA, 4);
  const [s, f] = await Promise.all([salvageCards(db.client, A, [u[3]], "salv-f79-a"), forgeCraft(db.client, A, "card-plata-oro", u.slice(0, 3), "gesto-f9-0000000", [])]);
  assert.ok(s.ok !== undefined && f.ok !== undefined);
  assert.ok(copiesOf(db, A, PLATA) >= 1, "siempre queda una copia");
  assert.ok(!(s.ok && f.ok), "no pueden salir las dos (4 copias: 3 + 1 dejaría 0)");
});

test("F79 F10 · cruce entre usuarios: copias de otro → NOT_ELIGIBLE, y nada se toca", async () => {
  const db = fresh();
  const theirs = give(db, B, PLATA, 4);
  const r = await forgeCraft(db.client, A, "card-plata-oro", theirs.slice(0, 3), "gesto-f10-000000", []);
  assert.equal(r.code, "NOT_ELIGIBLE");
  assert.equal(copiesOf(db, B, PLATA), 4);
});

/* ═══════════════════ objetivos, proyectos, panel ═══════════════════ */

test("F79 F11 · objetivo con recompensa: 10 reclamos a la vez → UNA recompensa por periodo", async () => {
  const db = fresh();
  const cfg = activeCfg();
  cfg.objectives = [{ id: "obj-test", name: "Una forja hoy", period: "DAILY", metric: "CRAFT_ANY", target: 1, reward: { credits: 100 }, status: "ACTIVE" }];
  await publish(db, cfg);
  db.table("user_packs").push({ user_id: A, pack_id: "estandar", qty: 4 });
  const before = credits(db, A);
  const early = await claimObjective(db.client, A, "obj-test");
  assert.equal(early.code, "NOT_COMPLETED");
  assert.ok((await craftPack(db.client, A, "pack-estandar-premium", "gesto-f11-000000")).ok);
  const rs = await Promise.all(Array.from({ length: 10 }, () => claimObjective(db.client, A, "obj-test")));
  assert.ok(rs.every((r) => r.ok), rs.find((r) => !r.ok)?.error);
  assert.equal(credits(db, A) - before, 100);
  assert.equal(rs.filter((r) => !r.data!.repeated).length, 1);
});

test("F79 F12 · proyecto 2.0: el servidor exige «reúne» antes de pagar; sin extras, igual que F73", async () => {
  const db = fresh();
  const target = of("masters")[0].id;
  db.table("content_card_projects").push({ id: "proj-f79", name: "Proyecto F79", description: "", target_card_id: target, status: "ACTIVE", sort_order: 0, version: 1 });
  db.table("content_missions").push({ id: "mis-f79", name: "Abre un sobre", description: "", condition: { type: "OPEN_PACK" }, target: 1, depends_on: [], reward: {}, project_id: "proj-f79", status: "ACTIVE", sort_order: 0, version: 1 });
  db.table("user_mission_progress").push({ user_id: A, mission_id: "mis-f79", progress: 1, completed_at: new Date().toISOString(), claimed_at: null });
  const cfg = activeCfg();
  cfg.projects = [{ projectId: "proj-f79", own: [{ type: "OWN_DISTINCT_PLAYERS", min: 2 }], fabricateRecipeId: null }];
  await publish(db, cfg);
  const blocked = await claimProject(db.client, A, "proj-f79");
  assert.equal(blocked.code, "PROJECT_REQUIREMENTS");
  assert.equal(copiesOf(db, A, target), 0, "no se pagó");
  const st = (await getForgeState(db.client, A)).data!.projects.find((p) => p.id === "proj-f79")!;
  assert.deepEqual(st.stages.map((s) => s.kind), ["MISSIONS", "OWN", "CLAIM"]);
  give(db, A, of("base")[0].id, 1); give(db, A, of("base")[5].id, 1);
  const ok = await claimProject(db.client, A, "proj-f79");
  assert.ok(ok.ok, ok.error); assert.equal(copiesOf(db, A, target), 1);
});

test("F79 F13 · panel: versión optimista, validación, espejo DISABLED para DRAFT, auditoría; F73 no edita forge-…", async () => {
  const db = fresh();
  const stale = await saveForgeConfig(db.client, ADMIN, { doc: DEFAULT_FORGE_CONFIG, expectedVersion: 7 });
  assert.equal(stale.ok, false); assert.equal((stale as { status: number }).status, 409);
  const bad = await saveForgeConfig(db.client, ADMIN, { doc: { ...DEFAULT_FORGE_CONFIG, curve: { base: 100, growth: 9, maxLevel: 40 } }, expectedVersion: 0 });
  assert.equal((bad as { status: number }).status, 422);
  const ok1 = await saveForgeConfig(db.client, ADMIN, { doc: DEFAULT_FORGE_CONFIG, expectedVersion: 0, reason: "primera" });
  assert.ok(ok1.ok);
  const mirror = db.table("craft_recipes").filter((r) => String(r.id).startsWith("forge-"));
  assert.equal(mirror.length, 3); assert.ok(mirror.every((r) => r.status === "DISABLED" && r.kind === "CARD"), "DRAFT → espejo DISABLED: la RPC lo rechaza");
  assert.equal(mirror.find((r) => r.id === "forge-ruta-oro")!.input_qty, 4);
  assert.ok(db.table("content_audit_log").some((a) => a.action === "f79_forge_config_save"));
  const doc = (db.table("forge_config")[0].doc as ForgeConfig);
  assert.ok(doc.objectives.every((x) => (x.activeWindows ?? []).length === 0), "en DRAFT no hay ventana");
  const t0 = Date.now();
  const act = await saveForgeConfig(db.client, ADMIN, { doc: { ...DEFAULT_FORGE_CONFIG, objectives: DEFAULT_FORGE_CONFIG.objectives.map((x) => ({ ...x, status: "ACTIVE", activeWindows: [{ from: 1, to: null }] })) }, expectedVersion: 1 });
  assert.ok(act.ok);
  const stamped = (db.table("forge_config")[0].doc as ForgeConfig).objectives;
  assert.ok(stamped.every((x) => x.activeWindows!.length === 1 && x.activeWindows![0].from >= t0 && x.activeWindows![0].to === null), "el SERVIDOR sella la activación (el panel no puede adelantarla a 1970)");
  const twice = await saveForgeConfig(db.client, ADMIN, { doc: DEFAULT_FORGE_CONFIG, expectedVersion: 0 });
  assert.equal((twice as { status: number }).status, 409, "doble guardado con la misma versión: uno gana");
  const f73 = await saveRecipe(db.client, ADMIN, { id: "forge-ruta-oro", patch: { status: "ACTIVE" }, expectedVersion: 1 });
  assert.equal((f73 as { status: number }).status, 409, "las forge-… solo desde la Forja");
});

test("F79 F13b · /api/admin/cms/forge: anónimo y usuario normal 401 (sin oráculo); admin lee y guarda", async () => {
  const db = fresh();
  const deps: AdminDeps = { verify: async (req) => (req.headers.get("authorization") === "Bearer admin" ? { userId: ADMIN } : null), db: () => db.client };
  const h = forgeCmsHandlers(deps);
  const req = (who: string, body?: unknown) => new Request("http://t/api/admin/cms/forge", body === undefined ? { headers: who ? { authorization: `Bearer ${who}` } : {} } : { method: "POST", headers: { ...(who ? { authorization: `Bearer ${who}` } : {}), "content-type": "application/json" }, body: JSON.stringify(body) });
  for (const who of ["", "user"]) {
    const g = await h.GET(req(who)); assert.equal(g.status, 401); assert.deepEqual(await g.json(), { error: "No autorizado" });
    const p = await h.POST(req(who, { action: "save", doc: DEFAULT_FORGE_CONFIG, expectedVersion: 0 })); assert.equal(p.status, 401);
  }
  assert.equal(db.table("forge_config").length, 0, "nada escrito por quien no es admin");
  const g = await h.GET(req("admin")); assert.equal(g.status, 200);
  const view = (await g.json()) as { version: number; problems: unknown[] };
  assert.equal(view.version, 0); assert.deepEqual(view.problems, []);
  const extra = await h.POST(req("admin", { action: "save", doc: DEFAULT_FORGE_CONFIG, expectedVersion: 0, userId: A }));
  assert.equal(extra.status, 400, "campo fuera de la lista blanca");
  const p = await h.POST(req("admin", { action: "save", doc: DEFAULT_FORGE_CONFIG, expectedVersion: 0, reason: "alta" }));
  assert.equal(p.status, 200);
});

test("F79 F14 · contrato de la ruta: lista blanca sin autoridad (XP, nivel, progreso, salida, recompensa) y solo service_role", () => {
  const route = readFileSync(join(process.cwd(), "src/app/api/game/forge/route.ts"), "utf8");
  assert.ok(route.includes('new Set(["action", "recipeId", "uids", "ref", "confirmProtected", "objectiveId", "achievementId"])'));
  const allowed = route.match(/new Set\(\[([^\]]+)\]\)/)![1];
  for (const f of ["xp", "level", "progress", "cardId", "output", "reward", "qty", "userId", "unlock", "blueprint"]) assert.ok(!new RegExp(`"${f}"`).test(allowed), `el cliente no manda ${f}`);
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/0061_forge_progression.sql"), "utf8");
  assert.ok(/revoke all on public\.forge_config from public, anon, authenticated/.test(sql));
  assert.ok(/grant execute on function public\.app_craft_card\([^)]*\) to service_role/.test(sql));
  assert.ok(/grant execute on function public\.app_craft_card_guarded\([^)]*\) to service_role/.test(sql));
  assert.ok(/grant execute on function public\.app_salvage_cards_guarded\([^)]*\) to service_role/.test(sql));
  assert.ok(!/grant[^;]*to (public|anon|authenticated)/i.test(sql.replace(/--.*$/gm, "")), "nada de 0061 se concede al navegador");
  // F79.1 · la guardia de la BD se serializa con las favoritas usando EL MISMO cerrojo que el disparador de 0052.
  const fav = readFileSync(join(process.cwd(), "supabase/migrations/0052_collection_favorites.sql"), "utf8");
  const key = "hashtextextended('user_card_favorites:' || ";
  assert.ok(fav.includes(key + "new.user_id::text, 0)") && sql.includes(key + "p_user::text, 0)"), "mismo cerrojo consultivo que 0052");
  assert.ok(!/\bbegin;|\bcommit;/i.test(sql.replace(/--.*$/gm, "")), "el fichero no abre ni cierra transacción (la pone el operador)");
});
