/**
 * FASE 63 · EL STARTER REAL PERMITE FORMAR EQUIPO (spec 24) — con el motor real, el catálogo real (331 cartas) y la
 * configuración de pools REAL de la BD (foto F58.1, la misma que usa `goldPool.test.ts`).
 *
 * Si esto fallara, la guía llevaría a un callejón sin salida: el arreglo NO sería dar cartas falsas, sino revisar el
 * starter (y documentarlo). Hoy pasa: con los 4 sobres de bienvenida la mayoría forma equipo y el resto lo consigue con
 * Sobres Iniciales gratis asistidos (F41), siempre dentro del tope de 8.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { STARTER_POLICY } from "@/domain/economy/starter";
import { TOTAL_CARDS } from "@/data/catalog";
import { DUEL_ROLES } from "@/domain/cardgame";
import { dbDistribution, simulateStarter, starterStats, STARTER_GRANT } from "./starterMath";

test("F63 M01 · el alta real concede 3 Iniciales + 1 Bronce (estandar) y 6.000 créditos; ambos sobres existen y se abren", () => {
  const alta = readFileSync(join(process.cwd(), "supabase/migrations/0011_server_authority.sql"), "utf8");
  assert.match(alta, /\(new\.id, 'inicial', 3\), \(new\.id, 'estandar', 1\)/);
  assert.match(alta, /values \(new\.id, 6000, 'starter_grant'/);
  assert.deepEqual(STARTER_GRANT.packs.map((p) => p.packId), ["inicial", "estandar"]);
  assert.equal(TOTAL_CARDS, 331, "catálogo intacto");
});

for (const order of ["guide", "inicial-first"] as const) {
  for (const src of ["código", "BD (F58.1)"] as const) {
    test(`F63 M02 · ${order} · pools ${src}: 100 % forma equipo LEGAL dentro del tope de Sobres Iniciales gratis`, () => {
      const dist = src === "código" ? undefined : dbDistribution();
      const s = starterStats(1500, order, dist);
      assert.equal(s.readyRate, 1, JSON.stringify(s));
      assert.equal(s.validRate, 1, "autocomplete + validador canónico: 10 cartas, 2 por rol, sin repetir jugador");
      assert.ok(s.freeExtra.max <= STARTER_POLICY.maxFreeClaims, JSON.stringify(s.freeExtra));
      assert.ok(s.readyWithWelcomeOnly >= (order === "guide" ? 0.99 : 0.9), `con solo los 4 sobres de bienvenida: ${s.readyWithWelcomeOnly}`);
    });
  }
}

test("F63 M03 · el equipo resultante: 2 por rol de CARTA y 10 jugadores distintos (semillas fijas)", () => {
  for (let i = 0; i < 50; i++) {
    const r = simulateStarter(9_001 + i, "guide");
    assert.ok(r.ready && r.deckValid, `semilla ${i}`);
    assert.equal(r.deckUniquePlayers, 10);
    for (const role of DUEL_ROLES) assert.equal(r.deckRoleCounts[role], 2, `${role} semilla ${i}`);
  }
});
