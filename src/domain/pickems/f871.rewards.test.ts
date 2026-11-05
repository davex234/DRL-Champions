/**
 * F87.1 · REGLAS V1 APROBADAS de Pick'ems 2.0 — fronteras exactas en enteros, un solo escalón (no acumulativo),
 * participación sobre los partidos puntuables, perfecto con VOID y con hueco sin pick, exactitud de las reglas (espejo
 * de `_pickem_rules_v1_ok`) y bloqueos de activación. La paridad con la SQL se prueba en `scripts/ops/_f871-dryrun.sh`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { atLeast, describeTierReward, isRewardRulesV1, liabilityOf, rewardRulesV1, tierFor, tierValue, REWARD_RULES_V1, type CatalogLookup, type RewardTierId } from "./bracketRewards";
import { deriveFormat } from "./format";
import { fillBracket, predictedParticipants, realStateOf, scoreEntry } from "./prediction";
import { finish, gsl1, place } from "./testing/formatFixtures";
import { activationBlockers } from "@/server/admin/pickems";
import { packLabel } from "./ledger";

const PRICES: Record<string, number> = { estandar: 2500, premium: 6000, oro: 12000, masters: 20000 };
const cat: CatalogLookup = { packPrice: (id) => PRICES[id] ?? null, cardExists: () => false };
const V1 = rewardRulesV1("champions-2027-playoffs");
const at = (points: number, maxPoints: number, picked = 10, scorable = 10, perfect = false) =>
  tierFor(V1, { points, maxPoints, picked, scorable, perfect, completion: picked / scorable, ratio: points / maxPoints });

test("reglas v1 = la tabla aprobada (Bronce · Plata ≥50 % · Oro ≥70 % · Masters ≥85 % · perfecto Masters + insignia), OFF por defecto", () => {
  assert.equal(V1.rulesVersion, REWARD_RULES_V1);
  assert.equal(V1.status, "OFF");
  assert.equal(V1.minCompletion, 0.8);
  assert.deepEqual(V1.tiers.map((t) => [t.id, t.minRatio, t.reward.packId, t.reward.packCount, tierValue(t.reward, cat)]), [
    ["PARTICIPATION", null, "estandar", 1, 2500], ["GOOD", 0.5, "premium", 1, 6000], ["GREAT", 0.7, "oro", 1, 12000],
    ["ELITE", 0.85, "masters", 1, 20000], ["PERFECT", null, "masters", 1, 20000],
  ]);
  assert.deepEqual(V1.tiers[4].reward.cosmetics, ["insignia:pickem:champions-2027-playoffs-perfecto"], "insignia POR ÁMBITO/evento");
  assert.deepEqual(describeTierReward(V1.tiers[4].reward, packLabel), ["Sobre Masters", "Insignia «Pick'em perfecto»"]);
  assert.ok(isRewardRulesV1(V1, "champions-2027-playoffs"));
});

test("cualquier variación deja de ser v1 (la BD tampoco la activa)", () => {
  const slug = "champions-2027-playoffs";
  const mut = (f: (c: ReturnType<typeof rewardRulesV1>) => void) => { const c = rewardRulesV1(slug); f(c); return isRewardRulesV1(c, slug); };
  assert.equal(mut((c) => { c.tiers[3].reward.packId = "champions"; }), false);
  assert.equal(mut((c) => { c.tiers[1].minRatio = 0.4; }), false);
  assert.equal(mut((c) => { c.tiers[0].reward.credits = 1; }), false);
  assert.equal(mut((c) => { c.tiers[2].reward.packCount = 2; }), false);
  assert.equal(mut((c) => { c.minCompletion = 0.5; }), false);
  assert.equal(mut((c) => { c.tiers.pop(); }), false);
  assert.equal(mut((c) => { c.rulesVersion = "x"; }), false);
  assert.equal(mut((c) => { c.tiers[4].reward.cosmetics = ["insignia:pickem:otro-perfecto"]; }), false);
  assert.equal(isRewardRulesV1(V1, "otro-slug"), false, "la insignia es de ESTE ámbito");
});

test("fronteras exactas en enteros: 49,9… / 50 / 69,9… / 70 / 84,9… / 85 / 99,9… / 100", () => {
  assert.equal(at(499, 1000), "PARTICIPATION");
  assert.equal(at(500, 1000), "GOOD");
  assert.equal(at(699, 1000), "GOOD");
  assert.equal(at(700, 1000), "GREAT");
  assert.equal(at(849, 1000), "GREAT");
  assert.equal(at(850, 1000), "ELITE");
  assert.equal(at(999, 1000), "ELITE");
  assert.equal(at(1000, 1000, 10, 10, false), "ELITE", "100 % de los puntos sin todos los picks correctos no es perfecto");
  assert.equal(at(1000, 1000, 10, 10, true), "PERFECT");
  // Fracciones que en coma flotante bailan: 7/10, 14/20, 17/20 (=0,85), 21/30.
  assert.equal(at(7, 10), "GREAT"); assert.equal(at(14, 20), "GREAT"); assert.equal(at(17, 20), "ELITE"); assert.equal(at(21, 30), "GREAT");
  assert.ok(atLeast(4, 5, 0.8) && !atLeast(79, 100, 0.8) && atLeast(80, 100, 0.8));
  assert.equal(atLeast(1, 0, 0.5), false, "sin máximo no hay división por cero ni escalón");
});

test("participación: ≥ 80 % de los puntuables; por debajo, NADA aunque la puntuación sea alta", () => {
  assert.equal(at(1, 28, 16, 20), "PARTICIPATION", "16/20 = 80 % justo");
  assert.equal(at(28, 28, 15, 20), null, "15/20 = 75 %: nada, ni siquiera con todos los puntos");
  assert.equal(at(0, 28, 20, 20), "PARTICIPATION", "rellenar el cuadro entero sin acertar: solo Bronce");
});

test("NO acumulativo: cada jugador cobra UN escalón; el pasivo por jugador es el escalón más caro", () => {
  const tiers = new Set<RewardTierId | null>();
  for (let p = 0; p <= 28; p++) tiers.add(at(p, 28, 20, 20));
  for (const t of tiers) assert.ok(t === null || ["PARTICIPATION", "GOOD", "GREAT", "ELITE"].includes(t));
  assert.equal(typeof at(24, 28, 20, 20), "string", "un único identificador, nunca una lista");
  assert.equal(liabilityOf(V1, cat).maxTierValue, 20000);
  assert.deepEqual([10, 100, 1000, 10000].map((n) => liabilityOf(V1, cat).worstCase(n)), [200_000, 2_000_000, 20_000_000, 200_000_000]);
});

test("perfecto con VOID (no lo rompe) y con un hueco sin pick (sí lo rompe), sobre un GSL jugado", () => {
  const f = gsl1();
  const ctx0 = { descriptor: deriveFormat({ eventId: "e", stages: f.stages, matches: f.matches }).descriptor!, real: realStateOf(f.matches) };
  const picks = fillBracket(ctx0, (_id, pair) => pair[0].id);
  let ms = f.matches;
  for (let k = 0; k < 6; k++) for (const n of ctx0.descriptor.nodes) {
    const row = ms.find((m) => m.id === n.matchId)!;
    if (row.status === "finished") continue;
    const pair = predictedParticipants({ descriptor: ctx0.descriptor, real: realStateOf(ms) }, picks).get(n.matchId)!;
    if (!pair[0] || !pair[1]) continue;
    ms = place(ms, n.matchId, pair[0].id, pair[1].id); ms = finish(ms, n.matchId, picks[n.matchId] === pair[0].id ? "a" : "b");
  }
  const ctx = { descriptor: ctx0.descriptor, real: realStateOf(ms) };
  const all = scoreEntry(ctx, picks, () => true);
  assert.equal(tierFor(V1, all), "PERFECT");
  const v = { ...ctx, voided: new Set(["gsl-a-e"]) };
  const missingVoid: Record<string, string> = { ...picks }; delete missingVoid["gsl-a-e"];
  assert.equal(tierFor(V1, scoreEntry(v, missingVoid, () => true)), "PERFECT", "el anulado sale del denominador y no rompe el perfecto");
  const missing: Record<string, string> = { ...picks }; delete missing["gsl-a-o1"];
  const s = scoreEntry(ctx, missing, () => true);
  assert.equal(s.perfect, false);
  assert.equal(tierFor(V1, s), "ELITE", "4/5 picks (80 %), 6/7 puntos (85,7 %) → Masters sin insignia");
});

test("bloqueos de activación: autoridad legacy, cuadro inválido, reglas no aprobadas, congelado, cerrado", () => {
  const ok = { status: "DRAFT", legacyAuthority: false, issues: [], rewards: rewardRulesV1("s"), slug: "s", anyLocked: false };
  assert.deepEqual(activationBlockers(ok), []);
  assert.match(activationBlockers({ ...ok, legacyAuthority: true }).join(" "), /legacy/);
  assert.match(activationBlockers({ ...ok, issues: [{ severity: "ERROR", code: "LOSER_MISSING", message: "x" }] }).join(" "), /validador/);
  assert.match(activationBlockers({ ...ok, rewards: { ...rewardRulesV1("s"), rulesVersion: undefined } }).join(" "), /regla aprobada/);
  assert.match(activationBlockers({ ...ok, status: "PUBLISHED", anyLocked: true }).join(" "), /congeladas/);
  assert.match(activationBlockers({ ...ok, status: "SETTLED" }).join(" "), /liquidado/);
});
