/**
 * F82 · COLLECTION SETS — servidor, rutas y panel sobre MemorySupabase.
 *
 * `app_collection_claim` se emula con la MISMA regla que el SQL de 0062 (comprobación contra user_cards + PK
 * (usuario, set) + insignia en user_cosmetics con ON CONFLICT). La atomicidad REAL y las carreras con transacciones de
 * Postgres se prueban aparte, contra la BD (sonda BEGIN/ROLLBACK y carrera en contenedor desechable: ver informe F82).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MemorySupabase, type Row } from "./testing/memorySupabase";
import { claimSet, getTrophyRoom } from "./collectionSets";
import { setFeaturedBadges, profileBadges } from "./playerIdentity";
import { buildPlayerIdentity, type IdentityFacts } from "@/domain/profile/identity";
import { generateTeamDrafts, isSkip, type DraftProposal } from "@/domain/collectionSets/generator";
import { collectionSetsCmsHandlers } from "@/server/cms/handlers";
import { adminGenerate, adminPublish, adminUpdateDraft, adminRetire, adminListSets, adminPreview, adminNewVersion } from "@/server/cms/collectionSets";
import type { AdminDeps } from "@/server/admin/http";
import type { SupabaseClient } from "@supabase/supabase-js";

const A = "aaaaaaaa-0000-4000-8000-0000000000a1";
const B = "bbbbbbbb-0000-4000-8000-0000000000b2";
const ADMIN = "cccccccc-0000-4000-8000-0000000000c3";
const G2 = generateTeamDrafts().find((d) => !isSkip(d) && d.subjectId === "g2") as DraftProposal;
const FNC = generateTeamDrafts().find((d) => !isSkip(d) && d.subjectId === "fnatic") as DraftProposal;

function setRow(p: DraftProposal, status: "DRAFT" | "PUBLISHED" | "RETIRED" = "PUBLISHED"): Row {
  return {
    id: p.id, family: p.family, version: p.version, kind: p.kind, subject_id: p.subjectId, title: p.title, status,
    requirements: p.requirements, reward: p.reward, logo: p.logo, checksum: status === "DRAFT" ? null : "c",
    published_at: status === "DRAFT" ? null : "2026-10-03T00:00:00Z", retired_at: status === "RETIRED" ? "2026-10-03T01:00:00Z" : null, row_version: 1,
  };
}

/** Emulación de 0062 · app_collection_claim y player_profile_set_badges (misma lógica que el SQL). */
function fresh(sets: Row[] = [setRow(G2), setRow(FNC, "DRAFT")]): MemorySupabase {
  const db = new MemorySupabase();
  db.tables.collection_sets = sets;
  db.tables.user_cards = [];
  db.tables.user_collection_completions = [];
  db.tables.user_cosmetics = [];
  db.tables.player_profile_customization = [];
  db.tables.profiles = [A, B, ADMIN].map((id) => ({ id, username: id.slice(0, 4), avatar: null, xp: 0, equipped: null, packs_opened: 0 }));
  db.unique.user_collection_completions = [{ cols: ["user_id", "set_id"] }];
  db.unique.user_cosmetics = [{ cols: ["user_id", "cosmetic_id"] }];
  db.rpcHandlers.app_collection_claim = (args) => {
    const s = db.tables.collection_sets.find((r) => r.id === args.p_set);
    if (!s || s.status === "DRAFT") return { data: { code: "NOT_FOUND" }, error: null };
    const done = db.tables.user_collection_completions.find((r) => r.user_id === args.p_user && r.set_id === args.p_set);
    if (done) return { data: { code: "ALREADY", badgeId: done.badge_id, completedAt: done.completed_at }, error: null };
    if (s.status !== "PUBLISHED") return { data: { code: "RETIRED" }, error: null };
    const mine = new Set(db.tables.user_cards.filter((c) => c.user_id === args.p_user).map((c) => c.card_id));
    const reqs = s.requirements as { key: string; cardIds: string[] }[];
    const missing = reqs.filter((r) => !r.cardIds.some((c) => mine.has(c))).length;
    if (missing) return { data: { code: "INCOMPLETE", missing }, error: null };
    const badge = (s.reward as { badgeId: string }).badgeId;
    const at = new Date().toISOString();
    db.tables.user_collection_completions.push({ user_id: args.p_user, set_id: args.p_set, badge_id: badge, completed_at: at, satisfied_by: {} });
    if (!db.tables.user_cosmetics.some((c) => c.user_id === args.p_user && c.cosmetic_id === badge)) db.tables.user_cosmetics.push({ user_id: args.p_user, cosmetic_id: badge, source: `collection:${args.p_set}` });
    return { data: { code: "COMPLETED", badgeId: badge, completedAt: at }, error: null };
  };
  db.rpcHandlers.player_profile_set_badges = (args) => {
    const ids = args.p_badges as string[];
    if (ids.length > 3) return { data: { code: "TOO_MANY" }, error: null };
    if (ids.some((b) => !/^insignia:[a-z0-9:-]{1,80}$/.test(b))) return { data: { code: "BAD_ID" }, error: null };
    let row = db.tables.player_profile_customization.find((r) => r.user_id === args.p_user);
    if (!row) { row = { user_id: args.p_user, showcase_card_uids: [], featured_achievement_ids: [], featured_badge_ids: [], version: 0 }; db.tables.player_profile_customization.push(row); }
    const owned = new Set(db.tables.user_cosmetics.filter((c) => c.user_id === args.p_user).map((c) => c.cosmetic_id));
    if (ids.some((b) => !owned.has(b))) return { data: { code: "LOCKED" }, error: null };
    if (JSON.stringify(ids) === JSON.stringify(row.featured_badge_ids)) return { data: { code: "UNCHANGED", version: row.version }, error: null };
    if (args.p_expected_version !== null && args.p_expected_version !== row.version) return { data: { code: "CONFLICT", version: row.version }, error: null };
    row.featured_badge_ids = ids; row.version = (row.version as number) + 1;
    return { data: { code: "SAVED", version: row.version }, error: null };
  };
  db.rpcHandlers.app_admin_audit = () => ({ data: null, error: null });
  return db;
}
const sb = (db: MemorySupabase) => db.client as unknown as SupabaseClient;
const give = (db: MemorySupabase, user: string, cardIds: string[]) => { for (const card_id of cardIds) db.tables.user_cards.push({ uid: `${user}-${db.tables.user_cards.length}`, user_id: user, card_id, origin: "pack" }); };
const allOf = (p: DraftProposal) => p.requirements.map((r) => r.cardIds[0]);

test("sala: los BORRADORES no salen nunca al jugador; lo publicado sí, también al 0 % (descubrir objetivos)", async () => {
  const db = fresh();
  const r = await getTrophyRoom(sb(db), A);
  assert.ok(r.ok);
  assert.deepEqual(r.data!.sets.map((s) => s.id), ["team-g2-v1"]);
  assert.equal(r.data!.sets[0].state, "LOCKED");
  assert.equal(r.data!.badges.locked.length, 1, "la insignia bloqueada se enseña en la sala propia");
});

test("usuario existente que YA cumple el set: lo ve CLAIMABLE sin conseguir nada nuevo (evaluación perezosa, sin backfill)", async () => {
  const db = fresh();
  give(db, A, allOf(G2));
  const r = await getTrophyRoom(sb(db), A);
  assert.equal(r.data!.sets[0].state, "CLAIMABLE");
  assert.equal(r.data!.totals.claimable, 1);
});

test("reclamar: exactamente UNA compleción y UNA insignia con doble clic, dos pestañas y reintento", async () => {
  const db = fresh();
  give(db, A, allOf(G2));
  const results = await Promise.all([claimSet(sb(db), A, G2.id), claimSet(sb(db), A, G2.id), claimSet(sb(db), A, G2.id)]);
  assert.deepEqual(results.map((x) => x.data?.outcome).sort(), ["ALREADY", "ALREADY", "COMPLETED"]);
  const again = await claimSet(sb(db), A, G2.id);
  assert.equal(again.data?.outcome, "ALREADY");
  assert.equal(db.tables.user_collection_completions.length, 1);
  assert.equal(db.tables.user_cosmetics.filter((c) => c.cosmetic_id === G2.reward.badgeId).length, 1);
  assert.equal(again.data?.badge?.logo, "/hints/teams/g2.png", "la insignia de equipo usa el logo real");
});

test("reclamar incompleto → 409 sin escribir; el cliente no puede «decir» que lo tiene (no hay campo para ello)", async () => {
  const db = fresh();
  give(db, A, allOf(G2).slice(0, 4));
  const r = await claimSet(sb(db), A, G2.id);
  assert.equal(r.status, 409); assert.equal(r.code, "INCOMPLETE");
  assert.equal(db.tables.user_collection_completions.length, 0);
  const route = readFileSync(join(process.cwd(), "src/app/api/game/collection-sets/route.ts"), "utf8");
  assert.ok(route.includes('claim: ["action", "setId"]'), "el cuerpo solo admite action y setId");
});

test("aislamiento: A no puede reclamar con las cartas de B ni ver su progreso", async () => {
  const db = fresh();
  give(db, B, allOf(G2));
  assert.equal((await claimSet(sb(db), A, G2.id)).code, "INCOMPLETE");
  assert.equal((await getTrophyRoom(sb(db), A)).data!.sets[0].owned, 0);
  assert.equal((await getTrophyRoom(sb(db), B)).data!.sets[0].state, "CLAIMABLE");
});

test("borrador: reclamar → 404 (invisible); id mal formado → 400", async () => {
  const db = fresh();
  give(db, A, allOf(FNC));
  assert.equal((await claimSet(sb(db), A, FNC.id)).status, 404);
  assert.equal((await claimSet(sb(db), A, "../x")).status, 400);
  assert.equal((await claimSet(sb(db), A, 42)).status, 400);
});

test("permanente: tras desguazar/vender la carta, el set sigue COMPLETADO y la insignia sigue; «hoy» se informa aparte", async () => {
  const db = fresh();
  give(db, A, allOf(G2));
  await claimSet(sb(db), A, G2.id);
  db.tables.user_cards = db.tables.user_cards.filter((c) => c.card_id !== allOf(G2)[0]);
  const v = (await getTrophyRoom(sb(db), A)).data!.sets[0];
  assert.equal(v.state, "COMPLETED"); assert.equal(v.completeNow, false); assert.equal(v.owned, 4);
  assert.equal(db.tables.user_cosmetics.length, 1);
});

test("retirado: deja de ser objetivo para quien no lo completó; quien lo completó conserva su trofeo", async () => {
  const db = fresh();
  give(db, A, allOf(G2));
  await claimSet(sb(db), A, G2.id);
  db.tables.collection_sets[0].status = "RETIRED";
  give(db, B, allOf(G2));
  assert.equal((await claimSet(sb(db), B, G2.id)).code, "RETIRED");
  assert.deepEqual((await getTrophyRoom(sb(db), B)).data!.sets, []);
  const a = (await getTrophyRoom(sb(db), A)).data!;
  assert.equal(a.sets[0].state, "COMPLETED"); assert.equal(a.sets[0].retired, true);
});

test("insignias del perfil: equipar desbloqueada, NO bloqueada ni inventada; reordenar; quitar; versión", async () => {
  const db = fresh();
  give(db, A, allOf(G2));
  await claimSet(sb(db), A, G2.id);
  db.tables.user_cosmetics.push({ user_id: A, cosmetic_id: "insignia:equipo:g2", source: "mastery" });
  assert.equal((await setFeaturedBadges(sb(db), A, ["insignia:coleccion:team-fnatic"], null)).code, "LOCKED", "bloqueada");
  assert.equal((await setFeaturedBadges(sb(db), B, [G2.reward.badgeId], null)).code, "LOCKED", "la de otro");
  assert.equal((await setFeaturedBadges(sb(db), A, ["titulo:aspirante"], null)).code, "BAD_BODY", "no es una insignia");
  assert.equal((await setFeaturedBadges(sb(db), A, ["insignia:a", "insignia:b", "insignia:c", "insignia:d"], null)).code, "BAD_BODY", "más de 3");
  assert.equal((await setFeaturedBadges(sb(db), A, [G2.reward.badgeId, G2.reward.badgeId], null)).code, "DUPLICATE");
  const s1 = await setFeaturedBadges(sb(db), A, [G2.reward.badgeId, "insignia:equipo:g2"], null);
  assert.equal(s1.data?.code, "SAVED");
  const s2 = await setFeaturedBadges(sb(db), A, ["insignia:equipo:g2", G2.reward.badgeId], s1.data!.version);
  assert.equal(s2.data?.code, "SAVED", "reordenar");
  assert.equal((await setFeaturedBadges(sb(db), A, [], s1.data!.version)).code, "CONFLICT", "versión vieja");
  assert.equal((await setFeaturedBadges(sb(db), A, [], s2.data!.version)).data?.code, "SAVED", "quitar todas");
});

test("perfil público: enseña las destacadas (con logo real) y nunca las bloqueadas ni la lista completa", async () => {
  const db = fresh();
  give(db, A, allOf(G2));
  await claimSet(sb(db), A, G2.id);
  await setFeaturedBadges(sb(db), A, [G2.reward.badgeId], null);
  const pubBadges = await profileBadges(sb(db), A, false);
  assert.deepEqual(pubBadges!.featured.map((b) => b.id), [G2.reward.badgeId]);
  assert.equal(pubBadges!.featured[0].logo, "/hints/teams/g2.png");
  assert.deepEqual(pubBadges!.owned, [], "la vista pública no recibe la lista completa");
  assert.deepEqual(pubBadges!.featuredIds, []);
  const mine = await profileBadges(sb(db), A, true);
  assert.deepEqual(mine!.featuredIds, [G2.reward.badgeId]); assert.equal(mine!.owned.length, 1);
  // Destacada que ya no posee (imposible por diseño, pero defensivo) → no se enseña.
  db.tables.user_cosmetics = [];
  assert.deepEqual((await profileBadges(sb(db), A, false))!.featured, []);
  // Proyección del dominio: PUBLIC lleva `badges` y `self: null`.
  const facts = { profile: { id: A, username: "a", avatar: null, xp: 0, equipped: null, packsOpened: null }, cosmetics: { title: null, frame: null, banner: null }, ranked: null, highestRating: null, recentMatches: [], instanceCardIds: [], showcaseInstances: [], teams: [], totalCards: 331, customization: null, claimed: [], catalog: [], pickems: [], h2h: null, privateDuels: null, badges: pubBadges } as unknown as IdentityFacts;
  const snap = buildPlayerIdentity(facts, { viewerId: B, now: Date.now(), lookup: () => undefined as never, rankOf: () => null });
  assert.equal(snap.view, "PUBLIC"); assert.equal(snap.self, null); assert.deepEqual(snap.badges.map((b) => b.id), [G2.reward.badgeId]);
});

// ───────────────────────── panel ─────────────────────────

test("panel: anónimo y usuario normal 401 sin oráculo; nada escrito", async () => {
  const db = fresh([]);
  const deps: AdminDeps = { verify: async (req) => (req.headers.get("authorization") === "Bearer admin" ? { userId: ADMIN } : null), db: () => sb(db) };
  const h = collectionSetsCmsHandlers(deps);
  const req = (who: string, body?: unknown) => new Request("http://t/api/admin/cms/collection-sets", body === undefined ? { headers: who ? { authorization: `Bearer ${who}` } : {} } : { method: "POST", headers: { ...(who ? { authorization: `Bearer ${who}` } : {}), "content-type": "application/json" }, body: JSON.stringify(body) });
  for (const who of ["", "user"]) {
    assert.equal((await h.GET(req(who))).status, 401);
    assert.equal((await h.POST(req(who, { action: "generate", kind: "TEAM" }))).status, 401);
  }
  assert.equal(db.tables.collection_sets.length, 0);
  assert.equal((await h.POST(req("admin", { action: "generate", kind: "TEAM", userId: A }))).status, 400, "campo fuera de lista blanca");
});

// 2026-10-15: 36 equipos (antes 23): los 16 logos añadidos quitan los descartes por NO_LOGO.
test("panel: generar crea SOLO borradores (36 equipos), idempotente; nada se publica solo", async () => {
  const db = fresh([]);
  const g = await adminGenerate(sb(db), ADMIN, { kind: "TEAM" });
  assert.ok(g.ok);
  assert.equal(g.data!.created.length, 36); assert.equal(g.data!.skipped.length, 5);
  assert.ok(db.tables.collection_sets.every((s) => s.status === "DRAFT"));
  const again = await adminGenerate(sb(db), ADMIN, { kind: "TEAM" });
  assert.ok(again.ok);
  assert.equal(again.data!.created.length, 0); assert.equal(again.data!.existing.length, 36);
  const list = await adminListSets(sb(db));
  assert.ok(list.ok, (list as { error?: string }).error);
  assert.ok(list.data!.proposals.some((p) => "skip" in p.result));
});

test("panel: editar borrador (quitar/añadir requisito), validar, publicar con checksum; lo publicado no se edita", async () => {
  const db = fresh([]);
  await adminGenerate(sb(db), ADMIN, { kind: "TEAM", subjects: ["g2"] });
  const row = () => db.tables.collection_sets.find((s) => s.id === "team-g2-v1")!;
  const key = (row().requirements as { key: string; playerId: string }[])[0];
  const rm = await adminUpdateDraft(sb(db), ADMIN, { id: "team-g2-v1", expectedVersion: 1, patch: { removeKey: key.key } });
  assert.ok(rm.ok, (rm as { error?: string }).error);
  db.tables.collection_sets[0].row_version = 2; // la BD sube la versión (disparador de 0062)
  const add = await adminUpdateDraft(sb(db), ADMIN, { id: "team-g2-v1", expectedVersion: 2, patch: { addPlayerId: key.playerId } });
  assert.ok(add.ok);
  db.tables.collection_sets[0].row_version = 3;
  assert.equal((await adminUpdateDraft(sb(db), ADMIN, { id: "team-g2-v1", expectedVersion: 3, patch: { addPlayerId: "boaster" } })).ok, false, "un jugador sin carta impresa con G2 no entra");
  assert.equal((await adminUpdateDraft(sb(db), ADMIN, { id: "team-g2-v1", expectedVersion: 3, patch: { badgeId: "credits:500" } })).ok, false, "solo insignias");
  assert.equal((await adminUpdateDraft(sb(db), ADMIN, { id: "team-g2-v1", expectedVersion: 1, patch: { title: "X" } })).ok, false, "versión vieja");
  const pv = await adminPreview(sb(db), { id: "team-g2-v1" });
  assert.ok(pv.ok); assert.deepEqual(pv.data!.issues, []); assert.equal(pv.data!.players, 5);
  const pub = await adminPublish(sb(db), ADMIN, { id: "team-g2-v1", expectedVersion: 3 });
  assert.ok(pub.ok, (pub as { error?: string }).error);
  assert.equal(row().status, "PUBLISHED"); assert.match(String(row().checksum), /^[0-9a-f]{64}$/);
  row().row_version = 4;
  assert.equal((await adminUpdateDraft(sb(db), ADMIN, { id: "team-g2-v1", expectedVersion: 4, patch: { title: "Otro" } })).ok, false, "publicado = congelado");
  assert.equal((await adminRetire(sb(db), ADMIN, { id: "team-g2-v1", expectedVersion: 4, reason: "corto" })).ok, false, "motivo obligatorio");
  const nv = await adminNewVersion(sb(db), ADMIN, { family: "team:g2" });
  assert.ok(nv.ok); assert.equal(nv.data!.version, 2); assert.equal(nv.data!.status, "DRAFT");
  assert.equal(nv.data!.reward.badgeId, G2.reward.badgeId, "misma insignia para la familia");
});

test("panel: publicar un borrador inválido (vacío) → 409 con los motivos", async () => {
  const db = fresh([{ ...setRow(G2, "DRAFT"), requirements: [] }]);
  const r = await adminPublish(sb(db), ADMIN, { id: G2.id, expectedVersion: 1 });
  assert.equal(r.ok, false); assert.match((r as { error: string }).error, /EMPTY/);
});

test("0062 · contrato SQL: RLS sin políticas, nada para anon/authenticated, PK de compleción, insignia con ON CONFLICT, sin BEGIN/COMMIT", () => {
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/0062_collection_sets.sql"), "utf8");
  const code = sql.replace(/--.*$/gm, "");
  assert.ok(/alter table public\.collection_sets enable row level security/.test(code));
  assert.ok(/alter table public\.user_collection_completions enable row level security/.test(code));
  assert.ok(!/create policy/i.test(code), "sin políticas: solo service_role");
  assert.ok(!/grant[^;]*to (public|anon|authenticated)/i.test(code), "nada se concede al navegador");
  assert.ok(/primary key \(user_id, set_id\)/.test(code));
  assert.ok(/on conflict \(user_id, set_id\) do nothing/.test(code));
  assert.ok(/insert into public\.user_cosmetics[\s\S]*on conflict do nothing/.test(code));
  assert.ok(/for share/.test(code), "el reclamo bloquea el set frente a un retiro concurrente");
  assert.ok(/collection_sets_one_published_per_family/.test(code));
  assert.ok(!/\bbegin;|\bcommit;/i.test(code), "la transacción la pone el operador");
  assert.ok(!/credit|packs?_|app_grant_reward/i.test(code.replace(/user_cosmetics/g, "")), "F82 no concede créditos ni sobres");
});
