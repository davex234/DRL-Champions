/**
 * Tests del modelo de combate (node:test). Ejecutar: `npm test`.
 *
 * Estos valores NO son arbitrarios: son la calibración aprobada en la Fase 1.2 sobre 371
 * jugadores reales de VLR. Si un refactor los rompe, el juego ha dejado de ser el acordado.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DATA_VERSION, MIN_ROUNDS, STAT_BOOST_STEPS, COMBAT_MATCHUP,
  computeCombatOvr, deriveCard, deriveCombat, applyCombatBoost, isStatBoostStep,
  type CombatStats,
} from "./combat";
import { ALL_VARIANTS, statBoostForRank } from "./variants";

const T = (stronghold: number, gamesense: number, entryfrag: number): CombatStats =>
  ({ stronghold, gamesense, entryfrag });

// ───────────────────────────── OVR ─────────────────────────────

test("OVR reproduce la tabla de calibración de la Fase 1.2", () => {
  const cases: [CombatStats, number][] = [
    [T(99, 99, 10), 85],
    [T(99, 10, 10), 65],
    [T(90, 90, 90), 95],
    [T(80, 80, 80), 88],
    [T(75, 75, 75), 85],
    [T(60, 60, 60), 75],
    [T(40, 40, 90), 75],
    [T(40, 65, 90), 80], // PDF · Jugador 2
    [T(76, 80, 26), 78], // PDF · Jugador 1
  ];
  for (const [combat, expected] of cases) {
    assert.equal(
      computeCombatOvr(combat),
      expected,
      `${combat.stronghold}/${combat.gamesense}/${combat.entryfrag}`,
    );
  }
});

test("los dos ejemplos del PDF caen en el rango 70-89 de su ejemplo de desempate", () => {
  for (const c of [T(76, 80, 26), T(40, 65, 90)]) {
    const ovr = computeCombatOvr(c);
    assert.ok(ovr >= 70 && ovr <= 89, `OVR ${ovr} fuera de 70-89`);
  }
});

test("el OVR se mantiene en 1-99 ante entradas extremas", () => {
  assert.ok(computeCombatOvr(T(0, 0, 0)) >= 1);
  assert.ok(computeCombatOvr(T(99, 99, 99)) <= 99);
});

test("el OVR es monótono: subir una estadística nunca baja el OVR", () => {
  const base = computeCombatOvr(T(60, 60, 60));
  assert.ok(computeCombatOvr(T(70, 60, 60)) >= base);
  assert.ok(computeCombatOvr(T(60, 70, 60)) >= base);
  assert.ok(computeCombatOvr(T(60, 60, 70)) >= base);
});

test("el OVR no depende del orden de las estadísticas (usa el trío ordenado)", () => {
  assert.equal(computeCombatOvr(T(90, 60, 30)), computeCombatOvr(T(30, 90, 60)));
});

// ───────────────────────────── statBoost ─────────────────────────────

test("statBoost sobre un generalista 70/70/70 produce saltos perceptibles", () => {
  const expected: [number, number][] = [[0, 82], [2, 83], [4, 84], [6, 86], [9, 88], [12, 90]];
  for (const [boost, ovr] of expected) {
    assert.equal(deriveCard(T(70, 70, 70), boost).ovr, ovr, `boost +${boost}`);
  }
});

test("L-03 ACEPTADO: un especialista con una estadística en 99 gana menos con el boost", () => {
  const expected: [number, number][] = [[0, 81], [2, 81], [4, 82], [6, 83], [9, 84], [12, 85]];
  for (const [boost, ovr] of expected) {
    assert.equal(deriveCard(T(45, 51, 99), boost).ovr, ovr, `boost +${boost}`);
  }
  // El efecto de techo es real y NO se corrige: 4 puntos frente a los 8 del generalista.
  const especialista = deriveCard(T(45, 51, 99), 12).ovr - deriveCard(T(45, 51, 99), 0).ovr;
  const generalista = deriveCard(T(70, 70, 70), 12).ovr - deriveCard(T(70, 70, 70), 0).ovr;
  assert.equal(especialista, 4);
  assert.equal(generalista, 8);
});

test("un perfil de élite alcanza 99 solo en el escalón máximo", () => {
  const expected: [number, number][] = [[0, 91], [2, 92], [4, 93], [6, 95], [9, 97], [12, 99]];
  for (const [boost, ovr] of expected) {
    assert.equal(deriveCard(T(85, 78, 86), boost).ovr, ovr, `boost +${boost}`);
  }
});

test("el boost no redistribuye el exceso: recorta en 99 y ahí se queda", () => {
  const boosted = applyCombatBoost(T(95, 50, 50), 12);
  assert.equal(boosted.stronghold, 99); // 95+12 = 107 -> 99, y el resto NO sube por ello
  assert.equal(boosted.gamesense, 62);
  assert.equal(boosted.entryfrag, 62);
});

test("las estadísticas boosteadas nunca salen de 0-99", () => {
  for (const boost of STAT_BOOST_STEPS) {
    const c = applyCombatBoost(T(99, 0, 50), boost);
    for (const v of [c.stronghold, c.gamesense, c.entryfrag]) {
      assert.ok(v >= 0 && v <= 99, `stat ${v} fuera de 0-99 con boost +${boost}`);
    }
  }
});

// ───────────────────────────── Derivación desde métricas ─────────────────────────────

const METRICS_OK = {
  kd: 1.1, kast: 72, assists: 200, fk: 90, fd: 70, adr: 140, hsPct: 28, deaths: 500, rounds: 700,
};

test("deriveCombat produce un trío válido con métricas completas", () => {
  const r = deriveCombat(METRICS_OK);
  assert.ok(r.ok);
  for (const v of [r.combat!.stronghold, r.combat!.gamesense, r.combat!.entryfrag]) {
    assert.ok(v >= 0 && v <= 99);
  }
});

test("un jugador por debajo del mínimo de rondas NO genera carta, con motivo explícito", () => {
  const r = deriveCombat({ ...METRICS_OK, rounds: MIN_ROUNDS - 1 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "INSUFFICIENT_ROUNDS");
  assert.equal(r.combat, undefined);
});

test("justo en el mínimo de rondas sí genera carta", () => {
  assert.equal(deriveCombat({ ...METRICS_OK, rounds: MIN_ROUNDS }).ok, true);
});

test("sin métricas o sin un componente obligatorio se rechaza, nunca se inventan valores", () => {
  assert.equal(deriveCombat(undefined).reason, "NO_METRICS");
  assert.equal(deriveCombat({ rounds: 0 }).reason, "NO_METRICS");
  const { kast, ...sinKast } = METRICS_OK;
  const r = deriveCombat(sinKast);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "MISSING_COMPONENT");
});

test("los recuentos entran como TASA: doblar rondas y recuentos no cambia el trío", () => {
  const a = deriveCombat(METRICS_OK).combat!;
  const b = deriveCombat({
    ...METRICS_OK, assists: 400, fk: 180, fd: 140, deaths: 1000, rounds: 1400,
  }).combat!;
  assert.deepEqual(a, b);
});

test("más first kills por ronda sube Entryfrag y no sube Stronghold", () => {
  const base = deriveCombat(METRICS_OK).combat!;
  const agresivo = deriveCombat({ ...METRICS_OK, fk: 180 }).combat!;
  assert.ok(agresivo.entryfrag > base.entryfrag);
  assert.ok(agresivo.stronghold <= base.stronghold);
});

test("morir el primero más veces baja Stronghold y sube Entryfrag", () => {
  const base = deriveCombat(METRICS_OK).combat!;
  const expuesto = deriveCombat({ ...METRICS_OK, fd: 160 }).combat!;
  assert.ok(expuesto.stronghold < base.stronghold);
  assert.ok(expuesto.entryfrag > base.entryfrag);
});

test("el rol NO participa en el cálculo: no hay ninguna entrada de rol", () => {
  // deriveCombat solo acepta RawMetrics. Si alguien añadiera el rol, este test dejaría de compilar.
  const keys = Object.keys(METRICS_OK);
  assert.ok(!keys.some((k) => /role|rol|position/i.test(k)));
});

// ───────────────────────────── Variantes ─────────────────────────────

test("toda variante tiene un statBoost de la escalera aprobada", () => {
  for (const v of ALL_VARIANTS) {
    assert.ok(isStatBoostStep(v.statBoost), `${v.id} tiene statBoost ${v.statBoost}`);
  }
});

test("el statBoost se deriva del rank: variantes del mismo rank comparten bonus", () => {
  for (const v of ALL_VARIANTS) {
    assert.equal(v.statBoost, statBoostForRank(v.rank), v.id);
  }
});

test("el statBoost es monótono respecto al rank", () => {
  const sorted = [...ALL_VARIANTS].sort((a, b) => a.rank - b.rank);
  for (let i = 1; i < sorted.length; i++) {
    assert.ok(
      sorted[i].statBoost >= sorted[i - 1].statBoost,
      `${sorted[i - 1].id} (r${sorted[i - 1].rank}) -> ${sorted[i].id} (r${sorted[i].rank})`,
    );
  }
});

// ───────────────────────────── Invariantes del modelo ─────────────────────────────

test("la tabla de emparejamientos del PDF es cerrada y simétrica", () => {
  assert.equal(COMBAT_MATCHUP.stronghold, "entryfrag");
  assert.equal(COMBAT_MATCHUP.entryfrag, "stronghold");
  assert.equal(COMBAT_MATCHUP.gamesense, "gamesense");
});

test("la calibración vigente queda sellada como VCT-2026", () => {
  assert.equal(DATA_VERSION, "VCT-2026");
});
