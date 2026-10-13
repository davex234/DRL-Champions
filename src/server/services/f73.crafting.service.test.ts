/**
 * F73 · CRAFTEO, MISIONES Y PROYECTOS en los servicios REALES sobre MemSupabase (cada RPC es atómica y se revierte si
 * lanza, como la transacción de Postgres; el `await` entre leer y escribir es el hueco real de producción).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { CARDS, getCard } from "@/data/catalog";
import { DUEL_ROLES } from "@/domain/cardgame";
import { packCardClass } from "@/domain/packs/packClass";
import { MemSupabase } from "./testing/memSupabase";
import { craftCard, craftPack, getCraftingState } from "./crafting";
import { claimMission, claimProject, getMissionsState, ingestEvent } from "./missionEngine";
import { isMissingRelation, loadF73Config, resetF73Cache } from "./f73Config";
import { openPackForUser } from "./packs";
import { startMatch, playTurn, getMatch } from "./duels";
import { createPvpMatch, applyPvpAction, syncPvpMatch } from "./duelsPvp";
import type { MatchEvent } from "@/domain/missionEngine/types";

const A = "aaaaaaaa-0000-4000-8000-0000000073aa";
const B = "bbbbbbbb-0000-4000-8000-0000000073bb";

/** Las recetas de la migración 0059, tal cual (mismas filas que se sembrarán). */
function seedRecipes(db: MemSupabase) {
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/0059_crafting_missions.sql"), "utf8");
  const v = (s: string) => (s === "null" ? null : s.slice(1, -1));
  for (const m of sql.matchAll(/\('([a-z0-9-]+)',\s*'(PACK|CARD)',\s*'([^']+)',\s*(null|'[a-z]+'),\s*(null|'[a-z]+'),\s*(null|'[a-z]+'),\s*(null|'[a-z]+'),\s*(\d+),\s*'(ACTIVE|DISABLED)',\s*(\d+)\)/g)) {
    db.table("craft_recipes").push({ id: m[1], kind: m[2], name: m[3], input_pack_id: v(m[4]), output_pack_id: v(m[5]), input_class: v(m[6]), output_class: v(m[7]), input_qty: Number(m[8]), status: m[9], sort_order: Number(m[10]), available_from: null, available_to: null, version: 1 });
  }
}
function fresh(): MemSupabase {
  resetF73Cache();
  const db = new MemSupabase();
  for (const u of [A, B]) db.table("profiles").push({ id: u, username: u.slice(0, 6), credits: 10_000, xp: 0, level: 1, points: 0 });
  seedRecipes(db);
  return db;
}
const packs = (db: MemSupabase, user: string, packId: string, qty: number) => db.table("user_packs").push({ user_id: user, pack_id: packId, qty });
const qty = (db: MemSupabase, user: string, packId: string) => Number(db.table("user_packs").find((r) => r.user_id === user && r.pack_id === packId)?.qty ?? 0);
function giveCopies(db: MemSupabase, user: string, cardId: string, n: number): string[] {
  return Array.from({ length: n }, () => { const uid = randomUUID(); db.table("user_cards").push({ uid, user_id: user, card_id: cardId, serial: null, origin: "pack", locked: false, obtained_at: new Date(0).toISOString() }); return uid; });
}
const basics = CARDS.filter((c) => packCardClass(c) === "base");

/* ═══════════════════ SOBRES ═══════════════════ */

test("F73 P1 · inventario insuficiente → rechazo y nada cambia", async () => {
  const db = fresh(); packs(db, A, "estandar", 3);
  const r = await craftPack(db.client, A, "pack-estandar-premium", "gesto-p1-00000000");
  assert.equal(r.ok, false); assert.equal(r.status, 409); assert.equal(r.code, "INSUFFICIENT_PACKS");
  assert.equal(qty(db, A, "estandar"), 3); assert.equal(qty(db, A, "premium"), 0);
});

test("F73 P2 · inventario exacto → consume X, entrega 1, lo audita en economy_ops y devuelve el inventario del servidor", async () => {
  const db = fresh(); packs(db, A, "estandar", 4);
  const r = await craftPack(db.client, A, "pack-estandar-premium", "gesto-p2-00000000");
  assert.ok(r.ok, r.error);
  assert.deepEqual(r.data!.inventory, { estandar: 0, premium: 1 });
  assert.equal(qty(db, A, "estandar"), 0); assert.equal(qty(db, A, "premium"), 1);
  const op = db.table("economy_ops").find((o) => o.kind === "craft_pack")!;
  assert.equal(op.user_id, A);
  assert.equal(op.ref, `craft:pack:${A}:gesto-p2-00000000`);
  assert.deepEqual((op.result as { inputs: unknown }).inputs, [{ packId: "estandar", qty: 4 }]);
});

test("F73 P3+P4 · doble clic (misma ref a la vez) y F5 (reintento): UNA operación", async () => {
  const db = fresh(); packs(db, A, "estandar", 8);
  const [r1, r2] = await Promise.all([craftPack(db.client, A, "pack-estandar-premium", "gesto-dbl-0000000"), craftPack(db.client, A, "pack-estandar-premium", "gesto-dbl-0000000")]);
  assert.ok(r1.ok && r2.ok);
  const again = await craftPack(db.client, A, "pack-estandar-premium", "gesto-dbl-0000000");
  assert.equal(again.data!.repeated, true);
  assert.equal(qty(db, A, "estandar"), 4, "se consumieron 4, no 8 ni 12");
  assert.equal(qty(db, A, "premium"), 1);
  assert.equal(db.table("economy_ops").filter((o) => o.kind === "craft_pack").length, 1);
});

test("F73 P5+P6 · dos pestañas / diez peticiones distintas con inventario para UNA → exactamente una; nunca negativo", async () => {
  const db = fresh(); packs(db, A, "estandar", 4);
  const rs = await Promise.all(Array.from({ length: 10 }, (_, i) => craftPack(db.client, A, "pack-estandar-premium", `gesto-par-${String(i).padStart(8, "0")}`)));
  assert.equal(rs.filter((r) => r.ok).length, 1);
  assert.ok(rs.filter((r) => !r.ok).every((r) => r.code === "INSUFFICIENT_PACKS"));
  assert.equal(qty(db, A, "estandar"), 0); assert.equal(qty(db, A, "premium"), 1);
});

test("F73 P7+P8 · receta desactivada o inexistente → rechazo", async () => {
  const db = fresh(); packs(db, A, "estandar", 10);
  db.table("craft_recipes").find((r) => r.id === "pack-estandar-premium")!.status = "DISABLED"; resetF73Cache();
  assert.equal((await craftPack(db.client, A, "pack-estandar-premium", "gesto-p7-00000000")).code, "RECIPE_DISABLED");
  assert.equal((await craftPack(db.client, A, "no-existe", "gesto-p8-00000000")).status, 404);
  assert.equal(qty(db, A, "estandar"), 10);
});

test("F73 AI · APERTURA + CRAFTEO del mismo sobre a la vez: nunca se gasta un sobre dos veces", async () => {
  const db = fresh(); packs(db, A, "estandar", 4);
  const [open, craft] = await Promise.all([openPackForUser(db.client, A, "estandar", "open-race-000000"), craftPack(db.client, A, "pack-estandar-premium", "gesto-race-0000000")]);
  assert.equal(Number(open.ok) + Number(craft.ok), 1, "una de las dos, no las dos");
  assert.ok(qty(db, A, "estandar") >= 0);
  assert.equal(qty(db, A, "estandar"), open.ok ? 3 : 0);
});

/* ═══════════════════ CARTAS ═══════════════════ */

test("F73 C1+C5+C7 · intercambio válido: consume 7 duplicados Base, entrega 1 Plata del pool PUBLICADO, persiste y audita", async () => {
  const db = fresh();
  const [x, y] = basics;
  const ux = giveCopies(db, A, x.id, 5), uy = giveCopies(db, A, y.id, 4);
  const pick = [...ux.slice(0, 4), ...uy.slice(0, 3)];
  const r = await craftCard(db.client, A, "card-base-plata", pick, "gesto-c1-00000000");
  assert.ok(r.ok, r.error);
  const out = r.data!.outputs[0];
  assert.equal(packCardClass(getCard(out.cardId)!), "plata");
  const mine = db.table("user_cards").filter((c) => c.user_id === A);
  assert.equal(mine.filter((c) => c.card_id === x.id).length, 1, "de 5 quedan 1");
  assert.equal(mine.filter((c) => c.card_id === y.id).length, 1);
  assert.equal(mine.find((c) => c.uid === out.uid)?.origin, "craft");
  assert.equal(db.table("economy_ops").filter((o) => o.kind === "craft_card").length, 1);
});

test("F73 C2+AA · cartas que no posees (de otro usuario) → rechazo; B no pierde nada", async () => {
  const db = fresh();
  const theirs = giveCopies(db, B, basics[0].id, 8);
  const r = await craftCard(db.client, A, "card-base-plata", theirs.slice(0, 7), "gesto-c2-00000000");
  assert.equal(r.ok, false); assert.equal(r.code, "NOT_ELIGIBLE");
  assert.equal(db.table("user_cards").filter((c) => c.user_id === B).length, 8);
});

test("F73 C3 · la misma copia dos veces → rechazo", async () => {
  const db = fresh();
  const u = giveCopies(db, A, basics[0].id, 9);
  const r = await craftCard(db.client, A, "card-base-plata", [u[0], u[0], ...u.slice(1, 6)], "gesto-c3-00000000");
  assert.equal(r.code, "DUPLICATE_INPUT");
});

test("F73 C · la última copia, una bloqueada o una de un equipo no se pueden entregar", async () => {
  const db = fresh();
  const u = giveCopies(db, A, basics[0].id, 7); // 7 copias → 6 entregables: pedir 7 = última copia
  assert.equal((await craftCard(db.client, A, "card-base-plata", u, "gesto-last-0000000")).code, "LAST_COPY");
  const w = giveCopies(db, A, basics[1].id, 10);
  db.table("duel_decks").push({ id: randomUUID(), user_id: A, name: "Eq", card_uids: [w[0]], created_at: new Date(0).toISOString(), updated_at: new Date(0).toISOString() });
  db.table("user_cards").find((c) => c.uid === w[1])!.locked = true;
  assert.equal((await craftCard(db.client, A, "card-base-plata", w.slice(0, 7), "gesto-deck-0000000")).code, "NOT_ELIGIBLE");
  const ok = await craftCard(db.client, A, "card-base-plata", w.slice(2, 9), "gesto-free-0000000");
  assert.ok(ok.ok, ok.error);
  assert.ok(db.table("user_cards").some((c) => c.uid === w[0]), "la del equipo sigue ahí");
});

test("F73 C4+AH · DESGUACE + CRAFTEO de la misma copia a la vez: solo una operación la consume", async () => {
  const db = fresh();
  const u = giveCopies(db, A, basics[0].id, 10);
  const [salv, craft] = await Promise.all([
    db.client.rpc("app_salvage_cards", { p_user: A, p_uids: [u[0]], p_total: 5, p_ref: "salvage-race-1" }),
    craftCard(db.client, A, "card-base-plata", u.slice(0, 7), "gesto-c4-00000000"),
  ]);
  const salvOk = !salv.error, craftOk = craft.ok;
  assert.equal(Number(salvOk) + Number(craftOk), 1, "la copia u[0] solo se consume una vez");
  assert.equal(db.table("user_cards").some((c) => c.uid === u[0]), false);
});

test("F73 C6+C8 · la salida la decide el servidor; el mismo gesto devuelve la MISMA carta (idempotente)", async () => {
  const db = fresh();
  const u = giveCopies(db, A, basics[0].id, 20);
  const r1 = await craftCard(db.client, A, "card-base-plata", u.slice(0, 7), "gesto-c8-00000000");
  const r2 = await craftCard(db.client, A, "card-base-plata", u.slice(7, 14), "gesto-c8-00000000");
  assert.ok(r1.ok && r2.ok);
  assert.equal(r2.data!.repeated, true);
  assert.deepEqual(r2.data!.outputs, r1.data!.outputs, "misma carta, sin volver a sortear ni consumir");
  assert.equal(db.table("user_cards").filter((c) => c.user_id === A && c.card_id === basics[0].id).length, 13);
  const src = readFileSync(join(process.cwd(), "src/app/api/game/crafting/route.ts"), "utf8");
  assert.ok(src.includes('new Set(["action", "recipeId", "uids", "ref", "expectedQty"])'), "el cliente no puede mandar la carta, el OVR ni la semilla");
});

test("F73 · estado: entregables y recetas coherentes con el inventario (lo que ve el cliente lo decide el servidor)", async () => {
  const db = fresh(); packs(db, A, "estandar", 5); giveCopies(db, A, basics[0].id, 4);
  const s = await getCraftingState(db.client, A);
  assert.ok(s.ok && s.data!.available);
  const pr = s.data!.packRecipes.find((r) => r.id === "pack-estandar-premium")!;
  assert.deepEqual([pr.have, pr.inputQty, pr.canCraft], [5, 4, true]);
  const cr = s.data!.cardRecipes.find((r) => r.id === "card-base-plata")!;
  assert.deepEqual([cr.available, cr.canCraft], [3, false]);
  assert.ok(!s.data!.cardRecipes.some((r) => r.id === "card-prime-icon"), "la desactivada no se ofrece");
});

test("F73 · sin la migración 0059 → no disponible (nunca rompe)", async () => {
  resetF73Cache();
  const broken = { from: () => ({ select: async () => ({ data: null, error: { code: "42P01", message: 'relation "craft_recipes" does not exist' } }) }) } as never;
  const cfg = await loadF73Config(broken, { fresh: true });
  assert.deepEqual([cfg.available, cfg.reason], [false, "MIGRATION_PENDING"]);
  assert.ok(isMissingRelation({ code: "PGRST205", message: "Could not find the table" }));
  resetF73Cache();
});

/* ═══════════════════ MISIONES ═══════════════════ */

function mission(db: MemSupabase, id: string, condition: Record<string, unknown>, target: number, over: Record<string, unknown> = {}) {
  db.table("content_missions").push({ id, project_id: null, name: `Misión ${id}`, description: "", condition, target, depends_on: [], reward: {}, status: "ACTIVE", sort_order: 0, available_from: null, available_to: null, version: 1, ...over });
  resetF73Cache();
}
const matchEv = (key: string, over: Partial<MatchEvent> = {}): MatchEvent => ({ kind: "MATCH", key, mode: "PVE", difficulty: "NORMAL", won: true, draw: false, finished: true, turnsWon: 6, humanDecisions: 10, autoDecisions: 0,
  deck: Array.from({ length: 10 }, (_, i) => ({ cardId: `c${i}`, playerId: `p${i}`, team: i < 3 ? "fnatic" : `t${i}`, country: i < 3 ? "KR" : `X${i}`, role: "Duelista" })), ...over });
const prog = (db: MemSupabase, user: string, id: string) => db.table("user_mission_progress").find((r) => r.user_id === user && r.mission_id === id);

test("F73 M1+M2+M9 · un evento suma; el mismo evento repetido (F5, sondeos, dos pestañas) no; completada no sigue", async () => {
  const db = fresh(); mission(db, "win-2", { type: "MATCH_WIN" }, 2);
  await ingestEvent(db.client, A, matchEv("match:1"));
  await Promise.all(Array.from({ length: 10 }, () => ingestEvent(db.client, A, matchEv("match:1"))));
  assert.equal(prog(db, A, "win-2")!.progress, 1);
  await ingestEvent(db.client, A, matchEv("match:2"));
  await ingestEvent(db.client, A, matchEv("match:3"));
  assert.equal(prog(db, A, "win-2")!.progress, 2);
  assert.ok(prog(db, A, "win-2")!.completed_at);
});

test("F73 M3..M8 · plantilla, mismo equipo/país, jugador, modo y ANTI-AFK sobre el servidor", async () => {
  const db = fresh();
  mission(db, "team3", { type: "WIN_WITH_TEAM_COUNT", min: 3 }, 5);
  mission(db, "team4", { type: "WIN_WITH_TEAM_COUNT", min: 4 }, 5);
  mission(db, "kr3", { type: "WIN_WITH_COUNTRY_COUNT", min: 3 }, 5);
  mission(db, "p2", { type: "WIN_WITH_PLAYER", playerId: "p2" }, 5);
  mission(db, "pve", { type: "WIN_PVE" }, 5);
  await ingestEvent(db.client, A, matchEv("match:a"));
  await ingestEvent(db.client, A, matchEv("match:b", { mode: "RANKED", difficulty: null }));
  await ingestEvent(db.client, A, matchEv("match:c", { humanDecisions: 3, autoDecisions: 7 }));
  await ingestEvent(db.client, A, matchEv("match:d", { mode: "PRIVATE", difficulty: null }));
  assert.equal(prog(db, A, "team3")!.progress, 2, "a y b (c es AFK, d privada)");
  assert.equal(prog(db, A, "team4"), undefined, "no cumple el mínimo: ni se crea progreso");
  assert.equal(prog(db, A, "kr3")!.progress, 2);
  assert.equal(prog(db, A, "p2")!.progress, 2);
  assert.equal(prog(db, A, "pve")!.progress, 1, "solo la PvE");
  const evs = db.table("mission_events").filter((e) => e.user_id === A);
  assert.equal(evs.length, 4, "los cuatro eventos quedan registrados (evidencia)");
  assert.equal((evs.find((e) => e.event_key === "match:c")!.evidence as { counts: boolean }).counts, false);
});

test("F73 M10 · reclamar: diez reclamos simultáneos → UNA recompensa; incompleta no se reclama", async () => {
  const db = fresh(); mission(db, "open1", { type: "OPEN_PACK" }, 1, { reward: { credits: 500, packId: "estandar", packCount: 1 } });
  assert.equal((await claimMission(db.client, A, "open1")).code, "NOT_COMPLETED");
  await ingestEvent(db.client, A, { kind: "OPEN_PACK", key: "pack:open:x", packId: "estandar" });
  const before = Number(db.table("profiles").find((p) => p.id === A)!.credits);
  const rs = await Promise.all(Array.from({ length: 10 }, () => claimMission(db.client, A, "open1")));
  assert.ok(rs.every((r) => r.ok));
  assert.equal(Number(db.table("profiles").find((p) => p.id === A)!.credits), before + 500);
  assert.equal(qty(db, A, "estandar"), 1);
  assert.equal(db.table("credit_transactions").filter((t) => t.ref === "m73:mission:open1").length, 1);
  const st = await getMissionsState(db.client, A);
  assert.equal(st.data!.missions.find((m) => m.id === "open1")!.state, "CLAIMED");
});

test("F73 · racha: gana, gana, pierde → reinicia; dependencias: B no avanza hasta completar A", async () => {
  const db = fresh();
  mission(db, "streak3", { type: "WIN_STREAK" }, 3);
  mission(db, "a", { type: "MATCH_PLAY" }, 1);
  mission(db, "b", { type: "MATCH_PLAY" }, 2, { depends_on: ["a"] });
  await ingestEvent(db.client, A, matchEv("match:s1"));
  assert.equal(prog(db, A, "b"), undefined, "b estaba bloqueada al llegar s1 (a aún no completa): s1 no le cuenta");
  await ingestEvent(db.client, A, matchEv("match:s2"));
  assert.equal(prog(db, A, "streak3")!.progress, 2);
  assert.equal(prog(db, A, "b")!.progress, 1, "a se completó en s1: b cuenta desde s2");
  await ingestEvent(db.client, A, matchEv("match:s3", { won: false }));
  assert.equal(prog(db, A, "streak3")!.progress, 0, "perder reinicia la racha");
  assert.equal(prog(db, A, "b")!.progress, 2, "jugar (aunque se pierda) cuenta para MATCH_PLAY");
});

/* ═══════════════════ PROYECTOS ═══════════════════ */

function project(db: MemSupabase, id: string, target: string, missions: [string, string][]) {
  db.table("content_card_projects").push({ id, name: `Proyecto ${id}`, description: "", target_card_id: target, status: "ACTIVE", sort_order: 0, available_from: null, available_to: null, version: 1 });
  for (const [m, type] of missions) mission(db, m, { type }, 1, { project_id: id });
  resetF73Cache();
}

test("F73 J1..J6 · proyecto: incompleto no reclama; completo entrega SU carta una vez (10 a la vez); otro usuario no; F5 mantiene", async () => {
  const db = fresh();
  const target = CARDS.find((c) => packCardClass(c) === "prime")!.id;
  project(db, "pj", target, [["pj-1", "OPEN_PACK"], ["pj-2", "CRAFT_PACK"]]);
  await ingestEvent(db.client, A, { kind: "OPEN_PACK", key: "k1", packId: "estandar" });
  const early = await claimProject(db.client, A, "pj");
  assert.equal(early.code, "NOT_COMPLETED", "J1: 1 de 2 misiones");
  assert.equal(db.table("user_cards").filter((c) => c.user_id === A && c.card_id === target).length, 0);
  await ingestEvent(db.client, A, { kind: "CRAFT_PACK", key: "k2", packId: "premium" });
  const st = await getMissionsState(db.client, A);
  assert.equal(st.data!.projects[0].state, "COMPLETED", "2 de 2");
  const rs = await Promise.all(Array.from({ length: 10 }, () => claimProject(db.client, A, "pj")));
  assert.ok(rs.every((r) => r.ok), "J2");
  assert.equal(db.table("user_cards").filter((c) => c.user_id === A && c.card_id === target).length, 1, "J3: una sola copia");
  assert.ok(rs.every((r) => r.data!.cardId === target), "J4: la carta configurada");
  assert.equal((await claimProject(db.client, B, "pj")).code, "NOT_COMPLETED", "J5: B no puede reclamar el progreso de A");
  const again = await getMissionsState(db.client, A);
  assert.equal(again.data!.projects[0].state, "CLAIMED", "J6");
});

test("F73 · proyecto con carta inexistente → rechazo (nunca se inventa una carta)", async () => {
  const db = fresh(); project(db, "bad", "no__existe", [["bad-1", "OPEN_PACK"]]);
  await ingestEvent(db.client, A, { kind: "OPEN_PACK", key: "k2", packId: "estandar" });
  assert.equal((await claimProject(db.client, A, "bad")).code, "INVALID_PROJECT");
});

/* ═══════════════════ ENGANCHES REALES DE PARTIDA ═══════════════════ */

function giveDeck(db: MemSupabase, user: string, offset: number): string {
  const used = new Set<string>(); const team: string[] = [];
  for (const role of DUEL_ROLES) {
    let n = 0, skip = offset;
    for (const c of CARDS.filter((x) => x.combat && (x.role) === role)) {
      if (n === 2) break; if (used.has(c.playerId)) continue; if (skip-- > 0) continue;
      used.add(c.playerId); n++; team.push(...giveCopies(db, user, c.id, 1));
    }
  }
  const id = randomUUID();
  db.table("duel_decks").push({ id, user_id: user, name: "Equipo", card_uids: team, created_at: new Date(0).toISOString(), updated_at: new Date(0).toISOString() });
  return id;
}

// DUEL GAMEPLAY UX 2.0 · contra un bot ya no hay reloj: una partida PvE no puede terminar «sola» (AFK). La parte AFK de
// este test pasa a comprobar que una partida desatendida, por mucho tiempo que pase, ni termina ni suma.
test("F73 · PvE real: una partida jugada por la persona suma UNA vez; una partida desatendida no avanza ni suma", async () => {
  const db = fresh(); mission(db, "play", { type: "MATCH_PLAY" }, 5);
  const deck = giveDeck(db, A, 0);
  // Jugada por la persona.
  let v = (await startMatch(db.client, A, deck, "NORMAL")).data!.view;
  for (let i = 0; i < 12 && v.status === "IN_PROGRESS"; i++) {
    const r = await playTurn(db.client, A, v.matchId, v.yourHand[0].uid, v.youAreAttacker ? "stronghold" : undefined, v.stateVersion);
    assert.ok(r.ok, r.error); v = r.data!.view;
  }
  assert.notEqual(v.status, "IN_PROGRESS");
  assert.equal(prog(db, A, "play")!.progress, 1);
  await getMatch(db.client, A, v.matchId);
  assert.equal(prog(db, A, "play")!.progress, 1, "leerla otra vez no la cuenta dos veces");
  // Desatendida: incluso con un plazo heredado vencido, leerla no juega nada por la persona.
  let w = (await startMatch(db.client, A, deck, "NORMAL")).data!.view;
  for (let i = 0; i < 12; i++) {
    db.table("duel_matches").find((r) => r.id === w.matchId)!.turn_deadline_at = new Date(Date.now() - 600_000).toISOString();
    w = (await getMatch(db.client, A, w.matchId)).data!.view;
  }
  assert.equal(w.status, "IN_PROGRESS", "sin reloj contra el bot: sigue esperando a la persona");
  assert.equal(w.yourUsed.length, 0);
  assert.equal(prog(db, A, "play")!.progress, 1, "una partida sin terminar no cuenta");
  const evs = db.table("mission_events").filter((e) => e.user_id === A);
  assert.equal(evs.length, 1, `solo la partida jugada queda registrada (eventos: ${JSON.stringify(evs.map((e) => [e.event_key, e.evidence]))})`);
});

test("F73 · PvP real: una partida ranked terminada suma a LOS DOS jugadores, una vez", async () => {
  const db = fresh(); mission(db, "play", { type: "MATCH_PLAY" }, 5);
  const da = giveDeck(db, A, 0), dbk = giveDeck(db, B, 3);
  const c = await createPvpMatch(db.client, { playerId: A, deckId: da }, { playerId: B, deckId: dbk }, { turnMs: null });
  const id = c.data!.view.matchId;
  Object.assign(db.table("duel_matches").find((r) => r.id === id)!, { closed_reason: null, closed_by: null, closed_at: null });
  for (let i = 0; i < 25; i++) {
    const s = ((await syncPvpMatch(db.client, A, id)).data as unknown as { snapshot: { expectedSide: "A" | "B" | null; lifecycle: string } }).snapshot;
    if (s.lifecycle !== "IN_TURN") break;
    const who = s.expectedSide === "A" ? A : B;
    const me = ((await syncPvpMatch(db.client, who, id)).data as unknown as { snapshot: { stateVersion: number; yourSide: "A" | "B"; match: { snapshotA: { cards: { uid: string }[] }; snapshotB: { cards: { uid: string }[] }; usedA: string[]; usedB: string[]; attacker: string } } }).snapshot;
    const hand = (me.yourSide === "A" ? me.match.snapshotA : me.match.snapshotB).cards.filter((x) => !(me.yourSide === "A" ? me.match.usedA : me.match.usedB).includes(x.uid));
    const r = await applyPvpAction(db.client, id, { actionId: randomUUID(), expectedVersion: me.stateVersion, playerId: who, cardUid: hand[0].uid, stat: me.match.attacker === me.yourSide ? "stronghold" : undefined });
    assert.ok(r.ok, r.error);
  }
  assert.equal(prog(db, A, "play")!.progress, 1);
  assert.equal(prog(db, B, "play")!.progress, 1);
  await syncPvpMatch(db.client, A, id); await syncPvpMatch(db.client, B, id);
  assert.equal(prog(db, A, "play")!.progress, 1, "los sondeos posteriores no la vuelven a contar");
});
