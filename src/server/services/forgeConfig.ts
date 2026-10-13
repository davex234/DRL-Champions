/**
 * F79 · CONFIGURACIÓN DE NEXUS FORGE 2.0 — lectura con caché corta (5 s) del documento versionado `forge_config`
 * (0061, fila `main`). Sin 0061 (tabla ausente) o sin fila → la configuración por defecto de `domain/forge/defaults`
 * (todo el contenido nuevo en DRAFT): la Forja enseña nivel, XP, maestría e historial, y nada más cambia.
 *
 * Registro analítico: `logForge` (scope «forge», sin datos personales: ni correos ni tokens; el usuario no se registra).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_FORGE_CONFIG, mergeForgeConfig } from "@/domain/forge/defaults";
import type { ForgeConfig } from "@/domain/forge/types";
import { isMissingRelation } from "./f73Config";

export interface ForgeConfigLoad {
  /** ¿Existe la tabla de 0061? (si no, el panel no puede guardar). */
  stored: boolean;
  reason: "OK" | "MIGRATION_PENDING" | "ERROR" | "DEFAULTS";
  config: ForgeConfig;
  /** Versión optimista del documento (0 = aún no guardado: se usa el de por defecto). */
  version: number;
  updatedAt: string | null;
}

export const FORGE_CONFIG_ID = "main";
const TTL_MS = 5_000;
let cache: { at: number; value: ForgeConfigLoad } | null = null;
export function resetForgeConfigCache(): void { cache = null; }

export async function loadForgeConfig(sb: SupabaseClient, opts: { fresh?: boolean } = {}): Promise<ForgeConfigLoad> {
  if (!opts.fresh && cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const { data, error } = await sb.from("forge_config").select("doc, version, updated_at").eq("id", FORGE_CONFIG_ID).maybeSingle();
  let value: ForgeConfigLoad;
  if (error) {
    const missing = isMissingRelation(error);
    if (!missing) logForge("error", "config_read_failed", { code: error.code ?? null });
    value = { stored: false, reason: missing ? "MIGRATION_PENDING" : "ERROR", config: DEFAULT_FORGE_CONFIG, version: 0, updatedAt: null };
  } else if (!data) {
    value = { stored: true, reason: "DEFAULTS", config: DEFAULT_FORGE_CONFIG, version: 0, updatedAt: null };
  } else {
    const row = data as { doc: unknown; version: number; updated_at: string | null };
    value = { stored: true, reason: "OK", config: mergeForgeConfig(row.doc), version: Number(row.version ?? 1), updatedAt: row.updated_at ?? null };
  }
  cache = { at: Date.now(), value };
  return value;
}

/** Analítica y diagnóstico de la Forja (forge_open, recipe_view, craft_attempt/success/failure, project_*, …). */
export function logForge(level: "info" | "warn" | "error", msg: string, ctx: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ at: new Date().toISOString(), level, scope: "forge", msg, ...ctx });
  if (level === "error") console.error(line); else if (level === "warn") console.warn(line); else console.log(line);
}
