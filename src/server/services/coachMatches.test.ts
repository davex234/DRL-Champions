/**
 * EL HISTORIAL DEL ENTRENADOR — la puerta y el balance.
 *
 * Dos cosas se prueban aquí, y las dos son las que impiden que el historial mienta:
 *
 *   1. **La validación.** Lo que define el partido —semilla, marcador, rondas, lado, mapa— se
 *      RECHAZA si no cuadra, no se corrige. Corregir un marcador imposible sería inventar un
 *      resultado, que es exactamente lo que el encargo prohíbe.
 *
 *   2. **El balance.** Jugados, ganados, diferencial y racha se DERIVAN de los partidos. Si
 *      alguna vez se convierten en contadores guardados aparte, estas pruebas seguirán
 *      pasando sobre la derivación y habrá que venir a cambiarlas a mano — que es la señal.
 *
 * Lo que NO se prueba aquí es la base de datos: eso lo cubre el verificador de extremo a
 * extremo, con RLS real y dos usuarios de verdad.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { validarPartido, trayectoria, type CoachMatchRow } from "./coachMatches";

const bueno = {
  seed: 123456,
  teamName: "Mi equipo",
  rivalName: "Rival (Normal)",
  difficulty: "normal",
  mapId: "ascent",
  mapSite: "A",
  startSide: "ATK",
  scoreHome: 13,
  scoreAway: 9,
  rounds: 22,
  durationSeconds: 1800,
  mvp: "derke",
};

// ─────────────────────────── LA PUERTA ───────────────────────────

test("un partido bien formado pasa entero", () => {
  const r = validarPartido(bueno);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.seed, 123456);
  assert.equal(r.value.scoreHome, 13);
  assert.equal(r.value.startSide, "ATK");
  assert.equal(r.value.mapSite, "A");
});

test("las rondas son exactamente el marcador sumado", () => {
  /*
   * Cada ronda del motor termina con un ganador y suma un punto, así que 13-9 son 22 rondas.
   * Ni menos (no caben) ni más (serían rondas sin dueño inventadas).
   */
  for (const rounds of [5, 21, 23, 30]) {
    const r = validarPartido({ ...bueno, rounds });
    assert.equal(r.ok, false, `debería rechazar ${rounds} rondas para un 13-9`);
    if (!r.ok) assert.match(r.error, /no cuadra/i);
  }
  assert.equal(validarPartido({ ...bueno, rounds: 22 }).ok, true);
});

test("un partido terminado no acaba en empate", () => {
  /*
   * `won` se deriva de `scoreHome > scoreAway`: un empate se guardaría como derrota. Con las
   * reglas del motor no puede darse, así que si llega uno es un cuerpo que no sale del motor.
   */
  const r = validarPartido({ ...bueno, scoreHome: 12, scoreAway: 12, rounds: 24 });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /empate/i);
});

test("un marcador fuera de rango se rechaza, no se recorta", () => {
  for (const scoreHome of [-1, 100, 1e9, NaN, "13"]) {
    assert.equal(validarPartido({ ...bueno, scoreHome }).ok, false, `debería rechazar ${scoreHome}`);
  }
});

test("la semilla tiene que ser un entero de 32 bits sin signo", () => {
  for (const seed of [-1, 4294967296, 1.5, "abc", null, undefined]) {
    assert.equal(validarPartido({ ...bueno, seed }).ok, false, `debería rechazar ${seed}`);
  }
  assert.equal(validarPartido({ ...bueno, seed: 0 }).ok, true);
  assert.equal(validarPartido({ ...bueno, seed: 4294967295 }).ok, true);
});

test("el lado y la dificultad son enumerados cerrados", () => {
  assert.equal(validarPartido({ ...bueno, startSide: "MEDIO" }).ok, false);
  assert.equal(validarPartido({ ...bueno, difficulty: "imposible" }).ok, false);
  // Se admite la caja distinta: es la misma información escrita de otra forma.
  const r = validarPartido({ ...bueno, startSide: "def", difficulty: "HARD" });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.value.startSide, "DEF");
    assert.equal(r.value.difficulty, "hard");
  }
});

test("el texto de apoyo se acota; no invalida el partido", () => {
  const largo = "x".repeat(500);
  const r = validarPartido({ ...bueno, teamName: largo, rivalName: largo, mvp: largo });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.teamName.length, 60);
  assert.equal(r.value.rivalName.length, 60);
  assert.equal(r.value.mvp!.length, 60);
});

test("sin nombres, el partido sigue siendo válido y se le pone uno neutro", () => {
  const r = validarPartido({ ...bueno, teamName: "   ", rivalName: undefined, mvp: "" });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.teamName, "Mi equipo");
  assert.equal(r.value.rivalName, "Rival");
  assert.equal(r.value.mvp, null);
});

test("un cuerpo que no es un objeto no llega a la base de datos", () => {
  for (const basura of [null, undefined, 42, "partido", []]) {
    const r = validarPartido(basura);
    // Un array pasa el `typeof object`, pero se queda sin semilla y cae igual.
    assert.equal(r.ok, false, `debería rechazar ${JSON.stringify(basura)}`);
  }
});

// ─────────────────────────── EL BALANCE ───────────────────────────

const p = (won: boolean, home: number, away: number): CoachMatchRow => ({
  id: Math.random().toString(36), seed: 1, teamName: "a", rivalName: "b", difficulty: "normal",
  mapId: "ascent", mapSite: "A", startSide: "ATK",
  scoreHome: home, scoreAway: away, won, rounds: home + away,
  durationSeconds: null, mvp: null, finishedAt: "2026-09-10T00:00:00Z",
});

test("sin partidos, el balance está a cero y la racha no existe", () => {
  const t = trayectoria([]);
  assert.deepEqual(t, { jugados: 0, ganados: 0, perdidos: 0, diferencialRondas: 0, racha: 0 });
});

test("el balance cuenta victorias y derrotas", () => {
  const t = trayectoria([p(true, 13, 9), p(false, 7, 13), p(true, 13, 11)]);
  assert.equal(t.jugados, 3);
  assert.equal(t.ganados, 2);
  assert.equal(t.perdidos, 1);
});

test("el diferencial de rondas suma lo ganado menos lo perdido", () => {
  const t = trayectoria([p(true, 13, 9), p(false, 7, 13)]);
  assert.equal(t.diferencialRondas, (13 - 9) + (7 - 13));
});

test("la racha se cuenta desde el partido MÁS RECIENTE y se corta al cambiar", () => {
  // La lista llega del más reciente al más antiguo, que es como se lee una racha.
  assert.equal(trayectoria([p(true, 13, 1), p(true, 13, 2), p(false, 1, 13)]).racha, 2);
  assert.equal(trayectoria([p(false, 1, 13), p(false, 2, 13), p(true, 13, 1)]).racha, -2);
  assert.equal(trayectoria([p(true, 13, 1)]).racha, 1);
});

test("el balance solo necesita resultado y marcador, no la fila entera", () => {
  /*
   * `balance` lee solo esas tres columnas de TODOS los partidos. Si `trayectoria` empezara a
   * depender de otra, el balance del servidor la leería vacía y fallaría en silencio: esta
   * prueba lo ata a la forma mínima.
   */
  const t = trayectoria([
    { won: true, scoreHome: 13, scoreAway: 9 },
    { won: false, scoreHome: 9, scoreAway: 13 },
  ]);
  assert.deepEqual(t, { jugados: 2, ganados: 1, perdidos: 1, diferencialRondas: 0, racha: 1 });
});

test("una racha entera no se corta a sí misma", () => {
  const cinco = [p(true, 13, 1), p(true, 13, 2), p(true, 13, 3), p(true, 13, 4), p(true, 13, 5)];
  assert.equal(trayectoria(cinco).racha, 5);
});
