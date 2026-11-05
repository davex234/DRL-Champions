/** F66 · entrada con `?buscar=`: nunca se le quita a nadie una partida viva. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { autoSearchDecision } from "./autoSearch";

test("F66 · F5 con la partida recién emparejada: se RETOMA, no se vuelve a encolar", () => {
  assert.equal(autoSearchDecision({ phase: "matched", deckValid: true, matchedLifecycle: "IN_TURN" }), "resume");
  assert.equal(autoSearchDecision({ phase: "matched", deckValid: true, matchedLifecycle: "CREATED" }), "resume");
});

test("F66 · la entrada MATCHED apunta a una partida terminada: se busca otra", () => {
  for (const l of ["FINISHED", "ABANDONED", "EXPIRED", null]) assert.equal(autoSearchDecision({ phase: "matched", deckValid: true, matchedLifecycle: l }), "requeue");
  assert.equal(autoSearchDecision({ phase: "matched", deckValid: false, matchedLifecycle: "FINISHED" }), "none");
});

test("F66 · ya buscando, cargando o con error: no se toca la cola", () => {
  for (const phase of ["queued", "loading", "error", "closed"] as const) assert.equal(autoSearchDecision({ phase, deckValid: true, matchedLifecycle: null }), "none");
  assert.equal(autoSearchDecision({ phase: "idle", deckValid: true, matchedLifecycle: null }), "enqueue");
  assert.equal(autoSearchDecision({ phase: "idle", deckValid: false, matchedLifecycle: null }), "none");
});

test("F66 · la página usa la decisión (no vuelve a marcar como vista una partida sin mirar si sigue viva)", () => {
  const page = readFileSync("src/app/duelos/pvp/page.tsx", "utf8");
  assert.match(page, /autoSearchDecision\(/);
  assert.doesNotMatch(page, /if \(cola\.phase === "matched" && cola\.matchId\) setVisto\(cola\.matchId\);/);
  // La orden `?buscar=` se consume una vez: la URL se limpia de verdad (una recarga posterior no vuelve a encolar).
  assert.match(page, /await Promise\.resolve\(\);\s*window\.history\.replaceState\(window\.history\.state, "", "\/duelos\/pvp"\);/);
});
