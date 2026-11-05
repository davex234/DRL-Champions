/**
 * POST /api/admin/assets — operaciones del Asset Manager (servidor).
 *
 * Requiere sesión de administrador (Bearer token de Supabase Auth + profiles.is_admin,
 * vía `verifyAdmin`). Escribe con service_role (ignora RLS) y sube los binarios al
 * bucket público `assets` de Supabase Storage.
 *
 * Acciones JSON: approve | reject | archive | set_priority | set_license | relink |
 *                delete | dedupe | search | versions | duplicates.
 * Acciones multipart/form-data (campo `file` + metadatos): upload | replace.
 *
 * Las lecturas (search/versions/duplicates) van por aquí para que el panel vea
 * TODO (pendientes/rechazados), no solo lo aprobado que expone la RLS pública.
 */
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { verifyAdmin } from "@/lib/supabase/adminAuth";
import { assetPath, sha256Hex, ASSET_BUCKET } from "@/lib/assets/storage";
import { sniffImage, MIME_OF } from "@/domain/cms/uploads";
import { scoreAsset } from "@/domain/assets/ranking";
import type { AssetKind } from "@/domain/assets/types";
import type { AssetRow } from "@/lib/supabase/assets.types";
import { takeRate, rateHeaders, TOO_MANY } from "@/server/services/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Fields = (key: string) => string | undefined;
const numOrNull = (v: string | undefined): number | null => (v == null || v === "" ? null : Number(v));
const publicUrlFor = (sb: SupabaseClient, path: string) =>
  sb.storage.from(ASSET_BUCKET).getPublicUrl(path).data.publicUrl ?? null;

/**
 * F60 · ENDURECIDO. Antes: extensión y MIME del cliente, `upsert: true` y el `subjectId` del cliente dentro de la ruta.
 * Ahora el TIPO sale de los bytes (imágenes PNG/WEBP/JPEG/AVIF, o WEBM/MP4/JSON para animaciones), SVG/HTML y
 * cualquier otra cosa se rechazan, la extensión y el MIME se derivan de lo detectado, hay tope de tamaño, el sujeto se
 * sanea (sin `..` ni `/`) y nunca se sobrescribe un objeto.
 */
const LEGACY_MAX_BYTES = 20 * 1024 * 1024;
function sniffLegacy(b: Uint8Array): { ext: string; mime: string } | null {
  const img = sniffImage(b);
  if (img) return { ext: img === "jpeg" ? "jpg" : img, mime: MIME_OF[img] };
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { ext: "webm", mime: "video/webm" };
  if (b.length >= 12 && String.fromCharCode(...b.subarray(4, 8)) === "ftyp") return { ext: "mp4", mime: "video/mp4" };
  const head = new TextDecoder().decode(b.subarray(0, 64)).trimStart();
  if (head.startsWith("{") || head.startsWith("[")) {
    try { JSON.parse(new TextDecoder().decode(b)); return { ext: "json", mime: "application/json" }; } catch { return null; }
  }
  return null;
}

/** Sube un fichero al bucket y devuelve los metadatos del binario. */
async function uploadBinary(
  sb: SupabaseClient, file: File, kind: AssetKind, subjectId: string | undefined, assetId: string,
) {
  if (file.size > LEGACY_MAX_BYTES) throw new UploadRejected("El fichero supera 20 MB");
  const buf = await file.arrayBuffer();
  const detected = sniffLegacy(new Uint8Array(buf));
  if (!detected) throw new UploadRejected("Tipo de fichero no admitido (SVG/HTML/otros se rechazan)");
  const safeSubject = subjectId && /^[A-Za-z0-9_-]{1,80}$/.test(subjectId) ? subjectId : undefined;
  const path = assetPath(kind, safeSubject, assetId, detected.ext);
  const { error } = await sb.storage.from(ASSET_BUCKET).upload(path, buf, { contentType: detected.mime, upsert: false });
  if (error) throw new Error(`Storage: ${error.message}`);
  return { path, ext: detected.ext, url: publicUrlFor(sb, path), bytes: file.size };
}

/**
 * F67 · el campo `url` (recurso externo sin subir fichero) solo admite http(s) o una ruta del propio sitio. Antes se
 * guardaba tal cual: un `javascript:` o `data:` acababa en un `href` del panel.
 */
function safeAssetUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const v = raw.trim();
  if (v.startsWith("/") && !v.startsWith("//")) return v.slice(0, 500);
  try { const u = new URL(v); return u.protocol === "https:" || u.protocol === "http:" ? u.toString().slice(0, 500) : null; } catch { return null; }
}

class UploadRejected extends Error {}

export async function POST(req: Request) {
  const admin = await verifyAdmin(req);
  if (!admin) return NextResponse.json({ error: "No autorizado (admin requerido)" }, { status: 401 });
  const sb = getSupabaseAdmin();
  if (!sb) return NextResponse.json({ error: "Supabase admin no configurado" }, { status: 503 });
  // F67 · límite de frecuencia de las escrituras de esta ruta (cubeta en BD: vale con varios procesos).
  { const rate = await takeRate(sb, admin.userId, "upload_write"); if (!rate.allowed) return NextResponse.json({ error: TOO_MANY, code: "RATE_LIMITED" }, { status: 429, headers: rateHeaders(rate.retryAfter) }); }

  const ct = req.headers.get("content-type") ?? "";
  const isMultipart = ct.includes("multipart/form-data");
  let form: FormData | null = null;
  let body: Record<string, unknown> = {};
  if (isMultipart) {
    // F60 · el tamaño se mira ANTES de leer el cuerpo.
    const len = Number(req.headers.get("content-length") ?? NaN);
    if (!Number.isFinite(len) || len > LEGACY_MAX_BYTES + 64 * 1024) return NextResponse.json({ error: "Fichero demasiado grande o tamaño desconocido" }, { status: 413 });
    form = await req.formData();
  }
  else { try { body = await req.json(); } catch { /* vacío */ } }

  const f: Fields = (k) =>
    isMultipart ? ((form!.get(k) as string | null) ?? undefined) : (body[k] as string | undefined);
  const action = f("action");
  const file = isMultipart ? (form!.get("file") as File | null) : null;

  try {
    switch (action) {
      // ---- SUBIR (nuevo asset, versión 1) ----------------------------------
      case "upload": {
        const kind = f("kind") as AssetKind;
        if (!kind) return NextResponse.json({ error: "kind requerido" }, { status: 400 });
        const subjectId = f("subjectId") || undefined;
        const assetId = crypto.randomUUID();

        let storagePath: string | null = null, url: string | null = safeAssetUrl(f("url")) ?? null;
        let format: string | null = null, bytes: number | null = null;
        let checksum: string | null = f("checksum") ?? null;
        if (file) {
          const up = await uploadBinary(sb, file, kind, subjectId, assetId);
          storagePath = up.path; url = up.url; format = up.ext; bytes = up.bytes;
          if (!checksum) checksum = await sha256Hex(await file.arrayBuffer());
        }

        // Aviso de duplicado (mismo checksum ya presente) — no bloquea.
        let duplicate = false;
        if (checksum) {
          const { data: dup } = await sb.from("assets").select("id").eq("checksum", checksum).limit(1);
          duplicate = Boolean(dup && dup.length);
        }

        const row = {
          id: assetId, group_id: assetId, version: 1, is_current: true,
          name: f("name") || file?.name || `${kind}-${assetId.slice(0, 8)}`,
          kind, subject_type: f("subjectType") || "none", subject_id: subjectId ?? null,
          source: f("source") || "upload", quality: numOrNull(f("quality")) ?? 0,
          width: numOrNull(f("width")), height: numOrNull(f("height")),
          format, bytes, checksum, priority: numOrNull(f("priority")) ?? 0,
          status: "pending", license: f("license") ?? null,
          bucket: ASSET_BUCKET, storage_path: storagePath, url,
          captured_at: f("capturedAt") ?? null,
          tags: (f("tags") ?? "").split(",").map((t) => t.trim()).filter(Boolean),
          created_by: admin.userId,
        };
        const { error } = await sb.from("assets").insert(row);
        if (error) throw new Error(error.message);
        return NextResponse.json({ ok: true, id: assetId, duplicate });
      }

      // ---- REEMPLAZAR (nueva versión del mismo grupo) ----------------------
      case "replace": {
        const groupId = f("groupId");
        if (!groupId) return NextResponse.json({ error: "groupId requerido" }, { status: 400 });
        const { data: cur } = await sb.from("assets").select("*")
          .eq("group_id", groupId).eq("is_current", true).maybeSingle();
        if (!cur) return NextResponse.json({ error: "Grupo inexistente" }, { status: 404 });
        const prev = cur as AssetRow;

        const assetId = crypto.randomUUID();
        let storagePath: string | null = null, url: string | null = safeAssetUrl(f("url")) ?? prev.url;
        let format: string | null = prev.format, bytes: number | null = prev.bytes;
        let checksum: string | null = f("checksum") ?? null;
        if (file) {
          const up = await uploadBinary(sb, file, prev.kind as AssetKind, prev.subject_id ?? undefined, assetId);
          storagePath = up.path; url = up.url; format = up.ext; bytes = up.bytes;
          if (!checksum) checksum = await sha256Hex(await file.arrayBuffer());
        }

        // Quita la marca vigente de la versión previa antes de insertar la nueva
        // (respeta el índice único parcial assets_current_per_group).
        await sb.from("assets").update({ is_current: false }).eq("group_id", groupId).eq("is_current", true);
        const { error } = await sb.from("assets").insert({
          id: assetId, group_id: groupId, version: prev.version + 1, is_current: true,
          name: f("name") || prev.name, kind: prev.kind,
          subject_type: prev.subject_type, subject_id: prev.subject_id,
          source: f("source") || prev.source, quality: numOrNull(f("quality")) ?? prev.quality,
          width: numOrNull(f("width")), height: numOrNull(f("height")),
          format, bytes, checksum, priority: numOrNull(f("priority")) ?? prev.priority,
          status: "pending", license: f("license") ?? prev.license,
          bucket: ASSET_BUCKET, storage_path: storagePath, url,
          captured_at: f("capturedAt") ?? null,
          tags: prev.tags ?? [], created_by: admin.userId,
        });
        if (error) throw new Error(error.message);
        return NextResponse.json({ ok: true, id: assetId, version: prev.version + 1 });
      }

      // ---- ESTADO / METADATOS ---------------------------------------------
      case "approve":
      case "reject":
      case "archive": {
        const status = action === "approve" ? "approved" : action === "reject" ? "rejected" : "archived";
        const { error } = await sb.from("assets").update({ status }).eq("id", f("id"));
        if (error) throw new Error(error.message);
        return NextResponse.json({ ok: true });
      }
      case "set_priority": {
        const { error } = await sb.from("assets")
          .update({ priority: numOrNull(f("priority")) ?? 0 }).eq("id", f("id"));
        if (error) throw new Error(error.message);
        return NextResponse.json({ ok: true });
      }
      case "set_license": {
        const { error } = await sb.from("assets").update({ license: f("license") ?? null }).eq("id", f("id"));
        if (error) throw new Error(error.message);
        return NextResponse.json({ ok: true });
      }
      case "relink": {
        const { error } = await sb.from("assets").update({
          subject_type: f("subjectType") || "none", subject_id: f("subjectId") || null,
        }).eq("id", f("id"));
        if (error) throw new Error(error.message);
        return NextResponse.json({ ok: true });
      }

      // ---- ELIMINAR (fila + objeto de Storage) -----------------------------
      case "delete": {
        const id = f("id") as string;
        const { data: row } = await sb.from("assets").select("storage_path").eq("id", id).maybeSingle();
        const path = (row as { storage_path: string | null } | null)?.storage_path;
        if (path) await sb.storage.from(ASSET_BUCKET).remove([path]);
        const { error } = await sb.from("assets").delete().eq("id", id);
        if (error) throw new Error(error.message);
        return NextResponse.json({ ok: true });
      }

      // ---- DEDUPLICAR: conserva el mejor, borra el resto -------------------
      case "dedupe": {
        const checksum = f("checksum") as string;
        if (!checksum) return NextResponse.json({ error: "checksum requerido" }, { status: 400 });
        const { data } = await sb.from("assets").select("*").eq("checksum", checksum);
        const rows = (data as AssetRow[]) ?? [];
        if (rows.length <= 1) return NextResponse.json({ ok: true, removed: 0 });
        // Mejor = mayor score (prioridad/calidad/resolución/fuente/versión).
        const best = [...rows].sort((a, b) =>
          scoreAsset({
            priority: b.priority, quality: b.quality, width: b.width ?? undefined,
            height: b.height ?? undefined, source: b.source as never, version: b.version,
          }) - scoreAsset({
            priority: a.priority, quality: a.quality, width: a.width ?? undefined,
            height: a.height ?? undefined, source: a.source as never, version: a.version,
          }),
        )[0];
        const losers = rows.filter((r) => r.id !== best.id);
        const paths = losers.map((r) => r.storage_path).filter((p): p is string => Boolean(p));
        if (paths.length) await sb.storage.from(ASSET_BUCKET).remove(paths);
        const { error } = await sb.from("assets").delete().in("id", losers.map((r) => r.id));
        if (error) throw new Error(error.message);
        return NextResponse.json({ ok: true, kept: best.id, removed: losers.length });
      }

      // ---- LECTURAS para el panel (service_role: ve todo) ------------------
      case "search": {
        const { data, error } = await sb.rpc("search_assets", {
          p_kind: f("kind") ?? null, p_subject_type: f("subjectType") ?? null,
          p_subject_id: f("subjectId") ?? null, p_query: f("query") ?? null,
          p_status: f("status") ?? null,
          p_limit: numOrNull(f("limit")) ?? 60, p_offset: numOrNull(f("offset")) ?? 0,
        });
        if (error) throw new Error(error.message);
        return NextResponse.json({ ok: true, assets: data ?? [] });
      }
      case "versions": {
        const { data, error } = await sb.from("assets").select("*")
          .eq("group_id", f("groupId")).order("version", { ascending: false });
        if (error) throw new Error(error.message);
        return NextResponse.json({ ok: true, assets: data ?? [] });
      }
      case "duplicates": {
        const { data, error } = await sb.from("v_asset_duplicates").select("*")
          .order("copies", { ascending: false });
        if (error) throw new Error(error.message);
        return NextResponse.json({ ok: true, duplicates: data ?? [] });
      }

      default:
        return NextResponse.json({ error: `Acción desconocida: ${action}` }, { status: 400 });
    }
  } catch (e) {
    // F60 · sin detalle interno hacia el cliente (ni SQL ni Storage); el rechazo de validación sí se explica.
    if (e instanceof UploadRejected) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error(`[admin/assets] ${e instanceof Error ? e.message : String(e)}`);
    return NextResponse.json({ error: "No se pudo completar la operación" }, { status: 500 });
  }
}
