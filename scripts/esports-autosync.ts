/**
 * ESPORTS AUTO-SYNC · ENTRYPOINT PARA CRON / SYSTEMD TIMER (Fase 24.6) — `npm run esports:autosync`
 *
 *   npm run esports:autosync                       → una pasada SCHEDULED (exige ESPORTS_AUTO_SYNC_ENABLED=true)
 *   npm run esports:autosync -- --dry-run          → una pasada DRY RUN (no escribe nada; no exige activación)
 *   npm run esports:autosync -- --manual           → una pasada MANUAL (operador; ignora el kill switch)
 *   npm run esports:autosync -- --event <id>       → solo ese evento de NEXUS (repetible)
 *   npm run esports:autosync -- --force            → ignora «¿toca ahora?» de la política
 *   npm run esports:autosync -- --no-pickems       → sin ciclo de Pick'ems
 *   npm run esports:autosync -- --loop             → bucle: pasada → dormir hasta la siguiente → repetir
 *   npm run esports:autosync -- --json             → resultado en JSON (para logs de máquina)
 *
 * NO acepta URLs. Los eventos se descubren en la base de datos (`events.source='vlr'` +
 * `events.vlr_url` o id de VLR). Para sincronizar a mano una URL concreta existe `npm run vlr:sync`,
 * que también pasa por el mismo core.
 *
 * Falla CERRADO: sin `ESPORTS_AUTO_SYNC_ENABLED=true` la pasada scheduled termina con
 * `skipped: disabled` y código 0 (el timer puede seguir programado sin efecto). Sin Supabase,
 * código 2.
 */
import { existsSync, readFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { getEsportsAutoSyncConfig } from "@/lib/esports/autosync/config";
import { runEsportsSync, type EsportsSyncRunResult } from "@/lib/esports/autosync/runner";
import { formatRunReport } from "@/lib/esports/autosync/report";
import { createConsoleLogger } from "@/lib/esports/autosync/log";

const ROOT = process.cwd();
for (const f of [".env.local", ".env"]) {
  const p = join(ROOT, f);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const args = process.argv.slice(2);
const has = (f: string): boolean => args.includes(f);
const valuesOf = (f: string): string[] => args.flatMap((a, i) => (a === f && args[i + 1] ? [args[i + 1]] : []));

const dryRun = has("--dry-run");
const manual = has("--manual");
const force = has("--force");
const loop = has("--loop");
const asJson = has("--json");
const pickems = !has("--no-pickems");
const eventIds = valuesOf("--event");

const EVENT_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._-]|:){0,63}$/;
for (const id of eventIds) {
  if (!EVENT_ID.test(id)) { console.error(`--event inválido: ${id}`); process.exit(2); }
}
if (args.some((a) => /^https?:\/\//i.test(a) || a === "--url")) {
  console.error("Este entrypoint no acepta URLs. Usa `npm run vlr:sync -- <url> --event <id>` para una URL concreta.");
  process.exit(2);
}

const cfg = getEsportsAutoSyncConfig(process.env);
const mode = manual ? "manual" : "scheduled";
const logger = createConsoleLogger();

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !SERVICE) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY (solo servidor).");
  process.exit(2);
}
const sb = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const owner = `${hostname()}:${process.pid}`;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
let stop = false;
process.on("SIGINT", () => { stop = true; });
process.on("SIGTERM", () => { stop = true; });

async function once(): Promise<EsportsSyncRunResult> {
  const r = await runEsportsSync(
    { sb, cfg, logger, owner: `${owner}:${Date.now()}` },
    { mode, dryRun, force: force || undefined, pickems, eventIds: eventIds.length ? eventIds : undefined },
  );
  if (asJson) console.log(JSON.stringify(r));
  else console.log(formatRunReport(r));
  return r;
}

async function main(): Promise<void> {
  if (!dryRun && mode === "scheduled" && !cfg.enabled) {
    console.log("[esports-sync] kill switch OFF (ESPORTS_AUTO_SYNC_ENABLED != true): no se ejecuta nada.");
  }
  let exit = 0;
  do {
    const r = await once();
    exit = r.errors.length > 0 && !r.skipped ? 1 : 0;
    if (!loop || stop) break;
    const nextAt = r.nextDueAt ? Date.parse(r.nextDueAt) : NaN;
    const wait = Number.isFinite(nextAt) ? Math.min(30 * 60_000, Math.max(30_000, nextAt - Date.now())) : 5 * 60_000;
    logger.info("sleep", { ms: wait, next_due: r.nextDueAt });
    await sleep(wait);
  } while (!stop);
  process.exitCode = exit;
}

main().catch((e) => { console.error(e); process.exit(1); });
