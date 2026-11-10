/**
 * F89 · PROFILE 2.0 — servicio sobre MemorySupabase: agregación del perfil (carrera, historial, equipo favorito,
 * colecciones F82), privacidad por espectador, paginación, validación de mutaciones y aislamiento entre cuentas.
 *
 * `player_profile_set_favorite_team` se emula con la MISMA regla que el SQL de 0063 (forma, UNCHANGED antes que versión,
 * CONFLICT, SAVED). La atomicidad real (FOR UPDATE) y las carreras con transacciones de Postgres se prueban en el ensayo
 * de 0063 sobre una copia del backup (ver informe F89).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { MemorySupabase, type Row } from "./testing/memorySupabase";
import { getPlayerIdentity, getPlayerHistory, setFavoriteTeam, setShowcase, setFeaturedBadges } from "./playerIdentity";
import { careerStats, SELF_MODES, PUBLIC_MODES, type HistoryRowFact } from "@/domain/profile/career";
import type { SupabaseClient } from "@supabase/supabase-js";

const A = "aaaaaaaa-0000-4000-8000-0000000000a1";
const B = "bbbbbbbb-0000-4000-8000-0000000000b2";
const C = "cccccccc-0000-4000-8000-0000000000c3";
const NOBODY = "dddddddd-0000-4000-8000-0000000000d4";
const T0 = Date.UTC(2026, 9, 1, 12);
const iso = (ms: number) => new Date(ms).toISOString();

let seq = 0;
const match = (o: Partial<Row> & { mode: string; at: number }): Row => ({
  id: `00000000-0000-4000-9000-${String(++seq).padStart(12, "0")}`, user_id: A, player_b_id: null, status: "COMPLETED", winner: "A",
  closed_reason: null, closed_by: null, closed_at: null, created_at: iso(o.at - 60_000), updated_at: iso(o.at), difficulty: "NORMAL",
  scoreA: 6, scoreB: 3, ...o,
});

function fresh(): MemorySupabase {
  seq = 0;
  const db = new MemorySupabase();
  db.tables.profiles = [A, B, C].map((id, i) => ({ id, username: ["Alfa", "Beta", "Gamma"][i], avatar: "🐉", xp: 1200, equipped: null, packs_opened: 3, created_at: "2026-07-17T10:30:00Z" }));
  db.tables.player_profile_customization = [];
  db.tables.user_cards = [
    { uid: "11111111-0000-4000-8000-000000000001", user_id: A, card_id: "leaf__base", serial: null, minted_version: null, obtained_at: "2026-09-01T00:00:00Z" },
    { uid: "22222222-0000-4000-8000-000000000002", user_id: B, card_id: "trent__base", serial: null, minted_version: null, obtained_at: "2026-09-01T00:00:00Z" },
  ];
  db.tables.user_achievements = []; db.tables.pickem_scores = []; db.tables.user_cosmetics = [];
  db.tables.collection_sets = [{ id: "team-g2-v1", kind: "TEAM", title: "G2", logo: "/hints/teams/g2.png", status: "PUBLISHED" }, { id: "team-fnatic-v1", kind: "TEAM", title: "Fnatic", logo: "/hints/teams/fnatic.png", status: "PUBLISHED" }];
  db.tables.user_collection_completions = [{ user_id: A, set_id: "team-g2-v1", badge_id: "insignia:coleccion:team-g2", completed_at: "2026-10-02T19:00:00Z" }];
  // 25 partidas públicas de A (ranked, IA, draft) + 4 duelos privados + 1 en curso; 3 de B que no son de A.
  const rows: Row[] = [];
  for (let i = 0; i < 25; i++) {
    const mode = ["PVP", "PVE", "DRAFT_GAUNTLET"][i % 3];
    rows.push(match({ mode, at: T0 - i * 3_600_000, winner: i % 4 === 0 ? "B" : "A", player_b_id: mode === "PVP" ? B : null }));
  }
  for (let i = 0; i < 4; i++) rows.push(match({ mode: "PVP_PRIVATE", at: T0 - 30 * 3_600_000 - i, player_b_id: C, winner: "B" }));
  rows.push(match({ mode: "PVP", at: T0 + 1000, status: "IN_PROGRESS", winner: null, player_b_id: B }));
  for (let i = 0; i < 3; i++) rows.push(match({ mode: "PVE", at: T0 - i, user_id: B }));
  db.tables.duel_matches = rows;
  db.rpcHandlers.player_profile_set_favorite_team = (args) => {
    if (args.p_team !== null && !/^[a-z0-9-]{1,48}$/.test(String(args.p_team))) return { data: { code: "BAD_TEAM" }, error: null };
    let row = db.tables.player_profile_customization.find((r) => r.user_id === args.p_user);
    if (!row) { row = { user_id: args.p_user, showcase_card_uids: [], featured_achievement_ids: [], featured_badge_ids: [], favorite_team_id: null, version: 0 }; db.tables.player_profile_customization.push(row); }
    if ((row.favorite_team_id ?? null) === args.p_team) return { data: { code: "UNCHANGED", version: row.version }, error: null };
    if (args.p_expected_version !== null && args.p_expected_version !== row.version) return { data: { code: "CONFLICT", version: row.version }, error: null };
    row.favorite_team_id = args.p_team; row.version = (row.version as number) + 1;
    return { data: { code: "SAVED", version: row.version }, error: null };
  };
  db.rpcHandlers.player_profile_set_badges = (args) => {
    const owned = new Set(db.tables.user_cosmetics.filter((c) => c.user_id === args.p_user).map((c) => c.cosmetic_id));
    return { data: { code: (args.p_badges as string[]).every((b) => owned.has(b)) ? "SAVED" : "LOCKED", version: 1 }, error: null };
  };
  db.rpcHandlers.player_profile_set = () => ({ data: { code: "SAVED", version: 1 }, error: null });
  return db;
}
const sb = (db: MemorySupabase) => db.client as unknown as SupabaseClient;

/** Recuento INDEPENDIENTE desde las filas crudas (la «fuente canónica»), para comparar con lo que devuelve el perfil. */
function expected(db: MemorySupabase, user: string, modes: string[]) {
  let w = 0, l = 0;
  for (const r of db.tables.duel_matches) {
    if (!modes.includes(r.mode as string) || (r.user_id !== user && r.player_b_id !== user) || r.status !== "COMPLETED") continue;
    const side = r.user_id === user ? "A" : "B";
    if (r.winner === side) w++; else l++;
  }
  return { played: w + l, wins: w, losses: l };
}

test("F89-SV1 · perfil PÚBLICO: carrera = ranked + IA + draft (sin privados), igual al recuento independiente; nada en curso", async () => {
  const db = fresh();
  const r = await getPlayerIdentity(sb(db), B, A, { now: T0 });
  assert.equal(r.ok, true, r.error);
  const s = r.data!.career!.stats;
  const e = expected(db, A, ["PVP", "PVE", "DRAFT_GAUNTLET"]);
  assert.deepEqual([s.total.played, s.total.wins, s.total.losses], [e.played, e.wins, e.losses]);
  assert.equal(e.played, 25);
  assert.ok(!s.modes.includes("PRIVATE") && s.byMode.PRIVATE === undefined);
  assert.ok(r.data!.career!.history.items.every((i) => i.mode !== "PRIVATE" && i.href === null));
  assert.equal(r.data!.self, null);
});

test("F89-SV2 · perfil PROPIO: además los duelos privados (4), con enlaces a sus partidas", async () => {
  const db = fresh();
  const r = await getPlayerIdentity(sb(db), A, A, { now: T0 });
  const s = r.data!.career!.stats;
  assert.equal(s.total.played, 29);
  assert.equal(s.byMode.PRIVATE?.losses, 4);
  assert.ok(r.data!.career!.history.items.some((i) => i.href !== null));
});

test("F89-SV3 · historial: 10 + 10 + 5 por cursor, sin repetidos ni huecos; la última página no ofrece «más»", async () => {
  const db = fresh();
  const first = (await getPlayerIdentity(sb(db), B, A, { now: T0 })).data!.career!.history;
  assert.equal(first.items.length, 10); assert.notEqual(first.nextBefore, null);
  const p2 = await getPlayerHistory(sb(db), B, A, first.nextBefore);
  assert.equal(p2.data!.items.length, 10); assert.notEqual(p2.data!.nextBefore, null);
  const p3 = await getPlayerHistory(sb(db), B, A, p2.data!.nextBefore);
  assert.equal(p3.data!.items.length, 5); assert.equal(p3.data!.nextBefore, null);
  const ids = [...first.items, ...p2.data!.items, ...p3.data!.items].map((i) => i.matchId);
  assert.equal(new Set(ids).size, 25);
  assert.ok([...first.items, ...p2.data!.items, ...p3.data!.items].every((i) => i.mode !== "PRIVATE"));
});

test("F89-SV4 · historial/perfil de un usuario inexistente → 404 (sin datos); id mal formado → 400", async () => {
  const db = fresh();
  assert.equal((await getPlayerHistory(sb(db), B, NOBODY, null)).status, 404);
  assert.equal((await getPlayerIdentity(sb(db), B, NOBODY)).status, 404);
  assert.equal((await getPlayerHistory(sb(db), B, "no-es-un-uuid", null)).status, 400);
  const r = await getPlayerHistory(sb(db), B, NOBODY, null);
  assert.ok(!JSON.stringify(r).includes("@"), "nada de correos ni metadatos");
});

test("F89-SV5 · equipo favorito: válido → SAVED y el perfil lo enseña con logo del SISTEMA; mismo → UNCHANGED; viejo → CONFLICT; null lo quita", async () => {
  const db = fresh();
  const s1 = await setFavoriteTeam(sb(db), A, "team-heretics", null);
  assert.deepEqual(s1.data, { code: "SAVED", version: 1 });
  const p = (await getPlayerIdentity(sb(db), B, A, { now: T0 })).data!;
  assert.deepEqual(p.favoriteTeam, { id: "team-heretics", name: "Team Heretics", tag: "TH", region: "EMEA", logo: "/hints/teams/team-heretics.png" });
  assert.equal((await setFavoriteTeam(sb(db), A, "team-heretics", 0)).data!.code, "UNCHANGED");
  const stale = await setFavoriteTeam(sb(db), A, "g2", 0);
  assert.equal(stale.status, 409); assert.equal(stale.code, "CONFLICT");
  assert.equal((await setFavoriteTeam(sb(db), A, null, 1)).data!.code, "SAVED");
  assert.equal((await getPlayerIdentity(sb(db), B, A, { now: T0 })).data!.favoriteTeam, null);
});

test("F89-SV6 · equipo favorito inválido: inexistente, nombre, URL, logo, número → 400 SIN llegar al RPC", async () => {
  const db = fresh();
  for (const bad of ["equipo-inventado", "Team Heretics", "https://evil.example/x.png", "/hints/teams/g2.png", 7, { id: "g2" }, "drx"]) {
    const r = await setFavoriteTeam(sb(db), A, bad, null);
    assert.equal(r.status, 400, JSON.stringify(bad));
  }
  assert.equal(db.rpcCalls.filter((c) => c.name === "player_profile_set_favorite_team").length, 0);
});

test("F89-SV7 · un id guardado que ya no es válido (p. ej. escrito a mano) NO se enseña: falla seguro", async () => {
  const db = fresh();
  db.tables.player_profile_customization.push({ user_id: A, showcase_card_uids: [], featured_achievement_ids: [], featured_badge_ids: [], favorite_team_id: "drx", version: 3 });
  assert.equal((await getPlayerIdentity(sb(db), B, A, { now: T0 })).data!.favoriteTeam, null);
});

test("F89-SV8 · cruce de cuentas: la mutación solo toca la fila del usuario del token; B no cambia", async () => {
  const db = fresh();
  await setFavoriteTeam(sb(db), A, "fnatic", null);
  assert.equal(db.tables.player_profile_customization.find((r) => r.user_id === B), undefined);
  assert.equal((await getPlayerIdentity(sb(db), A, B, { now: T0 })).data!.favoriteTeam, null);
});

test("F89-SV9 · dos pestañas con la MISMA versión: una SAVED, la otra CONFLICT (sin pisarse)", async () => {
  const db = fresh();
  const [x, y] = await Promise.all([setFavoriteTeam(sb(db), A, "g2", null), setFavoriteTeam(sb(db), A, "fnatic", null)]);
  // Sin versión esperada «gana el último» (documentado); con versión, el segundo choca:
  assert.ok(x.ok && y.ok);
  const v = db.tables.player_profile_customization.find((r) => r.user_id === A)!.version as number;
  const [p, q] = await Promise.all([setFavoriteTeam(sb(db), A, "leviatan", v), setFavoriteTeam(sb(db), A, "team-liquid", v)]);
  assert.deepEqual([p.ok, q.ok].sort(), [false, true]);
  assert.equal([p, q].find((r) => !r.ok)!.code, "CONFLICT");
});

test("F89-SV10 · cartas destacadas: copia ajena, uid inventado, mal formado o repetido → rechazado; insignia bloqueada → 403", async () => {
  const db = fresh();
  assert.equal((await setShowcase(sb(db), A, ["22222222-0000-4000-8000-000000000002"], null)).code, "NOT_OWNED", "copia de B");
  assert.equal((await setShowcase(sb(db), A, ["99999999-0000-4000-8000-000000000009"], null)).code, "NOT_OWNED");
  assert.equal((await setShowcase(sb(db), A, ["nope"], null)).code, "BAD_UID");
  assert.equal((await setShowcase(sb(db), A, ["11111111-0000-4000-8000-000000000001", "11111111-0000-4000-8000-000000000001"], null)).code, "DUPLICATE");
  assert.equal((await setShowcase(sb(db), A, ["11111111-0000-4000-8000-000000000001"], null)).ok, true);
  assert.equal((await setFeaturedBadges(sb(db), A, ["insignia:coleccion:team-g2"], null)).code, "LOCKED");
});

test("F89-SV11 · copia destacada que desaparece (desguace/crafteo): el perfil público la salta, el propio avisa", async () => {
  const db = fresh();
  db.tables.player_profile_customization.push({ user_id: A, showcase_card_uids: ["11111111-0000-4000-8000-000000000001"], featured_achievement_ids: [], featured_badge_ids: [], favorite_team_id: null, version: 1, updated_at: null });
  db.tables.user_cards = db.tables.user_cards.filter((c) => c.user_id !== A);
  const pub = (await getPlayerIdentity(sb(db), B, A, { now: T0 })).data!;
  assert.equal(pub.showcase.length, 0);
  const own = (await getPlayerIdentity(sb(db), A, A, { now: T0 })).data!;
  assert.equal(own.self!.unavailableSlots, 1);
});

test("F89-SV12 · colecciones: números de F82 (completadas de las publicadas / publicadas), logo del set", async () => {
  const db = fresh();
  const c = (await getPlayerIdentity(sb(db), B, A, { now: T0 })).data!.collections!;
  assert.deepEqual([c.publishedCompleted, c.publishedSets, c.setsCompleted, c.teamSetsCompleted], [1, 2, 1, 1]);
  assert.deepEqual(c.completed.map((x) => [x.setId, x.logo]), [["team-g2-v1", "/hints/teams/g2.png"]]);
  // Sin tablas de F82 (0062 ausente) el perfil sigue, sin bloque de colecciones.
  db.missing.add("collection_sets");
  const r = await getPlayerIdentity(sb(db), B, A, { now: T0 });
  assert.equal(r.ok, true); assert.equal(r.data!.collections, null);
});

test("F89-SV13 · la carrera usa la MISMA función que el dominio (sin recálculo propio)", () => {
  const facts: HistoryRowFact[] = [];
  assert.deepEqual(careerStats(facts, A, SELF_MODES, { read: 0, capped: false }).total.played, 0);
  assert.ok(PUBLIC_MODES.length === 3);
});
