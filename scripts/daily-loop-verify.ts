/**
 * FASE 36 · VERIFICADOR DEL DAILY LOOP — `npm run daily-loop:verify` (todo) o
 *   `daily-loop-priority:verify` · `daily-loop-security:verify`.
 *
 * Sin base de datos real: dominio puro + servicio contra `FakeSupabase` (registra escrituras y RPC) + lectura del
 * código de la ruta. Lo que requiere Postgres (RLS, PostgREST, `app_rate_take`): NO EJECUTADO — REQUIERE BD DE
 * PRUEBAS AISLADA.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildDailyLoop, dailyActions, dailyCandidates, DAILY_ROUTES, type DailyLoopFacts } from "../src/domain/dailyLoop";
import { nearObjective, type MetaObjective } from "../src/domain/progression/meta";
import { freshPassState } from "../src/battlepass";
import { CURRENT_SEASON } from "../src/data/season";
import { SEASON_CALENDAR } from "../src/data/seasonCalendar";
import { FakeSupabase } from "../src/server/services/testing/fakeSupabase";
import { getDailyLoop } from "../src/server/services/dailyLoop";
import { RATE_POLICY } from "../src/server/services/rateLimit";

const section = process.argv[2] ?? "all";
let ok = 0; let ko = 0;
const check = (label: string, cond: boolean, detail = "") => { if (cond) ok++; else ko++; console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`); };
const want = (s: string) => section === "all" || section === s;
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

const NOW = Date.parse(SEASON_CALENDAR[0].startsAt) + 9 * 86_400_000;
const H = 3600_000;
const obj = (o: Partial<MetaObjective> & { id: string }): MetaObjective => ({
  label: o.id, kind: "daily", current: 0, goal: 5, complete: false, claimed: false, rewardCredits: 0, xp: 0, metric: "duels_played",
  packId: null, packCount: 0, assignedAt: NOW - H, expiresAt: NOW + 5 * H, ...o,
});

function facts(o: Partial<DailyLoopFacts> = {}): DailyLoopFacts {
  return {
    now: NOW, signedIn: true, catalogSize: 772, matches: [], social: { incoming: 0, from: null },
    progression: {
      account: { level: 5, xp: 1000, xpIntoLevel: 100, xpForNext: 500, progress: 0.2 }, pass: null, claimableLevels: 0, objectives: [],
      achievements: { total: 10, claimed: 0, claimable: 0, near: null }, rotationPending: false,
      metrics: { ownedCards: 30, distinctCards: 25, packsOpened: 5, duelsPlayed: 4 },
    },
    pickems: { pending: 0, open: 0, eventId: null, eventName: null }, packs: { unopened: 0 },
    decks: { total: 1, valid: 1, active: { id: "d", name: "E", valid: true, size: 10, sumOvr: 800 }, firstInvalid: null },
    campaign: { completed: 1, total: 15, complete: false, next: { nodeId: "c1-n2", name: "N2", team: "LOUD", chapterOrder: 1 } },
    competitive: { rating: null, gamesPlayed: 0, wins: 0, losses: 0, draws: 0, provisional: true, position: null, rankedTotal: 10, recent: [] },
    live: [], season: { current: null, next: null }, ...o,
  };
}
const prog = (p: Partial<NonNullable<DailyLoopFacts["progression"]>>, o: Partial<DailyLoopFacts> = {}) => facts({ ...o, progression: { ...facts().progression!, ...p } });

function routeExists(href: string): boolean {
  let dir = join(process.cwd(), "src", "app");
  for (const seg of href.split(/[?#]/)[0].split("/").filter(Boolean)) {
    if (existsSync(join(dir, seg))) { dir = join(dir, seg); continue; }
    const dyn = readdirSync(dir).find((d) => /^\[[^.\]]+\]$/.test(d));
    if (!dyn) return false;
    dir = join(dir, dyn);
  }
  return existsSync(join(dir, "page.tsx"));
}

async function main() {
  if (want("priority")) {
    console.log("\n· PRIORIDAD (dominio puro, una sola autoridad)");
    const cases: [string, DailyLoopFacts, string][] = [
      // Fase 40 · la primera sesión la guía el recorrido (`domain/journey`) dentro de este mismo motor.
      ["cuenta nueva → abrir su primer sobre (recorrido)", prog({ metrics: { ownedCards: 0, distinctCards: 0, packsOpened: 0, duelsPlayed: 0 } }, { packs: { unopened: 4 }, decks: { total: 0, valid: 0, active: null, firstInvalid: null }, journey: { ownedCards: 0, packsOpened: 0, matchesCompleted: 0, unopenedPacks: 4, firstPackId: "inicial", decks: { total: 0, valid: 0, firstInvalid: null }, readyDeck: null, readiness: { ready: false, dataVersion: null, roles: [], shortages: [] } } }), "journey-open"],
      ["sin equipo → crear equipo", facts({ decks: { total: 0, valid: 0, active: null, firstInvalid: null } }), "create-team"],
      ["equipo inválido → editar equipo", facts({ decks: { total: 1, valid: 0, active: null, firstInvalid: { id: "b", name: "B", valid: false, size: 6, sumOvr: 1 } } }), "edit-team"],
      ["PvE a medias → continuar", facts({ matches: [{ id: "m", mode: "PVE", difficulty: "EASY", opponent: null, node: null }] }), "resume-pve"],
      ["ranked a medias → continuar", facts({ matches: [{ id: "m", mode: "RANKED", difficulty: null, opponent: "X", node: null }] }), "resume-ranked"],
      ["privada a medias → continuar", facts({ matches: [{ id: "m", mode: "PRIVATE", difficulty: null, opponent: null, node: null }] }), "resume-private"],
      ["reto recibido → responder", facts({ social: { incoming: 1, from: "A" } }), "challenge"],
      ["logro reclamable → reclamar", prog({ achievements: { total: 10, claimed: 0, claimable: 1, near: null } }), "claim"],
      ["Pick'em pendiente → predicción", facts({ pickems: { pending: 2, open: 2, eventId: null, eventName: null } }), "predict"],
      ["objetivo 4/5 → completar", prog({ objectives: [obj({ id: "o", current: 4 })] }), "objective"],
      ["sobres → abrir", facts({ packs: { unopened: 3 } }), "open"],
      ["campaña disponible → continuar", facts(), "campaign"],
      ["campaña completada → competitivo", facts({ campaign: { completed: 15, total: 15, complete: true, next: null } }), "ranked"],
      ["sin campaña ni ranked → partida rápida", facts({ campaign: null, competitive: null }), "quick"],
      ["equipos caídos → hub de modos", facts({ decks: null }), "play-hub"],
      ["anónimo → entrar", { ...facts(), signedIn: false }, "sign-in"],
    ];
    for (const [label, f, id] of cases) check(label, dailyActions(f).primary.id === id, dailyActions(f).primary.id);

    const everything = prog({ claimableLevels: 3, objectives: [obj({ id: "o", current: 4 })], metrics: { ownedCards: 0, distinctCards: 0, packsOpened: 0, duelsPlayed: 0 } }, {
      matches: [{ id: "m", mode: "PVE", difficulty: "EASY", opponent: null, node: null }], social: { incoming: 3, from: "A" },
      pickems: { pending: 5, open: 5, eventId: null, eventName: null }, packs: { unopened: 9 },
      live: [{ id: "e", name: "E", lifecycle: "ACTIVE", isDemo: false, startDate: null, endDate: null, liveCount: 2, liveMatch: null, nextMatch: null, pickem: null }],
    });
    check("P0 · la partida a medias gana a todo a la vez", dailyActions(everything).primary.kind === "resume");
    check("determinista", JSON.stringify(buildDailyLoop(facts())) === JSON.stringify(buildDailyLoop(facts())));
    check("≤ 3 secundarias sin tipos repetidos", (() => { const { primary, secondary } = dailyActions(everything); const k = [primary, ...secondary].map((a) => a.kind); return secondary.length <= 3 && new Set(k).size === k.length; })());
    check("casi completado exige denominador y ventana viva", nearObjective([obj({ id: "a", current: 3, goal: 0 }), obj({ id: "b", current: 4, expiresAt: NOW - 1 })], NOW) === null);
    check("sin partido en juego no hay «en directo»", !/directo/i.test(JSON.stringify(dailyCandidates(facts({ live: [{ id: "e", name: "E", lifecycle: "ACTIVE", isDemo: false, startDate: null, endDate: null, liveCount: 0, liveMatch: null, nextMatch: null, pickem: null }] })))));
    check("todas las rutas del Daily Loop existen", Object.values(DAILY_ROUTES).every(routeExists), Object.values(DAILY_ROUTES).filter((r) => !routeExists(r)).join(","));
  }

  if (want("security")) {
    console.log("\n· SEGURIDAD Y LECTURA PURA (servicio contra Supabase en memoria + código de la ruta)");
    const U = "aaaaaaaa-0000-4000-8000-000000000001";
    const O = "bbbbbbbb-0000-4000-8000-000000000002";
    const db = new FakeSupabase();
    const state = freshPassState(CURRENT_SEASON.id);
    state.missions = [{ id: "d-duelo-1", kind: "daily", metric: "duels_played", goal: 1, baseline: 0, claimed: false, assignedAt: NOW - 3 * 86_400_000 }];
    db.tables = {
      profiles: [{ id: U, username: "Yo", xp: 500, credits: 4000, points: 999_999, email: "me-secret@example.com", is_admin: true }, { id: O, username: "Rival", credits: 123_456, email: "o-secret@example.com" }],
      user_pass: [{ user_id: U, season_id: CURRENT_SEASON.id, state }], user_cards: [], user_achievements: [], user_cosmetics: [],
      user_packs: [{ user_id: U, pack_id: "estandar", qty: 1 }],
      duel_matches: [{ id: "pvp", user_id: O, player_b_id: U, mode: "PVP", status: "IN_PROGRESS", closed_reason: null, state: { hand: ["SECRET_CARD"] }, rng: { s: "SECRET_RNG" } }],
      duel_decks: [], duel_challenges: [], duel_pvp_ratings: [], duel_pvp_rating_events: [],
      events: [], matches: [], stages: [], pickem_events: [], pickem_questions: [], pickem_submissions: [], pickem_answers: [{ question_id: "q", submission_id: "s", option_key: "SECRET_PICK" }],
    };
    const before = JSON.stringify(db.tables);
    const r = await getDailyLoop(db as unknown as SupabaseClient, U, { now: NOW });
    const json = JSON.stringify(r.data ?? {});
    check("lectura correcta", r.ok && !!r.data);
    check("cero escrituras", db.writes.length === 0, db.writes.join(","));
    check("ninguna RPC de escritura", db.rpcs.every((x) => x === "app_content_distribution_snapshot"), db.rpcs.join(","));
    check("las tablas quedan idénticas (sin rating, carril, rotación, progreso, equipo activo, créditos ni sobres)", JSON.stringify(db.tables) === before);
    check("rotación pendiente dicha, no hecha", r.data?.objectives?.rotationPending === true);
    for (const secret of ["@example.com", "is_admin", "credits", "123456", "999999", "SECRET_CARD", "SECRET_RNG", "SECRET_PICK", O]) check(`no filtra ${secret}`, !json.includes(secret));
    check("rival humano por nombre público", r.data?.primaryAction.title === "Contra Rival");

    const anon = new FakeSupabase();
    anon.tables = db.tables;
    const ra = await getDailyLoop(anon as unknown as SupabaseClient, null, { now: NOW });
    check("anónimo: sin lecturas personales", !anon.reads.some((t) => ["profiles", "user_pass", "user_packs", "duel_matches", "pickem_answers"].includes(t)), anon.reads.join(","));
    check("anónimo: acción entrar", ra.data?.primaryAction.id === "sign-in");

    const broken = new FakeSupabase();
    broken.tables = JSON.parse(before);
    broken.failTables.add("duel_challenges"); broken.failTables.add("events");
    const rb = await getDailyLoop(broken as unknown as SupabaseClient, U, { now: NOW });
    check("subsistemas caídos aislados", !!rb.ok && !!rb.data?.unavailable.includes("social") && !!rb.data?.unavailable.includes("live") && !!rb.data?.player);
    check("lecturas acotadas (≤ 45 por foto)", db.reads.length <= 45, String(db.reads.length));

    const route = read("src/app/api/game/daily-loop/route.ts");
    check("ruta: solo GET", /export async function GET\(/.test(route) && !/export (async )?function (POST|PUT|PATCH|DELETE)/.test(route));
    check("ruta: ningún parámetro admitido (?userId= → 400)", route.includes("if ([...q.keys()].length > 0)"));
    check("ruta: personal no-store", route.includes("headers: userId ? NO_STORE : PUBLIC_SHORT"));
    check("ruta: límite de lectura propio", route.includes('"daily_loop_read"') && RATE_POLICY.daily_loop_read.limit <= 120);
    check("servicio sin escrituras en el código", !/\.(insert|update|upsert|delete)\(|\.rpc\(|ensureRating\(|getProgression\(/.test(code(read("src/server/services/dailyLoop.ts"))));
    check("sin migración 0052 del Daily Loop (la única 0052 es la de favoritos, Fase 37)", readdirSync(join(process.cwd(), "supabase", "migrations")).filter((f) => f.startsWith("0052")).every((f) => f === "0052_collection_favorites.sql"));
    console.log("  · RLS / PostgREST / app_rate_take reales: NO EJECUTADO — REQUIERE BD DE PRUEBAS AISLADA");
  }

  console.log(`\n${ok} ✓ · ${ko} ✗`);
  if (ko > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
