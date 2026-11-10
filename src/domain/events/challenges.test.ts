import test from "node:test";
import assert from "node:assert/strict";
import {
  CHALLENGE_SETS, challengesFor, challengeById, challengeSetFor, challengeRef, totalReward,
} from "./challenges";
import { REWARD_TIERS } from "@/domain/pickems/rewards";
import { PACKS } from "@/data/packs";

const intl = { id: "x", type: "international", region: null };
const other = { id: "y", type: "regional-league", region: "EMEA" };

test("todo evento recibe un conjunto: el ultimo es la red de seguridad", () => {
  for (const type of ["international", "masters", "ewc", "champions", "regional-league", "loquesea", null]) {
    const set = challengeSetFor({ id: "e", type, region: null });
    assert.ok(set, `sin conjunto para type=${type}`);
    assert.ok(set.challenges.length > 0);
  }
});

test("los conjuntos se eligen por CAMPOS del evento, nunca por su id", () => {
  /*
   * Es la regla data-driven que la Fase 10 fijó para el ciclo. Si el id decidiera, cada
   * torneo nuevo del circuito exigiría tocar código. Se comprueba cambiando SOLO el id: el
   * conjunto tiene que ser el mismo.
   */
  const a = challengeSetFor({ id: "demo-masters-madrid-2026", type: "international", region: null });
  const b = challengeSetFor({ id: "otro-torneo-cualquiera", type: "international", region: null });
  assert.equal(a.id, b.id);
});

test("los internacionales traen un desafio mas, no premios distintos", () => {
  const base = challengesFor(other);
  const big = challengesFor(intl);
  assert.ok(big.length > base.length);
  // Los desafíos compartidos pagan exactamente lo mismo en los dos conjuntos.
  for (const c of base) {
    const same = big.find((x) => x.id === c.id);
    assert.ok(same, `falta ${c.id} en el conjunto internacional`);
    assert.deepEqual(same!.reward, c.reward);
  }
});

test("no hay ids repetidos dentro de un conjunto", () => {
  for (const set of CHALLENGE_SETS) {
    const ids = set.challenges.map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length, `ids repetidos en ${set.id}`);
  }
});

test("cada meta es alcanzable y cada premio entrega algo", () => {
  for (const set of CHALLENGE_SETS) {
    for (const c of set.challenges) {
      assert.ok(c.goal > 0, `${set.id}/${c.id}: meta ${c.goal}`);
      const r = c.reward;
      const gives = (r.credits ?? 0) + (r.xp ?? 0) + (r.packCount ?? 0);
      assert.ok(gives > 0, `${set.id}/${c.id} no entrega nada`);
      // Un sobre prometido tiene que existir en el catálogo.
      if (r.packId) assert.ok(PACKS.some((p) => p.id === r.packId), `sobre inexistente: ${r.packId}`);
      // Y un sobre sin cantidad es un descuido de contenido.
      if (r.packId) assert.ok((r.packCount ?? 0) > 0, `${c.id}: sobre sin cantidad`);
    }
  }
});

test("un desafio de evento NUNCA paga mas que el escalon alto del Pick'em", () => {
  /*
   * La regla de no pagar dos veces por lo mismo. El Pick'em paga por ACERTAR y es la
   * recompensa mayor; el desafío paga por PARTICIPAR y tiene que quedar por debajo. Si un
   * desafío superase al mejor escalón, acertar dejaría de ser lo que más renta.
   */
  const top = REWARD_TIERS[REWARD_TIERS.length - 1].reward.credits ?? 0;
  for (const set of CHALLENGE_SETS) {
    for (const c of set.challenges) {
      assert.ok((c.reward.credits ?? 0) < top,
        `${c.id} paga ${c.reward.credits} y el escalon alto del Pick'em paga ${top}`);
    }
  }
});

test("un evento entero se queda MUY por debajo del grifo de temporada", () => {
  /*
   * 124.900 créditos no repetibles por temporada (`economy.md` §4, medido). Tres eventos
   * por temporada no pueden acercarse a esa cifra: el contenido vivo no debe convertirse
   * en la fuente principal de créditos, o el evento deja de ser contenido y pasa a ser
   * inflación con un nombre bonito.
   */
  const SEASON_FAUCET = 124_900;
  const EVENTS_PER_SEASON = 3;
  for (const set of CHALLENGE_SETS) {
    const perEvent = totalReward(set.challenges).credits ?? 0;
    const perSeason = perEvent * EVENTS_PER_SEASON;
    assert.ok(perSeason < SEASON_FAUCET * 0.15,
      `${set.id}: ${perSeason} cr por temporada sobre un grifo de ${SEASON_FAUCET}`);
  }
});

test("el total de un conjunto es la suma de sus partes", () => {
  const set = challengeSetFor(intl);
  const t = totalReward(set.challenges);
  const credits = set.challenges.reduce((s, c) => s + (c.reward.credits ?? 0), 0);
  const xp = set.challenges.reduce((s, c) => s + (c.reward.xp ?? 0), 0);
  assert.equal(t.credits, credits);
  assert.equal(t.xp, xp);
});

test("la clave de idempotencia identifica evento Y desafio", () => {
  assert.equal(challengeRef("masters-2026", "participar"), "event:masters-2026:participar");
  // Dos eventos distintos no pueden compartir clave: si la compartieran, cobrar en uno
  // cerraría la puerta en el otro.
  assert.notEqual(challengeRef("a", "participar"), challengeRef("b", "participar"));
});

test("challengeById solo devuelve desafios de ESE evento", () => {
  assert.ok(challengeById(intl, "analista"));
  // `analista` es exclusivo del conjunto internacional: pedirlo en otro tiene que fallar.
  assert.equal(challengeById(other, "analista"), null);
  assert.equal(challengeById(intl, "no-existe"), null);
});
