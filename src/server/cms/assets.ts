/**
 * F60 · ASSETS DEL CMS (SOLO SERVIDOR) — subir, versionar, listar con uso real, detectar huérfanos y limpiarlos.
 *
 * Dónde viven: bucket `assets` de Supabase Storage (0007), con su fila en `public.assets`. Sobreviven a reinicios,
 * builds y despliegues (no es `public/`). Copia de seguridad: ver `docs/product/fase-60-admin-cms.md` §Storage.
 *
 * Subir (`uploadCmsAsset`):
 *   1. `checkUpload` (puro): firma, extensión, MIME, tamaño, nombre, dimensiones de cabecera y reglas del tipo.
 *   2. DECODIFICACIÓN completa con `sharp` (fichero corrupto ⇒ fuera; AVIF da aquí sus dimensiones; alfa real). Sin
 *      decodificador ⇒ 503: se falla CERRADO, nunca se acepta sin mirar.
 *   3. Duplicado (mismo tipo + sha-256 vigente) ⇒ se devuelve el existente: doble clic = una sola subida.
 *   4. Rutas generadas por el servidor (`cms/<tipo>/<uuid>/original.<ext>`); el ORIGINAL se guarda tal cual, y los
 *      derivados de tiempo de ejecución (caras 256/96, cuerpos 704) se generan aparte, reproducibles.
 *   5. Fila en `assets` y auditoría. Si algo falla DESPUÉS de subir, se borran los objetos subidos (compensación); si
 *      falla la auditoría, se deshace también la fila.
 */
import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ASSET_BUCKET } from "@/lib/assets/storage";
import { fail, ok, type AdminResult } from "@/server/admin/http";
import { writeAudit } from "@/server/admin/audit";
import {
  ASSET_RULES, checkUpload, cmsStoragePath, isCmsAssetKind, safeDisplayName, CMS_ASSET_KINDS,
  type CmsAssetKind, type ImageFormat,
} from "@/domain/cms/uploads";

export interface CmsAsset {
  id: string; kind: string; name: string; format: string | null; width: number | null; height: number | null;
  bytes: number | null; checksum: string | null; status: string; url: string | null; smallUrl: string | null;
  runtimeUrl: string | null; alpha: boolean | null; version: number; groupId: string; isCurrent: boolean;
  subjectId: string | null; createdAt: string; createdBy: string | null;
}

interface AssetRowDb {
  id: string; group_id: string; version: number; is_current: boolean; name: string; kind: string; subject_type: string;
  subject_id: string | null; width: number | null; height: number | null; format: string | null; bytes: number | null;
  checksum: string | null; status: string; storage_path: string | null; url: string | null; meta: Record<string, unknown> | null;
  created_by: string | null; created_at: string;
}

export const publicUrl = (sb: SupabaseClient, path: string | null | undefined): string | null =>
  path ? sb.storage.from(ASSET_BUCKET).getPublicUrl(path).data.publicUrl : null;

export function toCmsAsset(sb: SupabaseClient, r: AssetRowDb): CmsAsset {
  const derived = ((r.meta ?? {}) as { derived?: Record<string, string> }).derived ?? {};
  const original = publicUrl(sb, r.storage_path);
  return {
    id: r.id, kind: r.kind, name: r.name, format: r.format, width: r.width, height: r.height, bytes: r.bytes,
    checksum: r.checksum, status: r.status, url: original,
    smallUrl: publicUrl(sb, derived.w96) ?? null,
    runtimeUrl: publicUrl(sb, derived.w256 ?? derived.w704) ?? original,
    alpha: typeof (r.meta as { alpha?: unknown } | null)?.alpha === "boolean" ? Boolean((r.meta as { alpha: boolean }).alpha) : null,
    version: r.version, groupId: r.group_id, isCurrent: r.is_current, subjectId: r.subject_id,
    createdAt: r.created_at, createdBy: r.created_by,
  };
}

// ────────────────────────── Decodificador (inyectable en pruebas) ──────────────────────────

export interface DecodedImage { width: number; height: number; alpha: boolean }
export interface ImageCodec {
  decode(bytes: Uint8Array): Promise<DecodedImage>;
  /** Derivado WEBP con ancho máximo `width` (sin ampliar). */
  derive(bytes: Uint8Array, width: number): Promise<Uint8Array>;
}

let sharpCodec: ImageCodec | null | undefined;
/** `sharp` llega con Next. Si no estuviera, `null` ⇒ las subidas se rechazan (falla cerrado). */
export async function defaultCodec(): Promise<ImageCodec | null> {
  if (sharpCodec !== undefined) return sharpCodec;
  try {
    const mod = (await import("sharp")) as unknown as { default: (b: Uint8Array | Buffer, o?: object) => any };
    const sharp = mod.default;
    sharpCodec = {
      async decode(bytes) {
        const img = sharp(Buffer.from(bytes), { failOn: "error", limitInputPixels: 40_000_000 });
        const meta = await img.metadata();
        // Decodificación COMPLETA: un fichero truncado o corrupto falla aquí aunque su cabecera sea buena.
        const { info } = await img.clone().raw().toBuffer({ resolveWithObject: true });
        let alpha = false;
        if (meta.hasAlpha) { const st = await img.clone().stats(); alpha = !st.isOpaque; }
        return { width: info.width ?? meta.width ?? 0, height: info.height ?? meta.height ?? 0, alpha };
      },
      async derive(bytes, width) {
        const out = await sharp(Buffer.from(bytes)).resize({ width, withoutEnlargement: true }).webp({ quality: 88, alphaQuality: 100, effort: 5 }).toBuffer();
        return new Uint8Array(out);
      },
    };
  } catch {
    sharpCodec = null;
  }
  return sharpCodec;
}

/** Derivados de tiempo de ejecución por tipo: ancho máximo de cada uno. */
const DERIVED: Partial<Record<CmsAssetKind, { key: "w256" | "w96" | "w704" | "w960"; width: number }[]>> = {
  agent_face: [{ key: "w256", width: 256 }, { key: "w96", width: 96 }],
  agent_full: [{ key: "w704", width: 704 }],
  /* F71 · fondo de arena: variante estrecha para móvil (como stage-960 de la arena por defecto). */
  background: [{ key: "w960", width: 960 }],
};

const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

export interface UploadInput { kind: string; name: string; mime: string; bytes: Uint8Array; subjectId?: string | null; replaceOf?: string | null }

export async function uploadCmsAsset(sb: SupabaseClient, actor: string, input: UploadInput, codecArg?: ImageCodec | null):
  Promise<AdminResult<{ asset: CmsAsset; deduplicated: boolean }>> {
  if (!isCmsAssetKind(input.kind)) return fail(400, "Tipo de asset no admitido");
  const kind = input.kind;
  const rule = ASSET_RULES[kind];
  const subjectId = input.subjectId == null || input.subjectId === "" ? null : String(input.subjectId);
  if (subjectId !== null && !/^[A-Za-z0-9_-]{1,80}$/.test(subjectId)) return fail(400, "Sujeto inválido");

  // 1 · Reglas puras (firma primero; dimensiones de cabecera si el formato las da)
  const pre = checkUpload(kind, input.name, input.mime, input.bytes);
  if (!pre.ok) return fail(400, pre.error);

  // 2 · Decodificación completa (falla cerrado)
  const codec = codecArg === undefined ? await defaultCodec() : codecArg;
  if (!codec) return fail(503, "El servidor no puede validar imágenes ahora mismo; no se ha subido nada");
  let decoded: DecodedImage;
  try { decoded = await codec.decode(input.bytes); } catch { return fail(400, "La imagen está corrupta o no se puede decodificar"); }
  const post = checkUpload(kind, input.name, input.mime, input.bytes, { width: decoded.width, height: decoded.height });
  if (!post.ok) return fail(400, post.error);
  if (pre.width !== null && (pre.width !== decoded.width || pre.height !== decoded.height)) return fail(400, "La cabecera no coincide con la imagen decodificada");

  // 3 · Duplicado ⇒ el existente (idempotente)
  const checksum = sha256(input.bytes);
  if (!input.replaceOf) {
    const { data: dup } = await sb.from("assets").select("*").eq("kind", kind).eq("checksum", checksum).eq("is_current", true).eq("status", "approved").limit(1);
    const hit = (dup ?? [])[0] as AssetRowDb | undefined;
    if (hit) return ok({ asset: toCmsAsset(sb, hit), deduplicated: true });
  }

  // Versionado: reemplazar = nueva versión del MISMO grupo; la anterior queda como historial (no vigente).
  let groupId: string = randomUUID(); let version = 1; let prev: AssetRowDb | null = null;
  if (input.replaceOf) {
    const { data } = await sb.from("assets").select("*").eq("id", input.replaceOf).maybeSingle();
    prev = (data as AssetRowDb | null) ?? null;
    if (!prev || prev.kind !== kind) return fail(404, "El asset a reemplazar no existe o es de otro tipo");
    if (!prev.is_current) return fail(409, "Sólo se reemplaza la versión vigente");
    groupId = prev.group_id; version = prev.version + 1;
  }

  // 4 · Storage: original tal cual + derivados. Todo lo subido se anota para compensar.
  const id = randomUUID();
  const format = post.format as ImageFormat;
  const uploaded: string[] = [];
  const bucket = sb.storage.from(ASSET_BUCKET);
  const cleanup = async () => { if (uploaded.length) await bucket.remove(uploaded).catch(() => undefined); };
  const put = async (path: string, bytes: Uint8Array, contentType: string) => {
    const { error } = await bucket.upload(path, bytes, { contentType, upsert: false, cacheControl: "31536000" });
    if (error) throw new Error("storage");
    uploaded.push(path);
  };
  const originalPath = cmsStoragePath(kind, id, "original", format);
  const derived: Record<string, string> = {};
  try {
    await put(originalPath, input.bytes, post.mime);
    for (const d of DERIVED[kind] ?? []) {
      const out = await codec.derive(input.bytes, d.width);
      const path = cmsStoragePath(kind, id, d.key, "webp");
      await put(path, out, "image/webp");
      derived[d.key] = path;
    }
  } catch {
    await cleanup();
    return fail(502, "No se pudo guardar el fichero en el almacenamiento");
  }

  // 5 · Fila + (si reemplaza) la anterior deja de ser vigente. Compensación si algo falla.
  if (prev) {
    const { error } = await sb.from("assets").update({ is_current: false, updated_at: new Date().toISOString() }).eq("id", prev.id).eq("is_current", true);
    if (error) { await cleanup(); return fail(500, "No se pudo versionar el asset"); }
  }
  const row = {
    id, group_id: groupId, version, is_current: true, name: safeDisplayName(input.name), kind,
    subject_type: rule.subject, subject_id: subjectId, source: "upload", quality: 0,
    width: decoded.width, height: decoded.height, format, bytes: input.bytes.byteLength, checksum,
    priority: 0, status: "approved", bucket: ASSET_BUCKET, storage_path: originalPath, url: publicUrl(sb, originalPath),
    tags: [] as string[], meta: { derived, alpha: decoded.alpha, mime: post.mime, cms: true },
    created_by: actor,
  };
  const { error: insErr } = await sb.from("assets").insert(row);
  if (insErr) {
    if (prev) await sb.from("assets").update({ is_current: true }).eq("id", prev.id);
    await cleanup();
    return fail(500, "No se pudo registrar el asset");
  }
  const audit = await writeAudit(sb, actor, prev ? "asset_replace" : "asset_upload", "asset", id, {
    before: prev ? { id: prev.id, version: prev.version, checksum: prev.checksum } : null,
    after: { id, kind, version, checksum, width: decoded.width, height: decoded.height, bytes: input.bytes.byteLength },
  });
  if (!audit.ok) {
    await sb.from("assets").delete().eq("id", id);
    if (prev) await sb.from("assets").update({ is_current: true }).eq("id", prev.id);
    await cleanup();
    return audit;
  }
  const { data: saved } = await sb.from("assets").select("*").eq("id", id).maybeSingle();
  return ok({ asset: toCmsAsset(sb, (saved as AssetRowDb | null) ?? (row as unknown as AssetRowDb)), deduplicated: false });
}

// ────────────────────────── Uso real y huérfanos ──────────────────────────

export type AssetUsage = Map<string, { type: string; id: string }[]>;

/** Quién usa cada asset (relaciones REALES de 0057). Una lectura por tabla, no una por asset. */
export async function assetUsage(sb: SupabaseClient): Promise<AssetUsage> {
  const use: AssetUsage = new Map();
  const add = (asset: unknown, type: string, id: string) => {
    if (typeof asset !== "string" || !asset) return;
    use.set(asset, [...(use.get(asset) ?? []), { type, id }]);
  };
  const [ag, pk, cc, pl, ev, bg] = await Promise.all([
    sb.from("agents").select("id, face_asset_id, full_asset_id"),
    sb.from("content_packs").select("id, art_asset_id"),
    sb.from("content_cards").select("card_id, presentation").not("presentation", "is", null),
    sb.from("content_players").select("id, photo_asset_id").not("photo_asset_id", "is", null),
    sb.from("admin_event_drafts").select("id, image_asset_id").not("image_asset_id", "is", null),
    sb.from("assets").select("id, meta").eq("kind", "background"),
  ]);
  for (const r of (ag.data ?? []) as { id: string; face_asset_id: string | null; full_asset_id: string | null }[]) { add(r.face_asset_id, "agent", r.id); add(r.full_asset_id, "agent", r.id); }
  for (const r of (pk.data ?? []) as { id: string; art_asset_id: string | null }[]) add(r.art_asset_id, "pack", r.id);
  for (const r of (cc.data ?? []) as { card_id: string; presentation: { imageAssetId?: string } | null }[]) add(r.presentation?.imageAssetId, "card", r.card_id);
  for (const r of (pl.data ?? []) as { id: string; photo_asset_id: string | null }[]) add(r.photo_asset_id, "player", r.id);
  for (const r of (ev.data ?? []) as { id: string; image_asset_id: string | null }[]) add(r.image_asset_id, "event", r.id);
  // F71 · un fondo que es temática de duelo está EN USO (no es huérfano: no se puede borrar desde Assets).
  for (const r of (bg.data ?? []) as { id: string; meta: { duelTheme?: { slug?: string } } | null }[]) if (r.meta?.duelTheme?.slug) add(r.id, "duel_theme", r.meta.duelTheme.slug);
  return use;
}

export interface AssetListItem extends CmsAsset { usage: { type: string; id: string }[]; orphan: boolean }

export async function listCmsAssets(sb: SupabaseClient, f: { kind?: string; status?: string; orphan?: boolean; q?: string; page?: number; pageSize?: number }):
  Promise<AdminResult<{ rows: AssetListItem[]; total: number; page: number; pageSize: number; kinds: string[]; orphans: number }>> {
  const page = Math.max(1, Math.trunc(f.page ?? 1));
  const pageSize = Math.min(Math.max(Math.trunc(f.pageSize ?? 24), 1), 60);
  if (f.kind && !isCmsAssetKind(f.kind)) return fail(400, "Tipo inválido");
  if (f.status && !["approved", "archived", "pending", "rejected"].includes(f.status)) return fail(400, "Estado inválido");
  if (f.q && !/^[\w .\-áéíóúñÁÉÍÓÚÑ]{1,60}$/.test(f.q)) return fail(400, "Búsqueda inválida");
  const { data, error } = await sb.from("assets").select("*").in("kind", f.kind ? [f.kind] : CMS_ASSET_KINDS).order("created_at", { ascending: false });
  if (error) return fail(500, "No se pudieron leer los assets");
  const use = await assetUsage(sb);
  let all = ((data ?? []) as AssetRowDb[]).map((r) => {
    const usage = use.get(r.id) ?? [];
    return { ...toCmsAsset(sb, r), usage, orphan: usage.length === 0 && r.is_current && r.status === "approved" };
  });
  const orphans = all.filter((a) => a.orphan).length;
  if (f.status) all = all.filter((a) => a.status === f.status);
  if (f.orphan) all = all.filter((a) => a.orphan);
  if (f.q) { const t = f.q.toLowerCase(); all = all.filter((a) => a.name.toLowerCase().includes(t) || a.id.startsWith(t)); }
  return ok({ rows: all.slice((page - 1) * pageSize, page * pageSize), total: all.length, page, pageSize, kinds: CMS_ASSET_KINDS, orphans });
}

export async function assetDetail(sb: SupabaseClient, id: string): Promise<AdminResult<{ asset: AssetListItem; history: CmsAsset[] }>> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return fail(400, "Id inválido");
  const { data } = await sb.from("assets").select("*").eq("id", id).maybeSingle();
  const r = data as AssetRowDb | null;
  if (!r || !isCmsAssetKind(r.kind)) return fail(404, "Asset no encontrado");
  const use = await assetUsage(sb);
  const usage = use.get(r.id) ?? [];
  const { data: hist } = await sb.from("assets").select("*").eq("group_id", r.group_id).order("version", { ascending: false });
  return ok({ asset: { ...toCmsAsset(sb, r), usage, orphan: usage.length === 0 && r.is_current && r.status === "approved" },
    history: ((hist ?? []) as AssetRowDb[]).map((h) => toCmsAsset(sb, h)) });
}

/**
 * Limpieza EXPLÍCITA de un huérfano (confirmación crítica en la UI). Se niega si alguien lo usa (la FK `restrict` de
 * 0057 es la segunda red). Borra sus objetos de Storage y su fila, y lo audita. Nunca se hace sola.
 */
export async function deleteOrphanAsset(sb: SupabaseClient, actor: string, id: string, reason: string): Promise<AdminResult<{ deleted: string }>> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return fail(400, "Id inválido");
  if (typeof reason !== "string" || reason.trim().length < 4) return fail(400, "El motivo es obligatorio");
  const { data } = await sb.from("assets").select("*").eq("id", id).maybeSingle();
  const r = data as AssetRowDb | null;
  if (!r || !isCmsAssetKind(r.kind)) return fail(404, "Asset no encontrado");
  const use = await assetUsage(sb);
  if ((use.get(id) ?? []).length) return fail(409, "El asset está en uso: no se puede borrar");
  const derived = ((r.meta ?? {}) as { derived?: Record<string, string> }).derived ?? {};
  const paths = [r.storage_path, ...Object.values(derived)].filter((p): p is string => !!p);
  const { error } = await sb.from("assets").delete().eq("id", id);
  if (error) return fail(409, "No se pudo borrar (¿referenciado?)");
  if (paths.length) await sb.storage.from(ASSET_BUCKET).remove(paths).catch(() => undefined);
  const audit = await writeAudit(sb, actor, "asset_delete_orphan", "asset", id, { reason, before: { id, kind: r.kind, checksum: r.checksum, paths }, after: null });
  if (!audit.ok) return audit;
  return ok({ deleted: id });
}

/** Resuelve varias ids de asset a sus URLs públicas (vigentes o no: el contenido publicado nunca pierde su imagen). */
export async function resolveAssets(sb: SupabaseClient, ids: (string | null | undefined)[]): Promise<Map<string, CmsAsset>> {
  const want = [...new Set(ids.filter((x): x is string => !!x))];
  const out = new Map<string, CmsAsset>();
  if (!want.length) return out;
  const { data } = await sb.from("assets").select("*").in("id", want);
  for (const r of (data ?? []) as AssetRowDb[]) out.set(r.id, toCmsAsset(sb, r));
  return out;
}
