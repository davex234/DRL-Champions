/**
 * FASE 36.1 · VERIFICADOR DEL CONTADOR DE SOBRES — `npm run pack-objective:verify` (todo) o
 *   `pack-objective-rebase:verify` · `pack-objective-security:verify`.
 *
 * Sin base de datos real: motor puro, rebase puro, servicio contra `FakeSupabase` y el SQL de las migraciones.
 * La semántica real de las RPC contra Postgres está en docs/product/qa/fase36-1/db-evidence.md (sondas con
 * ROLLBACK). RLS/PostgREST reales: NO EJECUTADO — REQUIERE BD DE PRUEBAS AISLADA.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { freshPassState, PassEngine } from "../src/battlepass";
import { METRIC_VERSIONS, legacyMetricKey, missionProgress, assignMission } from "../src/battlepass/missions";
import { rebaseMission } from "../src/battlepass/metricRebase";
import type { ActiveMission } from "../src/battlepass/types";
import { CURRENT_SEASON } from "../src/data/season";
import { FakeSupabase } from "../src/server/services/testing/fakeSupabase";
import { loadFacts, peekProgression } from "../src/server/services/progression";
import { getDailyLoop } from "../src/server/services/dailyLoop";
import { planPackRebase, buildRebaseSql, naiveExposure } from "../src/server/services/progressionRebase";

const section = process.argv[2] ?? "all";
let ok = 0; let ko = 0;
const check = (label: string, cond: boolean, detail = "") => { if (cond) ok++; else ko++; console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`); };
const want = (s: string) => section === "all" || section === s;
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

const NOW = Date.parse("2026-09-15T17:00:00.000Z");
const TODAY = Date.parse("2026-09-15T13:21:50.200Z");
const U = "aaaaaaaa-0000-4000-8000-000000000361";
const LEGACY = legacyMetricKey("packs_opened");
const mission = (o: Partial<ActiveMission> = {}): ActiveMission => ({ id: "d-abrir-1", kind: "daily", metric: "packs_opened", goal: 1, baseline: 0, claimed: false, assignedAt: TODAY, ...o });
const snap = (current: number, legacy = 0) => ({ packs_opened: current, [LEGACY]: legacy });

function world(missions: ActiveMission[], game: number, legacy = 0) {
  const db = new FakeSupabase();
  const state = freshPassState(CURRENT_SEASON.id);
  state.missions = missions;
  db.tables = {
    profiles: [{ id: U, username: "qa", xp: 0, credits: 1000, points: 0, packs_opened: legacy, region: null, equipped: {} }],
    user_pass: [{ user_id: U, season_id: CURRENT_SEASON.id, state }],
    user_game: [{ user_id: U, pity: {}, packs_opened: game }],
    user_cards: [], user_achievements: [], user_cosmetics: [], user_packs: [{ user_id: U, pack_id: "estandar", qty: 4 }],
    duel_matches: [], duel_decks: [], pickem_answers: [], duel_challenges: [], duel_pvp_ratings: [], duel_pvp_rating_events: [],
    events: [], matches: [], stages: [], pickem_events: [], pickem_questions: [], pickem_submissions: [],
  };
  return db;
}

const fnBody = (file: string, fn: string) => {
  const sql = read(`supabase/migrations/${file}`);
  const i = sql.lastIndexOf(`create or replace function public.${fn}(`);
  return i < 0 ? "" : sql.slice(i, sql.indexOf("$$;", i));
};

async function main() {
  if (want("counter")) {
    console.log("\n· CONTADOR (fuente canónica y semántica)");
    const facts = await loadFacts(world([], 3, 99) as unknown as SupabaseClient, U);
    check("packs_opened = user_game.packs_opened (aperturas reales)", facts.metrics.packs_opened === 3, String(facts.metrics.packs_opened));
    check("profiles.packs_opened solo como clave legacy", facts.metrics[LEGACY] === 99);
    check("poseer 4 sobres no suma", facts.metrics.packs_opened === 3);
    const open = fnBody("0019_economy_ledger.sql", "app_apply_pack_open");
    check("abrir = +1 una sola vez por llamada", (open.match(/packs_opened \+ 1/g) ?? []).length === 1);
    check("reintento con la misma clave vuelve antes de sumar", open.indexOf("'repeated', true") > 0 && open.indexOf("'repeated', true") < open.indexOf("packs_opened + 1"));
    check("comprar no toca el contador", fnBody("0019_economy_ledger.sql", "app_buy_pack").length > 0 && !/user_game/.test(fnBody("0019_economy_ledger.sql", "app_buy_pack")));
    check("recibir (grant_pack / grant_reward) no toca el contador", !/user_game/.test(fnBody("0011_server_authority.sql", "app_grant_pack")) && !/user_game/.test(fnBody("0013_pickem_rewards.sql", "app_grant_reward")));
    check("ninguna migración posterior redefine la apertura", readdirSync(join(process.cwd(), "supabase", "migrations")).filter((f) => f.slice(0, 4) > "0019" && read(`supabase/migrations/${f}`).includes("function public.app_apply_pack_open(")).length === 0);
    const def = CURRENT_SEASON.missionPool.find((d) => d.id === "d-abrir-1")!;
    const fresh = assignMission(def, snap(7), NOW);
    check("misiones nuevas nacen con la fuente vigente", fresh.metricVersion === METRIC_VERSIONS.packs_opened && fresh.baseline === 7);
    check("vigente: +1 apertura = +1", missionProgress(fresh, snap(8)) === 1);
    check("legacy: 5 aperturas anteriores no completan nada", missionProgress(mission(), snap(5, 0)) === 0);
    const e = new PassEngine(Object.assign(freshPassState(CURRENT_SEASON.id), { missions: [mission()] }), CURRENT_SEASON);
    check("legacy no reclamable sin progreso real", !e.completeMission("d-abrir-1", snap(5, 0), NOW).ok);
  }

  if (want("rebase")) {
    console.log("\n· REBASE (transición conservadora)");
    const cases: [string, ActiveMission, number, number, string, number | null][] = [
      ["cero", mission(), 0, 5, "REBASED", 0],
      ["parcial", mission({ id: "w-sobres-10", kind: "weekly", goal: 10, baseline: 2 }), 6, 30, "REBASED", 4],
      ["casi completa", mission({ id: "w-sobres-10", kind: "weekly", goal: 10 }), 9, 3, "REBASED", 9],
      ["completa sin reclamar", mission(), 1, 0, "REBASED", 1],
      ["reclamada", mission({ claimed: true, kind: "seasonal" }), 1, 9, "SKIPPED_CLAIMED", null],
      ["caducada", mission({ assignedAt: TODAY - 3 * 86_400_000 }), 0, 12, "SKIPPED_EXPIRED", null],
      ["ya vigente", mission({ baseline: 5, metricVersion: 2 }), 0, 9, "ALREADY_CURRENT", null],
    ];
    for (const [label, m, legacy, current, outcome, visible] of cases) {
      const r = rebaseMission(m, { packs_opened: { legacy, current } }, NOW);
      const progressNow = missionProgress(r.mission, snap(current, legacy));
      check(`${label} → ${outcome}`, r.report.outcome === outcome && (visible === null || progressNow === visible), `${r.report.outcome} progreso=${progressNow}`);
    }
    const plan = planPackRebase([{ userId: "8c326e52-776a-43f4-ba05-3ad7945c40c3", seasonId: "nexus-s1", legacy: 0, current: 5, state: { missions: [mission(), mission({ id: "w-sobres-10", kind: "weekly", goal: 10 })] } }], NOW);
    const exposure = naiveExposure(plan);
    check("exposición evitada (datos reales QA): 200 créditos + 150 XP del pase", exposure.credits === 200 && exposure.passXp === 150, JSON.stringify(exposure));
    const sql = buildRebaseSql(plan, "apply");
    check("SQL con guardas de deriva, fila única y verificación", ["DRIFT user_game", "DRIFT profiles", "ROWCOUNT", "VERIFY"].every((k) => sql.includes(k)));
    check("SQL probe termina en ROLLBACK", buildRebaseSql(plan, "probe").trim().endsWith("rollback;"));
    check("SQL sin concesiones ni reclamos", !/insert into|app_grant|credit_transactions|user_packs/i.test(sql));
  }

  if (want("security")) {
    console.log("\n· SEGURIDAD Y LECTURAS PURAS");
    const db = world([mission(), mission({ id: "w-sobres-10", kind: "weekly", goal: 10 })], 5, 0);
    const before = JSON.stringify(db.tables);
    await peekProgression(db as unknown as SupabaseClient, U, NOW);
    const loop = await getDailyLoop(db as unknown as SupabaseClient, U, { now: NOW });
    check("peekProgression + Daily Loop: cero escrituras", db.writes.length === 0, db.writes.join(","));
    check("leer no rebasea (tablas idénticas)", JSON.stringify(db.tables) === before);
    check("Daily Loop sin «Reclamar» falso sobre baselines legacy", loop.data?.objectives?.claimable === 0);
    const route = code(read("src/app/api/game/progression/route.ts"));
    check("la ruta de progresión no lee contador/progreso/baseline/versión del cliente", !/body\.(openedCount|packsOpened|packs_opened|progress|baseline|metricVersion)\b/.test(route));
    check("sin endpoint para incrementar objetivos", !readdirSync(join(process.cwd(), "src", "app", "api", "game")).some((d) => /objective|increment|counter/i.test(d)));
    check("cliente sin escritura en user_game", /revoke insert, update, delete on public\.user_game\s+from anon, authenticated;/.test(read("supabase/migrations/0011_server_authority.sql")));
    check("apertura siempre con clave de idempotencia", code(read("src/server/services/packs.ts")).includes('p_ref: packOpRef(userId, "open", gesture ?? anonymousGesture()),'));
    check("sin migración 0052 de progresión (la única 0052 es la de favoritos, Fase 37)", readdirSync(join(process.cwd(), "supabase", "migrations")).filter((f) => f.startsWith("0052")).every((f) => f === "0052_collection_favorites.sql"));
    console.log("  · RLS / PostgREST reales: NO EJECUTADO — REQUIERE BD DE PRUEBAS AISLADA (semántica RPC: sondas con ROLLBACK en el VPS)");
  }

  console.log(`\n${ok} ✓ · ${ko} ✗`);
  if (ko > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
