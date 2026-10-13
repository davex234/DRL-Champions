/**
 * F83 · RUTA DE TEMPORADA — servicio, ruta, ganchos y panel sobre MemorySupabase.
 *
 * `app_season_apply`, `app_season_claim` y `app_grant_reward` se emulan con las MISMAS reglas que el SQL (0064/0059):
 * temporada activa por la hora (reloj compartido), idempotencia por (usuario, temporada, clave), tope diario por fuente,
 * retos solo del periodo actual, XP de reto una vez, reclamo con umbral congelado y plazo, recompensa por clave única.
 * La atomicidad real (FOR UPDATE, UNIQUE, exclusión de solapes, inmutabilidad) se prueba en el ensayo de 0064 sobre
 * una copia del backup (Postgres real, psql en paralelo): ver informe F83.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { MemorySupabase, type Row } from "./testing/memorySupabase";
import { claimSeasonLevel, getSeasonOverview, ingestSeasonEvent, invalidateSeasonCache, seasonSummaryFor } from "./seasonTrack";
import { claimSet } from "./collectionSets";
import { periodOf } from "@/domain/seasonTrack/rotation";
import { t2Draft } from "@/domain/seasonTrack/template";
import { canonicalSeason, adminPublishSeason, adminCreateSeason, adminPreviewSeason, adminUpdateSeason } from "@/server/cms/seasons";
import { seasonsCmsHandlers } from "@/server/cms/handlers";
import type { AdminDeps } from "@/server/admin/http";
import type { MatchEvent } from "@/domain/missionEngine/types";
import type { SupabaseClient } from "@supabase/supabase-js";

const A = "aaaaaaaa-0000-4000-8000-0000000000a1";
const B = "bbbbbbbb-0000-4000-8000-0000000000b2";
const DAY = 86_400_000;
const T2 = t2Draft();
const clock = { now: T2.startsAt + 10 * DAY + 12 * 3_600_000 };
const iso = (ms: number) => new Date(ms).toISOString();
const match = (key: string, o: Partial<MatchEvent> = {}): MatchEvent => ({ kind: "MATCH", key, mode: "PVE", difficulty: "NORMAL", won: true, draw: false, finished: true, turnsWon: 6, humanDecisions: 9, autoDecisions: 0, deck: [], ...o });

function seasonRow(status: "DRAFT" | "PUBLISHED" = "PUBLISHED"): Row {
  return {
    id: T2.id, number: T2.number, name: T2.name, description: T2.description, status, starts_at: iso(T2.startsAt), ends_at: iso(T2.endsAt),
    claim_until: iso(T2.claimUntil), max_level: T2.maxLevel, config: T2.config, config_version: 1, checksum: status === "DRAFT" ? null : "qa",
    published_at: status === "DRAFT" ? null : iso(T2.startsAt - DAY), row_version: 1,
  };
}

function fresh(status: "DRAFT" | "PUBLISHED" = "PUBLISHED"): MemorySupabase {
  const db = new MemorySupabase();
  db.tables.profiles = [A, B].map((id) => ({ id, username: id.slice(0, 4), avatar: null, xp: 0, equipped: null, packs_opened: 0, credits: 0 }));
  db.tables.game_seasons = [seasonRow(status)];
  for (const t of ["season_events", "season_xp_ledger", "season_progress", "season_challenge_progress", "season_reward_claims", "credit_transactions", "user_packs", "user_cosmetics"]) db.tables[t] = [];
  const S = () => db.tables.game_seasons.find((r) => r.id === T2.id)!;
  db.rpcHandlers.app_season_apply = (a) => {
    const s = db.tables.game_seasons.find((r) => r.id === a.p_season);
    const now = clock.now;
    if (!s || s.status !== "PUBLISHED" || now < Date.parse(s.starts_at as string) || now >= Date.parse(s.ends_at as string)) return { data: { code: "INACTIVE" }, error: null };
    if (db.tables.season_events.some((e) => e.user_id === a.p_user && e.season_id === a.p_season && e.event_key === a.p_event_key)) return { data: { code: "REPEATED" }, error: null };
    db.tables.season_events.push({ user_id: a.p_user, season_id: a.p_season, event_key: a.p_event_key, source: a.p_source });
    let prog = db.tables.season_progress.find((r) => r.user_id === a.p_user && r.season_id === a.p_season);
    if (!prog) { prog = { user_id: a.p_user, season_id: a.p_season, xp: 0 }; db.tables.season_progress.push(prog); }
    const day = new Date(now).toISOString().slice(0, 10);
    let total = 0, grant = 0;
    if ((a.p_amount as number) > 0) {
      grant = a.p_amount as number;
      if (a.p_daily_cap !== null) {
        const used = db.tables.season_xp_ledger.filter((l) => l.user_id === a.p_user && l.season_id === a.p_season && l.source === a.p_source && (l.created_at as string).slice(0, 10) === day).reduce((x, l) => x + (l.amount as number), 0);
        grant = Math.min(grant, Math.max(0, (a.p_daily_cap as number) - used));
      }
      if (grant > 0) { db.tables.season_xp_ledger.push({ user_id: a.p_user, season_id: a.p_season, source: a.p_source, event_key: a.p_event_key, amount: grant, meta: a.p_meta, created_at: iso(now) }); total += grant; }
    }
    const dkey = periodOf("daily", now).key, wkey = periodOf("weekly", now).key;
    const done: string[] = [];
    for (const o of a.p_ops as { challenge: string; period: string; op: string; value: number; target: number; xp: number }[]) {
      if (o.period !== dkey && o.period !== wkey) continue;
      let r = db.tables.season_challenge_progress.find((x) => x.user_id === a.p_user && x.season_id === a.p_season && x.period_key === o.period && x.challenge_id === o.challenge);
      if (!r) { r = { user_id: a.p_user, season_id: a.p_season, period_key: o.period, challenge_id: o.challenge, progress: 0, target: o.target, completed_at: null }; db.tables.season_challenge_progress.push(r); }
      if (r.completed_at) continue;
      r.progress = o.op === "INC" ? Math.min((r.progress as number) + Math.max(o.value, 0), r.target as number) : o.op === "STREAK_WIN" ? Math.min((r.progress as number) + 1, r.target as number) : 0;
      if ((r.progress as number) >= o.target) {
        r.completed_at = iso(now);
        const key = `ch:${o.period}:${o.challenge}`;
        if (!db.tables.season_xp_ledger.some((l) => l.user_id === a.p_user && l.season_id === a.p_season && l.event_key === key)) {
          db.tables.season_xp_ledger.push({ user_id: a.p_user, season_id: a.p_season, source: "CHALLENGE", event_key: key, amount: o.xp, meta: { by: a.p_event_key }, created_at: iso(now) });
          total += o.xp;
        }
        done.push(o.challenge);
      }
    }
    prog.xp = (prog.xp as number) + total;
    return { data: { code: "APPLIED", xpGained: total, baseGranted: grant, xp: prog.xp, completed: done }, error: null };
  };
  db.rpcHandlers.app_season_claim = (a) => {
    const s = S(); const now = clock.now;
    if (s.status !== "PUBLISHED" || now < Date.parse(s.starts_at as string)) return { data: { code: "NOT_FOUND" }, error: null };
    const lvl = a.p_level as number;
    if (lvl < 1 || lvl > (s.max_level as number)) return { data: { code: "BAD_LEVEL" }, error: null };
    const rew = (s.config as typeof T2.config).rewards.find((r) => r.level === lvl)?.reward;
    if (!rew) return { data: { code: "NO_REWARD" }, error: null };
    if (db.tables.season_reward_claims.some((c) => c.user_id === a.p_user && c.season_id === a.p_season && c.level === lvl)) return { data: { code: "ALREADY", reward: rew }, error: null };
    if (now >= Date.parse(s.claim_until as string)) return { data: { code: "CLOSED" }, error: null };
    const xp = (db.tables.season_progress.find((r) => r.user_id === a.p_user && r.season_id === a.p_season)?.xp as number | undefined) ?? 0;
    if (xp < (s.config as typeof T2.config).levels[lvl - 1]) return { data: { code: "LOCKED", xp, need: (s.config as typeof T2.config).levels[lvl - 1] }, error: null };
    db.tables.season_reward_claims.push({ user_id: a.p_user, season_id: a.p_season, level: lvl, reward: rew });
    return { data: { code: "CLAIMED", reward: rew }, error: null };
  };
  db.rpcHandlers.app_grant_reward = (a) => {
    if (db.tables.credit_transactions.some((t) => t.user_id === a.p_user && t.ref === a.p_ref)) return { data: { applied: false }, error: null };
    db.tables.credit_transactions.push({ user_id: a.p_user, ref: a.p_ref, amount: a.p_credits });
    const prof = db.tables.profiles.find((p) => p.id === a.p_user)!; prof.credits = (prof.credits as number) + (a.p_credits as number);
    if (a.p_pack_id) db.tables.user_packs.push({ user_id: a.p_user, pack_id: a.p_pack_id, qty: a.p_pack_count });
    for (const c of (a.p_cosmetics as string[] | null) ?? []) db.tables.user_cosmetics.push({ user_id: a.p_user, cosmetic_id: c, source: a.p_ref });
    return { data: { applied: true, credits: prof.credits }, error: null };
  };
  db.rpcHandlers.app_admin_audit = () => ({ data: null, error: null });
  return db;
}
const sb = (db: MemorySupabase) => { const c = db.client as unknown as SupabaseClient; invalidateSeasonCache(c); return c; };
const xpOf = (db: MemorySupabase, u: string) => (db.tables.season_progress.find((r) => r.user_id === u)?.xp as number | undefined) ?? 0;

test("F83-S1 · partida legítima → XP en el libro y progreso; el MISMO evento repetido (reintento, dos pestañas, worker) no suma", async () => {
  const db = fresh(); const c = sb(db);
  const r1 = await ingestSeasonEvent(c, A, match("match:m1"), clock.now);
  assert.equal(r1?.applied, true); assert.ok(r1!.xpGained >= 70);
  const xp = xpOf(db, A);
  const again = await Promise.all([1, 2, 3, 4, 5].map(() => ingestSeasonEvent(c, A, match("match:m1"), clock.now)));
  assert.ok(again.every((r) => r?.applied === false));
  assert.equal(xpOf(db, A), xp);
  assert.equal(db.tables.season_xp_ledger.filter((l) => l.event_key === "match:m1").length, 1);
});

test("F83-S2 · tope diario de partidas (600) y de crafteo (100); al día siguiente vuelve a contar", async () => {
  const db = fresh(); const c = sb(db);
  for (let i = 0; i < 20; i++) await ingestSeasonEvent(c, A, match(`match:cap-${i}`, { won: true }), clock.now);
  const matchXp = db.tables.season_xp_ledger.filter((l) => l.source === "MATCH").reduce((s, l) => s + (l.amount as number), 0);
  assert.equal(matchXp, 600);
  for (let i = 0; i < 5; i++) await ingestSeasonEvent(c, A, { kind: "CRAFT_PACK", key: `craft:${i}`, packId: "estandar" }, clock.now);
  assert.equal(db.tables.season_xp_ledger.filter((l) => l.source === "CRAFT").reduce((s, l) => s + (l.amount as number), 0), 100);
  const tomorrow = clock.now + DAY; const saved = clock.now; clock.now = tomorrow;
  await ingestSeasonEvent(c, A, match("match:next-day"), tomorrow);
  clock.now = saved;
  assert.ok(db.tables.season_xp_ledger.some((l) => l.event_key === "match:next-day"));
});

test("F83-S3 · AFK, privada, sin terminar y abrir sobres: ni XP ni retos (ni siquiera se registra el evento)", async () => {
  const db = fresh(); const c = sb(db);
  for (const e of [match("match:afk", { humanDecisions: 2, autoDecisions: 8 }), match("match:priv", { mode: "PRIVATE" }), match("match:unfinished", { finished: false })]) {
    assert.equal(await ingestSeasonEvent(c, A, e, clock.now), null);
  }
  assert.equal(await ingestSeasonEvent(c, A, { kind: "OPEN_PACK", key: "open:1", packId: "estandar" }, clock.now), null);
  assert.equal(db.tables.season_events.length, 0); assert.equal(xpOf(db, A), 0);
});

test("F83-S4 · retos diarios: se completan con eventos reales y dan su XP UNA vez (aunque sigan llegando partidas)", async () => {
  const db = fresh(); const c = sb(db);
  for (let i = 0; i < 6; i++) await ingestSeasonEvent(c, A, match(`match:ch-${i}`, { won: true, turnsWon: 7, difficulty: "HARD" }), clock.now);
  const ov = (await getSeasonOverview(c, A, clock.now)).data!;
  assert.ok(ov.daily!.challenges.every((x) => x.completed), JSON.stringify(ov.daily));
  const chKeys = db.tables.season_xp_ledger.filter((l) => l.source === "CHALLENGE").map((l) => l.event_key as string);
  assert.equal(new Set(chKeys).size, chKeys.length, "cada reto paga una vez");
  assert.ok(ov.recent.some((r) => r.source === "CHALLENGE" && (r.by ?? "").startsWith("match:")));
});

test("F83-S5 · reset diario: el reto de ayer no sigue progresando; el periodo nuevo empieza en 0", async () => {
  const db = fresh(); const c = sb(db);
  await ingestSeasonEvent(c, A, match("match:d1"), clock.now);
  const before = db.tables.season_challenge_progress.filter((r) => (r.period_key as string).startsWith("d:"));
  const day1 = periodOf("daily", clock.now).key;
  const saved = clock.now; clock.now = periodOf("daily", saved).endsAt; // 00:00 UTC exacto del día siguiente
  await ingestSeasonEvent(c, A, match("match:d2"), clock.now);
  const day2 = periodOf("daily", clock.now).key;
  clock.now = saved;
  assert.notEqual(day1, day2);
  assert.ok(before.every((r) => r.period_key === day1));
  assert.ok(db.tables.season_challenge_progress.some((r) => r.period_key === day2));
});

test("F83-S6 · un periodo VIEJO enviado al RPC se descarta (eventos atrasados o reloj manipulado no completan retos)", async () => {
  const db = fresh(); const c = sb(db);
  const { data } = await c.rpc("app_season_apply", { p_user: A, p_season: T2.id, p_event_key: "match:old", p_source: "MATCH", p_amount: 0, p_daily_cap: null,
    p_ops: [{ challenge: "d-jugar-2", period: "d:2026-01-01", op: "INC", value: 5, target: 2, xp: 120 }], p_meta: {} });
  assert.deepEqual((data as { completed: string[] }).completed, []);
  assert.equal(db.tables.season_challenge_progress.length, 0);
});

test("F83-S7 · temporada no activa (antes de empezar, después de terminar, borrador): ninguna XP", async () => {
  for (const [label, now, status] of [["antes", T2.startsAt - 1, "PUBLISHED"], ["después", T2.endsAt, "PUBLISHED"], ["borrador", T2.startsAt + DAY, "DRAFT"]] as const) {
    const db = fresh(status); const c = sb(db); const saved = clock.now; clock.now = now;
    assert.equal(await ingestSeasonEvent(c, A, match(`match:${label}`), now), null, label);
    clock.now = saved;
    assert.equal(db.tables.season_xp_ledger.length, 0, label);
  }
});

test("F83-S8 · reclamo: nivel no alcanzado → 409; alcanzado → recompensa por award() UNA vez aunque lleguen 8 a la vez", async () => {
  const db = fresh(); const c = sb(db);
  assert.equal((await claimSeasonLevel(c, A, T2.id, 2, clock.now)).code, "LOCKED");
  db.tables.season_progress.push({ user_id: A, season_id: T2.id, xp: T2.config.levels[9] });
  const results = await Promise.all(Array.from({ length: 8 }, () => claimSeasonLevel(c, A, T2.id, 10, clock.now)));
  assert.ok(results.every((r) => r.ok));
  assert.equal(results.filter((r) => r.data!.outcome === "CLAIMED").length, 1);
  assert.equal(db.tables.season_reward_claims.length, 1);
  assert.equal(db.tables.credit_transactions.filter((t) => t.ref === `season:${T2.id}:10`).length, 1);
  assert.deepEqual(db.tables.user_packs.map((p) => [p.pack_id, p.qty]), [["estandar", 1]], "sobre como entitlement real (+1), nada se abre");
  const retry = await claimSeasonLevel(c, A, T2.id, 10, clock.now);
  assert.equal(retry.data!.outcome, "ALREADY");
  assert.equal(db.tables.user_packs.length, 1);
});

test("F83-S9 · reclamo con créditos e insignia: créditos por el libro canónico, insignia en user_cosmetics; nivel futuro y nivel sin recompensa rechazados", async () => {
  const db = fresh(); const c = sb(db);
  db.tables.season_progress.push({ user_id: A, season_id: T2.id, xp: T2.config.levels[19] });
  assert.equal((await claimSeasonLevel(c, A, T2.id, 5, clock.now)).data!.reward.credits, 1000);
  assert.equal(db.tables.profiles.find((p) => p.id === A)!.credits, 1000);
  await claimSeasonLevel(c, A, T2.id, 20, clock.now);
  assert.deepEqual(db.tables.user_cosmetics.map((x) => x.cosmetic_id), ["insignia:temporada:temporada-2-plata"]);
  assert.equal((await claimSeasonLevel(c, A, T2.id, 40, clock.now)).code, "LOCKED");
  assert.equal((await claimSeasonLevel(c, A, T2.id, 1, clock.now)).code, "NO_REWARD");
  for (const [s, l] of [["../x", 5], [T2.id, 0], [T2.id, 4.5], [T2.id, "5"]] as const) assert.equal((await claimSeasonLevel(c, A, s, l, clock.now)).status, 400);
});

test("F83-S10 · gracia: tras el fin se reclama lo alcanzado hasta claim_until; después, cerrado", async () => {
  const db = fresh(); const c = sb(db);
  db.tables.season_progress.push({ user_id: A, season_id: T2.id, xp: T2.config.levels[9] });
  const saved = clock.now;
  clock.now = T2.endsAt + DAY; assert.equal((await claimSeasonLevel(c, A, T2.id, 10, clock.now)).data!.outcome, "CLAIMED");
  clock.now = T2.claimUntil; assert.equal((await claimSeasonLevel(c, A, T2.id, 5, clock.now)).code, "CLOSED");
  clock.now = saved;
});

test("F83-S11 · aislamiento: A no reclama ni ve lo de B; la XP de A no toca a B", async () => {
  const db = fresh(); const c = sb(db);
  await ingestSeasonEvent(c, A, match("match:a"), clock.now);
  db.tables.season_progress.push({ user_id: B, season_id: T2.id, xp: T2.config.levels[9] });
  assert.equal((await claimSeasonLevel(c, A, T2.id, 10, clock.now)).code, "LOCKED", "A no puede usar el nivel de B");
  assert.equal(xpOf(db, B), T2.config.levels[9]);
  const ovB = (await getSeasonOverview(c, B, clock.now)).data!;
  assert.equal(ovB.recent.length, 0, "B no ve los asientos de A");
});

test("F83-S12 · vista: una lectura agregada SIN escrituras; sin temporada publicada → NONE con el pase heredado si corre", async () => {
  const db = fresh(); const c = sb(db);
  await ingestSeasonEvent(c, A, match("match:v"), clock.now);
  const w0 = db.writes().length;
  const ov = await getSeasonOverview(c, A, clock.now);
  assert.equal(db.writes().length, w0, "leer no escribe");
  assert.equal(ov.data!.phase, "ACTIVE"); assert.equal(ov.data!.daily!.challenges.length, 3); assert.equal(ov.data!.weekly!.challenges.length, 5);
  const none = fresh("DRAFT"); const n = await getSeasonOverview(sb(none), A, Date.parse("2026-10-03T12:00:00Z"));
  assert.equal(n.data!.phase, "NONE"); assert.equal(n.data!.legacy?.name, "Temporada 1 · Ascenso");
});

test("F83-S13 · colección F82 completada DURANTE la temporada → XP una vez; las completadas antes no se recompensan", async () => {
  // claimSet no recibe reloj: la temporada de esta prueba está activa HOY (hora real) y el emulador usa la misma hora.
  const db = fresh(); const saved = clock.now; clock.now = Date.now();
  db.tables.game_seasons = [{ ...seasonRow(), starts_at: iso(clock.now - DAY), ends_at: iso(clock.now + 80 * DAY), claim_until: iso(clock.now + 90 * DAY) }];
  const c = sb(db);
  const G2 = { id: "team-g2-v1", status: "PUBLISHED", requirements: [{ key: "player:leaf", cardIds: ["leaf__base"] }], reward: { badgeId: "insignia:coleccion:team-g2" } };
  db.tables.collection_sets = [G2 as Row]; db.tables.user_collection_completions = []; db.tables.user_cards = [{ uid: "u1", user_id: A, card_id: "leaf__base" }];
  db.rpcHandlers.app_collection_claim = (a) => {
    if (db.tables.user_collection_completions.some((x) => x.user_id === a.p_user)) return { data: { code: "ALREADY" }, error: null };
    db.tables.user_collection_completions.push({ user_id: a.p_user, set_id: a.p_set, badge_id: "x", completed_at: iso(clock.now) });
    return { data: { code: "COMPLETED", completedAt: iso(clock.now) }, error: null };
  };
  await claimSet(c, A, "team-g2-v1"); await claimSet(c, A, "team-g2-v1");
  clock.now = saved;
  assert.equal(db.tables.season_xp_ledger.filter((l) => l.source === "COLLECTION").length, 1);
  assert.equal(db.tables.season_xp_ledger.find((l) => l.source === "COLLECTION")!.amount, 300);
});

test("F83-S14 · perfil: solo nombre y nivel de la temporada activa/en gracia; nada del libro", async () => {
  const db = fresh(); const c = sb(db);
  db.tables.season_progress.push({ user_id: A, season_id: T2.id, xp: T2.config.levels[16] + 5 });
  assert.deepEqual(await seasonSummaryFor(c, A, clock.now), { seasonId: T2.id, name: T2.name, level: 17, maxLevel: 40, phase: "ACTIVE" });
  assert.equal(await seasonSummaryFor(c, A, T2.startsAt - 1), null, "programada: nada en el perfil");
});

test("F83-A1 · panel: anónimo/usuario normal 401 sin oráculo; crear borrador, editar, previsualizar con economía, publicar exige PUBLICAR y validez", async () => {
  const db = fresh(); db.tables.game_seasons = []; const c = sb(db);
  const deps: AdminDeps = { verify: async (req) => (req.headers.get("authorization") === "Bearer admin" ? { userId: A } : null), db: () => c, rate: async () => ({ allowed: true, retryAfter: 0 }) };
  const h = seasonsCmsHandlers(deps);
  for (const who of ["", "user"]) {
    const r = await h.POST(new Request("http://x/api/admin/cms/seasons", { method: "POST", headers: who ? { authorization: `Bearer ${who}`, "content-type": "application/json" } : { "content-type": "application/json" }, body: JSON.stringify({ action: "create" }) }));
    assert.equal(r.status, 401);
  }
  assert.equal(db.tables.game_seasons.length, 0, "nada escrito sin admin");
  const created = await adminCreateSeason(c, A);
  assert.equal(created.ok, true); assert.equal(created.data!.status, "DRAFT"); assert.equal(created.data!.id, "temporada-2");
  const up = await adminUpdateSeason(c, A, { id: "temporada-2", expectedVersion: 1, patch: { curve: { base: 2000, step: 0 } } });
  assert.equal(up.ok, true, "update"); assert.equal(up.data!.config.levels[0], 2000);
  const bad = await adminUpdateSeason(c, A, { id: "temporada-2", expectedVersion: up.data!.rowVersion, patch: { rewards: [{ level: 5, reward: { credits: 999_999 } }] } });
  assert.equal(bad.ok, false);
  const pv = await adminPreviewSeason(c, { id: "temporada-2" }, Date.parse("2026-10-03T00:00:00Z"));
  assert.equal(pv.ok, true);
  assert.equal(pv.data!.issues.length, 0, JSON.stringify(pv.data!.issues)); assert.equal(pv.data!.simulation.length, 4);
  assert.equal((await adminPublishSeason(c, A, { id: "temporada-2", expectedVersion: up.data!.rowVersion }, Date.parse("2026-10-03T00:00:00Z"))).ok, false, "sin confirmación no publica");
  const late = await adminPublishSeason(c, A, { id: "temporada-2", expectedVersion: up.data!.rowVersion, confirm: "PUBLICAR" }, T2.startsAt + 1);
  assert.equal(late.ok, false, "una fecha de inicio pasada no se publica");
});

test("F83-A2 · checksum canónico estable (orden de claves) y distinto si cambia una recompensa", () => {
  const s = { ...T2 };
  const rev = (v: unknown): unknown => Array.isArray(v) ? v.map(rev) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v as object).reverse().map((k) => [k, rev((v as Record<string, unknown>)[k])])) : v;
  const shuffled = { ...s, config: rev(s.config) as typeof s.config };
  assert.equal(canonicalSeason(s), canonicalSeason(shuffled));
  const changed = { ...s, config: { ...s.config, rewards: s.config.rewards.map((r) => (r.level === 5 ? { ...r, reward: { credits: 1001 } } : r)) } };
  assert.notEqual(canonicalSeason(s), canonicalSeason(changed));
});
