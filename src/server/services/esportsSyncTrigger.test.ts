/**
 * TRIGGER INTERNO DEL SYNC (Fase 24.6) — pruebas 37–43 del brief: auth, no-URLs, secreto no
 * devuelto, kill switch. Sin Next y sin base de datos: el `run` es de mentira.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { handleSyncTrigger, type TriggerDeps } from "./esportsSyncTrigger";
import type { EsportsSyncRunResult, RunOptions } from "@/lib/esports/autosync/runner";

const SECRET = "secreto-de-prueba-suficientemente-largo";
const fakeSb = {} as SupabaseClient;

const fakeResult = (opts: RunOptions): EsportsSyncRunResult => ({
  runId: "r1", mode: opts.mode, dryRun: !!opts.dryRun, startedAt: "", finishedAt: "", durationMs: 1,
  lock: { acquired: !opts.dryRun, recoveredStale: false },
  eventsChecked: 0, eventsDue: 0, eventsSynced: 0, eventsChanged: 0, eventsFailed: 0, eventsSkipped: 0,
  matchesChecked: 0, matchesCreated: 0, matchesUpdated: 0, matchesFinished: 0, matchesRejected: 0, matchesInvalid: 0,
  bracketChanges: 0, qualificationsResolved: 0, pickemsScored: 0, pickemsCorrected: 0, usersScored: 0,
  errors: [], events: [], nextDueAt: null, health: null,
});

function deps(env: Record<string, string | undefined>, sb: SupabaseClient | null = fakeSb) {
  const calls: RunOptions[] = [];
  const d: TriggerDeps = { env, sb, run: async (_deps, opts) => { calls.push(opts); return fakeResult(opts); }, logger: { info() {}, warn() {}, error() {} } };
  return { d, calls };
}

const post = (headers: Record<string, string>, body?: unknown): Request =>
  new Request("http://nexus.local/api/internal/esports/sync", {
    method: "POST", headers, body: body === undefined ? undefined : JSON.stringify(body),
  });

test("37 · sin credencial → 401 y NO se ejecuta nada", async () => {
  const { d, calls } = deps({ SYNC_SECRET: SECRET, ESPORTS_AUTO_SYNC_ENABLED: "true" });
  const res = await handleSyncTrigger(post({}), d);
  assert.equal(res.status, 401);
  assert.equal(calls.length, 0);
});

test("38 · credencial incorrecta → 401 (Bearer y x-sync-secret), sin ejecutar", async () => {
  const { d, calls } = deps({ SYNC_SECRET: SECRET, ESPORTS_AUTO_SYNC_ENABLED: "true" });
  assert.equal((await handleSyncTrigger(post({ authorization: `Bearer ${SECRET}x` }), d)).status, 401);
  assert.equal((await handleSyncTrigger(post({ authorization: "Bearer " }), d)).status, 401);
  assert.equal((await handleSyncTrigger(post({ "x-sync-secret": "otra-cosa-igual-de-larga-pero-mal" }), d)).status, 401);
  assert.equal(calls.length, 0);
});

test("39 · credencial interna válida → ejecuta en modo scheduled y devuelve el resultado", async () => {
  const { d, calls } = deps({ SYNC_SECRET: SECRET, ESPORTS_AUTO_SYNC_ENABLED: "true" });
  const res = await handleSyncTrigger(post({ authorization: `Bearer ${SECRET}` }, { eventIds: ["vlr-2766"] }), d);
  assert.equal(res.status, 200);
  const body = await res.json() as { enabled: boolean; result: EsportsSyncRunResult };
  assert.equal(body.enabled, true);
  assert.equal(body.result.mode, "scheduled");
  assert.deepEqual(calls[0].eventIds, ["vlr-2766"]);
  // También con la cabecera heredada de /api/esports/sync.
  assert.equal((await handleSyncTrigger(post({ "x-sync-secret": SECRET }), d)).status, 200);
});

test("40 · un cuerpo con URL (o targets/source) → 400: la fuente la decide el servidor", async () => {
  const { d, calls } = deps({ SYNC_SECRET: SECRET, ESPORTS_AUTO_SYNC_ENABLED: "true" });
  for (const body of [{ url: "https://cualquier-sitio.com" }, { targets: [{ url: "x" }] }, { source: "https://x" }]) {
    const res = await handleSyncTrigger(post({ authorization: `Bearer ${SECRET}` }, body), d);
    assert.equal(res.status, 400);
  }
  assert.equal(calls.length, 0);
});

test("41 · ids de evento con forma rara se rechazan (sin llegar al core)", async () => {
  const { d, calls } = deps({ SYNC_SECRET: SECRET, ESPORTS_AUTO_SYNC_ENABLED: "true" });
  for (const ids of [["../x"], ["a b"], [""], ["x".repeat(65)], Array.from({ length: 21 }, (_, i) => `e${i}`), "vlr-2766"]) {
    const res = await handleSyncTrigger(post({ authorization: `Bearer ${SECRET}` }, { eventIds: ids }), d);
    assert.equal(res.status, 400, JSON.stringify(ids).slice(0, 40));
  }
  assert.equal(calls.length, 0);
});

test("42 · la respuesta nunca contiene el secreto ni variables de entorno", async () => {
  const { d } = deps({ SYNC_SECRET: SECRET, ESPORTS_AUTO_SYNC_ENABLED: "true", SUPABASE_SERVICE_ROLE_KEY: "clave-service-role-que-no-debe-salir" });
  for (const headers of [{}, { authorization: "Bearer mal" }, { authorization: `Bearer ${SECRET}` }] as Record<string, string>[]) {
    const text = await (await handleSyncTrigger(post(headers), d)).text();
    assert.ok(!text.includes(SECRET) && !text.includes("clave-service-role"), text);
  }
});

test("43 · scheduler desactivado: responde skipped=disabled sin ejecutar; el modo manual sí ejecuta", async () => {
  const { d, calls } = deps({ SYNC_SECRET: SECRET });
  const res = await handleSyncTrigger(post({ authorization: `Bearer ${SECRET}` }), d);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { skipped: "disabled", enabled: false, mode: "scheduled", dryRun: false });
  assert.equal(calls.length, 0);
  const manual = await handleSyncTrigger(post({ authorization: `Bearer ${SECRET}` }, { mode: "manual", dryRun: true }), d);
  assert.equal(manual.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].mode, "manual");
  assert.equal(calls[0].dryRun, true);
});

test("29 · fail closed: sin secreto configurado el trigger responde 503 aunque el scheduler esté ON", async () => {
  const { d, calls } = deps({ ESPORTS_AUTO_SYNC_ENABLED: "true" });
  assert.equal((await handleSyncTrigger(post({ authorization: "Bearer lo-que-sea-suficientemente-largo" }), d)).status, 503);
  assert.equal(calls.length, 0);
  // Y sin Supabase admin, 503 (con credencial válida).
  const { d: d2, calls: c2 } = deps({ SYNC_SECRET: SECRET, ESPORTS_AUTO_SYNC_ENABLED: "true" }, null);
  assert.equal((await handleSyncTrigger(post({ authorization: `Bearer ${SECRET}` }), d2)).status, 503);
  assert.equal(c2.length, 0);
});

test("contrato · la ruta solo cablea: no lee el cuerpo ni decide auth por su cuenta", () => {
  const route = readFileSync(new URL("../../app/api/internal/esports/sync/route.ts", import.meta.url), "utf8");
  assert.match(route, /handleSyncTrigger\(req, \{ env: process\.env, sb: getSupabaseAdmin\(\), run: runEsportsSync \}\)/);
  assert.ok(!/NEXT_PUBLIC/.test(route), "ningún secreto público");
  assert.ok(!/req\.json\(\)/.test(route), "la ruta no parsea el cuerpo");
});
