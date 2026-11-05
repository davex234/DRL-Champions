/**
 * PIZARRA · ORDEN DE CAPAS — una ficha nunca queda tapada por un dibujo.
 *
 * En SVG el clic lo gana lo último que se pinta. Las flechas y líneas llevan una zona de agarre
 * invisible de 2,4 U (el radio de una ficha) y las zonas/rectángulos tienen relleno: si los dibujos
 * van ENCIMA de las fichas, una ficha sobre el inicio de una flecha no se puede seleccionar ni
 * arrastrar. Se fija en la fuente porque es una decisión de capas, no de estilo.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const board = readFileSync(join(process.cwd(), "src/components/tactics/StrategyBoard.tsx"), "utf8");

test("los dibujos guardados se pintan ANTES (debajo) que fichas y utilidades", () => {
  const dibujos = board.indexOf("state.drawings.map(");
  const fichas = board.indexOf("state.players.map(");
  const utilidades = board.indexOf("state.utilities.map(");
  assert.ok(dibujos > 0 && fichas > 0 && utilidades > 0, "no se encuentran las capas");
  assert.ok(dibujos < fichas, "los dibujos taparían las fichas");
  assert.ok(dibujos < utilidades, "los dibujos taparían las utilidades");
  assert.equal(board.split("state.drawings.map(").length - 1, 1, "los dibujos se pintan una sola vez");
});

test("el trazo EN CURSO sigue encima de todo mientras se dibuja", () => {
  const trazo = board.indexOf("draft && draft.length >= 2");
  assert.ok(trazo > board.indexOf("state.utilities.map("), "el trazo en curso quedaría tapado");
});

test("la flecha conserva su zona de agarre y su selección", () => {
  assert.match(board, /stroke="transparent" strokeWidth=\{2\.4 \* U\}/);
  assert.match(board, /beginDrag\(e, d\.id, actions, readOnly, true\)/, "un dibujo se selecciona, no se arrastra");
});
