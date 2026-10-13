/**
 * TELEMETRÍA DE PICK'EMS (Fase 24.2) — encaja en el contrato existente sin ampliarlo.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PICKEM_ACTIONS, trackPickem, __resetPickemTelemetryForTests } from "./pickems";
import { FLOWS, METADATA_WHITELIST, sanitizeMetadata } from "./contract";

const SRC = readFileSync(new URL("./pickems.ts", import.meta.url), "utf8");

test("las seis acciones mínimas del brief existen", () => {
  assert.deepEqual([...PICKEM_ACTIONS], [
    "pickem_viewed", "pickem_prediction_saved", "pickem_prediction_changed",
    "pickem_locked_seen", "pickem_result_seen", "pickem_leaderboard_seen",
  ]);
});

test("viajan por el flujo `pickem_form` ya contratado, como `context` de `flow_started` (lista blanca)", () => {
  assert.ok((FLOWS as readonly string[]).includes("pickem_form"));
  assert.ok(METADATA_WHITELIST.flow_started.includes("context"));
  assert.match(SRC, /trackFlow\("pickem_form", action\)/);
  const out = sanitizeMetadata("flow_started", { flow: "pickem_form", context: "pickem_prediction_saved" });
  assert.equal(out.context, "pickem_prediction_saved", "el contexto sobrevive al saneado del servidor");
});

test("no manda identificadores ni datos sensibles y nunca lanza (fuera del navegador es un no-op)", () => {
  assert.ok(!/userId|user_id|questionId|pickemEventId|email/.test(SRC.replace(/\/\*[\s\S]*?\*\//g, "")));
  __resetPickemTelemetryForTests();
  assert.doesNotThrow(() => trackPickem("pickem_viewed", { once: "e1" }));
  assert.doesNotThrow(() => trackPickem("pickem_viewed", { once: "e1" }));
});
