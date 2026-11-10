/**
 * FASE 41 · SIMULADOR: determinismo, equivalencia de odds con `openPack`, y que las reglas de la Fase 41 cierran las
 * fuentes sin tope que la línea base tenía.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CardRegistry } from "@/collection/registry";
import { getPack } from "@/data/packs";
import { openPack } from "@/domain/packs/openPack";
import { freshPity } from "@/domain/packs/pity";
import { BUCKETS } from "@/domain/packs/pool";
import { makeRng } from "@/sim/rng";
import { Simulator, buildSimCatalog, drawPackIndices, METRICS, HORIZONS, SOURCES, percentilesOf, seedOf, accountLevelOf } from "./simulator";
import { dailyRecurringCeiling } from "./catalog";
import { STARTER_POLICY } from "./starter";
import { totalXpForLevel } from "@/domain/progression/levels";

const REG = new CardRegistry();
const CAT = buildSimCatalog(REG);
const SIM = new Simulator(CAT);
const M = (id: (typeof METRICS)[number]) => METRICS.indexOf(id);
const LAST = HORIZONS.length - 1;

function bucketFreq(pack: string, n: number, useEngine: boolean): number[] {
  const f = [0, 0, 0, 0, 0]; let total = 0;
  const p = getPack(pack)!;
  for (let s = 1; s <= n; s++) {
    if (useEngine) {
      for (const d of openPack(REG, p, { seed: s * 7919, owned: new Set(), pity: freshPity() }).decisions) { f[BUCKETS.indexOf(d.bucket)]++; total++; }
    } else {
      const out: number[] = []; drawPackIndices(CAT, pack, makeRng(s * 104729), out);
      for (const ci of out) { f[CAT.bucketOf[ci]]++; total++; }
    }
  }
  return f.map((x) => x / total);
}

for (const pack of ["inicial", "estandar", "premium"]) {
  test(`odds del simulador ≡ openPack (${pack}, 6.000 sobres, |Δ| por bucket < 1,2 pp)`, () => {
    const a = bucketFreq(pack, 6000, true); const b = bucketFreq(pack, 6000, false);
    for (let i = 0; i < 5; i++) assert.ok(Math.abs(a[i] - b[i]) < 0.012, `${pack} bucket ${i}: ${a[i]} vs ${b[i]}`);
  });
}

test("determinista: misma semilla ⇒ misma trayectoria", () => {
  const a = SIM.run("REGULAR", "fase41", 12345, 0, 30); const sa = Array.from(a.snapshots[2]);
  const b = SIM.run("REGULAR", "fase41", 12345, 0, 30); const sb = Array.from(b.snapshots[2]);
  assert.deepEqual(sa, sb);
});

test("semillas distintas por arquetipo, índice y reglas", () => {
  assert.notEqual(seedOf(0, 1, "fase41"), seedOf(1, 1, "fase41"));
  assert.notEqual(seedOf(0, 1, "fase41"), seedOf(0, 2, "fase41"));
  assert.notEqual(seedOf(0, 1, "fase41"), seedOf(0, 1, "baseline"));
});

test("fase41: 100 % con plantilla posible el día 1 y Sobres Iniciales gratis ≤ tope (400 cuentas × 4 arquetipos)", () => {
  for (const arch of ["CASUAL", "REGULAR", "ENGAGED", "HARDCORE"] as const) {
    for (let i = 0; i < 100; i++) {
      const r = SIM.run(arch, "fase41", seedOf(0, i, "fase41"), i % 4 === 0 ? 0 : 42, 7);
      assert.equal(r.snapshots[0][M("deckReadyDay")], 1);
      assert.ok(r.snapshots[1][M("freeStarterPacks")] <= STARTER_POLICY.maxFreeClaims);
    }
  }
});

test("baseline: el HARDCORE que explota el Sobre Inicial gratis supera el techo recurrente (misiones re-reclamadas)", () => {
  const r = SIM.run("HARDCORE", "baseline", 77, 0, 30);
  assert.ok(r.maxRecurringDay > dailyRecurringCeiling(), `${r.maxRecurringDay}`);
  assert.ok(r.snapshots[2][M("freeStarterPacks")] > 100);
});

test("fase41: el HARDCORE queda por debajo del techo recurrente todos los días (40 trayectorias × 180 días)", () => {
  for (let i = 0; i < 40; i++) {
    const r = SIM.run("HARDCORE", "fase41", seedOf(3, i, "fase41"), 0, 180);
    assert.ok(r.maxRecurringDay <= dailyRecurringCeiling(), `${r.maxRecurringDay}`);
  }
});

test("fase41 gana menos que baseline con la misma semilla (REGULAR 30 días): la re-reclamación desaparece", () => {
  let base = 0; let now = 0;
  for (let i = 0; i < 40; i++) {
    base += SIM.run("REGULAR", "baseline", 1000 + i, 0, 30).sources[2][SOURCES.indexOf("mission_daily")];
    now += SIM.run("REGULAR", "fase41", 1000 + i, 0, 30).sources[2][SOURCES.indexOf("mission_daily")];
  }
  assert.ok(now < base, `${now} vs ${base}`);
});

test("contabilidad: créditos = ganado − gastado en cada horizonte", () => {
  const r = SIM.run("ENGAGED", "fase41", 999, 13, 180);
  for (let h = 0; h <= LAST; h++) {
    const s = r.snapshots[h];
    assert.ok(Math.abs(s[M("credits")] - (s[M("earned")] - s[M("spent")])) < 1e-6, `h${h}`);
    assert.ok(s[M("credits")] >= 0);
  }
});

test("colección: distintas ≤ catálogo, duplicadas ≥ 0, % coherente", () => {
  const r = SIM.run("HARDCORE", "fase41", 4242, 0, 90);
  const s = r.snapshots[3];
  assert.ok(s[M("distinct")] <= CAT.n && s[M("duplicates")] >= 0);
  assert.ok(Math.abs(s[M("collectionPct")] - (100 * s[M("distinct")]) / CAT.n) < 1e-6);
});

test("pase: nivel ≤ 30 y el que entra en las 2 últimas semanas progresa menos que el del día 1", () => {
  let early = 0; let late = 0;
  for (let i = 0; i < 30; i++) {
    early += SIM.run("CASUAL", "fase41", 500 + i, 0, 90).snapshots[3][M("passLevel")];
    late += SIM.run("CASUAL", "fase41", 500 + i, 70, 90).snapshots[3][M("passLevel")];
  }
  assert.ok(late < early);
  assert.ok(early / 30 <= 30);
});

test("nivel de cuenta = inversa de totalXpForLevel", () => {
  for (const L of [1, 2, 5, 10, 30]) {
    assert.equal(accountLevelOf(totalXpForLevel(L)), L);
    if (L > 1) assert.equal(accountLevelOf(totalXpForLevel(L) - 1), L - 1);
  }
});

test("percentiles P10…P99 ordenados", () => {
  const v = Float64Array.from({ length: 1000 }, (_, i) => i);
  const p = percentilesOf(v);
  assert.ok(p.P10 <= p.P25 && p.P25 <= p.P50 && p.P50 <= p.P75 && p.P75 <= p.P90 && p.P90 <= p.P95 && p.P95 <= p.P99);
  assert.equal(p.P50, 500);
});
