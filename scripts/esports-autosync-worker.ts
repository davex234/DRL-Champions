/**
 * ESPORTS AUTO-SYNC · WORKER ONESHOT (Fase 24.8) — el entrypoint que ejecuta el timer/cron del VPS.
 *
 *   node dist/worker.cjs                → una pasada SCHEDULED (respeta ESPORTS_AUTO_SYNC_ENABLED)
 *   node dist/worker.cjs --dry-run      → una pasada DRY RUN (cero escrituras; no exige activación)
 *   node dist/worker.cjs --manual       → una pasada MANUAL (operador; ignora el kill switch)
 *   node dist/worker.cjs --force        → ignora «¿toca ahora?» de la política
 *   node dist/worker.cjs --json         → resultado en JSON en stdout
 *
 * La configuración llega SOLO por variables de entorno (EnvironmentFile del servicio o el fichero
 * de entorno del cron): no lee `.env.local`, no acepta URLs ni secretos por argumento. Una pasada y
 * `process.exit` con 0 (ok/noop), 1 (fallo real) o 2 (configuración ausente: falla cerrado).
 */
import { hostname } from "node:os";
import { createClient } from "@supabase/supabase-js";
import { runEsportsSync } from "@/lib/esports/autosync/runner";
import { formatRunReport } from "@/lib/esports/autosync/report";
import { createConsoleLogger } from "@/lib/esports/autosync/log";
import { runWorkerOnce } from "@/server/worker/esportsAutosyncWorker";

const args = process.argv.slice(2);
const has = (f: string): boolean => args.includes(f);
if (args.some((a) => /^https?:\/\//i.test(a) || a.includes("="))) {
  console.error("[esports-sync-worker] este entrypoint no acepta URLs ni pares clave=valor por argumento");
  process.exit(2);
}

const opts = {
  mode: has("--manual") ? ("manual" as const) : ("scheduled" as const),
  dryRun: has("--dry-run"),
  force: has("--force"),
  origin: process.env.ESPORTS_SYNC_ORIGIN?.trim() || `worker-${hostname()}`,
};

runWorkerOnce(opts, {
  env: process.env,
  run: runEsportsSync,
  createClient: (url, key) => createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }),
  logger: createConsoleLogger("[esports-sync-worker]"),
  hostname: hostname(),
  pid: process.pid,
}).then((out) => {
  if (out.result) console.log(has("--json") ? JSON.stringify(out.result) : formatRunReport(out.result));
  console.log(`[esports-sync-worker] exit=${out.exitCode} reason=${JSON.stringify(out.reason)}`);
  process.exit(out.exitCode);
}).catch((e) => {
  console.error("[esports-sync-worker] fallo inesperado:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
