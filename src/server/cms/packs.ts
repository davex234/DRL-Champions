/**
 * F60 · SOBRES (SOLO SERVIDOR) — gestor de /admin/packs para sobres nuevos y cargador de los sobres vivos del juego.
 *
 * Los 31 sobres de CÓDIGO siguen de solo lectura (economía congelada, F57.6). Los nuevos viven en `content_packs`,
 * heredan la economía de una plantilla y eligen cartas por su pool `pack-<id>` (el mismo mecanismo de F58.1: POOL =
 * elegibilidad; la PROBABILIDAD la pone la plantilla). Publicar = simulación de servidor + invariantes existentes +
 * arte + pool ACTIVO (la RPC de 0057 lo vuelve a comprobar).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { fail, ok, rpcFailure, type AdminResult } from "@/server/admin/http";
import { listAudit, type AuditRow } from "@/server/admin/audit";
import { resolveAssets, type CmsAsset } from "./assets";
import { serverCatalog } from "@/server/catalog";
import { resetServerDistribution } from "@/server/catalog/distribution";
import { PACKS, applyRuntimePacks, getPack } from "@/data/packs";
import { openPack } from "@/domain/packs/openPack";
import { buildPool } from "@/domain/packs/pool";
import { freshPity } from "@/domain/packs/pity";
import { composeDistribution, type PoolDef, type PackDistribution } from "@/domain/packs/distribution";
import { marketValue } from "@/domain/economy/pricing";
import { salvageValue } from "@/domain/economy/salvage";
import { packCardClass } from "@/domain/packs/packClass";
import { mainBand, packRow } from "@/domain/admin/packAdmin";
import { packLifecycle } from "@/domain/packs/lifecycle";
import type { PackDef } from "@/domain/packs/types";
import {
  inheritedEconomy, packDefFromCms, packPublishGate, packTemplates, validatePackDraft,
  type CmsPackRow, type CmsSimSummary, type GateResult,
} from "@/domain/cms/packs";

const poolIdOf = (packId: string) => `pack-${packId}`;

// ────────────────────────── Cargador del juego ──────────────────────────

const TTL_MS = 5_000;
let cache: { version: number; defs: PackDef[]; checkedAt: number } | null = null;
let inflight: Promise<PackDef[] | null> | null = null;

async function buildDefs(sb: SupabaseClient): Promise<PackDef[] | null> {
  const { data, error } = await sb.from("content_packs").select("*").in("lifecycle", ["ACTIVE", "RETIRED"]).order("created_at", { ascending: true });
  if (error || !data) return null;
  const rows = data as CmsPackRow[];
  const assets = await resolveAssets(sb, rows.map((r) => r.art_asset_id));
  return rows.map((r) => packDefFromCms(r, r.art_asset_id ? assets.get(r.art_asset_id)?.url ?? null : null)).filter((d): d is PackDef => !!d);
}

/** Sobres vivos del panel (ACTIVE + RETIRED). `null` si la BD no responde o no tiene 0057. */
export async function loadPackCatalog(sb: SupabaseClient, now = Date.now()): Promise<PackDef[] | null> {
  if (cache && now - cache.checkedAt < TTL_MS) return cache.defs;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const { data, error } = await sb.from("content_entity_version").select("version").eq("entity", "packs").maybeSingle();
      if (error || !data) return cache?.defs ?? null;
      const version = Number((data as { version: number }).version);
      if (cache && cache.version === version) { cache.checkedAt = now; return cache.defs; }
      const defs = await buildDefs(sb);
      if (!defs) return cache?.defs ?? null;
      cache = { version, defs, checkedAt: now };
      return defs;
    } finally { inflight = null; }
  })();
  return inflight;
}

/** Antes de comprar/abrir/listar la tienda en el servidor: el registro del proceso ve los sobres del panel. */
export async function ensureServerPacks(sb: SupabaseClient | null): Promise<void> {
  if (!sb) return;
  try { const defs = await loadPackCatalog(sb); if (defs) applyRuntimePacks(defs); } catch { /* sin BD ⇒ sólo código */ }
}
export const resetPackCatalogCache = (): void => { cache = null; inflight = null; };

// ────────────────────────── Panel: lectura ──────────────────────────

export interface CmsPackListItem {
  id: string; name: string; source: "code" | "cms"; lifecycle: string; price: number; cardCount: number; templateId: string | null;
  artUrl: string | null; inventoryUnits: number; editable: boolean; updatedAt: string | null;
}

export async function listAllPacks(sb: SupabaseClient): Promise<AdminResult<{ rows: CmsPackListItem[]; templates: { id: string; name: string; price: number; cardCount: number }[] }>> {
  const [{ data: cms, error }, { data: inv }] = await Promise.all([
    sb.from("content_packs").select("*").order("created_at", { ascending: false }),
    sb.from("user_packs").select("pack_id, qty"),
  ]);
  if (error) return fail(500, "No se pudieron leer los sobres");
  const units = new Map<string, number>();
  for (const r of (inv ?? []) as { pack_id: string; qty: number }[]) units.set(r.pack_id, (units.get(r.pack_id) ?? 0) + Number(r.qty ?? 0));
  const cmsRows = (cms ?? []) as CmsPackRow[];
  const assets = await resolveAssets(sb, cmsRows.map((r) => r.art_asset_id));
  const rows: CmsPackListItem[] = [
    ...cmsRows.map((r) => ({
      id: r.id, name: r.name, source: "cms" as const, lifecycle: r.lifecycle, price: r.price, cardCount: r.card_count, templateId: r.template_pack_id,
      artUrl: r.art_asset_id ? assets.get(r.art_asset_id)?.runtimeUrl ?? null : null, inventoryUnits: units.get(r.id) ?? 0, editable: true, updatedAt: r.updated_at,
    })),
    ...PACKS.filter((p) => !p.cms).map((p) => {
      const row = packRow(p);
      return { id: p.id, name: p.name, source: "code" as const, lifecycle: row.lifecycle, price: p.price, cardCount: p.cardCount, templateId: null,
        artUrl: null, inventoryUnits: units.get(p.id) ?? 0, editable: false, updatedAt: null };
    }),
  ];
  return ok({ rows, templates: packTemplates().map((t) => ({ id: t.id, name: t.name, price: t.price, cardCount: t.cardCount })) });
}

export interface PoolInfo { id: string; exists: boolean; lifecycle: string | null; mode: string | null; revision: number | null; entries: { cardId: string; weight: number; mode: string }[]; bound: boolean }

async function poolInfo(sb: SupabaseClient, packId: string): Promise<PoolInfo> {
  const id = poolIdOf(packId);
  const [{ data: p }, { data: e }, { data: b }] = await Promise.all([
    sb.from("content_pools").select("id, lifecycle, mode, revision").eq("id", id).maybeSingle(),
    sb.from("content_pool_entries").select("card_id, weight, mode").eq("pool_id", id),
    sb.from("content_pack_pools").select("pool_id, enabled").eq("pack_id", packId),
  ]);
  const pool = p as { lifecycle: string; mode: string; revision: number } | null;
  return {
    id, exists: !!pool, lifecycle: pool?.lifecycle ?? null, mode: pool?.mode ?? null, revision: pool?.revision ?? null,
    entries: ((e ?? []) as { card_id: string; weight: number; mode: string }[]).map((x) => ({ cardId: x.card_id, weight: Number(x.weight), mode: x.mode })),
    bound: ((b ?? []) as { pool_id: string; enabled: boolean }[]).some((x) => x.pool_id === id && x.enabled),
  };
}

export interface CmsPackDetail {
  pack: CmsPackRow; template: { id: string; name: string; price: number; cardCount: number; drawMode: string } | null;
  art: CmsAsset | null; pool: PoolInfo; references: Record<string, number>;
  gate: GateResult; band: { lo: number; hi: number; median: number }; history: AuditRow[];
}

export async function cmsPackDetail(sb: SupabaseClient, id: string): Promise<AdminResult<CmsPackDetail>> {
  if (!/^cms-[a-z0-9-]{1,44}$/.test(id)) return fail(400, "Id inválido");
  const { data } = await sb.from("content_packs").select("*").eq("id", id).maybeSingle();
  const row = data as CmsPackRow | null;
  if (!row) return fail(404, "Sobre no encontrado");
  const [assets, pool, refs, hist] = await Promise.all([
    resolveAssets(sb, [row.art_asset_id]), poolInfo(sb, id), sb.rpc("app_admin_pack_references", { p_id: id }),
    listAudit(sb, { entityType: "pack", entityId: id, pageSize: 20 }),
  ]);
  if (refs.error) return rpcFailure(refs.error.message);
  const t = getPack(row.template_pack_id);
  const band = mainBand();
  return ok({
    pack: row, art: row.art_asset_id ? assets.get(row.art_asset_id) ?? null : null, pool,
    template: t ? { id: t.id, name: t.name, price: t.price, cardCount: t.cardCount, drawMode: packRow(t).drawMode } : null,
    references: refs.data as Record<string, number>, gate: packPublishGate(row.sim_summary, band, row.template_pack_id),
    band, history: hist.ok ? hist.data.rows : [],
  });
}

// ────────────────────────── Simulación (nunca escribe) ──────────────────────────

export const CMS_SIM_MAX = 6000;

/** Distribución del sobre desde SUS pools enlazados, en cualquier estado (vista previa de un borrador). */
async function previewDistribution(sb: SupabaseClient, packId: string): Promise<{ dist: PackDistribution | null; pools: number }> {
  const { data: binds } = await sb.from("content_pack_pools").select("pool_id, priority, enabled").eq("pack_id", packId);
  const b = ((binds ?? []) as { pool_id: string; priority: number; enabled: boolean }[]).filter((x) => x.enabled);
  if (!b.length) return { dist: null, pools: 0 };
  const ids = b.map((x) => x.pool_id);
  const [{ data: pools }, { data: entries }] = await Promise.all([
    sb.from("content_pools").select("id, mode, rules, lifecycle").in("id", ids),
    sb.from("content_pool_entries").select("pool_id, card_id, weight, mode").in("pool_id", ids),
  ]);
  const defs = new Map<string, PoolDef>();
  for (const p of (pools ?? []) as { id: string; mode: PoolDef["mode"]; rules: PoolDef["rules"] | null; lifecycle: string }[]) {
    if (p.lifecycle === "RETIRED") continue;
    defs.set(p.id, { id: p.id, mode: p.mode, rules: p.rules ?? {}, entries: [] });
  }
  for (const e of (entries ?? []) as { pool_id: string; card_id: string; weight: number; mode: "INCLUDE" | "EXCLUDE" }[]) {
    defs.get(e.pool_id)?.entries.push({ cardId: e.card_id, weight: Number(e.weight), mode: e.mode });
  }
  const list = b.filter((x) => defs.has(x.pool_id)).map((x) => ({ pool: defs.get(x.pool_id)!, priority: x.priority }));
  return { dist: composeDistribution(list, Date.now()), pools: list.length };
}

export async function simulateCmsPack(sb: SupabaseClient, id: string, nArg: unknown): Promise<AdminResult<{ summary: CmsSimSummary; gate: GateResult; band: { lo: number; hi: number } }>> {
  const { data } = await sb.from("content_packs").select("*").eq("id", id).maybeSingle();
  const row = data as CmsPackRow | null;
  if (!row) return fail(404, "Sobre no encontrado");
  const def = packDefFromCms({ ...row, lifecycle: "ACTIVE" }, null);
  if (!def) return fail(409, "La plantilla del sobre ya no existe");
  const n = Math.min(Math.max(Math.trunc(Number(nArg) || 3000), 200), CMS_SIM_MAX);
  const cat = await serverCatalog(sb);
  const { dist, pools } = await previewDistribution(sb, id);
  const registry = cat.packEngine.registry;
  // Cartas elegibles = el pool que construye el propio motor (reglas de la plantilla ∩ pool del sobre).
  const eligible = pools ? buildPool(registry, def, dist).size : 0;
  const vals: number[] = []; const ovr: number[] = []; const classes: Record<string, number> = {};
  let salv = 0, cards = 0, prime = 0, icon = 0; let error: string | null = null;
  if (!pools) error = "El sobre no tiene pool de elegibilidad enlazado";
  else {
    try {
      for (let i = 0; i < n; i++) {
        const r = openPack(registry, def, { seed: (i * 2654435761 + 97) >>> 0, owned: new Set(), pity: freshPity(), distribution: dist });
        let v = 0;
        for (const d of r.decisions) {
          v += marketValue(d.card); salv += salvageValue(d.card); cards++; ovr.push(d.card.ovr);
          const cls = packCardClass(d.card) ?? "otra"; classes[cls] = (classes[cls] ?? 0) + 1;
          if (cls === "prime") prime++; else if (cls === "icon") icon++;
        }
        vals.push(v);
      }
    } catch (e) {
      error = e instanceof Error && /clase|class|vac/i.test(e.message) ? "Alguna clase de la tabla de la plantilla no tiene cartas en el pool" : "El motor no puede abrir este sobre con su pool";
    }
  }
  vals.sort((a, b) => a - b); ovr.sort((a, b) => a - b);
  const q = (xs: number[], p: number) => (xs.length ? xs[Math.min(xs.length - 1, Math.floor(p * xs.length))] : 0);
  const ev = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  const sev = vals.length ? salv / vals.length : 0;
  const summary: CmsSimSummary = {
    n: vals.length, seed: "cms-v1", ev: Math.round(ev), evOverPrice: def.price > 0 ? ev / def.price : 0,
    salvageEV: Math.round(sev), salvageOverPrice: def.price > 0 ? sev / def.price : 0,
    classes: Object.fromEntries(Object.entries(classes).map(([k, v]) => [k, cards ? v / cards : 0])),
    ovr: { p10: q(ovr, 0.1), p50: q(ovr, 0.5), p90: q(ovr, 0.9), max: ovr.length ? ovr[ovr.length - 1] : 0 },
    primePct: cards ? prime / cards : 0, iconPct: cards ? icon / cards : 0, eligibleCards: eligible, poolKey: dist?.key ?? null,
    error, at: new Date().toISOString(),
  };
  const band = mainBand();
  return ok({ summary, gate: packPublishGate(summary, band, row.template_pack_id), band });
}

// ────────────────────────── Panel: escrituras ──────────────────────────

const PACK_PATCH = ["name", "description", "templatePackId", "artAssetId", "accent", "availableFrom", "availableTo"] as const;

export async function savePack(sb: SupabaseClient, actor: string, body: Record<string, unknown>): Promise<AdminResult<unknown>> {
  const creating = body.expectedVersion === undefined || body.expectedVersion === null;
  const id = typeof body.id === "string" ? body.id : "";
  const patch = (body.patch ?? {}) as Record<string, unknown>;
  if (typeof patch !== "object" || Array.isArray(patch)) return fail(400, "Cambios inválidos");
  const extra = Object.keys(patch).filter((k) => !(PACK_PATCH as readonly string[]).includes(k));
  if (extra.length) return fail(400, `Campo no permitido: ${extra[0].slice(0, 40)}`);
  const errors = validatePackDraft({
    id, name: patch.name as string | undefined, description: patch.description as string | undefined,
    templatePackId: patch.templatePackId as string | undefined, accent: patch.accent as string | null | undefined,
    availableFrom: patch.availableFrom as string | null | undefined, availableTo: patch.availableTo as string | null | undefined,
  }, { creating });
  if (Object.keys(errors).length) return fail(400, Object.values(errors)[0]!);
  const db: Record<string, unknown> = {};
  if (patch.name !== undefined) db.name = String(patch.name).trim();
  if (patch.description !== undefined) db.description = String(patch.description ?? "");
  if (patch.accent !== undefined) db.accent = patch.accent || null;
  if (patch.availableFrom !== undefined) db.available_from = patch.availableFrom || null;
  if (patch.availableTo !== undefined) db.available_to = patch.availableTo || null;
  if (patch.artAssetId !== undefined) {
    if (patch.artAssetId !== null && !(typeof patch.artAssetId === "string" && /^[0-9a-f-]{36}$/.test(patch.artAssetId))) return fail(400, "Asset inválido");
    db.art_asset_id = patch.artAssetId;
  }
  if (patch.templatePackId !== undefined) {
    // La economía la pone la plantilla: el cliente no manda precio ni nº de cartas.
    const econ = inheritedEconomy(String(patch.templatePackId));
    if (!econ) return fail(400, "Plantilla inválida");
    db.template_pack_id = patch.templatePackId; db.price = econ.price; db.card_count = econ.cardCount;
    db.sim_summary = null; // otra plantilla ⇒ la simulación anterior ya no describe este sobre
  }
  // Cualquier cambio que afecte al contenido invalida la simulación guardada.
  const reason = typeof body.reason === "string" ? body.reason.slice(0, 300) : "";
  const { data, error } = await sb.rpc("app_admin_pack_save", {
    p_actor: actor, p_id: id, p_patch: db, p_expected_version: creating ? null : Number(body.expectedVersion), p_reason: reason || (creating ? "alta" : "edición"),
  });
  if (error) return rpcFailure(error.message);
  resetPackCatalogCache();
  return ok(data);
}

/** Crea el pool `pack-<id>` (EXPLICIT, borrador) y lo enlaza al sobre si todavía no existen. */
export async function ensurePackPool(sb: SupabaseClient, actor: string, packId: string): Promise<AdminResult<PoolInfo>> {
  const { data } = await sb.from("content_packs").select("id, lifecycle").eq("id", packId).maybeSingle();
  if (!data) return fail(404, "Sobre no encontrado");
  const info = await poolInfo(sb, packId);
  if (!info.exists) {
    const r = await sb.rpc("app_content_pool_upsert", { p_pool: { id: info.id, name: `Elegibilidad · ${packId}`, mode: "EXPLICIT", rules: {} }, p_reason: "F60 · pool de elegibilidad del sobre", p_actor: actor });
    if (r.error) return poolFailure(r.error.message);
  }
  if (!info.bound) {
    const r = await sb.rpc("app_content_pack_bind", { p_pack_id: packId, p_pool_id: info.id, p_priority: 100, p_action: "bind", p_actor: actor });
    if (r.error) return poolFailure(r.error.message);
  }
  resetServerDistribution();
  return ok(await poolInfo(sb, packId));
}

function poolFailure(message: string): AdminResult<never> {
  if (/ha cambiado/i.test(message)) return fail(409, "El pool ha cambiado desde que lo abriste. Recarga y revisa.");
  if (/RETIRADO/i.test(message)) return fail(409, "El pool está retirado");
  if (/solo entran cartas PUBLISHED/i.test(message)) return fail(409, "Sólo entran cartas publicadas en un pool activo");
  if (/Carta inexistente/i.test(message)) return fail(400, "Alguna carta no existe");
  return rpcFailure(message);
}

/** Añadir/quitar cartas del pool del sobre (selección múltiple). Concurrencia por revisión del pool. */
export async function editPackPool(sb: SupabaseClient, actor: string, body: Record<string, unknown>): Promise<AdminResult<PoolInfo>> {
  const packId = String(body.id ?? "");
  const op = body.op;
  const ids = Array.isArray(body.cardIds) ? (body.cardIds as unknown[]).filter((x): x is string => typeof x === "string" && /^[a-z0-9_-]{1,40}__[a-z0-9-]{1,40}$/.test(x)) : [];
  if (op !== "add" && op !== "remove" && op !== "publish") return fail(400, "Operación inválida");
  if (op !== "publish" && (!ids.length || ids.length > 400)) return fail(400, "Selecciona entre 1 y 400 cartas");
  const info = await poolInfo(sb, packId);
  if (!info.exists) return fail(409, "Crea primero el pool del sobre");
  if (body.expectedRevision !== info.revision) return fail(409, "El pool ha cambiado desde que lo abriste. Recarga y revisa.");
  const reason = typeof body.reason === "string" && body.reason.trim().length >= 4 ? body.reason.slice(0, 300) : "F60 · editor de pool";
  if (op === "publish") {
    const r = await sb.rpc("app_content_pool_publish", { p_pool_id: info.id, p_state: "ACTIVE", p_actor: actor, p_reason: reason, p_expected_revision: info.revision });
    if (r.error) return poolFailure(r.error.message);
  } else {
    const current = new Map(info.entries.map((e) => [e.cardId, e]));
    if (op === "add") for (const id of ids) if (!current.has(id)) current.set(id, { cardId: id, weight: 1, mode: "INCLUDE" });
    if (op === "remove") for (const id of ids) current.delete(id);
    const entries = [...current.values()].map((e) => ({ card_id: e.cardId, weight: e.weight, mode: e.mode }));
    const r = await sb.rpc("app_content_pool_set_entries", { p_pool_id: info.id, p_entries: entries, p_reason: reason, p_actor: actor, p_expected_revision: info.revision });
    if (r.error) return poolFailure(r.error.message);
  }
  resetServerDistribution();
  // La simulación guardada ya no describe el pool: se invalida (el sobre sigue en su estado).
  const { data } = await sb.from("content_packs").select("version, sim_summary").eq("id", packId).maybeSingle();
  const cur = data as { version: number; sim_summary: unknown } | null;
  if (cur?.sim_summary) await sb.rpc("app_admin_pack_save", { p_actor: actor, p_id: packId, p_patch: { sim_summary: null }, p_expected_version: cur.version, p_reason: "pool cambiado: simulación invalidada" });
  resetPackCatalogCache();
  return ok(await poolInfo(sb, packId));
}

/**
 * PUBLICAR: se vuelve a simular AQUÍ (autoritativo; no se confía en una simulación vieja del cliente), se exige la
 * puerta y se guarda el resumen; después la RPC comprueba arte + pool ACTIVO + resumen y cambia el estado.
 */
export async function publishPack(sb: SupabaseClient, actor: string, body: Record<string, unknown>): Promise<AdminResult<unknown>> {
  const id = String(body.id ?? "");
  if (typeof body.reason !== "string" || body.reason.trim().length < 4) return fail(400, "El motivo es obligatorio");
  if (body.confirm !== id) return fail(400, "Escribe el id del sobre para confirmar la publicación");
  const { data } = await sb.from("content_packs").select("*").eq("id", id).maybeSingle();
  const row = data as CmsPackRow | null;
  if (!row) return fail(404, "Sobre no encontrado");
  if (row.version !== Number(body.expectedVersion)) return fail(409, "Este contenido ha cambiado desde que lo abriste. Recarga y revisa antes de guardar.");
  if (row.lifecycle !== "DRAFT" && row.lifecycle !== "RETIRED") return fail(409, "Ese cambio de estado no está permitido");
  const econ = inheritedEconomy(row.template_pack_id);
  if (!econ || econ.price !== row.price || econ.cardCount !== row.card_count) return fail(409, "La economía del sobre no coincide con su plantilla");
  const sim = await simulateCmsPack(sb, id, 3000);
  if (!sim.ok) return sim;
  if (!sim.data.gate.ok) return fail(409, `No se puede publicar: ${sim.data.gate.blockers.join(" · ")}`);
  const saved = await sb.rpc("app_admin_pack_save", { p_actor: actor, p_id: id, p_patch: { sim_summary: sim.data.summary }, p_expected_version: row.version, p_reason: "simulación de publicación" });
  if (saved.error) return rpcFailure(saved.error.message);
  const { data: out, error } = await sb.rpc("app_admin_pack_lifecycle", { p_actor: actor, p_id: id, p_to: "ACTIVE", p_expected_version: row.version + 1, p_reason: body.reason.slice(0, 300) });
  if (error) return rpcFailure(error.message);
  resetPackCatalogCache(); resetServerDistribution();
  return ok(out);
}

export async function retirePack(sb: SupabaseClient, actor: string, body: Record<string, unknown>): Promise<AdminResult<unknown>> {
  const id = String(body.id ?? "");
  if (typeof body.reason !== "string" || body.reason.trim().length < 4) return fail(400, "El motivo es obligatorio");
  if (body.confirm !== id) return fail(400, "Escribe el id del sobre para confirmar");
  const { data, error } = await sb.rpc("app_admin_pack_lifecycle", { p_actor: actor, p_id: id, p_to: "RETIRED", p_expected_version: Number(body.expectedVersion), p_reason: body.reason.slice(0, 300) });
  if (error) return rpcFailure(error.message);
  resetPackCatalogCache();
  return ok(data);
}

export async function deletePackDraft(sb: SupabaseClient, actor: string, body: Record<string, unknown>): Promise<AdminResult<unknown>> {
  const id = String(body.id ?? "");
  if (typeof body.reason !== "string" || body.reason.trim().length < 4) return fail(400, "El motivo es obligatorio");
  if (body.confirm !== id) return fail(400, "Escribe el id del sobre para confirmar");
  const { data, error } = await sb.rpc("app_admin_pack_delete_draft", { p_actor: actor, p_id: id, p_expected_version: Number(body.expectedVersion), p_reason: body.reason.slice(0, 300) });
  if (error) return rpcFailure(error.message);
  resetPackCatalogCache(); resetServerDistribution();
  return ok(data);
}

/** Referencias reales de un sobre de CÓDIGO (inspector: ¿quién lo usa?). */
export async function codePackReferences(sb: SupabaseClient, id: string): Promise<AdminResult<Record<string, number>>> {
  const p = getPack(id);
  if (!p || p.cms) return fail(404, "Sobre no encontrado");
  const { data, error } = await sb.rpc("app_admin_pack_references", { p_id: id });
  if (error) return rpcFailure(error.message);
  return ok({ ...(data as Record<string, number>), lifecycle: packLifecycle(p) === "RETIRED" ? 1 : 0 });
}
