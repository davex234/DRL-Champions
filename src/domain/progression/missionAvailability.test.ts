import test from "node:test";
import assert from "node:assert/strict";
import { GLOBAL_MARKET_ENABLED } from "@/config/features";
import { EVENTS, WEEKLY_TASKS, eventMissions, weeklyTasks } from "@/data/events";
import { LEGACY_LOCAL_SEASON } from "@/data/seasons";
import { CURRENT_SEASON } from "@/data/season";
import { rollMissions } from "@/battlepass/missions";
import { batchFor } from "./rotation";
import { makeRng } from "@/sim/rng";
import { LIVE_MISSION_FLAGS, MARKET_METRICS, availableMissions, isMissionAvailable, requiresMarketplace } from "./missionAvailability";

const ON = { marketEnabled: true };
const CYCLES = 2000;

test("MARKETPLACE OFF · el interruptor real sigue cerrado y es el que leen las misiones", () => {
  assert.equal(GLOBAL_MARKET_ENABLED, false);
  assert.equal(LIVE_MISSION_FLAGS.marketEnabled, GLOBAL_MARKET_ENABLED);
  assert.deepEqual([...MARKET_METRICS].sort(), ["market_buy", "market_sell"]);
});

test("MARKETPLACE OFF · 0 misiones de comprar o vender en el mercado en miles de ciclos de rotación", () => {
  const pools = [LEGACY_LOCAL_SEASON.missionPool, CURRENT_SEASON.missionPool];
  let rolled = 0;
  for (const pool of pools) {
    for (const kind of ["daily", "weekly"] as const) {
      for (let i = 0; i < CYCLES; i++) {
        for (const m of rollMissions(pool, kind, 3, makeRng(i + 1))) {
          rolled++;
          assert.ok(!requiresMarketplace(m), `ciclo ${i}: ${m.id} pide el Marketplace`);
        }
      }
    }
  }
  // La rotación del servidor (tandas por usuario y ventana) usa la misma puerta.
  for (let i = 0; i < CYCLES; i++) {
    for (const kind of ["daily", "weekly"] as const) {
      for (const m of batchFor(CURRENT_SEASON.missionPool, `user-${i}`, CURRENT_SEASON.id, kind, 1_700_000_000_000 + i * 86_400_000)) {
        rolled++;
        assert.ok(!requiresMarketplace(m), m.id);
      }
    }
  }
  assert.ok(rolled > CYCLES * 10, "se han sorteado misiones de verdad");

  // Eventos y tareas semanales: lo que se OFRECE no pide el Marketplace.
  for (const ev of EVENTS) assert.equal(eventMissions(ev).filter(requiresMarketplace).length, 0, ev.id);
  assert.equal(weeklyTasks().filter(requiresMarketplace).length, 0);
});

test("DEFINICIONES CONSERVADAS · las misiones de Marketplace siguen en los datos, intactas", () => {
  for (const ev of EVENTS) {
    assert.deepEqual(ev.missions.filter(requiresMarketplace).map((m) => m.id), ["buy", "sell"], ev.id);
  }
  assert.deepEqual(WEEKLY_TASKS.filter(requiresMarketplace).map((t) => t.id), ["w_buy"]);
  assert.deepEqual(LEGACY_LOCAL_SEASON.missionPool.filter(requiresMarketplace).map((m) => m.id).sort(), ["d-buy", "w-sell"]);
});

test("MARKETPLACE ON (solo en este test) · las mismas definiciones vuelven a ser elegibles sin reescribirlas", () => {
  for (const ev of EVENTS) {
    assert.deepEqual(eventMissions(ev, ON), ev.missions, ev.id);
    assert.ok(eventMissions(ev, ON).some((m) => m.metric === "market_buy") && eventMissions(ev, ON).some((m) => m.metric === "market_sell"));
  }
  assert.deepEqual(weeklyTasks(ON), WEEKLY_TASKS);
  assert.ok(isMissionAvailable({ metric: "market_buy" }, ON) && isMissionAvailable({ metric: "market_sell" }, ON));
  assert.deepEqual(availableMissions(LEGACY_LOCAL_SEASON.missionPool, ON), LEGACY_LOCAL_SEASON.missionPool);

  // Y el sorteo las vuelve a dar.
  const seen = new Set<string>();
  for (let i = 0; i < CYCLES; i++) {
    for (const kind of ["daily", "weekly"] as const) {
      for (const m of rollMissions(LEGACY_LOCAL_SEASON.missionPool, kind, 3, makeRng(i + 1), ON)) seen.add(m.id);
    }
  }
  assert.ok(seen.has("d-buy") && seen.has("w-sell"), [...seen].join(","));
});

test("SIN MARKETPLACE · las demás misiones no cambian", () => {
  const noMercado = (xs: readonly { metric: string }[]) => xs.filter((m) => !MARKET_METRICS.has(m.metric));
  for (const ev of EVENTS) assert.deepEqual(eventMissions(ev), noMercado(ev.missions), ev.id);
  assert.deepEqual(weeklyTasks(), noMercado(WEEKLY_TASKS));
  // La rotación del servidor no tenía ninguna de mercado: su sorteo es idéntico con o sin la puerta.
  for (let i = 0; i < 200; i++) {
    assert.deepEqual(rollMissions(CURRENT_SEASON.missionPool, "daily", 3, makeRng(i + 1)), rollMissions(CURRENT_SEASON.missionPool, "daily", 3, makeRng(i + 1), ON));
  }
});
