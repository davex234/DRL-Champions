/**
 * PERIODICIDAD (Fase 27) — ventanas diarias/semanales puras, con reloj inyectado.
 * Tests 13–15 del brief: periodo correcto, caducidad/rotación, autoridad del tiempo del servidor.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { periodWindow, rotationDue, expiresAt, remainingLabel, isPeriodic, PERIODIC_KINDS } from "./periods";

const DAY = 86_400_000;
// 2026-09-14 es lunes. 15:30Z.
const MON = Date.UTC(2026, 8, 14, 15, 30);

test("13 · la ventana diaria es el día UTC y la semanal empieza el lunes 00:00Z", () => {
  const d = periodWindow("daily", MON)!;
  assert.equal(d.startsAt, Date.UTC(2026, 8, 14));
  assert.equal(d.endsAt, Date.UTC(2026, 8, 15));
  const w = periodWindow("weekly", MON)!;
  assert.equal(w.startsAt, Date.UTC(2026, 8, 14), "lunes");
  assert.equal(w.endsAt, Date.UTC(2026, 8, 21));
  // Un domingo cae en la semana que empezó el lunes anterior.
  const sun = periodWindow("weekly", Date.UTC(2026, 8, 20, 23, 59))!;
  assert.equal(sun.startsAt, Date.UTC(2026, 8, 14));
  assert.equal(periodWindow("seasonal", MON), null, "lo que no rota no tiene ventana");
  assert.deepEqual([...PERIODIC_KINDS], ["daily", "weekly"]);
  assert.ok(isPeriodic("daily") && !isPeriodic("progressive"));
});

test("14 · rota lo asignado en una ventana ANTERIOR; lo de hoy y lo del futuro no rota", () => {
  assert.equal(rotationDue("daily", MON - DAY, MON), true, "ayer");
  assert.equal(rotationDue("daily", Date.UTC(2026, 8, 14, 0, 1), MON), false, "hoy a las 00:01Z");
  assert.equal(rotationDue("daily", MON + 3600_000, MON), false, "reloj adelantado: no rota");
  assert.equal(rotationDue("weekly", Date.UTC(2026, 8, 13, 23, 59), MON), true, "domingo anterior");
  assert.equal(rotationDue("weekly", Date.UTC(2026, 8, 14, 0, 0), MON), false, "este lunes");
  assert.equal(rotationDue("seasonal", 0, MON), false, "de temporada nunca rota");
});

test("15 · la caducidad es el fin de la ventana de la TANDA (no de hoy) y el reloj siempre es un parámetro", () => {
  const assigned = Date.UTC(2026, 8, 10, 8, 0);
  assert.equal(expiresAt("daily", assigned), Date.UTC(2026, 8, 11));
  assert.equal(expiresAt("weekly", assigned), Date.UTC(2026, 8, 14), "la semana del 7 al 14");
  assert.equal(expiresAt("progressive", assigned), null);
  // Ninguna función lee el reloj sola: el mismo `now` da el mismo resultado.
  assert.equal(periodWindow("daily", MON)!.startsAt, periodWindow("daily", MON)!.startsAt);
});

test("formato de cuenta atrás: solo texto, nunca decide", () => {
  assert.equal(remainingLabel(MON + 5 * 3600_000 + 7 * 60_000, MON), "5 h 07 min");
  assert.equal(remainingLabel(MON + 25 * 60_000, MON), "25 min");
  assert.equal(remainingLabel(MON + 3 * DAY, MON), "3 d");
  assert.equal(remainingLabel(MON - 1, MON), "0 min");
});
