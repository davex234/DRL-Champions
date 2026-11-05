/**
 * F84 · RANKED 2.0 — dominio puro: fronteras versionadas, derivación de rango, colocación, mejor rango, movimientos tras
 * una partida (colocación / rango obtenido / ascenso / descenso / misma división), elegibilidad del Top, validación de la
 * configuración y el espejo de la fórmula (sin cambios) con las colocaciones 5-0 … 0-5 del informe.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  RANK_V1, RANK_CONFIGS, CURRENT_RANK_CONFIG_VERSION, deriveRank, rankLadder, validateRankConfig, rankConfigFingerprint, rankChip, type RankConfig,
} from "./config";
import { competitiveStanding, rankMovement, rankMovementLabel, topEligibility, standingLabel, SEASON_1_DEFAULTS } from "./standing";
import { INITIAL_RATING, K_PROVISIONAL, K_ESTABLISHED, PLACEMENT_GAMES, MIN_RATING, MAX_RATING, kFactorFor } from "@/domain/cardgame/rating";

const S1 = { placementGames: 5, rankConfigVersion: "rank-v1" };
const DAY = 86_400_000;

/* ═══════════════════ identidad y versionado ═══════════════════ */

test("R1 · rank-v1 es válida y está CONGELADA (cambiar una frontera exige una versión nueva)", () => {
  assert.deepEqual(validateRankConfig(RANK_V1), []);
  assert.equal(CURRENT_RANK_CONFIG_VERSION, "rank-v1");
  assert.equal(rankConfigFingerprint(RANK_V1), "rank-v1|30|cantera:0:3|promesa:860:3|titular:950:3|veterano:1040:3|capitan:1130:3|estrella:1220:3|cumbre:1310:-");
  assert.deepEqual(Object.keys(RANK_CONFIGS), ["rank-v1"]);
});

test("R2 · identidad propia: 6 tiers con divisiones + élite; ningún nombre de otros juegos ni de los sobres", () => {
  const names = RANK_V1.tiers.map((t) => t.name);
  assert.deepEqual(names, ["Cantera", "Promesa", "Titular", "Veterano", "Capitán", "Estrella", "Cumbre"]);
  const banned = /^(iron|bronze|silver|gold|platinum|diamond|ascendant|immortal|radiant|hierro|bronce|plata|oro|platino|diamante|ascendente|inmortal|radiante|masters|champions|icon|leyenda|legend|titan)$/i;
  for (const n of names) assert.ok(!banned.test(n), n);
  assert.equal(RANK_V1.tiers.filter((t) => t.divisions === 3).length, 6);
  assert.equal(RANK_V1.tiers[RANK_V1.tiers.length - 1].divisions, null, "la élite no tiene divisiones");
  assert.equal(new Set(RANK_V1.tiers.map((t) => t.shape)).size, 7, "cada tier tiene una FORMA propia (no solo color)");
  assert.equal(new Set(RANK_V1.tiers.map((t) => t.color)).size, 7);
});

test("R3 · validación: suelos desordenados, huecos, solapes, élite con divisiones y suelo inicial ≠ 0 se rechazan", () => {
  const base = RANK_V1;
  const mut = (f: (c: RankConfig) => RankConfig) => validateRankConfig(f(JSON.parse(JSON.stringify(base))));
  assert.ok(mut((c) => ({ ...c, tiers: c.tiers.map((t, i) => (i === 2 ? { ...t, floor: 800 } : t)) })).length > 0, "desordenado");
  assert.ok(mut((c) => ({ ...c, tiers: c.tiers.map((t, i) => (i === 3 ? { ...t, floor: 1045 } : t)) })).length > 0, "hueco");
  assert.ok(mut((c) => ({ ...c, tiers: c.tiers.map((t, i) => (i === 3 ? { ...t, floor: 1035 } : t)) })).length > 0, "solape");
  assert.ok(mut((c) => ({ ...c, tiers: c.tiers.map((t, i) => (i === c.tiers.length - 1 ? { ...t, divisions: 3 as const } : t)) })).length > 0, "élite con divisiones");
  assert.ok(mut((c) => ({ ...c, tiers: c.tiers.map((t, i) => (i === 0 ? { ...t, floor: 100 } : t)) })).length > 0, "primer suelo ≠ 0");
  assert.ok(mut((c) => ({ ...c, tiers: [...c.tiers, c.tiers[1]] })).length > 0, "id repetido");
  assert.ok(mut((c) => ({ ...c, version: " " })).length > 0, "versión vacía");
});

/* ═══════════════════ derivación y fronteras ═══════════════════ */

test("R4 · fronteras exactas (incluido el suelo, excluido el techo): III → II → I y la Cumbre", () => {
  const L = (r: number) => deriveRank(r).label;
  const cases: [number, string][] = [
    [0, "Cantera III"], [799, "Cantera III"], [800, "Cantera II"], [829, "Cantera II"], [830, "Cantera I"], [859, "Cantera I"],
    [860, "Promesa III"], [890, "Promesa II"], [920, "Promesa I"], [949, "Promesa I"],
    [950, "Titular III"], [980, "Titular II"], [1000, "Titular II"], [1009, "Titular II"], [1010, "Titular I"], [1039, "Titular I"],
    [1040, "Veterano III"], [1070, "Veterano II"], [1100, "Veterano I"], [1130, "Capitán III"], [1190, "Capitán I"],
    [1219, "Capitán I"], [1220, "Estrella III"], [1309, "Estrella I"], [1310, "Cumbre"], [5000, "Cumbre"],
  ];
  for (const [r, l] of cases) assert.equal(L(r), l, `${r}`);
  assert.equal(L(-50), "Cantera III", "nunca por debajo de 0");
  assert.equal(L(Number.NaN), "Cantera III");
  assert.equal(deriveRank(INITIAL_RATING).label, "Titular II", "el rating inicial cae en el centro: el jugador medio es titular");
});

test("R5 · progreso dentro de la división y puntos para la siguiente; la Cumbre no promete techo", () => {
  const r = deriveRank(1001);
  assert.equal(r.floor, 980); assert.equal(r.ceil, 1010); assert.equal(r.pointsToNext, 9); assert.equal(r.nextLabel, "Titular I");
  assert.ok(Math.abs((r.progress ?? 0) - 21 / 30) < 1e-9);
  const top = deriveRank(1500);
  assert.equal(top.ceil, null); assert.equal(top.progress, null); assert.equal(top.pointsToNext, null); assert.equal(top.nextLabel, null);
  const low = deriveRank(300);
  assert.equal(low.floor, 0); assert.equal(low.ceil, 800); assert.equal(low.nextLabel, "Cantera II");
  assert.equal(rankLadder().length, 19, "6 × 3 divisiones + Cumbre");
  const lad = rankLadder();
  for (let i = 1; i < lad.length; i++) assert.equal(lad[i - 1].ceil, lad[i].floor, "sin huecos ni solapes entre escalones");
});

test("R6 · el rango se DERIVA (determinista): mismo rating, misma versión → mismo rango; el chip no lleva la versión", () => {
  for (const r of [0, 777, 999, 1000, 1234, 1311]) assert.deepEqual(deriveRank(r), deriveRank(r));
  const chip = rankChip(deriveRank(1100));
  assert.deepEqual(Object.keys(chip).sort(), ["color", "division", "label", "shape", "step", "tierId", "tierName"]);
});

/* ═══════════════════ colocación, rango, mejor rango ═══════════════════ */

const rec = (matches: number, over: Partial<{ wins: number; peakRankedRating: number | null; placementCompletedAt: number | null; peakRating: number }> = {}) => ({
  matches, wins: over.wins ?? Math.ceil(matches / 2), losses: matches - (over.wins ?? Math.ceil(matches / 2)), draws: 0, seedRating: 1000,
  placementCompletedAt: over.placementCompletedAt ?? (matches >= 5 ? 1 : null), peakRating: over.peakRating ?? 1050,
  peakRankedRating: over.peakRankedRating === undefined ? (matches >= 5 ? 1050 : null) : over.peakRankedRating, lastMatchAt: 1,
});

test("P1 · sin temporada o 0 partidas → SIN CLASIFICAR; 1..4 → COLOCACIÓN X / 5 sin rango; 5 → CLASIFICADO con rango", () => {
  assert.equal(competitiveStanding({ rating: 1100, season: null, record: null }).state, "UNRANKED");
  const u = competitiveStanding({ rating: 1100, season: S1, record: null });
  assert.equal(u.state, "UNRANKED"); assert.equal(u.rank, null); assert.deepEqual(u.placement, { played: 0, total: 5, remaining: 5 });
  const p = competitiveStanding({ rating: 1100, season: S1, record: rec(4) });
  assert.equal(p.state, "PLACEMENT"); assert.equal(p.rank, null, "el rango NO se enseña en colocación"); assert.equal(p.placement.played, 4);
  assert.equal(standingLabel(p), "Colocación 4/5");
  const r = competitiveStanding({ rating: 1100, season: S1, record: rec(5) });
  assert.equal(r.state, "RANKED"); assert.equal(r.rank?.label, "Veterano I"); assert.equal(standingLabel(r), "Veterano I");
});

test("P2 · jugador EXISTENTE: su rating histórico es la semilla (sin reinicio a 1000); la colocación solo REVELA el rango", () => {
  // 1089 con 29 partidas de por vida y 0 de temporada: rating intacto, sin rango hasta 5 partidas de temporada.
  const before = competitiveStanding({ rating: 1089, season: S1, record: null });
  assert.equal(before.rating, 1089); assert.equal(before.state, "UNRANKED"); assert.equal(before.rank, null);
  const after = competitiveStanding({ rating: 1101, season: S1, record: rec(5) });
  assert.equal(after.rank?.label, "Veterano I", "rango = el de su rating real tras la colocación, no uno reconstruido");
});

test("P3 · mejor rango de la temporada = pico DESDE la colocación (guardado por la liquidación), no el rating actual", () => {
  const s = competitiveStanding({ rating: 1005, season: S1, record: rec(12, { peakRankedRating: 1131 }) });
  assert.equal(s.rank?.label, "Titular II");
  assert.equal(s.peakRank?.label, "Capitán III", "bajó después: el mejor rango no se reconstruye con el actual");
  assert.equal(competitiveStanding({ rating: 1005, season: S1, record: rec(3) }).peakRank, null, "sin pico antes de la colocación");
});

test("P4 · récord de temporada con % sobre decididas; nunca NaN", () => {
  const s = competitiveStanding({ rating: 1000, season: S1, record: rec(10, { wins: 6 }) });
  assert.deepEqual(s.record, { matches: 10, wins: 6, losses: 4, draws: 0, winrate: 60 });
  assert.equal(competitiveStanding({ rating: 1000, season: S1, record: null }).record.winrate, null);
});

/* ═══════════════════ movimiento tras una partida (desde el asiento) ═══════════════════ */

test("M1 · colocación: 1..4 → PLACEMENT_PROGRESS sin rango; la 5.ª → PLACEMENT_COMPLETE con el rango revelado", () => {
  const m3 = rankMovement({ oldRating: 1000, newRating: 1020, seasonMatchNumber: 3 }, S1);
  assert.equal(m3.kind, "PLACEMENT_PROGRESS"); assert.equal(m3.after, null); assert.deepEqual(m3.placement, { played: 3, total: 5 });
  assert.equal(rankMovementLabel(m3), "Colocación 3 / 5 · +20");
  const m5 = rankMovement({ oldRating: 1060, newRating: 1080, seasonMatchNumber: 5 }, S1);
  assert.equal(m5.kind, "PLACEMENT_COMPLETE"); assert.equal(m5.after?.label, "Veterano II"); assert.equal(rankMovementLabel(m5), "Rango obtenido: Veterano II");
});

test("M2 · ascenso de división, ascenso de TIER (ceremonia grande), descenso y misma división", () => {
  const div = rankMovement({ oldRating: 1005, newRating: 1017, seasonMatchNumber: 8 }, S1);
  assert.equal(div.kind, "PROMOTION"); assert.equal(div.steps, 1); assert.equal(div.tierChange, false); assert.equal(div.after?.label, "Titular I");
  const tier = rankMovement({ oldRating: 1030, newRating: 1052, seasonMatchNumber: 8 }, S1);
  assert.equal(tier.kind, "PROMOTION"); assert.equal(tier.tierChange, true); assert.equal(rankMovementLabel(tier), "Ascenso a Veterano III");
  const down = rankMovement({ oldRating: 952, newRating: 940, seasonMatchNumber: 9 }, S1);
  assert.equal(down.kind, "DEMOTION"); assert.equal(down.steps, -1); assert.equal(down.after?.label, "Promesa I"); assert.equal(rankMovementLabel(down), "Descenso a Promesa I");
  const same = rankMovement({ oldRating: 1001, newRating: 1009, seasonMatchNumber: 9 }, S1);
  assert.equal(same.kind, "SAME"); assert.equal(rankMovementLabel(same), "Titular II · +8");
});

test("M3 · sin temporada en el asiento (anterior a F84 o entre temporadas) → solo rating; tope de pareja se dice", () => {
  assert.equal(rankMovement({ oldRating: 1000, newRating: 1020, seasonMatchNumber: null }, null).kind, "UNSEASONED");
  assert.equal(rankMovement({ oldRating: 1000, newRating: 1020, seasonMatchNumber: null }, S1).kind, "UNSEASONED");
  const cap = rankMovement({ oldRating: 1100, newRating: 1100, seasonMatchNumber: 12, rule: "PAIR_CAP" }, S1);
  assert.equal(cap.pairCapped, true); assert.equal(cap.kind, "SAME"); assert.equal(cap.delta, 0);
});

test("M4 · F5 / dos pestañas: el mismo asiento produce EXACTAMENTE el mismo movimiento", () => {
  const ev = { oldRating: 1211, newRating: 1229, seasonMatchNumber: 9, rule: "STANDARD" };
  assert.deepEqual(rankMovement(ev, S1), rankMovement({ ...ev }, { ...S1 }));
});

/* ═══════════════════ Top 500: elegibilidad ═══════════════════ */

test("T1 · elegibilidad (espejo de la vista): colocación + mínimo de partidas + actividad; dice qué falta", () => {
  const rules = SEASON_1_DEFAULTS.top;
  const now = 100 * DAY;
  const ranked = competitiveStanding({ rating: 1100, season: S1, record: rec(7) });
  assert.deepEqual(topEligibility(ranked, now - DAY, rules, now), { eligible: true, missing: [] });
  const stale = topEligibility(ranked, now - 20 * DAY, rules, now);
  assert.equal(stale.eligible, false); assert.match(stale.missing.join(" "), /últimos 14 días/);
  const placing = topEligibility(competitiveStanding({ rating: 1100, season: S1, record: rec(2) }), now, rules, now);
  assert.equal(placing.eligible, false); assert.match(placing.missing.join(" "), /colocación/); assert.match(placing.missing.join(" "), /Juega 3 partidas/);
  assert.equal(rules.size, 500);
});

/* ═══════════════════ fórmula intacta y colocaciones simuladas ═══════════════════ */

test("F1 · la fórmula NO cambia en F84: inicial 1000, K 40 (< 10 partidas) / 24, suelo 0, techo 5000", () => {
  assert.deepEqual([INITIAL_RATING, K_PROVISIONAL, K_ESTABLISHED, PLACEMENT_GAMES, MIN_RATING, MAX_RATING], [1000, 40, 24, 10, 0, 5000]);
  assert.equal(kFactorFor(9), 40); assert.equal(kFactorFor(10), 24);
});

/** Espejo de la liquidación (rival al mismo rating): ±K/2 por partida. */
function placementRun(seed: number, games: number, wins: number): number {
  let r = seed, g = games;
  for (let i = 0; i < 5; i++) {
    const k = kFactorFor(g);
    r += Math.round(k * ((i < wins ? 1 : 0) - 0.5));
    g++;
  }
  return r;
}

test("F2 · colocaciones 5-0 … 0-5 sin saltos absurdos: nuevo ±100 como mucho, veterano ±60", () => {
  const fresh = [5, 4, 3, 2, 1, 0].map((w) => placementRun(1000, 0, w));
  assert.deepEqual(fresh, [1100, 1060, 1020, 980, 940, 900]);
  assert.deepEqual(fresh.map((r) => deriveRank(r).label), ["Veterano I", "Veterano III", "Titular I", "Titular II", "Promesa I", "Promesa II"]);
  const vet = [5, 0].map((w) => placementRun(1089, 29, w));
  assert.deepEqual(vet, [1149, 1029]);
  for (const r of [...fresh, ...vet]) assert.ok(deriveRank(r).tierId !== "cumbre", "ninguna colocación lleva a la élite");
});
