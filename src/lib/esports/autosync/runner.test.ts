/**
 * AUTO-SYNC · EL CORE DE PUNTA A PUNTA (Fase 24.6) — pruebas 11–36, 44–51, 60–61 del brief.
 *
 * Sin red y sin Postgres: la fuente son snapshots QA SYNTHETIC (etiquetados) y la base de datos
 * es `FakeDb`, que implementa el subconjunto de PostgREST y las RPC del dominio que usa el
 * pipeline canónico (`syncTournament` → `runPickemLifecycle` → `app_score_pickem_event` →
 * `app_grant_reward`). Lo que se prueba es la POLÍTICA del core: qué escribe, qué no, cuándo
 * corrige, y que repetir no duplica.
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { RawSnapshot, RawBracket } from "@/importer";
import { DEFAULT_AUTO_SYNC_CONFIG, type EsportsAutoSyncConfig } from "./config";
import { runEsportsSync, type EsportsSyncRunResult, type RunOptions } from "./runner";
import { LOCK_STATE_ID } from "./lock";
import { HEALTH_STATE_ID } from "./health";
import { SourceError } from "./sourceRef";
import { FakeDb, type Row } from "./testing/fakeSupabase";
import { resetProgressionProbe } from "@/lib/esports/sync/schemaCompat";

/* ═══════════════════════════ FIXTURES · QA SYNTHETIC ═══════════════════════════ */

const EVENT_ID = "qa-2766";
const VLR_URL = "https://www.vlr.gg/event/2766";
const TEAMS = [{ id: "1", name: "Alpha" }, { id: "2", name: "Beta" }, { id: "3", name: "Gamma" }, { id: "4", name: "Delta" }];
const tid = (name: string) => `vlr-t-${TEAMS.find((t) => t.name === name)!.id}`;

interface M { id: string; a: string; b: string; status?: string; scoreA?: number; scoreB?: number; winner?: string; round?: string; start?: string }

const SF1 = "2027-01-10T10:00:00Z";
const SF2 = "2027-01-10T13:00:00Z";
const GF = "2027-01-11T10:00:00Z";

const BASE: M[] = [
  { id: "sf1", a: "Alpha", b: "Beta", round: "Semifinal", start: SF1 },
  { id: "sf2", a: "Gamma", b: "Delta", round: "Semifinal", start: SF2 },
  { id: "gf", a: "Alpha", b: "Gamma", round: "Grand Final", start: GF },
];

const BRACKET: RawBracket[] = [{
  id: "b1", stageId: "st-playoffs", kind: "single",
  nodes: [
    { id: "bn-sf1", round: 0, matchId: "sf1", winnerToNodeId: "bn-gf", winnerToSlot: 1, evidence: "SOURCE_STRUCTURED_HTML", confidence: "CONFIRMED" },
    { id: "bn-sf2", round: 0, matchId: "sf2", winnerToNodeId: "bn-gf", winnerToSlot: 2, evidence: "SOURCE_STRUCTURED_HTML", confidence: "CONFIRMED", winnerQualifies: "qualified:playoffs:final", winnerQualifiesLabel: "Final" },
    { id: "bn-gf", round: 1, matchId: "gf", evidence: "SOURCE_STRUCTURED_HTML", confidence: "CONFIRMED" },
  ],
}];

/** Snapshot QA SYNTHETIC en el formato del importador (lo que devolvería `importVlrTournament`). */
function snap(matches: M[], opts: { brackets?: RawBracket[]; name?: string } = {}): RawSnapshot {
  const statuses = matches.map((m) => m.status ?? "upcoming");
  const status = statuses.some((s) => s === "live") ? "live" : matches.length && statuses.every((s) => s === "finished") ? "finished" : "upcoming";
  return {
    tournament: { id: "2766", name: opts.name ?? "QA SYNTHETIC Champions", type: "international", tier: "vct-international", status, startDate: "2027-01-10", endDate: "2027-01-11" },
    stages: [{ id: "st-playoffs", name: "Playoffs", kind: "playoff", orderIdx: 0 }],
    teams: TEAMS.map((t) => ({ id: t.id, name: t.name })),
    players: [], coaches: [],
    matches: matches.map((m, i) => ({
      id: m.id, stageId: "st-playoffs", teamA: m.a, teamB: m.b, startTime: m.start, status: m.status ?? "upcoming",
      format: "bo3", bestOf: 3, round: m.round ?? "Semifinal", matchOrder: i + 1, scoreA: m.scoreA, scoreB: m.scoreB, winner: m.winner,
    })),
    maps: [], mapStats: [], standings: [], awards: {},
    brackets: opts.brackets,
  };
}

const with_ = (base: M[], patch: Record<string, Partial<M>>): M[] => base.map((m) => ({ ...m, ...(patch[m.id] ?? {}) }));

const MATCH_BASE_COLUMNS = [
  "id", "event_id", "stage_id", "team_a_id", "team_b_id", "team_a", "team_b", "start_time", "status", "format", "best_of", "round",
  "match_order", "score_a", "score_b", "winner_team_id", "winner_team", "mvp_player_id", "patch", "vod_url", "vlr_url", "updated_at", "created_at",
];
const PROGRESSION_COLUMNS = [
  "winner_to_match_id", "winner_to_slot", "loser_to_match_id", "loser_to_slot", "winner_qualifies", "winner_qualifies_label",
  "progression_evidence", "progression_confidence", "progression_version", "progression_synced_at",
];

interface Harness {
  db: FakeDb;
  cfg: EsportsAutoSyncConfig;
  /** Ejecuta el core con este snapshot como fuente (o un error de fuente). */
  run(source: RawSnapshot | Error | Record<string, RawSnapshot | Error>, opts?: Partial<RunOptions> & { now?: number }): Promise<EsportsSyncRunResult>;
}

function harness(opts: { pre0045?: boolean; enabled?: boolean; events?: Row[]; noLegacy?: boolean } = {}): Harness {
  const db = new FakeDb({ schema: opts.pre0045 ? { matches: MATCH_BASE_COLUMNS } : { matches: [...MATCH_BASE_COLUMNS, ...PROGRESSION_COLUMNS] } });
  db.seed("events", opts.events ?? [{ id: EVENT_ID, name: "QA SYNTHETIC Champions", status: "upcoming", source: "vlr", vlr_url: VLR_URL, start_date: "2027-01-10T00:00:00Z", end_date: "2027-01-11T23:59:59Z" }]);
  db.seed("profiles", [{ id: "u1", points: 0 }, { id: "u2", points: 0 }]);
  // F87.2 · el ciclo ya no CREA Pick'ems clásicos: solo continúa los `LEGACY_V1` anteriores al corte. El torneo
  // sintético tiene el suyo, como Champions 2026 en producción.
  if (!opts.noLegacy) db.seed("pickem_events", [{ id: "pe-legacy-qa", event_id: EVENT_ID, title: "Predicciones · QA SYNTHETIC Champions", status: "open", locks_at: "2027-01-11T23:59:59Z", legacy_mode: "LEGACY_V1", created_at: "2026-09-01T00:00:00Z" }]);
  const sb = db.client();
  const cfg: EsportsAutoSyncConfig = { ...DEFAULT_AUTO_SYNC_CONFIG, enabled: opts.enabled ?? true, jitterRatio: 0, retry: { maxAttempts: 1, baseDelayMs: 0 } };
  let clock = Date.parse("2026-12-01T12:00:00Z");
  return {
    db, cfg,
    async run(source, o = {}) {
      resetProgressionProbe(sb);
      const { now, ...rest } = o;
      if (now) clock = now;
      const t = clock;
      const fetchSnapshot = async (ref: { eventId: string }) => {
        const s = source instanceof Error || "tournament" in source ? source : source[ref.eventId];
        if (s === undefined) throw new SourceError("permanent", `sin fixture para ${ref.eventId}`);
        if (s instanceof Error) throw s;
        return { snapshot: s as RawSnapshot, warnings: [] };
      };
      // `force: true` por defecto: la política de «¿toca ahora?» tiene sus propias pruebas (policy.test).
      return runEsportsSync({ sb, cfg, now: () => t, fetchSnapshot, rng: () => 0.5 }, { mode: "scheduled", force: true, ...rest });
    },
  };
}

const matchRow = (db: FakeDb, id: string) => db.rows("matches").find((r) => r.id === id)!;
const questions = (db: FakeDb, kind?: string) => db.rows("pickem_questions").filter((q) => !kind || q.kind === kind);
const questionFor = (db: FakeDb, matchId: string, kind = "match_winner") => questions(db).find((q) => q.match_id === matchId && q.kind === kind);
const scoreCalls = (db: FakeDb) => db.rpcCalls.filter((c) => c.name === "app_score_pickem_event").length;
const tableSnapshot = (db: FakeDb) => JSON.stringify(Object.fromEntries(Object.entries(db.tables).filter(([t]) => t !== "sync_state" && t !== "notifications").map(([t, rows]) => [t, rows])));

/** Un usuario responde «a» a todas las preguntas de partido abiertas. */
function answerAll(db: FakeDb, userId: string, option = "a"): void {
  const ev = db.rows("pickem_events")[0];
  const subId = `sub-${userId}`;
  if (!db.rows("pickem_submissions").some((s) => s.id === subId)) db.seed("pickem_submissions", [{ id: subId, pickem_event_id: ev.id, user_id: userId }]);
  for (const q of questions(db, "match_winner")) {
    if (db.rows("pickem_answers").some((a) => a.submission_id === subId && a.question_id === q.id)) continue;
    db.seed("pickem_answers", [{ id: `ans-${userId}-${q.id}`, submission_id: subId, question_id: q.id, option_key: option }]);
  }
}

/* ═══════════════════════════ 11–13 · escritura básica ═══════════════════════════ */

test("12 · primer sync: evento, equipos, partidos y preguntas de Pick'ems nacen del pipeline canónico", async () => {
  const h = harness();
  const r = await h.run(snap(BASE));
  assert.equal(r.skipped, undefined);
  assert.equal(r.eventsSynced, 1);
  assert.equal(r.matchesCreated, 3);
  assert.equal(h.db.rows("matches").length, 3);
  assert.equal(matchRow(h.db, "sf1").team_a, "Alpha", "columnas legacy con NOMBRE (lo que lee Pick'ems)");
  assert.equal(matchRow(h.db, "sf1").team_a_id, tid("Alpha"));
  assert.equal(questions(h.db, "match_winner").length, 3);
  assert.equal(questions(h.db, "match_score").length, 3);
  assert.equal(questions(h.db, "champion").length, 1, "4 participantes y torneo sin empezar → pregunta de campeón");
  assert.equal(r.events[0].pickems.ran, true);
  assert.equal(h.db.rows("events")[0].vlr_url, VLR_URL, "la URL canónica se persiste para el siguiente descubrimiento");
});

test("11 · fuente sin cambios → segunda pasada con CERO escrituras y sin scoring", async () => {
  const h = harness();
  await h.run(snap(BASE));
  const before = tableSnapshot(h.db);
  const writes = h.db.writes.length;
  const rpcs = h.db.rpcCalls.length;
  const r = await h.run(snap(BASE), { now: Date.parse("2026-12-01T13:00:00Z") });
  assert.equal(r.events[0].status, "unchanged");
  assert.equal(tableSnapshot(h.db), before);
  // Solo el lock y la salud (sync_state) se tocan; ninguna tabla de datos.
  assert.deepEqual([...new Set(h.db.writes.slice(writes).map((w) => w.table))], ["sync_state"]);
  assert.equal(h.db.rpcCalls.length, rpcs, "sin RPC: ni recomputes ni scoring");
});

test("13 · cambio de hora de un partido → fila actualizada y etiqueta/lock de la pregunta coherentes", async () => {
  const h = harness();
  await h.run(snap(BASE));
  const r = await h.run(snap(with_(BASE, { sf1: { start: "2027-01-10T12:00:00Z" } })), { now: Date.parse("2026-12-01T13:00:00Z") });
  assert.equal(r.matchesUpdated, 1);
  assert.equal(matchRow(h.db, "sf1").start_time, "2027-01-10T12:00:00.000Z");
  assert.equal(questions(h.db, "match_winner").length, 3, "no se duplica la pregunta");
});

/* ═══════════════════════════ 14–18 · transiciones y resultados ═══════════════════════════ */

test("14 · upcoming → live: estado escrito, ninguna pregunta resuelta, ningún scoring", async () => {
  const h = harness();
  await h.run(snap(BASE));
  const r = await h.run(snap(with_(BASE, { sf1: { status: "live" } })), { now: Date.parse("2027-01-10T10:30:00Z") });
  assert.equal(matchRow(h.db, "sf1").status, "live");
  assert.equal(r.matchesFinished, 0);
  assert.equal(questionFor(h.db, "sf1")!.correct_option ?? null, null);
  assert.equal(scoreCalls(h.db), 0);
});

test("15+18 · live → finished: ganador fijado en la pregunta, scoring por app_score_pickem_event y puntos al perfil", async () => {
  const h = harness();
  await h.run(snap(BASE));
  answerAll(h.db, "u1", "a");
  await h.run(snap(with_(BASE, { sf1: { status: "live" } })), { now: Date.parse("2027-01-10T10:30:00Z") });
  const r = await h.run(snap(with_(BASE, { sf1: { status: "finished", scoreA: 2, scoreB: 0, winner: "Alpha" } })), { now: Date.parse("2027-01-10T12:30:00Z") });
  assert.equal(r.matchesFinished, 1);
  assert.equal(matchRow(h.db, "sf1").winner_team, "Alpha");
  assert.equal(matchRow(h.db, "sf1").winner_team_id, tid("Alpha"));
  assert.equal(questionFor(h.db, "sf1")!.correct_option, "a");
  assert.equal(scoreCalls(h.db), 1, "un scoring, del corrector canónico");
  assert.equal(r.pickemsScored, 1);
  assert.equal(h.db.rows("profiles").find((p) => p.id === "u1")!.points, 20, "semifinal = 20 puntos, calculados por la RPC");
  assert.equal(h.db.granted("u1", `pickem:${h.db.rows("pickem_events")[0].id}:acertante`), 1, "recompensa del escalón por services/rewards");
});

test("16 · upcoming → finished DIRECTO (sin haber visto el directo): resultado válido, scoring y bracket", async () => {
  const h = harness();
  await h.run(snap(BASE, { brackets: BRACKET }));
  answerAll(h.db, "u1", "a");
  const r = await h.run(snap(with_(BASE, { sf1: { status: "finished", scoreA: 2, scoreB: 1, winner: "Alpha" } }), { brackets: BRACKET }), { now: Date.parse("2027-01-10T13:00:00Z") });
  assert.equal(r.matchesFinished, 1);
  assert.equal(questionFor(h.db, "sf1")!.correct_option, "a");
  assert.equal(scoreCalls(h.db), 1);
  assert.equal(matchRow(h.db, "sf1").winner_to_match_id, "gf", "la estructura confirmada sigue ahí");
});

test("17 · corrección de la fuente sobre un resultado terminado: se registra, se reconcilia la pregunta y no se duplica nada", async () => {
  const h = harness();
  await h.run(snap(BASE));
  answerAll(h.db, "u1", "a");
  answerAll(h.db, "u2", "b");
  await h.run(snap(with_(BASE, { sf1: { status: "finished", scoreA: 2, scoreB: 0, winner: "Alpha" } })), { now: Date.parse("2027-01-10T12:30:00Z") });
  assert.equal(h.db.rows("profiles").find((p) => p.id === "u1")!.points, 20);
  assert.equal(h.db.rows("profiles").find((p) => p.id === "u2")!.points, 0);
  // VLR corrige: en realidad ganó Beta.
  const r = await h.run(snap(with_(BASE, { sf1: { status: "finished", scoreA: 1, scoreB: 2, winner: "Beta" } })), { now: Date.parse("2027-01-10T13:30:00Z") });
  assert.equal(r.events[0].matches.corrections, 1);
  assert.ok(r.events[0].notifications.some((n) => n.code === "RESULT_CORRECTED"));
  assert.ok(h.db.rows("notifications").some((n) => n.code === "RESULT_CORRECTED"), "registrado para Operations");
  assert.equal(questionFor(h.db, "sf1")!.correct_option, "b", "la pregunta se rectifica solo para el partido corregido");
  assert.equal(questionFor(h.db, "sf1", "match_score")!.correct_option, "1-2");
  assert.equal(r.pickemsCorrected, 2, "ganador + marcador del MISMO partido; las demás preguntas no se tocan");
  assert.equal(questionFor(h.db, "sf2")!.correct_option ?? null, null);
  assert.equal(h.db.rows("profiles").find((p) => p.id === "u1")!.points, 0, "los puntos se recalculan desde cero, por diferencia");
  assert.equal(h.db.rows("profiles").find((p) => p.id === "u2")!.points, 20);
  const ev = h.db.rows("pickem_events")[0].id;
  assert.equal(h.db.granted("u1", `pickem:${ev}:acertante`), 1, "la recompensa ya pagada a u1 no se retira ni se duplica");
  assert.equal(h.db.granted("u2", `pickem:${ev}:acertante`), 1, "u2 cobra su escalón una sola vez");
  assert.equal(h.db.ledger.get(`u1::pickem:${ev}:acertante`), 1, "tras la corrección u1 baja a 0 puntos: no alcanza escalón y no se le vuelve a pedir; lo cobrado no se retira");
});

test("regresión de estado · finished → upcoming con resultado previo se RECHAZA y el resultado se conserva", async () => {
  const h = harness();
  await h.run(snap(BASE));
  await h.run(snap(with_(BASE, { sf1: { status: "finished", scoreA: 2, scoreB: 0, winner: "Alpha" } })), { now: Date.parse("2027-01-10T12:30:00Z") });
  const r = await h.run(snap(BASE), { now: Date.parse("2027-01-10T13:30:00Z") });
  assert.equal(r.matchesRejected, 1);
  assert.equal(matchRow(h.db, "sf1").status, "finished");
  assert.equal(matchRow(h.db, "sf1").winner_team, "Alpha");
  assert.ok(r.events[0].notifications.some((n) => n.code === "MATCH_REGRESSION_REJECTED"));
});

/* ═══════════════════════════ 19–20 · bracket y clasificación (post-0045) ═══════════════════════════ */

test("20+61 · POST-0045: la progresión confirmada se escribe en las columnas de la 0045 (upsert parcial)", async () => {
  const h = harness();
  const r = await h.run(snap(BASE, { brackets: BRACKET }));
  // La final no tiene destino ni clasificación: no hay nada que confirmar de ella (2 aristas, no 3).
  assert.equal(r.bracketChanges, 2);
  assert.equal(matchRow(h.db, "sf1").winner_to_match_id, "gf");
  assert.equal(matchRow(h.db, "sf1").winner_to_slot, 1);
  assert.equal(matchRow(h.db, "sf2").winner_qualifies, "qualified:playoffs:final");
  assert.equal(matchRow(h.db, "sf2").progression_confidence, "CONFIRMED");
  assert.equal(r.events[0].bracket.skipped, undefined);
});

test("19+32 · clasificación: la pregunta «¿quién se clasifica?» nace de la estructura y se resuelve con el ganador real; dos veces no cambia nada", async () => {
  const h = harness();
  await h.run(snap(BASE, { brackets: BRACKET }));
  const adv = questions(h.db, "advance");
  assert.equal(adv.length, 1);
  assert.equal(adv[0].match_id, "sf2");
  await h.run(snap(with_(BASE, { sf2: { status: "finished", scoreA: 0, scoreB: 2, winner: "Delta" } }), { brackets: BRACKET }), { now: Date.parse("2027-01-10T16:00:00Z") });
  assert.equal(questionFor(h.db, "sf2", "advance")!.correct_option, "b");
  const before = tableSnapshot(h.db);
  const r2 = await h.run(snap(with_(BASE, { sf2: { status: "finished", scoreA: 0, scoreB: 2, winner: "Delta" } }), { brackets: BRACKET }), { now: Date.parse("2027-01-10T17:00:00Z") });
  assert.equal(r2.events[0].status, "unchanged");
  assert.equal(tableSnapshot(h.db), before);
});

/* ═══════════════════════════ 21–23 · fallos de fuente ═══════════════════════════ */

test("21 · fallo parcial: de dos eventos uno falla y el otro se sincroniza; el resultado lo dice", async () => {
  const h = harness({ events: [
    { id: "qa-1", name: "Uno", status: "upcoming", source: "vlr", vlr_url: "https://www.vlr.gg/event/1", start_date: "2027-01-10T00:00:00Z" },
    { id: "qa-2", name: "Dos", status: "upcoming", source: "vlr", vlr_url: "https://www.vlr.gg/event/2", start_date: "2027-01-10T00:00:00Z" },
  ] });
  const r = await h.run({ "qa-1": snap(BASE), "qa-2": new SourceError("transient", "timeout: 15000 ms") });
  assert.equal(r.eventsSynced, 1);
  assert.equal(r.eventsFailed, 1);
  assert.equal(h.db.rows("matches").filter((m) => m.event_id === "qa-1").length, 3);
  assert.equal(h.db.rows("matches").filter((m) => m.event_id === "qa-2").length, 0);
  assert.ok(r.errors.some((e) => e.startsWith("SYNC_FAILED") && e.includes("qa-2")));
  assert.equal(r.health?.events["qa-2"].consecutiveFailures, 1, "backoff por evento, no global");
  assert.equal(r.health?.events["qa-1"].consecutiveFailures, 0);
});

test("22 · fuente malformada (parse): SOURCE_PARSE_FAILED, sin escrituras, sin reintento", async () => {
  const h = harness();
  await h.run(snap(BASE));
  const before = tableSnapshot(h.db);
  const r = await h.run(new Error("la página de VLR no parece un torneo (sin título de evento): x"), { now: Date.parse("2026-12-01T13:00:00Z") });
  assert.equal(r.eventsFailed, 1);
  assert.equal(r.events[0].errorKind, "parse");
  assert.ok(r.events[0].notifications.some((n) => n.code === "SOURCE_PARSE_FAILED"));
  assert.equal(tableSnapshot(h.db), before);
});

test("23 · lista vacía sospechosa: NO se interpreta como «los partidos desaparecieron»; nada se borra ni se escribe", async () => {
  const h = harness();
  await h.run(snap(BASE));
  const before = tableSnapshot(h.db);
  const r = await h.run(snap([]), { now: Date.parse("2026-12-01T13:00:00Z") });
  assert.equal(r.events[0].status, "failed");
  assert.ok(r.events[0].notifications.some((n) => n.code === "SOURCE_SUSPICIOUS"));
  assert.equal(h.db.rows("matches").length, 3);
  assert.equal(tableSnapshot(h.db), before);
  // Y una lista muy encogida, igual.
  const r2 = await h.run(snap(BASE.slice(0, 1)), { now: Date.parse("2026-12-01T14:00:00Z") });
  assert.equal(r2.events[0].status, "synced", "3 conocidos → 1 no es «sospechoso» por umbral (mínimo 4 conocidos); la fila se conserva igualmente");
  assert.equal(h.db.rows("matches").length, 3, "el sync nunca borra");
});

/* ═══════════════════════════ 27–36 · idempotencia y recuperación ═══════════════════════════ */

test("27+28+29+30 · el mismo resultado procesado cinco veces: una resolución, puntos iguales, una recompensa", async () => {
  const h = harness();
  await h.run(snap(BASE));
  answerAll(h.db, "u1", "a");
  const finished = snap(with_(BASE, { sf1: { status: "finished", scoreA: 2, scoreB: 0, winner: "Alpha" } }));
  let t = Date.parse("2027-01-10T12:30:00Z");
  for (let i = 0; i < 5; i++) await h.run(finished, { now: (t += 600_000) });
  assert.equal(h.db.rows("profiles").find((p) => p.id === "u1")!.points, 20);
  assert.equal(h.db.rpcCalls.filter((c) => c.name === "app_set_correct_option").length, 2, "ganador + marcador exacto, una vez cada una");
  const ev = h.db.rows("pickem_events")[0].id;
  assert.equal(h.db.granted("u1", `pickem:${ev}:acertante`), 1);
  assert.equal(h.db.rows("pickem_questions").length, 7, "3 ganador + 3 marcador + 1 campeón, sin duplicados");
  assert.equal(h.db.rows("pickem_events").length, 1);
});

test("31 · campeón: la gran final resuelve la pregunta de campeón por el lifecycle existente; repetir no la reescribe", async () => {
  const h = harness();
  await h.run(snap(BASE));
  const all = with_(BASE, {
    sf1: { status: "finished", scoreA: 2, scoreB: 0, winner: "Alpha" },
    sf2: { status: "finished", scoreA: 2, scoreB: 1, winner: "Gamma" },
    gf: { status: "finished", scoreA: 3, scoreB: 1, winner: "Alpha" },
  });
  await h.run(snap(all), { now: Date.parse("2027-01-11T14:00:00Z") });
  const champ = questions(h.db, "champion")[0];
  assert.equal(champ.correct_option, "alpha");
  const sets = h.db.rpcCalls.filter((c) => c.name === "app_set_correct_option").length;
  const r = await h.run(snap(all), { now: Date.parse("2027-01-11T15:00:00Z") });
  assert.equal(r.events[0].status, "unchanged");
  assert.equal(h.db.rpcCalls.filter((c) => c.name === "app_set_correct_option").length, sets);
});

test("33 · trigger duplicado: dos ejecuciones simultáneas → una efectiva, la otra «locked» y sin efectos", async () => {
  const h = harness();
  const finished = snap(with_(BASE, { sf1: { status: "finished", scoreA: 2, scoreB: 0, winner: "Alpha" } }));
  const [a, b] = await Promise.all([h.run(finished), h.run(finished)]);
  const winner = [a, b].find((r) => !r.skipped)!;
  const loser = [a, b].find((r) => r.skipped === "locked")!;
  assert.ok(winner && loser, "exactamente una gana el lock");
  assert.equal(loser.eventsSynced, 0);
  assert.equal(h.db.rows("matches").length, 3);
  assert.equal(h.db.rows("pickem_events").length, 1);
  assert.equal(h.db.rows("sync_state").find((s) => s.id === LOCK_STATE_ID)!.status, "idle", "liberado al terminar");
});

test("34 · lock caducado (proceso muerto): la siguiente ejecución lo recupera y lo hace constar", async () => {
  const h = harness();
  h.db.seed("sync_state", [{ id: LOCK_STATE_ID, status: "running", cursor: "muerto:1", updated_at: "2026-12-01T00:00:00.000Z" }]);
  const r = await h.run(snap(BASE), { now: Date.parse("2026-12-01T12:00:00Z") });
  assert.equal(r.lock.acquired, true);
  assert.equal(r.lock.recoveredStale, true);
  assert.equal(r.eventsSynced, 1);
  // Y un lock VIVO (dentro del TTL) no se roba.
  h.db.rows("sync_state").find((s) => s.id === LOCK_STATE_ID)!.status = "running";
  h.db.rows("sync_state").find((s) => s.id === LOCK_STATE_ID)!.updated_at = new Date(Date.parse("2026-12-01T12:05:00Z")).toISOString();
  const r2 = await h.run(snap(BASE), { now: Date.parse("2026-12-01T12:06:00Z") });
  assert.equal(r2.skipped, "locked");
});

test("35 · crash recovery: el corrector falla tras escribir resultados → la siguiente pasada reconcilia sin duplicar", async () => {
  const h = harness();
  await h.run(snap(BASE));
  answerAll(h.db, "u1", "a");
  const finished = snap(with_(BASE, { sf1: { status: "finished", scoreA: 2, scoreB: 0, winner: "Alpha" } }));
  h.db.failNext["rpc:app_score_pickem_event"] = { message: "connection reset" };
  const r1 = await h.run(finished, { now: Date.parse("2027-01-10T12:30:00Z") });
  assert.equal(matchRow(h.db, "sf1").status, "finished", "los resultados sí se escribieron");
  assert.equal(h.db.rows("profiles").find((p) => p.id === "u1")!.points, 0, "…pero no hubo scoring");
  assert.ok(r1.errors.some((e) => e.startsWith("SCORING_FAILED")));
  // Misma fuente, sin cambios: aun así el ciclo vuelve a correr porque el marcador no se escribió.
  const r2 = await h.run(finished, { now: Date.parse("2027-01-10T12:40:00Z") });
  assert.equal(r2.events[0].pickems.ran, true);
  assert.equal(r2.pickemsScored, 1);
  assert.equal(h.db.rows("profiles").find((p) => p.id === "u1")!.points, 20);
  const ev = h.db.rows("pickem_events")[0].id;
  assert.equal(h.db.granted("u1", `pickem:${ev}:acertante`), 1);
  // Y a la tercera, ya convergido, no hace nada.
  const r3 = await h.run(finished, { now: Date.parse("2027-01-10T12:50:00Z") });
  assert.equal(r3.events[0].status, "unchanged");
});

test("36 · escritura parcial: sync_state del evento quedó en «running» → la siguiente pasada fuerza el ciclo", async () => {
  const h = harness();
  await h.run(snap(BASE));
  const st = h.db.rows("sync_state").find((s) => s.id === `vlr:event:${EVENT_ID}`)!;
  st.status = "running";
  const r = await h.run(snap(BASE), { now: Date.parse("2026-12-01T13:00:00Z") });
  assert.equal(r.events[0].pickems.needed, true);
  assert.equal(r.events[0].pickems.ran, true);
  assert.equal(h.db.rows("pickem_questions").length, 7, "sin duplicar preguntas");
  assert.equal(h.db.rows("sync_state").find((s) => s.id === `vlr:event:${EVENT_ID}`)!.status, "ok");
});

/* ═══════════════════════════ 44–50 · dry run ═══════════════════════════ */

test("44+45+46 · dry run: CERO escrituras, cero RPC, cero scoring, cero recompensas, ni siquiera el lock", async () => {
  const h = harness();
  await h.run(snap(BASE));
  answerAll(h.db, "u1", "a");
  const writes = h.db.writes.length;
  const rpcs = h.db.rpcCalls.length;
  const before = JSON.stringify(h.db.tables);
  const r = await h.run(snap(with_(BASE, { sf1: { status: "finished", scoreA: 2, scoreB: 0, winner: "Alpha" } })), { dryRun: true, now: Date.parse("2027-01-10T12:30:00Z") });
  assert.equal(r.dryRun, true);
  assert.equal(h.db.writes.length, writes);
  assert.equal(h.db.rpcCalls.length, rpcs);
  assert.equal(JSON.stringify(h.db.tables), before);
  assert.equal(r.lock.acquired, false);
  assert.equal(h.db.rows("profiles").find((p) => p.id === "u1")!.points, 0);
  assert.equal(h.db.ledger.size, 0);
});

test("47+48+49 · dry run informa de cambios de partidos, de bracket y de si haría falta scoring", async () => {
  const h = harness();
  await h.run(snap(BASE));
  const r = await h.run(snap(with_(BASE, { sf1: { status: "finished", scoreA: 2, scoreB: 0, winner: "Alpha" } }), { brackets: BRACKET }), { dryRun: true, now: Date.parse("2027-01-10T12:30:00Z") });
  const e = r.events[0];
  assert.equal(e.status, "dry-run");
  assert.equal(e.matches.unchanged, 2);
  assert.equal(e.matches.updated, 1);
  assert.equal(e.matches.finished, 1);
  assert.equal(e.matches.invalid, 0);
  assert.equal(e.bracket.confirmed, 2);
  assert.equal(e.bracket.qualification, 1);
  assert.equal(e.pickems.needed, true, "un evento requeriría scoring");
  // Un dry run sobre una fuente idéntica dice «sin cambios» y «sin scoring».
  const r2 = await h.run(snap(BASE), { dryRun: true, now: Date.parse("2026-12-01T13:00:00Z") });
  assert.equal(r2.events[0].reason, "sin cambios");
  assert.equal(r2.events[0].pickems.needed, false);
});

test("50 · dry run con fuente malformada o vacía es seguro: lo cuenta, no escribe, no rompe", async () => {
  const h = harness();
  await h.run(snap(BASE));
  const before = JSON.stringify(h.db.tables);
  const notifs = h.db.rows("notifications").length;
  const a = await h.run(new Error("la página de VLR no parece un torneo (sin título de evento): x"), { dryRun: true });
  assert.equal(a.eventsFailed, 1);
  const b = await h.run(snap([]), { dryRun: true });
  assert.ok(b.events[0].notifications.some((n) => n.code === "SOURCE_SUSPICIOUS"));
  assert.equal(h.db.rows("notifications").length, notifs, "en dry run los avisos no se persisten");
  assert.equal(JSON.stringify(h.db.tables), before);
});

/* ═══════════════════════════ 51 · manual y kill switch ═══════════════════════════ */

test("51 · el sync manual (objetivo explícito) pasa por el mismo core y funciona con el scheduler apagado", async () => {
  const h = harness({ enabled: false });
  const off = await h.run(snap(BASE));
  assert.equal(off.skipped, "disabled", "scheduled con kill switch OFF: nada");
  assert.equal(h.db.rows("matches").length, 0);
  const manual = await h.run(snap(BASE), { mode: "manual", targets: [{ eventId: EVENT_ID, vlrEventId: "2766", url: VLR_URL }], pickems: false });
  assert.equal(manual.skipped, undefined);
  assert.equal(manual.eventsSynced, 1);
  assert.equal(h.db.rows("matches").length, 3);
  assert.equal(h.db.rows("pickem_questions").length, 0, "--sin Pick'ems, como el script manual de siempre");
  // Sin marcador de convergencia (el ciclo no corrió): la siguiente pasada con Pick'ems los abre.
  const again = await h.run(snap(BASE), { mode: "manual", targets: [{ eventId: EVENT_ID, vlrEventId: "2766", url: VLR_URL }] });
  assert.equal(again.events[0].pickems.ran, true);
  assert.equal(h.db.rows("pickem_questions").length, 7);
});

test("descubrimiento · eventos sin referencia a la fuente se omiten con motivo; archivados no se sondean", async () => {
  const h = harness({ events: [
    { id: "demo-masters-madrid-2026", name: "Demo", status: "finished", source: "vlr", vlr_url: null, start_date: "2026-03-01T00:00:00Z", end_date: "2026-03-10T00:00:00Z" },
    { id: "old-2024", name: "Champions 2024", status: "finished", source: "vlr", vlr_url: "https://www.vlr.gg/event/2097", start_date: "2024-08-01T00:00:00Z", end_date: "2024-08-25T00:00:00Z" },
    { id: EVENT_ID, name: "QA", status: "upcoming", source: "vlr", vlr_url: VLR_URL, start_date: "2027-01-10T00:00:00Z" },
  ] });
  const r = await h.run({ [EVENT_ID]: snap(BASE) });
  assert.equal(r.eventsChecked, 3);
  assert.equal(r.eventsSynced, 1);
  assert.equal(r.events.filter((e) => e.status === "skipped").length, 0, "el archivado ni siquiera entra en la lista de tocan");
  assert.ok(!r.events.some((e) => e.eventId === "old-2024"), "Champions 2024 no se vuelve a descargar");
});

/* ═══════════════════════════ 60 · PRE-0045 ═══════════════════════════ */

test("60 · PRE-0045: sin las columnas de estructura el sync entero sigue funcionando (partidos, preguntas, scoring), la estructura se omite y se declara", async () => {
  const h = harness({ pre0045: true });
  const r = await h.run(snap(BASE, { brackets: BRACKET }));
  assert.equal(r.eventsSynced, 1, JSON.stringify(r.errors));
  assert.equal(h.db.rows("matches").length, 3);
  assert.equal(r.events[0].bracket.skipped, "pre-0045");
  assert.ok(!("winner_to_match_id" in matchRow(h.db, "sf1")));
  assert.equal(questions(h.db, "match_winner").length, 3, "el ciclo de Pick'ems no muere por 42703");
  assert.equal(questions(h.db, "advance").length, 0, "sin estructura no hay pregunta de clasificación: correcto para ese esquema");
  answerAll(h.db, "u1", "a");
  const r2 = await h.run(snap(with_(BASE, { sf1: { status: "finished", scoreA: 2, scoreB: 0, winner: "Alpha" } }), { brackets: BRACKET }), { now: Date.parse("2027-01-10T12:30:00Z") });
  assert.equal(r2.pickemsScored, 1);
  assert.equal(h.db.rows("profiles").find((p) => p.id === "u1")!.points, 20);
});

/* ═══════════════════════════ salud ═══════════════════════════ */

test("salud · se persiste en sync_state (último intento/éxito, duración, fallos) y alimenta la política siguiente", async () => {
  const h = harness();
  await h.run(snap(BASE), { now: Date.parse("2026-12-01T12:00:00Z") });
  const row = h.db.rows("sync_state").find((s) => s.id === HEALTH_STATE_ID)!;
  assert.equal(row.status, "ok");
  const extra = JSON.parse(row.cursor as string) as { consecutiveFailures: number; events: Record<string, { lastAttemptAt: number }> };
  assert.equal(extra.consecutiveFailures, 0);
  assert.equal(extra.events[EVENT_ID].lastAttemptAt, Date.parse("2026-12-01T12:00:00Z"));
  // Un minuto después, un evento «future» no toca: la política lo deja en paz.
  const r = await h.run(snap(BASE), { now: Date.parse("2026-12-01T12:01:00Z"), force: false });
  assert.equal(r.eventsDue, 0);
  assert.equal(r.eventsChecked, 1);
  assert.ok(r.nextDueAt && Date.parse(r.nextDueAt) > Date.parse("2026-12-01T12:01:00Z"));
});

/* ═══════════════════════════ huecos TBD (lo que enseñó el REAL SOURCE dry run) ═══════════════════════════ */

test("TBD · un cuadro con huecos sin equipo (Champions 2026 antes de empezar) escribe filas y aristas pero NO abre preguntas TBD vs TBD", async () => {
  const h = harness();
  const tbdTeams = [...TEAMS, { id: undefined as unknown as string, name: "TBD" }];
  const s = snap(BASE, { brackets: BRACKET });
  s.teams = tbdTeams.map((x) => ({ id: x.id, name: x.name }));
  s.matches.push(
    { id: "w1", stageId: "st-playoffs", teamA: "TBD", teamB: "TBD", startTime: "2027-01-12T10:00:00Z", status: "upcoming", format: "bo3", bestOf: 3, round: "Winner's (A)", matchOrder: 4 },
    { id: "d1", stageId: "st-playoffs", teamA: "Alpha", teamB: "TBD", startTime: "2027-01-13T10:00:00Z", status: "upcoming", format: "bo3", bestOf: 3, round: "Decider (A)", matchOrder: 5 },
  );
  s.brackets = [{ id: "b2", stageId: "st-playoffs", kind: "gsl", nodes: [
    { id: "bn-sf1", round: 0, matchId: "sf1", winnerToNodeId: "bn-w1", winnerToSlot: 1, evidence: "SOURCE_STRUCTURED_HTML", confidence: "CONFIRMED" },
    { id: "bn-w1", round: 1, matchId: "w1", winnerQualifies: "qualified:groupa:winners", evidence: "SOURCE_STRUCTURED_HTML", confidence: "CONFIRMED" },
    { id: "bn-d1", round: 1, matchId: "d1", evidence: "SOURCE_STRUCTURED_HTML", confidence: "CONFIRMED" },
  ] }];
  const r = await h.run(s);
  assert.equal(r.eventsSynced, 1, JSON.stringify(r.errors));
  assert.equal(r.matchesInvalid, 0, "TBD vs TBD es estructura, no payload inválido");
  assert.equal(h.db.rows("matches").length, 5);
  assert.equal(matchRow(h.db, "sf1").winner_to_match_id, "w1", "la arista hacia el hueco se persiste (24.4)");
  assert.equal(matchRow(h.db, "w1").winner_qualifies, "qualified:groupa:winners");
  const prompts = questions(h.db).map((q) => String(q.prompt));
  assert.ok(!prompts.some((p) => /TBD/i.test(p)), `ninguna pregunta con TBD: ${prompts.join(" | ")}`);
  assert.equal(questions(h.db, "advance").length, 0, "«¿quién se clasifica?» no nace de un partido TBD vs TBD");
  const champ = questions(h.db, "champion")[0];
  assert.ok(!(champ.options as { label: string }[]).some((o) => /TBD/i.test(o.label)), "TBD no puede ser campeón");
  // Y un TBD que la fuente diera por terminado se descarta con motivo.
  const bad = snap(BASE);
  bad.teams = s.teams; bad.matches.push({ id: "w1", stageId: "st-playoffs", teamA: "TBD", teamB: "TBD", status: "finished", scoreA: 2, scoreB: 0, winner: "TBD", matchOrder: 4 });
  const r2 = await h.run(bad, { now: Date.parse("2026-12-01T13:00:00Z") });
  assert.equal(r2.matchesInvalid, 1);
});
