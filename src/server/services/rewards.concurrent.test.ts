/**
 * F73 final · RECLAMOS SIMULTÁNEOS: `app_grant_reward` puede chocar con `credit_tx_ref_uniq` (UNIQUE (user_id, ref))
 * cuando dos peticiones del MISMO usuario con la MISMA ref pasan a la vez su comprobación previa. Medido en producción:
 * 10 reclamos simultáneos de una misión → 1 recompensa (correcto) pero 1 × 500. Ese choque es un reintento, no un fallo.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { award } from "./rewards";

const fake = (error: { code: string; message: string } | null, data: unknown = { applied: true, credits: 10, cardUids: [] }) =>
  ({ rpc: async () => ({ data: error ? null : data, error }) }) as unknown as SupabaseClient;
const input = { userId: "aaaaaaaa-0000-4000-8000-000000000001", ref: "m73:mission:qa", reason: "t", reward: { xp: 10 } };

test("award · el choque con credit_tx_ref_uniq (mismo usuario y ref) es un reintento: applied=false, sin lanzar", async () => {
  const out = await award(fake({ code: "23505", message: 'duplicate key value violates unique constraint "credit_tx_ref_uniq"' }), input);
  assert.equal(out.applied, false);
  assert.deepEqual(out.cardUids, []);
});

test("award · cualquier OTRO error sigue lanzando (no se tapan fallos reales)", async () => {
  await assert.rejects(award(fake({ code: "23505", message: 'duplicate key value violates unique constraint "otra_cosa"' }), input));
  await assert.rejects(award(fake({ code: "P0001", message: "saldo insuficiente" }), input));
});

test("award · sin error, el resultado de la RPC se devuelve igual que antes", async () => {
  const out = await award(fake(null), input);
  assert.equal(out.applied, true);
  assert.equal(out.credits, 10);
});
