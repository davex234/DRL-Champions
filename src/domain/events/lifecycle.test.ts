import test from "node:test";
import assert from "node:assert/strict";
import {
  eventPhase, canClaimInPhase, isRunning, claimClosesAt, msUntilNextPhase,
  ENDING_WINDOW_HOURS, CLAIM_GRACE_DAYS, CLAIMABLE_PHASES, PHASE_LABEL,
} from "./lifecycle";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 8, 2, 12, 0, 0);
const iso = (ms: number) => new Date(ms).toISOString();

/** Un evento con la ventana declarada respecto a `NOW`. */
const ev = (startOffset: number, endOffset: number, status = "ongoing") => ({
  status, startDate: iso(NOW + startOffset), endDate: iso(NOW + endOffset),
});

test("las cinco fases salen de las fechas", () => {
  assert.equal(eventPhase(ev(2 * DAY, 10 * DAY), NOW), "upcoming");
  assert.equal(eventPhase(ev(-2 * DAY, 10 * DAY), NOW), "live");
  assert.equal(eventPhase(ev(-10 * DAY, 12 * HOUR), NOW), "ending");
  assert.equal(eventPhase(ev(-20 * DAY, -1 * DAY), NOW), "completed");
  assert.equal(eventPhase(ev(-90 * DAY, -(CLAIM_GRACE_DAYS + 1) * DAY), NOW), "archived");
});

test("la frontera de ENDING es exactamente la ventana declarada", () => {
  // Justo fuera de la ventana sigue siendo `live`; justo dentro pasa a `ending`.
  assert.equal(eventPhase(ev(-DAY, (ENDING_WINDOW_HOURS + 1) * HOUR), NOW), "live");
  assert.equal(eventPhase(ev(-DAY, (ENDING_WINDOW_HOURS - 1) * HOUR), NOW), "ending");
});

test("LA FECHA MANDA SOBRE EL ESTADO", () => {
  /*
   * Es la invariante que impide que un torneo terminado siga pagando. `status` lo escribe
   * la sincronización y puede ir rezagado; `end_date` es un hecho. Un evento marcado
   * `ongoing` cuya fecha de fin ya pasó está TERMINADO.
   */
  assert.equal(eventPhase(ev(-30 * DAY, -2 * DAY, "ongoing"), NOW), "completed");
  // Y al revés: marcado como terminado pero todavía en fecha, sigue vivo.
  assert.equal(eventPhase(ev(-DAY, 5 * DAY, "completed"), NOW), "live");
});

test("sin fechas se cae al estado, que es lo unico que queda", () => {
  assert.equal(eventPhase({ status: "upcoming", startDate: null, endDate: null }, NOW), "upcoming");
  assert.equal(eventPhase({ status: "completed", startDate: null, endDate: null }, NOW), "completed");
  assert.equal(eventPhase({ status: "ongoing", startDate: null, endDate: null }, NOW), "live");
  assert.equal(eventPhase({ status: null, startDate: null, endDate: null }, NOW), "live");
});

test("un evento ARCHIVADO no deja cobrar nada", () => {
  assert.equal(canClaimInPhase("archived"), false);
  assert.ok(!CLAIMABLE_PHASES.includes("archived"));
});

test("el plazo de gracia deja cobrar despues del final, pero no para siempre", () => {
  /*
   * El motivo está en la cabecera del módulo: los puntos de un Pick'em se corrigen al
   * TERMINAR el torneo, así que cerrar la puerta en el pitido final dejaría sin cobrar a
   * quien ganó el desafío. El plazo es una concesión medida, no una puerta abierta.
   */
  const justEnded = ev(-30 * DAY, -HOUR);
  assert.equal(eventPhase(justEnded, NOW), "completed");
  assert.equal(canClaimInPhase(eventPhase(justEnded, NOW)), true);

  const longGone = ev(-90 * DAY, -(CLAIM_GRACE_DAYS * DAY + HOUR));
  assert.equal(canClaimInPhase(eventPhase(longGone, NOW)), false);
});

test("un evento terminado ya no admite participacion nueva", () => {
  assert.equal(isRunning("live"), true);
  assert.equal(isRunning("ending"), true);
  assert.equal(isRunning("completed"), false);
  assert.equal(isRunning("upcoming"), false);
});

test("el cierre de la ventana es el final mas el plazo", () => {
  const e = ev(-10 * DAY, 3 * DAY);
  assert.equal(claimClosesAt(e), NOW + 3 * DAY + CLAIM_GRACE_DAYS * DAY);
  // Sin fecha de fin no hay cierre calculable, y se dice en vez de inventarlo.
  assert.equal(claimClosesAt({ status: "ongoing", startDate: iso(NOW), endDate: null }), null);
});

test("el contador cuenta lo que corresponde a cada fase", () => {
  // Próximamente cuenta hasta el inicio.
  assert.equal(msUntilNextPhase(ev(3 * DAY, 20 * DAY), NOW), 3 * DAY);
  // En directo cuenta hasta que entre en ENDING, no hasta el final.
  assert.equal(msUntilNextPhase(ev(-DAY, 10 * DAY), NOW), 10 * DAY - ENDING_WINDOW_HOURS * HOUR);
  // A punto de terminar cuenta hasta el final.
  assert.equal(msUntilNextPhase(ev(-DAY, 6 * HOUR), NOW), 6 * HOUR);
  // Terminado cuenta lo que queda de plazo para cobrar.
  assert.equal(msUntilNextPhase(ev(-30 * DAY, -DAY), NOW), CLAIM_GRACE_DAYS * DAY - DAY);
});

test("una fecha corrupta no rompe el calculo", () => {
  // La sincronización trae datos de fuera; una fecha ilegible no puede tumbar el evento.
  const phase = eventPhase({ status: "ongoing", startDate: "no-es-una-fecha", endDate: "tampoco" }, NOW);
  assert.ok(PHASE_LABEL[phase]);
});
