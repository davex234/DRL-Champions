import test from "node:test";
import assert from "node:assert/strict";
import {
  MARKET_CRITERIA, evaluateReadiness, marketReady, blockers,
  anchorRatios, salvageBelowReference, ANCHOR_BAND, MIN_PLAYERS_FOR_DISCOVERY,
} from "./marketReadiness";
import { GLOBAL_MARKET_ENABLED } from "@/config/features";

/** Los criterios que una máquina comprueba contra la base de datos. */
const VERIFIED_OK = Object.fromEntries(
  MARKET_CRITERIA.filter((c) => c.decidedBy === "verify").map((c) => [c.id, true]),
);

test("cada criterio dice QUE se rompe si se abre sin el", () => {
  // Un criterio sin motivo escrito es una casilla que alguien marcará sin pensar.
  for (const c of MARKET_CRITERIA) {
    assert.ok(c.why.length > 30, `${c.id}: motivo demasiado corto`);
    assert.ok(["verify", "measure", "operations"].includes(c.decidedBy));
  }
});

test("UN CRITERIO SIN COMPROBAR NO ESTA CUMPLIDO", () => {
  /*
   * La invariante que separa «no lo sabemos» de «está bien». Sin ella, la lista de
   * criterios sería un formulario que se aprueba dejándolo en blanco.
   */
  const results = evaluateReadiness();
  for (const r of results.filter((x) => x.criterion.decidedBy === "verify")) {
    assert.equal(r.status, "unknown", `${r.criterion.id} se da por bueno sin comprobar`);
  }
  assert.equal(marketReady(results), false);
});

test("EL INTERRUPTOR DEL MERCADO NO PUEDE ESTAR ABIERTO SIN CUMPLIR LOS CRITERIOS", () => {
  /*
   * Este es el cerrojo. `GLOBAL_MARKET_ENABLED` es un booleano en un fichero de
   * configuración: cambiarlo cuesta un segundo y hasta ahora no lo contrastaba nada.
   *
   * A partir de aquí, ponerlo en `true` obliga a que todos los criterios evaluables sin
   * base de datos estén cumplidos. Si alguien lo enciende con la economía sin calibrar,
   * `npm test` cae y dice por qué.
   */
  if (!GLOBAL_MARKET_ENABLED) return;

  const results = evaluateReadiness({ verified: VERIFIED_OK, activePlayers: MIN_PLAYERS_FOR_DISCOVERY });
  const pending = blockers(results);
  assert.deepEqual(pending.map((b) => b.criterion.id), [],
    "El mercado esta ABIERTO y estos criterios no se cumplen: "
    + pending.map((b) => `${b.criterion.id} (${b.detail})`).join(" · "));
});

test("el ancla esta calibrada: mide precio contra COSTE, no contra el sobre entero", () => {
  /*
   * La cuenta de la Fase 11 —`marketValue` medio del contenido de un sobre partido por el
   * precio del sobre— daba entre 7× y 15× y sonó a alarma. Era la cuenta equivocada por dos
   * motivos: medía `instanceValue` (que multiplica hasta ×5 por número de serie) y comparaba
   * una tasación POR CARTA contra un precio POR SOBRE.
   *
   * La comparación correcta es por rareza: lo que vale una carta frente a lo que cuesta
   * conseguir una de su rareza. Medida así, las cinco rarezas caen dentro de la banda.
   */
  const ratios = anchorRatios();
  assert.equal(Object.keys(ratios).length, 5, "faltan rarezas en el calculo del ancla");
  for (const [bucket, r] of Object.entries(ratios)) {
    assert.ok(r >= ANCHOR_BAND.min && r <= ANCHOR_BAND.max,
      `${bucket}: la referencia es ${r.toFixed(2)}x el coste de tirada`);
  }
});

test("desguazar una carta comprada en el mercado NUNCA puede dar beneficio", () => {
  /*
   * El exploit que abriría el mercado si nadie lo mirase: comprar barato la carta más
   * barata de un bucket, desguazarla y repetir. Se comprueba contra la carta MÁS BARATA de
   * cada rareza, que es el peor caso, no contra la media.
   */
  const { ok, worst } = salvageBelowReference();
  assert.ok(ok, `el desguace de ${worst?.bucket} alcanza el ${((worst?.ratio ?? 0) * 100).toFixed(0)} % de su referencia`);
});

test("la masa de jugadores no se puede fingir desde el repositorio", () => {
  const results = evaluateReadiness({ verified: VERIFIED_OK });
  const mass = results.find((r) => r.criterion.id === "player-mass")!;
  assert.equal(mass.status, "unknown");
  // Y con un número por debajo del mínimo, es un NO explícito, no un «ya veremos».
  const few = evaluateReadiness({ verified: VERIFIED_OK, activePlayers: 4 });
  assert.equal(few.find((r) => r.criterion.id === "player-mass")!.status, "unmet");
  assert.equal(marketReady(few), false);
});

test("con todo cumplido, el veredicto es SI: la lista no es imposible de satisfacer", () => {
  /*
   * Una lista de criterios que nunca puede cumplirse es una forma elegante de no decidir
   * nunca. Se comprueba que existe un escenario que la satisface.
   */
  const results = evaluateReadiness({ verified: VERIFIED_OK, activePlayers: MIN_PLAYERS_FOR_DISCOVERY });
  assert.equal(marketReady(results), true, blockers(results).map((b) => b.detail).join(" · "));
});

test("hoy el mercado sigue cerrado, y el motivo esta escrito", () => {
  assert.equal(GLOBAL_MARKET_ENABLED, false);
  const results = evaluateReadiness({ verified: VERIFIED_OK });
  const pending = blockers(results);
  assert.deepEqual(pending.map((b) => b.criterion.id), ["player-mass"]);
});
