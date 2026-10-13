/**
 * EL RESUMEN DEL PARTIDO — el contrato entre el cliente y el servidor.
 *
 * `resumirPartido` (cliente) traduce un `MatchState` terminado; `validarPartido` (servidor) decide
 * si esa traducción es un partido admisible. Son dos ficheros que no se conocen, y si divergen el
 * resultado es silencioso: el partido termina, la ceremonia se pinta y la fila no se escribe nunca.
 *
 * Así que aquí se juegan partidos DE VERDAD con el motor —no se escribe un resumen a mano— y se
 * comprueba que lo que sale de uno lo acepta el otro. Es lo único que ata los dos lados.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEMO_HOME, DEMO_AWAY } from "@/sim/mapping/demoRoster";
import { simulateMatch, makeMatchConfig } from "@/match";
import type { Side } from "@/sim";
import { resumirPartido, SIM_MAP_ID, SIM_MAP_SITE } from "./history";
import { validarPartido } from "@/server/services/coachMatches";

const jugar = (seed: number, side: Side) => simulateMatch(makeMatchConfig({
  seed,
  rosters: { home: DEMO_HOME, away: DEMO_AWAY },
  homeSetup: { side, approach: "default", tempo: "mid", aggression: "balanced" },
  teamNames: { home: "Verificación FC", away: "Rival (Normal)" },
}));

const PARTIDOS = [
  { seed: 11, side: "ATK" as Side },
  { seed: 29, side: "DEF" as Side },
  { seed: 4242, side: "ATK" as Side },
  { seed: 90001, side: "DEF" as Side },
];

test("lo que resume el cliente lo acepta el servidor, partido real a partido real", () => {
  for (const { seed, side } of PARTIDOS) {
    const m = jugar(seed, side);
    assert.equal(m.phase, "MATCH_END", `el partido ${seed} tiene que terminar`);
    const r = validarPartido(resumirPartido(m, "normal"));
    assert.equal(r.ok, true, `seed ${seed}: ${r.ok ? "" : r.error}`);
  }
});

test("las rondas del resumen son las liquidadas: el marcador sumado", () => {
  for (const { seed, side } of PARTIDOS) {
    const m = jugar(seed, side);
    const s = resumirPartido(m, "normal");
    assert.equal(s.rounds, m.history.length);
    assert.equal(s.rounds, s.scoreHome + s.scoreAway, `seed ${seed}`);
    assert.notEqual(s.scoreHome, s.scoreAway, `seed ${seed}: un partido terminado tiene ganador`);
  }
});

test("el lado guardado es el SORTEADO al empezar, no el de la segunda mitad", () => {
  // A mitad de partido `currentHomeSide` cambia; leerlo al final guardaría el lado equivocado.
  for (const side of ["ATK", "DEF"] as Side[]) {
    const m = jugar(7, side);
    assert.equal(resumirPartido(m, "normal").startSide, side);
  }
});

test("la semilla del resumen es la del partido: la clave de idempotencia", () => {
  const m = jugar(123456, "ATK");
  assert.equal(resumirPartido(m, "normal").seed, m.config.seed);
});

test("el mapa es el que el simulador juega de verdad: Ascent, sitio A", () => {
  const s = resumirPartido(jugar(5, "ATK"), "normal");
  assert.equal(s.mapId, SIM_MAP_ID);
  assert.equal(s.mapSite, SIM_MAP_SITE);
  assert.equal(SIM_MAP_ID, "ascent");
  assert.equal(SIM_MAP_SITE, "A");
});

test("el destacado solo se guarda si es del equipo dirigido", () => {
  for (const { seed, side } of PARTIDOS) {
    const m = jugar(seed, side);
    const s = resumirPartido(m, "normal");
    if (m.mvp?.team === "home") assert.equal(s.mvp, m.mvp.name);
    else assert.equal(s.mvp, null, `seed ${seed}: el MVP del rival no es tu destacado`);
  }
});
