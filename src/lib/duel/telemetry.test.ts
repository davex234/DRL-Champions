/**
 * TELEMETRÍA DEL DUELO (Fase 26) — `lib/duel/telemetry`.
 *
 * Lo que se afirma: los siete momentos existen y se llaman como pide el brief; NO se inventa
 * ningún evento ni flujo (la taxonomía sigue cerrada: 4 eventos, 4 flujos, CHECK 0029); y mientras
 * el contrato no admita un flujo de duelo, emitir es un no-op que nunca lanza.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { DUEL_CONTEXTS, DUEL_FLOW, duelFlow, trackDuel } from "./telemetry";
import { EVENT_NAMES, FLOWS, CRITICAL_FLOWS, isFlow } from "@/lib/telemetry/contract";

test("1 · los siete momentos del duelo, en el orden del bucle", () => {
  assert.deepEqual([...DUEL_CONTEXTS], [
    "match_start", "card_selected", "card_locked", "round_resolved", "match_completed", "rematch", "reconnect",
  ]);
});

test("2 · no se inventa taxonomía: 4 eventos y 4 flujos, los de la migración 0029", () => {
  assert.equal(EVENT_NAMES.length, 4);
  assert.equal(FLOWS.length, 4);
  assert.deepEqual([...FLOWS], ["deck_builder", "pack_ceremony", "pickem_form", "market_listing_form"]);
});

test("3 · el flujo del duelo coincide con el flujo crítico `duel_play` y hoy NO está en el contrato", () => {
  assert.equal(DUEL_FLOW, "duel_play");
  assert.ok((CRITICAL_FLOWS as readonly string[]).includes(DUEL_FLOW), "es un flujo crítico conocido");
  assert.equal(isFlow(DUEL_FLOW), false, "la taxonomía cerrada no lo admite (deuda: migración)");
  assert.equal(duelFlow(), null);
});

test("4 · emitir sin flujo admitido es un no-op honesto: no lanza, no falsea con otro flujo", () => {
  for (const c of DUEL_CONTEXTS) assert.doesNotThrow(() => trackDuel(c));
});
