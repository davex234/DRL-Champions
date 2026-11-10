/**
 * F87 · CUADRO DE PREDICCIÓN — propagación de ganador y perdedor, invalidación SOLO de descendientes
 * (propiedad con miles de cambios aleatorios), separación real ⇄ predicho, puntuación con VOID,
 * perfecto, escalones y clasificación con empates.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveFormat, descendantsOf, type RealMatchRow } from "./format";
import {
  checkPick, fillBracket, invalidatedBy, pendingPicks, phaseOf, predictedParticipants, rankRows, realStateOf, scoreEntry,
  type Picks, type PredictionContext,
} from "./prediction";
import { de8, finish, gsl1, place, se8, T } from "./testing/formatFixtures";
import { liabilityOf, proposedRewards, tierFor, validateRewards, type CatalogLookup } from "./bracketRewards";

function ctxOf(matches: RealMatchRow[], f = de8(), voided?: Set<string>): PredictionContext {
  const r = deriveFormat({ eventId: "evt-test", stages: f.stages, matches, adminEdges: f.adminEdges });
  return { descriptor: r.descriptor!, real: realStateOf(matches), voided };
}
function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const open = () => true;

test("propagación del ganador: elegir en cuartos coloca al equipo en SU semifinal predicha", () => {
  const ctx = ctxOf(de8().matches);
  const before = predictedParticipants(ctx, {}).get("de-usf1")!;
  assert.deepEqual(before, [null, null]);
  const picks = { "de-uqf1": T(8), "de-uqf2": T(4) };
  const p = predictedParticipants(ctx, picks);
  assert.deepEqual(p.get("de-usf1")!.map((t) => t?.id), [T(8), T(4)]);
  // El estado REAL no cambia: el partido real sigue «por definir».
  assert.equal(ctx.real.get("de-usf1")!.teamA, null);
});

test("propagación del perdedor (doble): el perdedor predicho cae a su partido del cuadro bajo", () => {
  const ctx = ctxOf(de8().matches);
  const p = predictedParticipants(ctx, { "de-uqf1": T(1), "de-uqf2": T(5) });
  assert.deepEqual(p.get("de-lr1a")!.map((t) => t?.id), [T(8), T(4)]);
});

test("validación de pick: solo uno de los dos participantes predichos; nunca un equipo arbitrario", () => {
  const ctx = ctxOf(de8().matches);
  assert.deepEqual(checkPick(ctx, {}, "de-uqf1", T(1)), { ok: true });
  assert.deepEqual(checkPick(ctx, {}, "de-uqf1", T(5)), { ok: false, code: "TEAM_NOT_IN_MATCH" });
  assert.deepEqual(checkPick(ctx, {}, "de-usf1", T(1)), { ok: false, code: "PARTICIPANTS_UNKNOWN" });
  assert.deepEqual(checkPick(ctx, {}, "no-existe", T(1)), { ok: false, code: "UNKNOWN_MATCH" });
  assert.deepEqual(checkPick(ctx, { "de-uqf1": T(1), "de-uqf2": T(4) }, "de-usf1", T(8)), { ok: false, code: "TEAM_NOT_IN_MATCH" }, "T8 perdió en MI predicción");
  assert.deepEqual(checkPick({ ...ctx, voided: new Set(["de-uqf1"]) }, {}, "de-uqf1", T(1)), { ok: false, code: "VOID" });
});

test("cambiar un pick de cuartos invalida SOLO lo que dependía de él", () => {
  const ctx = ctxOf(de8().matches);
  const picks = fillBracket(ctx, (_id, pair) => pair[0].id); // siempre gana el hueco 1
  const champion = picks["de-gf"];
  assert.equal(champion, T(1));
  const { next, cleared } = invalidatedBy(ctx, picks, "de-uqf1", T(8), open);
  assert.ok(cleared.length > 0);
  for (const id of cleared) assert.ok(descendantsOf(ctx.descriptor, "de-uqf1").has(id), `${id} es descendiente`);
  assert.equal(next["de-uqf3"], picks["de-uqf3"], "rama independiente intacta");
  assert.equal(next["de-usf2"], picks["de-usf2"], "rama independiente intacta");
  assert.ok(!next["de-gf"], "T1 ya no puede ser campeón en esta predicción");
  // No queda ningún pick incompatible.
  const p = predictedParticipants(ctx, next);
  for (const [id, team] of Object.entries(next)) assert.ok(p.get(id)!.some((t) => t?.id === team), `${id} coherente`);
});

test("PROPIEDAD · 3.000 cambios aleatorios: solo descendientes, nunca independientes, nunca incoherencias", () => {
  for (const make of [de8, gsl1, se8]) {
    const f = make();
    const ctx = ctxOf(f.matches, f);
    for (let s = 0; s < 1000; s++) {
      const r = rng(77 + s);
      const picks = fillBracket(ctx, (_id, pair) => (r() < 0.5 ? pair[0].id : pair[1].id));
      const ids = Object.keys(picks);
      const target = ids[Math.floor(r() * ids.length)];
      const pair = predictedParticipants(ctx, picks).get(target)!;
      const choice = r() < 0.15 ? null : (pair[0]!.id === picks[target] ? pair[1]!.id : pair[0]!.id);
      const { next, cleared } = invalidatedBy(ctx, picks, target, choice, open);
      const desc = descendantsOf(ctx.descriptor, target);
      for (const id of ids) if (id !== target && !desc.has(id)) assert.equal(next[id], picks[id], `${make.name}: ${id} independiente cambió`);
      for (const id of cleared) assert.ok(desc.has(id));
      const p = predictedParticipants(ctx, next);
      for (const [id, team] of Object.entries(next)) assert.ok(p.get(id)!.some((t) => t?.id === team), `${make.name}: ${id} incoherente tras cambiar ${target}`);
    }
  }
});

test("un descendiente CERRADO no se borra al cambiar aguas arriba (se queda como pick muerto)", () => {
  const ctx = ctxOf(de8().matches);
  const picks = fillBracket(ctx, (_id, pair) => pair[0].id);
  const { next, cleared } = invalidatedBy(ctx, picks, "de-uqf1", T(8), (id) => id !== "de-usf1");
  assert.ok(!cleared.includes("de-usf1"));
  assert.equal(next["de-usf1"], picks["de-usf1"]);
});

test("el cuadro se cura con la realidad: un resultado real sustituye al pick fallado aguas abajo; el pick fallado se conserva", () => {
  let ms = de8().matches;
  const ctx0 = ctxOf(ms);
  const picks = fillBracket(ctx0, (_id, pair) => pair[0].id); // predice T1 gana uqf1
  ms = finish(ms, "de-uqf1", "b"); // pero gana T8 de verdad
  const ctx = ctxOf(ms);
  const p = predictedParticipants(ctx, picks);
  assert.equal(p.get("de-usf1")![0]!.id, T(8), "en la semifinal ya está el real");
  assert.equal(picks["de-uqf1"], T(1), "el pick original no se toca");
  const s = scoreEntry(ctx, picks, () => true);
  assert.equal(s.matches.find((m) => m.matchId === "de-uqf1")!.outcome, "WRONG");
  // Su pick de semifinal (T1) ya no puede acertar: muerto, pendiente hasta el resultado.
  const sf = s.matches.find((m) => m.matchId === "de-usf1")!;
  assert.equal(sf.dead, true);
  assert.equal(sf.outcome, "PENDING");
});

test("puntuación: aciertos por ronda, VOID fuera del máximo, sin pick cerrado = fallo", () => {
  let ms = de8().matches;
  ms = finish(ms, "de-uqf1", "a"); ms = finish(ms, "de-uqf2", "a");
  const picks: Picks = { "de-uqf1": T(1), "de-uqf2": T(5) };
  const ctx = ctxOf(ms);
  const s = scoreEntry(ctx, picks, (id) => id.startsWith("de-uqf"));
  assert.equal(s.points, 1);
  assert.equal(s.correct, 1);
  assert.equal(s.wrong, 1);
  assert.equal(s.missed, 2, "uqf3 y uqf4 cerrados sin pick");
  assert.equal(s.maxPoints, 27);
  const v = scoreEntry({ ...ctx, voided: new Set(["de-uqf2"]) }, picks, () => false);
  assert.equal(v.maxPoints, 26);
  assert.equal(v.voided, 1);
  assert.equal(v.wrong, 0);
});

/** Juega la realidad igual que los picks (en orden topológico): coloca a los predichos y gana el elegido. */
function realize(f: ReturnType<typeof gsl1>, picks: Picks): RealMatchRow[] {
  let ms = f.matches;
  const order = deriveFormat({ eventId: "evt-test", stages: f.stages, matches: ms, adminEdges: f.adminEdges }).descriptor!.nodes.map((n) => n.matchId);
  for (let guard = 0; guard < order.length; guard++) {
    for (const id of order) {
      const row = ms.find((m) => m.id === id)!;
      if (row.status === "finished") continue;
      const pair = predictedParticipants(ctxOf(ms, f), picks).get(id)!;
      if (!pair[0] || !pair[1]) continue;
      ms = place(ms, id, pair[0].id, pair[1].id);
      ms = finish(ms, id, picks[id] === pair[0].id ? "a" : "b");
    }
  }
  return ms;
}

test("perfecto: todo acertado; un VOID no lo rompe; un hueco sin pick sí; un fallo sí", () => {
  for (const make of [gsl1, de8, se8]) {
    const f = make();
    const picks = fillBracket(ctxOf(f.matches, f), (_id, pair) => pair[1].id);
    const final = ctxOf(realize(f, picks), f);
    const s = scoreEntry(final, picks, () => true);
    assert.equal(s.decided, true, make.name);
    assert.equal(s.correct, final.descriptor.nodes.length, make.name);
    assert.equal(s.perfect, true, make.name);
    assert.equal(s.ratio, 1, make.name);
    const anyId = final.descriptor.nodes[0].matchId;
    assert.equal(scoreEntry({ ...final, voided: new Set([anyId]) }, picks, () => true).perfect, true, `${make.name}: VOID no rompe`);
    const missing: Record<string, string> = { ...picks }; delete missing[anyId];
    assert.equal(scoreEntry(final, missing, () => true).perfect, false, `${make.name}: sin pick obligatorio no hay perfecto`);
    const other = final.descriptor.nodes[0];
    const pair = predictedParticipants(final, picks).get(other.matchId)!;
    const wrong = { ...picks, [other.matchId]: pair[0]!.id === picks[other.matchId] ? pair[1]!.id : pair[0]!.id };
    assert.equal(scoreEntry(final, wrong, () => true).perfect, false, `${make.name}: un fallo rompe`);
  }
});

test("pendientes: solo partidos abiertos con participantes conocidos y sin pick", () => {
  const ctx = ctxOf(de8().matches);
  assert.deepEqual(pendingPicks(ctx, {}, open).sort(), ["de-uqf1", "de-uqf2", "de-uqf3", "de-uqf4"]);
  assert.ok(pendingPicks(ctx, { "de-uqf1": T(1), "de-uqf2": T(4) }, open).includes("de-usf1"));
});

test("fase derivada: abierta / en juego / liquidándose", () => {
  assert.equal(phaseOf("PUBLISHED", { anyOpen: true, anyPickable: true, allDecided: false }), "OPEN");
  assert.equal(phaseOf("PUBLISHED", { anyOpen: true, anyPickable: false, allDecided: false }), "UPCOMING");
  assert.equal(phaseOf("PUBLISHED", { anyOpen: false, anyPickable: false, allDecided: false }), "IN_PROGRESS");
  assert.equal(phaseOf("PUBLISHED", { anyOpen: false, anyPickable: false, allDecided: true }), "SETTLING");
  assert.equal(phaseOf("SETTLED", { anyOpen: false, anyPickable: false, allDecided: true }), "SETTLED");
});

test("clasificación con empates (1, 1, 3) y orden estable", () => {
  const r = rankRows([{ userId: "b", points: 5, correct: 3 }, { userId: "a", points: 5, correct: 3 }, { userId: "c", points: 2, correct: 1 }]);
  assert.deepEqual(r.map((x) => [x.userId, x.position]), [["a", 1], ["b", 1], ["c", 3]]);
});

/* ─────────────────────────── recompensas ─────────────────────────── */

const PRICES: Record<string, number> = { estandar: 2500, premium: 6000, oro: 12000, masters: 20000, champions: 35000, icon: 60000 };
const cat: CatalogLookup = { packPrice: (id) => PRICES[id] ?? null, cardExists: (id) => id === "carta-real" };

test("escalones por proporción; participación exige completitud; perfecto aparte", () => {
  const cfg = proposedRewards("champions-2026-playoffs");
  assert.deepEqual(validateRewards(cfg, cat).filter((i) => i.severity === "ERROR"), []);
  assert.equal(tierFor(cfg, { completion: 0.5, ratio: 1, perfect: false }), null, "sin participación válida, nada");
  assert.equal(tierFor(cfg, { completion: 0.8, ratio: 0.1, perfect: false }), "PARTICIPATION");
  assert.equal(tierFor(cfg, { completion: 1, ratio: 0.5, perfect: false }), "GOOD");
  assert.equal(tierFor(cfg, { completion: 1, ratio: 0.72, perfect: false }), "GREAT");
  assert.equal(tierFor(cfg, { completion: 1, ratio: 0.9, perfect: false }), "ELITE");
  assert.equal(tierFor(cfg, { completion: 1, ratio: 1, perfect: true }), "PERFECT");
});

test("validación de recompensas: sin sobres ni cartas fantasma, tope de créditos, insignias de la familia", () => {
  const bad = proposedRewards("x-y-z");
  bad.tiers[0].reward = { packId: "sobre-inventado" };
  bad.tiers[1].reward = { cardIds: ["carta-fantasma"] };
  bad.tiers[2].reward = { credits: 999_999 };
  bad.tiers[3].reward = { cosmetics: ["marco:dorado"] };
  const codes = validateRewards(bad, cat).filter((i) => i.severity === "ERROR").map((i) => i.code);
  for (const c of ["PACK_UNKNOWN", "CARD_UNKNOWN", "CREDITS_CAP", "COSMETIC"]) assert.ok(codes.includes(c), c);
});

test("pasivo máximo: peor caso = participantes × escalón más caro", () => {
  const l = liabilityOf(proposedRewards("s"), cat);
  assert.equal(l.maxTierValue, 20000);
  assert.equal(l.worstCase(1000), 20_000_000);
});
