/**
 * F58 · EVENTOS — borradores del panel + vista de los eventos canónicos (`public.events`).
 *
 * Crear: siempre BORRADOR (nunca se publica en el mismo gesto). Editar: solo borradores, con control de concurrencia
 * por `updated_at`. Publicar: `app_admin_publish_event` (inserta la fila canónica + auditoría, transaccional).
 * Cancelar un borrador: estado `cancelled`, nunca DELETE. Un evento ya publicado no se «despublica» desde aquí: el
 * juego ya lo ha podido enseñar y pagar; se informa y se deja al calendario.
 */
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fail, ok, rpcFailure, type AdminResult } from "./http";
import { entityActivity, writeAudit, type AuditRow } from "./audit";
import { canonicalState, draftState, eventRewardsPreview, type AdminEventState, type EventDraftInput } from "@/domain/admin/events";
import { cleanReason, isUuid } from "@/domain/admin/sanctions";

export interface DraftRow {
  id: string; name: string; description: string | null; image_url: string | null; type: string; region: string | null;
  starts_at: string; ends_at: string; status: string; event_id: string | null; created_by: string | null; created_at: string;
  updated_at: string; published_at: string | null; published_by: string | null;
  /** F60 · imagen del evento subida al CMS (asset `event_art`). Al publicar llega a `events.logo`. */
  image_asset_id?: string | null;
}
export interface EventListItem {
  key: string; source: "draft" | "canonical"; id: string; name: string; type: string | null; region: string | null;
  startsAt: string | null; endsAt: string | null; state: AdminEventState; origin: string; eventId: string | null; updatedAt: string | null;
}

export async function createEventDraft(sb: SupabaseClient, actor: string, d: EventDraftInput): Promise<AdminResult<DraftRow>> {
  const at = new Date().toISOString();
  const { data, error } = await sb.from("admin_event_drafts").insert({
    id: randomUUID(), created_at: at, updated_at: at,
    name: d.name, description: d.description, image_url: d.imageUrl, type: d.type, region: d.region,
    starts_at: d.startsAt, ends_at: d.endsAt, status: "draft", created_by: actor,
  }).select("*");
  const row = ((data ?? []) as DraftRow[])[0];
  if (error || !row) return fail(500, "No se pudo crear el borrador");
  await writeAudit(sb, actor, "event_create_draft", "event", row.id, { before: null, after: { name: d.name, type: d.type, region: d.region, startsAt: d.startsAt, endsAt: d.endsAt } });
  return ok(row);
}

export async function updateEventDraft(sb: SupabaseClient, actor: string, id: unknown, d: EventDraftInput, expectedUpdatedAt: unknown): Promise<AdminResult<DraftRow>> {
  if (!isUuid(id)) return fail(400, "Evento inválido");
  if (typeof expectedUpdatedAt !== "string") return fail(400, "Falta la versión que editabas");
  const { data: cur } = await sb.from("admin_event_drafts").select("*").eq("id", id).maybeSingle();
  const before = cur as DraftRow | null;
  if (!before) return fail(404, "Evento no encontrado");
  if (before.status !== "draft") return fail(409, "Solo se edita un borrador");
  if (before.updated_at !== expectedUpdatedAt) return fail(409, "Otro administrador cambió este evento. Recarga antes de guardar.");
  const patch = { name: d.name, description: d.description, image_url: d.imageUrl, type: d.type, region: d.region, starts_at: d.startsAt, ends_at: d.endsAt, updated_at: new Date().toISOString() };
  const { data, error } = await sb.from("admin_event_drafts").update(patch).eq("id", id).eq("updated_at", expectedUpdatedAt).select("*");
  const row = ((data ?? []) as DraftRow[])[0];
  if (error) return fail(500, "No se pudo guardar");
  if (!row) return fail(409, "Otro administrador cambió este evento. Recarga antes de guardar.");
  await writeAudit(sb, actor, "event_update_draft", "event", id, {
    before: { name: before.name, type: before.type, region: before.region, startsAt: before.starts_at, endsAt: before.ends_at },
    after: { name: d.name, type: d.type, region: d.region, startsAt: d.startsAt, endsAt: d.endsAt },
  });
  return ok(row);
}

export async function cancelEventDraft(sb: SupabaseClient, actor: string, id: unknown, reasonRaw: unknown): Promise<AdminResult<DraftRow>> {
  if (!isUuid(id)) return fail(400, "Evento inválido");
  const reason = cleanReason(reasonRaw);
  if (!reason) return fail(400, "El motivo es obligatorio");
  const { data, error } = await sb.from("admin_event_drafts").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", id).eq("status", "draft").select("*");
  const row = ((data ?? []) as DraftRow[])[0];
  if (error) return fail(500, "No se pudo cancelar");
  if (!row) return fail(409, "Solo se cancela un borrador");
  await writeAudit(sb, actor, "event_cancel_draft", "event", id, { reason, before: { status: "draft" }, after: { status: "cancelled" } });
  return ok(row);
}

export async function publishEvent(sb: SupabaseClient, actor: string, id: unknown, expectedUpdatedAt: unknown): Promise<AdminResult<DraftRow>> {
  if (!isUuid(id)) return fail(400, "Evento inválido");
  if (typeof expectedUpdatedAt !== "string") return fail(400, "Falta la versión que revisaste");
  // F60 · la v2 (0057) copia descripción e imagen a `public.events`. La imagen del CMS se resuelve a su URL pública aquí.
  const { data: cur } = await sb.from("admin_event_drafts").select("image_asset_id").eq("id", id).maybeSingle();
  const assetId = (cur as { image_asset_id?: string | null } | null)?.image_asset_id ?? null;
  let imageUrl: string | null = null;
  if (assetId) {
    const { data: a } = await sb.from("assets").select("storage_path, status, kind").eq("id", assetId).maybeSingle();
    const row = a as { storage_path: string | null; status: string; kind: string } | null;
    if (!row || row.status !== "approved" || row.kind !== "event_art" || !row.storage_path) return fail(409, "La imagen del evento no está disponible");
    imageUrl = sb.storage.from("assets").getPublicUrl(row.storage_path).data.publicUrl;
  }
  const v2 = await sb.rpc("app_admin_publish_event_v2", { p_id: id, p_actor: actor, p_expected_updated_at: expectedUpdatedAt, p_image_url: imageUrl });
  if (!v2.error) return ok(v2.data as DraftRow);
  if (v2.error.code !== "PGRST202") return rpcFailure(v2.error.message);
  const { data, error } = await sb.rpc("app_admin_publish_event", { p_id: id, p_actor: actor, p_expected_updated_at: expectedUpdatedAt });
  if (error) return rpcFailure(error.message);
  return ok(data as DraftRow);
}

/** F60 · Poner/quitar la imagen (asset `event_art`) de un BORRADOR, con la misma concurrencia por `updated_at`. */
export async function setEventImage(sb: SupabaseClient, actor: string, id: unknown, imageAssetId: unknown, expectedUpdatedAt: unknown): Promise<AdminResult<DraftRow>> {
  if (!isUuid(id)) return fail(400, "Evento inválido");
  if (typeof expectedUpdatedAt !== "string") return fail(400, "Falta la versión que editabas");
  if (imageAssetId !== null && !isUuid(imageAssetId)) return fail(400, "Imagen inválida");
  if (imageAssetId) {
    const { data: a } = await sb.from("assets").select("kind, status").eq("id", imageAssetId).maybeSingle();
    const row = a as { kind: string; status: string } | null;
    if (!row || row.kind !== "event_art" || row.status !== "approved") return fail(400, "La imagen no es un asset de evento aprobado");
  }
  const { data: cur } = await sb.from("admin_event_drafts").select("*").eq("id", id).maybeSingle();
  const before = cur as DraftRow | null;
  if (!before) return fail(404, "Evento no encontrado");
  if (before.status !== "draft") return fail(409, "Solo se edita un borrador");
  const { data, error } = await sb.from("admin_event_drafts").update({ image_asset_id: imageAssetId, updated_at: new Date().toISOString() })
    .eq("id", id).eq("updated_at", expectedUpdatedAt).select("*");
  const row = ((data ?? []) as DraftRow[])[0];
  if (error) return fail(500, "No se pudo guardar");
  if (!row) return fail(409, "Otro administrador cambió este evento. Recarga antes de guardar.");
  await writeAudit(sb, actor, "event_set_image", "event", id, { before: { imageAssetId: before.image_asset_id ?? null }, after: { imageAssetId } });
  return ok(row);
}

export async function listEvents(sb: SupabaseClient, now = Date.now()): Promise<AdminResult<{ items: EventListItem[] }>> {
  const [drafts, canon] = await Promise.all([
    sb.from("admin_event_drafts").select("id, name, type, region, starts_at, ends_at, status, event_id, updated_at").order("starts_at", { ascending: false }).limit(100),
    sb.from("events").select("id, name, type, region, status, start_date, end_date, source, updated_at").order("start_date", { ascending: false, nullsFirst: false }).limit(60),
  ]);
  if (drafts.error && canon.error) return fail(500, "No se pudieron leer los eventos");
  const published = new Set(((drafts.data ?? []) as DraftRow[]).map((d) => d.event_id).filter(Boolean));
  const items: EventListItem[] = [
    ...((drafts.data ?? []) as DraftRow[]).map((d) => ({ key: `d:${d.id}`, source: "draft" as const, id: d.id, name: d.name, type: d.type, region: d.region, startsAt: d.starts_at, endsAt: d.ends_at, state: draftState(d, now), origin: "Panel", eventId: d.event_id, updatedAt: d.updated_at })),
    ...((canon.data ?? []) as { id: string; name: string; type: string | null; region: string | null; status: string | null; start_date: string | null; end_date: string | null; source: string; updated_at: string | null }[])
      .filter((e) => !published.has(e.id))
      .map((e) => ({ key: `e:${e.id}`, source: "canonical" as const, id: e.id, name: e.name, type: e.type, region: e.region, startsAt: e.start_date, endsAt: e.end_date, state: canonicalState(e, now), origin: e.source === "vlr" ? "VLR (sincronización)" : e.source === "admin" ? "Panel" : e.source, eventId: e.id, updatedAt: e.updated_at })),
  ];
  return ok({ items });
}

export interface EventDetail {
  draft: DraftRow | null;
  canonical: { id: string; name: string; type: string | null; region: string | null; status: string | null; start_date: string | null; end_date: string | null; source: string } | null;
  state: AdminEventState;
  rewards: ReturnType<typeof eventRewardsPreview>;
  analytics: { claims: number; claimants: number; byChallenge: Record<string, number> } | null;
  activity: AuditRow[];
}

/** Ficha: `id` es el uuid del borrador o el id canónico de `public.events`. */
export async function eventDetail(sb: SupabaseClient, id: string, now = Date.now()): Promise<AdminResult<EventDetail>> {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) return fail(400, "Evento inválido");
  let draft: DraftRow | null = null;
  if (isUuid(id)) draft = ((await sb.from("admin_event_drafts").select("*").eq("id", id).maybeSingle()).data as DraftRow | null) ?? null;
  const canonId = draft?.event_id ?? (draft ? null : id);
  const canonical = canonId
    ? ((await sb.from("events").select("id, name, type, region, status, start_date, end_date, source").eq("id", canonId).maybeSingle()).data as EventDetail["canonical"]) ?? null
    : null;
  if (!draft && !canonical) return fail(404, "Evento no encontrado");

  let analytics: EventDetail["analytics"] = null;
  if (canonical) {
    const { data: claims } = await sb.from("user_achievements").select("user_id, achievement_id").like("achievement_id", `event:${canonical.id}:%`).limit(10_000);
    const rows = (claims ?? []) as { user_id: string; achievement_id: string }[];
    const byChallenge: Record<string, number> = {};
    for (const r of rows) { const c = r.achievement_id.split(":").pop()!; byChallenge[c] = (byChallenge[c] ?? 0) + 1; }
    analytics = { claims: rows.length, claimants: new Set(rows.map((r) => r.user_id)).size, byChallenge };
  }
  const type = draft?.type ?? canonical?.type ?? null;
  const region = draft?.region ?? canonical?.region ?? null;
  return ok({
    draft, canonical,
    state: draft ? draftState(draft, now) : canonicalState(canonical!, now),
    rewards: eventRewardsPreview(type ?? "", region),
    analytics,
    activity: draft ? await entityActivity(sb, "event", draft.id, 20) : [],
  });
}
