/**
 * FASE 36 · SERVICIO DAILY LOOP contra un Supabase EN MEMORIA que registra escrituras y RPC.
 *
 * Prueba lo que el vestíbulo NO hace al leer (rating, carril, rotación, campaña, equipo activo, logros,
 * créditos, sobres), lo que no filtra (correo, admin, cartas ocultas, respuestas de Pick'em, datos de
 * otros), que cada subsistema caído o lento se aísla, y que las lecturas están acotadas (sin N+1).
 * RLS, PostgREST, `or()` y `app_rate_take` reales: NO EJECUTADO — REQUIERE BD DE PRUEBAS AISLADA.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { freshPassState } from "@/battlepass";
import { CURRENT_SEASON } from "@/data/season";
import { SEASON_CALENDAR } from "@/data/seasonCalendar";
import { FakeSupabase } from "./testing/fakeSupabase";
import { getDailyLoop, LIVE_EVENTS_MAX, SUBSYSTEM_TIMEOUT_MS } from "./dailyLoop";
import type { SupabaseClient } from "@supabase/supabase-js";

const U = "aaaaaaaa-0000-4000-8000-000000000001";
const RIVAL = "bbbbbbbb-0000-4000-8000-000000000002";
const OTHER = "cccccccc-0000-4000-8000-000000000003";
const D = 86_400_000;
const S1 = SEASON_CALENDAR[0];
const START = Date.parse(S1.startsAt);
const NOW = START + 8 * D + 15.5 * 3600_000;
const iso = (ms: number) => new Date(ms).toISOString();
const FORBIDDEN_RPC = /ensure|grant|claim|settle|apply|award|equip|advance|reset|rate|open|reserve|presence|heartbeat/i;

function seed(o: { matches?: boolean; campaignAttempt?: boolean } = {}) {
  const db = new FakeSupabase();
  const state = freshPassState(CURRENT_SEASON.id);
  state.xp = 7_400; state.claimedFree = [1, 2, 3, 4, 5]; state.competitiveUnlocked = false;
  // Tanda diaria de una ventana ANTERIOR (rotación pendiente) + una semanal viva.
  state.missions = [
    { id: "d-duelo-1", kind: "daily", metric: "duels_played", goal: 1, baseline: 0, claimed: false, assignedAt: NOW - 3 * D },
    { id: "w-duelos-5", kind: "weekly", metric: "duels_played", goal: 5, baseline: 0, claimed: false, assignedAt: NOW - 3600_000 },
  ];
  db.tables = {
    profiles: [
      { id: U, username: "Yo", xp: 12_345, credits: 6_000, points: 99_999, packs_opened: 41, region: "EMEA", email: "secret-me@example.com", is_admin: true, equipped: {}, last_seen_at: iso(NOW) },
      { id: RIVAL, username: "Kira", xp: 1, credits: 777_777, points: 0, packs_opened: 0, email: "rival-secret@example.com", is_admin: true, last_seen_at: iso(NOW) },
      { id: OTHER, username: "Ana", xp: 1, credits: 888_888, points: 0, packs_opened: 0, email: "ana-secret@example.com", is_admin: false },
    ],
    user_pass: [{ user_id: U, season_id: CURRENT_SEASON.id, state }],
    user_cards: [{ uid: "c1", user_id: U, card_id: "aspas", origin: "pack", obtained_at: iso(START + D) }, { uid: "c2", user_id: U, card_id: "trent", origin: "pack", obtained_at: iso(START + D) }],
    user_achievements: [],
    user_cosmetics: [],
    user_packs: [{ user_id: U, pack_id: "estandar", qty: 2 }, { user_id: OTHER, pack_id: "estandar", qty: 50 }],
    duel_matches: [
      { id: "done", user_id: U, mode: "PVE", status: "COMPLETED", winner: "A", state: { secret: "SECRET_RIVAL_HAND" }, rng: { seed: 42 } },
      ...(o.matches ? [
        { id: "pve-open", user_id: U, mode: "PVE", status: "IN_PROGRESS", difficulty: "HARD", state: { rivalHand: ["SECRET_RIVAL_CARD"] }, rng: { seed: "SECRET_RNG" } },
        { id: "pvp-closed", user_id: U, player_b_id: RIVAL, mode: "PVP", status: "IN_PROGRESS", closed_reason: "ABANDONED", state: {} },
        { id: "pvp-open", user_id: RIVAL, player_b_id: U, mode: "PVP", status: "IN_PROGRESS", closed_reason: null, state: { hand: ["SECRET_PVP_CARD"] } },
      ] : []),
    ],
    duel_decks: [],
    campaign_attempts: o.campaignAttempt ? [{ id: "att", user_id: U, campaign_id: "road-to-champions", node_id: "c1-n2", match_id: "pve-open", status: "STARTED" }] : [],
    duel_challenges: [
      { id: "ch1", challenger_id: OTHER, challenged_id: U, status: "PENDING", created_at: iso(NOW - 600_000), expires_at: iso(NOW + 600_000) },
      { id: "ch2", challenger_id: RIVAL, challenged_id: U, status: "PENDING", created_at: iso(NOW - 900_000), expires_at: iso(NOW - 1) },
      { id: "ch3", challenger_id: U, challenged_id: OTHER, status: "PENDING", created_at: iso(NOW - 60_000), expires_at: iso(NOW + 600_000) },
    ],
    duel_pvp_ratings: [{ user_id: OTHER, rating: 1_300, games_played: 20, wins: 12, losses: 8, draws: 0, updated_at: iso(NOW - D) }],
    duel_pvp_rating_events: [],
    events: [{ id: "ev1", name: "Masters QA", type: "masters", region: "INTL", status: "ongoing", start_date: iso(NOW - 2 * D).slice(0, 10), end_date: iso(NOW + 5 * D).slice(0, 10), source: "vlr" }],
    matches: [
      { id: "mt1", event_id: "ev1", team_a: "FNC", team_b: "G2", status: "live", start_time: iso(NOW - 3600_000), score_a: 1, score_b: 0, match_order: 1 },
      { id: "mt2", event_id: "ev1", team_a: "SEN", team_b: "PRX", status: "upcoming", start_time: iso(NOW + 3600_000), score_a: null, score_b: null, match_order: 2 },
    ],
    stages: [],
    pickem_events: [{ id: "pe1", event_id: "ev1", status: "open", title: "Pick'em QA", locks_at: iso(NOW + D), created_at: iso(NOW - D) }],
    pickem_questions: [
      { id: "q1", pickem_event_id: "pe1", locks_at: iso(NOW + D), correct_option: "SECRET_CORRECT_ANSWER" },
      { id: "q2", pickem_event_id: "pe1", locks_at: iso(NOW + D), correct_option: "SECRET_CORRECT_ANSWER" },
      { id: "q3", pickem_event_id: "pe1", locks_at: iso(NOW - 1), correct_option: "SECRET_CORRECT_ANSWER" },
    ],
    pickem_submissions: [{ id: "s1", pickem_event_id: "pe1", user_id: U }, { id: "s9", pickem_event_id: "pe1", user_id: OTHER }],
    pickem_answers: [{ id: "a1", submission_id: "s1", question_id: "q1", option_key: "SECRET_MY_PICK" }, { id: "a9", submission_id: "s9", question_id: "q2", option_key: "SECRET_OTHER_PICK" }],
  };
  return db;
}

// `FakeSupabase.client` es la propia instancia: se pasa tal cual para que los Proxy de las pruebas no se salten.
const run = async (db: FakeSupabase | SupabaseClient, userId: string | null, o: { now?: number; timeoutMs?: number } = {}) => {
  const r = await getDailyLoop(db as unknown as SupabaseClient, userId, { now: o.now ?? NOW, timeoutMs: o.timeoutMs });
  assert.ok(r.ok, r.error);
  return r.data!;
};

/** RPC de SOLO LECTURA que ya usaba el catálogo de `listDecks` (foto de distribución de contenido). */
const READ_ONLY_RPC = new Set(["app_content_distribution_snapshot"]);

const noSideEffects = (db: FakeSupabase) => {
  assert.deepEqual(db.writes, [], `escrituras: ${db.writes.join(", ")}`);
  assert.deepEqual(db.rpcs.filter((r) => FORBIDDEN_RPC.test(r) || !READ_ONLY_RPC.has(r)), [], `RPC: ${db.rpcs.join(", ")}`);
};

/* ───────────── efectos de lectura (P0) ───────────── */

test("SIN EFECTOS · leer el vestíbulo no escribe ni llama a RPC de escritura", async () => {
  const db = seed({ matches: true, campaignAttempt: true });
  await run(db, U);
  noSideEffects(db);
  assert.ok(db.rpcs.every((r) => READ_ONLY_RPC.has(r)), db.rpcs.join(","));
});

test("SIN EFECTOS · no crea la ficha ranked (ensureRating) aunque no exista", async () => {
  const db = seed();
  const s = await run(db, U);
  assert.equal(db.tables.duel_pvp_ratings.filter((r) => r.user_id === U).length, 0);
  assert.equal(s.competitive!.rating, null);
  assert.equal(s.competitive!.gamesPlayed, 0);
  noSideEffects(db);
});

test("SIN EFECTOS · no abre el carril competitivo ni rota misiones, aunque ambas cosas estén pendientes", async () => {
  const db = seed();
  const before = JSON.stringify(db.tables.user_pass);
  const s = await run(db, U);
  assert.equal(JSON.stringify(db.tables.user_pass), before);
  assert.equal(s.objectives!.rotationPending, true, "la rotación pendiente se DICE, no se hace");
  noSideEffects(db);
});

test("SIN EFECTOS · no crea progreso de campaña ni equipo activo", async () => {
  const db = seed();
  const s = await run(db, U);
  assert.equal((db.tables.campaign_progress ?? []).length, 0);
  assert.equal((db.tables.duel_active_deck ?? []).length, 0);
  assert.equal(s.campaign!.completed, 0);
  assert.ok(!db.writes.some((w) => /campaign|active_deck/.test(w)));
});

test("SIN EFECTOS · no reclama logros, no concede créditos y no abre sobres", async () => {
  const db = seed();
  const credits = db.tables.profiles.find((p) => p.id === U)!.credits;
  const s = await run(db, U);
  assert.equal(db.tables.user_achievements.length, 0);
  assert.equal(db.tables.profiles.find((p) => p.id === U)!.credits, credits);
  assert.equal((db.tables.credit_transactions ?? []).length, 0);
  assert.equal(db.tables.user_packs.find((p) => p.user_id === U)!.qty, 2);
  assert.equal(s.packs!.unopened, 2);
  noSideEffects(db);
});

test("SIN EFECTOS · dos lecturas seguidas (dos pestañas) no escriben nada y dan la misma foto", async () => {
  const db = seed({ matches: true });
  const [a, b] = await Promise.all([run(db, U), run(db, U)]);
  assert.deepEqual(a, b);
  noSideEffects(db);
});

/* ───────────── hechos reales ───────────── */

test("HECHOS · partida PvP abierta donde soy jugador B: rival público, partida exacta; la cerrada se ignora", async () => {
  const s = await run(seed({ matches: true }), U);
  assert.equal(s.primaryAction.id, "resume-ranked");
  assert.equal(s.primaryAction.title, "Contra Kira");
  assert.equal(s.primaryAction.href, "/duelos/pvp?match=pvp-open");
});

test("HECHOS · PvE abierta enlazada a un intento de campaña → contexto de nodo real", async () => {
  const db = seed({ matches: true, campaignAttempt: true });
  db.tables.duel_matches = db.tables.duel_matches.filter((m) => m.mode === "PVE");
  const s = await run(db, U);
  assert.equal(s.primaryAction.id, "resume-campaign");
  assert.equal(s.primaryAction.href, "/duelos/jugar?campaign=c1-n2");
  assert.match(s.primaryAction.title, /^Nodo «.+»$/);
});

test("HECHOS · retos: solo los recibidos, vivos por reloj del servidor; retador por nombre público", async () => {
  const s = await run(seed(), U);
  assert.deepEqual(s.social, { incoming: 1, from: "Ana" });
  assert.equal(s.primaryAction.id, "challenge");
});

test("HECHOS · Pick'ems pendientes = abiertas y sin responder por MÍ (las de otros no cuentan)", async () => {
  const s = await run(seed(), U);
  assert.equal(s.live!.pickemPending, 1, "q1 respondida por mí, q2 abierta sin responder, q3 cerrada");
});

test("HECHOS · evento con partido en directo real y marcador", async () => {
  const s = await run(seed(), U);
  assert.equal(s.live!.featured!.id, "ev1");
  assert.equal(s.live!.featured!.liveCount, 1);
  assert.deepEqual(s.live!.featured!.liveMatch, { teamA: "FNC", teamB: "G2", scoreA: 1, scoreB: 0 });
});

test("HECHOS · colección y sobres del jugador (no de otros)", async () => {
  const s = await run(seed(), U);
  assert.equal(s.collection!.owned, 2);
  assert.equal(s.packs!.unopened, 2);
});

test("HECHOS · nivel de cuenta sale de profiles.xp y el del pase del estado del pase (no se mezclan)", async () => {
  const s = await run(seed(), U);
  assert.equal(s.player!.xp, 12_345);
  assert.ok(s.season!.pass, "Temporada 1 activa: su pase es el vivo");
  assert.notEqual(s.season!.pass!.xp, s.player!.xp);
  assert.equal(s.season!.pass!.xp, 7_400);
});

test("HECHOS · con la temporada terminada no se enseña su pase como activo", async () => {
  const s = await run(seed(), U, { now: Date.parse(S1.endsAt) + D });
  assert.equal(s.season!.current, null);
  assert.equal(s.season!.pass, null);
});

test("HECHOS · sin equipos → CREAR EQUIPO no; con 2 cartas → conseguir sobres o abrir los que hay", async () => {
  const s = await run(seed(), U);
  assert.equal(s.deck!.state, "NONE");
  assert.ok(s.secondaryActions.concat(s.primaryAction).some((a) => a.id === "open"));
  assert.ok(!s.secondaryActions.concat(s.primaryAction).some((a) => a.id === "create-team"), "con 2 cartas no se puede crear un equipo de 10");
});

/* ───────────── seguridad y privacidad ───────────── */

test("PRIVACIDAD · la foto no lleva correo, admin, créditos, cartas ocultas, RNG ni respuestas de Pick'em", async () => {
  const json = JSON.stringify(await run(seed({ matches: true, campaignAttempt: true }), U));
  for (const k of ["@example.com", "is_admin", "email", "credits", "777777", "888888", "SECRET_RIVAL_CARD", "SECRET_RNG", "SECRET_PVP_CARD", "SECRET_RIVAL_HAND",
    "SECRET_CORRECT_ANSWER", "SECRET_MY_PICK", "SECRET_OTHER_PICK", "option_key", "correct_option", "baseline", "last_seen_at", "99999", RIVAL, OTHER]) {
    assert.ok(!json.includes(k), `filtra ${k}`);
  }
});

test("PRIVACIDAD · de duel_matches nunca se piden `state` ni `rng`", async () => {
  const db = seed({ matches: true });
  const selects: string[] = [];
  const spy = new Proxy(db, {
    get(target, prop) {
      if (prop === "from") return (name: string) => {
        const q = target.from(name);
        if (name !== "duel_matches") return q;
        const orig = q.select.bind(q);
        q.select = ((cols?: string, opts?: { count?: string; head?: boolean }) => { selects.push(cols ?? "*"); return orig(cols, opts); }) as typeof q.select;
        return q;
      };
      return Reflect.get(target, prop);
    },
  });
  await run(spy as unknown as SupabaseClient, U);
  assert.ok(selects.length > 0);
  for (const c of selects) assert.ok(!/\bstate\b|\brng\b|\*/.test(c), c);
});

test("ANÓNIMO · solo lo público: ni una lectura personal, acción «Entrar para jugar», sin Pick'ems propios", async () => {
  const db = seed();
  const s = await run(db, null);
  assert.equal(s.primaryAction.id, "sign-in");
  assert.equal(s.signedIn, false);
  for (const t of ["profiles", "user_pass", "user_packs", "user_cards", "duel_matches", "duel_challenges", "duel_decks", "campaign_progress", "pickem_submissions", "pickem_answers", "duel_pvp_ratings"]) {
    assert.ok(!db.reads.includes(t), `lee ${t} sin sesión`);
  }
  assert.equal(s.live!.pickemPending, 0);
  assert.equal(s.player, null);
  noSideEffects(db);
});

test("SEGURIDAD · el servicio lee SOLO al usuario pedido: los datos de otro no aparecen en mi foto", async () => {
  const db = seed();
  const mine = await run(db, U);
  const theirs = await run(db, OTHER);
  assert.equal(mine.packs!.unopened, 2);
  assert.equal(theirs.packs!.unopened, 50);
  assert.equal(theirs.competitive!.rating, 1_300);
  assert.equal(mine.competitive!.rating, null);
});

/* ───────────── aislamiento ───────────── */

for (const [table, subsystem] of [
  ["duel_challenges", "social"], ["profiles", "progression"], ["events", "live"], ["duel_decks", "decks"],
  ["user_packs", "packs"], ["duel_pvp_ratings", "competitive"], ["campaign_progress", "campaign"],
] as const) {
  test(`AISLAMIENTO · ${table} caído → «${subsystem}» no disponible y el resto de la foto sigue`, async () => {
    const db = seed();
    db.failTables.add(table);
    const s = await run(db, U);
    assert.ok(s.unavailable.includes(subsystem), `${subsystem} ∉ ${s.unavailable.join(",")}`);
    assert.ok(s.season, "la temporada no depende de la BD");
    assert.ok(!JSON.stringify(s).includes("secret_column"), "sin detalles internos del error");
    noSideEffects(db);
  });
}

test("AISLAMIENTO · partidas caídas → no se recomienda retomar nada", async () => {
  const db = seed({ matches: true });
  db.failTables.add("duel_matches");
  const s = await run(db, U);
  assert.ok(s.unavailable.includes("match"));
  assert.ok(![s.primaryAction, ...s.secondaryActions].some((a) => a.kind === "resume"));
});

test("TIEMPO MÁXIMO · un subsistema que no responde se degrada sin congelar el vestíbulo", async () => {
  const db = seed();
  const never: PromiseLike<never> & Record<string, unknown> = new Proxy({} as PromiseLike<never> & Record<string, unknown>, {
    get(_t, prop) { return prop === "then" ? () => undefined : () => never; },
  });
  const slow = new Proxy(db, { get(t, prop) { return prop === "from" ? (n: string) => (n === "user_packs" ? never : t.from(n)) : Reflect.get(t, prop); } });
  const t0 = Date.now();
  const s = await run(slow as unknown as SupabaseClient, U, { timeoutMs: 60 });
  assert.ok(Date.now() - t0 < 2_000, "no espera a los reintentos");
  assert.equal(s.packs, null);
  assert.ok(s.unavailable.includes("packs"));
  assert.ok(s.player, "lo demás llega");
  assert.ok(SUBSYSTEM_TIMEOUT_MS <= 5_000);
});

/* ───────────── lecturas acotadas ───────────── */

test("ACOTADO · número de lecturas fijo: no crece con objetivos, logros, sobres, retos ni eventos (sin N+1)", async () => {
  const small = seed();
  await run(small, U);
  const big = seed();
  for (let i = 0; i < 30; i++) {
    big.tables.user_packs.push({ user_id: U, pack_id: `p${i}`, qty: 1 });
    big.tables.duel_challenges.push({ id: `x${i}`, challenger_id: OTHER, challenged_id: U, status: "PENDING", created_at: iso(NOW - i), expires_at: iso(NOW + D) });
    big.tables.user_achievements.push({ user_id: U, achievement_id: `a${i}`, claimed_at: null });
    big.tables.events.push({ id: `e${i}`, name: `E${i}`, status: "upcoming", start_date: iso(NOW + (i + 1) * D).slice(0, 10), end_date: null, source: "vlr" });
  }
  await run(big, U);
  assert.equal(big.reads.length, small.reads.length, `${small.reads.length} → ${big.reads.length}`);
  // SANEAMIENTO POST F47 · 45 → 46: contar las respuestas de pick’em exige leer antes las ENTREGAS del
  // jugador (`pickem_answers` no tiene `user_id`, 0012). Es UNA lectura constante más, no un N+1: la
  // invariante de arriba —el número de lecturas no crece con los datos— es la que sigue mandando.
  // F87 · 46 → 47: UNA lectura constante de cuadros publicados (Pick'ems 2.0). Sin cuadros no lee nada más; con
  // ellos, unas pocas por cuadro con tope de 5 cuadros — no crece con objetivos, logros, sobres, retos ni eventos.
  // CORE GAME LOOP · 47 → 50: «partidas que cuentan» (`matchCounts`) lee los DOS asientos de ranked (jugadas y
  // ganadas: +2 constantes; +1 por recuento de ventana). Siguen siendo lecturas fijas, no crecen con los datos.
  assert.ok(small.reads.length <= 50, `lecturas: ${small.reads.length}`);
});

test("ACOTADO · anónimo: pocas lecturas públicas", async () => {
  const db = seed();
  await run(db, null);
  assert.ok(db.reads.length <= 10, `lecturas: ${db.reads.length} (${db.reads.join(",")})`);
});

test("ACOTADO · la foto no lleva más de LIVE_EVENTS_MAX eventos ni más de 5 elementos en HOY", async () => {
  const db = seed();
  for (let i = 0; i < 20; i++) db.tables.events.push({ id: `e${i}`, name: `E${i}`, status: "upcoming", start_date: iso(NOW + (i + 1) * D).slice(0, 10), end_date: null, source: "vlr" });
  const s = await run(db, U);
  assert.ok(LIVE_EVENTS_MAX <= 6);
  assert.ok(s.today.length <= 5);
  assert.ok(s.secondaryActions.length <= 3);
});
