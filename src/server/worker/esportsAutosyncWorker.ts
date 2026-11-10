/**
 * WORKER AISLADO DEL SYNC ESPORTS (Fase 24.8, SOLO SERVIDOR, SIN NEXT).
 *
 *   cron / timer  →  scripts/esports-autosync-worker.ts  →  runWorkerOnce()  →  runEsportsSync()  →  Supabase local
 *
 * Una pasada y salir. Sin servidor HTTP, sin frontend, sin proceso vivo. El worker no decide nada
 * del dominio: comprueba el kill switch, comprueba que la configuración server-only existe, crea el
 * cliente service_role y llama al MISMO core que usan el trigger HTTP y el sync manual.
 *
 * ────────────────────────── CÓDIGOS DE SALIDA ──────────────────────────
 *
 *   0  pasada correcta, o noop válido (kill switch OFF, «nada toca», lock ocupado)
 *   1  fallo real del core (algún evento con error) o excepción
 *   2  configuración ausente/inválida: falla cerrado sin tocar red ni base de datos
 *
 * ────────────────────────── ORDEN DE COMPROBACIONES ──────────────────────────
 *
 * 1. Kill switch (`ESPORTS_AUTO_SYNC_ENABLED`) en modo scheduled y sin dry run: si no es `true`,
 *    se registra y se sale con 0 SIN crear el cliente, sin fetch y sin escribir.
 * 2. Configuración: URL de Supabase y clave service_role. Sin ellas, 2.
 * 3. El core. Nunca se imprime ningún valor de configuración: solo nombres.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getEsportsAutoSyncConfig, type EnvLike } from "@/lib/esports/autosync/config";
import type { EsportsSyncRunResult, RunDeps, RunOptions } from "@/lib/esports/autosync/runner";
import { createConsoleLogger, type SyncLogger } from "@/lib/esports/autosync/log";

export interface WorkerOptions {
  /** `scheduled` (por defecto: respeta el kill switch) o `manual` (operador). */
  mode?: "scheduled" | "manual";
  dryRun?: boolean;
  force?: boolean;
  /** Identifica quién ejecuta en la salud y el log (`worker-vps` por defecto). */
  origin?: string;
}

export interface WorkerDeps {
  env: EnvLike;
  /** El core. Inyectable en pruebas; en producción es `runEsportsSync`. */
  run: (deps: RunDeps, opts: RunOptions) => Promise<EsportsSyncRunResult>;
  /** Fabrica el cliente service_role. Inyectable en pruebas. */
  createClient: (url: string, serviceKey: string) => SupabaseClient;
  logger?: SyncLogger;
  hostname?: string;
  pid?: number;
}

export interface WorkerOutcome {
  exitCode: 0 | 1 | 2;
  reason: string;
  result?: EsportsSyncRunResult;
}

const REQUIRED = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const;

/** Nombres (nunca valores) de la configuración que falta. */
export function missingConfig(env: EnvLike): string[] {
  return REQUIRED.filter((k) => !env[k] || !env[k]!.trim());
}

/** Una pasada. No lanza: todo termina en un `WorkerOutcome` con su código. */
export async function runWorkerOnce(opts: WorkerOptions, deps: WorkerDeps): Promise<WorkerOutcome> {
  const logger = deps.logger ?? createConsoleLogger("[esports-sync-worker]");
  const mode = opts.mode ?? "scheduled";
  const dryRun = !!opts.dryRun;
  const origin = opts.origin ?? "worker-vps";
  const cfg = getEsportsAutoSyncConfig(deps.env);

  // 1. KILL SWITCH — antes que nada. Sin cliente, sin red, sin escrituras.
  if (mode === "scheduled" && !dryRun && !cfg.enabled) {
    logger.info("kill_switch_off", { origin, mode, enabled: false, action: "exit 0 sin sync" });
    return { exitCode: 0, reason: "kill switch OFF (ESPORTS_AUTO_SYNC_ENABLED != true)" };
  }

  // 2. CONFIGURACIÓN — falla cerrado. Solo nombres en el log.
  const missing = missingConfig(deps.env);
  if (missing.length) {
    logger.error("config_missing", { origin, missing: missing.join(",") });
    return { exitCode: 2, reason: `configuración ausente: ${missing.join(", ")}` };
  }
  let url: string;
  try {
    url = new URL(deps.env.NEXT_PUBLIC_SUPABASE_URL!.trim()).origin;
  } catch {
    logger.error("config_invalid", { origin, key: "NEXT_PUBLIC_SUPABASE_URL" });
    return { exitCode: 2, reason: "NEXT_PUBLIC_SUPABASE_URL ilegible" };
  }

  // 3. EL CORE — el mismo que el trigger HTTP y el sync manual.
  const sb = deps.createClient(url, deps.env.SUPABASE_SERVICE_ROLE_KEY!.trim());
  const owner = `${deps.hostname ?? "worker"}:${deps.pid ?? 0}:${Date.now()}`;
  try {
    const result = await deps.run(
      { sb, cfg, logger, owner, origin },
      { mode, dryRun, force: opts.force || undefined },
    );
    if (result.skipped === "no-db") return { exitCode: 2, reason: "sin base de datos", result };
    if (result.skipped) return { exitCode: 0, reason: `noop: ${result.skipped}`, result };
    if (result.errors.length > 0) return { exitCode: 1, reason: `${result.errors.length} error(es)`, result };
    return { exitCode: 0, reason: result.eventsDue === 0 ? "noop: ningún evento toca" : "ok", result };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("worker_failed", { origin, error: msg });
    return { exitCode: 1, reason: msg };
  }
}
