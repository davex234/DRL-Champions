/**
 * WORKER AISLADO (Fase 24.8) — pruebas 1–8 del brief: kill switch, core invocado, exit codes,
 * sin HTTP, sin secretos en el log, configuración ausente, dry run sin escrituras, una pasada.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runWorkerOnce, missingConfig, type WorkerDeps } from "./esportsAutosyncWorker";
import type { EsportsSyncRunResult, RunDeps, RunOptions } from "@/lib/esports/autosync/runner";
import { runEsportsSync } from "@/lib/esports/autosync/runner";
import { createMemoryLogger } from "@/lib/esports/autosync/log";
import { FakeDb } from "@/lib/esports/autosync/testing/fakeSupabase";

const SECRET_KEY = "service-role-key-que-no-debe-aparecer-en-ningun-log";
const ENV_ON = { ESPORTS_AUTO_SYNC_ENABLED: "true", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54521", SUPABASE_SERVICE_ROLE_KEY: SECRET_KEY };

const fakeResult = (opts: RunOptions, extra: Partial<EsportsSyncRunResult> = {}): EsportsSyncRunResult => ({
  runId: "r", mode: opts.mode, dryRun: !!opts.dryRun, startedAt: "", finishedAt: "", durationMs: 1,
  lock: { acquired: true, recoveredStale: false },
  eventsChecked: 1, eventsDue: 1, eventsSynced: 1, eventsChanged: 0, eventsFailed: 0, eventsSkipped: 0,
  matchesChecked: 0, matchesCreated: 0, matchesUpdated: 0, matchesFinished: 0, matchesRejected: 0, matchesInvalid: 0,
  bracketChanges: 0, qualificationsResolved: 0, pickemsScored: 0, pickemsCorrected: 0, usersScored: 0,
  errors: [], events: [], nextDueAt: null, health: null, ...extra,
});

function deps(env: Record<string, string | undefined>, run?: WorkerDeps["run"]) {
  const calls: { deps: RunDeps; opts: RunOptions }[] = [];
  const clients: string[] = [];
  const logger = createMemoryLogger("[w]");
  const d: WorkerDeps = {
    env, logger, hostname: "vps-test", pid: 42,
    createClient: (url) => { clients.push(url); return {} as SupabaseClient; },
    run: run ?? (async (rd, ro) => { calls.push({ deps: rd, opts: ro }); return fakeResult(ro); }),
  };
  return { d, calls, clients, logger };
}

test("1 · kill switch false → exit 0 limpio: sin cliente, sin core, sin fetch", async () => {
  const { d, calls, clients, logger } = deps({ ...ENV_ON, ESPORTS_AUTO_SYNC_ENABLED: "false" });
  const out = await runWorkerOnce({}, d);
  assert.equal(out.exitCode, 0);
  assert.match(out.reason, /kill switch OFF/);
  assert.equal(calls.length, 0);
  assert.equal(clients.length, 0);
  assert.ok(logger.lines.some((l) => l.includes("event=kill_switch_off")));
  // Sin la variable siquiera definida, igual.
  const { d: d2, calls: c2 } = deps({ NEXT_PUBLIC_SUPABASE_URL: ENV_ON.NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: SECRET_KEY });
  assert.equal((await runWorkerOnce({}, d2)).exitCode, 0);
  assert.equal(c2.length, 0);
});

test("2 · kill switch true → invoca el core en modo scheduled con origen worker-vps", async () => {
  const { d, calls, clients } = deps(ENV_ON);
  const out = await runWorkerOnce({}, d);
  assert.equal(out.exitCode, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].opts.mode, "scheduled");
  assert.equal(calls[0].opts.dryRun, false);
  assert.equal(calls[0].deps.origin, "worker-vps");
  assert.ok(calls[0].deps.cfg.enabled);
  assert.deepEqual(clients, ["http://127.0.0.1:54521"], "conexión local, sin IP pública");
});

test("3 · error fatal del core → exit distinto de 0 (1); evento con error → 1", async () => {
  const boom = deps(ENV_ON, async () => { throw new Error("connection reset"); });
  const out = await boom.d && await runWorkerOnce({}, boom.d);
  assert.equal(out.exitCode, 1);
  const withErrors = deps(ENV_ON, async (_r, o) => fakeResult(o, { errors: ["SYNC_FAILED: x"], eventsFailed: 1 }));
  assert.equal((await runWorkerOnce({}, withErrors.d)).exitCode, 1);
  // Noops válidos → 0: lock ocupado, nada toca.
  const locked = deps(ENV_ON, async (_r, o) => fakeResult(o, { skipped: "locked", lock: { acquired: false, recoveredStale: false } }));
  assert.equal((await runWorkerOnce({}, locked.d)).exitCode, 0);
  const nothingDue = deps(ENV_ON, async (_r, o) => fakeResult(o, { eventsDue: 0, eventsSynced: 0 }));
  const nd = await runWorkerOnce({}, nothingDue.d);
  assert.equal(nd.exitCode, 0);
  assert.match(nd.reason, /ningún evento toca/);
});

test("4 · el worker no levanta ningún servidor HTTP ni depende de Next", () => {
  const src = readFileSync(new URL("./esportsAutosyncWorker.ts", import.meta.url), "utf8");
  const script = readFileSync(new URL("../../../scripts/esports-autosync-worker.ts", import.meta.url), "utf8");
  for (const s of [src, script]) {
    assert.ok(!/\.listen\(|createServer|from "http"|from "next|next\/server|react/i.test(s));
  }
  assert.ok(/process\.exit\(/.test(script), "el script termina el proceso: una pasada y fuera");
  assert.ok(!/--loop/.test(script), "sin bucle: el timer/cron decide cuándo");
});

test("5 · ningún secreto llega al log ni al resultado", async () => {
  const { d, logger } = deps(ENV_ON);
  const out = await runWorkerOnce({}, d);
  const text = logger.lines.join("\n") + JSON.stringify(out);
  assert.ok(!text.includes(SECRET_KEY));
  const { d: d2, logger: l2 } = deps({ ESPORTS_AUTO_SYNC_ENABLED: "true", SUPABASE_SERVICE_ROLE_KEY: SECRET_KEY });
  await runWorkerOnce({}, d2);
  assert.ok(!l2.lines.join("\n").includes(SECRET_KEY));
});

test("6 · configuración ausente → falla cerrado con exit 2, sin cliente ni core; solo se nombran las claves", async () => {
  assert.deepEqual(missingConfig({}), ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]);
  const { d, calls, clients, logger } = deps({ ESPORTS_AUTO_SYNC_ENABLED: "true" });
  const out = await runWorkerOnce({}, d);
  assert.equal(out.exitCode, 2);
  assert.equal(calls.length, 0);
  assert.equal(clients.length, 0);
  assert.ok(logger.lines.some((l) => l.includes("event=config_missing") && l.includes("NEXT_PUBLIC_SUPABASE_URL")));
  const bad = deps({ ...ENV_ON, NEXT_PUBLIC_SUPABASE_URL: "no es una url" });
  assert.equal((await runWorkerOnce({}, bad.d)).exitCode, 2);
});

test("7 · dry run con el core real y la BD en memoria: cero escrituras, y no exige kill switch ON", async () => {
  const db = new FakeDb();
  db.seed("events", [{ id: "vlr-1", name: "QA SYNTHETIC", status: "upcoming", source: "vlr", vlr_url: "https://www.vlr.gg/event/1", start_date: "2027-01-10T00:00:00Z" }]);
  const sb = db.client();
  const d: WorkerDeps = {
    env: { ...ENV_ON, ESPORTS_AUTO_SYNC_ENABLED: "false" }, logger: createMemoryLogger(), createClient: () => sb,
    run: (rd, ro) => runEsportsSync({ ...rd, fetchSnapshot: async () => { throw new Error("VLR HTTP 503 — x"); } }, ro),
  };
  const out = await runWorkerOnce({ dryRun: true, force: true }, d);
  assert.equal(db.writes.length, 0);
  assert.equal(db.rpcCalls.length, 0);
  assert.equal(out.result?.dryRun, true);
  assert.equal(out.result?.lock.acquired, false);
});

test("8 · el worker hace UNA pasada y devuelve: el core se llama exactamente una vez", async () => {
  const { d, calls } = deps(ENV_ON);
  await runWorkerOnce({}, d);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(calls.length, 1);
});
