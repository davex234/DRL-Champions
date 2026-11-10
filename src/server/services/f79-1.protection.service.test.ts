/**
 * F79.1 · CARTA PROTEGIDA en TODAS las rutas que destruyen copias (desguace, intercambio F73, forja avanzada) + intentos
 * de saltarse el selector con cuerpos hechos a mano + política de cambios de progresión del panel. Servicios REALES
 * sobre MemSupabase (las RPC guardadas emulan 0061 con la misma regla).
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
import { forgeCraft } from "./forge";
import { previewSalvage, salvageCards } from "./economy";
import { getForgeAdmin, previewForgeChange, saveForgeConfig } from "@/server/cms/forge";

const A = "aaaaaaaa-0000-4000-8000-00000079a1aa";
const B = "bbbbbbbb-0000-4000-8000-00000079a1bb";
const ADMIN = "cccccccc-0000-4000-8000-00000079a1cc";

function fresh(): MemSupabase {
  resetF73Cache(); resetForgeConfigCache();
  const db = new MemSupabase();
  for (const u of [A, B]) db.table("profiles").push({ id: u, username: u.slice(0, 6), credits: 10_000, xp: 0, level: 1, points: 0, is_admin: false });
  db.table("profiles").push({ id: ADMIN, username: "admin", credits: 0, xp: 0, level: 1, points: 0, is_admin: true });
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/0059_crafting_missions.sql"), "utf8");
  const v = (s: string) => (s === "null" ? null : s.slice(1, -1));
  for (const m of sql.matchAll(/\('([a-z0-9-]+)',\s*'(PACK|CARD)',\s*'([^']+)',\s*(null|'[a-z]+'),\s*(null|'[a-z]+'),\s*(null|'[a-z]+'),\s*(null|'[a-z]+'),\s*(\d+),\s*'(ACTIVE|DISABLED)',\s*(\d+)\)/g)) {
    db.table("craft_recipes").push({ id: m[1], kind: m[2], name: m[3], input_pack_id: v(m[4]), output_pack_id: v(m[5]), input_class: v(m[6]), output_class: v(m[7]), input_qty: Number(m[8]), status: m[9], sort_order: Number(m[10]), available_from: null, available_to: null, version: 1 });
  }
  return db;
}
const of = (cls: PackCardClass) => CARDS.filter((c) => packCardClass(c) === cls).sort((a, b) => a.id.localeCompare(b.id));
function give(db: MemSupabase, user: string, cardId: string, n: number, locked = false): string[] {
  return Array.from({ length: n }, () => { const uid = randomUUID(); db.table("user_cards").push({ uid, user_id: user, card_id: cardId, serial: null, origin: "pack", locked, minted_version: null, obtained_at: new Date(0).toISOString() }); return uid; }).sort();
}
const copiesOf = (db: MemSupabase, user: string, cardId: string) => db.table("user_cards").filter((c) => c.user_id === user && c.card_id === cardId).length;
const fav = (db: MemSupabase, user: string, cardId: string) => db.table("user_card_favorites").push({ user_id: user, card_id: cardId, created_at: new Date().toISOString() });
const showcase = (db: MemSupabase, user: string, uids: string[]) => db.table("player_profile_customization").push({ user_id: user, showcase_card_uids: uids, featured_achievement_ids: [], version: 1 });
const deck = (db: MemSupabase, user: string, uids: string[]) => db.table("duel_decks").push({ id: randomUUID(), user_id: user, name: "QA", card_uids: uids });
const PLATA = of("plata");
const BASE = of("base");

/* ═══════════════════ DESGUACE ═══════════════════ */

test("F79.1 S1 · desguace: los duplicados de una FAVORITA no entran en la vista previa ni en el total; aparecen aparte", async () => {
  const db = fresh();
  give(db, A, BASE[0].id, 3); fav(db, A, BASE[0].id);
  give(db, A, BASE[1].id, 2);
  const p = await previewSalvage(db.client, A);
  assert.ok(p.ok);
  assert.equal(p.data.uids.length, 1, "solo el duplicado NO protegido");
  assert.equal(p.data.protectedCopies.length, 2);
  assert.ok(p.data.protectedCopies.every((c) => c.cardId === BASE[0].id && c.protectedBy.includes("FAVORITE")));
  assert.ok(!p.data.lines.some((l) => l.cardId === BASE[0].id), "ni en el desglose ni en el total");
});

test("F79.1 S2 · desguace: elegir una protegida SIN confirmar rechaza TODO (nada se borra ni se cobra); confirmada, se desguaza", async () => {
  const db = fresh();
  const u = give(db, A, BASE[0].id, 3); fav(db, A, BASE[0].id);
  const free = give(db, A, BASE[1].id, 2);
  const credits0 = Number(db.table("profiles").find((x) => x.id === A)!.credits);
  const p = (await previewSalvage(db.client, A)) as { ok: true; data: { protectedCopies: { uid: string }[]; uids: string[] } };
  const prot = p.data.protectedCopies.map((c) => c.uid);
  const no = await salvageCards(db.client, A, [...p.data.uids, prot[0]], "salv-791-a");
  assert.equal(no.ok, false); assert.equal((no as { code?: string }).code, "PROTECTED_COPY"); assert.equal((no as { status: number }).status, 409);
  assert.equal(copiesOf(db, A, BASE[0].id), 3); assert.equal(copiesOf(db, A, BASE[1].id), 2);
  assert.equal(Number(db.table("profiles").find((x) => x.id === A)!.credits), credits0, "ni un crédito");
  const yes = await salvageCards(db.client, A, [...p.data.uids, prot[0]], "salv-791-b", [prot[0]]);
  assert.ok(yes.ok); assert.equal(yes.data.salvaged, 2);
  assert.equal(copiesOf(db, A, BASE[0].id), 2, "solo la confirmada");
  assert.ok(u.length === 3 && free.length === 2);
});

test("F79.1 S3 · desguace: la copia de la VITRINA es la que se conserva; las de un EQUIPO nunca se desguazan (ni a mano)", async () => {
  const db = fresh();
  const u = give(db, A, BASE[2].id, 3);
  showcase(db, A, [u[2]]);
  const p = (await previewSalvage(db.client, A)) as { ok: true; data: { uids: string[]; protectedCopies: unknown[] } };
  assert.deepEqual(p.data.uids.sort(), [u[0], u[1]].sort(), "se conserva la de la vitrina; las otras dos, libres");
  assert.equal(p.data.protectedCopies.length, 0);
  const d = give(db, A, BASE[3].id, 3); deck(db, A, [d[1]]);
  const p2 = (await previewSalvage(db.client, A)) as { ok: true; data: { uids: string[]; inDeck: number } };
  assert.ok(!p2.data.uids.includes(d[1]), "la del equipo no está");
  assert.ok(p2.data.uids.includes(d[0]) && p2.data.uids.includes(d[2]), "la del equipo cuenta como la que se conserva");
  const hand = await salvageCards(db.client, A, [d[1]], "salv-791-c");
  assert.equal(hand.ok, false, "pedir a mano la del equipo no la desguaza");
  assert.equal(copiesOf(db, A, BASE[3].id), 3);
  // Y la RPC guardada lo impone aunque Node se equivocara.
  const rpc = await db.client.rpc("app_salvage_cards_guarded", { p_user: A, p_uids: [d[1]], p_total: 1, p_ref: "rpc-791-deck", p_confirm: [d[1]] });
  assert.match(String(rpc.error?.message), /IN_DECK/);
  const rpc2 = await db.client.rpc("app_salvage_cards_guarded", { p_user: A, p_uids: [u[2]], p_total: 1, p_ref: "rpc-791-show", p_confirm: [] });
  assert.match(String(rpc2.error?.message), /PROTECTED_COPY/);
  assert.equal(copiesOf(db, A, BASE[2].id), 3);
});

test("F79.1 S4 · desguace: última copia y copia en venta siguen siendo absolutas (confirmar no las levanta)", async () => {
  const db = fresh();
  const [only] = give(db, A, BASE[4].id, 1); fav(db, A, BASE[4].id);
  const r = await salvageCards(db.client, A, [only], "salv-791-d", [only]);
  assert.equal(r.ok, false); assert.equal(copiesOf(db, A, BASE[4].id), 1);
  const [mine] = give(db, A, BASE[5].id, 1); const [listed] = give(db, A, BASE[5].id, 1, true);
  const rpc = await db.client.rpc("app_salvage_cards_guarded", { p_user: A, p_uids: [mine], p_total: 1, p_ref: "rpc-791-listed", p_confirm: [mine] });
  assert.match(String(rpc.error?.message), /LAST_COPY/, "la que está en venta no cuenta como la que conservas");
  assert.equal(copiesOf(db, A, BASE[5].id), 2); assert.ok(listed);
});

/* ═══════════════════ INTERCAMBIO F73 y FORJA ═══════════════════ */

test("F79.1 X1 · intercambio F73: favorita, vitrina y equipo rechazados en Node Y en la RPC guardada (confirmación vacía)", async () => {
  const db = fresh();
  const f = give(db, A, PLATA[0].id, 4); fav(db, A, PLATA[0].id);
  assert.equal((await craftCard(db.client, A, "card-plata-oro", f.slice(0, 3), "x1-a-00000000")).code, "PROTECTED_COPY");
  const s = give(db, A, PLATA[1].id, 4); showcase(db, A, [s[0]]);
  assert.equal((await craftCard(db.client, A, "card-plata-oro", s.slice(0, 3), "x1-b-00000000")).code, "PROTECTED_COPY");
  const rpc = await db.client.rpc("app_craft_card_guarded", { p_user: A, p_recipe: "card-plata-oro", p_uids: f.slice(0, 3), p_expected: Object.fromEntries(f.slice(0, 3).map((u) => [u, PLATA[0].id])), p_output_card_id: of("oro")[0].id, p_ref: "x1-rpc", p_confirm: [] });
  assert.match(String(rpc.error?.message), /PROTECTED_COPY/);
  assert.equal(copiesOf(db, A, PLATA[0].id), 4); assert.equal(copiesOf(db, A, PLATA[1].id), 4);
});

test("F79.1 X2 · cuerpos hechos a mano contra la Forja: nada que el selector no ofrezca pasa, y nada se toca", async () => {
  const db = fresh();
  const mine = give(db, A, PLATA[2].id, 5);
  const listed = give(db, A, PLATA[3].id, 2, true); give(db, A, PLATA[3].id, 2);
  const inDeck = give(db, A, PLATA[4].id, 4); deck(db, A, [inDeck[0]]);
  const theirs = give(db, B, PLATA[5].id, 4);
  const [last] = give(db, A, PLATA[6].id, 1);
  const favs = give(db, A, PLATA[7].id, 4); fav(db, A, PLATA[7].id);
  const before = db.table("user_cards").length;
  const cases: [string, string[], string[], string][] = [
    ["en venta", [listed[0], mine[0], mine[1]], [listed[0]], "NOT_ELIGIBLE"],
    ["en un equipo", [inDeck[0], mine[0], mine[1]], [inDeck[0]], "NOT_ELIGIBLE"],
    ["de otro jugador", [theirs[0], mine[0], mine[1]], [], "NOT_ELIGIBLE"],
    ["última copia", [last, mine[0], mine[1]], [last], "NOT_ELIGIBLE"],
    ["la misma dos veces", [mine[0], mine[0], mine[1]], [], "DUPLICATE_INPUT"],
    ["de menos", [mine[0], mine[1]], [], "WRONG_COUNT"],
    ["de más", [mine[0], mine[1], mine[2], mine[3]], [], "WRONG_COUNT"],
    ["favorita sin confirmar", [favs[0], favs[1], mine[0]], [], "PROTECTED_COPY"],
    ["confirmar OTRA copia no vale", [favs[0], mine[0], mine[1]], [favs[2]], "PROTECTED_COPY"],
    ["las 5 de una carta (te quedarías sin ninguna)", [mine[0], mine[1], mine[2]], [], "OK"],
  ];
  for (const [name, uids, confirm, want] of cases) {
    if (want === "OK") continue;
    const r = await forgeCraft(db.client, A, "card-plata-oro", uids, `x2-${name.length}-${uids.length}-00000`, confirm);
    assert.equal(r.ok, false, name); assert.equal(r.code, want, `${name}: ${r.code}`);
  }
  assert.equal(db.table("user_cards").length, before, "ningún intento malicioso consumió nada");
  const unknown = await forgeCraft(db.client, A, "forge-no-existe", mine.slice(0, 3), "x2-unknown-0000", []);
  assert.equal(unknown.code, "RECIPE_UNAVAILABLE");
  const viaF73 = await craftCard(db.client, A, "forge-ruta-oro", mine.slice(0, 4), "x2-f73-forge-00");
  assert.equal(viaF73.ok, false);
});

test("F79.1 X3 · proyecto: reclamarlo NO consume ninguna copia (solo entrega la carta objetivo)", async () => {
  const db = fresh();
  const target = of("masters")[0].id;
  db.table("content_card_projects").push({ id: "proj-791", name: "P", description: "", target_card_id: target, status: "ACTIVE", sort_order: 0, version: 1 });
  db.table("content_missions").push({ id: "mis-791", name: "M", description: "", condition: { type: "OPEN_PACK" }, target: 1, depends_on: [], reward: {}, project_id: "proj-791", status: "ACTIVE", sort_order: 0, version: 1 });
  db.table("user_mission_progress").push({ user_id: A, mission_id: "mis-791", progress: 1, completed_at: new Date().toISOString(), claimed_at: null });
  give(db, A, BASE[6].id, 2); fav(db, A, BASE[6].id);
  const before = db.table("user_cards").filter((c) => c.user_id === A).map((c) => c.uid).sort();
  const r = await claimProject(db.client, A, "proj-791");
  assert.ok(r.ok, r.error);
  const after = db.table("user_cards").filter((c) => c.user_id === A).map((c) => c.uid);
  assert.ok(before.every((u) => after.includes(u)), "ninguna copia desaparece");
  assert.equal(after.length, before.length + 1);
});

/* ═══════════════════ POLÍTICA DE PROGRESIÓN (panel) ═══════════════════ */

async function publish(db: MemSupabase, cfg: ForgeConfig, extra: Record<string, unknown> = {}) {
  const cur = (await getForgeAdmin(db.client)) as { data?: { version: number } };
  return saveForgeConfig(db.client, ADMIN, { doc: cfg, expectedVersion: cur.data?.version ?? 0, reason: "test", ...extra });
}

test("F79.1 M1 · una edición REGRESIVA se rechaza sin acción explícita, el impacto cuenta jugadores reales, y confirmada queda auditada", async () => {
  const db = fresh();
  assert.ok((await publish(db, DEFAULT_FORGE_CONFIG)).ok);
  db.table("user_packs").push({ user_id: A, pack_id: "estandar", qty: 20 });
  for (let i = 0; i < 5; i++) assert.ok((await craftPack(db.client, A, "pack-estandar-premium", `m1-${i}-000000`)).ok); // 100 XP → nivel 2
  const harder: ForgeConfig = { ...DEFAULT_FORGE_CONFIG, curve: { ...DEFAULT_FORGE_CONFIG.curve, base: 500 } };
  const v0 = db.table("forge_config")[0].version;
  const blocked = await publish(db, harder);
  assert.equal(blocked.ok, false); assert.equal((blocked as { status: number }).status, 409);
  assert.match((blocked as { error: string }).error, /PROGRESSION_REGRESSION/);
  assert.equal(db.table("forge_config")[0].version, v0, "no se escribió nada");
  const weak = await publish(db, harder, { confirmRegression: true, reason: "x" });
  assert.equal(weak.ok, false, "confirmar exige un motivo de verdad");
  const imp = await previewForgeChange(db.client, { doc: harder });
  assert.ok(imp.ok);
  assert.deepEqual(imp.data.impact, { players: 1, levelDrops: 1, maxDrop: 1, levelGains: 0 });
  assert.ok(imp.data.regressions.some((r) => r.code === "CURVE_HARDER"));
  const ok = await publish(db, harder, { confirmRegression: true, reason: "rebalanceo aprobado" });
  assert.ok(ok.ok, (ok as { error?: string }).error);
  const audit = db.table("content_audit_log").filter((a) => a.action === "f79_forge_progression_recalc");
  assert.equal(audit.length, 1);
  assert.deepEqual((audit[0].detail as { impact: unknown }).impact, { players: 1, levelDrops: 1, maxDrop: 1, levelGains: 0 });
});

test("F79.1 M2 · una edición MONÓTONA se guarda sin confirmar y nadie baja", async () => {
  const db = fresh();
  assert.ok((await publish(db, DEFAULT_FORGE_CONFIG)).ok);
  const softer: ForgeConfig = { ...DEFAULT_FORGE_CONFIG, xp: { ...DEFAULT_FORGE_CONFIG.xp, craftPack: 25 }, curve: { ...DEFAULT_FORGE_CONFIG.curve, base: 90 } };
  const r = await publish(db, softer);
  assert.ok(r.ok, (r as { error?: string }).error);
  assert.ok(db.table("content_audit_log").some((a) => a.action === "f79_forge_config_save"));
});
