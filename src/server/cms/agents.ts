/**
 * F60 · AGENTES (SOLO SERVIDOR) — gestor de /admin/agents y cargador del catálogo vivo del juego.
 *
 * Fuente única: `public.agents`. Escrituras sólo por las RPC de 0057 (admin, lista blanca, concurrencia, auditoría).
 * El juego recibe PUBLICADOS + RETIRADOS con su arte (`/api/content/agents`); los BORRADORES sólo existen aquí.
 *
 * Caché del cargador: se vuelve a leer la tabla sólo si cambió `content_entity_version.agents`, comprobado como mucho
 * cada 5 s (el mismo patrón que el catálogo de cartas y los pools). Publicar desde el panel ⇒ el juego lo ve en ≤ 5 s
 * sin reiniciar el servidor.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { fail, ok, rpcFailure, type AdminResult } from "@/server/admin/http";
import { listAudit, type AuditRow } from "@/server/admin/audit";
import { resolveAssets, type CmsAsset } from "./assets";
import { validateAgentDraft, agentPublishChecklist, type AgentRecord, type AgentLifecycle } from "@/domain/cms/agents";
import { applyAgentCatalog, type AgentCatalogPayload, type RuntimeAgent } from "@/domain/tactics/agentCatalog";
import { VALORANT_ROSTER } from "@/domain/tactics/valorantRoster";
import type { AgentArtAsset } from "@/domain/tactics/agentArt";

interface AgentRowDb {
  id: string; name: string; role: string; icon: string | null; code: string | null; abilities: { slot: string; name: string }[] | null;
  lifecycle: AgentLifecycle; face_asset_id: string | null; full_asset_id: string | null; origin: "seed" | "admin";
  version: number; created_at: string; updated_at: string; published_at: string | null; retired_at: string | null;
}

const toRecord = (r: AgentRowDb): AgentRecord => ({
  id: r.id, name: r.name, role: r.role, code: r.code, abilities: r.abilities ?? [], lifecycle: r.lifecycle, origin: r.origin,
  faceAssetId: r.face_asset_id, fullAssetId: r.full_asset_id, version: r.version,
});

/** Arte de Storage → la forma que consume `AgentPortrait`/`AgentFullBody` (derivados 256/96 y 704). */
function artOf(a: CmsAsset | undefined, kind: "face" | "full"): AgentArtAsset | null {
  if (!a || !a.runtimeUrl || !a.width || !a.height) return null;
  const maxW = kind === "face" ? 256 : 704;
  const w = Math.min(a.width, maxW); const h = Math.round(a.height * (w / a.width));
  const sw = Math.min(a.width, 96); const sh = Math.round(a.height * (sw / a.width));
  return {
    src: a.runtimeUrl, width: w, height: h, alpha: a.alpha ?? true, source: `storage:${a.id}`, sourceSha: (a.checksum ?? "").slice(0, 16),
    ...(kind === "face" && a.smallUrl ? { small: { src: a.smallUrl, width: sw, height: sh } } : {}),
  };
}

// ────────────────────────── Cargador del juego ──────────────────────────

const TTL_MS = 5_000;
let cache: { version: number; payload: AgentCatalogPayload; checkedAt: number } | null = null;
let inflight: Promise<AgentCatalogPayload | null> | null = null;

async function readVersion(sb: SupabaseClient, entity: "agents" | "packs"): Promise<number | null> {
  const { data, error } = await sb.from("content_entity_version").select("version").eq("entity", entity).maybeSingle();
  return error || !data ? null : Number((data as { version: number }).version);
}

async function buildPayload(sb: SupabaseClient, version: number): Promise<AgentCatalogPayload | null> {
  const { data, error } = await sb.from("agents").select("*").in("lifecycle", ["PUBLISHED", "RETIRED"]).order("id", { ascending: true });
  if (error || !data) return null;
  const rows = data as AgentRowDb[];
  const assets = await resolveAssets(sb, rows.flatMap((r) => [r.face_asset_id, r.full_asset_id]));
  const agents: RuntimeAgent[] = rows.map((r) => ({
    id: r.id, name: r.name, role: r.role as RuntimeAgent["role"], code: r.code ?? "", abilities: (r.abilities ?? []) as RuntimeAgent["abilities"],
    lifecycle: r.lifecycle as "PUBLISHED" | "RETIRED",
    face: artOf(r.face_asset_id ? assets.get(r.face_asset_id) : undefined, "face"),
    full: artOf(r.full_asset_id ? assets.get(r.full_asset_id) : undefined, "full"),
  }));
  return { version, agents };
}

/** Catálogo vivo (publicados + retirados). `null` si la BD no responde o no tiene 0057 (el juego sigue con la instantánea). */
export async function loadAgentCatalog(sb: SupabaseClient, now = Date.now()): Promise<AgentCatalogPayload | null> {
  if (cache && now - cache.checkedAt < TTL_MS) return cache.payload;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const version = await readVersion(sb, "agents");
      if (version === null) return cache?.payload ?? null;
      if (cache && cache.version === version) { cache.checkedAt = now; return cache.payload; }
      const payload = await buildPayload(sb, version);
      if (!payload) return cache?.payload ?? null;
      cache = { version, payload, checkedAt: now };
      return payload;
    } finally { inflight = null; }
  })();
  return inflight;
}

/** Aplica el catálogo al proceso del servidor antes de validar composiciones/jugadas con agentes. */
export async function ensureServerAgents(sb: SupabaseClient | null): Promise<void> {
  if (!sb) return;
  try { applyAgentCatalog(await loadAgentCatalog(sb)); } catch { /* sin BD ⇒ instantánea */ }
}

export const resetAgentCatalogCache = (): void => { cache = null; inflight = null; };

// ────────────────────────── Panel ──────────────────────────

export interface AgentListItem extends AgentRecord {
  faceUrl: string | null; fullUrl: string | null; updatedAt: string; usage: { stats: number; compositions: number };
}

export async function listAgents(sb: SupabaseClient): Promise<AdminResult<{ rows: AgentListItem[]; counts: Record<AgentLifecycle, number> }>> {
  const { data, error } = await sb.from("agents").select("*").order("id", { ascending: true });
  if (error) return fail(500, "No se pudieron leer los agentes");
  const rows = (data ?? []) as AgentRowDb[];
  const assets = await resolveAssets(sb, rows.flatMap((r) => [r.face_asset_id, r.full_asset_id]));
  // Uso real, en lote (una lectura por tabla, no una por agente).
  const [mps, ps, comps] = await Promise.all([
    sb.from("map_player_stats").select("agent_id").not("agent_id", "is", null),
    sb.from("player_stats").select("agent_id").not("agent_id", "is", null),
    sb.from("user_compositions").select("agent_ids"),
  ]);
  const stats = new Map<string, number>(); const cmp = new Map<string, number>();
  for (const r of [...((mps.data ?? []) as { agent_id: string }[]), ...((ps.data ?? []) as { agent_id: string }[])]) stats.set(r.agent_id, (stats.get(r.agent_id) ?? 0) + 1);
  for (const r of (comps.data ?? []) as { agent_ids: string[] | null }[]) for (const id of new Set(r.agent_ids ?? [])) cmp.set(id, (cmp.get(id) ?? 0) + 1);
  const counts: Record<AgentLifecycle, number> = { DRAFT: 0, PUBLISHED: 0, RETIRED: 0 };
  const out = rows.map((r) => {
    counts[r.lifecycle]++;
    return {
      ...toRecord(r), updatedAt: r.updated_at,
      faceUrl: r.face_asset_id ? assets.get(r.face_asset_id)?.smallUrl ?? assets.get(r.face_asset_id)?.runtimeUrl ?? null : null,
      fullUrl: r.full_asset_id ? assets.get(r.full_asset_id)?.runtimeUrl ?? null : null,
      usage: { stats: stats.get(r.id) ?? 0, compositions: cmp.get(r.id) ?? 0 },
    };
  });
  return ok({ rows: out, counts });
}

export interface AgentDetail {
  agent: AgentRecord & { createdAt: string; updatedAt: string; publishedAt: string | null; retiredAt: string | null };
  face: CmsAsset | null; full: CmsAsset | null;
  references: { mapPlayerStats: number; playerStats: number; compositions: number; strats: number };
  checklist: { key: string; label: string; ok: boolean }[];
  inSnapshot: boolean;
  history: AuditRow[];
}

export async function agentDetail(sb: SupabaseClient, id: string): Promise<AdminResult<AgentDetail>> {
  if (!/^[a-z0-9]{2,24}$/.test(id)) return fail(400, "Id inválido");
  const { data } = await sb.from("agents").select("*").eq("id", id).maybeSingle();
  const r = data as AgentRowDb | null;
  if (!r) return fail(404, "Agente no encontrado");
  const assets = await resolveAssets(sb, [r.face_asset_id, r.full_asset_id]);
  const refs = await sb.rpc("app_admin_agent_references", { p_id: id });
  if (refs.error) return rpcFailure(refs.error.message);
  const hist = await listAudit(sb, { entityType: "agent", entityId: id, pageSize: 20 });
  const rec = toRecord(r);
  return ok({
    agent: { ...rec, createdAt: r.created_at, updatedAt: r.updated_at, publishedAt: r.published_at, retiredAt: r.retired_at },
    face: r.face_asset_id ? assets.get(r.face_asset_id) ?? null : null,
    full: r.full_asset_id ? assets.get(r.full_asset_id) ?? null : null,
    references: refs.data as AgentDetail["references"],
    checklist: agentPublishChecklist(rec),
    inSnapshot: VALORANT_ROSTER.some((x) => x.id === id),
    history: hist.ok ? hist.data.rows : [],
  });
}

const PATCH_KEYS = ["name", "role", "code", "abilities", "faceAssetId", "fullAssetId"] as const;

export async function saveAgent(sb: SupabaseClient, actor: string, body: Record<string, unknown>): Promise<AdminResult<unknown>> {
  const creating = body.expectedVersion === undefined || body.expectedVersion === null;
  const id = typeof body.id === "string" ? body.id : "";
  const patch = (body.patch ?? {}) as Record<string, unknown>;
  if (typeof patch !== "object" || Array.isArray(patch)) return fail(400, "Cambios inválidos");
  const extra = Object.keys(patch).filter((k) => !(PATCH_KEYS as readonly string[]).includes(k));
  if (extra.length) return fail(400, `Campo no permitido: ${extra[0].slice(0, 40)}`);
  let existing: ReadonlySet<string> | undefined;
  if (creating) {
    const { data } = await sb.from("agents").select("id");
    existing = new Set(((data ?? []) as { id: string }[]).map((x) => x.id));
  }
  const errors = validateAgentDraft({
    id, name: patch.name as string | undefined, role: patch.role as string | undefined, code: patch.code as string | undefined,
    abilities: patch.abilities as { slot: string; name: string }[] | undefined,
  }, { creating, existingIds: existing });
  if (Object.keys(errors).length) return fail(400, Object.values(errors)[0]!);
  const uuid = (v: unknown) => (v === null ? null : typeof v === "string" && /^[0-9a-f-]{36}$/.test(v) ? v : undefined);
  const dbPatch: Record<string, unknown> = {};
  if (patch.name !== undefined) dbPatch.name = String(patch.name).trim();
  if (patch.role !== undefined) dbPatch.role = patch.role;
  if (patch.code !== undefined) dbPatch.code = patch.code === "" ? null : patch.code;
  if (patch.abilities !== undefined) dbPatch.abilities = (patch.abilities as { slot: string; name: string }[]).map((a) => ({ slot: a.slot, name: a.name.trim() }));
  for (const [k, col] of [["faceAssetId", "face_asset_id"], ["fullAssetId", "full_asset_id"]] as const) {
    if (patch[k] !== undefined) { const v = uuid(patch[k]); if (v === undefined) return fail(400, "Asset inválido"); dbPatch[col] = v; }
  }
  const reason = typeof body.reason === "string" ? body.reason.slice(0, 300) : "";
  const { data, error } = await sb.rpc("app_admin_agent_save", {
    p_actor: actor, p_id: id, p_patch: dbPatch, p_expected_version: creating ? null : Number(body.expectedVersion), p_reason: reason || (creating ? "alta" : "edición"),
  });
  if (error) return rpcFailure(error.message);
  resetAgentCatalogCache();
  return ok(data);
}

export async function agentLifecycle(sb: SupabaseClient, actor: string, body: Record<string, unknown>): Promise<AdminResult<unknown>> {
  const to = body.to;
  if (to !== "PUBLISHED" && to !== "RETIRED") return fail(400, "Estado inválido");
  if (typeof body.reason !== "string" || body.reason.trim().length < 4) return fail(400, "El motivo es obligatorio");
  const { data, error } = await sb.rpc("app_admin_agent_lifecycle", {
    p_actor: actor, p_id: String(body.id ?? ""), p_to: to, p_expected_version: Number(body.expectedVersion), p_reason: body.reason.slice(0, 300),
  });
  if (error) return rpcFailure(error.message);
  resetAgentCatalogCache();
  return ok(data);
}

export async function deleteAgentDraft(sb: SupabaseClient, actor: string, body: Record<string, unknown>): Promise<AdminResult<unknown>> {
  if (typeof body.reason !== "string" || body.reason.trim().length < 4) return fail(400, "El motivo es obligatorio");
  if (body.confirm !== body.id) return fail(400, "Escribe el id del agente para confirmar");
  const { data, error } = await sb.rpc("app_admin_agent_delete_draft", {
    p_actor: actor, p_id: String(body.id ?? ""), p_expected_version: Number(body.expectedVersion), p_reason: body.reason.slice(0, 300),
  });
  if (error) return rpcFailure(error.message);
  resetAgentCatalogCache();
  return ok(data);
}
