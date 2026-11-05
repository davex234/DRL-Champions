/** F87 · simulador económico: determinista, distribuciones que suman 1, más precisión ⇒ más valor; perfecto raro a ciegas. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveFormat } from "./format";
import { simulateTiers } from "./economy";
import { proposedRewards, type CatalogLookup } from "./bracketRewards";
import { de8, gsl1 } from "./testing/formatFixtures";

const PRICES: Record<string, number> = { estandar: 2500, premium: 6000, oro: 12000, masters: 20000 };
const cat: CatalogLookup = { packPrice: (id) => PRICES[id] ?? null, cardExists: () => false };

test("doble a 8: distribución válida, determinista y monótona en la precisión", () => {
  const f = de8();
  const d = deriveFormat({ eventId: "e", stages: f.stages, matches: f.matches, adminEdges: f.adminEdges }).descriptor!;
  const cfg = proposedRewards("x");
  const a = simulateTiers(d, cfg, cat, 0.5, { runs: 800, seed: 1 });
  const b = simulateTiers(d, cfg, cat, 0.5, { runs: 800, seed: 1 });
  assert.deepEqual(a, b, "misma semilla, mismo resultado");
  const sum = Object.values(a.dist).reduce((s, x) => s + x, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
  assert.equal(a.dist.NONE, 0, "cuadro completo ⇒ participación válida");
  const c = simulateTiers(d, cfg, cat, 0.8, { runs: 800, seed: 1 });
  assert.ok(c.ev > a.ev, "más precisión, más valor esperado");
  assert.ok(a.perfectRate < 0.01, "a ciegas, el perfecto es rarísimo (≈ 1/2^14)");
});

test("GSL de un grupo: con 5 partidos el perfecto a ciegas es ~1/32", () => {
  const f = gsl1();
  const d = deriveFormat({ eventId: "e", stages: f.stages, matches: f.matches }).descriptor!;
  const r = simulateTiers(d, proposedRewards("x"), cat, 0.5, { runs: 4000, seed: 3 });
  assert.ok(r.perfectRate > 0.015 && r.perfectRate < 0.06, `${r.perfectRate}`);
});
