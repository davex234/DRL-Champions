/**
 * F73 · CONFIGURACIÓN DE CRAFTEO, MISIONES Y PROYECTOS — lectura con caché corta (5 s) y detección de 0059.
 *
 * Si la migración 0059 no está aplicada (tablas ausentes), todo el sistema F73 queda `available: false`
 * («MIGRATION_PENDING»): las pantallas lo dicen, las rutas responden 503 y los enganches de partida/apertura no hacen
 * nada. Nunca se rompe una partida, una apertura ni un desguace por su culpa.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CraftRecipe, RecipeKind, RecipeStatus } from "@/domain/crafting/types";
import type { PackCardClass } from "@/domain/packs/packClass";
import type { MissionCondition, MissionDef, MissionReward, MissionStatusCfg, ProjectDef } from "@/domain/missionEngine/types";

export type F73Availability = "OK" | "MIGRATION_PENDING" | "ERROR";
export interface F73Config {
  available: boolean;
  reason: F73Availability;
  recipes: CraftRecipe[];
  missions: MissionDef[];
  projects: ProjectDef[];
}

const TTL_MS = 5_000;
let cache: { at: number; value: F73Config } | null = null;
export function resetF73Cache(): void { cache = null; }

const ms = (v: unknown): number | null => (v ? Date.parse(String(v)) : null);

/** ¿El error es «esa tabla no existe»? (Postgres 42P01; PostgREST PGRST205 / PGRST202). */
export function isMissingRelation(e: { code?: string; message?: string } | null | undefined): boolean {
  if (!e) return false;
  return e.code === "42P01" || e.code === "PGRST205" || e.code === "PGRST202" || /does not exist|could not find the table|schema cache/i.test(e.message ?? "");
}

export const toRecipe = (r: Record<string, unknown>): CraftRecipe => ({
  id: String(r.id), kind: r.kind as RecipeKind, name: String(r.name ?? ""),
  inputPackId: (r.input_pack_id as string) ?? null, outputPackId: (r.output_pack_id as string) ?? null,
  inputClass: (r.input_class as PackCardClass) ?? null, outputClass: (r.output_class as PackCardClass) ?? null,
  inputQty: Number(r.input_qty), status: r.status as RecipeStatus, sortOrder: Number(r.sort_order ?? 0),
  availableFrom: ms(r.available_from), availableTo: ms(r.available_to), version: Number(r.version ?? 1),
});

export const toMission = (r: Record<string, unknown>): MissionDef => ({
  id: String(r.id), name: String(r.name ?? ""), description: String(r.description ?? ""),
  condition: (r.condition ?? {}) as MissionCondition, target: Number(r.target),
  dependsOn: Array.isArray(r.depends_on) ? (r.depends_on as string[]) : [],
  reward: (r.reward ?? {}) as MissionReward, projectId: (r.project_id as string) ?? null,
  status: r.status as MissionStatusCfg, sortOrder: Number(r.sort_order ?? 0),
  availableFrom: ms(r.available_from), availableTo: ms(r.available_to), version: Number(r.version ?? 1),
});

export const toProject = (r: Record<string, unknown>): ProjectDef => ({
  id: String(r.id), name: String(r.name ?? ""), description: String(r.description ?? ""), targetCardId: String(r.target_card_id ?? ""),
  status: r.status as MissionStatusCfg, sortOrder: Number(r.sort_order ?? 0),
  availableFrom: ms(r.available_from), availableTo: ms(r.available_to), version: Number(r.version ?? 1),
});

export async function loadF73Config(sb: SupabaseClient, opts: { fresh?: boolean } = {}): Promise<F73Config> {
  if (!opts.fresh && cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const [rq, mq, pq] = await Promise.all([
    sb.from("craft_recipes").select("*"),
    sb.from("content_missions").select("*"),
    sb.from("content_card_projects").select("*"),
  ]);
  const err = rq.error ?? mq.error ?? pq.error;
  let value: F73Config;
  if (err) {
    value = { available: false, reason: isMissingRelation(err) ? "MIGRATION_PENDING" : "ERROR", recipes: [], missions: [], projects: [] };
    if (value.reason === "ERROR") console.error(JSON.stringify({ level: "error", scope: "f73", msg: "config_read_failed", code: err.code ?? null }));
  } else {
    value = {
      available: true, reason: "OK",
      recipes: ((rq.data ?? []) as Record<string, unknown>[]).map(toRecipe).sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id)),
      missions: ((mq.data ?? []) as Record<string, unknown>[]).map(toMission),
      projects: ((pq.data ?? []) as Record<string, unknown>[]).map(toProject),
    };
  }
  cache = { at: Date.now(), value };
  return value;
}

/** Registro estructurado y sin datos privados (ni tokens ni correos): diagnóstico de F73. */
export function logF73(level: "info" | "warn" | "error", msg: string, ctx: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ at: new Date().toISOString(), level, scope: "f73", msg, ...ctx });
  if (level === "error") console.error(line); else if (level === "warn") console.warn(line); else console.log(line);
}
