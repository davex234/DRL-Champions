import test from "node:test";
import assert from "node:assert/strict";
import {
  duelAward, duelPoints, duelReward, outcomeOf, duelPayoutTable, LOSS_SUBTRACTS,
  capDuelAward, DAILY_DUEL_AWARD_CAP,
  type DuelDifficulty, type DuelOutcome,
} from "./duelRewards";

const DIFFS: DuelDifficulty[] = ["EASY", "NORMAL", "HARD"];
const OUTCOMES: DuelOutcome[] = ["win", "draw", "loss"];

test("el resultado del motor se traduce a los tres ejes de la tabla", () => {
  assert.equal(outcomeOf({ winner: "YOU", isDraw: false }), "win");
  assert.equal(outcomeOf({ winner: "RIVAL", isDraw: false }), "loss");
  assert.equal(outcomeOf({ winner: null, isDraw: true }), "draw");
  // Un ganador nulo sin bandera de empate sigue siendo un empate: es lo que el
  // orquestador devuelve en `UNRESOLVED`, y no puede quedarse sin traducción.
  assert.equal(outcomeOf({ winner: null, isDraw: false }), "draw");
});

test("ganar siempre paga más que empatar, y empatar más que perder", () => {
  for (const d of DIFFS) {
    const win = duelPayoutTable().win[d];
    const draw = duelPayoutTable().draw[d];
    const loss = duelPayoutTable().loss[d];
    assert.ok(win.points > draw.points, `puntos win>draw en ${d}`);
    assert.ok(draw.points > loss.points, `puntos draw>loss en ${d}`);
    assert.ok(win.credits > draw.credits && draw.credits > loss.credits, `créditos ordenados en ${d}`);
    assert.ok(win.xp > draw.xp && draw.xp > loss.xp, `xp ordenada en ${d}`);
  }
});

test("la dificultad importa: difícil paga más que normal y normal más que fácil", () => {
  for (const o of OUTCOMES) {
    const t = duelPayoutTable()[o];
    assert.ok(t.HARD.credits > t.NORMAL.credits, `créditos HARD>NORMAL en ${o}`);
    assert.ok(t.NORMAL.credits > t.EASY.credits, `créditos NORMAL>EASY en ${o}`);
    // En derrota los puntos son cero en las tres: comparar ">" sería falso a propósito.
    if (o !== "loss") {
      assert.ok(t.HARD.points > t.NORMAL.points, `puntos HARD>NORMAL en ${o}`);
      assert.ok(t.NORMAL.points > t.EASY.points, `puntos NORMAL>EASY en ${o}`);
    }
  }
});

test("ganar en difícil paga más del doble en puntos que ganar en fácil", () => {
  // Si las dificultades pagaran parecido, elegir «fácil» sería siempre lo óptimo y el
  // selector de dificultad no significaría nada.
  const t = duelPayoutTable().win;
  assert.ok(t.HARD.points >= t.EASY.points * 2.5, `${t.HARD.points} vs ${t.EASY.points}`);
});

test("perder NO resta rango mientras LOSS_SUBTRACTS sea falso", () => {
  assert.equal(LOSS_SUBTRACTS, false);
  for (const d of DIFFS) {
    assert.equal(duelPoints("loss", d), 0, `derrota en ${d}`);
    // Pero sí paga por haber jugado: una derrota que no da nada hace que abandonar
    // en cuanto se ve la derrota sea la jugada correcta.
    assert.ok((duelReward("loss", d).credits ?? 0) > 0, `créditos de derrota en ${d}`);
  }
});

test("ninguna recompensa de duelo reparte cartas, sobres, fichas ni cosméticos", () => {
  /*
   * Un duelo contra un bot es repetible sin límite: si pagara en cartas o en sobres, la
   * colección se conseguiría dando al botón. Paga en las tres monedas que sí están
   * pensadas para el goteo — créditos, XP y puntos — y en ninguna otra.
   */
  for (const o of OUTCOMES) {
    for (const d of DIFFS) {
      const r = duelReward(o, d);
      assert.equal(r.packId, undefined, `${o}/${d} no da sobres`);
      assert.equal(r.cardId, undefined, `${o}/${d} no da cartas`);
        assert.equal(r.cosmetics, undefined, `${o}/${d} no da cosméticos`);
    }
  }
});

test("la recompensa es determinista: se puede enseñar sin guardarla", () => {
  const a = duelAward({ winner: "YOU", isDraw: false }, "HARD");
  const b = duelAward({ winner: "YOU", isDraw: false }, "HARD");
  assert.deepEqual(a, b);
});

test("subir de Bronce a Plata cuesta un número razonable de victorias", () => {
  // Plata empieza en 150 puntos. En normal (14/victoria) son 11 victorias; en fácil
  // (8/victoria), 19. Ni un atajo ni un muro.
  const normal = duelPoints("win", "NORMAL");
  const easy = duelPoints("win", "EASY");
  assert.ok(Math.ceil(150 / normal) >= 8 && Math.ceil(150 / normal) <= 15, `${Math.ceil(150 / normal)} victorias`);
  assert.ok(Math.ceil(150 / easy) >= 15, `${Math.ceil(150 / easy)} victorias en fácil`);
});

test("el tope diario deja de pagar, pero solo a partir del cupo", () => {
  const a = duelAward({ winner: "YOU", isDraw: false }, "HARD");

  const first = capDuelAward(a, 0);
  assert.equal(first.capped, false);
  assert.equal(first.points, a.points);
  assert.equal(first.reward.credits, a.reward.credits);

  const last = capDuelAward(a, DAILY_DUEL_AWARD_CAP - 1);
  assert.equal(last.capped, false, "la última partida del cupo cobra entera");

  const over = capDuelAward(a, DAILY_DUEL_AWARD_CAP);
  assert.equal(over.capped, true);
  assert.equal(over.points, 0, "no da rango");
  assert.deepEqual(over.reward, {}, "no da nada");
});

test("el tope no cambia el resultado de la partida, solo lo que paga", () => {
  // Jugar por encima del cupo sigue siendo jugar: la partida se guarda y cuenta para las
  // misiones. Lo único que se agota es el pago.
  const a = duelAward({ winner: "YOU", isDraw: false }, "NORMAL");
  const over = capDuelAward(a, DAILY_DUEL_AWARD_CAP + 50);
  assert.equal(over.outcome, "win");
  assert.equal(over.difficulty, "NORMAL");
});

test("el cupo diario es holgado para una sesión normal y corto para una granja", () => {
  // Veinte partidas son ~2 horas de juego real; cien serían una granja.
  assert.ok(DAILY_DUEL_AWARD_CAP >= 15 && DAILY_DUEL_AWARD_CAP <= 30, `${DAILY_DUEL_AWARD_CAP}`);
});
