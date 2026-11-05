/**
 * PICK'EMS · SERVIDOR (Fase 24.2) — lock, opciones, scoring idempotente y anti-cheat.
 *
 * Sin base de datos viva en este entorno, se prueba en dos capas:
 *   · las funciones de servicio con un cliente Supabase de mentira (qué RPC llaman, cómo
 *     traducen los errores de la base de datos a estados HTTP, que las recompensas usen
 *     una clave de idempotencia);
 *   · el CONTRATO del SQL y de la ruta: que `app_submit_pick` compare con `now()` de la base
 *     de datos y valide la opción contra `options`, que `app_score_pickem_event` recalcule
 *     desde cero y ajuste por diferencia, y que `/api/pickems` solo acepte `questionId` y
 *     `option` del cuerpo.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { submitPick, scorePickemEvent } from "./pickems";
import { syncChampionQuestion, resolveFinished } from "./pickemLifecycle";
import type { MatchInput } from "@/domain/pickems/questions";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const SQL = read("../../../supabase/migrations/0012_pickems.sql");
const SQL_KINDS = read("../../../supabase/migrations/0023_match_challenges.sql");
const ROUTE = read("../../app/api/pickems/route.ts");

/* ─────────────── submitPick: traducción de errores del servidor ─────────────── */

const rpcClient = (error: { message: string } | null, data: unknown = null) =>
  ({ rpc: async () => ({ data, error }) }) as unknown as SupabaseClient;

test("cambio antes del lock · la RPC guarda y devuelve la opción", async () => {
  const sb = rpcClient(null, { questionId: "q", option: "a", submissionId: "s" });
  const r = await submitPick(sb, "u", "q", "a");
  assert.ok(r.ok);
  assert.equal(r.data?.option, "a");
});

test("rechazo después del lock · «Predicción cerrada» del servidor → 409", async () => {
  const r = await submitPick(rpcClient({ message: "Predicción cerrada" }), "u", "q", "a");
  assert.ok(!r.ok);
  assert.equal(r.status, 409);
});

test("opción inválida · «Opción inválida» del servidor → 400", async () => {
  const r = await submitPick(rpcClient({ message: "Opción inválida" }), "u", "q", "REAL_MADRID");
  assert.ok(!r.ok);
  assert.equal(r.status, 400);
});

test("pregunta inexistente → 404", async () => {
  const r = await submitPick(rpcClient({ message: "Pregunta inexistente" }), "u", "q", "a");
  assert.ok(!r.ok);
  assert.equal(r.status, 404);
});

/* ─────────────── el SQL es la autoridad ─────────────── */

test("SQL · el cierre lo decide now() de la base de datos, dentro de app_submit_pick", () => {
  const fn = SQL.slice(SQL.indexOf("function public.app_submit_pick"), SQL.indexOf("function public.app_set_correct_option"));
  assert.match(fn, /if now\(\) >= v_q\.locks_at then/);
  assert.match(fn, /raise exception 'Predicción cerrada'/);
});

test("SQL · selected_option ∈ question.options: una clave fuera de las declaradas se rechaza", () => {
  const fn = SQL.slice(SQL.indexOf("function public.app_submit_pick"), SQL.indexOf("function public.app_set_correct_option"));
  assert.match(fn, /jsonb_array_elements\(v_q\.options\) o where o->>'key' = p_option/);
  assert.match(fn, /raise exception 'Opción inválida'/);
});

test("SQL · doble request no duplica: una submission por usuario+evento y una respuesta por pregunta (upsert)", () => {
  assert.match(SQL, /unique \(user_id, pickem_event_id\)/);
  assert.match(SQL, /unique \(submission_id, question_id\)/);
  assert.match(SQL, /on conflict \(submission_id, question_id\)\s+do update set option_key = excluded\.option_key/);
});

test("SQL · el scoring recalcula desde cero y ajusta profiles.points POR DIFERENCIA (idempotente)", () => {
  const fn = SQL.slice(SQL.indexOf("function public.app_score_pickem_event"), SQL.indexOf("5. RANKING"));
  assert.match(fn, /set is_correct = \(q\.correct_option is not null and a\.option_key = q\.correct_option\)/);
  assert.match(fn, /points_award = case when q\.correct_option is not null and a\.option_key = q\.correct_option\s+then q\.points else 0 end/);
  assert.match(fn, /points \+ \(v_row\.points - v_prev\)/);
  assert.match(fn, /on conflict \(user_id, pickem_event_id\) do update/);
});

test("SQL · el scoring es genérico por tipo: champion y advance puntúan con los mismos `q.points`", () => {
  assert.match(SQL_KINDS, /check \(kind in \('match_winner', 'match_score', 'champion', 'advance'\)\)/);
  const fn = SQL.slice(SQL.indexOf("function public.app_score_pickem_event"), SQL.indexOf("5. RANKING"));
  assert.ok(!/kind/.test(fn), "el corrector no distingue tipos: compara option_key con correct_option y paga q.points");
});

test("SQL · privacidad: correct_option oculto hasta el lock, respuestas solo del dueño, RPCs solo service_role", () => {
  assert.match(SQL, /case when now\(\) >= q\.locks_at then q\.correct_option else null end as correct_option/);
  assert.match(SQL, /create policy "tus respuestas" on public\.pickem_answers for select using \(\s*exists/);
  assert.match(SQL, /revoke all on function public\.app_submit_pick\(uuid, uuid, text\)\s+from public, anon, authenticated/);
  assert.match(SQL, /revoke select on public\.pickem_questions from anon, authenticated/);
});

/* ─────────────── anti-cheat en la ruta ─────────────── */

test("RUTA · solo lee questionId y option del cuerpo; el usuario sale del Bearer", () => {
  assert.match(ROUTE, /const questionId = typeof body\.questionId === "string"/);
  assert.match(ROUTE, /const option = typeof body\.option === "string"/);
  assert.match(ROUTE, /submitPick\(session\.admin, session\.userId, questionId, option\)/);
  for (const campo of ["correct_option", "correctOption", "points", "score", "locks_at", "locksAt", "userId:", "reward", "result"]) {
    assert.ok(!new RegExp(`body\\.${campo}`).test(ROUTE), `el cuerpo no puede traer ${campo}`);
  }
  assert.match(ROUTE, /option\.length > 64/, "una opción no es texto libre");
});

/* ─────────────── recompensas: una clave por escalón ─────────────── */

test("RECOMPENSA · se concede por app_grant_reward con ref pickem:<evento>:<escalón>; correr dos veces usa la MISMA clave", async () => {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const sb = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      if (name === "app_score_pickem_event") return { data: { users: 1, pointsAwarded: 55 }, error: null };
      return { data: { applied: true, credits: 3000 }, error: null };
    },
    from: () => ({
      select: () => ({
        eq: async () => ({ data: [{ user_id: "u1", points: 55 }], error: null }),
        // Fase 42 · lectura única de lo ya pagado en el evento (sin escalones previos pagados).
        in: async () => ({ data: [], error: null }),
      }),
    }),
  } as unknown as SupabaseClient;
  await scorePickemEvent(sb, "ev1");
  await scorePickemEvent(sb, "ev1");
  const grants = calls.filter((c) => c.name === "app_grant_reward");
  assert.equal(grants.length, 2, "una concesión por pasada");
  assert.deepEqual(grants.map((g) => g.args.p_ref), ["pickem:ev1:analista", "pickem:ev1:analista"],
    "misma clave de idempotencia las dos veces: el libro mayor rechaza la segunda");
  assert.equal(grants[0].args.p_points, 0, "los PUNTOS no van por la recompensa: los reparte el corrector");
  assert.equal(calls.filter((c) => c.name === "app_score_pickem_event").length, 2);
});

/* ─────────────── ciclo de vida: campeón ─────────────── */

const NOW = Date.parse("2026-03-01T12:00:00Z");
const future = (h: number) => new Date(NOW + h * 3600_000).toISOString();
const cuadro = (): MatchInput[] => [
  { id: "m1", team_a: "Team Heretics", team_b: "Fnatic", start_time: future(24), status: "upcoming", winner_team: null, round: "Group A", match_order: 1 },
  { id: "m2", team_a: "Team Liquid", team_b: "Karmine Corp", start_time: future(26), status: "upcoming", winner_team: null, round: "Group A", match_order: 2 },
];

/** Un `from()` de mentira: devuelve por tabla lo que se le diga y anota inserts/updates. */
function fakeDb(rows: Record<string, unknown[]>, log: { inserted: unknown[]; updated: unknown[]; rpc: unknown[] }) {
  const chain = (table: string) => {
    const self: Record<string, unknown> = {};
    const q = () => self;
    Object.assign(self, {
      select: q, eq: q, not: q, order: q, limit: q, is: q, in: q,
      maybeSingle: async () => ({ data: (rows[table] ?? [])[0] ?? null, error: null }),
      then: (res: (v: unknown) => unknown) => Promise.resolve({ data: rows[table] ?? [], error: null }).then(res),
      insert: async (v: unknown) => { log.inserted.push({ table, v }); return { error: null }; },
      update: (v: unknown) => ({ eq: async () => { log.updated.push({ table, v }); return { error: null }; } }),
    });
    return self;
  };
  return {
    from: (t: string) => chain(t),
    rpc: async (name: string, args: unknown) => { log.rpc.push({ name, args }); return { data: null, error: null }; },
  } as unknown as SupabaseClient;
}

test("LIFECYCLE · la pregunta de campeón nace de los partidos reales, una sola vez, y no sin datos", async () => {
  const log = { inserted: [] as unknown[], updated: [] as unknown[], rpc: [] as unknown[] };
  const sb = fakeDb({ pickem_questions: [] }, log);
  const r = await syncChampionQuestion(sb, "pe1", cuadro(), NOW);
  assert.equal(r.created, 1);
  const ins = log.inserted[0] as { v: { kind: string; match_id: null; options: { key: string }[]; points: number; locks_at: string } };
  assert.equal(ins.v.kind, "champion");
  assert.equal(ins.v.match_id, null);
  assert.deepEqual(ins.v.options.map((o) => o.key), ["fnatic", "karmine-corp", "team-heretics", "team-liquid"]);
  assert.equal(ins.v.locks_at, future(24));

  // Torneo con solo dos equipos: no hay datos suficientes → no se crea nada.
  const log2 = { inserted: [] as unknown[], updated: [] as unknown[], rpc: [] as unknown[] };
  const r2 = await syncChampionQuestion(fakeDb({ pickem_questions: [] }, log2), "pe1", [cuadro()[0]], NOW);
  assert.equal(r2.created, 0);
  assert.equal(log2.inserted.length, 0);
});

test("LIFECYCLE · si ya existe, no se duplica; abierta, se le añaden participantes nuevos; cerrada, no se toca", async () => {
  const existing = { id: "qc", options: [{ key: "fnatic", label: "Fnatic" }, { key: "nrg", label: "NRG" }], locks_at: future(24), correct_option: null };
  const log = { inserted: [] as unknown[], updated: [] as unknown[], rpc: [] as unknown[] };
  const r = await syncChampionQuestion(fakeDb({ pickem_questions: [existing] }, log), "pe1", cuadro(), NOW);
  assert.equal(r.created, 0);
  assert.equal(r.relabelled, 1);
  const up = log.updated[0] as { v: { options: { key: string }[] } };
  assert.deepEqual(up.v.options.map((o) => o.key), ["fnatic", "nrg", "karmine-corp", "team-heretics", "team-liquid"], "no quita nrg");

  const log3 = { inserted: [] as unknown[], updated: [] as unknown[], rpc: [] as unknown[] };
  const cerrada = { ...existing, locks_at: new Date(NOW - 1000).toISOString() };
  const r3 = await syncChampionQuestion(fakeDb({ pickem_questions: [cerrada] }, log3), "pe1", cuadro(), NOW);
  assert.equal(r3.relabelled, 0);
  assert.equal(log3.updated.length, 0);
});

test("LIFECYCLE · el campeón se fija con app_set_correct_option cuando la gran final termina; antes, pendiente", async () => {
  const champQ = { id: "qc", match_id: null, kind: "champion", correct_option: null, options: [{ key: "fnatic", label: "Fnatic" }, { key: "nrg", label: "NRG" }, { key: "team-heretics", label: "Team Heretics" }, { key: "team-liquid", label: "Team Liquid" }] };
  const gf: MatchInput = { id: "gf", team_a: "Fnatic", team_b: "NRG", start_time: future(-1), status: "finished", winner_team: "NRG", round: "Grand Final", match_order: 9 };

  const log = { inserted: [] as unknown[], updated: [] as unknown[], rpc: [] as unknown[] };
  const r = await resolveFinished(fakeDb({ pickem_questions: [champQ], matches: [gf] }, log), "pe1", "ev1");
  assert.equal(r.resolved, 1);
  assert.deepEqual(log.rpc[0], { name: "app_set_correct_option", args: { p_question_id: "qc", p_correct: "nrg" } });

  const log2 = { inserted: [] as unknown[], updated: [] as unknown[], rpc: [] as unknown[] };
  const r2 = await resolveFinished(fakeDb({ pickem_questions: [champQ], matches: [{ ...gf, status: "live", winner_team: null }] }, log2), "pe1", "ev1");
  assert.equal(r2.resolved, 0);
  assert.equal(r2.pending, 1);
  assert.equal(log2.rpc.length, 0);
});

test("LIFECYCLE · advance se corrige solo con clasificados reales (standings); sin ellos queda pendiente", async () => {
  const advQ = { id: "qa", match_id: null, kind: "advance", correct_option: null, options: [{ key: "fnatic", label: "Fnatic" }, { key: "nrg", label: "NRG" }] };
  const log = { inserted: [] as unknown[], updated: [] as unknown[], rpc: [] as unknown[] };
  const r = await resolveFinished(fakeDb({ pickem_questions: [advQ], matches: [], standings: [{ team_id: "fnc", status: "qualified", teams: { name: "Fnatic" } }] }, log), "pe1", "ev1");
  assert.equal(r.resolved, 1);
  assert.deepEqual(log.rpc[0], { name: "app_set_correct_option", args: { p_question_id: "qa", p_correct: "fnatic" } });

  const log2 = { inserted: [] as unknown[], updated: [] as unknown[], rpc: [] as unknown[] };
  const r2 = await resolveFinished(fakeDb({ pickem_questions: [advQ], matches: [], standings: [] }, log2), "pe1", "ev1");
  assert.equal(r2.pending, 1);
  assert.equal(log2.rpc.length, 0);
});
