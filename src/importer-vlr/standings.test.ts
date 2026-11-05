/**
 * CLASIFICACIÓN FINAL — tests del parser que desbloquea `champion-edition`.
 *
 * Lo que se protege aquí no es «que parsee», sino las tres cosas que harían que la variante
 * mintiera: que el campeón salga del DATO y no del código, que un puesto ambiguo no produzca
 * campeón, y que la ausencia de tabla no invente uno.
 *
 * Los fixtures son SINTÉTICOS —«Alpha», «Bravo»…— pero su MARKUP es el real de vlr.gg,
 * copiado de `vlr.gg/event/2976`. Ningún número ni nombre de aquí describe a un equipo real.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEventPlacements, prizeToAwards } from "./standings";

/** Una fila de la tabla, con el markup real: `<sup>` en el puesto y región dentro del nombre. */
const fila = (place: string, prize: string, teamId: number, slug: string, name: string, points?: string): string => `
<div class="row " role="row">
  <div class="cell" role="cell" style="white-space: nowrap;">${place}</div>
  <div class="cell" role="cell" style="justify-content: flex-end">${prize}</div>
  <div class="cell mod-team" role="cell" style="">
    <a href="/team/${teamId}/${slug}" style="display: flex;">
      <img src="//owcdn.net/img/x.png">
      <div style="margin-left: 12px;" class="text-of">${name}<div class="ge-text-light">Europe</div></div>
    </a>
    <div class="event-standings-spoiler">Spoiler hidden</div>
  </div>
  <div class="cell" role="cell" style="position: relative;">
    <!--<a href="/vct/standings"><span>+</span>999</a>-->
    ${points ? `<div style="color: var(--ncolor-text-link)"><span style="font-weight: 400;">+</span>${points}</div>` : ""}
  </div>
  <div class="cell" role="cell"></div>
</div>`;

/** Página del evento con su tabla, tal y como la sirve VLR (rótulo + wf-card + wf-ptable). */
const pagina = (filas: string): string => `<!DOCTYPE html><html><body>
<div class="wf-label mod-large">Prize Distribution</div>
<div class="wf-card mod-dark">
  <div class="wf-ptable wf-ptable--standings" role="table">
    <div class="row" role="row">
      <div class="cell" role="cell">Place</div>
      <div class="cell" role="cell">Prize</div>
      <div class="cell" role="cell">Team</div>
      <div class="cell" role="cell">Points</div>
      <div class="cell" role="cell">Note</div>
    </div>
    ${filas}
  </div>
</div>
<div class="wf-label mod-large">Otra tabla que NO es la clasificación</div>
<div class="wf-ptable"><div class="row" role="row"><a href="/team/999/intruso"></a></div></div>
</body></html>`;

const COMPLETA = pagina([
  fila("1<sup>st</sup>", "$100,000", 11, "alpha", "Alpha Esports", "8"),
  fila("2<sup>nd</sup>", "$65,000", 22, "bravo", "Bravo Gaming", "6"),
  fila("3<sup>rd</sup>", "$40,000", 33, "charlie", "Charlie Club", "5"),
  fila("5<sup>th</sup>–6<sup>th</sup>", "$10,000", 44, "delta", "Delta Team"),
  fila("5<sup>th</sup>–6<sup>th</sup>", "$10,000", 55, "echo", "Echo Squad"),
].join(""));

test("lee cada puesto con su equipo, su premio y sus puntos", () => {
  const p = parseEventPlacements(COMPLETA);
  assert.equal(p.length, 5);
  assert.deepEqual(p[0], {
    position: 1, teamName: "Alpha Esports", vlrTeamId: "11", slug: "alpha", prize: 100000, points: 8,
  });
  assert.equal(p[2].prize, 40000);
});

test("el nombre del equipo NO arrastra la región que VLR anida dentro", () => {
  // `div.text-of` contiene «Alpha Esports» y un div hijo con «Europe»: aplanar daría
  // «Alpha Esports Europe», que no resolvería contra ningún equipo del snapshot.
  assert.equal(parseEventPlacements(COMPLETA)[0].teamName, "Alpha Esports");
});

test("un comentario HTML en la celda de puntos no se cuela como valor", () => {
  // El markup real lleva un `<a>` comentado con un número distinto (999) dentro de esa celda.
  const p = parseEventPlacements(COMPLETA);
  assert.equal(p[0].points, 8);
  assert.notEqual(p[0].points, 999);
});

test("los puestos empatados comparten posición y no cobran puntos inventados", () => {
  const p = parseEventPlacements(COMPLETA);
  const quintos = p.filter((x) => x.position === 5);
  assert.equal(quintos.length, 2);
  assert.deepEqual(quintos.map((x) => x.teamName), ["Delta Team", "Echo Squad"]);
  assert.equal(quintos[0].points, undefined, "sin celda de puntos ⇒ undefined, nunca 0");
});

test("la fila de cabecera no se cuenta como un puesto", () => {
  assert.ok(parseEventPlacements(COMPLETA).every((p) => p.teamName !== "Team"));
});

test("no se cuela ninguna fila de las tablas que vienen después", () => {
  assert.ok(parseEventPlacements(COMPLETA).every((p) => p.vlrTeamId !== "999"));
});

test("el campeón sale del DATO: cambiar el fixture cambia el campeón", () => {
  // ESTE es el test que impide que «Karmine Corp» acabe escrito en el código en cualquier forma.
  const conAlpha = prizeToAwards(parseEventPlacements(COMPLETA));
  assert.equal(conAlpha.champion, "Alpha Esports");
  assert.equal(conAlpha.runnerUp, "Bravo Gaming");

  const otra = pagina([
    fila("1<sup>st</sup>", "$100,000", 77, "zulu", "Zulu Nation", "8"),
    fila("2<sup>nd</sup>", "$65,000", 11, "alpha", "Alpha Esports", "6"),
  ].join(""));
  const conZulu = prizeToAwards(parseEventPlacements(otra));
  assert.equal(conZulu.champion, "Zulu Nation");
  assert.equal(conZulu.runnerUp, "Alpha Esports");
});

test("sin tabla de clasificación no hay campeón (torneo en curso)", () => {
  const enCurso = "<html><body><div class='event-header'>Un torneo sin reparto</div></body></html>";
  assert.deepEqual(parseEventPlacements(enCurso), []);
  assert.deepEqual(prizeToAwards([]), { champion: undefined, runnerUp: undefined });
});

test("un primer puesto AMBIGUO no produce campeón", () => {
  // Dos equipos en el 1: la fuente no dice quién ganó, así que aquí tampoco se decide.
  const empate = pagina([
    fila("1<sup>st</sup>", "$80,000", 11, "alpha", "Alpha Esports"),
    fila("1<sup>st</sup>", "$80,000", 22, "bravo", "Bravo Gaming"),
  ].join(""));
  const p = parseEventPlacements(empate);
  assert.equal(p.length, 2, "las dos filas se leen…");
  assert.equal(prizeToAwards(p).champion, undefined, "…pero ninguna es campeona");
});

test("markup cambiado: se degrada a vacío, nunca a un campeón cualquiera", () => {
  const roto = '<html><body><div class="wf-ptable wf-ptable--standings" role="table">' +
    '<div class="row" role="row"><div class="cell" role="cell">1st</div></div></div></body></html>';
  assert.deepEqual(parseEventPlacements(roto), [], "fila sin enlace de equipo ⇒ se descarta");
});
