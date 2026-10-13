/**
 * F83 · TEMPORADAS — ADMIN (dentro del panel existente: `runAdmin`, cuerpo cerrado, auditoría, versión de fila).
 *
 *   list        temporadas en BD (fase derivada de la hora del servidor) + resumen económico de cada una.
 *   create      BORRADOR desde la plantilla (Temporada 2 si no existe; si existe, la siguiente con las mismas reglas).
 *   update      edita un BORRADOR: textos, fechas, curva (rehace los umbrales), XP por fuente, recompensas y retos.
 *   preview     validación completa + TOTAL de recompensas posibles + simulación de perfiles (sobre la definición).
 *   publish     valida (con solapes de BD y del calendario heredado) → checksum sha256 → DRAFT→PUBLISHED. La BD congela.
 *   cancel      PUBLISHED→CANCELLED solo antes de empezar (la BD lo impone).
 *   deleteDraft borra un borrador.
 */
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fail, ok, type AdminResult } from "@/server/admin/http";
import { writeAudit } from "@/server/admin/audit";
import { PACKS } from "@/data/packs";
import { loadSeasonCalendar } from "@/server/services/season";
import { buildLevels } from "@/domain/seasonTrack/curve";
import { economyTotals, simulate, type EconomyTotals, type ProfileResult } from "@/domain/seasonTrack/economy";
import { t2Draft } from "@/domain/seasonTrack/template";
import { validateSeason, type SeasonIssue } from "@/domain/seasonTrack/validate";
import { phaseOf, SEASON_ID_RE, type GameSeason, type SeasonConfig, type SeasonPhase } from "@/domain/seasonTrack/types";
import { fromSeasonRow, invalidateSeasonCache, packPrice, SEASON_COLS } from "@/server/services/seasonTrack";

type Body = Record<string, unknown>;
const ENTITY = "game_season";
const DAY = 86_400_000;

/** Forma canónica (claves ordenadas) de lo que se congela al publicar: base del checksum. */
export function canonicalSeason(s: Pick<GameSeason, "id" | "number" | "name" | "startsAt" | "endsAt" | "claimUntil" | "maxLevel" | "config">): string {
  const sort = (v: unknown): unknown => Array.isArray(v) ? v.map(sort) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, sort((v as Record<string, unknown>)[k])])) : v;
  return JSON.stringify(sort({ id: s.id, number: s.number, name: s.name, startsAt: s.startsAt, endsAt: s.endsAt, claimUntil: s.claimUntil, maxLevel: s.maxLevel, config: s.config }));
}

async function all(sb: SupabaseClient): Promise<GameSeason[]> {
  const { data, error } = await sb.from("game_seasons").select(SEASON_COLS).order("starts_at", { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as never[]).map(fromSeasonRow);
}
async function one(sb: SupabaseClient, id: unknown): Promise<GameSeason | null> {
  if (typeof id !== "string" || !SEASON_ID_RE.test(id)) return null;
  const { data, error } = await sb.from("game_seasons").select(SEASON_COLS).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? fromSeasonRow(data as never) : null;
}

function dbError(message: string | undefined): AdminResult<never> {
  const m = message ?? "";
  if (m.includes("GAME_SEASON_IMMUTABLE")) return fail(409, "Una temporada publicada o cancelada no se modifica");
  if (m.includes("GAME_SEASON_TRANSITION")) return fail(409, "Ese cambio de estado no está permitido (una temporada que ya empezó no se cancela)");
  if (m.includes("game_seasons_no_overlap")) return fail(409, "Se solapa con otra temporada publicada");
  if (m.includes("game_seasons_number_live") || m.includes("game_seasons_pkey")) return fail(409, "Ya existe una temporada con ese id o número");
  if (/does not exist|PGRST205|schema cache/i.test(m)) return fail(503, "0064 no está aplicada: temporadas no disponibles");
  throw new Error(m || "error de base de datos");
}

const ctxFor = (seasons: GameSeason[], id: string, now: number) => ({
  now,
  others: seasons.filter((s) => s.status === "PUBLISHED" && s.id !== id),
  legacy: loadSeasonCalendar().map((e) => ({ id: e.id, startsAt: Date.parse(e.startsAt), endsAt: Date.parse(e.endsAt) })),
  packIds: new Set(PACKS.map((p) => p.id)),
});

export interface AdminSeasonRow extends GameSeason { phase: SeasonPhase; economy: EconomyTotals }
export async function adminListSeasons(sb: SupabaseClient, now = Date.now()): Promise<AdminResult<{ seasons: AdminSeasonRow[]; legacy: { id: string; name: string; startsAt: string; endsAt: string }[] }>> {
  let seasons: GameSeason[];
  try { seasons = await all(sb); } catch (e) { return dbError((e as Error).message); }
  return ok({
    seasons: seasons.map((s) => ({ ...s, phase: phaseOf(s, now), economy: economyTotals(s.config, packPrice) })),
    legacy: loadSeasonCalendar().map((e) => ({ id: e.id, name: e.displayName ?? e.name, startsAt: e.startsAt, endsAt: e.endsAt })),
  });
}

export interface SeasonPreview { season: GameSeason; phase: SeasonPhase; issues: SeasonIssue[]; economy: EconomyTotals; simulation: ProfileResult[]; seasonDays: number }
export async function adminPreviewSeason(sb: SupabaseClient, b: Body, now = Date.now()): Promise<AdminResult<SeasonPreview>> {
  let seasons: GameSeason[];
  try { seasons = await all(sb); } catch (e) { return dbError((e as Error).message); }
  const s = seasons.find((x) => x.id === b.id);
  if (!s) return fail(404, "Temporada no encontrada");
  const days = Math.round((s.endsAt - s.startsAt) / DAY);
  return ok({
    season: s, phase: phaseOf(s, now), issues: validateSeason(s, ctxFor(seasons, s.id, now), { publishing: s.status === "DRAFT" }),
    economy: economyTotals(s.config, packPrice), simulation: simulate(s.config, days, packPrice), seasonDays: days,
  });
}

export async function adminCreateSeason(sb: SupabaseClient, actor: string): Promise<AdminResult<GameSeason>> {
  let seasons: GameSeason[];
  try { seasons = await all(sb); } catch (e) { return dbError((e as Error).message); }
  const t = t2Draft();
  const taken = seasons.filter((s) => s.status !== "CANCELLED");
  const number = taken.some((s) => s.number === t.number) ? Math.max(...taken.map((s) => s.number)) + 1 : t.number;
  const last = seasons.filter((s) => s.status === "PUBLISHED").sort((a, b) => b.endsAt - a.endsAt)[0];
  const startsAt = number === t.number ? t.startsAt : Math.max(last?.endsAt ?? t.startsAt, t.startsAt);
  const length = t.endsAt - t.startsAt;
  const row = {
    id: number === t.number ? t.id : `temporada-${number}`, number, name: number === t.number ? t.name : `Temporada ${number}`, description: t.description,
    status: "DRAFT", starts_at: new Date(startsAt).toISOString(), ends_at: new Date(startsAt + length).toISOString(),
    claim_until: new Date(startsAt + length + 14 * DAY).toISOString(), max_level: t.maxLevel, config: t.config, config_version: 1, row_version: 1, created_by: actor,
  };
  const { data, error } = await sb.from("game_seasons").insert(row).select(SEASON_COLS);
  if (error) return dbError(error.message);
  await writeAudit(sb, actor, "f83_season_create", ENTITY, row.id, { number });
  return ok(fromSeasonRow((data as never[])[0]));
}

const isoMs = (v: unknown): number | null => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?Z$/.test(v) ? Date.parse(v) : null);

export async function adminUpdateSeason(sb: SupabaseClient, actor: string, b: Body): Promise<AdminResult<GameSeason>> {
  let s: GameSeason | null;
  try { s = await one(sb, b.id); } catch (e) { return dbError((e as Error).message); }
  if (!s) return fail(404, "Temporada no encontrada");
  if (s.status !== "DRAFT") return fail(409, "Solo se edita un borrador");
  const rv = typeof b.expectedVersion === "number" && Number.isInteger(b.expectedVersion) ? b.expectedVersion : null;
  if (rv === null) return fail(400, "Falta la versión de la temporada (expectedVersion)");
  const p = (b.patch && typeof b.patch === "object" && !Array.isArray(b.patch) ? b.patch : {}) as Body;
  const allowed = ["name", "description", "startsAt", "endsAt", "claimUntil", "maxLevel", "curve", "xp", "rewards", "challenges"];
  if (!Object.keys(p).length || Object.keys(p).some((k) => !allowed.includes(k))) return fail(400, "Cambio no permitido");
  const out: Record<string, unknown> = {};
  const config: SeasonConfig = structuredClone(s.config);
  if (p.name !== undefined) { if (typeof p.name !== "string" || p.name.trim().length < 3 || p.name.length > 60) return fail(400, "Nombre inválido"); out.name = p.name.trim(); }
  if (p.description !== undefined) { if (typeof p.description !== "string" || p.description.length > 280) return fail(400, "Descripción inválida"); out.description = p.description; }
  for (const [k, col] of [["startsAt", "starts_at"], ["endsAt", "ends_at"], ["claimUntil", "claim_until"]] as const) {
    if (p[k] !== undefined) { const v = isoMs(p[k]); if (v === null) return fail(400, `${k}: fecha ISO UTC (…Z)`); out[col] = new Date(v).toISOString(); }
  }
  let maxLevel = s.maxLevel;
  if (p.maxLevel !== undefined) { if (!Number.isInteger(p.maxLevel) || (p.maxLevel as number) < 5 || (p.maxLevel as number) > 100) return fail(400, "Nivel máximo 5–100"); maxLevel = p.maxLevel as number; out.max_level = maxLevel; }
  if (p.curve !== undefined) {
    const c = p.curve as { base?: unknown; step?: unknown };
    if (!Number.isInteger(c?.base) || !Number.isInteger(c?.step) || (c.base as number) < 100 || (c.base as number) > 20_000 || (c.step as number) < 0 || (c.step as number) > 5_000) return fail(400, "Curva: base 100–20.000 y paso 0–5.000");
    config.curve = { base: c.base as number, step: c.step as number };
  }
  if (p.curve !== undefined || p.maxLevel !== undefined) config.levels = buildLevels(maxLevel, config.curve.base, config.curve.step);
  if (p.xp !== undefined) config.xp = p.xp as SeasonConfig["xp"];
  if (p.rewards !== undefined) { if (!Array.isArray(p.rewards)) return fail(400, "Recompensas: lista"); config.rewards = (p.rewards as SeasonConfig["rewards"]).slice().sort((a, z) => a.level - z.level); }
  if (p.challenges !== undefined) config.challenges = p.challenges as SeasonConfig["challenges"];
  out.config = config;
  // La forma se valida aquí (sin exigir fechas futuras: eso es al publicar).
  const issues = validateSeason({ ...s, name: (out.name as string) ?? s.name, maxLevel, config,
    startsAt: out.starts_at ? Date.parse(out.starts_at as string) : s.startsAt, endsAt: out.ends_at ? Date.parse(out.ends_at as string) : s.endsAt,
    claimUntil: out.claim_until ? Date.parse(out.claim_until as string) : s.claimUntil }, { now: Date.now(), others: [], legacy: [], packIds: new Set(PACKS.map((x) => x.id)) })
    .filter((i) => !["OVERLAP", "OVERLAP_LEGACY", "STARTS_IN_PAST"].includes(i.code));
  if (issues.length) return { ok: false, status: 400, error: `Cambio inválido: ${issues.slice(0, 4).map((i) => `${i.code}${i.detail ? ` (${i.detail})` : ""}`).join(" · ")}` };
  const { data, error } = await sb.from("game_seasons").update(out).eq("id", s.id).eq("row_version", rv).select(SEASON_COLS);
  if (error) return dbError(error.message);
  if (!((data ?? []) as unknown[]).length) return fail(409, "Otro administrador cambió esta temporada. Recarga.");
  await writeAudit(sb, actor, "f83_season_update", ENTITY, s.id, { patch: Object.keys(p) });
  return ok(fromSeasonRow((data as never[])[0]));
}

export async function adminPublishSeason(sb: SupabaseClient, actor: string, b: Body, now = Date.now()): Promise<AdminResult<GameSeason>> {
  let seasons: GameSeason[];
  try { seasons = await all(sb); } catch (e) { return dbError((e as Error).message); }
  const s = seasons.find((x) => x.id === b.id);
  if (!s) return fail(404, "Temporada no encontrada");
  const rv = typeof b.expectedVersion === "number" ? b.expectedVersion : null;
  if (rv === null) return fail(400, "Falta la versión de la temporada (expectedVersion)");
  if (b.confirm !== "PUBLICAR") return fail(400, "Confirma escribiendo PUBLICAR: publicar congela la temporada y sus recompensas");
  const issues = validateSeason(s, ctxFor(seasons, s.id, now), { publishing: true });
  if (issues.length) return { ok: false, status: 409, error: `No se puede publicar: ${issues.slice(0, 5).map((i) => `${i.code}${i.detail ? ` (${i.detail})` : ""}`).join(" · ")}` };
  const checksum = createHash("sha256").update(canonicalSeason(s)).digest("hex");
  const { data, error } = await sb.from("game_seasons").update({ status: "PUBLISHED", checksum, published_at: new Date(now).toISOString(), published_by: actor })
    .eq("id", s.id).eq("row_version", rv).select(SEASON_COLS);
  if (error) return dbError(error.message);
  if (!((data ?? []) as unknown[]).length) return fail(409, "Otro administrador cambió esta temporada. Recarga.");
  invalidateSeasonCache(sb);
  const eco = economyTotals(s.config, packPrice);
  await writeAudit(sb, actor, "f83_season_publish", ENTITY, s.id, { checksum, credits: eco.credits, packs: eco.packs, badges: eco.badges.length });
  return ok(fromSeasonRow((data as never[])[0]));
}

export async function adminCancelSeason(sb: SupabaseClient, actor: string, b: Body): Promise<AdminResult<GameSeason>> {
  let s: GameSeason | null;
  try { s = await one(sb, b.id); } catch (e) { return dbError((e as Error).message); }
  if (!s) return fail(404, "Temporada no encontrada");
  if (s.status !== "PUBLISHED") return fail(409, "Solo se cancela una temporada publicada que no ha empezado");
  const reason = typeof b.reason === "string" ? b.reason.trim() : "";
  if (reason.length < 8) return fail(400, "Explica el motivo (8 caracteres o más)");
  const { data, error } = await sb.from("game_seasons").update({ status: "CANCELLED", cancelled_at: new Date().toISOString() }).eq("id", s.id).eq("row_version", b.expectedVersion as number).select(SEASON_COLS);
  if (error) return dbError(error.message);
  if (!((data ?? []) as unknown[]).length) return fail(409, "Otro administrador cambió esta temporada. Recarga.");
  invalidateSeasonCache(sb);
  await writeAudit(sb, actor, "f83_season_cancel", ENTITY, s.id, { reason: reason.slice(0, 300) });
  return ok(fromSeasonRow((data as never[])[0]));
}

export async function adminDeleteSeasonDraft(sb: SupabaseClient, actor: string, b: Body): Promise<AdminResult<{ deleted: string }>> {
  let s: GameSeason | null;
  try { s = await one(sb, b.id); } catch (e) { return dbError((e as Error).message); }
  if (!s) return fail(404, "Temporada no encontrada");
  if (s.status !== "DRAFT") return fail(409, "Solo se borra un borrador");
  const { data, error } = await sb.from("game_seasons").delete().eq("id", s.id).eq("row_version", b.expectedVersion as number).select("id");
  if (error) return dbError(error.message);
  if (!((data ?? []) as unknown[]).length) return fail(409, "Otro administrador cambió esta temporada. Recarga.");
  await writeAudit(sb, actor, "f83_season_delete", ENTITY, s.id, {});
  return ok({ deleted: s.id });
}
