/**
 * COLECCIONES POR EQUIPO · la liquidación (primera compleción, sus 300 XP, XP pendientes e insignias) no depende de entrar
 * en Colecciones: cada sincronización con el servidor la pide en segundo plano, como mucho una vez por minuto.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { COLLECTION_SETTLE_EVERY_MS, resetCollectionSettleThrottle, settleCollectionsInBackground } from "./sync";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

test("LIQUIDACIÓN EN SEGUNDO PLANO · una vez por minuto, nunca más", () => {
  resetCollectionSettleThrottle();
  let calls = 0;
  const settle = async () => { calls++; };
  const t0 = 1_000_000;
  assert.equal(settleCollectionsInBackground(settle, t0), true);
  assert.equal(settleCollectionsInBackground(settle, t0 + 1_000), false);
  assert.equal(settleCollectionsInBackground(settle, t0 + COLLECTION_SETTLE_EVERY_MS - 1), false);
  assert.equal(settleCollectionsInBackground(settle, t0 + COLLECTION_SETTLE_EVERY_MS), true);
  assert.equal(calls, 2);
  assert.ok(COLLECTION_SETTLE_EVERY_MS <= 60_000, "cabe de sobra en el límite collection_write (40/min)");
});

test("LIQUIDACIÓN EN SEGUNDO PLANO · un fallo (sin 0075, 429, red) no rompe la sincronización ni se propaga", async () => {
  resetCollectionSettleThrottle();
  let rejected = false;
  const settle = () => Promise.reject(new Error("503 NOT_READY")).finally(() => { rejected = true; });
  assert.doesNotThrow(() => settleCollectionsInBackground(settle, 5_000_000));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(rejected, true);
});

test("LIQUIDACIÓN EN SEGUNDO PLANO · la pide syncFromServer tras volcar un estado con sesión, y el cliente no manda datos", () => {
  const sync = read("src/lib/game/sync.ts");
  const body = sync.slice(sync.indexOf("export async function syncFromServer"), sync.indexOf("export async function hydrateAccount"));
  assert.match(body, /if \(!state\) return false;[\s\S]*applyServerState[\s\S]*settleCollectionsInBackground\(\);\s*return true;/, "solo con sesión y después del estado");
  const client = read("src/lib/teamCollections/client.ts");
  assert.match(client, /settleTeamCollections = \(\): Promise<SettleView> => call\("\/api\/game\/team-collections", \{ action: "settle" \}\)/, "el cuerpo es solo la acción");
  // Colecciones sigue liquidando al entrar (y enseña el aviso); esto es el respaldo para quien no entra.
  assert.match(read("src/app/coleccion/trofeos/page.tsx"), /settleTeamCollections\(\)/);
});
