/**
 * FASE 36.1 · CONTADOR DE SOBRES EN EL SERVIDOR — fuente, lecturas puras, Daily Loop, reclamo y contrato SQL.
 *
 * La semántica real de las RPC (comprar/recibir = +0, abrir = +1, reintento = +0) se prueba contra Postgres en
 * `docs/product/qa/fase36-1/db-evidence.md` (sondas BEGIN/ROLLBACK). Aquí: que el servidor LEE esa fuente, que leer
 * no rebasea ni escribe, que una baseline antigua no regala nada y que el SQL sigue siendo el que se probó.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { freshPassState } from "@/battlepass";
import { legacyMetricKey } from "@/battlepass/missions";
import { CURRENT_SEASON } from "@/data/season";
import { FakeSupabase } from "./testing/fakeSupabase";
import { loadFacts, peekProgression, getProgression } from "./progression";
import { getDailyLoop } from "./dailyLoop";
import { planPackRebase, buildRebaseSql, naiveExposure } from "./progressionRebase";
import type { SupabaseClient } from "@supabase/supabase-js";

const U = "aaaaaaaa-0000-4000-8000-000000000361";
const NOW = Date.parse("2026-09-15T17:00:00.000Z");
const TODAY = Date.parse("2026-09-15T13:21:50.200Z");
const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

type M = { id: string; kind: string; metric: string; goal: number; baseline: number; claimed: boolean; assignedAt: number; metricVersion?: number };
const abrir = (o: Partial<M> = {}): M => ({ id: "d-abrir-1", kind: "daily", metric: "packs_opened", goal: 1, baseline: 0, claimed: false, assignedAt: TODAY, ...o });
const sobres10 = (o: Partial<M> = {}): M => ({ id: "w-sobres-10", kind: "weekly", metric: "packs_opened", goal: 10, baseline: 0, claimed: false, assignedAt: TODAY, ...o });

function seed(missions: M[], game: number | null, legacy = 0) {
  const db = new FakeSupabase();
  const state = freshPassState(CURRENT_SEASON.id);
  state.missions = missions as never;
  db.tables = {
    profiles: [{ id: U, username: "qa", xp: 800, credits: 5_540, points: 16, packs_opened: legacy, region: null, equipped: {} }],
    user_pass: [{ user_id: U, season_id: CURRENT_SEASON.id, state }],
    user_game: game === null ? [] : [{ user_id: U, pity: {}, packs_opened: game }],
    user_cards: [{ uid: "c1", user_id: U, card_id: "aspas" }],
    user_achievements: [], user_cosmetics: [], user_packs: [], duel_matches: [], duel_decks: [], pickem_answers: [],
    duel_challenges: [], duel_pvp_ratings: [], duel_pvp_rating_events: [], events: [], matches: [], stages: [],
    pickem_events: [], pickem_questions: [], pickem_submissions: [],
  };
  return db;
}
const sb = (db: FakeSupabase) => db as unknown as SupabaseClient;
const missionView = async (db: FakeSupabase, id: string) => {
  const r = await peekProgression(sb(db), U, NOW);
  assert.ok(r.ok && r.data);
  return r.data.view.missions.find((m) => m.id === id)!;
};

/* ───────────── fuente ───────────── */

test("FUENTE · packs_opened sale de user_game.packs_opened; profiles.packs_opened solo como clave legacy", async () => {
  const facts = await loadFacts(sb(seed([], 3, 99)), U);
  assert.equal(facts.metrics.packs_opened, 3);
  assert.equal(facts.metrics[legacyMetricKey("packs_opened")], 99);
  assert.equal(facts.ctx.packsOpened, 3, "los logros de sobres cuentan aperturas reales");
});

test("FUENTE · sin fila en user_game (nunca abrió): 0", async () => {
  const facts = await loadFacts(sb(seed([], null, 0)), U);
  assert.equal(facts.metrics.packs_opened, 0);
});

test("FUENTE · poseer sobres o haberlos comprado no suma: la métrica ignora user_packs y el libro mayor", async () => {
  const db = seed([], 2, 0);
  db.tables.user_packs = [{ user_id: U, pack_id: "estandar", qty: 9 }];
  db.tables.credit_transactions = [{ user_id: U, reason: "buy_pack:estandar", delta: -750 }];
  db.tables.economy_ops = [{ ref: "pack:buy:x", user_id: U, kind: "buy_pack" }];
  assert.equal((await loadFacts(sb(db), U)).metrics.packs_opened, 2);
});

/* ───────────── lectura de misiones ───────────── */

test("LEGACY · misión con baseline antigua y 5 aperturas reales: 0 / 1 (no se reinterpreta)", async () => {
  const v = await missionView(seed([abrir()], 5, 0), "d-abrir-1");
  assert.equal(v.current, 0);
  assert.equal(v.complete, false);
});

test("REBASEADA · baseline 5 v2: comprar/recibir (contador 5) = 0; abrir 1 (contador 6) = 1 y completa", async () => {
  assert.equal((await missionView(seed([abrir({ baseline: 5, metricVersion: 2 })], 5), "d-abrir-1")).current, 0);
  const done = await missionView(seed([abrir({ baseline: 5, metricVersion: 2 })], 6), "d-abrir-1");
  assert.equal(done.current, 1);
  assert.equal(done.complete, true);
  assert.equal(done.claimed, false, "completar no reclama");
});

test("REBASEADA · semanal: +3 aperturas = 3 / 10; nunca por encima de 10", async () => {
  assert.equal((await missionView(seed([sobres10({ baseline: 5, metricVersion: 2 })], 8), "w-sobres-10")).current, 3);
  assert.equal((await missionView(seed([sobres10({ baseline: 5, metricVersion: 2 })], 50), "w-sobres-10")).current, 10);
});

test("SIN REBASE EN LECTURAS · peekProgression no escribe ni cambia la baseline legacy", async () => {
  const db = seed([abrir(), sobres10()], 5, 0);
  const before = JSON.stringify(db.tables.user_pass);
  await peekProgression(sb(db), U, NOW);
  assert.deepEqual(db.writes, []);
  assert.equal(JSON.stringify(db.tables.user_pass), before);
});

test("SIN REBASE EN LECTURAS · getProgression (ventana viva, sin rotación) tampoco rebasea ni escribe", async () => {
  // `getProgression` usa el reloj real: la tanda se asigna «hace un minuto» para que no toque rotar.
  const fresh = Date.now() - 60_000;
  const db = seed([abrir({ assignedAt: fresh }), sobres10({ assignedAt: fresh })], 5, 0);
  const r = await getProgression(sb(db), U);
  assert.ok(r.ok);
  assert.deepEqual(db.writes, [], "sin rotación ni carril pendientes, leer no escribe");
  const persisted = db.tables.user_pass[0].state as { missions: M[] };
  assert.ok(persisted.missions.every((m) => m.metricVersion === undefined && m.baseline === 0), "ninguna lectura aplica el rebase");
});

test("DAILY LOOP · refleja el progreso corregido (reclamable tras una apertura real) y sigue sin escribir", async () => {
  const db = seed([abrir({ baseline: 5, metricVersion: 2 })], 6);
  const r = await getDailyLoop(sb(db), U, { now: NOW });
  assert.ok(r.ok && r.data);
  assert.equal(r.data.objectives!.claimable, 1);
  // Fase 40 · cuenta sin partidas terminadas = primera sesión: su paso va primero (rango 0.5) y «Reclamar» sigue detrás.
  const ids = [r.data.primaryAction.id, ...r.data.secondaryActions.map((a) => a.id)];
  assert.ok(r.data.primaryAction.id === "claim" || (r.data.journey?.status === "ACTIVE" && r.data.primaryAction.id.startsWith("journey-")), r.data.primaryAction.id);
  assert.ok(ids.includes("claim"), ids.join(","));
  assert.deepEqual(db.writes, []);
});

test("DAILY LOOP · con baseline legacy no aparece «Reclamar» ni «casi completado» falso", async () => {
  const db = seed([abrir(), sobres10()], 5, 0);
  const r = await getDailyLoop(sb(db), U, { now: NOW });
  assert.equal(r.data!.objectives!.claimable, 0);
  assert.equal(r.data!.objectives!.near, null);
  assert.deepEqual(db.writes, []);
});

/* ───────────── plan y SQL del rebase ───────────── */

test("PLAN · con los datos reales exportados: QA rebaseada 0→5, caducadas intactas, exposición 200 créditos + 150 XP evitada", () => {
  const rows = [
    { userId: "8c326e52-776a-43f4-ba05-3ad7945c40c3", seasonId: "nexus-s1", legacy: 0, current: 5, state: { missions: [abrir(), sobres10()] } },
    { userId: "9137ee57-0000-4000-8000-000000000000", seasonId: "nexus-s1", legacy: 0, current: 0, state: { missions: [abrir({ assignedAt: Date.parse("2026-09-11T18:05:35.883Z") }), sobres10({ assignedAt: Date.parse("2026-09-11T18:05:35.883Z") })] } },
  ];
  const plan = planPackRebase(rows, NOW);
  assert.deepEqual(plan[0].updates.map((u) => [u.id, u.fromBaseline, u.toBaseline, u.metricVersion]), [["d-abrir-1", 0, 5, 2], ["w-sobres-10", 0, 5, 2]]);
  assert.deepEqual(plan[1].reports.map((r) => r.outcome), ["SKIPPED_EXPIRED", "SKIPPED_EXPIRED"]);
  const exp = naiveExposure(plan);
  assert.deepEqual([exp.credits, exp.passXp, exp.packs, exp.giftedProgress], [200, 150, 0, 6]);
});

test("SQL · una transacción, guardas de deriva, casa por id+assignedAt+baseline+sin versión, ROLLBACK en probe y COMMIT en apply", () => {
  const plan = planPackRebase([{ userId: "8c326e52-776a-43f4-ba05-3ad7945c40c3", seasonId: "nexus-s1", legacy: 0, current: 5, state: { missions: [abrir()] } }], NOW);
  const probe = buildRebaseSql(plan, "probe");
  const apply = buildRebaseSql(plan, "apply");
  assert.ok(probe.trim().endsWith("rollback;") && apply.trim().endsWith("commit;"));
  assert.equal((probe.match(/^begin;$/gm) ?? []).length, 1);
  assert.ok(apply.includes("DRIFT user_game") && apply.includes("DRIFT profiles") && apply.includes("ROWCOUNT") && apply.includes("VERIFY"));
  assert.ok(apply.includes("not (e.m ? 'metricVersion')"));
  assert.ok(!/credits|credit_transactions|user_packs|user_cards|claimed'\s*,\s*true|app_grant|insert into/i.test(apply.replace(/'claimed=' \|\| \(m->>'claimed'\)/g, "")), "el rebase no concede, no reclama, no inserta");
});

test("SQL · sin cambios planificados no toca nada; ids no válidos abortan el plan", () => {
  assert.ok(buildRebaseSql([], "apply").includes("null;"));
  assert.throws(() => planPackRebase([{ userId: "'; drop table x; --", seasonId: "s", legacy: 0, current: 0, state: {} }], NOW));
});

/* ───────────── contrato SQL real (lo que las sondas probaron) ───────────── */

const MIG = (name: string) => read(`supabase/migrations/${name}`);
const fnBody = (sql: string, fn: string) => {
  const i = sql.lastIndexOf(`create or replace function public.${fn}(`);
  assert.ok(i >= 0, fn);
  return sql.slice(i, sql.indexOf("$$;", i));
};

test("SQL · COMPRAR (app_buy_pack) no toca user_game", () => {
  assert.ok(!/user_game/.test(fnBody(MIG("0019_economy_ledger.sql"), "app_buy_pack")));
});

test("SQL · RECIBIR (app_grant_pack, app_grant_reward) no toca user_game; el alta crea la fila a 0", () => {
  assert.ok(!/user_game/.test(fnBody(MIG("0011_server_authority.sql"), "app_grant_pack")));
  assert.ok(!/user_game/.test(fnBody(MIG("0013_pickem_rewards.sql"), "app_grant_reward")));
  assert.ok(MIG("0011_server_authority.sql").includes("insert into public.user_game  (user_id) values (new.id);"));
});

test("SQL · ABRIR suma exactamente +1 y el reintento con la misma clave vuelve ANTES de sumar", () => {
  const body = fnBody(MIG("0019_economy_ledger.sql"), "app_apply_pack_open");
  const early = body.indexOf("if v_prev is not null then return v_prev || jsonb_build_object('repeated', true); end if;");
  const inc = body.indexOf("packs_opened = public.user_game.packs_opened + 1");
  const op = body.indexOf("values (p_ref, p_user, 'open_pack', v_prev);");
  assert.ok(early > 0 && inc > early && op > inc, "clave → consumo → +1 → economy_ops");
  assert.equal((body.match(/packs_opened \+ 1/g) ?? []).length, 1);
  assert.ok(body.includes("for update"), "el sobre se bloquea: dos pestañas no consumen el mismo");
  assert.ok(MIG("0019_economy_ledger.sql").includes("ref        text primary key,"), "misma clave = una operación (PK)");
  const later = readdirSync(join(ROOT, "supabase", "migrations")).filter((f) => f.slice(0, 4) > "0019" && MIG(f).includes("function public.app_apply_pack_open("));
  assert.deepEqual(later, [], "ninguna migración posterior redefine la apertura");
});

test("SQL · la app SIEMPRE abre con clave de idempotencia (gesto del cliente o UUID del servidor)", () => {
  const packs = code(read("src/server/services/packs.ts"));
  assert.ok(packs.includes('p_ref: packOpRef(userId, "open", gesture ?? anonymousGesture()),'));
});

test("SEGURIDAD · el cliente no puede escribir user_game ni profiles.packs_opened", () => {
  const m11 = MIG("0011_server_authority.sql");
  assert.ok(/revoke insert, update, delete on public\.user_game\s+from anon, authenticated;/.test(m11));
  assert.ok(MIG("0027_drop_profiles_tokens.sql").includes("SEC-02: packs_opened solo lo modifica el servidor"));
});

test("SEGURIDAD · ninguna ruta acepta contador, progreso, baseline ni versión del cliente", () => {
  const route = code(read("src/app/api/game/progression/route.ts"));
  for (const k of ["openedCount", "packsOpened", "packs_opened", "progress", "baseline", "metricVersion", "current"]) {
    assert.ok(!new RegExp(`body\\.${k}\\b`).test(route), k);
  }
  const packsRoute = code(read("src/app/api/game/packs/route.ts"));
  assert.ok(!/body\.(openedCount|progress|baseline|metricVersion|packsOpened)/.test(packsRoute));
  const apiDir = join(ROOT, "src", "app", "api", "game");
  assert.ok(!readdirSync(apiDir).some((d) => /objective|increment|counter/i.test(d)), "sin endpoint para incrementar");
});

test("ECONOMÍA · recompensas de las misiones de sobres y precio del sobre estándar sin cambios", () => {
  const defs = CURRENT_SEASON.missionPool.filter((d) => d.metric === "packs_opened").map((d) => [d.id, d.reward.credits, d.xp]);
  assert.deepEqual(defs, [["d-abrir-1", 200, 150], ["w-sobres-10", 1500, 900]]);
  assert.ok(!/telemetry_events/.test(code(read("src/server/services/progression.ts"))), "la telemetría no es fuente de progreso");
});
