"use client";

/** Lectura (anon, RLS pública) del Asset Manager. Devuelve tipos de dominio. */
import { getSupabase } from "@/lib/supabase/client";
import type { AssetRow, AssetBestRow, AssetDuplicateRow } from "@/lib/supabase/assets.types";
import type { Asset, BestAsset, AssetKind, SubjectType } from "@/domain/assets/types";
import { ASSET_BUCKET } from "./storage";

const num = (n: number | null): number | undefined => (n == null ? undefined : Number(n));

/** URL pública de un objeto del bucket (con fallback a una URL externa guardada). */
export function publicUrl(storagePath: string | null | undefined, fallback?: string | null): string | undefined {
  if (!storagePath) return fallback ?? undefined;
  const sb = getSupabase();
  if (!sb) return fallback ?? undefined;
  return sb.storage.from(ASSET_BUCKET).getPublicUrl(storagePath).data.publicUrl ?? fallback ?? undefined;
}

export function toAsset(r: AssetRow): Asset {
  return {
    id: r.id, groupId: r.group_id, version: r.version, isCurrent: r.is_current,
    name: r.name, kind: r.kind as AssetKind, subjectType: r.subject_type as SubjectType,
    subjectId: r.subject_id ?? undefined, source: r.source as Asset["source"],
    quality: r.quality, width: num(r.width), height: num(r.height), format: r.format ?? undefined,
    bytes: num(r.bytes), checksum: r.checksum ?? undefined, priority: r.priority,
    status: r.status as Asset["status"], license: r.license ?? undefined, bucket: r.bucket,
    storagePath: r.storage_path ?? undefined, url: r.url ?? undefined,
    capturedAt: r.captured_at ?? undefined, tags: r.tags ?? [], meta: r.meta ?? {},
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

function toBest(r: AssetBestRow): BestAsset {
  return {
    kind: r.kind as AssetKind, subjectType: r.subject_type as SubjectType, subjectId: r.subject_id,
    assetId: r.asset_id, bucket: r.bucket ?? undefined, storagePath: r.storage_path ?? undefined,
    url: r.url ?? undefined, width: num(r.width), height: num(r.height),
    quality: num(r.quality), priority: num(r.priority),
  };
}

/** URL resoluble del mejor asset (Storage público o URL externa heredada). */
export function bestAssetUrl(best: BestAsset | null): string | undefined {
  if (!best) return undefined;
  return publicUrl(best.storagePath, best.url);
}

/** El mejor asset disponible para un sujeto (lectura O(1) sobre asset_best). */
export async function bestAssetFor(
  kind: AssetKind, subjectType: SubjectType, subjectId: string,
): Promise<BestAsset | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.from("asset_best").select("*")
    .eq("kind", kind).eq("subject_type", subjectType).eq("subject_id", subjectId).maybeSingle();
  return data ? toBest(data as AssetBestRow) : null;
}

export interface SearchAssetsParams {
  kind?: AssetKind;
  subjectType?: SubjectType;
  subjectId?: string;
  query?: string;
  status?: Asset["status"];
  limit?: number;
  offset?: number;
}

/** Búsqueda paginada (por jugador/equipo/torneo, tipo, estado, texto). */
export async function searchAssets(p: SearchAssetsParams = {}): Promise<Asset[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb.rpc("search_assets", {
    p_kind: p.kind ?? null, p_subject_type: p.subjectType ?? null, p_subject_id: p.subjectId ?? null,
    p_query: p.query ?? null, p_status: p.status ?? null,
    p_limit: p.limit ?? 40, p_offset: p.offset ?? 0,
  });
  return ((data as AssetRow[]) ?? []).map(toAsset);
}

/** Todas las versiones de un grupo (historial), de la más reciente a la primera. */
export async function listVersions(groupId: string): Promise<Asset[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb.from("assets").select("*")
    .eq("group_id", groupId).order("version", { ascending: false });
  return ((data as AssetRow[]) ?? []).map(toAsset);
}

/** Grupos de duplicados por checksum. */
export async function fetchDuplicates(): Promise<AssetDuplicateRow[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb.from("v_asset_duplicates").select("*").order("copies", { ascending: false });
  return (data as AssetDuplicateRow[]) ?? [];
}
