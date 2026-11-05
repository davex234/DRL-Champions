/**
 * F87.2 · PICK'EMS LAUNCH GUARD — elegibilidad para cobrar (fronteras exactas y espejo de la BD), preparación de
 * lanzamiento (cada puerta por separado + un cuadro LISTO), el ciclo legacy que ya no crea Pick'ems y el contrato de
 * 0073 y su rollback. La autoridad real (SQL) se ensaya aparte en `scripts/ops/_f872-dryrun.sh`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { evaluateEligibility, eligibilityMessage, policyOf, requirementText, REWARD_ELIGIBILITY_V1, ELIGIBILITY_POLICIES } from "./eligibility";
import { launchReadiness, GATE_LABEL, type LaunchInput } from "./launch";
import { deriveFormat, validateFormat, PICKEM_SCORING_VERSION, type FormatIssue } from "./format";
import { rewardRulesV1, tierFor, EMPTY_REWARDS } from "./bracketRewards";
import { de8, se8 } from "./testing/formatFixtures";
import { activationBlockers } from "@/server/admin/pickems";
import { runPickemLifecycle } from "@/server/services/pickemLifecycle";
import { FakeDb } from "@/lib/esports/autosync/testing/fakeSupabase";

const DAY = 86_400_000;
const REF = "2027-03-10T12:00:00.000Z";
const ref = Date.parse(REF);
const ev = (createdMsBeforeRef: number, matches: number, now = ref - DAY, policyId: string | null = REWARD_ELIGIBILITY_V1) =>
  evaluateEligibility({ policyId, accountCreatedAt: new Date(ref - createdMsBeforeRef).toISOString(), completedMatches: matches, referenceAt: REF, now });

test("política v1: ≥ 7 días Y ≥ 3 partidas en el PRIMER CIERRE; fronteras exactas", () => {
  assert.equal(ev(7 * DAY, 3).code, "ELIGIBLE", "7 días justos y 3 partidas → elegible");
  assert.equal(ev(7 * DAY - 1, 3).code, "ACCOUNT_TOO_NEW", "1 ms menos de 7 días → demasiado reciente");
  assert.equal(ev(30 * DAY, 2).code, "NOT_ENOUGH_MATCHES", "2 partidas → no");
  assert.equal(ev(1 * DAY, 0).code, "ACCOUNT_TOO_NEW_AND_NOT_ENOUGH_MATCHES");
  assert.equal(ev(30 * DAY, 3, ref + 1).final, true, "tras el primer cierre el resultado es definitivo");
  assert.equal(ev(30 * DAY, 3, ref - 1).final, false, "antes del cierre es la vista previa");
  assert.equal(ev(30 * DAY, 99, ref, null).code, "POLICY_MISSING", "sin política nadie cobra (falla cerrada)");
  assert.equal(ev(30 * DAY, 99, ref, "reward-eligibility-v2").code, "POLICY_MISSING", "política desconocida → falla cerrada");
  assert.equal(evaluateEligibility({ policyId: REWARD_ELIGIBILITY_V1, accountCreatedAt: null, completedMatches: 9, referenceAt: REF, now: ref }).code, "NO_ACCOUNT");
  assert.equal(evaluateEligibility({ policyId: REWARD_ELIGIBILITY_V1, accountCreatedAt: REF, completedMatches: 9, referenceAt: null, now: ref }).code, "NO_REFERENCE");
});

test("la política de TS es EXACTAMENTE la de la BD (0073) y no hay otra registrada", () => {
  const sql = readFileSync(join(process.cwd(), "supabase", "migrations", "0073_pickems_launch_guard.sql"), "utf8");
  const p = policyOf(REWARD_ELIGIBILITY_V1)!;
  assert.match(sql, new RegExp(`'id', 'reward-eligibility-v1', 'minAccountAgeDays', ${p.minAccountAgeDays}, 'minCompletedMatches', ${p.minCompletedMatches},`));
  assert.match(sql, new RegExp(`'countedModes', jsonb_build_array\\(${p.countedModes.map((m) => `'${m}'`).join(", ")}\\), 'countedStatuses', jsonb_build_array\\(${p.countedStatuses.map((m) => `'${m}'`).join(", ")}\\)`));
  assert.deepEqual(Object.keys(ELIGIBILITY_POLICIES), [REWARD_ELIGIBILITY_V1]);
  assert.ok(!p.countedModes.includes("PVP_PRIVATE"), "las privadas entre amigos no cuentan");
});

test("mensajes: participar sí, cobrar no; sin culpar; requisito explicado sin detalles internos", () => {
  const m = eligibilityMessage(ev(1 * DAY, 0));
  assert.match(m, /^Puedes participar, pero esta cuenta todavía no cumple los requisitos para recibir recompensas/);
  assert.match(eligibilityMessage(ev(30 * DAY, 1)), /te faltan 2 partida/);
  assert.match(requirementText(policyOf(REWARD_ELIGIBILITY_V1)), /al menos 7 días y 3 partidas jugadas antes del primer cierre/);
  assert.doesNotMatch(requirementText(policyOf(REWARD_ELIGIBILITY_V1)), /IP|dispositivo|teléfono|correo/i);
});

test("rendimiento ≠ elegibilidad: el escalón no depende de la cuenta; v1 lleva la política y conserva sus escalones", () => {
  const v1 = rewardRulesV1("qa");
  assert.equal(v1.eligibilityPolicy, REWARD_ELIGIBILITY_V1);
  assert.deepEqual(v1.tiers.map((t) => [t.id, t.minRatio, t.reward.packId]), [["PARTICIPATION", null, "estandar"], ["GOOD", 0.5, "premium"], ["GREAT", 0.7, "oro"], ["ELITE", 0.85, "masters"], ["PERFECT", null, "masters"]]);
  const perfect = { points: 10, maxPoints: 10, picked: 5, scorable: 5, perfect: true, completion: 1, ratio: 1 };
  assert.equal(tierFor(v1, perfect), "PERFECT", "un perfecto es PERFECTO aunque la cuenta no pueda cobrar");
});

/* ── preparación de lanzamiento ── */
function base(over: Partial<LaunchInput> = {}, fx = se8()): LaunchInput {
  const d = deriveFormat({ eventId: fx.matches[0].event_id ?? "e", stages: fx.stages, matches: fx.matches, adminEdges: fx.adminEdges }).descriptor!;
  const issues = validateFormat(d, fx.matches);
  const now = Date.parse("2020-01-01T00:00:00Z");
  return {
    status: "DRAFT", issues, sourceDerivable: true, driftChanged: false,
    nodes: d.nodes.map((n) => { const m = fx.matches.find((x) => x.id === n.matchId)!; return { matchId: n.matchId, points: n.points, lockAt: null, start: m.start_time, realStatus: "upcoming", locked: false }; }),
    scoringVersion: PICKEM_SCORING_VERSION, maxPoints: d.nodes.reduce((s, n) => s + n.points, 0),
    rewards: rewardRulesV1("qa", "DRAFT"), rewardIssues: [], slug: "qa", maxTierValue: 20_000, legacyAuthority: false, now, ...over,
  };
}
const failing = (r: ReturnType<typeof launchReadiness>) => r.gates.filter((g) => g.state === "FAIL").map((g) => g.id);

test("cuadro válido con reglas v1 → LISTO PARA LANZAR CON RECOMPENSAS; con recompensas OFF → LISTO SIN RECOMPENSAS", () => {
  const r = launchReadiness(base());
  assert.deepEqual(failing(r), []);
  assert.equal(r.structure, "READY"); assert.equal(r.rewards, "READY"); assert.equal(r.launch, "READY_WITH_REWARDS");
  const off = launchReadiness(base({ rewards: EMPTY_REWARDS, maxTierValue: null }));
  assert.equal(off.structure, "READY"); assert.equal(off.rewards, "OFF"); assert.equal(off.launch, "READY_WITHOUT_REWARDS");
  assert.deepEqual(off.publishBlockers, [], "publicar sin recompensas no exige el sistema de elegibilidad");
  assert.equal(Object.keys(GATE_LABEL).length, 8);
});

test("cada bloqueo por separado, con motivo concreto", () => {
  const cases: [string, Partial<LaunchInput> | ((b: LaunchInput) => LaunchInput), string, RegExp][] = [
    ["arista de perdedor sin resolver", (b) => ({ ...b, ...(() => { const fx = de8(false); const x = base({}, fx); return { issues: x.issues, nodes: x.nodes, maxPoints: x.maxPoints }; })() }), "STRUCTURE", /LOSER_MISSING/],
    ["ciclo", (b) => ({ ...b, issues: [...b.issues, { severity: "ERROR", code: "CYCLE", message: "Hay un ciclo en el cuadro" } as FormatIssue] }), "STRUCTURE", /CYCLE/],
    ["fuente contradicha", (b) => ({ ...b, issues: [...b.issues, { severity: "ERROR", code: "ADMIN_CONTRADICTS_SOURCE", message: "x" } as FormatIssue] }), "SOURCE", /ADMIN_CONTRADICTS_SOURCE/],
    ["deriva de la fuente", { driftChanged: true }, "SOURCE", /refréscalo/],
    ["cierre inválido", (b) => ({ ...b, nodes: b.nodes.map((n, i) => (i === 0 ? { ...n, start: null, lockAt: null } : n)) }), "LOCKS", /sin cierre válido/],
    ["sin versión de puntuación", { scoringVersion: "" }, "SCORING", /Versión de puntuación/],
    ["máximo incoherente", { maxPoints: 1 }, "SCORING", /incoherente/],
    ["sobre inexistente", { rewardIssues: [{ severity: "ERROR", code: "PACK_UNKNOWN", message: "El sobre «x» no existe" }] }, "REWARDS", /PACK_UNKNOWN/],
    ["reglas no aprobadas", (b) => ({ ...b, rewards: { ...b.rewards, tiers: b.rewards.tiers.map((t) => (t.id === "ELITE" ? { ...t, reward: { packId: "champions", packCount: 1 } } : t)) } }), "REWARDS", /regla aprobada/],
    ["sin política de elegibilidad", (b) => ({ ...b, rewards: { ...b.rewards, eligibilityPolicy: undefined } }), "REWARDS", /política de elegibilidad/],
    ["política desconocida", (b) => ({ ...b, rewards: { ...b.rewards, eligibilityPolicy: "reward-eligibility-v9" } }), "REWARDS", /política de elegibilidad/],
    ["pasivo no calculable", { maxTierValue: null }, "ECONOMY", /pasivo/],
    ["colisión legacy", { legacyAuthority: true }, "LEGACY", /autoridad legacy/],
    ["ya empezó un partido", (b) => ({ ...b, nodes: b.nodes.map((n, i) => (i === 0 ? { ...n, realStatus: "live" } : n)) }), "TIME", /congeladas/],
    ["primer cierre pasado", (b) => ({ ...b, now: Date.parse(b.nodes[0].start!) + 1 }), "TIME", /congeladas/],
    ["liquidado", { status: "SETTLED" }, "TIME", /liquidado/],
  ];
  for (const [name, mut, gate, re] of cases) {
    const b = base();
    const r = launchReadiness(typeof mut === "function" ? mut(b) : { ...b, ...mut });
    assert.ok(failing(r).includes(gate as never), `${name}: debería fallar ${gate} (falla ${failing(r).join(",")})`);
    assert.match(r.gates.find((g) => g.id === gate)!.blockers.join(" "), re, name);
    assert.notEqual(r.launch, "READY_WITH_REWARDS", name);
    if (["REWARDS", "ECONOMY", "LEGACY", "TIME"].includes(gate) && name !== "liquidado" && !name.startsWith("ya empezó") && name !== "primer cierre pasado") {
      assert.equal(r.structure, "READY", `${name}: lo de recompensas NO impide publicar sin recompensas`);
    }
  }
});

test("activationBlockers (F87.1) sigue diciendo lo mismo y ahora exige la política", () => {
  const ok = { status: "DRAFT", legacyAuthority: false, issues: [], rewards: rewardRulesV1("s"), slug: "s", anyLocked: false };
  assert.deepEqual(activationBlockers(ok), []);
  assert.match(activationBlockers({ ...ok, rewards: { ...rewardRulesV1("s"), eligibilityPolicy: undefined } }).join(" "), /política de elegibilidad/);
});

/* ── legacy: el ciclo ya no crea Pick'ems clásicos; continúa solo los LEGACY_V1 ── */
test("ciclo legacy: torneo SIN Pick'em clásico → no crea ninguno; RETIRED → no lo continúa; LEGACY_V1 → lo continúa", async () => {
  const mk = (pe?: Record<string, unknown>) => {
    const db = new FakeDb();
    db.seed("events", [{ id: "ev-x", name: "QA", status: "upcoming", end_date: "2027-01-11T00:00:00Z" }]);
    db.seed("matches", []);
    if (pe) db.seed("pickem_events", [pe]);
    return db;
  };
  const none = mk();
  const r0 = await runPickemLifecycle(none.client(), "ev-x", Date.parse("2026-12-01T00:00:00Z"));
  assert.equal(r0.pickemEventId, null); assert.equal(none.rows("pickem_events").length, 0, "no se crea un Pick'em clásico nuevo");
  assert.match(r0.notes.join(" "), /retirados/);
  const retired = mk({ id: "pe-r", event_id: "ev-x", status: "open", legacy_mode: "RETIRED", created_at: "2026-10-07T00:00:00Z" });
  assert.equal((await runPickemLifecycle(retired.client(), "ev-x", Date.parse("2026-12-01T00:00:00Z"))).pickemEventId, null, "un RETIRED no entra en el ciclo legacy");
  const legacy = mk({ id: "pe-l", event_id: "ev-x", status: "open", legacy_mode: "LEGACY_V1", created_at: "2026-09-01T00:00:00Z" });
  assert.equal((await runPickemLifecycle(legacy.client(), "ev-x", Date.parse("2026-12-01T00:00:00Z"))).pickemEventId, "pe-l", "un LEGACY_V1 existente termina su ciclo");
});

/* ── contrato de 0073 y su rollback ── */
test("0073: sin privilegios de cliente, guardias de 0072 conservadas, y el rollback devuelve EXACTAMENTE las de 0072", () => {
  const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
  const m73 = read("supabase", "migrations", "0073_pickems_launch_guard.sql");
  const m72 = read("supabase", "migrations", "0072_pickems_reward_cutover.sql");
  const rb = read("docs", "operations", "rollback", "0073_pickems_launch_guard.ROLLBACK.sql");
  for (const f of ["_pickem_eligibility_policy(text)", "_pickem_first_lock(uuid)", "_pickem_window_closed(uuid, timestamptz)", "app_pickem_reward_eligibility(uuid, uuid, timestamptz)", "app_pickem_eligibility_summary(uuid)"]) {
    assert.ok(m73.includes(`revoke all on function public.${f} from public, anon, authenticated;`), f);
  }
  for (const code of ["PICKEM_LEGACY_AUTHORITY", "PICKEM_RULES_NOT_APPROVED", "PICKEM_ELIGIBILITY_POLICY_REQUIRED", "PICKEM_REWARDS_TOO_LATE", "PICKEM_REWARDS_FROZEN", "PICKEM_REWARD_INELIGIBLE"]) assert.ok(m73.includes(code), code);
  assert.ok(!/insert into public\.(credit_transactions|pickem_events)/.test(m73), "0073 no escribe libro ni Pick'ems legacy");
  const body = (src: string, fn: string) => { const i = src.indexOf(`create or replace function public.${fn}()`); return src.slice(i, src.indexOf("end; $$;", i) + 8); };
  for (const fn of ["_pickem_brackets_rewards_guard", "_pickem_claims_authority_guard"]) assert.equal(body(rb, fn), body(m72, fn), `rollback = 0072 · ${fn}`);
  assert.match(rb, /hay recompensas 2\.0 ACTIVAS/);
  assert.ok(!/pickem_events_legacy_guard|drl\.pickem_legacy_writer/.test(rb), "el rollback NO toca la creación de legacy");
});
