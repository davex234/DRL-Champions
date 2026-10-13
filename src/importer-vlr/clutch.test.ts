/**
 * CLUTCH — tests del único punto donde el dato entra en el sistema.
 *
 * La regla que se protege es una sola y es la del encargo: **el clutch se lee o no existe.**
 * Nunca se deriva de kills, ni de first kills, ni de multikills, ni se rellena con cero.
 *
 * Fixtures SINTÉTICOS con el markup REAL de `/event/stats/` (celda `data-col="cl"` partida en
 * `st-cl-x`/`st-cl-y`, copiada de `vlr.gg/event/stats/2976`). Ningún número describe a nadie.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEventStats } from "./stats";

/** Fila de la tabla de stats. `cl`/`clp` opcionales: así se prueba la ausencia del dato. */
function fila(opts: {
  id: number; nick: string; tag: string; kills: number;
  cl?: [number, number]; clp?: string; clCell?: string;
}): string {
  const clCell = opts.clCell !== undefined
    ? opts.clCell
    : opts.cl
      ? `<td data-col="cl"><span class="st-cl"><span class="st-cl-x">${opts.cl[0]}</span>/<span class="st-cl-y">${opts.cl[1]}</span></span></td>`
      : "";
  const clpCell = opts.clp !== undefined ? `<td class="mod-color-sq" data-col="clp" title="CL%">${opts.clp}</td>` : "";
  return `<tr>
<td class="mod-player mod-a"><a href="/player/${opts.id}/${opts.nick.toLowerCase()}">
<i class="flag mod-es"></i>
<div class="st-pl-meta"><div class="st-pl-name text-of">${opts.nick}</div>
<div class="st-pl-country">${opts.tag}</div></div></a></td>
<td data-col="maps">10</td><td data-col="rnd">200</td>
<td class="mod-color-sq" data-col="rating2" title="R">1.10</td>
<td class="mod-color-sq" data-col="acs" title="ACS">230</td>
<td class="mod-color-sq" data-col="hsp" title="HS%">25%</td>
${clpCell}${clCell}
<td data-col="k">${opts.kills}</td><td data-col="d">150</td><td data-col="a">70</td>
<td data-col="fk">20</td><td data-col="fd">18</td></tr>`;
}

const pagina = (filas: string): string =>
  `<html><body><table class="wf-table mod-stats st-table"><thead><tr><th>Player</th></tr></thead><tbody>${filas}</tbody></table></body></html>`;

test("lee ganadas y jugadas por separado, y el porcentaje de la fuente", () => {
  const [r] = parseEventStats(pagina(fila({ id: 1, nick: "Uno", tag: "AAA", kills: 300, cl: [9, 40], clp: "23%" })));
  assert.equal(r.clutchesWon, 9);
  assert.equal(r.clutchSituations, 40);
  assert.equal(r.clutchPct, 23);
});

test("sin celda de clutch NO se inventa nada — ni cero", () => {
  const [r] = parseEventStats(pagina(fila({ id: 2, nick: "Dos", tag: "BBB", kills: 400 })));
  assert.equal(r.clutchesWon, undefined, "undefined = no medido; 0 sería «ninguno», que es otra cosa");
  assert.equal(r.clutchSituations, undefined);
  assert.equal(r.clutchPct, undefined);
  assert.equal(r.kills, 400, "el resto de la fila se sigue leyendo con normalidad");
});

test("una fracción a medias no produce clutch (hace falta el denominador)", () => {
  const soloX = '<td data-col="cl"><span class="st-cl"><span class="st-cl-x">7</span></span></td>';
  const [r] = parseEventStats(pagina(fila({ id: 3, nick: "Tres", tag: "CCC", kills: 200, clCell: soloX })));
  assert.equal(r.clutchesWon, undefined);
  assert.equal(r.clutchSituations, undefined);
});

test("NINGUNA otra estadística se convierte en clutch", () => {
  /*
   * El jugador tiene kills, first kills y asistencias altísimas, y CERO dato de clutch.
   * Si alguna vez alguien deriva clutch de otra columna, este test lo caza.
   */
  const [r] = parseEventStats(pagina(fila({ id: 4, nick: "Cuatro", tag: "DDD", kills: 999 })));
  assert.equal(r.clutchesWon, undefined);
  assert.equal(r.fk, 20, "sí que hay first kills…");
  assert.equal(r.kills, 999, "…y kills de sobra, pero eso no es clutch");
});

test("cero clutches ganados es un DATO, y se conserva como cero", () => {
  // Distinto del caso «no medido»: aquí la fuente sí dice que jugó 12 y ganó 0.
  const [r] = parseEventStats(pagina(fila({ id: 5, nick: "Cinco", tag: "EEE", kills: 100, cl: [0, 12], clp: "0%" })));
  assert.equal(r.clutchesWon, 0);
  assert.equal(r.clutchSituations, 12);
});

test("una tabla mixta conserva quién tiene dato y quién no", () => {
  const rows = parseEventStats(pagina(
    fila({ id: 6, nick: "Con", tag: "FFF", kills: 100, cl: [5, 20], clp: "25%" }) +
    fila({ id: 7, nick: "Sin", tag: "GGG", kills: 100 }),
  ));
  assert.equal(rows.length, 2);
  assert.equal(rows[0].clutchesWon, 5);
  assert.equal(rows[1].clutchesWon, undefined);
});
