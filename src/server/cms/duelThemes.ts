/**
 * F71 · TEMÁTICAS DE DUELO — servidor (panel + lectura pública).
 *
 * Sin migración: un tema = una fila de `assets` de tipo `background` (subida por el CMS de F60, validada: MIME por
 * firma, tamaño, dimensiones, relación de aspecto) con sus datos en `assets.meta.duelTheme`. El panel solo manda
 * el ID del asset: nunca una ruta ni una URL. Toda escritura audita en `content_audit_log` (antes/después).
 * La selección vive en `domain/duelThemes` (pura). El juego lee `/api/content/duel-theme` (caché de 5 s aquí, sin
 * versión de entidad: el CHECK de `content_entity_version` de 0057 no admite entidades nuevas sin migración).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { fail, ok, type AdminResult } from "@/server/admin/http";
import { writeAudit } from "@/server/admin/audit";
import { publicUrl } from "./assets";
import {
  CODE_DEFAULT_THEME, selectDuelTheme, themeMetaOf, validateThemeInput,
  type ActiveDuelTheme, type DuelThemeMeta, type DuelThemeRecord,
} from "@/domain/duelThemes";

interface BgRow { id: string; name: string; status: string; storage_path: string | null; width: number | null; height: number | null; bytes: number | null; is_current: boolean; meta: Record<string, unknown> | null; created_at: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function readBackgrounds(sb: SupabaseClient): Promise<BgRow[] | null> {
  const { data, error } = await sb.from("assets").select("id, name, status, storage_path, width, height, bytes, is_current, meta, created_at").eq("kind", "background");
  return error ? null : ((data ?? []) as BgRow[]);
}

function toRecord(sb: SupabaseClient, r: BgRow, t: DuelThemeMeta): DuelThemeRecord {
  const derived = ((r.meta ?? {}) as { derived?: Record<string, string> }).derived ?? {};
  const wide = publicUrl(sb, r.storage_path);
  return { ...t, id: r.id, assetStatus: r.status, wide, narrow: publicUrl(sb, derived.w960) ?? wide };
}

export interface DuelThemesAdminView {
  themes: (DuelThemeRecord & { assetName: string; width: number | null; height: number | null })[];
  /** Fondos subidos que aún no son tema (para crear uno). */
  backgrounds: { id: string; name: string; url: string | null; width: number | null; height: number | null; status: string }[];
  active: ActiveDuelTheme;
  codeDefault: ActiveDuelTheme;
}

export async function listDuelThemes(sb: SupabaseClient, now = Date.now()): Promise<AdminResult<DuelThemesAdminView>> {
  const rows = await readBackgrounds(sb);
  if (!rows) return fail(500, "No se pudieron leer los fondos");
  const themes: DuelThemesAdminView["themes"] = [];
  const backgrounds: DuelThemesAdminView["backgrounds"] = [];
  for (const r of rows) {
    const t = themeMetaOf(r.meta);
    if (t) themes.push({ ...toRecord(sb, r, t), assetName: r.name, width: r.width, height: r.height });
    else if (r.status === "approved" && r.is_current) backgrounds.push({ id: r.id, name: r.name, url: publicUrl(sb, r.storage_path), width: r.width, height: r.height, status: r.status });
  }
  themes.sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || b.priority - a.priority || a.slug.localeCompare(b.slug));
  return ok({ themes, backgrounds, active: selectDuelTheme(themes, now), codeDefault: CODE_DEFAULT_THEME });
}

async function writeMeta(sb: SupabaseClient, id: string, meta: Record<string, unknown>): Promise<boolean> {
  const { error } = await sb.from("assets").update({ meta, updated_at: new Date().toISOString() }).eq("id", id);
  return !error;
}

/** Crear o editar un tema sobre un fondo ya subido. `expectedRev` protege de dos admins editando a la vez. */
export async function saveDuelTheme(sb: SupabaseClient, actor: string, b: Record<string, unknown>): Promise<AdminResult<{ id: string; rev: number }>> {
  const id = String(b.assetId ?? "");
  if (!UUID.test(id)) return fail(400, "Fondo inválido");
  const v = validateThemeInput((b.theme ?? {}) as Record<string, unknown>);
  if (!v.ok) return fail(400, v.error);
  const rows = await readBackgrounds(sb);
  if (!rows) return fail(500, "No se pudieron leer los fondos");
  const row = rows.find((r) => r.id === id);
  if (!row) return fail(404, "Ese fondo no existe o no es un fondo de arena");
  if (row.status !== "approved") return fail(409, "El fondo no está aprobado");
  const before = themeMetaOf(row.meta);
  const expected = b.expectedRev == null ? null : Number(b.expectedRev);
  if ((before?.rev ?? 0) !== (expected ?? 0)) return fail(409, "Otro admin cambió este tema: recarga antes de guardar");
  const clash = rows.find((r) => r.id !== id && themeMetaOf(r.meta)?.slug === v.meta.slug);
  if (clash) return fail(409, "Ya existe un tema con ese slug");

  const after: DuelThemeMeta = { ...v.meta, rev: (before?.rev ?? 0) + 1 };
  // Como mucho UN tema por defecto: marcar este desmarca los demás (cada cambio, auditado).
  if (after.isDefault) {
    for (const r of rows) {
      const t = themeMetaOf(r.meta);
      if (r.id === id || !t?.isDefault) continue;
      const next = { ...t, isDefault: false, rev: t.rev + 1 };
      if (!(await writeMeta(sb, r.id, { ...(r.meta ?? {}), duelTheme: next }))) return fail(500, "No se pudo actualizar el tema por defecto anterior");
      const a = await writeAudit(sb, actor, "duel_theme_default_cleared", "duel_theme", r.id, { before: t, after: next });
      if (!a.ok) return a;
    }
  }
  if (!(await writeMeta(sb, id, { ...(row.meta ?? {}), duelTheme: after }))) return fail(500, "No se pudo guardar el tema");
  const audit = await writeAudit(sb, actor, before ? "duel_theme_update" : "duel_theme_create", "duel_theme", id, { before, after });
  if (!audit.ok) {
    await writeMeta(sb, id, { ...(row.meta ?? {}), duelTheme: before ?? undefined });
    return audit;
  }
  resetDuelThemeCache();
  return ok({ id, rev: after.rev });
}

/** Retirar el tema (el fondo sigue en Assets). No borra ficheros ni filas. */
export async function removeDuelTheme(sb: SupabaseClient, actor: string, b: Record<string, unknown>): Promise<AdminResult<{ id: string }>> {
  const id = String(b.assetId ?? "");
  if (!UUID.test(id)) return fail(400, "Fondo inválido");
  const rows = await readBackgrounds(sb);
  const row = rows?.find((r) => r.id === id);
  const before = row ? themeMetaOf(row.meta) : null;
  if (!row || !before) return fail(404, "Ese tema no existe");
  if (before.rev !== Number(b.expectedRev ?? -1)) return fail(409, "Otro admin cambió este tema: recarga antes de retirarlo");
  const meta = { ...(row.meta ?? {}) };
  delete (meta as { duelTheme?: unknown }).duelTheme;
  if (!(await writeMeta(sb, id, meta))) return fail(500, "No se pudo retirar el tema");
  const audit = await writeAudit(sb, actor, "duel_theme_remove", "duel_theme", id, { before, after: null });
  if (!audit.ok) return audit;
  resetDuelThemeCache();
  return ok({ id });
}

// ────────────────────────── Lectura del juego (caché 5 s) ──────────────────────────

const TTL_MS = 5_000;
let cache: { at: number; records: DuelThemeRecord[] } | null = null;
let inflight: Promise<DuelThemeRecord[] | null> | null = null;
export const resetDuelThemeCache = () => { cache = null; inflight = null; };

async function records(sb: SupabaseClient): Promise<DuelThemeRecord[] | null> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.records;
  inflight ??= (async () => {
    const rows = await readBackgrounds(sb);
    if (!rows) return null;
    const out: DuelThemeRecord[] = [];
    for (const r of rows) { const t = themeMetaOf(r.meta); if (t) out.push(toRecord(sb, r, t)); }
    cache = { at: Date.now(), records: out };
    return out;
  })().finally(() => { inflight = null; });
  return inflight;
}

/** El tema que se juega AHORA. Si la BD falla, el de código: el duelo nunca se queda sin fondo. */
export async function loadActiveDuelTheme(sb: SupabaseClient | null, now = Date.now()): Promise<ActiveDuelTheme> {
  if (!sb) return CODE_DEFAULT_THEME;
  const list = await records(sb).catch(() => null);
  return list ? selectDuelTheme(list, now) : CODE_DEFAULT_THEME;
}
