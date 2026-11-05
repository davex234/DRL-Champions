/**
 * EL SORTEO DEL LADO — que sea de verdad 50/50, y que nadie pueda inclinarlo.
 *
 * Era un bug: la pantalla previa dejaba elegir Ataque o Defensa, y eso es media ventaja de
 * partido regalada. La corrección solo vale si el reparto es comprobable, así que estas
 * pruebas atacan las dos formas en que un sorteo deja de serlo — que un lado no salga nunca,
 * y que salgan repartidos pero no a partes iguales.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { drawSide, SIDES, SIDE_NAME } from "./sideDraw";

test("el corte está exactamente en la mitad del recorrido", () => {
  // Justo por debajo de 0,5 y justo por encima: el punto donde un sesgo se escondería.
  assert.equal(drawSide(() => 0), "ATK");
  assert.equal(drawSide(() => 0.499999), "ATK");
  assert.equal(drawSide(() => 0.5), "DEF");
  assert.equal(drawSide(() => 0.999999), "DEF");
});

test("con un generador uniforme, el reparto es 50/50", () => {
  // 10.000 tiradas equiespaciadas: la mitad exacta a cada lado, sin depender del azar.
  const N = 10_000;
  let atk = 0;
  for (let i = 0; i < N; i++) if (drawSide(() => i / N) === "ATK") atk++;
  assert.equal(atk, N / 2);
});

test("salen los dos lados: ninguno queda fuera del sorteo", () => {
  const vistos = new Set<string>();
  for (let i = 0; i < 200; i++) vistos.add(drawSide());
  assert.deepEqual([...vistos].sort(), ["ATK", "DEF"]);
});

test("no recuerda la tirada anterior: cada sorteo es independiente", () => {
  /*
   * Un sorteo «compensado» —que fuerce el otro lado tras una racha— sería una decisión
   * disfrazada. Se comprueba dando SIEMPRE el mismo valor: si hubiera memoria, la respuesta
   * cambiaría en algún momento.
   */
  for (let i = 0; i < 50; i++) assert.equal(drawSide(() => 0.1), "ATK");
  for (let i = 0; i < 50; i++) assert.equal(drawSide(() => 0.9), "DEF");
});

test("los dos lados tienen nombre en la interfaz", () => {
  for (const s of SIDES) {
    assert.equal(typeof SIDE_NAME[s], "string");
    assert.ok(SIDE_NAME[s].length > 0);
  }
});
