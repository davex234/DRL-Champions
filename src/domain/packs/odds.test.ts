/**
 * PROBABILIDADES COMPRENSIBLES (Fase 25) — pruebas 5 y 6 del brief: derivadas del motor real,
 * y el sobre de equipo comunica «aumentada», nunca «contiene».
 */
import test from "node:test";
import assert from "node:assert/strict";
import { PACKS, getPack } from "@/data/packs";
import { packStats } from "@/data/packStats";
import { isStoreVisible } from "@/domain/packs/lifecycle";
import { teamCardCount } from "@/components/packs/packIdentity";
import { atLeastOneIn, normalizedWeights, packOddsFor, pct, teamBoostCopy, BUCKET_ORDER } from "./odds";
import { packPlan } from "./packClass";

test("5 · las probabilidades por carta SON la distribución medida con el motor (packStats), no una tabla escrita a mano", () => {
  for (const p of PACKS.filter(isStoreVisible)) {
    const stats = packStats(p.id);
    if (!stats) continue;
    const odds = packOddsFor(p, stats, 0);
    // Fase 57.3 / Pack Opening 3.1 · todo sobre con PLAN (línea principal, regionales, equipos, EWC) enseña su reparto por
    // clase (contrato en `packClass.test.ts` y `tierIdentity.test.ts`), no rarezas.
    if (packPlan(p.id)) { assert.equal(odds.rows.length, 0, p.id); assert.ok(odds.classOdds, p.id); continue; }
    assert.equal(odds.source, "measured");
    for (const row of odds.rows) {
      const expected: number = stats.impossible.includes(row.bucket) ? 0 : stats.drawn[row.bucket];
      assert.equal(row.perCard, expected, `${p.id}/${row.bucket}`);
      assert.equal(row.impossible, stats.impossible.includes(row.bucket) || expected === 0);
    }
    const sum = odds.rows.reduce((s, r) => s + r.perCard, 0);
    assert.ok(Math.abs(sum - 1) < 0.02, `${p.id} suma ${sum}`);
  }
});

test("5b · «al menos una por sobre» es 1−(1−p)^n; «Garantizada» solo donde es VERDAD (fix F25)", () => {
  assert.equal(atLeastOneIn(0.5, 2), 0.75);
  assert.equal(atLeastOneIn(0, 5), 0);
  assert.equal(atLeastOneIn(1, 5), 1);
  /*
   * La garantía del catálogo es «al menos una de esta rareza O SUPERIOR». Ninguna fila puede decir «Garantizada» si puede
   * salir una rareza superior en su lugar, y las INFERIORES a la garantía nunca (F25 marcaba «Común · Garantizada»).
   */
  // Pack Opening 3.1 · EWC ya sortea por plan: el único sobre por rareza con garantía que queda es Prime (retirado, solo
  // recompensa), y la regla sigue valiendo para él y para cualquier producto futuro por rareza.
  const withG = PACKS.filter((p) => p.guaranteedMin && !packPlan(p.id));
  assert.ok(withG.length > 0, "hay sobres por rareza con garantía (p. ej. Prime)");
  for (const p of withG) {
    const odds = packOddsFor(p, packStats(p.id) ?? null, 0);
    assert.equal(odds.guaranteedMin, p.guaranteedMin);
    const gi = BUCKET_ORDER.indexOf(p.guaranteedMin!);
    const abovePossible = odds.rows.some((r) => BUCKET_ORDER.indexOf(r.bucket) > gi && r.perCard > 0);
    for (const r of odds.rows) {
      const i = BUCKET_ORDER.indexOf(r.bucket);
      if (i < gi) assert.equal(r.guaranteed, false, `${p.id}/${r.bucket}: inferior a la garantía`);
      if (i > gi) assert.ok(!r.guaranteed && (r.impossible || r.atLeastOne < 1), `${p.id}/${r.bucket}: superior`);
      if (i === gi) assert.equal(r.guaranteed, !abovePossible, `${p.id}/${r.bucket}`);
    }
  }
  // Prime (épica o superior, y puede dar legendaria): ninguna fila «Garantizada».
  assert.ok(packOddsFor(getPack("prime")!, packStats("prime") ?? null, 0).rows.every((r) => !r.guaranteed));
  // Si la rareza garantizada es la más alta posible, entonces sí: 100 % y «Garantizada».
  const top = packOddsFor({ id: "x-top", cardCount: 3, weights: { common: 50, uncommon: 50, rare: 0, epic: 0, legendary: 0 }, guaranteedMin: "uncommon" }, null, 0);
  const u = top.rows.find((r) => r.bucket === "uncommon")!;
  assert.equal(u.guaranteed, true);
  assert.equal(u.atLeastOne, 1);
  assert.equal(top.rows.find((r) => r.bucket === "common")!.guaranteed, false);
});

test("5c · sin medición se cae a los pesos declarados normalizados (misma matemática del motor, sin garantías)", () => {
  const pack = getPack("inicial")!; // Pack Opening 3.1: EMEA ya sortea por plan; el Sobre Inicial sigue por rareza.
  const odds = packOddsFor(pack, null, 0);
  assert.equal(odds.source, "weights");
  const w = normalizedWeights(pack.weights);
  for (const r of odds.rows) assert.equal(r.perCard, w[r.bucket]);
  assert.ok(Math.abs(odds.rows.reduce((s, r) => s + r.perCard, 0) - 1) < 1e-9);
});

test("6 · Team Heretics: «probabilidad aumentada», y NUNCA «contiene» ni «garantizado»", () => {
  const th = PACKS.find((p) => p.team === "Team Heretics" && isStoreVisible(p))!;
  assert.ok(th, "el sobre de Team Heretics existe y es visible");
  const odds = packOddsFor(th, packStats(th.id) ?? null, teamCardCount("Team Heretics").total);
  assert.ok(odds.teamBoost);
  assert.match(odds.teamBoost!.copy, /Probabilidad aumentada de jugadores de Team Heretics/);
  assert.match(odds.teamBoost!.copy, /no están garantizadas|No está garantizado/);
  assert.ok(!/contiene un jugador/i.test(odds.teamBoost!.copy));
  assert.ok(!/garantiza/i.test(teamBoostCopy("X", 3).replace(/no están garantizadas/, "")));
  // Un sobre sin equipo no inventa la frase.
  assert.equal(packOddsFor(getPack("estandar")!, null, 0).teamBoost, null);
});

test("formato · porcentajes legibles sin decimales engañosos", () => {
  assert.equal(pct(0), "0 %");
  assert.equal(pct(0.004), "<1 %");
  assert.equal(pct(0.37), "37 %");
  assert.equal(pct(1), "100 %");
});
